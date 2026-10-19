// Cancel the underlying request before returning a timeout. Do not leave a late
// response able to advance a workflow after a worker has moved on to cleanup.
async function withDeadline(operation, { timeout, cancel, signal } = {}) {
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('Request timeout must be positive.');
  let timer, abort, settled = false;
  const deadline = new Promise((_, reject) => {
    const stop = code => {
      if (settled) return;
      settled = true;
      try { cancel(); } catch { /* Still release the waiter if cancellation fails. */ }
      reject(Object.assign(new Error(code === 'ECONNABORTED' ? 'Request deadline exceeded.' : 'Request cancelled.'), { code }));
    };
    abort = () => stop('ERR_CANCELED');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    else timer = setTimeout(() => stop('ECONNABORTED'), timeout);
  });
  try {
    return await Promise.race([deadline, Promise.resolve().then(() => {
      if (settled) throw Object.assign(new Error('Request cancelled.'), { code: 'ERR_CANCELED' });
      return operation();
    })]);
  } finally {
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

async function legacyRequest(client, options) {
  const { CancelToken } = require('axios-https-proxy-fix');
  const source = CancelToken.source();
  const timeout = options.timeout ?? 20000;
  try {
    return await withDeadline(() => client.request({ maxContentLength: 5 * 1024 * 1024,
      ...options, timeout, cancelToken: source.token }), {
      timeout, cancel: () => source.cancel('Request deadline exceeded.')
    });
  } catch (error) {
    // The old adapter rejects oversized responses without closing the stream.
    source.cancel('Request failed.');
    throw error;
  }
}
module.exports = { withDeadline, legacyRequest };
