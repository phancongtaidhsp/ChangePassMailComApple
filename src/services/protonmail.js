const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { normalizeProxyUrl } = require("./proxy");
const { setTimeout: sleep } = require("node:timers/promises");

// Đối chiếu packages/shared/lib/api/{user,auth}.ts của ProtonMail/WebClients.
const API_URL = "https://account.proton.me/api";
const PROTON_DOMAINS = new Set(["proton.me", "protonmail.com", "protonmail.ch", "pm.me"]);
const NETWORK_ERROR_CODES = new Set([
  "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ECONNREFUSED", "ECONNABORTED",
  "ETIMEDOUT", "EPIPE", "ENETUNREACH", "EHOSTUNREACH", "ERR_NETWORK",
  "EHOSTDOWN", "ENETDOWN",
]);
const MAX_NETWORK_RETRIES = 3;

class ProtonMailClass {
  constructor(proxy = null, email, options = {}) {
    this.email = email;
    this.proxy = normalizeProxyUrl(proxy);
    this.abortSignal = null;
    this.timeout = options.timeout ?? 15000;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    // Phiên bản đọc từ trang đăng ký ngày 2026-10-13; có thể ghi đè khi Proton cập nhật.
    this.appVersion = options.appVersion ?? "web-account@5.0.427.0";
    this.uid = null;
    this.accessToken = null;
  }

  async _makeRequest(config) {
    return axios({
      ...config,
      url: `${API_URL}/${config.url}`,
      headers: {
        Accept: "application/vnd.protonmail.v1+json",
        "Content-Type": "application/json",
        "x-pm-appversion": this.appVersion,
        "x-pm-apiversion": "3",
        "x-pm-locale": "en_US",
        Origin: "https://account.proton.me",
        Referer: "https://account.proton.me/vi/mail/signup",
        ...(this.uid && this.accessToken ? {
          "x-pm-uid": this.uid,
          Authorization: `Bearer ${this.accessToken}`,
        } : {}),
      },
      httpsAgent: this.proxy ? new HttpsProxyAgent(this.proxy) : undefined,
      proxy: false,
      timeout: this.timeout,
      signal: this.abortSignal,
      maxRedirects: 0,
      validateStatus: () => true,
    });
  }

  _failure(response) {
    const code = response.data?.Code;
    const httpStatus = response.status;
    const verificationRequired = code === 9001 || code === 9002;
    return {
      status: "error", availability: "unknown", exists: null, available: null,
      code: code ?? null, httpStatus,
      retryable: !verificationRequired && (httpStatus === 429 || httpStatus >= 500),
      verificationRequired,
      retryAfter: response.headers?.["retry-after"] ?? null,
      message: verificationRequired
        ? "Proton yêu cầu xác minh; chưa thể kết luận email."
        : code === 5003
          ? "Proton không còn hỗ trợ appVersion này; cần cập nhật appVersion."
          : `Không thể kiểm tra email (HTTP ${httpStatus}, Code ${code ?? "không có"}).`,
    };
  }

  /**
   * Chỉ kiểm tra khả năng đăng ký, không đăng ký tài khoản hay gửi email.
   * exists=false: API cho phép đăng ký; exists=null: không đủ bằng chứng.
   * unavailable KHÔNG chứng minh hộp thư tồn tại/đang hoạt động: tên có thể bị giữ lại.
   * Không tự retry 429/CAPTCHA. Bên gọi có thể dùng retryable và retryAfter.
   */
  async CheckEmail(email = this.email) {
    // Ngân sách chung cho cả tạo phiên và kiểm tra: 1 lần đầu + tối đa 3 lần thử lại.
    for (let retries = 0; retries <= MAX_NETWORK_RETRIES; retries++) {
      const result = await this._checkEmailOnce(email);
      if (!result.networkError || retries === MAX_NETWORK_RETRIES) return { ...result, retries };
      try {
        await sleep(this.retryDelayMs, undefined, { signal: this.abortSignal || undefined });
      } catch (error) {
        if (error.name !== "AbortError") throw error;
        return { ...result, retries, networkError: false, retryable: false,
          message: "Đã hủy kiểm tra email.", errorCode: "ERR_CANCELED" };
      }
    }
  }

  async _checkEmailOnce(email) {
    const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
    const match = /^([a-z0-9][a-z0-9._-]*)@([a-z0-9.-]+)$/.exec(normalized);
    const result = {
      email: normalized, status: "error", availability: "unknown",
      available: null, exists: null, retryable: false,
    };
    if (!match || match[1].length > 64 || !PROTON_DOMAINS.has(match[2])) {
      return { ...result, message: "Nhập email Proton hợp lệ thuộc proton.me, protonmail.com, protonmail.ch hoặc pm.me; không dùng alias +tag hay tên miền riêng." };
    }

    try {
      if (!this.uid || !this.accessToken) {
        const session = await this._makeRequest({ method: "post", url: "auth/v4/sessions", data: {} });
        if (session.status !== 200 || session.data?.Code !== 1000 ||
            typeof session.data?.UID !== "string" || !session.data.UID ||
            typeof session.data?.AccessToken !== "string" || !session.data.AccessToken) {
          return { ...result, ...this._failure(session) };
        }
        this.uid = session.data.UID;
        this.accessToken = session.data.AccessToken;
      }

      const response = await this._makeRequest({
        method: "get", url: "core/v4/users/available",
        params: { Name: normalized, ParseDomain: 1 },
      });
      if (response.status === 401) {
        this.uid = null;
        this.accessToken = null;
      }
      if (response.status === 200 && response.data?.Code === 1000) {
        return { ...result, status: "success", availability: "available", available: true,
          exists: false, message: "Tên email còn khả dụng để đăng ký theo API Proton." };
      }
      if ([400, 409, 422].includes(response.status) && response.data?.Code === 12106) {
        return { ...result, status: "success", availability: "unavailable", available: false,
          code: 12106, message: "Tên email không khả dụng: đã được dùng hoặc bị giữ lại; chưa xác nhận hộp thư tồn tại." };
      }
      return { ...result, ...this._failure(response) };
    } catch (error) {
      const canceled = this.abortSignal?.aborted || axios.isCancel(error);
      const networkError = !canceled && !error.response &&
        (NETWORK_ERROR_CODES.has(error.code) || (axios.isAxiosError(error) && !!error.request));
      return { ...result, retryable: !!networkError, networkError: !!networkError,
        message: canceled ? "Đã hủy kiểm tra email." : "Không thể kết nối API Proton hoặc quá thời gian chờ.",
        errorCode: error.code ?? null };
    }
  }
}

module.exports = ProtonMailClass;
