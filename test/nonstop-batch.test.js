const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AliasBatch } = require('../src/alias-batch');
const { ResultWriter } = require('../src/result-writer');
const failure = (message, extra = {}) => Object.assign(new Error('private response'), { code: 'NEEDS_ATTENTION', safeMessage: message, ...extra });

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nonstop-batch-'));
  try {
    const options = { emailFile: path.join(root, 'main.txt'), aliasFile: path.join(root, 'alias.txt'), proxyFile: path.join(root, 'proxy.txt'), outputRoot: path.join(root, 'results'), concurrency: 10 };
    const mains = Array.from({ length: 12 }, (_, i) => `main${i}@mail.com|login-secret`);
    const aliases = Array.from({ length: 20 }, (_, i) => `alias${i}@mail.com`);
    fs.writeFileSync(options.emailFile, mains.join('\n'));
    fs.writeFileSync(options.aliasFile, [...aliases, aliases[0]].join('\n'));
    fs.writeFileSync(options.proxyFile, '127.0.0.1:8080\n');
    const activeAccounts = new Set(), owners = new Map(), cleanupCalls = new Map(), states = [];
    let cancels = 0;
    const batch = new AliasBatch(options, {
      sendMail: async alias => alias !== aliases[3] ? 'successfully' : 'failed',
      generatePassword: () => 'generated-secret',
      changePassword: async (_password, url) => new URL(url).searchParams.get('key') === aliases[4] ? 'failed' : 'successfully',
      createClient: () => {
        let main;
        return {
          login: async account => {
            main = account.email; assert(!activeAccounts.has(main)); activeAccounts.add(main);
            await new Promise(resolve => setTimeout(resolve, 2));
            if (['main0@mail.com', 'main1@mail.com'].includes(main)) throw failure('Cần xác minh SMS.');
          },
          addAlias: async alias => {
            assert(!owners.has(alias), 'No duplicate alias dispatch'); owners.set(alias, main);
            await new Promise(resolve => setTimeout(resolve, 2));
            if (alias === aliases[0]) throw failure('Kết quả thêm alias chưa xác định.', { aliasSubmitted: true });
            if (alias === aliases[1]) throw failure('HTTP 401.', { httpStatus: 401 });
            return { status: 'added' };
          },
          waitForAppleVerification: async ({ recipient }) => {
            if (recipient === aliases[2]) throw failure('Inbox/token không hợp lệ.');
            return { status: 'found', link: `https://iforgot.apple.com/verify/email?key=${encodeURIComponent(recipient)}` };
          },
          removeAlias: async alias => {
            cleanupCalls.set(alias, (cleanupCalls.get(alias) || 0) + 1);
            if (alias === aliases[5]) throw failure('Xóa alias lỗi HTTP 403.');
            return { status: 'removed' };
          },
          cancel() { cancels++; }, close: async () => activeAccounts.delete(main)
        };
      },
      onUpdate: update => states.push(update.state)
    });
    batch.wait = async () => {};
    await batch.run();
    assert.equal(batch.state, 'completed'); assert.equal(cancels, 0); assert.equal(activeAccounts.size, 0);
    assert(!states.some(state => ['paused', 'pausing', 'error'].includes(state)));
    assert.equal(batch.snapshot().loginFailed, 2); assert.equal(owners.size, 20);
    assert([...owners.values()].every(main => !['main0@mail.com', 'main1@mail.com'].includes(main)));
    assert.equal(batch.snapshot().finalFailed, 5); assert.equal(batch.snapshot().finalSuccess, 15);
    assert.equal(batch.assignments.size, 0); assert.equal(batch.pendingInbox.size, 0);
    for (const alias of [aliases[0], aliases[2], aliases[3], aliases[4]]) assert.equal(cleanupCalls.get(alias), 1);
    assert.equal(cleanupCalls.has(aliases[1]), false);
    assert.equal(fs.readFileSync(batch.mainFailFile, 'utf8').trim().split('\n').length, 2);
    const fails = fs.readFileSync(batch.failFile, 'utf8');
    for (const alias of aliases.slice(0, 6)) assert(fails.includes(`|${alias}|`));
    assert(!fails.includes('private')); assert(fails.includes('|login-secret|'));
    assert(!fs.readFileSync(batch.resultFile, 'utf8').includes('login-secret'));
    assert(fs.readFileSync(batch.successFile, 'utf8').includes(`|${aliases[5]}|generated-secret`));

    // Even if every login fails, no alias is consumed and the run completes.
    const allLoginFail = new AliasBatch({ ...options, outputRoot: path.join(root, 'login-failed') }, {
      createClient: () => ({ login: async () => { throw failure('Sai tài khoản hoặc cần xác minh.'); }, close: async () => {}, cancel() { throw new Error('Must not cancel peers'); } })
    });
    allLoginFail.wait = async () => {};
    await allLoginFail.run();
    assert.equal(allLoginFail.state, 'completed'); assert.equal(allLoginFail.snapshot().loginFailed, 12);
    assert.equal(allLoginFail.nextAlias, 0); assert.equal(allLoginFail.snapshot().remainingAliases, 20);

    // ENOSPC/EACCES never escape into a worker; password exports can be flushed later.
    fs.writeFileSync(options.emailFile, mains[0]); fs.writeFileSync(options.aliasFile, aliases[0]);
    for (const code of ['ENOSPC', 'EACCES']) {
      let blocked = true;
      const io = { mkdirSync: fs.mkdirSync, writeSync: fs.writeSync, closeSync: fs.closeSync,
        openSync: (...args) => { if (blocked) throw Object.assign(new Error(), { code }); return fs.openSync(...args); }
      };
      const b = new AliasBatch({ ...options, outputRoot: path.join(root, code) }, {
        outputIO: io, sendMail: async () => 'successfully', changePassword: async () => 'successfully', generatePassword: () => 'generated-secret',
        createClient: () => ({ login: async () => {}, close: async () => {}, cancel() {},
          addAlias: async () => ({ status: 'added' }), removeAlias: async () => ({ status: 'removed' }),
          waitForAppleVerification: async () => ({ status: 'found', link: 'https://iforgot.apple.com/verify/email?key=fixture' })
        })
      });
      await b.run(); assert.equal(b.state, 'completed'); assert.equal(b.snapshot().finalSuccess, 1);
      assert(b.snapshot().pendingWrites > 0); assert(b.snapshot().writeError.includes(code));
      assert(!JSON.stringify(b.snapshot()).includes('generated-secret'));
      blocked = false; b.flushWrites();
      assert.equal(b.snapshot().pendingWrites, 0); assert.equal(b.snapshot().writeError, '');
      assert.equal(fs.readFileSync(b.successFile, 'utf8'), `main0@mail.com|${aliases[0]}|generated-secret\n`);
      assert(fs.readFileSync(b.failFile, 'utf8').includes('|result_write_failed\n'));
      const saved = fs.readFileSync(b.successFile, 'utf8'); b.flushWrites();
      assert.equal(fs.readFileSync(b.successFile, 'utf8'), saved);
    }

    // Short write followed by ENOSPC must resume at the byte offset, not duplicate data.
    let writes = 0, blocked = true;
    const file = path.join(root, 'partial.txt'), text = 'main|alias|error\n';
    const writer = new ResultWriter(root, { mkdirSync: fs.mkdirSync, openSync: fs.openSync, closeSync: fs.closeSync,
      writeSync: (fd, buffer, offset, length) => {
        if (blocked && writes++) throw Object.assign(new Error(), { code: 'ENOSPC' });
        return fs.writeSync(fd, buffer, offset, blocked ? Math.min(length, 3) : length);
      }
    });
    writer.enqueue(file, text); writer.flush(); assert.equal(writer.pendingCount, 1);
    blocked = false; writer.flush(); assert.equal(writer.pendingCount, 0);
    assert.equal(fs.readFileSync(file, 'utf8'), text);
    console.log('Nonstop tests passed: login rollover, exclusive accounts/aliases, terminal failures, storage buffering and partial-write recovery');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
