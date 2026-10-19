const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { AliasBatch } = require('../src/alias-batch');

// Load the real integration with a fake HTTP adapter; never open a network connection.
function fixture(secondRequestError) {
  const calls = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/apple.js'), 'utf8'), {
    module, console: { log() {} }, require: name => {
      if (name === 'axios-https-proxy-fix') return { create: config => {
        assert.equal(config.timeout, 20000);
        return { request: async options => {
          calls.push(options);
          if (options.url.includes('/verify/email?key=')) {
            throw { response: { headers: { location: '/password/verify/email?sstt=fixture',
              'set-cookie': ['ifssp=fixture; Path=/', 'X-Apple-I-Web-Token=fixture; Path=/'] } } };
          }
          assert.equal(options.url, 'https://iforgot.apple.com/password/verify/email?sstt=fixture');
          throw secondRequestError;
        } };
      } };
      if (name === 'cheerio') return {};
      if (name === '../helper/helper') return {};
      throw new Error('Unexpected dependency');
    }
  }, { filename: 'apple.js' });
  return { changePassword: module.exports.changePassword, calls };
}

async function withDeadline(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Password flow did not settle after an HTTP error')), 1000);
    })]);
  } finally { clearTimeout(timer); }
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-password-settlement-'));
  try {
    for (const [index, error] of [new Error('network failure'), { code: 'ECONNABORTED' },
      { response: { status: 403, headers: {} } }, { response: { status: 503, headers: {} } }].entries()) {
      const f = fixture(error);
      const url = 'https://iforgot.apple.com/verify/email?key=fixture';
      assert.equal(await withDeadline(f.changePassword('new-password', url, '127.0.0.1:8080:user:pass')), null);
      assert.equal(f.calls.length, 2);
      const options = { emailFile: path.join(root, 'main.txt'), aliasFile: path.join(root, 'alias.txt'),
        proxyFile: path.join(root, 'proxy.txt'), outputRoot: path.join(root, String(index)) };
      fs.writeFileSync(options.emailFile, 'main@mail.com|secret');
      fs.writeFileSync(options.aliasFile, 'alias@mail.com');
      fs.writeFileSync(options.proxyFile, '127.0.0.1:8080:user:pass');
      let cleanupCalls = 0;
      const waits = [];
      const batch = new AliasBatch(options, {
        sendMail: async () => 'successfully', changePassword: f.changePassword, generatePassword: () => 'new-password',
        createClient: () => ({ login: async () => {}, close: async () => {},
          addAlias: async () => ({ status: 'added' }),
          waitForAppleVerification: async () => ({ status: 'found', link: url }),
          removeAlias: async () => { cleanupCalls++; return { status: 'removed' }; }
        })
      });
      batch.wait = async ms => waits.push(ms);
      await withDeadline(batch.run());
      assert.equal(f.calls.length, 12); // Standalone call + five batch attempts, two requests each.
      assert.equal(batch.results.get(0).passwordChangeAttempts, 5);
      assert.equal(batch.state, 'completed'); assert.equal(batch.pendingInbox.size, 0);
      assert.equal(cleanupCalls, 1); assert.deepEqual(waits, [2000, 2000, 2000, 2000]);
      assert.equal(fs.readFileSync(batch.failFile, 'utf8'), 'main@mail.com|secret|alias@mail.com|password_change_failed\n');
    }
    console.log('Apple password settlement tests passed: network/timeout/HTTP failures resolve, retry five times and clean up');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
