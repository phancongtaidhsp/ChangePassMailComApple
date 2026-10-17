const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AliasBatch, loadPlan } = require('../src/alias-batch');
const { trusted } = require('../src/services/mailcom-alias');
const { requireProxy } = require('../src/services/required-proxy');
async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-test-'));
  try {
    const options = { proxyFile: path.join(root, 'proxy.txt'), emailFile: path.join(root, 'main.txt'), aliasFile: path.join(root, 'aliases.txt'), outputRoot: path.join(root, 'results'), concurrency: 1, delayMs: 1000 };
    fs.writeFileSync(options.proxyFile, '127.0.0.1:8080:user:private-proxy-password\n127.0.0.1:8081\n');
    fs.writeFileSync(options.emailFile, 'first@mail.com| secret|value \nsecond@mail.com|other-secret\n');
    fs.writeFileSync(options.aliasFile, 'one@mail.com\none@mail.com\ntwo@mail.com\n');
    assert.throws(() => new AliasBatch({ ...options, proxyFile: '' }), /proxy/);
    const plan = loadPlan(options);
    assert.equal(plan.accounts[0].password, ' secret|value ');
    assert.deepEqual(plan.jobs.map(x => x.accountIndex), [0, 1]);
    assert.equal(plan.duplicates, 1);
    for (const concurrency of [0, 201, 1.5, 'abc']) assert.throws(() => new AliasBatch({ ...options, concurrency }), /Số luồng/);
    assert(trusted('https://navigator-lxa.mail.com/mail_settings'));
    assert(!trusted('https://mail.com.attacker.example/'));
    assert(!trusted('http://mail.com/'));
    const sessions = [];
    const makeClient = (_report, proxy) => {
      if (proxy !== undefined) assert(proxy.startsWith('http://'));
      return ({ login: async account => sessions.push(account.email), cancel() {}, close: async () => {}, listAddresses: async () => [], removeAlias: async () => ({ status: 'removed' }),
      addAlias: async alias => ({ status: alias.startsWith('one') ? 'added' : 'existing', message: 'verified' }) }); };
    let batch, pauseOnce = true;
    batch = new AliasBatch(options, { createClient: makeClient, onUpdate: snapshot => { if (pauseOnce && snapshot.result && snapshot.completed === 1 && snapshot.existing === 0) { pauseOnce = false; batch.pause(); } } });
    await batch.run(); assert.equal(batch.state, 'completed'); assert.equal(batch.results.size, 1);
    assert.equal(batch.pendingInbox.size, 0); assert.equal(batch.snapshot().finalFailed, 1);
    assert.equal(batch.snapshot().remainingAliases, 1);
    await assert.rejects(batch.run(), /lượt mới/);
    assert.deepEqual(sessions, ['first@mail.com']);
    const output = fs.readFileSync(batch.resultFile, 'utf8');
    assert(!output.includes('secret')); assert(!output.includes('private-proxy-password'));
    assert.equal(output.trim().split('\n').map(JSON.parse).filter(row => !row.event).length, 1);
    assert.equal(fs.readFileSync(options.aliasFile, 'utf8'), 'one@mail.com\none@mail.com\ntwo@mail.com\n');
    const pending = new AliasBatch({ ...options, outputRoot: path.join(root, 'add-errors') }, { createClient: () => ({ ...makeClient(), addAlias: async () => { const e = new Error('private detail'); e.code = 'NEEDS_ATTENTION'; e.safeMessage = 'needs verification'; throw e; } }) });
    await pending.run(); assert.equal(pending.state, 'completed'); assert.equal(pending.results.size, 2);
    assert.equal(pending.snapshot().attention, 0);
    assert.equal(pending.latest.get(0).status, 'failed');
    assert.equal(pending.latest.get(0).mainEmail, 'first@mail.com');
    const attempts = fs.readFileSync(pending.resultFile, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(attempts[attempts.length - 1].status, 'failed');
    assert(!JSON.stringify(attempts).includes('private detail'));
    assert.equal(pending.state, 'completed'); assert.equal(pending.snapshot().attention, 0);
    assert.equal(pending.latest.size, 2); assert.equal(pending.results.size, 2);
    // Requested workers are capped at the number of available main accounts.
    const mains = Array.from({ length: 6 }, (_, i) => `main${i}@mail.com|password`);
    const aliases = Array.from({ length: 6 }, (_, i) => `alias${i}@mail.com`);
    fs.writeFileSync(options.emailFile, mains.join('\n'));
    fs.writeFileSync(options.aliasFile, aliases.join('\n'));
    let active = 0, peak = 0, closed = 0;
    const pairs = [];
    const parallel = new AliasBatch({ ...options, concurrency: 50 }, { createClient: () => {
      let main;
      return { login: async account => { main = account.email; peak = Math.max(peak, ++active); },
        addAlias: async alias => { pairs.push([main, alias]);
          await new Promise(resolve => setTimeout(resolve, 15)); return { status: 'added', message: 'verified' }; },
        removeAlias: async () => ({ status: 'removed' }), cancel() {}, close: async () => { active--; closed++; } };
    } });
    await parallel.run();
    assert.equal(parallel.state, 'completed'); assert.equal(peak, 6); assert.equal(active, 0); assert.equal(closed, 6);
    assert.deepEqual(pairs.map(([, alias]) => alias), aliases);
    assert.equal(new Set(pairs.map(([main]) => main)).size, 6);
    // 10 workers: one account/session per worker, sequential followups within
    // that session, rollover only on quota, no alias dispatched a second time.
    const manyMains = Array.from({ length: 12 }, (_, i) => `main${i}@mail.com|password`);
    const manyAliases = Array.from({ length: 45 }, (_, i) => `unique${i}@mail.com`);
    fs.writeFileSync(options.emailFile, manyMains.join('\n'));
    fs.writeFileSync(options.aliasFile, [...manyAliases, manyAliases[0].toUpperCase()].join('\n'));
    const logins = new Map(), seenAliases = new Set(), activeAccounts = new Set();
    let quotaPeak = 0, quotaClosed = 0, cleaned = 0;
    const multi = new AliasBatch({ ...options, concurrency: 10 }, {
      sendMail: async () => 'successfully',
      changePassword: async () => 'successfully',
      createClient: () => {
        let main, used = 0, busyAlias;
        return {
          login: async account => {
            main = account.email; assert(!activeAccounts.has(main)); activeAccounts.add(main);
            logins.set(main, (logins.get(main) || 0) + 1);
            quotaPeak = Math.max(quotaPeak, activeAccounts.size);
          },
          addAlias: async alias => {
            assert.equal(busyAlias, undefined, 'Finish the previous alias before taking another');
            assert(!seenAliases.has(alias), 'An alias must only be dispatched once across all workers');
            seenAliases.add(alias);
            await new Promise(resolve => setTimeout(resolve, 3));
            if (++used > 2) return { status: 'failed', accountFull: true, message: 'Maximum number of email addresses created' };
            busyAlias = alias; return { status: 'added' };
          },
          waitForAppleVerification: async ({ recipient }) => {
            assert.equal(recipient, busyAlias);
            return { status: 'found', link: 'https://iforgot.apple.com/verify/email?key=fixture', messageId: recipient };
          },
          removeAlias: async alias => {
            assert.equal(alias, busyAlias); busyAlias = undefined; cleaned++;
            return { status: 'removed' };
          },
          cancel() {}, close: async () => { assert.equal(busyAlias, undefined); activeAccounts.delete(main); quotaClosed++; }
        };
      }
    });
    multi.wait = async () => {};
    await multi.run();
    assert.equal(multi.state, 'completed'); assert.equal(quotaPeak, 10); assert.equal(quotaClosed, 12);
    assert.equal(activeAccounts.size, 0); assert.equal(logins.size, 12);
    assert([...logins.values()].every(count => count === 1));
    assert.equal(seenAliases.size, 36); assert.equal(cleaned, 24);
    assert.equal(multi.snapshot().finalSuccess, 24); assert.equal(multi.snapshot().finalFailed, 12);
    assert.equal(multi.snapshot().fullAccounts, 12); assert.equal(multi.snapshot().total, 45);
    assert.equal(multi.snapshot().remainingAliases, 9); assert.equal(multi.duplicates, 1);
    assert.equal(multi.assignments.size, 0); assert.equal(multi.pendingInbox.size, 0);
    // A cleanup failure must finish that alias and leave both workers running.
    fs.writeFileSync(options.emailFile, manyMains.slice(0, 2).join('\n'));
    fs.writeFileSync(options.aliasFile, manyAliases.slice(0, 6).join('\n'));
    const owners = new Map(), cleanupAttempts = new Map(), independentLogins = [];
    let independentCancels = 0;
    const independentStates = [];
    const independent = new AliasBatch({ ...options, concurrency: 2, outputRoot: path.join(root, 'independent') }, {
      sendMail: async () => false,
      createClient: () => {
        let main;
        return {
          login: async account => { main = account.email; independentLogins.push(main); },
          addAlias: async alias => {
            assert(!owners.has(alias)); owners.set(alias, main);
            await new Promise(resolve => setTimeout(resolve, 5));
            return { status: 'added' };
          },
          removeAlias: async alias => {
            cleanupAttempts.set(alias, (cleanupAttempts.get(alias) || 0) + 1);
            if (alias === manyAliases[0]) throw Object.assign(new Error('private cleanup error'), { code: 'NEEDS_ATTENTION', safeMessage: 'Không xóa được alias thử nghiệm.' });
            return { status: 'removed' };
          },
          cancel: () => { independentCancels++; }, close: async () => {}
        };
      },
      onUpdate: update => independentStates.push(update.state)
    });
    independent.wait = async () => {};
    await independent.run();
    assert.equal(independent.state, 'completed'); assert.equal(independentCancels, 0);
    assert.equal(independentLogins.length, 2); assert.equal(new Set(independentLogins).size, 2);
    assert.equal(owners.size, 6); assert([...cleanupAttempts.values()].every(count => count === 1));
    assert([...owners.values()].filter(main => main === owners.get(manyAliases[0])).length > 1, 'The worker with failed cleanup must take another alias on the same account');
    assert(!independentStates.some(state => ['pausing', 'paused', 'error'].includes(state)));
    assert.equal(independent.pendingInbox.size, 0); assert.equal(independent.snapshot().finalFailed, 6);
    const independentFailures = fs.readFileSync(independent.failFile, 'utf8').trim().split('\n');
    assert.equal(independentFailures.length, 7);
    assert(independentFailures.includes(`${owners.get(manyAliases[0])}|${manyAliases[0]}|alias_cleanup_failed`));
    fs.writeFileSync(options.emailFile, mains.join('\n'));
    fs.writeFileSync(options.aliasFile, aliases.join('\n'));
    // Pausing finishes current aliases without cancelling sessions or claiming new jobs.
    let cancelled = 0, settled = 0;
    const pausing = new AliasBatch({ ...options, concurrency: 2 }, { createClient: () => ({
      login: async () => {}, addAlias: async () => { await new Promise(resolve => setTimeout(resolve, 20)); settled++; return { status: 'added', message: 'verified' }; },
      removeAlias: async () => ({ status: 'removed' }), cancel: () => { cancelled++; }, close: async () => {},
    }), onUpdate: snapshot => { if (snapshot.result && snapshot.completed === 1) pausing.pause(); } });
    await pausing.run();
    assert.equal(pausing.state, 'completed'); assert.equal(cancelled, 0); assert.equal(settled, 2); assert.equal(pausing.results.size, 2);
    assert.equal(pausing.pendingInbox.size, 0); assert.equal(pausing.snapshot().finalFailed, 2);
    // A session error holds only that account; other workers drain the queue.
    let sessionErrorCancels = 0;
    const failing = new AliasBatch({ ...options, concurrency: 2 }, { createClient: () => {
      let main;
      return { login: async account => { main = account.email; }, cancel() { sessionErrorCancels++; }, close: async () => {}, removeAlias: async () => ({ status: 'removed' }),
        addAlias: async () => { await new Promise(resolve => setTimeout(resolve, 10));
          if (main === 'main0@mail.com') { const e = new Error('verification'); e.code = 'NEEDS_ATTENTION'; e.safeMessage = 'verify'; throw e; }
          return { status: 'added', message: 'verified' }; } };
    } });
    await failing.run(); assert.equal(failing.state, 'completed'); assert.equal(failing.results.size, 6);
    assert.equal(sessionErrorCancels, 0); assert.equal(failing.snapshot().remainingAliases, 0);
    assert.equal(failing.snapshot().accountsNeedingAttention, 1);
    fs.writeFileSync(options.emailFile, 'first@mail.com|secret\nsecond@mail.com|secret\n');
    fs.writeFileSync(options.aliasFile, 'one@mail.com\ntwo@mail.com\nthree@mail.com\n');
    assert.equal(loadPlan(options).jobs.length, 3);
    const tried = [], sends = [], sessionProxies = new Map(), notifications = []; 
    const replacement = new AliasBatch(options, {
      sendMail: async (email, proxy) => { sends.push([email, proxy]); return 'successfully'; },
      onUpdate: update => notifications.push(update.message),
      createClient: (_report, proxy) => {
      let main;
      return { login: async account => { main = account.email; sessionProxies.set(main, proxy); }, cancel() {}, close: async () => {},
        removeAlias: async () => ({ status: 'removed' }),
        waitForAppleVerification: async () => ({ status: 'not_found' }),
        addAlias: async alias => { tried.push([main, alias]); return alias === 'one@mail.com'
          ? { status: 'failed', httpStatus: 412, message: 'HTTP 412' }
          : { status: 'added', message: 'verified' }; } };
    } });
    await replacement.run();
    assert.deepEqual(tried, [['first@mail.com', 'one@mail.com'], ['first@mail.com', 'two@mail.com'], ['first@mail.com', 'three@mail.com']]);
    assert.equal(sends.filter(([email, proxy]) => email === 'two@mail.com' && requireProxy(proxy) === sessionProxies.get('first@mail.com')).length, 2);
    assert.equal(sends.filter(([email, proxy]) => email === 'three@mail.com' && requireProxy(proxy) === sessionProxies.get('first@mail.com')).length, 2);
    assert(sends.every(([, proxy]) => proxy === '127.0.0.1:8080:user:private-proxy-password'));
    assert(notifications.some(message => message.includes('Gửi thư lần 1/2 thành công')));
    assert.equal(replacement.snapshot().completed, 2); assert.equal(replacement.snapshot().failed, 1);
    assert.equal(replacement.latest.get(0).httpStatus, 412);
    assert.match(replacement.latest.get(0).message, /Không thể add mail phụ/);
    const resumedPairs = [], resumedProxies = [];
    let stopOnce = true;
    const reserved = new AliasBatch({ ...options, concurrency: 2 }, { createClient: (_report, proxy) => {
      let main;
      return { login: async account => { main = account.email; }, close: async () => {}, cancel() {}, listAddresses: async () => [{ address: 'two@mail.com' }], removeAlias: async () => ({ status: 'removed' }),
        addAlias: async alias => {
          resumedPairs.push([main, alias]); resumedProxies.push([main, proxy]);
          if (alias === 'two@mail.com' && stopOnce) {
            stopOnce = false;
            const error = new Error('unknown'); error.code = 'NEEDS_ATTENTION'; throw error;
          }
          return { status: alias === 'one@mail.com' ? 'failed' : 'added', message: 'fixture' };
        } };
    } });
    await reserved.run(); assert.equal(reserved.state, 'completed');
    assert.equal(reserved.snapshot().completed, 1);
    const accountProxyHistory = resumedProxies.filter(([main]) => main === 'second@mail.com').map(([, proxy]) => proxy);
    assert.equal(accountProxyHistory.length, 1);
    assert.deepEqual(resumedPairs.filter(pair => pair[1] === 'two@mail.com'),
      [['second@mail.com', 'two@mail.com']]);
    fs.writeFileSync(options.aliasFile, 'one@mail.com');
    const rejected = new AliasBatch(options, { createClient: () => ({ login: async () => {}, close: async () => {}, cancel() {},
      addAlias: async () => ({ status: 'failed', message: 'HTTP 412' }) }) });
    await rejected.run();
    assert.equal(rejected.state, 'completed'); assert.equal(rejected.snapshot().completed, 0);
    assert.equal(rejected.snapshot().failed, 1); assert.match(rejected.message, /Đã hết mail phụ/);
    fs.writeFileSync(options.aliasFile, 'first@mail.com\n'); assert.throws(() => loadPlan(options), /trùng/);
    fs.writeFileSync(options.emailFile, 'first@mail.com\n'); assert.throws(() => loadPlan(options), /email\|password/);
    console.log('Alias batch tests passed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
