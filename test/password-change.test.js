const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AliasBatch } = require('../src/alias-batch');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'password-change-'));
  try {
    const options = { emailFile: path.join(root, 'main.txt'), aliasFile: path.join(root, 'alias.txt'), proxyFile: path.join(root, 'proxy.txt') };
    fs.writeFileSync(options.emailFile, 'main@mail.com|secret');
    fs.writeFileSync(options.aliasFile, 'alias@mail.com');
    const proxy = '127.0.0.1:8080:user:pass'; fs.writeFileSync(options.proxyFile, proxy);
    for (const succeedsAt of [1, 3, 5, Infinity]) {
      let changes = 0, generated = 0, removed = 0;
      const waits = [];
      const batch = new AliasBatch({ ...options, outputRoot: path.join(root, String(succeedsAt)) }, {
        sendMail: async () => 'successfully',
        generatePassword: () => { generated++; return 'new-password'; },
        changePassword: async (password, url, suppliedProxy) => {
          assert.equal(password, 'new-password'); assert.equal(suppliedProxy, proxy);
          assert.equal(url, 'https://iforgot.apple.com/verify/email?key=fixture');
          changes++; if (changes < succeedsAt) throw new Error('private detail');
          return 'successfully';
        },
        createClient: () => ({ login: async () => {}, close: async () => {}, cancel() {},
          addAlias: async () => ({ status: 'added' }),
          waitForAppleVerification: async () => ({ status: 'found', link: 'https://iforgot.apple.com/verify/email?key=fixture' }),
          removeAlias: async () => { removed++; return { status: 'removed' }; }
        })
      });
      batch.wait = async ms => waits.push(ms);
      await batch.run();
      assert.equal(changes, Math.min(succeedsAt, 5)); assert.equal(generated, 1); assert.equal(removed, 1);
      assert.deepEqual(waits, Array(changes - 1).fill(2000));
      assert.equal(fs.readFileSync(batch.failFile, 'utf8'), succeedsAt === Infinity ? 'main@mail.com|secret|alias@mail.com|password_change_failed\n' : '');
      assert.equal(fs.readFileSync(batch.successFile, 'utf8'), succeedsAt === Infinity ? '' : 'main@mail.com|secret|alias@mail.com|new-password\n');
      assert(!fs.readFileSync(batch.resultFile, 'utf8').includes('new-password'));
    }
    console.log('Password change tests passed: retry budget, stable password/raw proxy, cleanup and failure codes');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
