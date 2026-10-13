function normalizeProxyUrl(proxyValue) {
  if (proxyValue === null || proxyValue === undefined) return null;

  const rawProxy = String(proxyValue).trim();
  if (!rawProxy) return null;

  let proxyUrl;
  const legacyParts = rawProxy.split(":");

  try {
    if (/^https?:\/\//i.test(rawProxy)) {
      proxyUrl = new URL(rawProxy);
    } else if (legacyParts.length >= 4 && /^\d+$/.test(legacyParts[1])) {
      const [host, port, username, ...passwordParts] = legacyParts;
      proxyUrl = new URL(`http://${host}:${port}`);
      proxyUrl.username = username;
      proxyUrl.password = passwordParts.join(":");
    } else if (legacyParts.length === 4 && /^\d+$/.test(legacyParts[3])) {
      const [username, password, host, port] = legacyParts;
      proxyUrl = new URL(`http://${host}:${port}`);
      proxyUrl.username = username;
      proxyUrl.password = password;
    } else {
      proxyUrl = new URL(`http://${rawProxy}`);
    }
  } catch (error) {
    throw new Error(`Proxy không hợp lệ: ${rawProxy}`);
  }

  if (!["http:", "https:"].includes(proxyUrl.protocol)) {
    throw new Error(`Chỉ hỗ trợ proxy HTTP/HTTPS: ${rawProxy}`);
  }

  const port = Number(proxyUrl.port || (proxyUrl.protocol === "https:" ? 443 : 80));
  if (!proxyUrl.hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Proxy không hợp lệ: ${rawProxy}`);
  }

  return proxyUrl.toString();
}

function toAxiosProxy(proxyValue) {
  const normalizedProxy = normalizeProxyUrl(proxyValue);
  if (!normalizedProxy) return null;

  const proxyUrl = new URL(normalizedProxy);
  const proxy = {
    protocol: proxyUrl.protocol.slice(0, -1),
    host: proxyUrl.hostname,
    port: Number(proxyUrl.port || (proxyUrl.protocol === "https:" ? 443 : 80)),
  };

  if (proxyUrl.username) {
    proxy.auth = {
      username: decodeProxyCredential(proxyUrl.username),
      password: decodeProxyCredential(proxyUrl.password),
    };
  }

  return proxy;
}

function decodeProxyCredential(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

module.exports = {
  normalizeProxyUrl,
  toAxiosProxy,
};
