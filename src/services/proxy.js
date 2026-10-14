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
    throw new Error("Proxy không hợp lệ. Kiểm tra định dạng trong file proxy.");
  }

  if (!["http:", "https:"].includes(proxyUrl.protocol)) {
    throw new Error("Chỉ hỗ trợ proxy HTTP/HTTPS.");
  }

  const port = Number(proxyUrl.port || (proxyUrl.protocol === "https:" ? 443 : 80));
  if (!proxyUrl.hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Proxy không hợp lệ. Kiểm tra định dạng trong file proxy.");
  }

  return proxyUrl.toString();
}

module.exports = { normalizeProxyUrl };
