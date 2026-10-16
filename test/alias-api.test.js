const assert = require('node:assert/strict');
const { MailComAliasClient, parseLogin, settingsSession, HOME, LOGIN, TOKEN, ADDRESSES, ADDRESS_REMOVALS, LIST, DOMAINS, VALIDATE } = require('../src/services/mailcom-alias');
const response = (data, status = 200, headers = {}) => ({ data, status, headers });
const main = { address: 'primary@mail.com', displayName: 'Sender', defaultSenderAddress: true };
const form = '<form action="https://login.mail.com/login" method="post"><input name="service" value="mail&amp;test"><input name="username"><input name="password" type="password"></form>';
const shell = '"mail_settings":{"url_map":{"default":"https:\\/\\/mailset-root.mail.com?navsid=fake-sid"}}<a href="/logout?sid=fake-sid">Logout</a>';
async function run() {
  assert.equal(parseLogin(form).get('service'), 'mail&test');
  assert.throws(() => parseLogin(form.replace('https://login.mail.com/login', 'https://evil.example/login')));
  assert.equal(settingsSession(shell), 'fake-sid');
  assert.throws(() => settingsSession(shell.replace('mailset-root.mail.com', 'evil.example')));
  assert.throws(() => settingsSession('<html><body>Verify your identity. Our security system has detected irregular login activity. We will send a text message to your mobile phone.</body></html>'), /xác minh danh tính bằng SMS/);
  assert.throws(() => new MailComAliasClient(), /proxy/);
  assert.throws(() => new MailComAliasClient(() => {}, { proxy: 'socks5://localhost:1080' }), /Proxy/);
  const calls = []; let mutation = 0;
  const client = new MailComAliasClient(() => {}, { proxy: 'http://127.0.0.1:8080', pause: async () => {}, request: async config => {
    assert.equal(config.httpsAgent, client.agent);
    assert.equal(config.httpAgent, client.agent);
    assert.equal(config.proxy, false);
    calls.push(config);
    if (config.url === HOME) return response(form, 200, { 'set-cookie': ['session=test; Domain=mail.com; Path=/; Secure'] });
    if (config.url === LOGIN) {
      const data = new URLSearchParams(config.data); assert.equal(data.get('password'), ' pass|&+');
      assert.equal(config.headers.Cookie, 'session=test');
      return response('', 302, { location: 'https://navigator-lxa.mail.com/login' });
    }
    if (config.url === 'https://navigator-lxa.mail.com/login') {
      assert.equal(config.method, 'GET'); assert.equal(config.data, undefined);
      return response('new FeatureDetection({"redirectUrl":"/halogin?ott=fake"})');
    }
    if (config.url.includes('/halogin?')) return response(shell);
    if (config.url.startsWith(TOKEN)) return response({ access_token: 'fake-token' });
    if (config.url === LIST) return response({ mailaddresslist: mutation ? [main, { address: 'alias@mail.com' }] : [main] });
    if (config.url === DOMAINS) return response({ domains: [{ domain: 'mail.com' }] });
    if (config.url === VALIDATE) {
      assert.equal(config.headers['Content-Type'], 'application/vnd.ui.trinity.email-address-validation-request+json');
      assert.equal(config.headers.Accept, 'application/vnd.ui.trinity.email-address-validation-response+json');
      assert.deepEqual(JSON.parse(config.data), ['alias@mail.com']);
      return response({});
    }
    if (config.url === ADDRESSES) {
      mutation++; assert.equal(config.method, 'POST'); assert.equal(config.headers.Authorization, 'Bearer fake-token');
      assert.deepEqual(JSON.parse(config.data), { address: 'alias@mail.com', displayName: 'Sender', deletable: true, pgpEnabled: false, defaultSenderAddress: false, defaultReceiverAddress: false, state: 'ACTIVE' });
      client.cancel(); // Cancellation after submit must not skip reconciliation.
      return response('', 204);
    }
    if (config.url.includes('/logout?')) return response('', 302, { location: HOME });
    throw new Error('Unexpected fixture request');
  } });
  await client.login({ email: main.address, password: ' pass|&+' });
  assert.equal((await client.addAlias('alias@mail.com')).status, 'added');
  assert.equal(mutation, 1); await client.close(); assert.equal(client.token, null); assert.equal(await client.jar.getCookieString(HOME), '');
  assert(calls.some(c => c.url.includes('/logout?')));
  function fixture({ existing = false, wrongAccount = false, status = 204, body = '', validation = {}, timeout = false, visibleAfter = false, full = false } = {}) {
    let writes = 0;
    const c = new MailComAliasClient(() => {}, { proxy: 'http://127.0.0.1:8080', pause: async () => {}, request: async config => {
      if (config.url === LIST) return response({ mailaddresslist: [...(wrongAccount ? [] : [main]), ...(full ? Array.from({ length: 9 }, (_, i) => ({ address: `old${i}@mail.com` })) : []), ...(existing || (writes && visibleAfter) ? [{ address: 'alias@mail.com' }] : [])] });
      if (config.url === DOMAINS) return response({ domains: [{ domain: 'mail.com' }] });
      if (config.url === VALIDATE) return response(validation);
      if (config.url === ADDRESSES) { writes++; if (timeout) throw new Error('secret network detail'); return response(body, status); }
      throw new Error('unexpected');
    } }); c.token = 'test'; c.mainEmail = main.address;
    return { c, writes: () => writes };
  }
  let f = fixture({ existing: true }); assert.equal((await f.c.addAlias('alias@mail.com')).status, 'existing'); assert.equal(f.writes(), 0);
  f = fixture({ wrongAccount: true }); await assert.rejects(f.c.addAlias('alias@mail.com'), /không thuộc/); assert.equal(f.writes(), 0);
  f = fixture({ timeout: true, visibleAfter: true }); assert.equal((await f.c.addAlias('alias@mail.com')).status, 'added'); assert.equal(f.writes(), 1);
  f = fixture(); await assert.rejects(f.c.addAlias('alias@mail.com'), /Chưa xác nhận/); assert.equal(f.writes(), 1);
  f = fixture({ status: 409 }); assert.equal((await f.c.addAlias('alias@mail.com')).status, 'failed'); assert.equal(f.writes(), 1);
  f = fixture({ status: 412, body: { type: 'urn:problem:mam:cats:target-response-masked', detail: 'secret-token' } });
  const rejected = await f.c.addAlias('alias@mail.com');
  assert.equal(rejected.status, 'failed'); assert.equal(rejected.httpStatus, 412); assert(!rejected.message.includes('secret-token')); 
  assert.equal(f.writes(), 1);
  f = fixture({ validation: { 'alias@mail.com': 'ILLEGAL_LOCALPART' } });
  assert.equal((await f.c.addAlias('alias@mail.com')).status, 'failed'); assert.equal(f.writes(), 0);
  f = fixture({ validation: [] }); await assert.rejects(f.c.addAlias('alias@mail.com'), /định dạng/); assert.equal(f.writes(), 0);
  f = fixture({ full: true }); assert.equal((await f.c.addAlias('alias@mail.com')).accountFull, true); assert.equal(f.writes(), 0);
  f = fixture({ validation: { 'alias@mail.com': 'TOP_PRIMARY_LIMIT' } }); assert.equal((await f.c.addAlias('alias@mail.com')).accountFull, true); assert.equal(f.writes(), 0);
  f = fixture({ status: 422, body: { title: 'Maximum number of email addresses created' } }); assert.equal((await f.c.addAlias('alias@mail.com')).accountFull, true); assert.equal(f.writes(), 1);
  f = fixture({ status: 429 }); await assert.rejects(f.c.addAlias('alias@mail.com'), /giới hạn/); assert.equal(f.writes(), 1);
  f = fixture(); assert.equal((await f.c.addAlias('alias@example.com')).status, 'failed'); assert.equal(f.writes(), 0);
  f = fixture(); f.c.cancel(); await assert.rejects(f.c.addAlias('alias@mail.com'), e => e.code === 'CANCELLED');
  let aliasPresent = true, deletes = 0;
  const removing = new MailComAliasClient(() => {}, { proxy: 'http://127.0.0.1:8080', pause: async () => {}, request: async config => {
    if (config.url === LIST) return response({ mailaddresslist: [main, ...(aliasPresent ? [{ address: 'alias@mail.com', deletable: true }] : [])] });
    if (config.url === `${ADDRESS_REMOVALS}/alias%40mail.com/removals?absoluteURI=false`) {
      deletes++;
      assert.equal(config.method, 'POST');
      assert.equal(config.data, undefined);
      assert.equal(config.headers['Content-Type'], 'text/plain;charset=UTF-8');
      assert.equal(config.headers.Accept, 'text/plain;charset=UTF-8');
      aliasPresent = false; return response('', 204);
    }
    throw new Error('unexpected remove request');
  } });
  removing.token = 'test'; removing.mainEmail = main.address;
  assert.equal((await removing.removeAlias('alias@mail.com')).status, 'removed'); assert.equal(deletes, 1);
  assert.equal((await removing.removeAlias('alias@mail.com')).status, 'absent'); assert.equal(deletes, 1);
  await assert.rejects(removing.removeAlias(main.address), /mail chính/);
  let requests = 0;
  const blocked = new MailComAliasClient(() => {}, { proxy: 'http://127.0.0.1:8080', request: async () => { requests++; return response('', 302, { location: 'https://evil.example/' }); } });
  await assert.rejects(blocked.http(HOME), /chuyển hướng/); assert.equal(requests, 1);
  const redirect = new MailComAliasClient(() => {}, { proxy: 'http://127.0.0.1:8080', request: async () => response('', 307, { location: 'https://other.mail.com/' }) });
  await assert.rejects(redirect.http(LOGIN, { method: 'POST', data: 'password=secret' }), /Không chuyển tiếp/);
  console.log('Alias API tests passed: login, cookies, create/delete alias, cancellation, reconciliation, redirects');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
