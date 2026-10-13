const HotmailClass = require('./hotmail');

const MAX_UNLOCK_ATTEMPTS = 2;
const ACCOUNT_TIMEOUT_MS = 5 * 60 * 1000;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const runWithDeadline = async (promise, controller, timeoutMs) => {
  let timeoutId;
  const timeoutPromise = new Promise(resolve => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve({
        status: "error",
        message: "Quá thời gian xử lý 5 phút",
        retryable: false,
      });
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
};

async function changePassHotmailWithRetry(email, password, recoveryEmail, listProxy) {
  let status, message, newPass;
  const controller = new AbortController();
  const deadline = Date.now() + ACCOUNT_TIMEOUT_MS;
  let proxies = Array.isArray(listProxy)
    ? listProxy.filter(proxy => proxy && String(proxy).trim())
    : [];

  if (!proxies.length) {
    proxies = [null];
  }

  for (let attempt = 0; attempt < MAX_UNLOCK_ATTEMPTS; attempt++) {
    const remainingTime = deadline - Date.now();
    if (remainingTime <= 0) {
      controller.abort();
      return { status: "error", message: "Quá thời gian xử lý 5 phút" };
    }

    let retryable = true;
    try {
      const proxy = proxies[attempt % proxies.length];
      const hotmail = new HotmailClass(proxy, email, password);
      hotmail.recoveryEmail = recoveryEmail;
      hotmail.abortSignal = controller.signal;

      ({ status, message, newPass, retryable = false } = await runWithDeadline(
        hotmail.Unlock(),
        controller,
        remainingTime
      ));

      if (status === "success") {
        break;
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return { status: "error", message: "Quá thời gian xử lý 5 phút" };
      }
      status = "error";
      message = error.message || String(error);
      retryable = true;
    }

    if (!retryable || attempt === MAX_UNLOCK_ATTEMPTS - 1) {
      break;
    }

    await delay(Math.min(2000, Math.max(0, deadline - Date.now())));
  }
  return { status, message, newPass };
}

// (async () => {
//   let a = await changePassHotmailWithRetry("tomatillo_86@hotmail.com", "VanBao55678@", ["gw.dataimpulse.com:823:0f601731bbfc77f2faea:84c168ea16712453"]);
//   console.log(a);
// })();

module.exports = {
  changePassHotmailWithRetry
}
