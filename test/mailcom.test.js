const assert = require('node:assert/strict');
const axios = require('axios');
const MailCom = require('../src/services/mailcom');

const config = {
  accessToken: 'fixture-token', clientCredentialGuid: 'fixture-guid',
  core: {
    version: '8.38.0', defaultCountry: 'US',
    services: { suggestion: { baseUrl: 'https://register-suggest.mail.com' } },
    products: { FREE_LEVEL_ONE: { name: 'mailcomFree', domains: [{ names: ['mail.com', 'email.com', 'usa.com', 'post.com'] }] } },
  },
};
const signup = value => ({ status: 200, data: `<html><script type="application/json" id="application-config">${JSON.stringify(value)}</script></html>` });
const email = 'example@mail.com';
const availability = available => ({ status: 200, data: { requestedEmailAddress: email, emailAddressAvailable: available } });
const networkError = code => Object.assign(new Error('Do not expose proxy passwords or token here'), { code });

async function run() {
  const originalAdapter = axios.defaults.adapter;
  let calls = [];
  let replies = [];
  axios.defaults.adapter = async request => {
    calls.push(request);
    const reply = replies.shift();
    assert(reply, 'Unexpected request');
    if (reply instanceof Error) throw reply;
    return { headers: {}, config: request, ...reply };
  };
  try {
    const checker = new MailCom('localhost:8080:user:password', email, { retryDelayMs: 0 });
    replies = [signup(config), availability(true)];
    const available = await checker.CheckEmail(' Example@Mail.Com ');
    assert.equal(available.status, 'success');
    assert.equal(available.available, true);
    assert.equal(available.exists, false);
    assert.equal(available.retries, 0);
    assert.equal(calls[0].url, 'https://signup.mail.com/');
    assert.equal(calls[1].url, 'https://register-suggest.mail.com/rest/email-alias/availability');
    assert.equal(calls[1].method, 'post');
    assert.equal(calls[1].headers.Authorization, 'Bearer fixture-token');
    assert.equal(calls[1].headers['X-CCGUID'], 'fixture-guid');
    assert.equal(calls[1].headers['X-UI-APP'], '@mamdev/umreg.registration-app2/8.38.0');
    assert(calls[1].headers['X-REQUEST-ID']);
    assert.equal(JSON.parse(calls[1].data).emailAddress, email);
    assert.equal(JSON.parse(calls[1].data).requestedEmailAddressProduct, 'mailcomFree');
    assert.equal(calls[1].proxy, false);
    assert.equal(calls[1].maxRedirects, 0);
    assert.equal(calls[0].httpsAgent, calls[1].httpsAgent, 'Same proxy for signup and checking');

    calls = [];
    replies = [availability(false)];
    const unavailable = await checker.CheckEmail();
    assert.equal(unavailable.available, false);
    assert.equal(unavailable.exists, null, 'Unavailable does not establish a live mailbox');
    assert.equal(calls.length, 1, 'Reuse signup session');

    const validSession = checker.session;
    for (const response of [
      { status: 200, data: { emailAddressAvailable: 'false', requestedEmailAddress: email } },
      { status: 200, data: { emailAddressAvailable: false, requestedEmailAddress: 'other@mail.com' } },
      { status: 200, data: { emailAddressAvailable: false } },
      { status: 200, data: '<html>Verification required</html>' },
      { status: 400, data: { errors: { emailAddress: ['invalid'] } } },
      { status: 409, data: '' },
      { status: 422, data: {} },
      { status: 501, data: '' },
      { status: 407, data: '' },
      { status: 424, data: '' },
    ]) {
      calls = [];
      checker.session = validSession;
      replies = [response];
      const result = await checker.CheckEmail();
      assert.equal(checker.session, null, 'Clear session after every inconclusive response');
      assert.equal(result.status, 'error');
      assert.equal(result.exists, null);
      assert.equal(result.available, null);
      assert.equal(calls.length, 1, 'HTTP/protocol errors are not retried');
      assert.equal(result.retries, 0);
      if (response.status === 424) assert.equal(result.verificationRequired, true);
      if (response.status === 429) assert.equal(result.retryAfter, '60');
    }

    calls = [];
    for (const invalid of [null, '', 'invalid', 'a+b@mail.com', 'a@@mail.com', 'a b@mail.com', 'a'.repeat(65) + '@mail.com']) {
      checker.session = validSession;
      assert.equal((await checker.CheckEmail(invalid)).code, 'INVALID_EMAIL');
      assert.equal(checker.session, null);
    }
    checker.session = validSession;
    assert.equal((await checker.CheckEmail('someone@proton.me')).code, 'UNSUPPORTED_DOMAIN');
    assert.equal(checker.session, null);
    checker.session = validSession;
    assert.equal((await checker.CheckEmail('someone@gmail.com')).code, 'UNSUPPORTED_DOMAIN');
    assert.equal(calls.length, 0);

    calls = [];
    checker.session = validSession;
    replies = [{ status: 401, data: '' },
      signup({ ...config, core: { ...config.core, version: '8.39.0' } }), availability(true)];
    const renewed = await checker.CheckEmail();
    assert.equal(renewed.status, 'success');
    assert.equal(renewed.retries, 1);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].headers['X-UI-APP'], '@mamdev/umreg.registration-app2/8.39.0');

    const delays = [];
    const transient = new MailCom(null, email, { sleep: async ms => { delays.push(ms); } });
    transient.session = checker.session;
    for (const status of [302, 403, 408, 429, 500, 502, 503, 504]) {
      calls = []; delays.length = 0;
      replies = [{ status, data: '', headers: { 'retry-after': '2' } }, signup({ ...config, accessToken: `renewed-${status}` }), availability(true)];
      const recoveredHttp = await transient.CheckEmail();
      assert.equal(recoveredHttp.status, 'success');
      assert.equal(recoveredHttp.retries, 1);
      assert.equal(calls.length, 3);
      assert.equal(calls[1].url, 'https://signup.mail.com/');
      assert.equal(calls[2].headers.Authorization, `Bearer renewed-${status}`);
      assert.deepEqual(delays, [2000]);
    }
    calls = []; delays.length = 0;
    replies = [{ status: 403 }, ...Array.from({ length: 3 }, () => [signup(config), { status: 403 }]).flat()];
    const forbidden = await transient.CheckEmail();
    assert.equal(forbidden.retries, 3);
    assert.equal(forbidden.retryExhausted, true);
    assert.equal(forbidden.availability, 'unknown');
    assert.equal(forbidden.httpStatus, 403);
    assert.equal(calls.length, 7);
    assert.equal(transient.session, null);
    assert.deepEqual(delays, [1000, 2000, 4000]);

    calls = []; delays.length = 0;
    replies = Array.from({ length: 4 }, () => ({ status: 302,
      headers: { location: 'https://other.invalid/redirect' } }));
    const redirected = await transient.CheckEmail();
    assert.equal(redirected.retries, 3);
    assert.equal(redirected.retryExhausted, true);
    assert.equal(redirected.availability, 'unknown');
    assert.equal(redirected.httpStatus, 302);
    assert.equal(calls.length, 4);
    assert(calls.every(call => call.url === 'https://signup.mail.com/' && call.maxRedirects === 0));
    assert.deepEqual(delays, [1000, 2000, 4000]);

    calls = []; delays.length = 0;
    replies = [networkError('ETIMEDOUT'), { status: 503 }, { status: 429 }, { status: 502 }];
    const mixed = await transient.CheckEmail();
    assert.equal(mixed.retries, 3, 'Network and HTTP failures share one budget');
    assert.equal(mixed.retryExhausted, true);
    assert.equal(mixed.availability, 'unknown');
    assert.equal(calls.length, 4);
    assert.deepEqual(delays, [1000, 2000, 30000]);

    calls = []; delays.length = 0;
    replies = [{ status: 429, headers: { 'retry-after': '3600' } }];
    const deferred = await transient.CheckEmail();
    assert.equal(deferred.retryDeferred, true);
    assert.equal(deferred.retries, 0);
    assert.equal(calls.length, 1, 'Never retry before a long server cooldown');
    assert.deepEqual(delays, []);
    const now = Date.parse('2026-10-14T00:00:00Z');
    assert.equal(MailCom.retryDelay({ httpStatus: 429, retryAfter: 'Wed, 14 Oct 2026 00:01:00 GMT' }, 1000, 0, now), 60000);
    assert.equal(MailCom.retryDelay({ httpStatus: 429, retryAfter: 'invalid' }, 1000, 0, now), 30000);
    assert.equal(MailCom.retryDelay({ httpStatus: 503 }, 1000, 2, now), 4000);

    const signupRetry = new MailCom(null, email, { sleep: async () => {} });
    calls = [];
    replies = [{ status: 503 }, signup(config), availability(false)];
    assert.equal((await signupRetry.CheckEmail()).retries, 1);
    assert.equal(calls.length, 3, 'Retry temporary signup failure too');

    const signupRedirect = new MailCom(null, email, { sleep: async () => {} });
    calls = [];
    replies = [{ status: 302, headers: { location: '/temporary' } }, signup(config), availability(true)];
    const signupRecovered = await signupRedirect.CheckEmail();
    assert.equal(signupRecovered.status, 'success');
    assert.equal(signupRecovered.retries, 1);
    assert.equal(calls.length, 3);
    assert.equal(calls[1].url, 'https://signup.mail.com/');

    const expired = new MailCom(null, email, { sleep: async () => {} });
    calls = [];
    replies = Array.from({ length: 4 }, () => [signup(config), { status: 401 }]).flat();
    assert.equal((await expired.CheckEmail()).retryExhausted, true);
    assert.equal(calls.length, 8, 'Persistent expired session remains bounded');

    for (const response of [
      { status: 302, data: '', headers: { location: 'https://support.mail.com/info/reject.html' } },
      { status: 200, data: '<html>mail.com registration is no longer possible</html>' },
      { status: 200, data: '<script id="application-config">not JSON</script>' },
      signup({ ...config, accessToken: '' }),
      signup({ ...config, core: { ...config.core, services: { suggestion: { baseUrl: 'https://attacker.invalid' } } } }),
    ]) {
      const fresh = new MailCom(null, email, { retryDelayMs: 0 });
      calls = [];
      replies = [response];
      const result = await fresh.CheckEmail();
      assert.equal(result.availability, 'unknown');
      assert.equal(result.status, 'error');
      assert.equal(calls.length, 1, 'Never follow blocked redirect or send token to untrusted endpoint');
    }

    const fresh = new MailCom(null, email, { retryDelayMs: 0 });
    calls = [];
    replies = [networkError('ENOTFOUND'), signup(config), networkError('ECONNRESET'),
      networkError('ECONNABORTED'), signup(config), availability(true)];
    const recovered = await fresh.CheckEmail();
    assert.equal(recovered.status, 'success');
    assert.equal(recovered.retries, 3);
    assert.equal(calls.length, 6, 'Retry budget shared by signup and availability');
    assert.equal(replies.length, 0);

    calls = [];
    replies = Array.from({ length: 4 }, () => networkError('ETIMEDOUT'));
    const exhausted = await fresh.CheckEmail();
    assert.equal(exhausted.networkError, true);
    assert.equal(exhausted.retries, 3);
    assert.equal(calls.length, 4);
    assert.equal(exhausted.available, null);
    assert(!JSON.stringify(exhausted).includes('password'));
    assert(!JSON.stringify(exhausted).includes('fixture-token'));

    const controller = new AbortController();
    fresh.abortSignal = controller.signal;
    fresh.retryDelayMs = 10000;
    calls = [];
    replies = [networkError('ETIMEDOUT')];
    const pending = fresh.CheckEmail();
    setImmediate(() => controller.abort());
    const canceled = await pending;
    assert.equal(canceled.networkError, false);
    assert.equal(canceled.retryable, false);
    assert.equal(calls.length, 1);
    calls = [];
    assert.equal((await fresh.CheckEmail()).errorCode, 'ERR_CANCELED');
    assert.equal(calls.length, 0);
    console.log('Mail.com tests passed: session refresh, proxy, strict matching, bounded network/HTTP retries, Retry-After, cancellation');
  } finally { axios.defaults.adapter = originalAdapter; }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
