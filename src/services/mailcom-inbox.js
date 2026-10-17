const { randomUUID } = require('node:crypto');
const { extractAppleVerificationLinks } = require('./apple-verification-link');

// Đối chiếu application-config.js + bundle mail-list 7.4.2 / mail-detail 8.2.3.
const TOKEN = 'https://oauthbridge.navigator-lxa.mail.com/navigator/oauth2/token';
const LIST = 'https://maillist.mail.com/Mailbox/Mail';
const MAILBOX = 'https://webmail-cats-live.mail.com/mailbox/primary';
const LIST_ACCEPT = 'application/vnd.1and1.mms.unified-maillist-v1+json; charset=utf-8';
const HEADER_ACCEPT = 'application/vnd.ui.trinity.message+json; charset=utf-8; client-meta=mail-drop;';
const BODY_ACCEPT = 'text/vnd.ui.secure-v3+html; generateInlineLinks=embed';

function attention(message) {
  return Object.assign(new Error(message), { code: 'NEEDS_ATTENTION', safeMessage: message });
}
function address(value) {
  if (typeof value !== 'string') return '';
  const match = /<([^<>]+)>\s*$/.exec(value.trim());
  const email = (match ? match[1] : value).trim().toLowerCase();
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email) ? email : '';
}
function isAppleMessage(message, recipient, since = 0) {
  const header = message?.mailHeader;
  const sender = address(header?.from);
  const domain = sender.split('@')[1];
  if (!domain || (domain !== 'apple.com' && !domain.endsWith('.apple.com'))) return false;
  const recipients = ['to', 'cc', 'bcc'].flatMap(key => Array.isArray(header[key]) ? header[key] : []);
  if (!recipients.some(value => address(value) === recipient)) return false;
  return !since || (Number.isFinite(message.attribute?.internalDate) && message.attribute.internalDate >= since);
}
function validateMessage(message) {
  if (!message || typeof message.attribute?.mailIdentifier !== 'string' || !message.attribute.mailIdentifier ||
      typeof message.mailHeader?.from !== 'string' || !Array.isArray(message.mailHeader.to)) {
    throw attention('Phản hồi thư mail.com không đúng định dạng.');
  }
  return message;
}

