const assert = require('assert');
const {
  enumerateRemainingLines,
  normalizeConcurrency,
  runWithConcurrency
} = require('../run-concurrency');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(message);
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

async function* fromArray(items) {
  for (const item of items) {
    yield item;
  }
}

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test('keeps every concurrency slot filled when tasks finish together', async () => {
  const gates = new Map();
  const started = [];
  let active = 0;
  let maxActive = 0;

  const runPromise = runWithConcurrency(fromArray([1, 2, 3, 4, 5, 6]), async item => {
    started.push(item);
    active++;
    maxActive = Math.max(maxActive, active);
    const gate = deferred();
    gates.set(item, gate);
    await gate.promise;
    active--;
  }, { concurrency: 3 });

  await waitFor(() => started.length === 3, 'initial concurrency was not reached');
  gates.get(1).resolve();
  gates.get(2).resolve();

  await waitFor(() => started.length === 5, 'released slots were not replenished');
  assert.strictEqual(maxActive, 3);

  for (const gate of gates.values()) {
    gate.resolve();
  }
  await waitFor(() => started.length === 6, 'final task did not start');
  gates.get(6).resolve();
  await runPromise;
});

test('contains task rejection, releases its slot, and continues', async () => {
  const started = [];
  const errors = [];

  const result = await runWithConcurrency(fromArray([1, 2, 3]), async item => {
    started.push(item);
    if (item === 1) throw new Error('expected failure');
  }, {
    concurrency: 1,
    onError: (error, item) => errors.push([error.message, item])
  });

  assert.deepStrictEqual(started, [1, 2, 3]);
  assert.deepStrictEqual(errors, [['expected failure', 1]]);
  assert.strictEqual(result.dispatched, 3);
});

test('does not resolve until all dispatched tasks finish', async () => {
  const gate = deferred();
  let settled = false;

  const runPromise = runWithConcurrency(fromArray([1]), () => gate.promise, {
    concurrency: 1
  }).then(() => {
    settled = true;
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(settled, false);
  gate.resolve();
  await runPromise;
  assert.strictEqual(settled, true);
});

test('pause stops dispatching new items and lets active tasks settle', async () => {
  const gates = [];
  const started = [];
  let stopped = false;

  const runPromise = runWithConcurrency(fromArray([1, 2, 3, 4]), async item => {
    started.push(item);
    const gate = deferred();
    gates.push(gate);
    await gate.promise;
  }, {
    concurrency: 2,
    shouldStop: () => stopped
  });

  await waitFor(() => started.length === 2, 'initial tasks did not start');
  stopped = true;
  gates.forEach(gate => gate.resolve());

  const result = await runPromise;
  assert.deepStrictEqual(started, [1, 2]);
  assert.strictEqual(result.dispatched, 2);
  assert.strictEqual(result.stopped, true);
});

test('resuming from a physical-line checkpoint does not duplicate or skip lines', async () => {
  const lines = ['first', '', 'third', 'fourth'];
  const firstRun = [];
  const resumedRun = [];

  for await (const item of enumerateRemainingLines(fromArray(lines), 0)) {
    firstRun.push(item);
    if (firstRun.length === 2) break;
  }

  for await (const item of enumerateRemainingLines(fromArray(lines), 2)) {
    resumedRun.push(item);
  }

  assert.deepStrictEqual(firstRun, [
    { line: 'first', lineNumber: 0 },
    { line: '', lineNumber: 1 }
  ]);
  assert.deepStrictEqual(resumedRun, [
    { line: 'third', lineNumber: 2 },
    { line: 'fourth', lineNumber: 3 }
  ]);
});

test('normalizes invalid and decimal concurrency values', () => {
  assert.strictEqual(normalizeConcurrency(''), 1);
  assert.strictEqual(normalizeConcurrency('abc'), 1);
  assert.strictEqual(normalizeConcurrency(0), 1);
  assert.strictEqual(normalizeConcurrency(-2), 1);
  assert.strictEqual(normalizeConcurrency('3.9'), 3);
  assert.strictEqual(normalizeConcurrency('4'), 4);
});

const keepAlive = setInterval(() => {}, 1000);

(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      console.error(`FAIL ${name}`);
      console.error(error);
      process.exitCode = 1;
      return;
    }
  }
})().finally(() => clearInterval(keepAlive));
