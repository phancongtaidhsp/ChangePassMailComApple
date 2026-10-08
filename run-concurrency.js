function normalizeConcurrency(value) {
  const normalized = Math.floor(Number(value));
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 1;
}

async function* enumerateRemainingLines(source, startIndex = 0) {
  let lineNumber = 0;

  for await (const line of source) {
    const currentLineNumber = lineNumber++;
    if (currentLineNumber < startIndex) continue;
    yield { line, lineNumber: currentLineNumber };
  }
}

async function runWithConcurrency(source, worker, options = {}) {
  const concurrency = normalizeConcurrency(options.concurrency);
  const shouldStop = options.shouldStop || (() => false);
  const onError = options.onError || (() => {});
  const iterator = source[Symbol.asyncIterator]();
  const activeTasks = new Set();
  let dispatched = 0;
  let stopped = false;

  const startTask = item => {
    let task;
    task = Promise.resolve()
      .then(() => worker(item))
      .catch(error => onError(error, item))
      .catch(() => {})
      .finally(() => activeTasks.delete(task));
    activeTasks.add(task);
    dispatched++;
  };

  try {
    while (true) {
      while (activeTasks.size >= concurrency) {
        await Promise.race(activeTasks);
        if (shouldStop()) {
          stopped = true;
          break;
        }
      }

      if (stopped || shouldStop()) {
        stopped = true;
        break;
      }

      const next = await iterator.next();
      if (next.done) break;

      if (shouldStop()) {
        stopped = true;
        break;
      }

      startTask(next.value);
    }
  } finally {
    if (typeof iterator.return === 'function') {
      await iterator.return();
    }
    await Promise.all(activeTasks);
  }

  return {
    dispatched,
    stopped: stopped || shouldStop()
  };
}

module.exports = {
  enumerateRemainingLines,
  normalizeConcurrency,
  runWithConcurrency
};
