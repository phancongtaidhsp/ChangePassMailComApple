const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { AliasBatch } = require('../src/alias-batch');
const { MailComAliasClient, HOME } = require('../src/services/mailcom-alias');

const stages = ['getConfig', 'getCaptchaReq', 'sendCaptcha', 'verifyCaptcha', 'recoverOption',
  'sendRequestMail', 'sendRequestChangePass', 'getRequestChangePass', 'sendResetOption',
  'getResetOption', 'changePasswordReq'];
function appleFixture(request) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/services/apple.js'), 'utf8');
  vm.runInNewContext(`${source}\nmodule.exports.stages = { ${stages.join(', ')} };`, {
    module, console: { log() {} }, require: name => {
      if (name === 'axios-https-proxy-fix') return { create: config => {
        assert.equal(config.timeout, 20000); return { request };
      } };
      if (name === 'cheerio') return require('cheerio');
      if (name === './request-deadline') return require('../src/services/request-deadline');
      if (name === '../helper/helper') return {
        getCaptchaResult: async () => 'fixture', getCaptchaResultNope: async () => 'fixture'
      };
      throw new Error('Unexpected dependency');
    }
  });
  return module.exports;
}
async function settles(operation) {
  let timer;
  try {
    // Treat both resolution and rejection as settlement. A rejected parser must
    // reach sendMail/changePassword rather than leave a hidden wrapper pending.
    return await Promise.race([
      Promise.resolve().then(operation).then(value => ({ value }), error => ({ error })),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Operation stayed pending')), 1000); })
    ]);
  } finally { clearTimeout(timer); }
}
async function testAppleStages() {
  const errors = [new Error('network'), { code: 'ECONNABORTED' },
    { response: { status: 302, headers: {} } },
    { response: { status: 302, headers: { 'set-cookie': {} } } },
    { response: { status: 302, headers: { 'set-cookie': [null], location: {} } } }];
  for (const error of errors) {
    const api = appleFixture(async () => { throw error; });
    for (const name of stages) await settles(() => api.stages[name]({}, ...Array(8).fill('fixture')));
  }
  for (const response of [undefined, {}, { data: {}, headers: { 'set-cookie': [null] } },
    { data: {}, headers: { location: {} } }]) {
    const api = appleFixture(async () => response);
    for (const name of stages) await settles(() => api.stages[name]({}, ...Array(8).fill('fixture')));
  }
  const api = appleFixture(() => { throw new Error('adapter failed synchronously'); });
  for (const name of stages) await settles(() => api.stages[name]({}, ...Array(8).fill('fixture')));
  assert.equal((await settles(() => api.sendMail('alias@mail.com', null))).value, 'fail send mail');
  assert.equal((await settles(() => api.changePassword('fixture', 'fixture', null))).value, null);
}
async function testSendBatch() {
  let calls = 0;
  const api = appleFixture(async options => {
    calls++;
    if (options.method === 'GET' && options.url.endsWith('/password/verify/appleid')) {
      return { data: '<script id="boot_args">{"sstt":"fixture"}</script>',
        headers: { 'set-cookie': ['ifssp=fixture; Path=/', 'X-Apple-I-Web-Token=fixture; Path=/'] } };
    }
    if (options.url.includes('/captcha?')) return { data: { payload: { content: 'fixture' }, id: 'fixture', token: 'fixture' } };
    assert.equal(options.method, 'POST');
    // This used to throw inside the catch handler: no set-cookie to iterate.
    throw { response: { status: 302, headers: { location: '/fixture?sstt=fixture' } } };
  });
  assert.equal((await settles(() => api.sendMail('alias@mail.com', '127.0.0.1:8080'))).value, 'fail send mail');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'send-mail-settlement-'));
  try {
    const options = { emailFile: path.join(root, 'main.txt'), aliasFile: path.join(root, 'aliases.txt'),
      proxyFile: path.join(root, 'proxy.txt'), outputRoot: path.join(root, 'output') };
    fs.writeFileSync(options.emailFile, 'main@mail.com|secret');
    fs.writeFileSync(options.aliasFile, 'first@mail.com\nsecond@mail.com');
    fs.writeFileSync(options.proxyFile, '127.0.0.1:8080');
    let cleaned = 0;
    const batch = new AliasBatch(options, { sendMail: api.sendMail, changePassword: async () => {
      throw new Error('Password flow should not run when mail was not sent');
    }, createClient: () => ({ login: async () => {}, close: async () => {},
      addAlias: async () => ({ status: 'added' }),
      removeAlias: async () => { cleaned++; return { status: 'removed' }; }
    }) });
    batch.wait = async () => {};
    const result = await settles(() => batch.run());
    assert(!result.error); assert.equal(batch.state, 'completed');
    assert.equal(cleaned, 2); assert.equal(calls, 33);
    assert.equal(batch.results.get(0).sendAttempts, 5); assert.equal(batch.results.get(1).sendAttempts, 5);
    assert.equal(fs.readFileSync(batch.failFile, 'utf8'),
      'main@mail.com|secret|first@mail.com|send_mail_failed\nmain@mail.com|secret|second@mail.com|send_mail_failed\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
async function testHelperTimeouts() {
  for (const scenario of ['submission-timeout', 'poll-timeout', 'poll-budget']) {
    const calls = [];
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/helper/helper.js'), 'utf8'), {
      module, console: { log() {} }, process: { version: 'fixture', platform: 'fixture' },
      // Skip polling delays in this test only; all requests are mocked.
      setTimeout: callback => setTimeout(callback, 0),
      require: name => {
        if (name === 'node:crypto') return require('node:crypto');
        if (name === '../services/request-deadline') return require('../src/services/request-deadline');
        if (name === 'axios') return { create: () => ({}) };
        if (name === 'axios-https-proxy-fix') return { request: async config => {
          calls.push(config); assert.equal(config.timeout, 20000);
          if (scenario === 'submission-timeout') throw { code: 'ECONNABORTED' };
          if (config.method === 'post') return { data: { data: 'fixture' } };
          throw scenario === 'poll-budget' ? { response: { status: 409 } } : { code: 'ECONNABORTED' };
        } };
        throw new Error('Unexpected dependency');
      }
    });
    const result = await settles(() => module.exports.getCaptchaResultNope({}, 'fixture', 'fixture'));
    assert.equal(result.value, null); assert(!result.error);
    assert.equal(calls.length, scenario === 'submission-timeout' ? 5 : scenario === 'poll-timeout' ? 2 : 121);
  }
}
async function testCaptchaResultSettlement() {
  function fixture(request, { brokenForm = false } = {}) {
    const calls = [], waits = [], signals = [], timers = new Set();
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/helper/helper.js'), 'utf8'), {
      module, AbortController,
      setTimeout: (callback, ms) => {
        if (ms !== 20000) waits.push(ms);
        // Exercise real cancellation without waiting twenty seconds per case.
        const timer = setTimeout(() => { timers.delete(timer); callback(); }, ms === 20000 ? 15 : 0);
        timers.add(timer); return timer;
      },
      clearTimeout: timer => { timers.delete(timer); clearTimeout(timer); },
      require: name => {
        if (name === 'node:crypto') return require('node:crypto');
        if (name === '../services/request-deadline') {
          const actual = require('../src/services/request-deadline');
          return { ...actual, withDeadline: (operation, options) => actual.withDeadline(operation, { ...options, timeout: 15 }) };
        }
        if (name === 'axios') return { create: () => ({ request: options => {
          calls.push(options); signals.push(options.signal);
          assert.equal(options.timeout, 20000);
          assert.equal(options.signal.aborted, false);
          return request(options, calls.length);
        } }) };
        if (name === 'form-data') return class {
          constructor() { if (brokenForm) throw new Error('Form setup failed'); }
          append() {}
          getHeaders() { return {}; }
        };
        throw new Error('Unexpected dependency');
      }
    });
    return { run: () => module.exports.getCaptchaResult('fixture', 'fixture'), calls, waits, signals, timers };
  }
  async function result(f) {
    const settled = await settles(f.run);
    assert(!settled.error); assert.equal(f.timers.size, 0, 'Request deadline must be cleared');
    return settled.value;
  }
  let f = fixture((options, count) => Promise.resolve({ data: count === 1 ? 'OK|fixture-id'
    : count < 4 ? 'CAPCHA_NOT_READY\r\n' : 'OK|fixture-answer' }));
  assert.equal(await result(f), 'fixture-answer');
  assert.equal(f.calls.length, 4); assert.deepEqual(f.waits, [1000, 1000]);
  assert(f.signals.every(signal => !signal.aborted));

  f = fixture(options => Promise.resolve({ data: options.method === 'post' ? 'OK|fixture-id' : 'CAPCHA_NOT_READY' }));
  assert.equal(await result(f), ''); assert.equal(f.calls.length, 11); assert.equal(f.waits.length, 9);

  for (const response of [undefined, {}, { data: null }, { data: {} }, { data: 'ERROR|fixture' }, { data: 'OK|' }]) {
    f = fixture(async () => response);
    assert.equal(await result(f), ''); assert.equal(f.calls.length, 1, 'Do not poll without a valid ID');
    f = fixture(async options => options.method === 'post' ? { data: 'OK|fixture-id' } : response);
    assert.equal(await result(f), ''); assert.equal(f.calls.length, 2);
  }
  for (const stage of ['post', 'get']) {
    f = fixture(options => {
      if (options.method !== stage) return Promise.resolve({ data: 'OK|fixture-id' });
      return new Promise((_, reject) => options.signal.addEventListener('abort',
        () => reject(new Error('Request deadline exceeded')), { once: true }));
    });
    assert.equal(await result(f), ''); assert.equal(f.calls.length, stage === 'post' ? 1 : 2);
    assert.equal(f.signals.at(-1).aborted, true);
    for (const error of [new Error('network'), { response: { status: 403 } }, { code: 'ECONNABORTED' }]) {
      f = fixture(options => {
        if (options.method === stage) throw error;
        return Promise.resolve({ data: 'OK|fixture-id' });
      });
      assert.equal(await result(f), ''); assert.equal(f.calls.length, stage === 'post' ? 1 : 2);
    }
  }
  f = fixture(async () => { throw new Error('Must not request after setup failed'); }, { brokenForm: true });
  assert.equal(await result(f), ''); assert.equal(f.calls.length, 0);
}
async function testMailboxDeadline() {
  const client = new MailComAliasClient(() => {}, { proxy: 'http://127.0.0.1:8080' });
  let signal;
  client.request = config => {
    signal = config.signal;
    return new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Aborted proxy connection')), { once: true });
    });
  };
  await assert.rejects(client.http(HOME, { timeout: 15 }), error => error.retryable === true);
  assert.equal(signal.aborted, true); assert.equal(client.cancelled, false);
  client.request = async config => { signal = config.signal; return { status: 200, headers: {} }; };
  assert.equal((await client.http(HOME, { timeout: 15 })).status, 200);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(signal.aborted, false, 'Finished request must not keep its deadline timer');
  client.request = config => new Promise((_, reject) => {
    signal = config.signal;
    signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    client.cancel();
  });
  await assert.rejects(client.http(HOME), error => error.code === 'CANCELLED');
  assert.equal(signal.aborted, true);
}
async function run() {
  await testAppleStages(); await testSendBatch(); await testHelperTimeouts();
  await testCaptchaResultSettlement(); await testMailboxDeadline();
  console.log('Async safety tests passed: malformed responses settle, send retries/cleanup continue, helper timeouts and proxy cancellation');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
