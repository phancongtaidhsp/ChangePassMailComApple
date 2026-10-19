const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AliasBatch, loadPlan } = require('../src/alias-batch');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-mode-'));
  try {
    const retryFile = path.join(root, 'fail.txt'), proxyFile = path.join(root, 'proxy.txt');
    fs.writeFileSync(proxyFile, '127.0.0.1:8080:user:proxy-secret\n');
    const options = { mode: 'retry', retryFile, proxyFile, outputRoot: root, concurrency: 2 };
    const rows = [
      ['main0@mail.com', ' secret0|pipe ', 'existing0@mail.com'],
      ['main1@mail.com', 'secret1', 'existing1@mail.com'],
      ['main0@mail.com', ' secret0|pipe ', 'missing0@mail.com'],
      ['main1@mail.com', 'secret1', 'send-fail1@mail.com'],
      ['main0@mail.com', ' secret0|pipe ', 'quota0@mail.com'],
      ['main0@mail.com', ' secret0|pipe ', 'after-quota0@mail.com'],
      ['main1@mail.com', 'secret1', 'inbox-fail1@mail.com'],
      ['main0@mail.com', ' secret0|pipe ', 'race0@mail.com'],
      ['main0@mail.com', ' secret0|pipe ', 'uncertain0@mail.com'],
      ['main0@mail.com', ' secret0|pipe ', 'cleanup-fail0@mail.com'],
      ['main1@mail.com', 'secret1', 'pw-fail1@mail.com'],
      ['bad@mail.com', 'bad-secret', 'login-fail@mail.com']
    ];
    const original = '\uFEFF' + [...rows, rows[0], ['main1@mail.com', 'secret1', 'existing0@mail.com'],
      ['main1@mail.com', 'secret1', '']].map(row => row.join('|') + '|send_mail_failed\r\n').join('');
    fs.writeFileSync(retryFile, original);
    const plan = loadPlan(options);
    assert.equal(plan.mode, 'retry'); assert.equal(plan.jobs.length, rows.length);
    assert.equal(plan.duplicates, 2); assert.equal(plan.skippedRecords, 1);
    assert.equal(plan.accounts[0].password, ' secret0|pipe ');
    const expectedOwners = new Map(rows.map(([main, , alias]) => [alias, main]));
    const logins = [], checked = [], adds = [], cleanups = [], dispatch = new Map(), updates = [];
    const active = new Set(); let peak = 0, cancels = 0;
    const owned = new Set(['existing0@mail.com', 'existing1@mail.com', 'after-quota0@mail.com']);
    const batch = new AliasBatch(options, {
      sendMail: async (alias, proxy) => {
        assert.equal(proxy, '127.0.0.1:8080:user:proxy-secret');
        return alias.startsWith('send-fail') ? 'failed' : 'successfully';
      },
      generatePassword: () => 'new-password',
      changePassword: async (_password, url) => new URL(url).searchParams.get('key').startsWith('pw-fail') ? 'failed' : 'successfully',
      createClient: () => {
        let main, busyAlias;
        return {
          login: async account => {
            main = account.email; assert(!active.has(main)); active.add(main); logins.push(main);
            assert.equal(account.password, rows.find(row => row[0] === main)[1]); peak = Math.max(peak, active.size);
            await new Promise(resolve => setTimeout(resolve, 1));
            if (main === 'bad@mail.com') throw Object.assign(new Error(), { safeMessage: 'Cần xác minh SMS.' });
          },
          listAddresses: async () => {
            assert.equal(busyAlias, undefined, 'Previous alias must be finalized before checking another');
            checked.push(main);
            return [...owned].filter(alias => expectedOwners.get(alias) === main).map(address => ({ address }));
          },
          addAlias: async alias => {
            assert.equal(expectedOwners.get(alias), main); assert(!owned.has(alias)); adds.push(alias);
            if (alias === 'quota0@mail.com') return { status: 'failed', accountFull: true, message: 'Maximum number of email addresses created' };
            owned.add(alias);
            if (alias === 'uncertain0@mail.com') throw Object.assign(new Error(), { aliasSubmitted: true, safeMessage: 'Kết quả thêm chưa xác định.' });
            return { status: alias === 'race0@mail.com' ? 'existing' : 'added' };
          },
          waitForAppleVerification: async ({ recipient }) => {
            assert.equal(expectedOwners.get(recipient), main);
            assert(!dispatch.has(recipient)); dispatch.set(recipient, main); busyAlias = recipient;
            if (recipient.startsWith('inbox-fail')) throw Object.assign(new Error(), { safeMessage: 'Inbox lỗi.' });
            return { status: 'found', link: `https://iforgot.apple.com/verify/email?key=${encodeURIComponent(recipient)}` };
          },
          removeAlias: async alias => {
            assert.equal(expectedOwners.get(alias), main); cleanups.push(alias); busyAlias = undefined;
            if (alias.startsWith('cleanup-fail')) throw Object.assign(new Error(), { safeMessage: 'Xóa lỗi.' });
            owned.delete(alias); return { status: 'removed' };
          },
          cancel() { cancels++; }, close: async () => { active.delete(main); }
        };
      }, onUpdate: update => updates.push(update)
    });
    batch.wait = async () => {};
    await batch.run();
    assert.equal(batch.state, 'completed'); assert.equal(cancels, 0); assert.equal(active.size, 0); assert.equal(peak, 2);
    assert.equal(logins.length, 3); assert.equal(new Set(logins).size, 3);
    assert.equal(batch.snapshot().remainingAliases, 1); assert.equal(batch.snapshot().loginFailed, 1);
    assert.equal(batch.snapshot().finalSuccess, 6); assert.equal(batch.snapshot().finalFailed, 5);
    assert.equal(batch.pendingInbox.size, 0); assert.equal(batch.assignments.size, 0);
    for (const alias of ['existing0@mail.com', 'existing1@mail.com', 'after-quota0@mail.com']) assert(!adds.includes(alias));
    assert(dispatch.has('after-quota0@mail.com'), 'Quota failure must not skip an existing alias on the same main');
    assert(dispatch.has('race0@mail.com'), 'An existing outcome from addAlias must also continue');
    assert.equal(new Set(cleanups).size, 10); assert.equal(cleanups.length, 10);
    assert(!cleanups.includes('quota0@mail.com')); assert(!cleanups.includes('login-fail@mail.com'));
    const results = [...batch.results.values()];
    for (const result of results) assert.equal(result.mainEmail, expectedOwners.get(result.alias));
    assert(results.find(result => result.alias === 'existing0@mail.com').aliasAlreadyPresent);
    assert.equal(fs.readFileSync(batch.mainFailFile, 'utf8'), 'bad@mail.com|main_login_failed\n');
    assert(fs.readFileSync(retryFile, 'utf8').startsWith(original), 'Reading/appending the same fail.txt must not consume appended records');
    const detail = fs.readFileSync(batch.resultFile, 'utf8');
    for (const secret of ['secret0', 'secret1', 'bad-secret', 'proxy-secret']) {
      assert(!detail.includes(secret)); assert(!JSON.stringify(updates).includes(secret));
    }
    assert.equal(fs.readFileSync(batch.successFile, 'utf8').trim().split('\n').length, 6);
    batch.exportInputFiles();
    const kept = fs.readFileSync(retryFile, 'utf8');
    assert(kept.includes('send-fail1@mail.com')); assert(kept.includes('inbox-fail1@mail.com')); assert(kept.includes('pw-fail1@mail.com'));
    assert(!kept.includes('existing0@mail.com')); assert(!kept.includes('quota0@mail.com')); assert(!kept.includes('login-fail@mail.com'));

    // Invalid records and inconsistent credentials fail before any API/output mutation.
    for (const value of ['main@mail.com|alias@mail.com|unable_add_alias', 'main@mail.com|pw|invalid|error',
      'main@mail.com|pw|alias@mail.com|error\nmain@mail.com|different|alias2@mail.com|error']) {
      fs.writeFileSync(retryFile, value);
      assert.throws(() => loadPlan(options));
    }
    fs.writeFileSync(retryFile, 'main@mail.com|pw||result_write_failed');
    assert.throws(() => loadPlan(options), /không có alias/);
    fs.writeFileSync(retryFile, 'main@mail.com|pw|alias@mail.com|error');
    const wrongFile = path.join(root, 'success.txt'); fs.writeFileSync(wrongFile, fs.readFileSync(retryFile));
    assert.throws(() => new AliasBatch({ ...options, retryFile: wrongFile }), /trùng đầu vào/);

    // Graceful pause keeps each current record on its original main and takes no new records.
    const pauseFile = path.join(root, 'pause-input.txt');
    fs.writeFileSync(pauseFile, [0, 1, 2, 3].map(i => `main${i % 2}@mail.com|pw|pause${i}@mail.com|error`).join('\n'));
    let pauseBatch, arrivals = 0, release, cleaned = 0;
    const gate = new Promise(resolve => { release = resolve; });
    pauseBatch = new AliasBatch({ ...options, retryFile: pauseFile, outputRoot: path.join(root, 'pause-output') }, {
      sendMail: async () => {
        if (++arrivals === 2) { pauseBatch.pause(); release(); }
        await gate; return 'successfully';
      }, generatePassword: () => 'new-password', changePassword: async () => 'successfully',
      createClient: () => ({ login: async () => {}, close: async () => {},
        listAddresses: async () => [0, 1, 2, 3].map(i => ({ address: `pause${i}@mail.com` })),
        addAlias: async () => { throw new Error('Must not add existing aliases'); },
        waitForAppleVerification: async () => ({ status: 'found', link: 'https://iforgot.apple.com/verify/email?key=fixture' }),
        removeAlias: async () => { cleaned++; return { status: 'removed' }; }, cancel() { throw new Error('Must not cancel'); }
      })
    });
    pauseBatch.wait = async () => {};
    await pauseBatch.run();
    assert.equal(pauseBatch.state, 'completed'); assert.equal(cleaned, 2);
    assert.equal(pauseBatch.snapshot().remainingAliases, 2); assert.equal(pauseBatch.snapshot().finalSuccess, 2);
    console.log('Retry mode tests passed: grouped sessions, fixed owners, existing/missing/raced aliases, quota, failures, same-file append, parsing and graceful stop');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
