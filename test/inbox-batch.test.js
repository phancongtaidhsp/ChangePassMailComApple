const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AliasBatch } = require('../src/alias-batch');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-batch-'));
  try {
    const options = { emailFile: path.join(root, 'main.txt'), aliasFile: path.join(root, 'alias.txt'),
      proxyFile: path.join(root, 'proxy.txt'), outputRoot: path.join(root, 'results'), delayMs: 1000 };
    fs.writeFileSync(options.emailFile, 'main@mail.com|secret\n');
    fs.writeFileSync(options.aliasFile, 'alias@mail.com\n');
    const rawProxy = '127.0.0.1:8080:fixture-user:fixture:password';
    fs.writeFileSync(options.proxyFile, `  ${rawProxy}  \n`);
    let adds = 0, sends = 0, reads = 0, removes = 0;
    const link = 'https://iforgot.apple.com/verify/email?key=fixture';
    const batch = new AliasBatch(options, {
      sendMail: async () => { sends++; return 'successfully'; },
      createClient: () => ({ login: async () => {}, close: async () => {}, cancel() {},
        addAlias: async () => { adds++; return { status: 'added', message: 'confirmed' }; },
        removeAlias: async () => { removes++; return { status: 'removed' }; },
        waitForAppleVerification: async ({ recipient, since }) => {
          reads++; assert.equal(recipient, 'alias@mail.com'); assert(since > 0);
          if (reads === 1) throw Object.assign(new Error('private response'), { code: 'NEEDS_ATTENTION', safeMessage: 'Inbox unavailable' });
          return { status: 'found', link, messageId: 'message' };
        }
      })
    });
    await batch.run(); assert.equal(batch.state, 'completed'); assert.equal(batch.pendingInbox.size, 0);
    assert.equal(adds, 1); assert.equal(sends, 1); assert.equal(reads, 1); assert.equal(removes, 1);
    assert.equal(batch.results.get(0).exportStatus, 'fail');
    const output = fs.readFileSync(batch.resultFile, 'utf8');
    assert(output.includes('Inbox unavailable')); assert(!output.includes('private response')); assert(!output.includes('secret'));
    for (const sent of [false, 'successfully']) {
      let checked = false, sendsForScenario = 0, removed = 0;
      const b = new AliasBatch(options, { sendMail: async () => { sendsForScenario++; return sent; }, createClient: () => ({
        login: async () => {}, close: async () => {}, cancel() {}, addAlias: async () => ({ status: 'added' }),
        removeAlias: async () => { removed++; return { status: 'removed' }; },
        waitForAppleVerification: async args => { checked = true; assert(args.since > 0); assert.equal(args.attempts, 5); return { status: 'not_found' }; }
      }) });
      b.wait = async () => {};
      await b.run(); assert.equal(checked, sent === 'successfully'); assert.equal(b.state, 'completed');
      assert.equal(sendsForScenario, 2);
      assert.equal(removed, 1);
    }
    for (const scenario of ['send-return-failed', 'send-throws', 'second-send-fails', 'inbox-terminal-error', 'generate-password-error']) {
      const events = [];
      let sends = 0, reads = 0;
      const b = new AliasBatch({ ...options, outputRoot: path.join(root, scenario) }, {
        sendMail: async () => {
          sends++; events.push('send');
          if (scenario === 'send-throws') throw new Error('private send detail');
          return (scenario === 'second-send-fails' ? sends === 1 : !scenario.startsWith('send-')) ? 'successfully' : 'failed';
        },
        generatePassword: () => { throw new Error('private generator detail'); },
        changePassword: async () => { throw new Error('Must not reach password change'); },
        createClient: () => ({ login: async () => {}, cancel() {}, close: async () => events.push('close'),
          addAlias: async () => { events.push('add'); return { status: 'added' }; },
          removeAlias: async alias => { assert.equal(alias, 'alias@mail.com'); events.push('remove'); return { status: 'removed' }; },
          waitForAppleVerification: async () => {
            reads++; events.push('read');
            if (scenario === 'inbox-terminal-error') throw new Error('private inbox detail');
            return scenario === 'generate-password-error' ? { status: 'found', link } : { status: 'not_found' };
          }
        }),
        onUpdate: update => { if (update.result?.exportStatus === 'fail') events.push('export'); }
      });
      b.wait = async () => {};
      await b.run();
      assert.equal(b.state, 'completed'); assert.equal(b.pendingInbox.size, 0);
      assert.equal(events.filter(x => x === 'remove').length, 1);
      assert(events.indexOf('remove') < events.indexOf('export'), 'Cleanup must happen before exporting failure');
      assert.equal(sends, scenario === 'second-send-fails' || scenario.startsWith('send-') ? 2 : 1);
      assert.equal(reads, scenario.startsWith('send-') ? 0 : 1);
      assert.equal(fs.readFileSync(b.successFile, 'utf8'), '');
      assert.match(fs.readFileSync(b.failFile, 'utf8'), /^main@mail\.com\|alias@mail\.com\|/);
      assert(!fs.readFileSync(b.resultFile, 'utf8').includes('private'));
    }
    // A failed first send must not export or clean up before the second attempt.
    for (const first of ['failed', 'throw']) {
      for (const found of [true, false]) {
        let sends = 0, reads = 0, removes = 0, changes = 0;
        const waits = [], snapshots = [];
        const b = new AliasBatch({ ...options, outputRoot: path.join(root, `retry-${first}-${found}`) }, {
          sendMail: async (alias, proxy) => {
            assert.equal(alias, 'alias@mail.com'); assert.equal(typeof proxy, 'string'); assert.equal(proxy, rawProxy);
            sends++;
            assert.equal(removes, 0); assert.equal(b.finalCounts.failed, 0);
            assert.equal(fs.readFileSync(b.failFile, 'utf8'), '');
            if (sends === 1) {
              if (first === 'throw') throw new Error('private send detail');
              return 'failed';
            }
            return 'successfully';
          },
          generatePassword: () => 'fixture-password',
          changePassword: async (password, url, proxy) => {
            changes++; assert.equal(password, 'fixture-password'); assert.equal(url, link);
            assert.equal(typeof proxy, 'string'); assert.equal(proxy, rawProxy);
            return changes === 1 ? 'failed' : 'successfully';
          },
          createClient: () => ({ login: async () => {}, close: async () => {}, cancel() {},
            addAlias: async () => ({ status: 'added' }),
            waitForAppleVerification: async ({ since, attempts }) => {
              reads++; assert.equal(sends, 2); assert(since > 0); assert.equal(attempts, 5);
              return found ? { status: 'found', link } : { status: 'not_found' };
            },
            removeAlias: async () => { removes++; assert.equal(reads, 1); return { status: 'removed' }; }
          }),
          onUpdate: update => { if (update.result) snapshots.push({ ...update.result }); }
        });
        b.wait = async ms => waits.push(ms);
        await b.run();
        assert.equal(sends, 2); assert.equal(reads, 1); assert.equal(removes, 1);
        assert.equal(changes, found ? 2 : 0); assert.deepEqual(waits, found ? [2000, 2000] : [2000]);
        const retry = snapshots.find(record => record.sendStatus === 'retrying');
        assert(retry); assert.equal(retry.exportStatus, undefined); assert.equal(retry.cleanupStatus, undefined);
        assert.equal(b.finalCounts.success, found ? 1 : 0); assert.equal(b.finalCounts.failed, found ? 0 : 1);
        assert.equal(fs.readFileSync(b.failFile, 'utf8').trim().split('\n').filter(Boolean).length, found ? 0 : 1);
      }
    }
    // Pausing while waiting for the retry preserves the second send for resume.
    let resumeSends = 0, resumeReads = 0, resumeRemoves = 0;
    const paused = new AliasBatch({ ...options, outputRoot: path.join(root, 'pause-send-retry') }, {
      sendMail: async () => ++resumeSends === 1 ? 'failed' : 'successfully',
      generatePassword: () => 'fixture-password', changePassword: async () => 'successfully',
      createClient: () => ({ login: async () => {}, close: async () => {}, cancel() {},
        addAlias: async () => ({ status: 'added' }),
        waitForAppleVerification: async () => { resumeReads++; return { status: 'found', link }; },
        removeAlias: async () => { resumeRemoves++; return { status: 'removed' }; }
      })
    });
    paused.wait = async () => { paused.pause(); };
    await paused.run();
    assert.equal(paused.state, 'paused'); assert.equal(resumeSends, 1); assert.equal(resumeRemoves, 0);
    assert.equal(fs.readFileSync(paused.failFile, 'utf8'), '');
    paused.wait = async () => {};
    await paused.run();
    assert.equal(paused.state, 'completed'); assert.equal(resumeSends, 2);
    assert.equal(resumeReads, 1); assert.equal(resumeRemoves, 1); assert.equal(paused.finalCounts.success, 1);
    // Failed cleanup exports the failure once and completes without a pause.
    let failedSendCalls = 0, failedSendAdds = 0, failedSendRemoves = 0;
    const cleanupOnly = new AliasBatch({ ...options, outputRoot: path.join(root, 'cleanup-only') }, {
      sendMail: async () => { failedSendCalls++; return false; },
      createClient: () => ({ login: async () => {}, cancel() {}, close: async () => {},
        addAlias: async () => { failedSendAdds++; return { status: 'added' }; },
        waitForAppleVerification: async () => { throw new Error('Must not read Inbox after failed send'); },
        removeAlias: async () => {
          failedSendRemoves++;
          if (failedSendRemoves === 1) throw new Error('private cleanup detail');
          return { status: 'removed' };
        }
      })
    });
    cleanupOnly.wait = async () => {};
    await cleanupOnly.run(); assert.equal(cleanupOnly.state, 'completed');
    assert.equal(cleanupOnly.pendingInbox.size, 0);
    assert.equal(failedSendCalls, 2); assert.equal(failedSendAdds, 1); assert.equal(failedSendRemoves, 1);
    assert.equal(fs.readFileSync(cleanupOnly.failFile, 'utf8').trim().split('\n').length, 2);
    assert(fs.readFileSync(cleanupOnly.failFile, 'utf8').includes('|alias_cleanup_failed\n'));
    let cleanupCalls = 0, cleanupSends = 0, cleanupReads = 0;
    const cleanupResume = new AliasBatch(options, {
      sendMail: async () => { cleanupSends++; return 'successfully'; },
      changePassword: async () => 'successfully',
      generatePassword: () => 'fixture-password',
      createClient: () => ({ login: async () => {}, close: async () => {}, cancel() {},
        addAlias: async () => ({ status: 'added' }),
        waitForAppleVerification: async () => { cleanupReads++; return { status: 'found', link, messageId: 'message' }; },
        removeAlias: async () => {
          cleanupCalls++;
          if (cleanupCalls === 1) throw Object.assign(new Error('private cleanup detail'), { code: 'NEEDS_ATTENTION', safeMessage: 'Chưa xác nhận xóa alias.' });
          return { status: 'removed' };
        }
      })
    });
    await cleanupResume.run(); assert.equal(cleanupResume.state, 'completed'); assert.equal(cleanupResume.pendingInbox.size, 0);
    assert.equal(cleanupSends, 1); assert.equal(cleanupReads, 1); assert.equal(cleanupCalls, 1);
    assert.equal(cleanupResume.results.get(0).cleanupStatus, 'error');
    assert.equal(fs.readFileSync(cleanupResume.successFile, 'utf8'), 'main@mail.com|alias@mail.com|fixture-password\n');
    console.log('Inbox batch tests passed: resend once, cleanup, and success despite cleanup failure');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
