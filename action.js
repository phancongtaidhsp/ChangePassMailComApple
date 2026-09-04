const HotmailClass = require('./hotmail');

async function checkLoginHotmailWithRetry(email, password, listProxy) {
  let retry = 0;
  let proxies = Array.isArray(listProxy)
    ? listProxy.filter(proxy => proxy && String(proxy).trim())
    : [];

  if (!proxies.length) {
    proxies = [null];
  }

  while (retry < 3) {
    try {
      const proxyString = proxies[retry % proxies.length];
      let proxy = proxyString;
      if (proxyString) {
        if (!proxyString.includes("http://")) {
          proxy = `http://${proxyString}`;
        }
        if (proxyString.split(":").length === 4) {
          const [host, port, username, password] =proxyString.split(':');
          proxy = `http://${username}:${password}@${host}:${port}`;
        }
      }
      const hotmail = new HotmailClass(proxy, email, password);
      const { status } = await hotmail.Unlock();
      if (status === 'success' || status === 'failed') {
        let statusValue = status === 'success' ? 'valid' : 'invalid';
        return { status: statusValue, email, password };
      } else {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      // Try the next proxy, same style as action.js.
    }
    retry++;
  }
  return { status: 'unchecked', email, password };
}

// (async () => {
//   let a = await checkLoginHotmailWithRetry("tomatillo_86@hotmail.com", "VanBao55678@", ["gw.dataimpulse.com:823:0f601731bbfc77f2faea:84c168ea16712453"]);
//   console.log(a);
// })();

module.exports = {
  checkLoginHotmailWithRetry
}
