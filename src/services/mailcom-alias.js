const { HttpsProxyAgent } = require('https-proxy-agent');
const { requireProxy } = require('./required-proxy');
const DELETE_RETRY_STATUSES = new Set([401, 403, 407, 424]);
const axios = require('axios');
const cheerio = require('cheerio');
const { CookieJar } = require('tough-cookie');
const { randomUUID } = require('node:crypto');

// Verified against mailset-root 1.0.7-build.262 and mailset-compose 1.0.8-build.377.
const HOME = 'https://www.mail.com/';
const LOGIN = 'https://login.mail.com/login';
const TOKEN = 'https://oauthbridge.navigator-lxa.mail.com/navigator/oauth2/token';
const ADDRESSES = 'https://settings-cats.mail.com/mailaccount/primary/emailAddresses?absoluteURI=false';
const ADDRESS_REMOVALS = 'https://settings-cats.mail.com/mailaccount/primary/emailAddressesRemovals';
const LIST = `${ADDRESSES}&q.state.in=ACTIVE&q.type.in=MANAGED,DOMAIN_HOSTING`;
const DOMAINS = 'https://settings-cats.mail.com/domains?absoluteURI=false&q.state.eq=ACTIVE&q.owner.eq=gmx_MAILCOM';
const VALIDATE = 'https://settings-cats.mail.com/mailaccount/emailAddressValidations?absoluteURI=false';
const VALIDATE_REQUEST = 'application/vnd.ui.trinity.email-address-validation-request+json';
const VALIDATE_RESPONSE = 'application/vnd.ui.trinity.email-address-validation-response+json';
const LIST_TYPE = 'application/vnd.ui.trinity.mailaddress.list-v5+json';
const CREATE_TYPE = 'application/vnd.ui.trinity.minimalmailaddress-v3+json';
function addressLimitReached(data) {
  const text = typeof data === 'string' ? data : JSON.stringify(data ?? {});
  return /Maximum number of email addresses created|\b(?:FREE|PRO|TOP)_PRIMARY_LIMIT\b/i.test(text);
}
function accountFullOutcome(httpStatus) {
  return { status: 'failed', accountFull: true, ...(httpStatus ? { httpStatus } : {}), message: 'Maximum number of email addresses created. Chuyển sang mail chính tiếp theo.' };
}
function trusted(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && (u.hostname === 'mail.com' || u.hostname.endsWith('.mail.com')); }
  catch { return false; }
}
function attention(message, code = 'NEEDS_ATTENTION') {
  const error = new Error(message); error.safeMessage = message; error.code = code; return error;
}
function parseLogin(html) {
  const $ = cheerio.load(html);
  const form = $('form').filter((_i, el) => $(el).find('input[name="username"]').length && $(el).find('input[name="password"]').length).first();
  if (!form.length || new URL(form.attr('action'), HOME).href !== LOGIN || form.attr('method')?.toLowerCase() !== 'post') {
    throw attention('Form đăng nhập mail.com đã thay đổi hoặc yêu cầu xác minh.');
  }
  const data = new URLSearchParams();
  form.find('input[name]').each((_i, el) => { const input = $(el); if (!input.is('[disabled]')) data.set(input.attr('name'), input.attr('value') || ''); });
  return data;
}
function settingsSession(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const pageText = $.root().text().replace(/\s+/g, ' ');
  if (/verify your identity/i.test(pageText) && /irregular login activity|text message to your mobile phone/i.test(pageText)) {
    throw attention('Mail.com yêu cầu xác minh danh tính bằng SMS do hoạt động đăng nhập bất thường.');
  }
  const match = html.match(/"mail_settings":.*?"url_map":\{"default":"((?:\\.|[^"\\])*)"/s);
  if (!match) throw attention('Chưa xác nhận đăng nhập: không có cấu hình Mail Settings. Kiểm tra tài khoản hoặc xác minh trên mail.com.');
  let url;
  try { url = new URL(JSON.parse(`"${match[1]}"`)); } catch { throw attention('Cấu hình Mail Settings không hợp lệ.'); }
  if (!trusted(url.href) || url.hostname !== 'mailset-root.mail.com' || !url.searchParams.get('navsid')) throw attention('URL phiên Mail Settings không hợp lệ.');
  return url.searchParams.get('navsid');
}
class MailComAliasClient {
  constructor(report = () => {}, { proxy, request = axios.request, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    this.proxy = requireProxy(proxy);
    this.agent = new HttpsProxyAgent(this.proxy);
    this.report = report; this.request = request; this.sleep = pause;
    this.jar = new CookieJar(); this.controller = new AbortController(); this.cancelled = false; this.mutating = false;
  }
  cancel() { this.cancelled = true; if (!this.mutating) this.controller.abort(); }
  check() { if (this.cancelled) throw attention('Đã tạm dừng. Bấm Tiếp tục để xử lý phần còn lại.', 'CANCELLED'); }
  async retry(operation, { stage, attempts = 3, ignoreCancel = false } = {}) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (!ignoreCancel) this.check();
      try { return await operation(); }
      catch (error) {
        if (error.code === 'CANCELLED' || !error.retryable || attempt === attempts) throw error;
        this.report(`${stage}: thử lại ${attempt + 1}/${attempts} sau 2 giây…`);
        await this.sleep(2000);
      }
    }
  }
  async requestWithRetry(url, options, stage) {
    return this.retry(async () => {
      const response = await this.http(url, options);
      this.requireSuccess(response, stage);
      return response;
    }, { stage });
  }
  async http(url, { method = 'GET', data, headers = {}, ignoreCancel = false, redirects = true, timeout = 20000 } = {}) {
    if (!ignoreCancel) this.check();
    const controller = ignoreCancel ? new AbortController() : this.controller;
    let current = url, currentHeaders = { ...headers };
    for (let hop = 0; hop <= 8; hop++) {
      if (!trusted(current)) throw attention('Đã chặn URL chuyển hướng ngoài HTTPS mail.com.');
      let response;
      try {
        const cookie = await this.jar.getCookieString(current);
        response = await this.request({ url: current, method, data,
          headers: { Accept: 'text/html,application/json', 'Accept-Language': 'en-US,en;q=0.9',
            'User-Agent': 'Mozilla/5.0', ...currentHeaders, ...(cookie ? { Cookie: cookie } : {}) },
          // The agent performs CONNECT through the mandatory proxy. Disable Axios env proxy handling.
          httpsAgent: this.agent, httpAgent: this.agent, proxy: false, timeout, signal: controller.signal, maxRedirects: 0,
          maxContentLength: 5 * 1024 * 1024, maxBodyLength: 1024 * 1024, validateStatus: () => true });
      } catch {
        if (!ignoreCancel && this.cancelled) this.check();
        throw Object.assign(attention('Request qua proxy lỗi kết nối hoặc quá thời gian chờ. Không chuyển sang kết nối trực tiếp; chưa xác nhận kết quả.'), { retryable: true });
      }
      if (response.status === 407) throw Object.assign(attention('Proxy từ chối xác thực (HTTP 407). Kiểm tra cấu hình proxy; không chuyển sang kết nối trực tiếp.'), { httpStatus: 407 });
      const cookies = response.headers?.['set-cookie'] || [];
      for (const cookie of Array.isArray(cookies) ? cookies : [cookies]) await this.jar.setCookie(cookie, current, { ignoreError: true });
      if (![301, 302, 303, 307, 308].includes(response.status) || !redirects) return { ...response, url: current };
      if (!response.headers?.location) throw attention('Phản hồi chuyển hướng không có URL.');
      const target = new URL(response.headers.location, current);
      if (!trusted(target.href)) throw attention('Đã chặn URL chuyển hướng ngoài HTTPS mail.com.');
      const crossOrigin = target.origin !== new URL(current).origin;
      if (crossOrigin && ['POST', 'PUT', 'PATCH'].includes(method) && [307, 308].includes(response.status)) throw attention('Không chuyển tiếp dữ liệu đăng nhập sang host khác qua HTTP 307/308.');
      if (crossOrigin) { delete currentHeaders.Authorization; delete currentHeaders.Origin; delete currentHeaders.Referer; }
      if (response.status === 303 || ([301, 302].includes(response.status) && method === 'POST')) {
        method = 'GET'; data = undefined; delete currentHeaders['Content-Type'];
      }
      current = target.href;
    }
    throw attention('Mail.com chuyển hướng quá nhiều lần.');
  }
  requireSuccess(response, stage) {
    if (response.status >= 200 && response.status < 300) return;
    const masked = response.data?.type === 'urn:problem:mam:cats:target-response-masked';
    const suffix = masked ? ' Mail.com (CATS) đã che phản hồi lỗi của hệ thống phía sau; chưa biết nguyên nhân cụ thể. Kiểm tra alias trong Sender Addresses trước khi thử lại.'
      : response.status === 412 ? ' Mail.com từ chối yêu cầu do điều kiện chưa đáp ứng; phản hồi chưa đủ để xác định nguyên nhân. Kiểm tra tài khoản và alias trước khi thử lại.'
      : response.status === 429 ? ' Máy chủ đang giới hạn request.'
      : [401, 403, 424].includes(response.status) ? ' Phiên bị từ chối hoặc cần xác minh trên mail.com.' : '';
    const error = attention(`${stage}: HTTP ${response.status}.${suffix}`);
    error.httpStatus = response.status;
    error.retryable = [408, 429].includes(response.status) || response.status >= 500 && response.status <= 599;
    throw error;
  }
  async login(account) {
    this.mainEmail = account.email.toLowerCase();
    this.report(`Đăng nhập bằng HTTP: ${account.email}…`);
    let response = await this.requestWithRetry(HOME, {}, 'Tải form đăng nhập');
    const form = parseLogin(String(response.data));
    form.set('username', account.email); form.set('password', account.password);
    response = await this.requestWithRetry(LOGIN, { method: 'POST', data: form.toString(), headers: {
      'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://www.mail.com', Referer: HOME } }, 'Đăng nhập');
    let html = String(response.data);
    const feature = html.match(/new FeatureDetection\((\{.*?\})\)/s);
    if (feature) {
      let config;
      try { config = JSON.parse(feature[1]); } catch { throw attention('Cấu hình chuyển tiếp đăng nhập không hợp lệ.'); }
      const target = new URL(config.redirectUrl, response.url);
      if (!trusted(target.href) || target.origin !== new URL(response.url).origin || target.pathname !== '/halogin') throw attention('URL hoàn tất đăng nhập không hợp lệ.');
      response = await this.requestWithRetry(target.href, {}, 'Hoàn tất phiên'); html = String(response.data);
    }
    const sid = settingsSession(html);
    this.navsid = sid;
    const $ = cheerio.load(html);
    const logout = $('a[href]').map((_i, el) => $(el).attr('href')).get().find(href => {
      try { const u = new URL(href, response.url); return trusted(u.href) && u.origin === new URL(response.url).origin && u.pathname === '/logout'; } catch { return false; }
    });
    if (logout) this.logoutUrl = new URL(logout, response.url).href;
    response = await this.requestWithRetry(`${TOKEN}?${new URLSearchParams({ sid })}`, { method: 'POST', redirects: false,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://mailset-root.mail.com',
        Authorization: `Basic ${Buffer.from('mailcom_mailset_root_live:*******').toString('base64')}` },
      data: new URLSearchParams({ grant_type: 'urn:mam:oauth:grant-type:spa', scope: 'mail_mailbox_w webmailer_setting_r webmailer_setting_w mail_confix_w' }).toString() }, 'Lấy token Settings');
    if (typeof response.data?.access_token !== 'string' || !response.data.access_token || /[\r\n]/.test(response.data.access_token)) throw attention('Mail.com không trả token Settings hợp lệ.');
    this.token = response.data.access_token;
    await this.listAddresses();
    this.report(`Đã xác nhận đăng nhập API: ${account.email}.`);
  }
  async api(url, method = 'GET', data, type = LIST_TYPE, ignoreCancel = false, accept = type) {
    if (!this.token) throw attention('Chưa có token Settings.');
    return this.http(url, { method, data, ignoreCancel, redirects: false, headers: {
      Authorization: `Bearer ${this.token}`, Accept: accept, 'Content-Type': type,
      Origin: 'https://mailset-root.mail.com', 'X-Request-ID': randomUUID(), 'X-UI-APP': 'mailcom.mailset-compose/1.0.8-build.377' } });
  }
  async listAddresses(ignoreCancel = false, attempts = 3) {
    return this.retry(async () => {
      const response = await this.api(LIST, 'GET', undefined, LIST_TYPE, ignoreCancel); this.requireSuccess(response, 'Đọc danh sách alias');
      const addresses = response.data?.mailaddresslist;
      if (!Array.isArray(addresses) || addresses.some(x => typeof x?.address !== 'string') || !addresses.some(x => x.address.toLowerCase() === this.mainEmail)) {
        throw attention('Danh sách alias không hợp lệ hoặc không thuộc mail chính đang xử lý.');
      }
      return addresses;
    }, { stage: 'Đọc danh sách alias', attempts, ignoreCancel });
  }
  async confirmAlias(alias, present) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await this.sleep(2000);
      try {
        // Không lồng retry 3 x 3: tổng cộng tối đa 3 request xác nhận.
        const addresses = await this.listAddresses(true, 1);
        if (addresses.some(x => x.address.toLowerCase() === alias) === present) return true;
      } catch (error) { if (!error.retryable) throw error; }
    }
    return false;
  }
  async addAlias(alias) {
    this.check(); alias = alias.toLowerCase();
    this.report(`Thêm alias bằng API: ${alias}…`);
    const addresses = await this.listAddresses();
    if (addresses.some(x => x.address.toLowerCase() === alias)) return { status: 'existing', message: 'Alias đã có trong đúng mail chính.' };
    if (addresses.length >= 10) return accountFullOutcome();
    const parts = /^([a-z0-9][a-z0-9._-]{2,63})@([a-z0-9.-]+\.[a-z]{2,})$/.exec(alias);
    if (!parts || alias.length > 254) return { status: 'failed', message: 'Địa chỉ alias không hợp lệ; tên trước @ phải có ít nhất 3 ký tự.' };
    const domains = await this.retry(async () => {
      const response = await this.api(DOMAINS, 'GET', undefined, 'application/json');
      this.requireSuccess(response, 'Đọc tên miền'); return response;
    }, { stage: 'Đọc tên miền' });
    if (!Array.isArray(domains.data?.domains) || domains.data.domains.some(x => typeof x?.domain !== 'string')) throw attention('Danh sách tên miền từ mail.com không hợp lệ.');
    if (!domains.data.domains.some(x => x.domain.toLowerCase() === parts[2])) return { status: 'failed', message: 'Tên miền không được phép tạo alias mail.com.' };
    const validation = await this.retry(async () => {
      const response = await this.api(VALIDATE, 'POST', JSON.stringify([alias]), VALIDATE_REQUEST, false, VALIDATE_RESPONSE);
      if ([400, 409, 412, 422].includes(response.status) && addressLimitReached(response.data)) return response;
      this.requireSuccess(response, 'Xác thực địa chỉ alias'); return response;
    }, { stage: 'Xác thực địa chỉ alias' });
    if ((validation.status >= 200 && validation.status < 300 || [400, 409, 412, 422].includes(validation.status)) && addressLimitReached(validation.data)) return accountFullOutcome(validation.status);
    this.requireSuccess(validation, 'Xác thực địa chỉ alias');
    const issues = validation.data;
    if (!issues || typeof issues !== 'object' || Array.isArray(issues)) throw attention('Phản hồi xác thực alias không đúng định dạng.');
    if (Object.keys(issues).length) {
      const reason = issues[alias];
      const message = reason === 'ILLEGAL_LOCALPART' ? 'Tên trước @ không được mail.com chấp nhận.' : 'Mail.com không chấp nhận địa chỉ ở bước xác thực alias.';
      return { status: 'failed', message };
    }
    this.check();
    const payload = { address: alias, displayName: addresses.find(x => x.defaultSenderAddress)?.displayName || '',
      deletable: true, pgpEnabled: false, defaultSenderAddress: false, defaultReceiverAddress: false, state: 'ACTIVE' };
    // Never retry POST: a timeout can still mean the server created the alias.
    this.mutating = true;
    try {
      let response;
      try { response = await this.api(ADDRESSES, 'POST', JSON.stringify(payload), CREATE_TYPE, true); }
      catch { /* Reconcile an ambiguous network outcome below. */ }
      if (response && [400, 409, 412, 422].includes(response.status) && addressLimitReached(response.data)) return accountFullOutcome(response.status);
      if (response && [400, 409, 412, 422].includes(response.status)) return { status: 'failed', httpStatus: response.status, message: `Mail.com từ chối tạo alias (HTTP ${response.status}). Phản hồi chưa đủ để xác định nguyên nhân.` };
      if (response && response.status >= 400 && response.status < 500) this.requireSuccess(response, 'Thêm alias');
      if (await this.confirmAlias(alias, true)) return { status: 'added', message: 'API xác nhận alias có trong danh sách của mail chính.' };
      throw attention('Chưa xác nhận kết quả thêm alias sau 3 lượt đối chiếu.');
    } catch (error) { error.aliasSubmitted = true; throw error; }
    finally { this.mutating = false; }
  }
  async removeAlias(alias) {
    this.check(); alias = alias.toLowerCase();
    if (alias === this.mainEmail) throw attention('Đã chặn yêu cầu xóa mail chính.');
    this.report(`Dọn dẹp alias bằng API: ${alias}…`);
    const addresses = await this.listAddresses();
    const target = addresses.find(x => x.address.toLowerCase() === alias);
    if (!target) return { status: 'absent', message: 'Alias đã không còn trong mail chính.' };
    if (target.deletable === false || target.defaultSenderAddress || target.defaultReceiverAddress) {
      throw attention('Alias không thể xóa khi đang là địa chỉ mặc định.');
    }
    // mailset-compose dùng endpoint removals với POST rỗng, không dùng DELETE.
    const url = `${ADDRESS_REMOVALS}/${encodeURIComponent(alias)}/removals?absoluteURI=false`;
    this.mutating = true;
    try {
      let lastError;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt && this.cancelled) break;
        try {
          const response = await this.api(url, 'POST', undefined, 'text/plain;charset=UTF-8', true);
          this.requireSuccess(response, 'Xóa alias');
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          if ((!error.retryable && !DELETE_RETRY_STATUSES.has(error.httpStatus)) || attempt === 2 || this.cancelled) break;
        }
        // Timeout/5xx không chứng minh thao tác chưa xảy ra. Đọc lại trước khi
        // gửi lần nữa; nếu không đối chiếu được thì chuyển sang xác nhận cuối.
        const deletionRejected = DELETE_RETRY_STATUSES.has(lastError?.httpStatus);
        let updated;
        try { updated = await this.listAddresses(true, 1); }
        catch (error) {
          lastError = error;
          // HTTP từ chối xóa là kết quả đã biết: vẫn thử POST tiếp nếu GET cũng
          // bị lỗi xác thực/kết nối. Timeout POST chưa rõ kết quả thì phải dừng gửi lại.
          if (!deletionRejected || (!error.retryable && !DELETE_RETRY_STATUSES.has(error.httpStatus))) break;
        }
        if (updated) {
          const target = updated.find(x => x.address.toLowerCase() === alias);
          if (!target) {
            return { status: 'removed', message: 'Đã xóa alias khỏi mail chính.' };
          }
          if (target.deletable === false || target.defaultSenderAddress || target.defaultReceiverAddress) {
            lastError = attention('Alias không thể xóa khi đang là địa chỉ mặc định.');
            break;
          }
        }
        this.report(`Xóa alias: thử lại ${attempt + 2}/3 sau 2 giây…`);
        await this.sleep(2000);
      }
      if (await this.confirmAlias(alias, false)) return { status: 'removed', message: 'Đã xóa alias khỏi mail chính.' };
      if (lastError) throw lastError;
      throw attention('Chưa xác nhận alias đã được xóa sau tối đa 3 lượt xác nhận.');
    } finally { this.mutating = false; }
  }
  async close() {
    try { if (this.logoutUrl) await this.http(this.logoutUrl, { ignoreCancel: true, redirects: false, timeout: 5000 }); } catch { /* Best effort logout; never expose response or credentials. */ }
    finally { this.token = null; this.navsid = null; this.inbox?.clear(); this.logoutUrl = null; await this.jar.removeAllCookies(); this.controller.abort(); this.agent.destroy(); }
  }
  mailbox() {
    if (!this.inbox) this.inbox = new (require('./mailcom-inbox').MailComInbox)(this);
    return this.inbox;
  }
  listInbox(options) { return this.mailbox().listInbox(options); }
  readInboxMessage(id) { return this.mailbox().readMessage(id); }
  waitForAppleVerification(options) { return this.mailbox().waitForAppleVerification(options); }
}
module.exports = { MailComAliasClient, trusted, parseLogin, settingsSession, HOME, LOGIN, TOKEN, ADDRESSES, ADDRESS_REMOVALS, LIST, DOMAINS, VALIDATE };
