const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AliasListBatch } = require('../src/alias-list-batch');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-list-test-'));
  try {
    const options = { mode: 'list', emailFile: path.join(root, 'main.txt'),
      proxyFile: path.join(root, 'proxy.txt'), outputRoot: path.join(root, 'results'), concurrency: 3 };
    const source = Array.from({ length: 8 }, (_, index) => `main${index}@mail.com|secret|${index}`).join('\n');
    fs.writeFileSync(options.emailFile, source); fs.writeFileSync(options.proxyFile, '127.0.0.1:8080\n');
    const logins = [], active = new Set(), snapshots = [];
    let maximum = 0, closed = 0;
    const batch = new AliasListBatch(options, { onUpdate: snapshot => snapshots.push(snapshot), createClient: (_report, proxy) => {
      assert.equal(new URL(proxy).host, '127.0.0.1:8080');
      let main;
      return {
        login: async account => {
          main = account.email; assert(!active.has(main)); active.add(main); logins.push(main);
          assert.equal(account.password, `secret|${main.match(/main(\d+)/)[1]}`);
          maximum = Math.max(maximum, active.size);
          await new Promise(resolve => setTimeout(resolve, 2));
          if (main === 'main1@mail.com') throw new Error('Private login data');
        },
        listAddresses: async () => {
          if (main === 'main2@mail.com') throw new Error('Private token');
          if (main === 'main3@mail.com') return [{ address: main }];
          if (main === 'main4@mail.com') return [{ address: null }];
          return [{ address: main.toUpperCase() }, ...Array.from({ length: 4 }, (_, index) => ({
            address: `${main.split('@')[0]}-alias${index}@mail.com`, defaultSenderAddress: index === 0,
            deletable: index !== 0
          })), { address: `${main.split('@')[0]}-alias0@mail.com` }];
        },
        close: async () => { closed++; active.delete(main); }
      };
    } });
    batch.wait = async () => {};
    fs.appendFileSync(batch.resultFile, 'history@mail.com|old-secret|old-alias@mail.com\n');
    await batch.run();
    const snapshot = batch.snapshot();
    assert.equal(snapshot.state, 'completed'); assert.equal(snapshot.finalSuccess, 5);
    assert.equal(snapshot.finalFailed, 3); assert.equal(snapshot.aliasesFound, 16);
    assert.equal(snapshot.attempted, 8); assert.equal(snapshot.loginFailed, 1);
    assert.equal(logins.length, 8); assert.equal(new Set(logins).size, 8);
    assert.equal(maximum, 3); assert.equal(active.size, 0); assert.equal(closed, 8);
    const rows = fs.readFileSync(batch.resultFile, 'utf8').trim().split('\n');
    assert.equal(rows[0], 'history@mail.com|old-secret|old-alias@mail.com'); assert.equal(rows.length, 17);
    for (const index of [0, 5, 6, 7]) {
      for (let alias = 0; alias < 4; alias++) assert.equal(rows.filter(row => row === `main${index}@mail.com|secret|${index}|main${index}-alias${alias}@mail.com`).length, 1);
    }
    assert(!rows.some(row => row.endsWith('|main0@mail.com')));
    assert.equal(fs.readFileSync(batch.mainFailFile, 'utf8'), 'main1@mail.com|main_login_failed\n');
    const fails = fs.readFileSync(batch.failFile, 'utf8');
    assert(fails.includes('main2@mail.com|secret|2||alias_list_failed\n'));
    assert(fails.includes('main4@mail.com|secret|4||alias_list_failed\n'));
    assert(!fails.includes('Private')); assert(!JSON.stringify(snapshots).includes('secret'));
    assert(snapshots.some(s => s.result?.status === 'empty' && s.result.mainEmail === 'main3@mail.com'));
    assert.equal(fs.readFileSync(options.emailFile, 'utf8'), source);
    assert.equal(fs.existsSync(path.join(options.outputRoot, 'success.txt')), false);
    assert.equal(fs.existsSync(path.join(options.outputRoot, 'alias-results.jsonl')), false);
    assert.equal(fs.statSync(batch.resultFile).mode & 0o777, 0o600);

    // A pause drains both reserved accounts, without logging into any others.
    const gates = [], pausedLogins = [];
    let bothStarted;
    const started = new Promise(resolve => { bothStarted = resolve; });
    const paused = new AliasListBatch({ ...options, concurrency: 2, outputRoot: path.join(root, 'paused') }, {
      createClient: () => { let main; return {
        login: async account => { main = account.email; pausedLogins.push(main); },
        listAddresses: async () => {
          await new Promise(resolve => { gates.push(resolve); if (gates.length === 2) bothStarted(); });
          return [{ address: main }, { address: `alias-${main}` }];
        }, close: async () => {}
      }; }
    });
    const pending = paused.run(); await started; paused.pause();
    assert.equal(paused.state, 'pausing'); gates.forEach(resolve => resolve()); await pending;
    assert.equal(paused.state, 'completed'); assert.equal(pausedLogins.length, 2);
    assert.equal(paused.snapshot().remainingAccounts, 6); assert.equal(paused.snapshot().aliasesFound, 2);

    // Disk errors buffer the output while every account continues processing.
    let blocked = true;
    const io = { mkdirSync: fs.mkdirSync, writeSync: fs.writeSync, closeSync: fs.closeSync,
      openSync: (...args) => { if (blocked) throw Object.assign(new Error(), { code: 'ENOSPC' }); return fs.openSync(...args); } };
    const storage = new AliasListBatch({ ...options, outputRoot: path.join(root, 'storage'), concurrency: 50 }, {
      outputIO: io, createClient: () => ({ login: async () => {},
        listAddresses: async () => [{ address: 'alias@mail.com' }], close: async () => {} })
    });
    storage.wait = async () => {};
    await storage.run(); assert.equal(storage.snapshot().concurrency, 8);
    assert.equal(storage.snapshot().finalSuccess, 8); assert(storage.snapshot().pendingWrites > 0);
    blocked = false; storage.flushWrites(); assert.equal(storage.snapshot().pendingWrites, 0);
    assert.equal(fs.readFileSync(storage.resultFile, 'utf8').trim().split('\n').length, 8);
    assert(fs.readFileSync(storage.failFile, 'utf8').includes('||result_write_failed\n'));
    storage.flushWrites(); assert.equal(fs.readFileSync(storage.resultFile, 'utf8').trim().split('\n').length, 8);

    // Output paths cannot overwrite either input, including through a symlink.
    const conflicting = path.join(root, 'conflicting'); fs.mkdirSync(conflicting);
    fs.symlinkSync(options.emailFile, path.join(conflicting, 'mailchinh-alias.txt'));
    assert.throws(() => new AliasListBatch({ ...options, outputRoot: conflicting }), /trùng đầu vào/);
    fs.writeFileSync(options.emailFile, 'main@mail.com|secret\nMAIN@mail.com|secret');
    assert.throws(() => new AliasListBatch(options), /bị trùng/);
    fs.writeFileSync(options.emailFile, '');
    assert.throws(() => new AliasListBatch(options), /không được rỗng/);
    console.log('Alias listing tests passed: four aliases per main, append, exclusive workers, failures, pause, storage recovery and no mutations');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
