const { randomInt } = require('node:crypto');
const axiosDefault = require('axios');
const secretKey = "taipc";

// Chỉ nạp dependency của helper cũ khi thực sự gọi helper đó.
let instance;

const instanceDefault = axiosDefault.create({
  timeout: 15000,
})

const delay = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const randomBirthdate = () => {
  let day = Math.floor(Math.random() * 12) + 1;
  let month = Math.floor(Math.random() * 12) + 1;
  var year = Math.floor(Math.random() * 30) + 1970;
  return `${year}-${month}-${day}`;
}

const randomFirstName = () => {
  const { faker } = require('@faker-js/faker');
  return faker.person.firstName();
}

const randomLastName = () => {
  const { faker } = require('@faker-js/faker');
  return faker.person.lastName();
}

const checkProxyStatus = async (proxyString) => {
  if (!instance) instance = require('axios-https-proxy-fix').create({ timeout: 15000 });
  for (let i = 0; i < 3; i++) {
    const proxyArr = proxyString.split(":");
    const proxy = {
      protocol: 'http',
      host: proxyArr[0],
      port: parseInt(proxyArr[1]),
      ...(proxyArr[2] && {
        auth: { username: proxyArr[2], password: proxyArr[3] }
      })
    }
    var options = {
      method: 'GET',
      proxy,
      url: 'https://httpbin.org/ip',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Google Chrome";v="107", "Chromium";v="107", "Not=A?Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      }
    };
    try {
      const resCheck = await instance.request(options);
      if (resCheck?.data) {
        return { proxy: proxyString, status: 'pass' };
      }
      return { proxy: proxyString, status: 'fail' };
    } catch (error) {
      console.log(error);
    }
    await delay(1000);
  }
  return { proxy: proxyString, status: 'fail' };
}

const getBalanceDaisySMS = async (apiKey) => {
  let promises = [];
  for (let i = 0; i < 2; i++) {
    promises.push(new Promise((resolve) => {
      var options = {
        method: 'GET',
        url: `https://daisysms.com/stubs/handler_api.php?api_key=${apiKey}&action=getBalance`,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
          'Accept-Language': 'en-US,en;q=0.9',
          'Connection': 'keep-alive',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36',
          'sec-ch-ua': '"Google Chrome";v="107", "Chromium";v="107", "Not=A?Brand";v="24"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
        }
      };
      instanceDefault.request(options)
        .then(function (response) {
          if (response?.data?.includes("ACCESS_BALANCE")) {
            let balance = Number(response?.data?.replace("ACCESS_BALANCE:", ""));
            resolve(balance);
          } else {
            resolve(-1);
          }
        }).catch((e) => {
          resolve(-1);
        });
    }))
  }
  const [balance1, balance2] = await Promise.all(promises);
  if (balance1 == balance2) {
    return balance1;
  }
  return 0;
}

const getBalance2Captcha = async (keyCaptcha) => {
  return new Promise((resolve) => {
    var data = JSON.stringify({
      "clientKey": keyCaptcha
    });
    var options = {
      method: 'POST',
      url: 'https://api.2captcha.com/getBalance',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Google Chrome";v="107", "Chromium";v="107", "Not=A?Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      },
      data
    };
    instanceDefault.request(options)
      .then(function (response) {
        if (response?.data?.balance) {
          resolve(response?.data?.balance);
        } else {
          resolve(0);
        }
      }).catch((e) => {
        resolve(0);
      });
  })
}

const rentPhoneDaisySMS = async (apiKey) => {
  return new Promise((resolve) => {
    var options = {
      method: 'GET',
      url: `https://daisysms.com/stubs/handler_api.php?api_key=${apiKey}&action=getNumber&service=mb&max_price=0.15`,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Google Chrome";v="107", "Chromium";v="107", "Not=A?Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      }
    };
    // resolve({ idDaisySMS: "107017642", phoneDaisySMS: "4423203274" });
    instanceDefault.request(options)
      .then(function (response) {
        if (response?.data?.includes("ACCESS_NUMBER")) {
          const textNumbers = response?.data?.split(":");
          resolve({ idDaisySMS: textNumbers?.[1], phoneDaisySMS: textNumbers?.[2]?.substring(1) });
        } else {
          resolve({ idDaisySMS: null, phoneDaisySMS: null });
        }
      }).catch((e) => {
        console.log(e);
        resolve({ idDaisySMS: null, phoneDaisySMS: null });
      });
  })
}

