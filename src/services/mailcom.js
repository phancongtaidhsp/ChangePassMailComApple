const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { randomUUID } = require('node:crypto');
const { setTimeout: sleep } = require('node:timers/promises');
const { normalizeProxyUrl } = require('./proxy');

// Xác minh từ signup.mail.com và registration-app2 8.38.0 ngày 2026-10-14.
const SIGNUP_URL = 'https://signup.mail.com/';
const SUGGESTION_ORIGIN = 'https://register-suggest.mail.com';
const CHECK_URL = `${SUGGESTION_ORIGIN}/rest/email-alias/availability`;
const MAX_RETRIES = 3;
const RETRYABLE_HTTP = new Set([302, 401, 403, 408, 429, 500, 502, 503, 504]);
const MAX_AUTO_WAIT_MS = 5 * 60 * 1000;

function retryDelay(result, baseDelayMs, retries, now = Date.now()) {
  const backoff = baseDelayMs * (2 ** retries);
  const header = String(result.retryAfter ?? '').trim();
  const serverDelay = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - now;
  return Math.max(backoff, Number.isFinite(serverDelay) ? serverDelay : result.httpStatus === 429 ? 30000 : 0);
}
const NETWORK_ERROR_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED',
  'ETIMEDOUT', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'ERR_NETWORK', 'EHOSTDOWN', 'ENETDOWN',
]);

class MailComClass {
  constructor(proxy = null, email, options = {}) {
    this.email = email;
    this.proxy = normalizeProxyUrl(proxy);
    this.agent = this.proxy ? new HttpsProxyAgent(this.proxy) : undefined;
    this.abortSignal = null;
    this.timeout = options.timeout ?? 15000;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    this.sleep = options.sleep ?? sleep;
    this.session = null;
  }

