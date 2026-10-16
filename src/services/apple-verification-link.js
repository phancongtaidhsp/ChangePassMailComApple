const cheerio = require('cheerio');

// Nhận nội dung thư đã được API giải mã (HTML hoặc plain text).
// Chỉ trích xuất URL, không truy cập hay sử dụng link xác minh.
function extractAppleVerificationLinks(body) {
  if (typeof body !== 'string' || !body.trim()) return [];
  const $ = cheerio.load(body);
  const candidates = [
    ...$('a[href]').map((_index, element) => $(element).attr('href')).get(),
    ...($.root().text().match(/https:\/\/iforgot\.apple\.com\/verify\/email\?key=[^\s"'<>]+/g) || [])
  ];
  const links = new Set();
  for (const candidate of candidates) {
    let value = candidate.trim();
    // HTML secure-v3 của mail.com bọc href bằng dịch vụ deref.
    // Giải mã tại chỗ; không gửi request tới dịch vụ chuyển hướng.
    try {
      const wrapper = new URL(value);
      if (wrapper.origin === 'https://deref-gmx.com' && wrapper.pathname === '/r/' && !wrapper.username && !wrapper.password) {
        value = wrapper.searchParams.get('to') || wrapper.hash.slice(1);
        if (/^https%3a/i.test(value)) value = decodeURIComponent(value);
      }
    } catch { continue; }
    if (!/^https:\/\/iforgot\.apple\.com\/verify\/email\?key=[^\s"'<>]+$/.test(value)) continue;
    try {
      const url = new URL(value);
      if (url.origin === 'https://iforgot.apple.com' && url.pathname === '/verify/email' &&
          !url.username && !url.password && url.searchParams.get('key')?.trim()) {
        links.add(value);
      }
    } catch { /* Bỏ qua URL hỏng trong nội dung thư. */ }
  }
  return [...links];
}

module.exports = { extractAppleVerificationLinks };
