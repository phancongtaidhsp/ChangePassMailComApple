const axios = require('axios-https-proxy-fix');
const axiosDefault = require('axios');
const { toAxiosProxy } = require('./proxy');

const instance = axios.create({
  timeout: 15000,
})

const instanceDefault = axiosDefault.create({
  timeout: 15000,
})

const OTP_WAIT_TIMEOUT_MS = 30000;
const REQUEST_TIMEOUT_MS = 15000;

const delay = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const getRemainingTimeout = (deadline) => {
  return Math.max(1, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()));
}

const delayBeforeNextOtpAttempt = async (deadline, delayMs, signal) => {
  const remaining = deadline - Date.now();
  if (remaining <= 0 || signal?.aborted) return;

  await new Promise(resolve => {
    const timeoutId = setTimeout(finish, Math.min(delayMs, remaining));

    function finish() {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', finish);
      resolve();
    }

    signal?.addEventListener('abort', finish, { once: true });
  });
}

const getLastSecurityCodeMailByFviainboxes = async (proxy, email, timeout, signal) => {
  let username = email.split("@")[0];
  let domain = email.split("@")[1];
  return new Promise((resolve) => {
    var options = {
      method: 'GET',
      url: `https://fviainboxes.com/messages?username=${username}&domain=${domain}`,
      headers: {
        'accept': 'application/ld+json',
        'Content-Type': 'application/ld+json',
        'Authorization': `Bearer af2b556e5e719052ca9193bace296b4fe9015bdc6c2c6ec28447d57c56187941`
      },
      timeout,
      signal,
    };
    if (proxy) {
      options.proxy = proxy;
    }
    instance.request(options)
      .then(function (response) {
        let id = null;
        if (response?.data?.result) {
          for (const message of response?.data?.result) {
            if (message?.subject?.toLowerCase().includes("code")
              && message?.from?.toLowerCase().includes("microsoft")) {
              id = message?.id;
              break;
            }
          }
        }
        resolve(id);
      }).catch((e) => {
        resolve(null);
      });
  })
}

const getCodeFviainboxes = async (proxy, email, id, timeout, signal) => {
  let username = email.split("@")[0];
  let domain = email.split("@")[1];
  return new Promise((resolve) => {
    var options = {
      method: 'GET',
      url: `https://fviainboxes.com/message?username=${username}&domain=${domain}&id=${id}`,
      headers: {
        'accept': 'application/ld+json',
        'Content-Type': 'application/ld+json',
        'Authorization': `Bearer af2b556e5e719052ca9193bace296b4fe9015bdc6c2c6ec28447d57c56187941`
      },
      timeout,
      signal,
    };
    if (proxy) {
      options.proxy = proxy;
    }
    instance.request(options)
      .then(function (response) {
        let code = null;
        let message = response?.data;
        if (message) {
          const match = message.match(/>\d{6}</);
          code = match ? match[0].replace(/>|</g, "") : null;
          if (!code) {
            const match1 = message.match(/: \d{6}/);
            code = match1 ? match1[0].replace(/: /g, "") : null;
          }
        }
        resolve(code);
      }).catch((e) => {
        resolve(null);
      });
  })
}

const getCodeFviainboxesByEmail = async (email, proxyString, signal) => {
  const proxy = toAxiosProxy(proxyString);
  const deadline = Date.now() + OTP_WAIT_TIMEOUT_MS;
  let id = null;

  while (Date.now() < deadline && !signal?.aborted) {
    id = await getLastSecurityCodeMailByFviainboxes(proxy, email, getRemainingTimeout(deadline), signal);
    if (id) {
      break;
    }
    await delayBeforeNextOtpAttempt(deadline, 3000, signal);
  }

  if (id) {
    while (Date.now() < deadline && !signal?.aborted) {
      let code = await getCodeFviainboxes(proxy, email, id, getRemainingTimeout(deadline), signal);
      if (code) {
        return code;
      }
      await delayBeforeNextOtpAttempt(deadline, 2000, signal);
    }
  }
  return null;
}