  async _makeRequest(config) {
    return axios({
      ...config,
      headers: { Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', ...config.headers },
      httpsAgent: this.agent, proxy: false,
      timeout: this.timeout, signal: this.abortSignal,
      maxRedirects: 0, maxContentLength: 2 * 1024 * 1024,
      validateStatus: () => true,
    });
  }

  _failure(response, code, message) {
    const httpStatus = response.status;
    const verificationRequired = httpStatus === 424;
    const messages = {
      401: 'Phiên kiểm tra mail.com đã hết hạn hoặc không hợp lệ.',
      403: 'mail.com từ chối truy cập từ IP/phiên hiện tại; chưa thể kết luận email.',
      407: 'Proxy không chấp nhận xác thực. Kiểm tra thông tin proxy.',
      424: 'mail.com yêu cầu xác minh; chưa thể kết luận email.',
      429: 'mail.com giới hạn yêu cầu; cần chờ trước khi thử lại.',
    };
    return {
      status: 'error', availability: 'unknown', exists: null, available: null,
      httpStatus, code: code || `HTTP_${httpStatus}`, verificationRequired,
      retryable: !code && RETRYABLE_HTTP.has(httpStatus),
      retryAfter: response.headers?.['retry-after'] ?? null,
      message: message || messages[httpStatus] || `Không thể kiểm tra email qua mail.com (HTTP ${httpStatus}).`,
    };
  }

  async _loadSession() {
    const response = await this._makeRequest({ method: 'get', url: SIGNUP_URL, headers: { Accept: 'text/html' } });
    const html = typeof response.data === 'string' ? response.data : '';
    const location = response.headers?.location || '';
    if (/support\.mail\.com\/info\/reject\.html/i.test(location) ||
        /registration is no longer possible|we can.t sign you up|country where mail\.com/i.test(html)) {
      return this._failure(response, 'REGION_BLOCKED', 'mail.com không hỗ trợ đăng ký từ IP/khu vực hiện tại. Chưa thể kiểm tra email.');
    }
    if (response.status !== 200) return this._failure(response);
    const match = html.match(/<script\b(?=[^>]*\bid\s*=\s*["']application-config["'])[^>]*>([\s\S]*?)<\/script\s*>/i);
    const invalidConfig = () => this._failure(response, 'SIGNUP_CONFIG_INVALID',
      'Không đọc được cấu hình đăng ký mail.com; trang có thể yêu cầu xác minh hoặc đã thay đổi.');
    if (!match) return invalidConfig();
    let config;
    try { config = JSON.parse(match[1]); } catch { return invalidConfig(); }
    const core = config?.core;
    if (typeof config.accessToken !== 'string' || !config.accessToken || /[\r\n]/.test(config.accessToken) ||
        typeof config.clientCredentialGuid !== 'string' || !config.clientCredentialGuid || /[\r\n]/.test(config.clientCredentialGuid) ||
        typeof core?.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-.][\w.-]+)?$/.test(core.version) ||
        typeof core?.defaultCountry !== 'string' || !/^[A-Z]{2}$/.test(core.defaultCountry) ||
        ![SUGGESTION_ORIGIN, `${SUGGESTION_ORIGIN}/`].includes(core?.services?.suggestion?.baseUrl)) return invalidConfig();

    // Chỉ sử dụng tên miền miễn phí do trang đăng ký công bố, không đoán các domain.
    const product = core.products?.FREE_LEVEL_ONE;
    if (product?.name !== 'mailcomFree' || !Array.isArray(product.domains)) return invalidConfig();
    const domains = new Set(product.domains.flatMap(group => Array.isArray(group?.names) ? group.names : [])
      .filter(domain => typeof domain === 'string' && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain))
      .map(domain => domain.toLowerCase()));
    if (!domains.has('mail.com')) return invalidConfig();
    this.session = {
      token: config.accessToken, guid: config.clientCredentialGuid,
      appIdentifier: `@mamdev/umreg.registration-app2/${core.version}`,
      countryCode: core.defaultCountry, domains,
    };
    return null;
  }

  /** Kiểm tra khả năng đăng ký, không xác nhận hộp thư đang hoạt động.
   * 1 lần đầu + tối đa 3 lần thử lại; không retry chặn khu vực/CAPTCHA.
   * Ngân sách dùng chung cho tải cấu hình và kiểm tra email.
   */
  async CheckEmail(email = this.email) {
    for (let retries = 0; retries <= MAX_RETRIES; retries++) {
      const result = await this._checkEmailOnce(email);
      // Chỉ giữ phiên khi đã xác định được khả năng đăng ký của email.
      if (result.status !== 'success' || !['available', 'unavailable'].includes(result.availability)) {
        this.session = null;
      }
      if (!result.retryable) return { ...result, retries };
      if (retries === MAX_RETRIES) return { ...result, retries, retryExhausted: true,
        message: `${result.message} Đã hết ${MAX_RETRIES} lần thử lại.` };
      const delayMs = retryDelay(result, this.retryDelayMs, retries);
      // Không rút ngắn Retry-After dài của máy chủ để thử lại sớm.
      if (delayMs > MAX_AUTO_WAIT_MS) return { ...result, retries, retryDeferred: true,
        message: `${result.message} Máy chủ yêu cầu chờ hơn 5 phút; hãy kiểm tra lại sau.` };
      try { await this.sleep(delayMs, undefined, { signal: this.abortSignal || undefined }); }
      catch (error) {
        if (error.name !== 'AbortError') throw error;
        return { ...result, retries, networkError: false, retryable: false,
          message: 'Đã hủy kiểm tra email.', errorCode: 'ERR_CANCELED' };
      }
    }
  }

  async _checkEmailOnce(email) {
    const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const match = /^([a-z0-9][a-z0-9._-]*)@([a-z0-9.-]+\.[a-z]{2,})$/.exec(normalized);
    const result = { email: normalized, status: 'error', availability: 'unknown', available: null, exists: null, retryable: false };
    if (!match || match[1].length > 64 || normalized.length > 254) {
      return { ...result, code: 'INVALID_EMAIL', message: 'Nhập email hợp lệ thuộc mail.com hoặc tên miền được mail.com cung cấp; không dùng alias +tag.' };
    }
    try {
      if (!this.session) {
        const failure = await this._loadSession();
        if (failure) return { ...result, ...failure };
      }
      const session = this.session;
      if (!session.domains.has(match[2])) {
        return { ...result, code: 'UNSUPPORTED_DOMAIN', message: 'Tên miền này không nằm trong danh sách đăng ký email của mail.com.' };
      }
      const response = await this._makeRequest({
        method: 'post', url: CHECK_URL,
        headers: {
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/vnd.ui.mam.suggestion.creation-v1+json',
          'X-UI-APP': session.appIdentifier, 'X-CCGUID': session.guid, 'X-REQUEST-ID': randomUUID(),
          Origin: 'https://signup.mail.com', Referer: SIGNUP_URL,
        },
        data: {
          emailAddress: normalized, firstName: '', lastName: '', birthDate: '', city: '',
          countryCode: session.countryCode, initialRequestedEmailAddress: '',
          requestedEmailAddressProduct: 'mailcomFree', suggestionProducts: ['mailcomFree'],
          maxResultCountToProduct: { mailcomFree: '4' }, mdhMaxResultCount: '0',
        },
      });
      if (response.status !== 200) return { ...result, ...this._failure(response) };
      const data = response.data;
      if (typeof data?.emailAddressAvailable !== 'boolean' ||
          typeof data?.requestedEmailAddress !== 'string' || data.requestedEmailAddress.toLowerCase() !== normalized) {
        return { ...result, ...this._failure(response, 'UNEXPECTED_RESPONSE',
          'Phản hồi mail.com không đúng định dạng hoặc không khớp email đã yêu cầu. Chưa thể kết luận.') };
      }
      const available = data.emailAddressAvailable;
      return { ...result, status: 'success', availability: available ? 'available' : 'unavailable',
        available, exists: available ? false : null, httpStatus: response.status,
        message: available ? 'Tên email còn khả dụng để đăng ký theo API mail.com.'
          : 'Tên email không khả dụng: đã dùng hoặc bị giữ lại; chưa xác nhận hộp thư đang hoạt động.' };
    } catch (error) {
      const canceled = this.abortSignal?.aborted || axios.isCancel(error);
      const networkError = !canceled && !error.response &&
        (NETWORK_ERROR_CODES.has(error.code) || (axios.isAxiosError(error) && !!error.request));
      return { ...result, retryable: !!networkError, networkError: !!networkError,
        message: canceled ? 'Đã hủy kiểm tra email.' : networkError
          ? 'Không thể kết nối API mail.com hoặc quá thời gian chờ.' : 'Không thể xử lý phản hồi mail.com.',
        errorCode: error.code ?? null };
    }
  }
}

module.exports = MailComClass;
module.exports.retryDelay = retryDelay;
