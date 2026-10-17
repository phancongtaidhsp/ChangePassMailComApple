const assert = require('node:assert/strict');
const { MailComAliasClient, HOME, LOGIN, TOKEN, LIST, DOMAINS, VALIDATE, ADDRESSES, ADDRESS_REMOVALS } = require('../src/services/mailcom-alias');

const main = { address: 'main@mail.com', defaultSenderAddress: true };
const alias = { address: 'alias@mail.com', deletable: true };
const response = (data, status = 200) => ({ data, status, headers: {} });
const addresses = present => response({ mailaddresslist: present ? [main, alias] : [main] });
const form = '<form action="https://login.mail.com/login" method="post"><input name="username"><input name="password"></form>';
const shell = '"mail_settings":{"url_map":{"default":"https://mailset-root.mail.com?navsid=fixture"}}';
const removalUrl = `${ADDRESS_REMOVALS}/alias%40mail.com/removals?absoluteURI=false`;

function fixture(handler) {
  const calls = [], waits = [];
  const client = new MailComAliasClient(() => {}, {
    proxy: 'http://127.0.0.1:8080', pause: async ms => { waits.push(ms); },
    request: async config => { calls.push(config); return handler(config); }
  });
  client.token = 'fixture-token'; client.mainEmail = main.address;
  return { client, calls, waits };
}

