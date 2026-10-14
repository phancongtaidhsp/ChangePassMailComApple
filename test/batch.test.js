const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Batch, loadEmails, nextEmailDelay } = require('../src/batch');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailcom-batch-test-'));
  const emailFile = path.join(root, 'emails.txt');
  const options = { emailFile, outputRoot: path.join(root, "output"), concurrency: 2, delayMs: 1000 };
  const write = text => fs.writeFileSync(emailFile, text);
  const read = (batch, name) => fs.readFileSync(path.join(batch.outputDir, name), 'utf8');
  try {
    const original = '\uFEFF A@mail.com|secret|recovery@example.com\r\na@mail.com\n\nb@usa.com\nc@email.com\n';
    write(original);
    assert.deepEqual(loadEmails(emailFile), { emails: ['a@mail.com', 'b@usa.com', 'c@email.com'], duplicates: 1 });
    fs.mkdirSync(options.outputRoot);
    fs.writeFileSync(path.join(options.outputRoot, 'die.txt'), 'old-die@mail.com');
    fs.writeFileSync(path.join(options.outputRoot, 'live.txt'), 'old-live@mail.com\n');
    fs.writeFileSync(path.join(options.outputRoot, 'unknown.txt'), 'old-unknown@mail.com\n');
    let active = 0;
    let peak = 0;
    const calls = [];
    const releases = [];
    const batch = new Batch(options, { createChecker: () => ({ CheckEmail: email => {
      calls.push(email); peak = Math.max(peak, ++active);
      return new Promise(resolve => releases.push(() => { active--; resolve({ status: 'success', availability: email.startsWith('a') ? 'available' : 'unavailable', message: 'Test' }); }));
    } }) });
    assert.equal(read(batch, 'die.txt'), 'old-die@mail.com', 'Starting a batch preserves existing bytes');
    const first = batch.run();
    assert.equal(calls.length, 2);
    batch.pause();
    releases.splice(0).forEach(release => release());
    await first;
    assert.equal(batch.state, 'paused');
    assert.equal(batch.results.size, 2);
    assert.equal(peak, 2);
    assert.equal(batch.results.has('c@email.com'), false);
    assert.equal(read(batch, 'die.txt'), 'old-die@mail.com\na@mail.com\n');
    const resumed = batch.run();
    releases.splice(0).forEach(release => release());
    await resumed;
    assert.equal(batch.state, 'completed');
    assert.equal(new Set(calls).size, 3);
    assert.equal(calls.length, 3, 'Resume does not duplicate completed email');
    assert.equal(read(batch, 'live.txt'), 'old-live@mail.com\nb@usa.com\nc@email.com\n');
    assert.equal(fs.readFileSync(emailFile, 'utf8'), original, 'Input is unchanged');
    assert.equal(batch.outputDir, options.outputRoot);
    assert.deepEqual(fs.readdirSync(batch.outputDir).sort(),
      ['die.txt', 'live.txt', 'unknown.txt']);
    await assert.rejects(batch.run());

    const again = new Batch(options, { createChecker: () => ({ CheckEmail: async () => ({ status: 'error' }) }) });
    again.wait = async () => {};
    await again.run();
    assert.equal(read(again, 'unknown.txt'), 'old-unknown@mail.com\na@mail.com\nb@usa.com\nc@email.com\n');
    assert.equal(read(again, 'die.txt'), 'old-die@mail.com\na@mail.com\n');
    assert.equal(read(again, 'live.txt'), 'old-live@mail.com\nb@usa.com\nc@email.com\n');

    write('a@mail.com\nb@mail.com\n');
    for (const errorResult of [
      { httpStatus: 429, retryAfter: '60' },
      { verificationRequired: true, message: 'Cần xác minh' },
      { code: 'REGION_BLOCKED', message: 'Khu vực không được hỗ trợ' },
      { httpStatus: 401, message: 'Phiên hết hạn' },
      { httpStatus: 403, message: 'Từ chối truy cập' },
      { httpStatus: 407, message: 'Lỗi proxy' },
      { code: 'SIGNUP_CONFIG_INVALID', message: 'Lỗi cấu hình' },
    ]) {
      const previous = Object.fromEntries(['live.txt', 'die.txt', 'unknown.txt'].map(name => [name, read(batch, name)]));
      let count = 0;
      const blocked = new Batch({ ...options, concurrency: 1 }, { createChecker: () => ({ CheckEmail: async () => {
        count++;
        return count === 1 ? { status: 'error', availability: 'unknown', ...errorResult }
          : { status: 'success', availability: 'available' };
      } }) });
      const delays = [];
      blocked.wait = async delayMs => { delays.push(delayMs); };
      await blocked.run();
      assert.equal(count, 2, 'Email errors must not stop processing the remaining list');
      assert.equal(blocked.state, 'completed');
      assert.equal(blocked.counts.unknown, 1);
      assert.equal(read(blocked, 'live.txt'), previous['live.txt'], 'New batch preserves previous results');
      assert.equal(read(blocked, 'unknown.txt'), previous['unknown.txt'] + 'a@mail.com\n');
      assert.equal(read(blocked, 'die.txt'), previous['die.txt'] + 'b@mail.com\n');
      assert.deepEqual(delays, [errorResult.httpStatus === 429 ? 60000 : 1000]);
    }

    const now = Date.parse('2026-10-14T00:00:00Z');
    assert.equal(nextEmailDelay({ httpStatus: 429, retryAfter: 'Wed, 14 Oct 2026 00:02:00 GMT' }, 1000, now), 120000);
    assert.equal(nextEmailDelay({ httpStatus: 429 }, 1000, now), 30000);
    assert.equal(nextEmailDelay({ httpStatus: 429, retryAfter: 'invalid' }, 1000, now), 30000);
    assert.equal(nextEmailDelay({ httpStatus: 429, retryAfter: '0' }, 1500, now), 1500);

    const failures = new Batch(options, { createChecker: () => ({ CheckEmail: async () => { throw new Error('network'); } }) });
    await failures.run();
    assert.equal(failures.state, 'completed');
    assert.equal(failures.counts.unknown, 2);
    assert.equal(failures.counts.unavailable, 0);

    const brokenDisk = new Batch({ ...options, concurrency: 1 }, { createChecker: () => ({ CheckEmail: async () => {
      fs.unlinkSync(path.join(brokenDisk.outputDir, 'die.txt'));
      fs.mkdirSync(path.join(brokenDisk.outputDir, 'die.txt'));
      return { status: 'success', availability: 'available' };
    } }) });
    await brokenDisk.run();
    assert.equal(brokenDisk.state, 'error');
    assert.equal(brokenDisk.results.size, 0, 'Failed writes never count as completed');
    fs.rmSync(path.join(brokenDisk.outputDir, 'die.txt'), { recursive: true });
    assert.throws(() => new Batch({ ...options, concurrency: 0 }));
    assert.throws(() => new Batch({ ...options, delayMs: 0 }));

    // Regression: 50 concurrent workers must process all 500 emails even when the first 50 fail.
    const manyEmails = Array.from({ length: 500 }, (_, i) => `sample${i}@mail.com`);
    write(manyEmails.join('\n'));
    let inFlight = 0;
    let maxInFlight = 0;
    const seen = [];
    const largeBatch = new Batch({ ...options, outputRoot: path.join(root, 'large'), concurrency: 50 }, { createChecker: () => ({ CheckEmail: async email => {
      const index = seen.length;
      seen.push(email);
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      await new Promise(resolve => setImmediate(resolve));
      inFlight--;
      return index < 50
        ? { status: 'error', availability: 'unknown', httpStatus: 403, verificationRequired: true }
        : { status: 'success', availability: 'available' };
    } }) });
    largeBatch.wait = async () => new Promise(resolve => setImmediate(resolve));
    await largeBatch.run();
    assert.equal(maxInFlight, 50);
    assert.equal(largeBatch.state, 'completed');
    assert.equal(seen.length, 500);
    assert.equal(new Set(seen).size, 500);
    assert.equal(largeBatch.results.size, 500);
    assert.equal(largeBatch.counts.unknown, 50);
    assert.equal(largeBatch.counts.available, 450);
    assert.equal(read(largeBatch, 'die.txt').trim().split('\n').length, 450);
    assert.equal(read(largeBatch, 'unknown.txt').trim().split('\n').length, 50);
    const originalOutput = read(largeBatch, 'die.txt');
    assert.throws(() => new Batch({ ...options, outputRoot: largeBatch.outputDir, emailFile: path.join(largeBatch.outputDir, 'die.txt') }), /trùng file đầu vào/);
    assert.equal(read(largeBatch, 'die.txt'), originalOutput, 'Input collision never overwrites source');
    write('\n');
    assert.throws(() => new Batch(options));

    // Export removes only persisted, conclusive results from this input.
    const exportInput = path.join(root, 'export-input.txt');
    const source = '\uFEFF Live@mail.com|secret\r\ndie@mail.com\r\nlive@mail.com\r\nunknown@mail.com|keep\r\npending@mail.com';
    fs.writeFileSync(exportInput, source);
    const exportBatch = new Batch({ ...options, emailFile: exportInput, outputRoot: path.join(root, 'export-output'), concurrency: 1 }, {
      createChecker: () => ({ CheckEmail: async email => ({
        status: email.startsWith('unknown') ? 'error' : 'success',
        availability: email.startsWith('live') ? 'unavailable' : 'available',
      }) }),
      onUpdate: snapshot => { if (snapshot.state === 'running' && snapshot.completed === 3) exportBatch.pause(); },
    });
    exportBatch.wait = async () => {};
    assert.throws(() => exportBatch.exportResults(), /tạm dừng/);
    const exportRun = exportBatch.run();
    assert.throws(() => exportBatch.exportResults(), /tạm dừng/);
    await exportRun;
    assert.equal(exportBatch.state, 'paused');
    assert.equal(fs.readFileSync(exportInput, 'utf8'), source, 'No input changes before export click');
    const beforeExport = ['live.txt', 'die.txt', 'unknown.txt'].map(name => read(exportBatch, name));
    const exported = exportBatch.exportResults();
    assert.equal(exported.removed, 3, 'Remove duplicate conclusive email rows too');
    assert.equal(exported.remaining, 2);
    assert.equal(fs.readFileSync(exportInput, 'utf8'), '\uFEFFunknown@mail.com|keep\r\npending@mail.com');
    assert.equal(exportBatch.exportResults().removed, 0, 'Repeated export is idempotent');
    assert.deepEqual(['live.txt', 'die.txt', 'unknown.txt'].map(name => read(exportBatch, name)), beforeExport, 'Export never duplicates output');
    assert.deepEqual(loadEmails(exportInput).emails, ['unknown@mail.com', 'pending@mail.com']);
    const nextBatch = new Batch({ ...options, emailFile: exportInput, outputRoot: exportBatch.outputDir }, {
      createChecker: () => ({ CheckEmail: async () => ({ status: 'success', availability: 'available' }) }),
    });
    await nextBatch.run();
    assert.equal(nextBatch.results.size, 2, 'New run only checks remaining input');
    assert.equal(nextBatch.exportResults().remaining, 0);
    assert.equal(fs.readFileSync(exportInput, 'utf8'), '\uFEFF');
    console.log('Batch tests passed: 50 workers process all 500 emails, HTTP cooldown, pause/resume, TXT exports, disk errors');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
