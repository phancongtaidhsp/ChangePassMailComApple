const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Batch, loadEmails } = require('../src/batch');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proton-batch-test-'));
  const emailFile = path.join(root, 'emails.txt');
  const options = { emailFile, outputRoot: root, concurrency: 2, delayMs: 1000 };
  const write = text => fs.writeFileSync(emailFile, text);
  const read = (batch, name) => fs.readFileSync(path.join(batch.outputDir, name), 'utf8');
  try {
    const original = '\uFEFF A@proton.me|secret|recovery@example.com\r\na@proton.me\n\nb@pm.me\nc@protonmail.com\n';
    write(original);
    assert.deepEqual(loadEmails(emailFile), { emails: ['a@proton.me', 'b@pm.me', 'c@protonmail.com'], duplicates: 1 });
    let active = 0;
    let peak = 0;
    const calls = [];
    const releases = [];
    const batch = new Batch(options, { createChecker: () => ({ CheckEmail: email => {
      calls.push(email); peak = Math.max(peak, ++active);
      return new Promise(resolve => releases.push(() => { active--; resolve({ status: 'success', availability: email.startsWith('a') ? 'available' : 'unavailable', message: 'Test' }); }));
    } }) });
    const first = batch.run();
    assert.equal(calls.length, 2);
    batch.pause();
    releases.splice(0).forEach(release => release());
    await first;
    assert.equal(batch.state, 'paused');
    assert.equal(batch.results.size, 2);
    assert.equal(peak, 2);
    assert.equal(read(batch, 'pending.txt'), 'c@protonmail.com\n');
    assert.equal(read(batch, 'available.txt'), 'a@proton.me\n');
    const resumed = batch.run();
    releases.splice(0).forEach(release => release());
    await resumed;
    assert.equal(batch.state, 'completed');
    assert.equal(new Set(calls).size, 3);
    assert.equal(calls.length, 3, 'Resume does not duplicate completed email');
    assert.equal(read(batch, 'pending.txt'), '');
    assert(!read(batch, 'results.txt').includes('secret'));
    assert.equal(read(batch, 'results.txt').trim().split('\n').length, 3);
    assert.equal(fs.readFileSync(emailFile, 'utf8'), original, 'Input is unchanged');
    assert(read(batch, 'summary.txt').includes('Đã kiểm tra: 3'));
    assert.deepEqual(fs.readdirSync(batch.outputDir).sort(),
      ['available.txt', 'pending.txt', 'results.txt', 'summary.txt', 'unavailable.txt', 'unknown.txt']);
    await assert.rejects(batch.run());

    write('a@proton.me\nb@proton.me\n');
    for (const stopResult of [
      { httpStatus: 429, retryAfter: '60' },
      { verificationRequired: true, message: 'Cần xác minh' },
      { code: 5003, message: 'Phiên bản cũ' },
    ]) {
      let count = 0;
      const blocked = new Batch({ ...options, concurrency: 1 }, { createChecker: () => ({ CheckEmail: async () => {
        count++; return { status: 'error', availability: 'unknown', ...stopResult };
      } }) });
      await blocked.run();
      assert.equal(count, 1);
      assert.equal(blocked.state, 'paused');
      assert.equal(blocked.counts.unknown, 1);
      assert.equal(read(blocked, 'pending.txt'), 'b@proton.me\n');
      assert.equal(read(blocked, 'unknown.txt'), 'a@proton.me\n');
    }

    const failures = new Batch(options, { createChecker: () => ({ CheckEmail: async () => { throw new Error('network'); } }) });
    await failures.run();
    assert.equal(failures.state, 'completed');
    assert.equal(failures.counts.unknown, 2);
    assert.equal(failures.counts.unavailable, 0);

    const brokenDisk = new Batch({ ...options, concurrency: 1 }, { createChecker: () => ({ CheckEmail: async () => {
      fs.unlinkSync(path.join(brokenDisk.outputDir, 'results.txt'));
      fs.mkdirSync(path.join(brokenDisk.outputDir, 'results.txt'));
      return { status: 'success', availability: 'available' };
    } }) });
    await brokenDisk.run();
    assert.equal(brokenDisk.state, 'error');
    assert.equal(brokenDisk.results.size, 0, 'Failed writes never count as completed');
    assert.equal(read(brokenDisk, 'pending.txt'), 'a@proton.me\nb@proton.me\n');
    assert.throws(() => new Batch({ ...options, concurrency: 0 }));
    assert.throws(() => new Batch({ ...options, delayMs: 0 }));
    write('\n');
    assert.throws(() => new Batch(options));
    console.log('Batch tests passed: concurrency, pause/resume, exports, limits, disk errors, input preservation');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
