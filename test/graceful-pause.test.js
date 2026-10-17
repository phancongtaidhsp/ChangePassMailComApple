const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AliasBatch } = require('../src/alias-batch');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graceful-pause-'));
  try {
    const options = { emailFile: path.join(root, 'main.txt'), aliasFile: path.join(root, 'alias.txt'),
      proxyFile: path.join(root, 'proxy.txt'), concurrency: 2 };
    fs.writeFileSync(options.emailFile, 'main0@mail.com|secret\nmain1@mail.com|secret\nmain2@mail.com|secret');
    const aliases = Array.from({ length: 8 }, (_, i) => `alias${i}@mail.com`);
    fs.writeFileSync(options.aliasFile, aliases.join('\n')); fs.writeFileSync(options.proxyFile, '127.0.0.1:8080');
    for (const stage of ['login', 'add', 'send', 'inbox', 'password', 'cleanup']) {
      let batch, arrivals = 0, release, logins = 0, cancels = 0, closes = 0;
      const gate = new Promise(resolve => { release = resolve; });
      const reached = async currentStage => {
        if (stage !== currentStage) return;
        if (++arrivals === 2) { batch.pause(); release(); }
        await gate;
        assert.equal(batch.state, 'pausing');
      };
      const added = [], sent = new Map(), changed = new Map(), removed = [];
      batch = new AliasBatch({ ...options, outputRoot: path.join(root, stage) }, {
        sendMail: async alias => {
          const calls = (sent.get(alias) || 0) + 1; sent.set(alias, calls);
          await reached('send');
          return calls === 1 ? 'failed' : 'successfully';
        },
        generatePassword: () => 'new-password',
        changePassword: async (_password, url) => {
          const alias = new URL(url).searchParams.get('key');
          changed.set(alias, (changed.get(alias) || 0) + 1);
          await reached('password');
          return alias === aliases[0] ? 'failed' : 'successfully';
        },
        createClient: () => ({
          login: async () => { logins++; await reached('login'); },
          addAlias: async alias => { added.push(alias); await reached('add'); return { status: 'added' }; },
          waitForAppleVerification: async ({ recipient }) => {
            await reached('inbox');
            return { status: 'found', link: `https://iforgot.apple.com/verify/email?key=${encodeURIComponent(recipient)}` };
          },
          removeAlias: async alias => { removed.push(alias); await reached('cleanup'); return { status: 'removed' }; },
          cancel() { cancels++; }, close: async () => { closes++; }
        })
      });
      const waits = []; batch.wait = async ms => waits.push(ms);
      await batch.run();
      assert.equal(batch.state, 'completed'); assert.equal(cancels, 0);
      assert.equal(logins, 2); assert.equal(closes, 2);
      const count = stage === 'login' ? 0 : 2;
      assert.equal(added.length, count); assert.equal(removed.length, count);
      assert.equal(new Set(added).size, count);
      assert.equal(batch.snapshot().remainingAliases, 8 - count);
      assert.equal(batch.pendingInbox.size, 0); assert.equal(batch.assignments.size, 0);
      assert([...batch.results.values()].every(record => ['success', 'fail'].includes(record.exportStatus)));
      for (const alias of added) {
        assert.equal(sent.get(alias), 2);
        assert.equal(changed.get(alias), alias === aliases[0] ? 5 : 1);
      }
      assert(waits.every(ms => ms === 2000));
      if (count) {
        assert.equal(fs.readFileSync(batch.successFile, 'utf8').trim().split('\n').length, 1);
        assert.equal(fs.readFileSync(batch.failFile, 'utf8').trim().split('\n').length, 1);
      }
      // A drained stop is exportable immediately and repeat export is harmless.
      assert.equal(batch.exportInputFiles().done, true);
      assert.equal(batch.exportInputFiles().done, true);
      fs.writeFileSync(options.aliasFile, aliases.join('\n'));
    }
    // Wake idle workers without waiting the full configured 60-second delay.
    let idleAdds = 0;
    const idle = new AliasBatch({ ...options, concurrency: 1, delayMs: 60000, outputRoot: path.join(root, 'idle') }, {
      createClient: () => ({ login: async () => {}, close: async () => {},
        addAlias: async () => { idleAdds++; return { status: 'existing' }; }
      })
    });
    const originalWait = idle.wait.bind(idle);
    idle.wait = (ms, options) => { const result = originalWait(ms, options); queueMicrotask(() => idle.pause()); return result; };
    await idle.run();
    assert.equal(idleAdds, 1); assert.equal(idle.state, 'completed'); assert.equal(idle.waiters.size, 0);
    console.log('Graceful pause tests passed: all stages drain, retries finish, no new aliases/accounts, export after stop and idle wakeup');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