const tryGetCodeSmvMailByEmail = async (proxy, email, timeout, signal) => {
  return new Promise((resolve) => {
    var options = {
      method: 'GET',
      url: `https://api.smvmail.com/email?page=1&q=&email=${email}`,
      headers: {
        'accept': 'application/json, text/plain, */*'
      },
      timeout,
      signal,
    };
    if (proxy) {
      options.proxy = proxy;
    }
    instance.request(options)
      .then(function (response) {
        let messages = response?.data?.data?.docs;
        let code = null;
        if (messages && messages.length) {
          for (let message of messages) {
            if (code) {
              break;
            }
            if (message?.subject?.toLowerCase()?.includes("code")
              && message?.from?.toLowerCase()?.includes("microsoft")) {
              let messageContent = message.text;
              const match = messageContent.match(/>\d{6}</);
              code = match ? match[0].replace(/>|</g, "") : null;
              if (!code) {
                const match1 = messageContent.match(/: \d{6}/);
                code = match1 ? match1[0].replace(/: /g, "") : null;
              }
            }
          }
        }
        resolve(code);
      }).catch((e) => {
        resolve(null);
      });
  })
}

const getCodeSmvMailByEmail = async (email, proxyString, signal) => {
  const proxy = toAxiosProxy(proxyString);
  const deadline = Date.now() + OTP_WAIT_TIMEOUT_MS;

  while (Date.now() < deadline && !signal?.aborted) {
    let code = await tryGetCodeSmvMailByEmail(proxy, email, getRemainingTimeout(deadline), signal);
    if (code) {
      return code;
    }
    await delayBeforeNextOtpAttempt(deadline, 3000, signal);
  }
  return null;
}

const createTmEmail = async (email) => {
  let data = JSON.stringify({
    "address": email,
    "password": "Lumiong47@"
  });
  return new Promise((resolve) => {
    var options = {
      method: 'POST',
      url: `https://api.mail.tm/accounts`,
      headers: { 
        'accept': 'application/ld+json', 
        'Content-Type': 'application/ld+json'
      },
      data: data
    };
    instanceDefault.request(options)
      .then(function (response) {
        if (response?.data?.id) {
          resolve(response.data.id);
        } else {
          resolve(null);
        }
      }).catch((e) => {
        resolve(null);
      });
  })
}

const getTokenTmEmail = async (email) => {
  let data = JSON.stringify({
    "address": email,
    "password": "Lumiong47@"
  });
  return new Promise((resolve) => {
    var options = {
      method: 'POST',
      url: `https://api.mail.tm/token`,
      headers: { 
        'accept': 'application/ld+json', 
        'Content-Type': 'application/ld+json'
      },
      data: data
    };
    instanceDefault.request(options)
      .then(function (response) {
        if (response?.data?.token) {
          resolve(response.data.token);
        } else {
          resolve(null);
        }
      }).catch((e) => {
        resolve(null);
      });
  })
}

const findCodeTmEmail = async (token) => {
  return new Promise((resolve) => {
    var options = {
      method: 'GET',
      url: `https://api.mail.tm/messages`,
      headers: { 
        'accept': 'application/ld+json', 
        'Content-Type': 'application/ld+json',
        'Authorization': `Bearer ${token}`
      }
    };
    instanceDefault.request(options)
      .then(function (response) {
        let code = null;
        let messages = response?.data?.['hydra:member'];
        if (messages) {
          for (let message of messages) {
            if (message?.subject?.toLowerCase().includes("microsoft")) {
              const match = message.intro.match(/\d{6}/);
              code = match ? match[0] : null;
              break;
            }
          }
        }
        resolve(code);
      }).catch((e) => {
        resolve(null);
      });
  })
}

// (async () => {
//   let code = await getCodeSmvMailByEmail("jmhernadez_29vb55678@smvmail.com", "as.lumiproxy.io:5888:lumi-lumip3jxa8qy4v9_area-US:NUZnacBTmBasd123")
//   console.log(code);
// })()

module.exports = {
  delay,
  getCodeFviainboxesByEmail,
  getCodeSmvMailByEmail,
  createTmEmail,
  getTokenTmEmail,
  findCodeTmEmail,
};
