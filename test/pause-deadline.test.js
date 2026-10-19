const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { legacyRequest, withDeadline } = require('../src/services/request-deadline');
const { MailComAliasClient, HOME, LIST, ADDRESS_REMOVALS } = require('../src/services/mailcom-alias');
const { AliasBatch } = require('../src/alias-batch');

async function testDeadlines() {
  let cancelled = false;
  await assert.rejects(legacyRequest({ request: config => {
    assert.equal(config.timeout, 15);
    config.cancelToken.promise.then(() => { cancelled = true; });
    // Simulate receiving headers and then waiting forever for the remaining body.
    return new Promise(() => {});
  } }, { timeout: 15 }), error => error.code === 'ECONNABORTED');
  assert.equal(cancelled, true);
  let completeLate, advanced = 0;
  const late = legacyRequest({ request: () => new Promise(resolve => { completeLate = resolve; }) }, { timeout: 15 });
  late.then(() => { advanced++; }, () => {});
  await assert.rejects(late, error => error.code === 'ECONNABORTED');
  completeLate('late response'); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(advanced, 0, 'A late response must not resume a timed-out workflow');
  let token;
  assert.equal(await legacyRequest({ request: config => { token = config.cancelToken; return Promise.resolve('done'); } }, { timeout: 15 }), 'done');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(token.reason, undefined, 'Completed request must not keep its cancellation timer');
  const controller = new AbortController(); controller.abort();
  let started = 0;
  await assert.rejects(withDeadline(() => { started++; }, { timeout: 15, signal: controller.signal, cancel() {} }), error => error.code === 'ERR_CANCELED');
  assert.equal(started, 0);
  await assert.rejects(withDeadline(() => new Promise(() => {}), { timeout: 15,
    cancel() { throw new Error('adapter cancellation failed'); } }), error => error.code === 'ECONNABORTED');
  const client = new MailComAliasClient(() => {}, { proxy: '127.0.0.1:8080', request: () => new Promise(() => {}) });
  // Even an adapter which fails to reject after abort must release the worker.
  await assert.rejects(client.http(HOME, { timeout: 15 }), error => error.retryable === true);
  let destroyed = false;
  client.jar.removeAllCookiesSync = () => { throw new Error('cookie store failed'); };
  client.agent.destroy = () => { destroyed = true; };
  await assert.rejects(client.close());
  assert.equal(destroyed, true); assert.equal(client.controller.signal.aborted, true);

  // Worst cleanup path: 3 initial reads + 3 POSTs + 2 reconciliation reads +
  // 3 confirmation reads, each bounded at 20s, and six waits of 2s = 232s.
  let posts = 0, initialReads = 0;
  const timeouts = [], waits = [];
  const cleanup = new MailComAliasClient(() => {}, { proxy: '127.0.0.1:8080',
    pause: async ms => waits.push(ms), request: async config => {
      timeouts.push(config.timeout);
      if (config.method === 'POST') { posts++; throw new Error('request timed out'); }
      if (!posts && ++initialReads < 3 || posts === 3) throw new Error('request timed out');
      return { status: 200, headers: {}, data: { mailaddresslist: [{ address: 'main@mail.com' },
        { address: 'alias@mail.com', deletable: true }] } };
    } });
  cleanup.mainEmail = 'main@mail.com'; cleanup.token = 'fixture';
  await assert.rejects(cleanup.removeAlias('alias@mail.com'));
  assert.equal(posts, 3); assert.equal(timeouts.length, 11);
  assert.equal(timeouts.reduce((a, b) => a + b, 0) + waits.reduce((a, b) => a + b, 0), 232000);
  await cleanup.close();
}

