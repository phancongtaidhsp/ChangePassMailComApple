const axios = require('axios-https-proxy-fix');
const axiosDefault = require('axios');

const instance = axios.create({
  timeout: 15000,
})

const instanceDefault = axiosDefault.create({
  timeout: 15000,
})

const delay = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const getLastSecurityCodeMailByFviainboxes = async (proxy, email) => {
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
      }
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

const getCodeFviainboxes = async (proxy, email, id) => {
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
      }
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

const getCodeFviainboxesByEmail = async (email, proxyString) => {
  let proxy = null;
  if (proxyString) {
    const proxyArr = proxyString.split(":");
    proxy = {
      protocol: 'http',
      host: proxyArr[0],
      port: parseInt(proxyArr[1]),
      ...(proxyArr[2] && {
        auth: { username: proxyArr[2], password: proxyArr[3] }
      })
    }
  }
  let id = null;
  for (let i = 0; i < 5; i++) {
    id = await getLastSecurityCodeMailByFviainboxes(proxy, email);
    if (id) {
      break;
    }
    await delay(3000);
  }
  if (id) {
    for (let i = 0; i < 3; i++) {
      let code = await getCodeFviainboxes(proxy, email, id);
      if (code) {
        return code;
      }
      await delay(2000);
    }
  }
  return null;
}

const tryGetCodeSmvMailByEmail = async (proxy, email) => {
  return new Promise((resolve) => {
    var options = {
      method: 'GET',
      url: `https://smvmail.com/api/email?page=1&q=&email=${email}`,
      headers: {
        'accept': 'application/json, text/plain, */*'
      }
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
        console.log(e);
        resolve(null);
      });
  })
}

const getCodeSmvMailByEmail = async (email, proxyString) => {
  let proxy = null;
  if (proxyString) {
    const proxyArr = proxyString.split(":");
    proxy = {
      protocol: 'http',
      host: proxyArr[0],
      port: parseInt(proxyArr[1]),
      ...(proxyArr[2] && {
        auth: { username: proxyArr[2], password: proxyArr[3] }
      })
    }
  }
  for (let i = 0; i < 5; i++) {
    let code = await tryGetCodeSmvMailByEmail(proxy, email);
    if (code) {
      return code;
    }
    await delay(3000);
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
//   await getUrlViaOauth2("jenny_busbengtssson@hotmail.com", "M.C506_BAY.0.U.-CkqXZ62y6*87k2lDfOOxJ84v6hl1KB8CAQK!9SPM0Wqp1Xp86STKj!PZMX9QSoc2kvLgFSMqbE7i!Cz4hJcu37IQ9Rj5zkbh1TvJ46Pcd!Tm87*omyK4WSSsmb5ZMYzNfMmubiAE84N3l47bLLeeGlFqpsIsUuwLe8vLffyB3gkS!ftiWSAK797DxtULrxDRJ4kT5MJ1B2BSnyGXaNN7!3tDi!Huso58L52H4QgpkL0!MsCIi5wZZCpOcrmtpFog178XNrGSex2OMA6AlgRp1u4ZCLtIXTmSKiWRl48nEiSGXeCvv08q97ajWFjyijlfwOexFsDsDMwi0G0jhC4crVCDv2baOCBfkdUieNh3Ks6*lHAV22Uet81GSJmUzMIn2Y2bbDEJYVeF7Tt!IQNBZunKAsUrdzegB5EJwzsU06R2D6pTJkFkFN*nLUXZtLXrgg$$|2429d14c-f4c7-495c-8894-956e92597c34")
// })()

module.exports = {
  delay,
  getCodeFviainboxesByEmail,
  getCodeSmvMailByEmail,
  createTmEmail,
  getTokenTmEmail,
  findCodeTmEmail,
};