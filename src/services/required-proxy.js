const fs = require('node:fs');
const { normalizeProxyUrl } = require('./proxy');

function requireProxy(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Bắt buộc cấu hình proxy; không cho phép kết nối trực tiếp.');
  try {
    const raw = value.trim();
    if (raw.includes('://') && !/^https?:\/\//i.test(raw)) throw new Error();
    const normalized = normalizeProxyUrl(raw);
    const url = new URL(normalized);
    if (url.pathname !== '/' || url.search || url.hash) throw new Error();
    return normalized;
  } catch {
    throw new Error('Proxy không hợp lệ. Dùng HTTP/HTTPS: host:port hoặc host:port:user:password.');
  }
}

function loadProxies(file, { raw = false } = {}) {
  let content;
  try {
    if (typeof file !== 'string' || !file.trim() || !fs.statSync(file).isFile() || fs.statSync(file).size > 20 * 1024 * 1024) throw new Error();
    content = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Error('Hãy chọn file proxy TXT hợp lệ (tối đa 20 MB). Proxy là bắt buộc.');
  }
  const proxies = new Map();
  content.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const normalized = requireProxy(line);
      if (!proxies.has(normalized)) proxies.set(normalized, raw ? line.trim() : normalized);
    }
    catch { throw new Error(`Proxy dòng ${index + 1} không hợp lệ. Dùng HTTP/HTTPS: host:port hoặc host:port:user:password.`); }
  });
  if (!proxies.size) throw new Error('File proxy rỗng; không cho phép kết nối trực tiếp.');
  return [...proxies.values()];
}
module.exports = { requireProxy, loadProxies };
