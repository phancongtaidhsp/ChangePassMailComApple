const assert = require('node:assert/strict');
const { MailComAliasClient } = require('../src/services/mailcom-alias');
const { isAppleMessage } = require('../src/services/mailcom-inbox');

const recipient = 'alias@mail.com';
const link = 'https://iforgot.apple.com/verify/email?key=fixture%2Bkey';
const message = (id, from = 'Apple <appleid@id.apple.com>', to = recipient, date = 1000) => ({
  attribute: { mailIdentifier: id, internalDate: date }, mailHeader: { from, to: [to], cc: [], bcc: [] }
});
function fixture({ pages, bodies = {}, textBodies = {}, malformed = false, mismatch = false, denied = false } = {}) {
  const calls = [];
  let rounds = 0;
  const client = new MailComAliasClient(() => {}, { proxy: 'http://127.0.0.1:8080', request: async config => {
    calls.push(config);
    assert.equal(config.proxy, false);
    assert.equal(config.httpsAgent, client.agent);
    assert.equal(config.maxRedirects, 0);
    const url = new URL(config.url);
    const response = (data, status = 200, headers = {}) => ({ status, data, headers });
    if (url.pathname.endsWith('/token')) {
      assert.equal(new URLSearchParams(config.data).get('scope'), 'mail_mailbox_r');
      assert.equal(url.searchParams.get('sid'), 'fixture-sid');
      return response({ access_token: 'inbox-token', expires_in: 3600 });
    }
    assert.equal(config.headers.Authorization, 'Bearer inbox-token');
    if (url.hostname === 'maillist.mail.com') {
      assert.equal(config.method, 'POST');
      assert.equal(url.searchParams.get('folderTypeOrId'), 'INBOX');
      assert.equal(url.searchParams.get('orderBy'), 'INTERNALDATE DESC');
      if (denied) return response({}, 401);
      if (malformed) return response({ unexpected: true });
      const offset = Number(url.searchParams.get('offset'));
      if (!offset) rounds++;
      const messages = pages ? pages(offset, rounds) : [message('one')];
      return response({ mailListElements: [{ type: 'ad', rawData: {} }, ...messages.map(rawData => ({ type: 'mail', rawData }))], totalCount: pages ? 51 : 1 });
    }
    if (url.pathname.includes('/mailheader/')) {
      const id = decodeURIComponent(url.pathname.split('/').pop());
      return response(message(mismatch ? 'different' : id));
    }
    if (url.pathname.includes('/mailbody/')) {
      const id = decodeURIComponent(url.pathname.split('/').slice(-2)[0]);
      if (config.headers.Accept === 'text/plain') {
        return response(textBodies[id] ?? 'No verification link in this message.', 200, { 'content-type': 'text/plain;charset=utf-8' });
      }
      return response(bodies[id] ?? `<a href="https://deref-gmx.com/r/#${link}">Verify</a>`, 200,
        { 'content-type': 'text/vnd.ui.secure-v3+html;charset=utf-8' });
    }
    throw new Error('Unexpected request');
  } });
  client.navsid = 'fixture-sid';
  return { client, calls };
}

async function run() {
  assert(isAppleMessage(message('a'), recipient));
  assert(isAppleMessage(message('a', 'APPLEID@ID.APPLE.COM', `Name <${recipient}>`), recipient));
  assert(!isAppleMessage(message('a', 'Apple <attacker@example.com>'), recipient));
  assert(!isAppleMessage(message('a', 'appleid@notapple.com'), recipient));
  assert(!isAppleMessage(message('a', 'appleid@apple.com.evil.example'), recipient));
  assert(!isAppleMessage(message('a', undefined, 'other@mail.com'), recipient));
  assert(!isAppleMessage(message('a'), recipient, 1001));
  let f = fixture();
  let result = await f.client.waitForAppleVerification({ recipient, attempts: 1 });
  assert.equal(result.status, 'found'); assert.equal(result.link, link);
  assert.equal(f.calls.filter(c => c.headers.Accept === 'text/plain').length, 0);
  assert.equal(f.calls.filter(c => c.url.includes('/token?')).length, 1);
  await f.client.close(); assert.equal(f.client.navsid, null); assert.equal(f.client.inbox.token, null);

  f = fixture({ pages: offset => offset === 0
    ? [message('wrong-target', undefined, 'other@mail.com'), message('old', undefined, recipient, 1), message('fake', 'Apple <x@evil.com>')]
    : [message('page-two')] });
  result = await f.client.waitForAppleVerification({ recipient, since: 500, attempts: 1 });
  assert.equal(result.messageId, 'page-two');
  assert.equal(f.calls.filter(c => c.url.includes('/mailheader/')).length, 1);
  await f.client.close();

  // HTML secure-v3 đã bỏ query `to`, nhưng bản text cùng mã thư giữ link gốc.
  f = fixture({ bodies: { one: '<a href="https://deref-gmx.com/r/">Verify</a>' },
    textBodies: { one: `Verify your account:\r\n${link}&language=US-EN\r\nApple` } });
  result = await f.client.waitForAppleVerification({ recipient, attempts: 1 });
  assert.equal(result.status, 'found'); assert.equal(result.link, `${link}&language=US-EN`);
  assert.equal(result.appleMessages, 1);
  assert.equal(f.calls.filter(c => c.headers.Accept === 'text/plain').length, 1);
  assert(!f.calls.some(c => new URL(c.url).hostname === 'iforgot.apple.com'));
  await f.client.close();

  f = fixture({ bodies: { one: 'A different Apple message without a verification link.' } });
  result = await f.client.waitForAppleVerification({ recipient, attempts: 2, intervalMs: 0 });
  assert.equal(result.status, 'not_found'); assert.equal(result.appleMessages, 1);
  assert.equal(f.calls.filter(c => c.url.includes('/mailbody/')).length, 2);
  await f.client.close();

  for (const config of [{ malformed: true }, { mismatch: true }, { denied: true }]) {
    f = fixture(config);
    await assert.rejects(f.client.waitForAppleVerification({ recipient, attempts: 1 }), e => e.code === 'NEEDS_ATTENTION');
    await f.client.close();
  }
  // Mặc định 5 lượt, nghỉ 2 giây; không chờ thêm sau khi tìm thấy hoặc hết lượt.
  for (const foundAt of [3, Infinity]) {
    f = fixture();
    let scans = 0;
    const waits = [];
    f.client.mailbox().listInbox = async () => ({ messages: ++scans === foundAt ? [message('one')] : [], totalCount: 1 });
    f.client.mailbox().wait = async ms => { waits.push(ms); };
    result = await f.client.waitForAppleVerification({ recipient });
    assert.equal(result.status, foundAt === 3 ? 'found' : 'not_found');
    assert.equal(scans, foundAt === 3 ? 3 : 5);
    assert.deepEqual(waits, Array(scans - 1).fill(2000));
    await f.client.close();
  }
  f = fixture();
  await assert.rejects(f.client.listInbox({ amount: 500 }), /Phân trang/);
  const waiting = f.client.mailbox().wait(60000);
  f.client.cancel();
  await assert.rejects(waiting, e => e.code === 'CANCELLED');
  await f.client.close();
  console.log('Inbox tests passed: API, pagination, recipient/sender/date filtering, body extraction, failures and cancellation');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