async function testCleanupPause(root) {
  const options = { emailFile: path.join(root, 'main.txt'), aliasFile: path.join(root, 'aliases.txt'),
    proxyFile: path.join(root, 'proxy.txt'), concurrency: 2 };
  fs.writeFileSync(options.emailFile, 'main0@mail.com|secret\nmain1@mail.com|secret\nmain2@mail.com|secret');
  fs.writeFileSync(options.proxyFile, '127.0.0.1:8080');
  for (const stage of ['before-delete', 'delete', 'reconcile', 'confirm', 'logout']) {
    fs.writeFileSync(options.aliasFile, 'alias0@mail.com\nalias1@mail.com' + (stage === 'logout' ? '' : '\nalias2@mail.com\nalias3@mail.com'));
    let batch, arrivals = 0, logins = 0, closed = 0;
    const clients = [];
    batch = new AliasBatch({ ...options, outputRoot: path.join(root, stage) }, {
      sendMail: async () => 'successfully', changePassword: async () => 'successfully', generatePassword: () => 'new-secret',
      createClient: report => {
        let main, alias, deletes = 0, removed = false, reached = false;
        const hang = () => {
          if (!reached) { reached = true; if (++arrivals === 2) batch.pause(); }
          return new Promise(() => {});
        };
        const client = new MailComAliasClient(report, { proxy: '127.0.0.1:8080', pause: async () => {},
          request: config => {
            if (config.url === HOME) return stage === 'logout' ? hang() : Promise.resolve({ status: 204, headers: {} });
            if (config.url === LIST) {
              if (stage === 'before-delete' || deletes && ['reconcile', 'confirm'].includes(stage)) return hang();
              return Promise.resolve({ status: 200, headers: {}, data: { mailaddresslist: [{ address: main },
                ...(removed ? [] : [{ address: alias, deletable: true }])] } });
            }
            assert(config.url.startsWith(ADDRESS_REMOVALS)); deletes++;
            if (stage === 'delete') return hang();
            if (stage === 'reconcile') return Promise.resolve({ status: 503, headers: {} });
            removed = true; return Promise.resolve({ status: 204, headers: {} });
          }
        });
        clients.push(client);
        const http = client.http.bind(client), close = client.close.bind(client);
        // Only the test clock is shortened; exercise the actual removal/retry/close logic.
        client.http = (url, config) => http(url, { ...config, timeout: 15 });
        client.login = async account => { logins++; main = account.email; client.mainEmail = main; client.token = 'fixture'; client.logoutUrl = HOME; };
        client.addAlias = async value => { alias = value; return { status: 'added' }; };
        client.waitForAppleVerification = async () => ({ status: 'found', link: 'https://iforgot.apple.com/verify/email?key=fixture' });
        client.close = async () => { try { await close(); } finally { closed++; } };
        return client;
      }
    });
    batch.wait = async () => {};
    let guard;
    try {
      await Promise.race([batch.run(), new Promise((_, reject) => {
        guard = setTimeout(() => reject(new Error(`Pause stayed pending during ${stage}`)), 2000);
      })]);
    } finally { clearTimeout(guard); }
    assert.equal(batch.state, 'completed', stage); assert.equal(arrivals, 2, stage);
    assert.equal(logins, 2); assert.equal(closed, 2); assert.equal(batch.nextAlias, 2);
    assert.equal(batch.pendingInbox.size, 0); assert.equal(batch.clients.size, 0);
    assert.equal(batch.snapshot().finalSuccess, 2, 'Cleanup failure must preserve a successful password result');
    assert(clients.every(client => client.controller.signal.aborted));
    assert([...batch.results.values()].every(record => record.cleanupStatus === (stage === 'logout' ? 'removed' : 'error')));
    const fails = fs.readFileSync(batch.failFile, 'utf8');
    assert.equal((fails.match(/alias_cleanup_failed/g) || []).length, stage === 'logout' ? 0 : 2);
  }
}
async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pause-deadline-'));
  try { await testDeadlines(); await testCleanupPause(root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
  console.log('Pause deadline tests passed: incomplete response body, stalled adapter, deletion/list/confirmation/logout and resource cleanup');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
