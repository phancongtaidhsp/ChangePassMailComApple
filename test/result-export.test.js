const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AliasBatch } = require('../src/alias-batch');
const { removeInputRows, exportResultsFromFiles } = require('../src/export-inputs');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'result-export-'));
  try {
    const options = { emailFile: path.join(root, 'main.txt'), aliasFile: path.join(root, 'alias.txt'),
      proxyFile: path.join(root, 'proxy.txt'), outputRoot: path.join(root, 'results') };
    const originalMain = '\uFEFFbad@mail.com|secret|with-pipe\r\ngood@mail.com|secret\r\n';
    const originalAliases = '\uFEFFSUCCESS@mail.com\r\nrejected@mail.com\r\nexisting@mail.com\r\nno-link@mail.com\r\nsuccess@mail.com\r\ncleanup@mail.com\r\n';
    fs.writeFileSync(options.emailFile, originalMain); fs.writeFileSync(options.aliasFile, originalAliases);
    fs.writeFileSync(options.proxyFile, '127.0.0.1:8080');
    const batch = new AliasBatch(options, {
      sendMail: async () => 'successfully', changePassword: async () => 'successfully', generatePassword: () => 'new-password',
      createClient: () => ({ login: async ({ email }) => { if (email === 'bad@mail.com') throw new Error('private detail'); },
        close: async () => {}, cancel() {},
        addAlias: async alias => alias === 'rejected@mail.com' ? { status: 'failed', message: 'HTTP 412' }
          : { status: alias === 'existing@mail.com' ? 'existing' : 'added' },
        waitForAppleVerification: async ({ recipient }) => recipient === 'no-link@mail.com' ? { status: 'not_found' }
          : { status: 'found', link: 'https://iforgot.apple.com/verify/email?key=fixture' },
        removeAlias: async alias => { if (alias === 'cleanup@mail.com') throw new Error('private detail'); return { status: 'removed' }; }
      })
    });
    batch.wait = async () => {};
    assert.throws(() => batch.exportInputFiles(), /hoàn tất/);
    await batch.run();
    assert.equal(fs.readFileSync(options.aliasFile, 'utf8'), originalAliases, 'Do not edit inputs until the user exports');
    assert.equal(fs.readFileSync(options.emailFile, 'utf8'), originalMain);
    assert.equal(fs.readFileSync(batch.mainFailFile, 'utf8'), 'bad@mail.com|main_login_failed\n');
    const failures = fs.readFileSync(batch.failFile, 'utf8');
    for (const [alias, code] of [['rejected', 'unable_add_alias'], ['existing', 'alias_already_exists'], ['no-link', 'apple_link_not_found'], ['cleanup', 'alias_cleanup_failed']]) {
      assert(failures.includes(`good@mail.com|${alias}@mail.com|${code}\n`));
    }
    assert(failures.trim().split('\n').every(line => /^[a-z][a-z0-9_]*$/.test(line.split('|')[2])));
    // Historical output participates in export even when no matching result remains in RAM.
    fs.appendFileSync(batch.successFile, 'old@mail.com|unrelated@mail.com|old-password\n');
    fs.appendFileSync(options.aliasFile, 'unrelated@mail.com\r\n');
    batch.results.clear(); batch.loginFailed.clear();
    // Altering the UI's options after the run must not redirect the export.
    const aliasPath = options.aliasFile, mainPath = options.emailFile;
    options.aliasFile = path.join(root, 'different.txt');
    fs.writeFileSync(options.aliasFile, 'success@mail.com\n');
    // A partial export can be retried without deleting other rows or double counting.
    const rename = fs.renameSync;
    const realMainPath = fs.realpathSync(mainPath);
    fs.renameSync = (from, to) => {
      if (to === realMainPath) throw Object.assign(new Error('private detail'), { code: 'EACCES' });
      return rename(from, to);
    };
    try { assert.throws(() => batch.exportInputFiles(), /EACCES/); }
    finally { fs.renameSync = rename; }
    assert.equal(batch.inputExport.done, false);
    assert.equal(fs.readFileSync(mainPath, 'utf8'), originalMain);
    const result = batch.exportInputFiles();
    assert.equal(result.aliasesRemoved, 0); assert.equal(result.mainsRemoved, 1);
    assert.equal(fs.readFileSync(aliasPath, 'utf8'), '\uFEFFexisting@mail.com\r\nno-link@mail.com\r\n');
    assert.equal(fs.readFileSync(mainPath, 'utf8'), '\uFEFFgood@mail.com|secret\r\n');
    assert.equal(fs.readFileSync(options.aliasFile, 'utf8'), 'success@mail.com\n');
    assert(!fs.readdirSync(root).some(file => file.endsWith('.bak')));
    const repeated = batch.exportInputFiles();
    assert.equal(repeated.aliasesRemoved, 0); assert.equal(repeated.mainsRemoved, 0);
    // Every click reads the current files again instead of remembering an export flag.
    fs.appendFileSync(batch.successFile, 'good@mail.com|existing@mail.com|new-password\n');
    assert.equal(batch.exportInputFiles().aliasesRemoved, 1);
    assert(!fs.readdirSync(root).some(file => file.endsWith('.tmp')));

    const blockedOptions = { ...options, aliasFile: aliasPath, outputRoot: path.join(root, 'blocked') };
    let blocked = true;
    const io = { mkdirSync: fs.mkdirSync, writeSync: fs.writeSync, closeSync: fs.closeSync,
      openSync: (...args) => { if (blocked) throw Object.assign(new Error(), { code: 'ENOSPC' }); return fs.openSync(...args); } };
    const blockedBatch = new AliasBatch(blockedOptions, { outputIO: io, createClient: () => ({
      login: async () => { throw new Error(); }, close: async () => {}, cancel() {}
    }) });
    blockedBatch.wait = async () => {};
    await blockedBatch.run();
    assert.throws(() => blockedBatch.exportInputFiles(), /ghi hết kết quả/);
    assert.equal(fs.readFileSync(mainPath, 'utf8'), '\uFEFFgood@mail.com|secret\r\n');
    blocked = false; blockedBatch.flushWrites();
    blockedBatch.exportInputFiles();
    assert.equal(fs.readFileSync(mainPath, 'utf8'), '\uFEFF');

    // Failed atomic replacement leaves the original intact.
    const file = path.join(root, 'atomic.txt'); fs.writeFileSync(file, 'remove@mail.com\nkeep@mail.com');
    assert.throws(() => removeInputRows(file, new Set(['remove@mail.com']), { io: { ...fs,
      renameSync: () => { throw Object.assign(new Error(), { code: 'EACCES' }); }
    } }), /EACCES/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'remove@mail.com\nkeep@mail.com');
    assert(!fs.readdirSync(root).some(name => name.endsWith('.tmp')));
    assert(!fs.readdirSync(root).some(name => name.endsWith('.bak')));

    // Offline export works without constructing a batch, with current selected inputs.
    const offlineDir = path.join(root, 'offline'); fs.mkdirSync(offlineDir);
    const offline = { outputRoot: offlineDir, emailFile: path.join(root, 'offline-main.txt'), aliasFile: path.join(root, 'offline-alias.txt') };
    const offlineMain = '\uFEFFbad@mail.com|secret|pipe\r\nkeep@mail.com|secret\r\n';
    const offlineAlias = '\uFEFFSUCCESS@mail.com\r\nsuccess@mail.com\r\nrejected@mail.com\r\nkeep@mail.com\r\ncleanup@mail.com\r\n';
    fs.writeFileSync(offline.emailFile, offlineMain); fs.writeFileSync(offline.aliasFile, offlineAlias);
    const missing = exportResultsFromFiles(offline);
    assert.equal(missing.filesRead, 0); assert.equal(missing.aliasesRemoved, 0);
    assert.equal(fs.readFileSync(offline.aliasFile, 'utf8'), offlineAlias);
    fs.writeFileSync(path.join(offlineDir, 'success.txt'), '\uFEFFold@mail.com|success@mail.com|password|with-pipe\r\ninvalid line\nold@mail.com|keep@mail.com|\n');
    fs.writeFileSync(path.join(offlineDir, 'fail.txt'), 'old@mail.com|rejected@mail.com|unable_add_alias\nold@mail.com|keep@mail.com|inbox_read_failed\nold@mail.com|cleanup@mail.com|alias_cleanup_failed\nold@mail.com||result_write_failed\n');
    fs.writeFileSync(path.join(offlineDir, 'mailchinhfail.txt'), ' BAD@mail.com |main_login_failed\nkeep@mail.com|some_other_error\ninvalid\n');
    const sources = ['success.txt', 'fail.txt', 'mailchinhfail.txt'].map(name => fs.readFileSync(path.join(offlineDir, name), 'utf8'));
    // A read failure in the third file must not partially edit the input files.
    assert.throws(() => exportResultsFromFiles(offline, { io: { ...fs, readFileSync: (file, ...args) => {
      if (path.basename(file) === 'mailchinhfail.txt') throw Object.assign(new Error(), { code: 'EACCES' });
      return fs.readFileSync(file, ...args);
    } } }), /Không đọc được mailchinhfail/);
    assert.equal(fs.readFileSync(offline.aliasFile, 'utf8'), offlineAlias);
    assert.equal(fs.readFileSync(offline.emailFile, 'utf8'), offlineMain);
    const exported = exportResultsFromFiles(offline);
    assert.equal(exported.aliasesRemoved, 3); assert.equal(exported.mainsRemoved, 1);
    assert.equal(exported.skippedRecords, 4);
    assert.equal(fs.readFileSync(offline.aliasFile, 'utf8'), '\uFEFFkeep@mail.com\r\ncleanup@mail.com\r\n');
    assert.equal(fs.readFileSync(offline.emailFile, 'utf8'), '\uFEFFkeep@mail.com|secret\r\n');
    assert.deepEqual(['success.txt', 'fail.txt', 'mailchinhfail.txt'].map(name => fs.readFileSync(path.join(offlineDir, name), 'utf8')), sources);
    assert.throws(() => exportResultsFromFiles({ ...offline, aliasFile: path.join(offlineDir, 'success.txt') }), /trùng file đầu vào/);
    assert.throws(() => exportResultsFromFiles({ ...offline, aliasFile: offline.emailFile }), /không được trùng/);
    // Existing batch export also honors explicitly selected file paths.
    fs.writeFileSync(offline.aliasFile, 'success@mail.com\n');
    assert.equal(batch.exportInputFiles(offline).aliasesRemoved, 1);
    console.log('Result export tests passed: disk source, historical results, offline/current selection, no backups, partial failure, malformed rows and repeated reads');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