class MailComInbox {
  constructor(client) { this.client = client; this.clear(); }
  clear() { this.token = null; this.expiresAt = 0; }
  async authenticate() {
    this.client.check();
    if (this.token && Date.now() < this.expiresAt) return;
    if (!this.client.navsid) throw attention('Chưa có phiên đăng nhập để đọc Inbox.');
    const response = await this.client.requestWithRetry(`${TOKEN}?${new URLSearchParams({ sid: this.client.navsid })}`, {
      method: 'POST', redirects: false,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://webmailer.mail.com',
        Authorization: `Basic ${Buffer.from('mailcom_webmailermaillist_passport_live:*******').toString('base64')}` },
      data: new URLSearchParams({ grant_type: 'urn:mam:oauth:grant-type:spa', scope: 'mail_mailbox_r' }).toString()
    }, 'Lấy token Inbox');
    const data = response.data;
    if (typeof data?.access_token !== 'string' || !data.access_token || /[\r\n]/.test(data.access_token)) {
      throw attention('Mail.com không trả token Inbox hợp lệ.');
    }
    this.token = data.access_token;
    const lifetime = Number.isFinite(data.expires_in) && data.expires_in > 0 ? data.expires_in : 60;
    this.expiresAt = Date.now() + Math.max(1, lifetime - 15) * 1000;
  }
  async request(url, { accept, method = 'GET', contentType, timeout = 20000, validate = response => response } = {}) {
    // Token có ngân sách retry riêng, không bọc authenticate trong vòng lặp đọc thư.
    await this.authenticate();
    return this.client.retry(async () => {
      try {
        const response = await this.client.http(url, { method, redirects: false, timeout,
          ...(method === 'POST' ? { data: null } : {}),
          headers: { Authorization: `Bearer ${this.token}`, Origin: 'https://webmailer.mail.com',
            'X-UI-APP': 'mailcom.webmailer-mail-list/7.4.2', 'X-Request-ID': randomUUID(), Accept: accept,
            ...(contentType ? { 'Content-Type': contentType } : {}) }
        });
        this.client.requireSuccess(response, 'Đọc Inbox');
        return validate(response);
      } catch (error) {
        // API đọc không thay đổi dữ liệu: thử lại cả lỗi HTTP và phản hồi sai định dạng.
        if (error.code !== 'CANCELLED') error.retryable = true;
        throw error;
      }
    }, { stage: 'Đọc Inbox', attempts: 3 });
  }
  async listInbox({ offset = 0, amount = 50 } = {}) {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(amount) || amount < 1 || amount > 100) {
      throw attention('Phân trang Inbox không hợp lệ.');
    }
    const query = new URLSearchParams({ folderTypeOrId: 'INBOX', offset: String(offset), amount: String(amount), orderBy: 'INTERNALDATE DESC' });
    return this.request(`${LIST}?${query}`, { method: 'POST', timeout: 32000, accept: LIST_ACCEPT,
      contentType: 'application/vnd.1and1.mms.inboxadrequest-v1+json; charset=utf-8',
      validate: response => {
        const data = response.data;
        if (!Array.isArray(data?.mailListElements) || !Number.isInteger(data.totalCount) || data.totalCount < 0) {
          throw attention('Danh sách Inbox mail.com không đúng định dạng.');
        }
        const messages = data.mailListElements.filter(item => item?.type === 'mail').map(item => validateMessage(item.rawData));
        return { messages, totalCount: data.totalCount };
      }
    });
  }
  async readMessage(id) {
    if (typeof id !== 'string' || !id || id.length > 2048) throw attention('Mã thư không hợp lệ.');
    const encoded = encodeURIComponent(id);
    const message = await this.request(`${MAILBOX}/mailheader/${encoded}?absoluteURI=false`, { accept: HEADER_ACCEPT,
      validate: response => {
        const message = validateMessage(response.data);
        if (message.attribute.mailIdentifier !== id) throw attention('Nội dung thư không khớp mã thư yêu cầu.');
        return message;
      }
    });
    const body = await this.request(`${MAILBOX}/mailbody/${encoded}/Body?absoluteURI=false`, { accept: BODY_ACCEPT,
      validate: response => {
        if (typeof response.data !== 'string' || !/^text\/(?:html|plain|vnd\.ui\.secure-v3\+html)(?:;|$)/i.test(response.headers?.['content-type'] || '')) {
          throw attention('Nội dung thư mail.com không đúng định dạng.');
        }
        return response.data;
      }
    });
    return { ...message, body };
  }
  async readTextBody(id) {
    if (typeof id !== 'string' || !id || id.length > 2048) throw attention('Mã thư không hợp lệ.');
    return this.request(`${MAILBOX}/mailbody/${encodeURIComponent(id)}/Body?absoluteURI=false`, { accept: 'text/plain',
      validate: response => {
        if (typeof response.data !== 'string' || !/^text\/plain(?:;|$)/i.test(response.headers?.['content-type'] || '')) {
          throw attention('Bản text của thư mail.com không đúng định dạng.');
        }
        return response.data;
      }
    });
  }
  async waitForAppleVerification({ recipient, since = 0, attempts = 5, intervalMs = 2000, maxPages = 5 } = {}) {
    recipient = address(recipient);
    if (!recipient || !Number.isFinite(since) || since < 0 || !Number.isInteger(attempts) || attempts < 1 || attempts > 60 ||
        !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 20 || !Number.isInteger(intervalMs) || intervalMs < 0 || intervalMs > 60000) {
      throw attention('Cấu hình tìm thư Apple không hợp lệ.');
    }
    const seen = new Set();
    let scanned = 0, appleMessages = 0, truncated = false;
    for (let attempt = 0; attempt < attempts; attempt++) {
      this.client.check();
      this.client.report(`Đọc Inbox, tìm thư Apple cho ${recipient} (${attempt + 1}/${attempts})…`);
      for (let page = 0; page < maxPages; page++) {
        const { messages, totalCount } = await this.listInbox({ offset: page * 50 });
        for (const message of messages) {
          const id = message.attribute.mailIdentifier;
          if (seen.has(id)) continue;
          scanned++;
          if (!isAppleMessage(message, recipient, since)) { seen.add(id); continue; }
          const opened = await this.readMessage(id);
          seen.add(id);
          if (!isAppleMessage(opened, recipient, since)) continue;
          appleMessages++;
          let links = extractAppleVerificationLinks(opened.body);
          // secure-v3 có thể bỏ tham số `to` của link deref. Bản text của cùng
          // mã thư vẫn giữ URL gốc; không kết luận thiếu link chỉ từ HTML đã lọc.
          if (!links.length) links = extractAppleVerificationLinks(await this.readTextBody(id));
          if (links.length) return { status: 'found', link: links[0], messageId: id, scanned, appleMessages };
        }
        const hasMore = (page + 1) * 50 < totalCount;
        truncated = hasMore && page === maxPages - 1;
        if (!hasMore || !messages.length) break;
      }
      if (attempt + 1 < attempts) await this.wait(intervalMs);
    }
    return { status: 'not_found', scanned, appleMessages, truncated };
  }
  async wait(ms) {
    // Phiên bị hủy thì ngắt chờ. Tạm dừng batch vẫn giữ phiên để xử lý hết alias.
    const signal = this.client.controller.signal;
    this.client.check();
    await new Promise(resolve => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, ms);
      signal.addEventListener('abort', finish, { once: true });
      if (signal.aborted) finish();
    });
    this.client.check();
  }
}

module.exports = { MailComInbox, address, isAppleMessage, LIST, MAILBOX };