async function run() {
  let logins = 0, tokens = 0;
  let f = fixture(config => {
    if (config.url === HOME) return response(form);
    if (config.url === LOGIN) return ++logins < 3 ? response({}, 503) : response(shell);
    if (config.url.startsWith(TOKEN)) return ++tokens < 3 ? response({}, 502) : response({ access_token: 'fixture-token' });
    if (config.url === LIST) return addresses(false);
    throw new Error('Unexpected request');
  });
  await f.client.login({ email: main.address, password: 'fixture-password' });
  assert.equal(logins, 3); assert.equal(tokens, 3);
  assert.deepEqual(f.waits, [2000, 2000, 2000, 2000]);
  await f.client.close();

  // The login request never exceeds three calls when all attempts fail.
  f = fixture(config => config.url === HOME ? response(form) : response({}, 503));
  await assert.rejects(f.client.login({ email: main.address, password: 'fixture-password' }), error => error.httpStatus === 503);
  assert.equal(f.calls.filter(c => c.url === LOGIN).length, 3);
  assert.deepEqual(f.waits, [2000, 2000]); await f.client.close();

  // SMS verification and authentication errors are not transient request errors.
  f = fixture(config => config.url === HOME ? response(form) : response('<body>Verify your identity. Our security system has detected irregular login activity.</body>'));
  await assert.rejects(f.client.login({ email: main.address, password: 'fixture-password' }), /SMS/);
  assert.equal(f.calls.filter(c => c.url === LOGIN).length, 1);
  assert.deepEqual(f.waits, []); await f.client.close();
  for (const status of [401, 403, 407, 424]) {
    f = fixture(() => response({}, status));
    await assert.rejects(f.client.listAddresses());
    assert.equal(f.calls.length, 1); assert.deepEqual(f.waits, []); await f.client.close();
  }

  // Inbox OAuth uses the same bounded retry without repeating the login.
  tokens = 0;
  f = fixture(config => {
    assert(config.url.startsWith(TOKEN));
    assert.equal(new URLSearchParams(config.data).get('scope'), 'mail_mailbox_r');
    return ++tokens < 3 ? response({}, 503) : response({ access_token: 'fixture-inbox-token', expires_in: 3600 });
  });
  f.client.navsid = 'fixture';
  await f.client.mailbox().authenticate();
  assert.equal(tokens, 3); assert.deepEqual(f.waits, [2000, 2000]); await f.client.close();

  let reads = 0;
  f = fixture(() => { if (++reads < 3) throw new Error('private network failure'); return addresses(false); });
  assert.equal((await f.client.listAddresses()).length, 1);
  assert.equal(reads, 3); assert.deepEqual(f.waits, [2000, 2000]); await f.client.close();
  f = fixture(() => response({}, 503));
  await assert.rejects(f.client.listAddresses());
  assert.equal(f.calls.length, 3); assert.deepEqual(f.waits, [2000, 2000]); await f.client.close();

  // A pause during the retry delay must prevent the next request.
  f = fixture(() => response({}, 503));
  f.client.sleep = async () => f.client.cancel();
  await assert.rejects(f.client.listAddresses(), error => error.code === 'CANCELLED');
  assert.equal(f.calls.length, 1); await f.client.close();

  let domains = 0, validations = 0, creates = 0, confirmationReads = 0;
  f = fixture(config => {
    if (config.url === LIST) return addresses(creates > 0 && ++confirmationReads >= 3);
    if (config.url === DOMAINS) return ++domains < 3 ? response({}, 503) : response({ domains: [{ domain: 'mail.com' }] });
    if (config.url === VALIDATE) return ++validations < 3 ? response({}, 503) : response({});
    if (config.url === ADDRESSES) { creates++; return response('', 204); }
    throw new Error('Unexpected request');
  });
  assert.equal((await f.client.addAlias(alias.address)).status, 'added');
  assert.equal(domains, 3); assert.equal(validations, 3); assert.equal(creates, 1);
  assert.equal(confirmationReads, 3); assert.deepEqual(f.waits, Array(6).fill(2000));
  await f.client.close();

  // Failed confirmation reads have a total budget of three, never 3 x 3.
  creates = 0;
  f = fixture(config => {
    if (config.url === LIST) return creates ? response({}, 503) : addresses(false);
    if (config.url === DOMAINS) return response({ domains: [{ domain: 'mail.com' }] });
    if (config.url === VALIDATE) return response({});
    if (config.url === ADDRESSES) { creates++; throw new Error('private timeout'); }
    throw new Error('Unexpected request');
  });
  await assert.rejects(f.client.addAlias(alias.address), /Chưa xác nhận/);
  assert.equal(creates, 1); assert.equal(f.calls.filter(c => c.url === LIST).length, 4);
  assert.deepEqual(f.waits, [2000, 2000]); await f.client.close();

  for (const scenario of ['retry-success', 'timeout-already-removed', 'all-failed', 'permanent-error', 'still-visible', 'cancelled']) {
    let removes = 0, visible = true, afterSuccessReads = 0;
    f = fixture(config => {
      if (config.url === LIST) {
        if (scenario === 'retry-success' && removes === 3 && ++afterSuccessReads >= 3) visible = false;
        return addresses(visible);
      }
      assert.equal(config.url, removalUrl); assert.equal(config.method, 'POST');
      removes++;
      if (scenario === 'timeout-already-removed') { visible = false; throw new Error('private timeout'); }
      if (scenario === 'cancelled') { f.client.cancel(); throw new Error('private timeout'); }
      if (scenario === 'permanent-error') return response({}, 400);
      if (scenario === 'all-failed' || scenario === 'retry-success' && removes < 3) return response({}, 503);
      return response('', 204);
    });
    if (['retry-success', 'timeout-already-removed'].includes(scenario)) {
      assert.equal((await f.client.removeAlias(alias.address)).status, 'removed');
    } else await assert.rejects(f.client.removeAlias(alias.address));
    assert.equal(removes, ['retry-success', 'all-failed'].includes(scenario) ? 3 : 1);
    if (scenario === 'retry-success') {
      assert.equal(afterSuccessReads, 3);
      assert.equal(f.calls.filter(c => c.url === LIST).length, 6);
      assert.deepEqual(f.waits, [2000, 2000, 2000, 2000]);
    }
    if (scenario === 'timeout-already-removed') assert.deepEqual(f.waits, []);
    await f.client.close();
  }
  for (const status of [401, 403, 407, 424]) {
    for (const scenario of ['third-success', 'all-failed', 'read-denied', 'already-removed', 'protected']) {
      let removes = 0;
      f = fixture(config => {
        if (config.url === LIST) {
          if (removes && scenario === 'read-denied') return response({}, status);
          if (removes && scenario === 'protected') return response({ mailaddresslist: [main, { ...alias, defaultSenderAddress: true }] });
          return addresses(!(removes && scenario === 'already-removed') && !(removes === 3 && scenario === 'third-success'));
        }
        assert.equal(config.url, removalUrl); assert.equal(config.method, 'POST');
        removes++;
        return removes === 3 && scenario === 'third-success' ? response('', 204) : response({}, status);
      });
      if (['third-success', 'already-removed'].includes(scenario)) {
        assert.equal((await f.client.removeAlias(alias.address)).status, 'removed');
      } else await assert.rejects(f.client.removeAlias(alias.address));
      assert.equal(removes, ['already-removed', 'protected'].includes(scenario) ? 1 : 3);
      if (scenario === 'already-removed') assert.deepEqual(f.waits, []);
      if (['third-success', 'read-denied'].includes(scenario)) assert.deepEqual(f.waits, [2000, 2000]);
      if (scenario === 'all-failed') assert.deepEqual(f.waits, [2000, 2000, 2000, 2000]);
      await f.client.close();
    }
    // A POST timeout is still ambiguous: a denied reconciliation cannot justify another POST.
    let removes = 0;
    f = fixture(config => {
      if (config.url === LIST) return removes ? response({}, status) : addresses(true);
      removes++; throw new Error('private timeout');
    });
    await assert.rejects(f.client.removeAlias(alias.address));
    assert.equal(removes, 1); await f.client.close();
  }
  console.log('Request retry tests passed: three-call budgets, 2s confirmations, single create, deletion reconciliation and cancellation');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