const getCodeDaisySMS = async (apiKey, idDaisySMS) => {
  return new Promise((resolve) => {
    var options = {
      method: 'GET',
      url: `https://daisysms.com/stubs/handler_api.php?api_key=${apiKey}&action=getStatus&id=${idDaisySMS}`,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Google Chrome";v="107", "Chromium";v="107", "Not=A?Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      }
    };
    instanceDefault.request(options)
      .then(function (response) {
        if (response?.data) {
          let code = response?.data?.match(/\d+/)?.[0];
          resolve(code);
        } else {
          resolve(false);
        }
      }).catch((e) => {
        resolve(false);
      });
  })
}

const markAsDoneDaisySMS = async (apiKey, idDaisySMS) => {
  return new Promise((resolve) => {
    var options = {
      method: 'GET',
      url: `https://daisysms.com/stubs/handler_api.php?api_key=${apiKey}&action=setStatus&id=${idDaisySMS}&status=6`,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Google Chrome";v="107", "Chromium";v="107", "Not=A?Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      }
    };
    instanceDefault.request(options)
      .then(function (response) {
        resolve(true);
      }).catch((e) => {
        resolve(true);
      });
  })
}

// Bound the entire request, including connection setup, and cancel it on expiry.
const requestCaptcha = async (options) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    return await instanceDefault.request({ ...options, timeout: 20000, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const getCaptchaId = async (apiKey, imageData) => {
  try {
    const FormData = require('form-data');
    let data = new FormData();
    data.append('method', 'base64');
    data.append('key', apiKey);
    data.append('body', imageData);
    data.append('regsense', '1');
    data.append('min_len', '4');

    let options = {
      method: 'post',
      maxBodyLength: Infinity,
      url: 'http://127.0.0.1:80/in.php',
      headers: {
        ...data.getHeaders()
      },
      data: data
    };
    const response = await requestCaptcha(options);
    const body = typeof response?.data === 'string' ? response.data.trim() : '';
    return body.startsWith('OK|') ? body.split('|')[1].trim() : '';
  } catch {
    return '';
  }
}

const getCaptchaResult = async (apiKey, imageData) => {
  try {
    const idCapt = await getCaptchaId(apiKey, imageData);
    if (!idCapt) return '';
    for (let i = 0; i < 10; i++) {
      const options = {
        method: 'get',
        maxBodyLength: Infinity,
        url: `http://127.0.0.1:80/res.php?key=${apiKey}&action=get&id=${idCapt}`,
        headers: {}
      };
      const res = await requestCaptcha(options);
      const body = typeof res?.data === 'string' ? res.data.trim() : null;
      if (typeof body !== 'string') return '';
      if (body === 'CAPCHA_NOT_READY') {
        if (i < 9) await delay(1000);
      } else {
        return body.startsWith('OK|') ? body.split('|')[1].trim() : '';
      }
    }
  } catch {
    return '';
  }
  return '';
}

const generatePassword = () => {
  const pick = (alphabet, length) => Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join('');
  return pick('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 3) + pick('0123456789', 2) + pick('abcdefghijklmnopqrstuvwxyz', 1)
    + pick('0123456789', 3) + '@' + pick('abcdefghijklmnopqrstuvwxyz', 3);
}

const encryptPassword = (password) => {
  const CryptoJS = require('crypto-js');
  const encrypted = CryptoJS.AES.encrypt(password, secretKey).toString();
  return encrypted;
}

const decryptPassword = (encryptedPassword) => {
  const CryptoJS = require('crypto-js');
  const bytes = CryptoJS.AES.decrypt(encryptedPassword, secretKey);
  const decrypted = bytes.toString(CryptoJS.enc.Utf8);
  return decrypted;
}

const splitArrayIntoChunks = (array, numChunks) => {
  const chunkSize = Math.floor(array.length / numChunks); // Kích thước mỗi mảng nhỏ
  const remainder = array.length % numChunks;
  const chunks = [];
  for (let i = 0; i < numChunks; i++) {
    chunks.push(array.slice(i * chunkSize, (i + 1) * chunkSize));
  }
  if (remainder > 0) {
    chunks[chunks.length - 1] = [...chunks[chunks.length - 1], ...array.slice(array.length - remainder)];
  }
  return chunks;
}

const getProcessCaptcha = (proxy, apiKey, imageData) => {
  const axios = require('axios-https-proxy-fix');
  return new Promise((resolve) => {
    const ua = {
      "httplib": "node-fetch",
      "lang": "node",
      "lang_version": process.version,
      "platform": process.platform,
      "publisher": "nopecha",
    };
    let data = JSON.stringify({
      "key": apiKey,
      "type": "textcaptcha",
      "image_urls": [imageData]
    });
    let config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: 'https://api.nopecha.com/',
      timeout: 20000,
      headers: {
        'Content-Type': 'application/json',
        'user_agent': 'NopeCHA NodeBindings',
        'X-NopeCHA-Client-User-Agent': JSON.stringify(ua),
        'Authorization': `Bear ${apiKey}`
      },
      data: data
    };
    if (proxy) {
      config.proxy = proxy;
    }
    axios.request(config)
      .then((response) => {
        if (response?.data?.data) {
          resolve(response?.data?.data);
        } else {
          resolve(false);
        }
      })
      .catch((error) => {
        console.log(error);
        resolve(false);
      });
  })
}

const getCaptchaResultNope = async (proxy, apiKey, imageData) => {
  const axios = require('axios-https-proxy-fix');
  let idCaptcha = null;
  for (let i = 0; i < 5; i++) {
    if (i % 2 == 0) {
      idCaptcha = await getProcessCaptcha(proxy, apiKey, imageData);
    } else {
      idCaptcha = await getProcessCaptcha(null, apiKey, imageData);
    }
    if (idCaptcha) {
      break;
    }
    await delay(2000);
  }
  if (idCaptcha) {
    let onProxy = true;
    for (let i = 0; i < 120; i++) {
      const ua = {
        "httplib": "node-fetch",
        "lang": "node",
        "lang_version": process.version,
        "platform": process.platform,
        "publisher": "nopecha",
      };
      let config = {
        method: 'get',
        maxBodyLength: Infinity,
        url: `https://api.nopecha.com?key=${apiKey}&id=${idCaptcha}`,
        timeout: 20000,
        headers: {
          'Content-Type': 'application/json',
          'user_agent': 'NopeCHA NodeBindings',
          'X-NopeCHA-Client-User-Agent': JSON.stringify(ua),
          'Authorization': `Bear ${apiKey}`
        },
      };
      if (onProxy && proxy) {
        config.proxy = proxy;
      }
      try {
        let res = await axios.request(config);
        if (res?.data?.data) {
          return res?.data?.data?.[0];
        } else {
          onProxy = false;
        }
      } catch (error) {
        if (error?.response?.status != 409) {
          return null;
        } else {
          onProxy = false;
        }
      }
      await delay(2000);
    }
  }
  return null;
}

const fetchPiaProxyByThread = (proxy) => {
  return new Promise((resolve) => {
    let port = proxy.split(":")?.[1];
    var options = {
      method: 'GET',
      url: `http://127.0.0.1:42333/api/get_ip_list?num=1&country=US&state=all&city=all&zip=all&isp=all&ip_time=1&t=1&port=${port}`,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Google Chrome";v="107", "Chromium";v="107", "Not=A?Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      }
    };
    instanceDefault.request(options)
      .then(function (response) {
        if (typeof response?.data == 'string' && response?.data?.includes("127.0.0.1")) {
          resolve(true);
        } else {
          resolve(false);
        }
      }).catch((e) => {
        console.log(e);
        resolve(false);
      });
  })
}

const getUrlViaOauth2 = async (mail, oath2token) => {
  let data = JSON.stringify({
    "email": mail,
    "pass": "1",
    "refresh_token": oath2token.split("|")[0],
    "client_id": oath2token.split("|")[1],
  });
  return new Promise((resolve) => {
    var options = {
      method: 'POST',
      url: 'https://tools.dongvanfb.net/api/get_messages_oauth2',
      headers: {
        'Accept': '*/*',
        'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Content-Type': 'application/json',
        'Origin': 'https://dongvanfb.net',
        'Referer': 'https://dongvanfb.net/',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"'
      },
      data
    };
    instanceDefault.request(options)
      .then(function (response) {
        if (response.data && response.data.messages) {
          let url = null;
          for (const message of response.data.messages) {
            if (message.from == "appleid@id.apple.com") {
              url = message.message.match(/https:\/\/iforgot\.apple\.com\/verify\/email\?key=[^"]*/)[0].trim();
              break;
            }
          }
          resolve(url);
        } else {
          resolve(null);
        }
      }).catch((e) => {
        resolve(null);
      });
  })
}

const getUrlViaOaht2ShopPTool = async (mail, oath2token) => {
  const FormData = require('form-data');
  const formData = new FormData();
  formData.append(
    'data',
    `${mail}|Lumion947@|${oath2token}`
  );
  return new Promise((resolve) => {
    var options = {
      method: 'POST',
      url: 'https://shophptools.com/api/readmailhotmail.php',
      headers: {
        'Accept': '*/*',
        'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Content-Type': 'application/json',
        'Origin': 'https://dongvanfb.net',
        'Referer': 'https://dongvanfb.net/',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        ...formData.getHeaders()
      },
      data: formData
    };
    instanceDefault.request(options)
      .then(function (response) {
        if (response.data && response.data.result && response.data.result.length) {
          let messages = response.data.result[0]?.messages?.value || [];
          let url = null;
          for (const message of messages) {
            if (message?.from?.emailAddress?.address == "appleid@id.apple.com") {
              url = message.body.content.match(/https:\/\/iforgot\.apple\.com\/verify\/email\?key=[^"]*/)[0].trim();
              break;
            }
          }
          resolve(url);
        } else {
          resolve(null);
        }
      }).catch((e) => {
        resolve(null);
      });
  })
}

const getUrlByOwnApi = async (mail, oath2token) => {
  const { readHotmailInbox } = require('./hotmailInbox');
  const messages = await readHotmailInbox({
    email: mail,
    clientId: oath2token.split("|")[1],
    refreshToken: oath2token.split("|")[0],
    clientSecret: '',
    scope: '',
    limit: 10,
    includeBody: true
  });
  let url = null;
  if (messages?.length > 0) {
    for (const message of messages) {
      if (message?.from?.address == "appleid@id.apple.com") {
        url = message.body.content.match(/https:\/\/iforgot\.apple\.com\/verify\/email\?key=[^"]*/)[0].trim();
        break;
      }
    }
  }
  return url;
}

// (async () => {
//   const url = await getUrlByOwnApi("rcb8748@hotmail.com", "M.C562_BAY.0.U.MsaArtifacts.-Cj7EFB6gOuWnNzoxk87EYo8pY4FXtyQfrK7ygzyqiKPVNDdqDTRSH0q2EdQvG4H6XUzb9cT76pSr3wcrTMlFAsNWosrSTJZcFr0DA!OQM!6eNmu!wSkjFX3K95jxU5A34oyiIqKFisnPxF3FfRhrDrOLVi0JW4DryX1EUPiyNFpafBcLWHFVEB0scFtB3eE1p8UdyAGAWOZVJiK2gpBftXHp3B*HAUayBNtXI!iItIIFEmsjZK7lnrZpdi2bLENKfkVyIVCYN7qQXGsDzniCkLGQi9cJl*ii0heh6Aq0*bbTkvRO8t8kqa5yInv9MlKM1nPrbkL4UTQtOilsTgew5ZNS6yF3XRnfv5Su5cM5YQmO3JluaUNF2ThkGMMrYvvoqQ$$|9e5f94bc-e8a4-4e73-b8be-63364c29d753");
//   console.log(url);
// })()

module.exports = {
  randomBirthdate,
  randomFirstName,
  randomLastName,
  checkProxyStatus,
  getBalanceDaisySMS,
  getBalance2Captcha,
  rentPhoneDaisySMS,
  getCodeDaisySMS,
  markAsDoneDaisySMS,
  getCaptchaResult,
  getCaptchaResultNope,
  generatePassword,
  encryptPassword,
  decryptPassword,
  delay,
  splitArrayIntoChunks,
  fetchPiaProxyByThread,
  getUrlViaOauth2,
  getUrlViaOaht2ShopPTool,
  getUrlByOwnApi,
};
