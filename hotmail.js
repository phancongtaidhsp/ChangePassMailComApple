const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");

function logWithTime(level, msg) {
  const now = new Date().toISOString();
  console.log(`[${now}] [${level.toUpperCase()}] ${msg}`);
}

class HotmailClass {

  constructor(proxy = null, email, password, mkp = null, recoveryEmail = null) {
    this.email = email;
    this.password = password;
    this.mkp = mkp;
    this.proxy = proxy;
    this.mkt = "en-US";
    this.smsSite = "autosms.site";
    this.smsKey = "";
    this.mailSite = "fviainboxes.com";
    this.mailIsOg = true;
    this.mailCustomStr = "";
    this.passIsRandom = true;
    this.passCustomValue = "";
    this.retrySms = 10;
    this.delaySms = 60;
    this.captchaKey = null;
    this.retryCaptcha = 3;
    this.delayCaptcha = 40;
    this.proxyMkp = false;
    this.proxyCaptcha = false;

    // State
    this.cookie = null;
    this.html = null;
    this.uaid = null;
    this.flowtoken = null;
    this.apiCanary = null;
    this.urlGetCredential = null;
    this.urlPostMsa = null;
    this.ppsx = null;
    this.sRandomBlob = null;
    this.urlRU = null;
    this.hpgid = null;
    this.pprid = null;
    this.ipt = null;
    this.tcxt = null;
    this.eipt = null;
    this.epid = null;
    this.token = null;
    this.newPass = null;
    this.otp = null;
    this.phone = null;
    this.recoveryEmail = null;
    this.phoneFormat = null;
    this.recommendedChallengeRiskScore = null;
    this.blob = null;
    this.username = email;
  }

  // ─────────────────────────────────────────────
  // MAKE REQUEST (giống MakeRequest C#)
  // ─────────────────────────────────────────────
  async _makeRequest(config, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const agent = this.proxy ? new HttpsProxyAgent(this.proxy) : undefined;
        const headers = {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
          ...config.headers,
        };
        if (this.cookie) headers["Cookie"] = this.cookie;

        const response = await axios({
          ...config,
          headers,
          httpsAgent: agent,
          validateStatus: () => true,
          maxRedirects: 0,
          timeout: 15000,
        });

        this._setCookie(response.headers);
        return response;
      } catch (ex) {
        logWithTime("warn", `${this.username} Lỗi request lần ${attempt + 1}: ${ex.message}`);
        if (attempt === maxRetries - 1) return null;
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    return null;
  }

  // ─────────────────────────────────────────────
  // SET COOKIE (giống SetCookie C#)
  // ─────────────────────────────────────────────
  _setCookie(headers) {
    const setCookieHeader = headers["set-cookie"];
    if (!setCookieHeader) return;
    const existing = this._parseCookie(this.cookie);
    const list = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const c of list) {
      const part = c.split(";")[0].split("=");
      if (part.length >= 2) {
        existing[part[0].trim()] = part.slice(1).join("=").trim();
      }
    }
    this.cookie = Object.entries(existing).map(([k, v]) => `${k}=${v}`).join("; ");
  }

  _parseCookie(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;
    for (const pair of cookieHeader.split(";")) {
      const parts = pair.split("=");
      if (parts.length >= 2) {
        const key = parts[0].trim();
        if (key) cookies[key] = parts.slice(1).join("=").trim();
      }
    }
    return cookies;
  }

  // ─────────────────────────────────────────────
  // FOLLOW REDIRECT (helper)
  // ─────────────────────────────────────────────
  async _followRedirect(response, html, logMsg) {
    const isRedirect = html?.includes("Object moved") || response?.headers?.location;
    if (!isRedirect) return html;
    logWithTime("info", `${this.username} ${logMsg}`);
    let redirectUrl = response?.headers?.location;
    if (!redirectUrl) {
      const m = html?.match(/href="([^"]+)"/);
      if (m) redirectUrl = m[1].replace(/&amp;/g, "&");
    }
    if (!redirectUrl) return null;
    logWithTime("info", `${this.username} Redirect to: ${redirectUrl}`);
    const newRes = await this._makeRequest({ method: "get", url: redirectUrl });
    return newRes?.data ?? null;
  }

  // ─────────────────────────────────────────────
  // UNLOCK ASYNC
  // ─────────────────────────────────────────────
  async Unlock() {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await this.UnlockInternalAsync();
      if (result.message === "Tài khoản không tồn tại #2" || result.message === "Đăng nhập thất bại #429") {
        logWithTime("info", `${this.username} ${result.message} - thử lại lần ${attempt}/${maxRetries}...`);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
          this.cookie = null;
          continue;
        }
      }
      return result;
    }
    return { status: "error", message: "Tài khoản không tồn tại #2 (đã thử 3 lần)" };
  }

  // ─────────────────────────────────────────────
  // UNLOCK INTERNAL
  // ─────────────────────────────────────────────
  async UnlockInternalAsync() {
    try {
      const loginUrl = `https://login.live.com/login.srf?mkt=${this.mkt}&wa=wsignin1.0&rpsnv=15&ct=1691141884&rver=7.0.6737.0&wp=MBI_SSL&wreply=https%3a%2f%2foutlook.live.com%2fowa%2f%3fnlp%3d1%26RpsCsrfState%3dd7a5dc50-1baa-7441-e411-465bdcd16528&id=292841&aadredir=1&CBCXT=out&lw=1&fl=dob%2cflname%2cwld&cobrandid=90015`;

      const initialResponse = await this._makeRequest({ method: "get", url: loginUrl });
      if (!initialResponse || initialResponse.status !== 200)
        return { status: "error", message: "Không thể tải trang đăng nhập" };

      this.html = initialResponse.data;

      const serverDataMatch = this.html.match(/var ServerData\s*=\s*(.*?);/s);
      if (!serverDataMatch) return { status: "error", message: "Không tìm thấy ServerData" };

      let serverData;
      try { serverData = JSON.parse(serverDataMatch[1]); }
      catch { return { status: "error", message: "Không parse được ServerData" }; }

      const sFTTagHtml = serverData?.sFTTag ?? "";
      this.flowtoken = sFTTagHtml.match(/value=["']([^"']+)["']/)?.[1] ?? "";
      this.urlGetCredential = serverData?.urlGetCredentialType ?? "";
      this.urlPostMsa = serverData?.urlPostMsa ?? "";
      this.ppsx = serverData?.sPPSX ?? "";
      this.sRandomBlob = serverData?.sRandomBlob ?? "";

      if (this.urlGetCredential) {
        try { this.uaid = new URL(this.urlGetCredential).searchParams.get("uaid") ?? ""; } catch { }
      }

      if (!this.flowtoken || !this.urlPostMsa)
        return { status: "error", message: "Không đủ thông tin để đăng nhập" };

      const credResponse = await this._makeRequest({
        method: "post",
        url: this.urlGetCredential,
        headers: {
          "Content-Type": "application/json",
          "client-request-id": this.uaid,
          correlationid: this.uaid,
          Referer: "https://login.live.com/",
        },
        data: JSON.stringify({
          checkPhones: false,
          federationFlags: 3,
          flowToken: this.flowtoken,
          isFidoSupported: true,
          isRemoteNGCSupported: true,
          uaid: this.uaid,
          username: this.email,
        }),
      });

      if (!credResponse) return { status: "error", message: "Không thể kiểm tra tài khoản" };

      const credJson = credResponse.data;
      if (credJson?.IfExistsResult === 1)
        return { status: "error", message: "Tài khoản không tồn tại #1" };

      // const proofs = credJson?.Credentials?.OtcLoginEligibleProofs;
      // if (Array.isArray(proofs)) {
      //   for (const p of proofs) {
      //     const display = p?.display?.toString().trim();
      //     const type = p?.type;
      //     if (display) {
      //       if (display.includes("@"))
      //         return { status: "error", message: `Dính mail khôi phục: ${display}` };
      //       if (type === 3)
      //         return { status: "error", message: `Dính SĐT khôi phục: ${display} (Số cuối: ${p?.clearDigits}, Quốc gia: ${p?.ctryISO})` };
      //     }
      //   }
      // }

      logWithTime("info", `${this.username} nhập mật khẩu`);
      const loginResponse = await this._makeRequest({
        method: "post",
        url: this.urlPostMsa,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: "https://login.live.com/",
          Host: "login.live.com",
          Origin: "https://login.live.com",
        },
        data: new URLSearchParams({
          ps: "2", psRNGCDefaultType: "", psRNGCEntropy: "", psRNGCSLK: "",
          canary: "", ctx: "", hpgrequestid: "",
          PPFT: this.flowtoken,
          PPSX: this.sRandomBlob || this.ppsx || "",
          NewUser: "1", FoundMSAs: "", fspost: "0", i21: "0",
          CookieDisclosure: "0", IsFidoSupported: "1",
          isSignupPost: "0", isRecoveryAttemptPost: "0", i13: "0",
          login: this.email, loginfmt: this.email,
          type: "11", LoginOptions: "3",
          lrt: "", lrtPartition: "", hisRegion: "", hisScaleUnit: "",
          passwd: this.password,
        }).toString(),
      });

      if (!loginResponse || loginResponse.status === 400)
        return { status: "error", message: "Too Many Requests #400" };
      if (loginResponse.status !== 200)
        return { status: "error", message: `Đăng nhập thất bại #${loginResponse.status}` };

      this.html = loginResponse.data;

      const sdLoginMatch = this.html.match(/var ServerData\s*=\s*(.*?);/s);
      if (sdLoginMatch) {
        try {
          const sdLogin = JSON.parse(sdLoginMatch[1]);
          const sPageId = sdLogin?.sPageId;
          if (sPageId === "i5030") return { status: "failed", message: "Sai mật khẩu" };
          if (sPageId === "i5026") return { status: "failed", message: "Tài khoản không tồn tại #2" };
          if (sPageId === "i5245") return { status: "success", message: "Đăng nhập thành công" };
        } catch { }
      }

      const actionMatch = this.html.match(/action="([^"]+)"/);
      if (!actionMatch) return { status: "error", message: "Không tìm thấy action URL" };

      let formType = "";
      try { formType = new URL(actionMatch[1]).pathname.replace(/^\//, ""); }
      catch { formType = actionMatch[1]; }

      logWithTime("info", `${this.username} Form type: ${formType}`);
      
      switch (formType) {
        case "notice":
        case "proofs/Add":
        case "interrupt/passkey":
          return { status: "success", message: "Đăng nhập thành công" };
        case "recover":
          return { status: "success", message: "Đăng nhập thành công" };
          // return await this.Unlock2Process();
        case "Abuse":
          return { status: "success", message: "Đăng nhập thành công" };
          // return await this.AddPhoneProcess();
        case "RecoverAccount":
        case "family/child-consent/child-landing":
          return { status: "success", message: "Đăng nhập thành công" };
          // return { status: "error", message: "Không thể mở khóa dạng này" };
        case "tou/accrue":
        case "profile/accrue":
          return { status: "success", message: "Đăng nhập thành công" };
          // return await this.HandleAccrue();
        case "identity/confirm":
          return { status: "success", message: "Đăng nhập thành công" };
        default:
          return { status: "error", message: `Form không xác định: ${formType}` };
      }
    } catch (ex) {
      return { status: "error", message: `Lỗi đăng nhập: ${ex.message}` };
    }
  }

  // ─────────────────────────────────────────────
  // UNLOCK DẠNG 2
  // ─────────────────────────────────────────────
  async Unlock2Process() {
    try {
      logWithTime("info", `${this.username} Mở Khóa Dạng 2`);

      const proofsUrl = "https://account.live.com/proofs/add";
      let response = await this._makeRequest({ method: "get", url: proofsUrl });
      if (!response) return { status: "error", message: "Không thể truy cập trang thêm số điện thoại" };

      this.html = response.data;
      if (response.status === 301 || response.status === 302 || this.html?.includes("Object moved")) {
        const m = this.html.match(/href="([^"]+)"/);
        if (m) {
          response = await this._makeRequest({ method: "get", url: m[1].replace(/&amp;/g, "&") });
          if (response) this.html = response.data;
        }
      }

      const actionM = this.html.match(/action="([^"]+)"/);
      const ppridM = this.html.match(/id="pprid" value="([^"]+)"/);
      const iptM = this.html.match(/id="ipt" value="([^"]+)"/);
      const uaidM = this.html.match(/id="uaid" value="([^"]+)"/);
      if (!actionM || !ppridM || !iptM || !uaidM)
        return { status: "error", message: "Không thể lấy thông tin form" };

      const urlAdd = actionM[1];
      this.pprid = ppridM[1]; this.ipt = iptM[1]; this.uaid = uaidM[1];

      response = await this._makeRequest({
        method: "post", url: urlAdd,
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://login.live.com" },
        data: new URLSearchParams({ pprid: this.pprid, ipt: this.ipt, uaid: this.uaid }).toString(),
      });
      if (!response) return { status: "error", message: "Không thể submit form" };
      this.html = response.data;

      const nextUrlM = this.html.match(/action="([^"]+)"/);
      const canaryM = this.html.match(/name="canary" value="([^"]+)"/);
      if (!nextUrlM || !canaryM)
        return { status: "error", message: "Đã có mail khôi phục trước đó hoặc không thể tiếp tục" };

      const nextUrl = nextUrlM[1];
      const canary = canaryM[1];
      this.apiCanary = canary;

      logWithTime("info", `${this.username} Lấy số điện thoại`);
      const phone = await this.GetPhone();
      if (!phone) return { status: "error", message: "Không thể lấy số điện thoại" };
      this.phone = phone.number;

      response = await this._makeRequest({
        method: "post", url: nextUrl,
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://account.live.com", Referer: urlAdd },
        data: new URLSearchParams({
          iProofOptions: "Phone", DisplayPhoneCountryISO: "US",
          DisplayPhoneNumber: phone.number, EmailAddress: "",
          canary, action: "AddProof",
          PhoneNumber: phone.number, PhoneCountryISO: "US",
        }).toString(),
      });
      if (!response) return { status: "error", message: "Không thể thêm số điện thoại" };
      this.html = response.data;

      // Redirect 1
      if (response.status === 301 || response.status === 302 || response.status === 303 || this.html?.includes("Object moved")) {
        logWithTime("info", `${this.username} Đang follow redirect 1...`);
        let redirectUrl = response.headers?.location;
        if (!redirectUrl) { const m = this.html.match(/href="([^"]+)"/); if (m) redirectUrl = m[1].replace(/&amp;/g, "&"); }
        if (!redirectUrl) return { status: "error", message: "Không tìm thấy URL redirect" };
        logWithTime("info", `${this.username} Redirect to: ${redirectUrl}`);
        response = await this._makeRequest({ method: "get", url: redirectUrl });
        if (!response) return { status: "error", message: "Không thể follow redirect" };
        this.html = response.data;
      }

      // Abuse challenge
      const abuseM = this.html.match(/id="challengeForm"[^>]+action="([^"]+)"/);
      const vCanaryM = this.html.match(/id="canary"[^>]+value="([^"]+)"/);
      const epidM = this.html.match(/id="epid"[^>]+value="([^"]+)"/);
      if (!abuseM || !vCanaryM || !epidM) {
        await this.CancelOtp(phone.id);
        return { status: "error", message: `Block thêm sdt ${phone.number}` };
      }

      response = await this._makeRequest({
        method: "post", url: abuseM[1],
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://account.live.com" },
        data: new URLSearchParams({ isChallengeSolved: "1", canary: vCanaryM[1], epid: epidM[1], hsid: "15022" }).toString(),
      });
      if (!response) return { status: "error", message: "Không thể submit abuse challenge" };
      this.html = response.data;

      // Redirect 2
      if (response.status === 301 || response.status === 302 || response.status === 303 || this.html?.includes("Object moved")) {
        logWithTime("info", `${this.username} Đang tải...`);
        let redirectUrl = response.headers?.location;
        if (!redirectUrl) { const m = this.html.match(/href="([^"]+)"/); if (m) redirectUrl = m[1].replace(/&amp;/g, "&"); }
        if (!redirectUrl) return { status: "error", message: "Không tìm thấy URL redirect" };
        response = await this._makeRequest({ method: "get", url: redirectUrl });
        if (!response) return { status: "error", message: "Không thể follow redirect" };
        this.html = response.data;
      }

      // Redirect 3
      if (response.status === 301 || response.status === 302 || response.status === 303 || this.html?.includes("Object moved")) {
        logWithTime("info", `${this.username} Đang tải...`);
        let redirectUrl = response.headers?.location;
        if (!redirectUrl) { const m = this.html.match(/href="([^"]+)"/); if (m) redirectUrl = m[1].replace(/&amp;/g, "&"); }
        if (!redirectUrl) return { status: "error", message: "Không tìm thấy URL redirect" };
        logWithTime("info", `${this.username} Redirect to: ${redirectUrl}`);
        response = await this._makeRequest({ method: "get", url: redirectUrl });
        if (!response) return { status: "error", message: "Không thể follow redirect" };
        this.html = response.data;
      }

      // Parse verify OTP
      const verifyUrlM = this.html.match(/id="frmVerifyProof"[^>]+action="([^"]+)"/);
      const verifyCanM2 = this.html.match(/id="canary"[^>]+value="([^"]+)"/);
      if (!verifyUrlM || !verifyCanM2) {
        logWithTime("warn", `${this.username} Parse verify failed: url=${!!verifyUrlM}, canary=${!!verifyCanM2}`);
        if (this.html.includes("HumanCaptcha") || this.html.includes("beat the robots"))
          logWithTime("warn", `${this.username} Cần giải CAPTCHA trước.`);
        await this.CancelOtp(phone.id);
        return { status: "error", message: "Không thể lấy thông tin xác minh từ hệ thống Microsoft" };
      }

      const verifyUrl = verifyUrlM[1];
      const verifyCanary = verifyCanM2[1];

      logWithTime("info", `${this.username} Đang chờ OTP...`);
      await new Promise(r => setTimeout(r, 3000));

      const otpRaw = await this.CheckOtp(phone.id);
      if (!otpRaw) {
        logWithTime("warn", `${this.username} Không về mã OTP`);
        await this.CancelOtp(phone.id);
        return { status: "error", message: `Không về mã OTP|${phone.number}` };
      }

      const otp = otpRaw.trim().replace(/[\r\n ]/g, "");
      logWithTime("info", `${this.username} OTP nhận được: [${otp}]`);

      const submitData = new URLSearchParams({
        iProofOptions: "Phone", iOttText: otp,
        action: "VerifyProof", canary: verifyCanary, GeneralVerify: "1",
      }).toString();

      response = null;
      for (let i = 0; i < 3; i++) {
        logWithTime("info", `${this.username} Submit OTP lần ${i + 1}...`);
        response = await this._makeRequest({
          method: "post", url: verifyUrl,
          headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://account.live.com", Referer: verifyUrl },
          data: submitData,
        });
        if (response) break;
        logWithTime("warn", `${this.username} Submit OTP lần ${i + 1} thất bại, thử lại sau 2s...`);
        await new Promise(r => setTimeout(r, 2000));
      }
      if (!response) return { status: "error", message: "Submit OTP thất bại sau 3 lần thử" };

      let responseContent = response.data;

      // Redirect sau OTP
      if (response.status === 301 || response.status === 302 || response.status === 303 || responseContent?.includes("Object moved")) {
        logWithTime("info", `${this.username} Follow redirect sau submit OTP...`);
        let redirectUrl = response.headers?.location;
        if (!redirectUrl) { const m = responseContent.match(/href="([^"]+)"/); if (m) redirectUrl = m[1].replace(/&amp;/g, "&"); }
        if (redirectUrl) {
          logWithTime("info", `${this.username} Đang tải...`);
          response = await this._makeRequest({ method: "get", url: redirectUrl });
          if (response) responseContent = response.data;
        }
      }

      // Lưu phiên slt
      const sltM = responseContent?.match(/name="slt" value="([^"]+)"/);
      if (sltM) {
        logWithTime("info", `${this.username} Submit OTP thành công...`);
        response = await this._makeRequest({
          method: "post",
          url: "https://login.live.com/ppsecure/post.srf?lc=1033",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          data: new URLSearchParams({ slt: sltM[1] }).toString(),
        });
        responseContent = response?.data;
        logWithTime("info", `${this.username} Xác thực hoàn tất!`);
      }

      // Vào trang đổi pass
      const actionM2 = responseContent?.match(/action="([^"]+)"/);
      const ppridM2 = responseContent?.match(/id="pprid" value="([^"]+)"/);
      const iptM2 = responseContent?.match(/id="ipt" value="([^"]+)"/);
      const uaidM2 = responseContent?.match(/id="uaid" value="([^"]+)"/);
      if (!actionM2 || !ppridM2 || !iptM2 || !uaidM2)
        return { status: "error", message: "Không thể lấy thông tin form" };

      const urlAdd2 = actionM2[1];
      this.urlRU = urlAdd2;
      this.pprid = ppridM2[1]; this.ipt = iptM2[1]; this.uaid = uaidM2[1];

      response = await this._makeRequest({
        method: "post", url: urlAdd2,
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://login.live.com" },
        data: new URLSearchParams({ pprid: this.pprid, ipt: this.ipt, uaid: this.uaid }).toString(),
      });
      if (!response) return { status: "error", message: "Không thể submit form" };
      responseContent = response.data;
      this.html = responseContent;

      if (responseContent?.includes("frmVerifyProof")) {
        logWithTime("warn", `${this.username} Vẫn ở trang verify — OTP sai hoặc hết hạn`);
        await this.CancelOtp(phone.id);
        return { status: "error", message: `OTP không hợp lệ hoặc đã hết hạn|${this.phone}` };
      }

      logWithTime("info", `${this.username} Submit OTP thành công! Thêm số điện thoại OK`);

      const changeResult = await this.ChangePass();
      if (!changeResult.success) return { status: "error", message: changeResult.message };
      return { status: "success", message: changeResult.message, phone: this.phone, account: `${this.email}|${this.newPass}|${this.recoveryEmail}` };

    } catch (ex) {
      return { status: "error", message: `Lỗi: ${ex.message}` };
    }
  }

  // ─────────────────────────────────────────────
  // CHANGE PASS
  // ─────────────────────────────────────────────
  async ChangePass() {
    try {
      const t0JsonStr = this._extractT0Json(this.html);
      if (!t0JsonStr) return { success: false, message: "Không tìm thấy t0 config trong HTML" };

      const config = JSON.parse(t0JsonStr);
      this.tcxt = config?.clientTelemetry?.tcxt;
      this.apiCanary = config?.apiCanary;
      this.eipt = config?.eipt;
      this.token = config?.WLXAccount?.accountCompromised?.viewContext?.data?.token;

      const rawProofListStr = config?.WLXAccount?.accountCompromised?.viewContext?.viewContext?.data?.rawProofList;
      if (rawProofListStr) {
        try {
          const proofList = JSON.parse(rawProofListStr);
          if (Array.isArray(proofList)) {
            for (const proof of proofList) {
              const epidVal = proof?.epid?.toString();
              if (epidVal) { this.epid = epidVal; break; }
            }
          }
        } catch { }
      }

      logWithTime("info", `${this.username} token=${this.token ?? "NULL"}, canary=${this.apiCanary ? "OK" : "NULL"}, tcxt=${this.tcxt ? "OK" : "NULL"}`);
      if (!this.token) return { success: false, message: "Không lấy được token xác thực" };
      if (!this.apiCanary) return { success: false, message: "Không lấy được apiCanary" };

      let newPassword = this._generatePassword(10);
      logWithTime("info", `${this.username} Đổi mật khẩu: ${newPassword}`);

      const buildHeaders = (hpgid) => ({
        "Content-Type": "application/json",
        canary: this.apiCanary,
        eipt: this.eipt,
        hpgid: String(hpgid),
        host: "account.live.com",
        origin: "https://account.live.com",
        scid: "100102",
        tcxt: this.tcxt,
        uaid: this.uaid,
        uiflvr: "1001",
        referer: this.urlRU,
      });

      // Event 1 - ClientEvents
      logWithTime("info", `${this.username} Gửi ClientEvents...`);
      const now = Date.now();
      const r1 = await this._makeRequest({
        method: "post",
        url: "https://account.live.com/API/ClientEvents",
        headers: buildHeaders("200489"),
        data: JSON.stringify({
          evts: [{
            perf: {
              data: {
                navigation: { type: 0, redirectCount: 0 },
                timing: {
                  navigationStart: now - 1500, responseStart: now - 300, responseEnd: now - 294,
                  domLoading: now - 280, domInteractive: now - 100,
                  domContentLoadedEventStart: now - 100, domContentLoadedEventEnd: now - 85,
                  customLoadEventEnd: now - 80, loadEventStart: 0, loadEventEnd: 0,
                  domComplete: 0, connectStart: now - 1500, connectEnd: now - 1500,
                  fetchStart: now - 1500, requestStart: now - 1497,
                  redirectStart: 0, redirectEnd: 0, unloadEventStart: 0, unloadEventEnd: 0,
                  secureConnectionStart: 0, domainLookupStart: now - 1500, domainLookupEnd: now - 1500,
                },
                entries: [],
                connection: { effectiveType: "4g", rtt: 100, downlink: 10, saveData: false },
              },
              tm: 1412,
            },
          }],
          cm: {
            uiflvr: 1001, scid: 100102, hpgid: 200489,
            tcxt: this.tcxt, uaid: this.uaid,
            svr: { dc: "eastus", ri: "eusXXXX059W", ver: { v: [2, 0, 4390, 0] } },
            hst: "account.live.com", nt: "4g", av: null,
          },
          tm: 1422,
        }),
      });
      if (r1?.data?.cm?.api) this.apiCanary = r1.data.cm.api;
      if (r1?.data?.cm?.tcxt) this.tcxt = r1.data.cm.tcxt;

      // Event 2 - ReportClientEvent 200490
      logWithTime("info", `${this.username} Gửi ReportClientEvent 200490...`);
      const r2 = await this._makeRequest({
        method: "post",
        url: `https://account.live.com/API/ReportClientEvent?mkt=${this.mkt}&uiflavor=web&id=38936&lmif=80&sotc=1&ru=${encodeURIComponent(this.urlRU)}`,
        headers: buildHeaders("200490"),
        data: JSON.stringify({
          pageApiId: 200490, clientDetails: [], country: "", userAction: "", source: "PageView",
          clientTelemetryData: {
            category: "PageLoad", pageName: "200490",
            eventInfo: {
              timestamp: Date.now(), perceivedPlt: 1411, networkLatency: 1214,
              enforcementSessionToken: null, humanSessionUuid: null, humanSessionVid: null,
              humanIframeErrorMessage: null, humanIframeErrorSource: null, humanIframeErrorLine: null,
              humanIframeErrorColumn: null, humanIframeErrorStack: null,
              appVersion: null, networkType: null, precaching: null,
              bundleVersion: null, deviceYear: null, isMaster: null, bundleHits: null, bundleMisses: null,
            },
          },
          cxhFunctionRes: null, netId: null,
          uiflvr: 1001, uaid: this.uaid, scid: 100102, hpgid: 200490,
        }),
      });
      if (r2?.data?.apiCanary) this.apiCanary = r2.data.apiCanary;
      if (r2?.data?.telemetryContext) this.tcxt = r2.data.telemetryContext;

      // Event 3 - ReportClientEvent 200242
      logWithTime("info", `${this.username} Gửi ReportClientEvent 200242...`);
      const r3 = await this._makeRequest({
        method: "post",
        url: `https://account.live.com/API/ReportClientEvent?mkt=${this.mkt}&uiflavor=web&id=38936&lmif=80&sotc=1&ru=${encodeURIComponent(this.urlRU)}`,
        headers: buildHeaders("200242"),
        data: JSON.stringify({
          pageApiId: 200242, clientDetails: [], country: "", userAction: "", source: "PageView",
          clientTelemetryData: {
            category: "PageView", pageName: "200242",
            eventInfo: {
              timestamp: Date.now(),
              enforcementSessionToken: null, humanSessionUuid: null, humanSessionVid: null,
              humanIframeErrorMessage: null, humanIframeErrorSource: null, humanIframeErrorLine: null,
              humanIframeErrorColumn: null, humanIframeErrorStack: null,
              appVersion: null, networkType: null,
            },
          },
          cxhFunctionRes: null, netId: null,
          uiflvr: 1001, uaid: this.uaid, scid: 100102, hpgid: 200242,
        }),
      });
      if (r3?.data?.apiCanary) this.apiCanary = r3.data.apiCanary;
      if (r3?.data?.telemetryContext) this.tcxt = r3.data.telemetryContext;

      // Check password
      logWithTime("info", `${this.username} Kiểm tra mật khẩu...`);
      const rCheck = await this._makeRequest({
        method: "post",
        url: "https://account.live.com/API/CheckIfBannedPassword",
        headers: buildHeaders("200242"),
        data: JSON.stringify({ uaid: this.uaid, password: newPassword, uiflvr: 1001, scid: 100102, hpgid: 200242 }),
      });
      if (rCheck?.data?.apiCanary) this.apiCanary = rCheck.data.apiCanary;
      if (rCheck?.data?.telemetryContext) this.tcxt = rCheck.data.telemetryContext;

      // Đổi mật khẩu
      let passChanged = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        logWithTime("info", `${this.username} Đang đổi pass (lần ${attempt}/3)`);
        const rPass = await this._makeRequest({
          method: "post",
          url: "https://account.live.com/API/ac/NewPassword",
          headers: buildHeaders("200242"),
          data: JSON.stringify({
            token: this.token, expiryEnabled: null, password: newPassword,
            uiflvr: 1001, uaid: this.uaid, scid: 100102, hpgid: 200242,
          }),
        });

        if (!rPass) {
          logWithTime("warn", `${this.username} Request null lần ${attempt}`);
          if (attempt === 3) return { success: false, message: "Lỗi kết nối khi đổi pass" };
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        const resPass = rPass.data;
        const resStr = typeof resPass === "string" ? resPass : JSON.stringify(resPass);
        if (resStr.includes("Object moved") || resStr.trimStart().startsWith("<")) {
          logWithTime("warn", `${this.username} Bị redirect lần ${attempt}`);
          if (attempt === 3) return { success: false, message: "Session hết hạn khi đổi pass" };
          newPassword = `${newPassword}@${attempt}`;
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        const jPass = typeof resPass === "object" ? resPass : null;
        if (jPass?.apiCanary) {
          this.apiCanary = jPass.apiCanary;
          logWithTime("info", `${this.username} Đổi pass thành công!`);
          passChanged = true;
          break;
        }

        logWithTime("warn", `${this.username} Đổi pass thất bại lần ${attempt}`);
        newPassword = `${newPassword}@${attempt}`;
        if (attempt === 3) return { success: false, message: "Đổi pass thất bại sau 3 lần thử" };
        await new Promise(r => setTimeout(r, 2000));
      }

      if (!passChanged) return { success: false, message: "Đổi pass thất bại" };
      this.newPass = newPassword;

      // Thêm mail khôi phục
      const newRecoveryEmail = await this._generateEmail();
      logWithTime("info", `${this.username} Thêm mail khôi phục: ${newRecoveryEmail}`);

      const rCollect = await this._makeRequest({
        method: "post",
        url: "https://account.live.com/API/ac/CollectProofs",
        headers: buildHeaders("200499"),
        data: JSON.stringify({
          token: this.token, proofType: "email", password: newPassword,
          proofProperties: { idPii: newRecoveryEmail, namePii: newRecoveryEmail, market: "en-US", phoneCountry: null, phoneCountryCode: null },
          uiflvr: 1001, uaid: this.uaid, scid: 100102, hpgid: 200499,
        }),
      });
      if (!rCollect) return { success: false, message: "Lỗi kết nối khi thêm mail khôi phục" };
      this.recoveryEmail = newRecoveryEmail;



      return { success: true, message: "Mở khóa thành công #2", phone: this.phone, account: `${this.email}|${this.password}|${this.recoveryEmail}` };
    } catch (ex) {
      return { success: false, message: `Lỗi: ${ex.message}` };
    }
  }

  // ─────────────────────────────────────────────
  // ADD PHONE PROCESS (Dạng 1)
  // ─────────────────────────────────────────────
  async AddPhoneProcess() {
    try {
      await this._generateEmail();
      logWithTime("info", `${this.username} Bắt đầu thêm số điện thoại`);

      const proofsUrl = "https://account.live.com/proofs/add";
      let response = await this._makeRequest({ method: "get", url: proofsUrl });
      if (!response) return { status: "error", message: "Không thể truy cập trang thêm số điện thoại" };

      this.html = response.data;
      if (response.status === 301 || response.status === 302 || this.html?.includes("Object moved")) {
        const m = this.html.match(/href="([^"]+)"/);
        if (m) {
          response = await this._makeRequest({ method: "get", url: m[1].replace(/&amp;/g, "&") });
          if (response) this.html = response.data;
        }
      }

      const actionM = this.html.match(/action="([^"]+)"/);
      const ppridM = this.html.match(/id="pprid" value="([^"]+)"/);
      const iptM = this.html.match(/id="ipt" value="([^"]+)"/);
      const uaidM = this.html.match(/id="uaid" value="([^"]+)"/);
      if (!actionM || !ppridM || !iptM || !uaidM)
        return { status: "error", message: "Không thể lấy thông tin form" };

      const urlAdd = actionM[1];
      this.pprid = ppridM[1]; this.ipt = iptM[1]; this.uaid = uaidM[1];

      response = await this._makeRequest({
        method: "post", url: urlAdd,
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://login.live.com" },
        data: new URLSearchParams({ pprid: this.pprid, ipt: this.ipt, uaid: this.uaid }).toString(),
      });
      if (!response) return { status: "error", message: "Không thể submit form" };
      this.html = response.data;

      const nextUrlM = this.html.match(/action="([^"]+)"/);
      const canaryM = this.html.match(/name="canary" value="([^"]+)"/);
      if (!nextUrlM || !canaryM)
        return { status: "error", message: "Đã có mail khôi phục trước đó hoặc không thể tiếp tục" };

      const nextUrl = nextUrlM[1];
      const canary = canaryM[1];
      this.apiCanary = canary;

      logWithTime("info", `${this.username} Lấy số điện thoại`);
      const phone = await this.GetPhone();
      if (!phone) return { status: "error", message: "Không thể lấy số điện thoại" };
      this.phone = phone.number;

      response = await this._makeRequest({
        method: "post", url: nextUrl,
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://account.live.com", Referer: urlAdd },
        data: new URLSearchParams({
          iProofOptions: "Phone", DisplayPhoneCountryISO: "US",
          DisplayPhoneNumber: phone.number, EmailAddress: "",
          canary, action: "AddProof",
          PhoneNumber: phone.number, PhoneCountryISO: "US",
        }).toString(),
      });
      if (!response) return { status: "error", message: "Không thể thêm số điện thoại" };
      this.html = response.data;

      // Redirect 1
      if (response.status === 301 || response.status === 302 || response.status === 303 || this.html?.includes("Object moved")) {
        logWithTime("info", `${this.username} Đang follow redirect 1...`);
        let redirectUrl = response.headers?.location;
        if (!redirectUrl) { const m = this.html.match(/href="([^"]+)"/); if (m) redirectUrl = m[1].replace(/&amp;/g, "&"); }
        if (!redirectUrl) return { status: "error", message: "Không tìm thấy URL redirect" };
        logWithTime("info", `${this.username} Redirect to: ${redirectUrl}`);
        response = await this._makeRequest({ method: "get", url: redirectUrl });
        if (!response) return { status: "error", message: "Không thể follow redirect" };
        this.html = response.data;
      }

      // Abuse challenge
      const abuseM = this.html.match(/id="challengeForm"[^>]+action="([^"]+)"/);
      const vCanaryM = this.html.match(/id="canary"[^>]+value="([^"]+)"/);
      const epidM = this.html.match(/id="epid"[^>]+value="([^"]+)"/);
      if (!abuseM || !vCanaryM || !epidM) {
        await this.CancelOtp(phone.id);
        return { status: "error", message: `Block thêm sdt ${phone.number}` };
      }

      response = await this._makeRequest({
        method: "post", url: abuseM[1],
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://account.live.com" },
        data: new URLSearchParams({ isChallengeSolved: "1", canary: vCanaryM[1], epid: epidM[1], hsid: "15022" }).toString(),
      });
      if (!response) return { status: "error", message: "Không thể submit abuse challenge" };
      this.html = response.data;

      // Redirect 2
      if (response.status === 301 || response.status === 302 || response.status === 303 || this.html?.includes("Object moved")) {
        logWithTime("info", `${this.username} Đang tải...`);
        let redirectUrl = response.headers?.location;
        if (!redirectUrl) { const m = this.html.match(/href="([^"]+)"/); if (m) redirectUrl = m[1].replace(/&amp;/g, "&"); }
        if (!redirectUrl) return { status: "error", message: "Không tìm thấy URL redirect" };
        logWithTime("info", `${this.username} Đang tải...`);
        response = await this._makeRequest({ method: "get", url: redirectUrl });
        if (!response) return { status: "error", message: "Không thể follow redirect" };
        this.html = response.data;
      }

      // Redirect 3
      if (response.status === 301 || response.status === 302 || response.status === 303 || this.html?.includes("Object moved")) {
        logWithTime("info", `${this.username} Đang tải...`);
        let redirectUrl = response.headers?.location;
        if (!redirectUrl) { const m = this.html.match(/href="([^"]+)"/); if (m) redirectUrl = m[1].replace(/&amp;/g, "&"); }
        if (!redirectUrl) return { status: "error", message: "Không tìm thấy URL redirect" };
        logWithTime("info", `${this.username} Redirect to: ${redirectUrl}`);
        response = await this._makeRequest({ method: "get", url: redirectUrl });
        if (!response) return { status: "error", message: "Không thể follow redirect" };
        this.html = response.data;
      }

      // Parse verify OTP
      const verifyUrlM = this.html.match(/id="frmVerifyProof"[^>]+action="([^"]+)"/);
      const verifyCanM2 = this.html.match(/id="canary"[^>]+value="([^"]+)"/);
      if (!verifyUrlM || !verifyCanM2) {
        logWithTime("warn", `${this.username} Parse verify failed: url=${!!verifyUrlM}, canary=${!!verifyCanM2}`);
        if (this.html.includes("HumanCaptcha") || this.html.includes("beat the robots"))
          logWithTime("warn", `${this.username} Cần giải CAPTCHA trước.`);
        await this.CancelOtp(phone.id);
        return { status: "error", message: "Không thể lấy thông tin xác minh từ hệ thống Microsoft" };
      }

      const verifyUrl = verifyUrlM[1];
      const verifyCanary = verifyCanM2[1];

      logWithTime("info", `${this.username} Đang chờ OTP...`);
      await new Promise(r => setTimeout(r, 3000));

      const otpRaw = await this.CheckOtp(phone.id);
      if (!otpRaw) {
        logWithTime("warn", `${this.username} Không về mã OTP`);
        await this.CancelOtp(phone.id);
        return { status: "error", message: `Không về mã OTP|${phone.number}` };
      }

      const otp = otpRaw.trim().replace(/[\r\n ]/g, "");
      logWithTime("info", `${this.username} OTP nhận được: [${otp}]`);

      const submitData = new URLSearchParams({
        iProofOptions: "Phone", iOttText: otp,
        action: "VerifyProof", canary: verifyCanary, GeneralVerify: "1",
      }).toString();

      response = null;
      for (let i = 0; i < 3; i++) {
        logWithTime("info", `${this.username} Submit OTP lần ${i + 1}...`);
        response = await this._makeRequest({
          method: "post", url: verifyUrl,
          headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://account.live.com", Referer: verifyUrl },
          data: submitData,
        });
        if (response) break;
        logWithTime("warn", `${this.username} Submit OTP lần ${i + 1} thất bại, thử lại sau 2s...`);
        await new Promise(r => setTimeout(r, 2000));
      }
      if (!response) return { status: "error", message: "Submit OTP thất bại sau 3 lần thử" };

      let responseContent = response.data;

      // Redirect sau OTP
      if (response.status === 301 || response.status === 302 || response.status === 303 || responseContent?.includes("Object moved")) {
        logWithTime("info", `${this.username} Follow redirect sau submit OTP...`);
        let redirectUrl = response.headers?.location;
        if (!redirectUrl) { const m = responseContent.match(/href="([^"]+)"/); if (m) redirectUrl = m[1].replace(/&amp;/g, "&"); }
        if (redirectUrl) {
          logWithTime("info", `${this.username} Đang tải...`);
          response = await this._makeRequest({ method: "get", url: redirectUrl });
          if (response) responseContent = response.data;
        }
      }

      // Lưu phiên slt
      const sltM = responseContent?.match(/name="slt" value="([^"]+)"/);
      if (sltM) {
        logWithTime("info", `${this.username} Submit OTP thành công...`);
        response = await this._makeRequest({
          method: "post",
          url: "https://login.live.com/ppsecure/post.srf?lc=1033",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          data: new URLSearchParams({ slt: sltM[1] }).toString(),
        });
        responseContent = response?.data;
        logWithTime("info", `${this.username} Xác thực hoàn tất!`);
      }

      // Skip thêm mkp
      const formActionM = responseContent?.match(/<form[^>]+action="([^"]*interrupt\/credentialaction[^"]*)"/i);
      if (formActionM) {
        const tokenUrl = formActionM[1];
        this.urlRU = tokenUrl;
        const postData = {};
        const inputTags = [...responseContent.matchAll(/<input\s[^>]*\/?>/gi)];
        for (const tag of inputTags) {
          const nameM = tag[0].match(/name="([^"]*)"/i);
          const valueM = tag[0].match(/value="([^"]*)"/i);
          if (nameM && valueM) {
            postData[nameM[1]] = valueM[1]
              .replace(/&amp;/g, "&").replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
          }
        }

        logWithTime("info", `${this.username} Skip recovery mail...`);
        response = await this._makeRequest({
          method: "post", url: tokenUrl,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          data: new URLSearchParams(postData).toString(),
        });
        this.html = response?.data;
        const newCanary = this.html?.match(/"apiCanary":"([^"]+)"/)?.[1];
        if (newCanary) this.apiCanary = newCanary.replace(/\\u002F/g, "/");
        const newHpgid = this.html?.match(/"hpgid":"([^"]+)"/)?.[1];
        if (newHpgid) this.hpgid = newHpgid;

        if (!this.apiCanary) return { status: "error", message: "Không lấy được API Canary" };

        const evalR = await this._makeRequest({
          method: "post",
          url: "https://account.live.com/API/EvaluateExperimentAssignments",
          headers: {
            "Content-Type": "application/json",
            canary: this.apiCanary,
            "client-request-id": this.uaid,
            correlationid: this.uaid,
            hpgid: this.hpgid,
            Referer: this.urlRU,
          },
          data: JSON.stringify({
            clientExperiments: [{
              parallax: "addprivatebrowsingtexttofabricfooter",
              control: "addprivatebrowsingtexttofabricfooter_control",
              treatments: ["addprivatebrowsingtexttofabricfooter_treatment"],
            }],
          }),
        });
        if (evalR?.data?.apiCanary) this.apiCanary = evalR.data.apiCanary;

        await this._makeRequest({
          method: "post",
          url: "https://account.live.com/api/v1.0/auth/methods/email/skip",
          headers: {
            "Content-Type": "application/json",
            canary: this.apiCanary,
            "client-request-id": this.uaid,
            correlationid: this.uaid,
          },
          data: JSON.stringify({ continuationToken: "email" }),
        });
      }

      if (responseContent?.includes("frmVerifyProof")) {
        logWithTime("warn", `${this.username} OTP sai hoặc hết hạn`);
        await this.CancelOtp(phone.id);
        return { status: "error", message: `OTP không hợp lệ hoặc đã hết hạn|${this.phone}` };
      }

      logWithTime("info", `${this.username} Submit OTP thành công! Thêm số điện thoại OK`);

      const addResult = await this.AddRecoveryMailProcess();
      if (!addResult.success) return { status: "error", message: addResult.message };

      logWithTime("info", `${this.username} Thêm mail khôi phục thành công`);
      return { status: "success", message: "Mở khóa và thêm mkp thành công", phone: this.phone, account: `${this.email}|${this.password}|${this.recoveryEmail}` };

    } catch (ex) {
      return { status: "error", message: `Lỗi: ${ex.message}` };
    }
  }

  // ─────────────────────────────────────────────
  // ADD RECOVERY MAIL
  // ─────────────────────────────────────────────
  async AddRecoveryMailProcess() {
    try {
      logWithTime("info", `${this.username} Mail khôi phục: ${this.recoveryEmail}`);
      const proofsUrl = "https://account.live.com/proofs/add";

      let response = await this._makeRequest({ method: "get", url: proofsUrl });
      let responseContent = response?.data ?? "";

      // Redirect lần đầu
      if (response?.status === 301 || response?.status === 302 || response?.status === 303 || responseContent?.includes("Object moved")) {
        logWithTime("info", `${this.username} Đang tải...`);
        let redirectUrl = response?.headers?.location;
        if (!redirectUrl) { const m = responseContent.match(/href="([^"]+)"/); if (m) redirectUrl = m[1].replace(/&amp;/g, "&"); }
        if (redirectUrl) {
          logWithTime("info", `${this.username} Đang tải...`);
          response = await this._makeRequest({ method: "get", url: redirectUrl });
          if (response) responseContent = response.data;
        }
      }

      // Loop 5 lần
      for (let attempt = 1; attempt <= 5; attempt++) {
        logWithTime("info", `${this.username} Truy cập trang thêm mail lần ${attempt}`);
        response = await this._makeRequest({ method: "get", url: proofsUrl });
        responseContent = response?.data ?? "";
        if (response?.status === 301 || response?.status === 302 || response?.status === 303 || responseContent?.includes("Object moved")) {
          logWithTime("info", `${this.username} Đang tải...`);
          let redirectUrl = response?.headers?.location;
          if (!redirectUrl) { const m = responseContent.match(/href="([^"]+)"/); if (m) redirectUrl = m[1].replace(/&amp;/g, "&"); }
          if (redirectUrl) {
            logWithTime("info", `${this.username} Đang tải...`);
            response = await this._makeRequest({ method: "get", url: redirectUrl });
            if (response) responseContent = response.data;
          }
        }
      }

      if (!response) return { success: false, message: "Không thể truy cập trang thêm mail" };

      // Parse form
      const formActionM = responseContent?.match(/<form[^>]+action="([^"]+)"/i);
      if (formActionM) {
        const tokenUrl = formActionM[1];
        const postData = {};
        const inputTags = [...responseContent.matchAll(/<input\s[^>]*\/?>/gi)];
        for (const tag of inputTags) {
          const nameM = tag[0].match(/name="([^"]*)"/i);
          const valueM = tag[0].match(/value="([^"]*)"/i);
          if (nameM && valueM) {
            postData[nameM[1]] = valueM[1]
              .replace(/&amp;/g, "&").replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
          }
        }
        response = await this._makeRequest({
          method: "post", url: tokenUrl,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          data: new URLSearchParams(postData).toString(),
        });
      }

      // Redirect
      if (response?.status === 301 || response?.status === 302 || response?.status === 303 || responseContent?.includes("Object moved")) {
        logWithTime("info", `${this.username} Follow redirect...`);
        let redirectUrl = response?.headers?.location;
        if (!redirectUrl) { const m = responseContent.match(/href="([^"]+)"/); if (m) redirectUrl = m[1].replace(/&amp;/g, "&"); }
        if (redirectUrl) {
          logWithTime("info", `${this.username} Redirect to: ${redirectUrl}`);
          response = await this._makeRequest({ method: "get", url: redirectUrl });
          if (response) responseContent = response.data;
        }
      }

      this.html = response?.data ?? responseContent;

      const nextUrlM = this.html.match(/action="([^"]+)"/);
      const canaryM = this.html.match(/name="canary" value="([^"]+)"/);
      if (!nextUrlM || !canaryM)
        return { success: false, message: `Đã có mail khôi phục trước đó hoặc không thể tiếp tục ${this.phone}` };

      const nextUrl = nextUrlM[1];
      const canary = canaryM[1];
      logWithTime("info", `${this.username} Đang thêm: ${this.recoveryEmail}`);

      response = await this._makeRequest({
        method: "post", url: nextUrl,
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://account.live.com" },
        data: new URLSearchParams({
          iProofOptions: "Email", DisplayPhoneCountryISO: "US",
          DisplayPhoneNumber: "", EmailAddress: this.recoveryEmail,
          canary, action: "AddProof",
          PhoneNumber: "", PhoneCountryISO: "",
        }).toString(),
      });
      if (!response) return { success: false, message: "Không thể thêm mail khôi phục" };
      this.html = response.data;

      // Redirect
      if (response.status === 301 || response.status === 302 || response.status === 303 || this.html?.includes("Object moved")) {
        logWithTime("info", `${this.username} Đang follow redirect...`);
        let redirectUrl = response.headers?.location;
        if (!redirectUrl) { const m = this.html.match(/href="([^"]+)"/); if (m) redirectUrl = m[1].replace(/&amp;/g, "&"); }
        if (!redirectUrl) return { success: false, message: "Không tìm thấy URL redirect" };
        logWithTime("info", `${this.username} Redirect to: ${redirectUrl}`);
        response = await this._makeRequest({ method: "get", url: redirectUrl });
        if (!response) return { success: false, message: "Không thể follow redirect" };
        this.html = response.data;
      }

      const verifyUrlM = this.html.match(/action="([^"]+)"/);
      const verifyCanM = this.html.match(/name="canary" value="([^"]+)"/);
      const iProofOptM = this.html.match(/value="OTT([^"]+)"/);
      if (!verifyUrlM || !verifyCanM || !iProofOptM) {
        logWithTime("warn", `${this.username} Parse failed: verifyUrl=${!!verifyUrlM}, canary=${!!verifyCanM}, iProof=${!!iProofOptM}`);
        return { success: false, message: "Không thể lấy thông tin xác minh" };
      }

      const verifyUrl = verifyUrlM[1];
      const verifyCanary = verifyCanM[1];
      const iProofOptions = iProofOptM[1];

      logWithTime("info", `${this.username} Đang chờ mã OTP từ mail khôi phục...`);
      const code = await this.GetOtpMail();
      if (!code.success) {
        logWithTime("warn", `${this.username} Không đọc được OTP từ mkp`);
        return { success: false, message: code.message };
      }

      response = await this._makeRequest({
        method: "post", url: verifyUrl,
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://account.live.com" },
        data: new URLSearchParams({
          iProofOptions, iOttText: code.message,
          action: "VerifyProof", canary: verifyCanary, GeneralVerify: "0",
        }).toString(),
      });
      if (!response) return { success: false, message: "Không thể thêm mail khôi phục" };


      return { success: true, message: "Thêm mail khôi phục thành công", phone: this.phone, account: `${this.email}|${this.password}|${this.recoveryEmail}` };
    } catch (ex) {
      return { success: false, message: `Lỗi: ${ex.message}` };
    }
  }

  // ─────────────────────────────────────────────
  // GET OTP MAIL
  // ─────────────────────────────────────────────
  async GetOtpMail() {
    const parts = this.recoveryEmail.split("@");
    const domain = parts[1];
    logWithTime("info", `${this.username} Lấy otp từ mail: ${this.recoveryEmail}`);

    const fviaDomains = ["fviamail.work", "fviadropinbox.com", "fviainboxes.com", "dropinboxes.com"];
    const smvDomains = ["smvmail.com"];

    if (fviaDomains.includes(domain)) {
      let cnt = 60;
      while (cnt-- > 0) {
        try {
          // const res = await axios.get(
          //   `https://email.fhtool.zip/v1/messages?email=${this.recoveryEmail}&api_key=sk-8d3a2111b6bf1c5b58b37397fcfe768323a8c9a64859a98bce0668763d50241c`
          // );
          const res = await axios.get(`https://fviainboxes.com/messages?username=${parts[0]}&domain=${domain}`);
          logWithTime("info", `${this.username} Response mail: ${JSON.stringify(res.data)}`);
          const result = res.data?.result;
          if (!result || result.length === 0) {
            logWithTime("info", `${this.username} Chưa có OTP`);
            await new Promise(r => setTimeout(r, 2000 + Math.random() * 4000));
            continue;
          }
          const idMail = result[0]?.id?.toString();
          logWithTime("info", `${this.username} Đang đọc OTP ${idMail}`);
          // const msgRes = await axios.get(
          //   `https://email.fhtool.zip/v1/message/${idMail}?api_key=sk-8d3a2111b6bf1c5b58b37397fcfe768323a8c9a64859a98bce0668763d50241c`
          // );
          const msgRes = await axios.get(`https://fviainboxes.com/message?username=${parts[0]}&domain=${domain}&id=${idMail}`);
          const html = JSON.stringify(msgRes.data ?? "").replace(/\\u[\dA-Fa-f]{4}/g, c => String.fromCharCode(parseInt(c.slice(2), 16)));
          const match = html.match(/Security code:\s*<span[^>]*>(\d+)<\/span>/);
          if (match) return { success: true, message: match[1] };
        } catch (ex) {
          logWithTime("warn", `${this.username} GetMailError: ${ex.message}`);
        }
        logWithTime("info", `${this.username} Chưa có OTP`);
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 4000));
      }
    }

    if (smvDomains.includes(domain)) {
      let cnt = 60;
      while (cnt-- > 0) {
        try {
          const msgRes = await axios.get(
            `https://smvmail.com/api/email?page=1&q=&email=${this.recoveryEmail}`,
            { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" } }
          );
          const json = msgRes.data;
          if (json?.status && json?.data?.totalDocs > 0) {
            const htmlContent = json.data.docs[0]?.html ?? "";
            const match = htmlContent.match(/Security code:\s*<span[^>]*>(\d+)<\/span>/);
            if (match) {
              logWithTime("info", `${this.username} OTP: ${match[1]}`);
              return { success: true, message: match[1] };
            }
          }
        } catch (ex) {
          logWithTime("warn", `${this.username} Lỗi khi lấy mail: ${ex.message}`);
        }
        logWithTime("info", `${this.username} Chưa có OTP`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    return { success: false, message: `Không có OTP từ mail khôi phục ${this.phone}` };
  }

  // ─────────────────────────────────────────────
  // GET PHONE
  // ─────────────────────────────────────────────
  async GetPhone() {
    try {
      const delay = Math.floor(Math.random() * 9000) + 1000;
      await new Promise(r => setTimeout(r, delay));
      return await this.RequestPhone();
    } catch (ex) {
      logWithTime("warn", `${this.username} Lỗi trong quá trình lấy số: ${ex.message}`);
      return null;
    }
  }

  async RequestPhone() {
    for (let i = 0; i < this.retrySms; i++) {
      if (this.smsSite === "autosms.site") {
        try {
          const response = await axios.post("https://order.autosms.site/api/buy-number", {
            country: "us", service: "microsoft",
            api_key: this.smsKey, your_secret_key: "thanhvu6666",
          });
          const json = response.data;
          if (!json?.success) {
            logWithTime("warn", `${this.username} API trả về thất bại: ${JSON.stringify(json)}`);
            await new Promise(r => setTimeout(r, 2000)); continue;
          }
          const data = json?.data;
          if (!data) { await new Promise(r => setTimeout(r, 2000)); continue; }
          let phone = data.phone?.toString() ?? "";
          if (phone.startsWith("+1")) phone = phone.substring(2);
          else if (phone.startsWith("1") && phone.length > 1) phone = phone.substring(1);
          const orderId = data.order_id?.toString() ?? "";
          if (!orderId || !phone) { await new Promise(r => setTimeout(r, 2000)); continue; }
          logWithTime("info", `${this.username} Lấy số thành công => ${phone}`);
          return { id: orderId, number: phone };
        } catch (ex) {
          logWithTime("warn", `${this.username} Lỗi khi lấy số lần ${i + 1}: ${ex.message}`);
        }
      }

      if (this.smsSite === "botp.live") {
        try {
          const response = await axios.get(`https://botp.live/api/sim/buy?key=${this.smsKey}&app=6`);
          const json = response.data;
          if (!json?.success) {
            logWithTime("warn", `${this.username} API trả về thất bại: ${JSON.stringify(json)}`);
            await new Promise(r => setTimeout(r, 2000)); continue;
          }
          const data = json?.data;
          if (!data) { await new Promise(r => setTimeout(r, 2000)); continue; }
          let phone = data.number?.toString() ?? "";
          if (phone.startsWith("+1")) phone = phone.substring(2);
          else if (phone.startsWith("1") && phone.length === 11) phone = phone.substring(1);
          if (phone.length === 10) phone = `(${phone.substring(0, 3)}) ${phone.substring(3, 6)}-${phone.substring(6)}`;
          const orderId = data.id?.toString() ?? "";
          if (!orderId || !phone) { await new Promise(r => setTimeout(r, 2000)); continue; }
          logWithTime("info", `${this.username} Lấy số thành công => ${phone}`);
          return { id: orderId, number: phone };
        } catch (ex) {
          logWithTime("warn", `${this.username} Lỗi khi lấy số lần ${i + 1}: ${ex.message}`);
        }
      }

      await new Promise(r => setTimeout(r, 2000));
    }
    logWithTime("warn", `${this.username} Lấy số thất bại quá số lần quy định.`);
    return null;
  }

  // ─────────────────────────────────────────────
  // CHECK OTP
  // ─────────────────────────────────────────────
  async CheckOtp(orderId) {
    for (let i = 0; i < this.delaySms; i++) {
      if (this.smsSite === "autosms.site") {
        try {
          const response = await axios.post("https://order.autosms.site/api/check-otp", {
            order_id: orderId, api_key: this.smsKey, your_secret_key: "thanhvu6666",
          });
          const json = response.data;
          if (!json?.success) {
            logWithTime("warn", `${this.username} API trả về thất bại: ${JSON.stringify(json)}`);
            await new Promise(r => setTimeout(r, 2000)); continue;
          }
          const code = json?.data?.code?.toString() ?? "";
          if (code) {
            this.otp = code;
            logWithTime("info", `${this.username} Nhận được OTP: ${code}`);
            return code;
          }
          logWithTime("info", `${this.username} Chưa có OTP, thử lại ${i + 1}`);
        } catch (ex) {
          logWithTime("warn", `${this.username} Lỗi khi check OTP lần ${i + 1}: ${ex.message}`);
        }
      }

      if (this.smsSite === "botp.live") {
        try {
          const response = await axios.get(`https://botp.live/api/sim/check?key=${this.smsKey}&id=${orderId}`);
          const json = response.data;
          if (!json?.success) {
            logWithTime("warn", `${this.username} API trả về thất bại: ${JSON.stringify(json)}`);
            await new Promise(r => setTimeout(r, 2000)); continue;
          }
          const code = json?.data?.message?.toString() ?? "";
          const status = json?.data?.status ?? -1;
          if (code) {
            this.otp = code;
            logWithTime("info", `${this.username} Nhận được OTP: ${code}`);
            return code;
          }
          logWithTime("info", `${this.username} Chưa có OTP (status: ${status}), thử lại ${i + 1}`);
        } catch (ex) {
          logWithTime("warn", `${this.username} Lỗi khi check OTP lần ${i + 1}: ${ex.message}`);
        }
      }

      await new Promise(r => setTimeout(r, 2000));
    }
    logWithTime("warn", `${this.username} Không nhận được OTP`);
    return null;
  }

  // ─────────────────────────────────────────────
  // CANCEL OTP
  // ─────────────────────────────────────────────
  async CancelOtp(orderId) {
    if (this.smsSite === "autosms.site") {
      try {
        await axios.post("https://order.autosms.site/api/cancel-order", {
          order_id: orderId, api_key: this.smsKey, your_secret_key: "thanhvu6666",
        });
        logWithTime("info", `${this.username} Đã gửi yêu cầu hủy đơn hàng: ${orderId}`);
      } catch (ex) {
        logWithTime("warn", `${this.username} Lỗi khi hủy OTP: ${ex.message}`);
      }
    }
  }

  // ─────────────────────────────────────────────
  // CAPTCHA
  // ─────────────────────────────────────────────
  async CreateTaskCaptcha() {
    const payload = {
      clientKey: this.captchaKey,
      task: {
        websiteURL: "https://account.live.com/Abuse",
        websiteKey: "B7D8911C-5CC8-A9A3-35B0-554ACEE604DA",
        type: "FuncaptchaTaskProxyless",
      },
    };
    for (let retry = 0; retry < this.retryCaptcha; retry++) {
      try {
        const response = await axios.post("https://api.ez-captcha.com/createTask", payload);
        const json = response.data;
        if (json?.errorId === 0) {
          logWithTime("info", `${this.username} Tạo captcha task thành công: ${json.taskId}`);
          return json.taskId;
        }
        logWithTime("warn", `${this.username} API captcha lỗi: ${JSON.stringify(json)}`);
      } catch (ex) {
        logWithTime("warn", `${this.username} Lỗi tạo captcha lần ${retry + 1}: ${ex.message}`);
        if (retry === 2) throw ex;
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    return null;
  }

  async GetResultCaptcha(taskId) {
    const payload = { clientKey: this.captchaKey, taskId };
    for (let attempt = 0; attempt < this.delayCaptcha; attempt++) {
      try {
        const response = await axios.post("https://api.ez-captcha.com/getTaskResult", payload);
        const json = response.data;
        if (json?.errorId === 0 && json?.status === "ready") {
          logWithTime("info", `${this.username} Giải captcha thành công`);
          return json.solution?.token;
        } else if (json?.status === "processing") {
          logWithTime("info", `${this.username} Captcha đang xử lý... (${attempt + 1}/${this.delayCaptcha})`);
        } else {
          logWithTime("warn", `${this.username} Captcha status: ${json?.status}`);
          return null;
        }
      } catch (ex) {
        logWithTime("warn", `${this.username} Lỗi lấy captcha result lần ${attempt + 1}: ${ex.message}`);
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    logWithTime("warn", `${this.username} Giải captcha timeout`);
    return null;
  }

  // ─────────────────────────────────────────────
  // PROCESS OTP
  // ─────────────────────────────────────────────
  async ProcessOtp(phone) {
    logWithTime("info", `${this.username} Đang chờ OTP`);
    await new Promise(r => setTimeout(r, 3000));
    const otp = await this.CheckOtp(phone.id);
    if (!otp) {
      logWithTime("warn", `${this.username} Không về mã OTP`);
      await this.CancelOtp(phone.id);
      return { status: "error", message: `Không về mã OTP|${phone.number}` };
    }
    logWithTime("info", `${this.username} Tìm thấy OTP ${this.otp}`);

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const submit = await this.SubmitOtt();
        if (submit?.apiCanary) {
          logWithTime("info", `${this.username} Mở khóa thành công ${phone.number}`);
          return { status: "success", message: "Mở khóa thành công", phone: phone.number };
        }
        logWithTime("warn", `${this.username} Submit OTP lần ${attempt + 1} chưa thành công, thử lại...`);
        await new Promise(r => setTimeout(r, 3000));
      } catch (ex) {
        logWithTime("warn", `${this.username} Lỗi submit OTP lần ${attempt + 1}: ${ex.message}`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
    return { status: "error", message: "Submit OTP thất bại sau 5 lần thử" };
  }

  // ─────────────────────────────────────────────
  // SUBMIT OTT
  // ─────────────────────────────────────────────
  async SubmitOtt() {
    const urlObj = new URL(this.urlRU);
    const id = urlObj.searchParams.get("id");
    const lmif = urlObj.searchParams.get("lmif");
    const url = `https://account.live.com/API/ConsumeOneTimeToken?mkt=${this.mkt}&uiflavor=web&id=${id}&lmif=${lmif}&abr=1&ru=${encodeURIComponent(this.urlRU)}`;

    const response = await this._makeRequest({
      method: "post", url,
      headers: {
        "Content-Type": "application/json",
        canary: this.apiCanary,
        "client-request-id": this.uaid,
        correlationid: this.uaid,
        hpgid: this.hpgid,
        Referer: "https://account.live.com/Abuse",
      },
      data: JSON.stringify({
        ottPurpose: "TierRestore", ott: this.otp,
        channelType: "SMS", destinationPii: this.phoneFormat,
        uiflvr: "1001", scid: "100121", uaid: this.uaid, hpgid: this.hpgid,
      }),
    });

    if (!response) {
      logWithTime("warn", `${this.username} Submit OTP thất bại`);
      return null;
    }
    logWithTime("info", `${this.username} Submit Phone OK`);
    return response.data;
  }

  // ─────────────────────────────────────────────
  // HANDLE CAPTCHA
  // ─────────────────────────────────────────────
  async HandleCaptcha(phone) {
    logWithTime("info", `${this.username} Đang giải captcha`);
    let captchaData = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      logWithTime("info", `${this.username} Thử giải captcha lần ${attempt}/5`);
      const taskId = await this.CreateTaskCaptcha();
      if (!taskId) {
        logWithTime("warn", `${this.username} Lỗi khởi tạo captcha lần ${attempt}`);
        if (attempt === 5) return { status: "error", message: "Lỗi khi khởi tạo captcha sau 5 lần thử" };
        await new Promise(r => setTimeout(r, 2000)); continue;
      }
      captchaData = await this.GetResultCaptcha(taskId);
      if (!captchaData) {
        logWithTime("warn", `${this.username} Không giải được captcha lần ${attempt}`);
        if (attempt === 5) {
          await this.CancelOtp(phone.id);
          return { status: "error", message: "Không giải được captcha sau 5 lần thử" };
        }
        await new Promise(r => setTimeout(r, 2000)); continue;
      }
      logWithTime("info", `${this.username} Giải captcha thành công lần ${attempt}`);
      break;
    }

    const urlObj = new URL(this.urlRU);
    const id = urlObj.searchParams.get("id");
    const lmif = urlObj.searchParams.get("lmif");
    const url = `https://account.live.com/API/Proofs/SendOtt?mkt=${this.mkt}&uiflavor=web&id=${id}&lmif=${lmif}&abr=1&ru=${encodeURIComponent(this.urlRU)}`;

    const sendOtpResponse = await this._makeRequest({
      method: "post", url,
      headers: {
        "Content-Type": "application/json",
        canary: this.apiCanary,
        "client-request-id": this.uaid,
        correlationid: this.uaid,
        hpgid: "200252",
        Origin: "https://account.live.com",
      },
      data: JSON.stringify({
        action: "TierRestore", proofCountryIso: "US", channel: "SMS",
        proofId: phone.number,
        HPId: "B7D8911C-5CC8-A9A3-35B0-554ACEE604DA",
        HSol: captchaData, HType: "enforcement", HId: captchaData,
        RecommendedChallengeRiskScore: this.recommendedChallengeRiskScore,
        uiflvr: 1001, scid: 100121, uaid: this.uaid, hpgid: 200252,
      }),
    });

    if (!sendOtpResponse) {
      await this.CancelOtp(phone.id);
      return { status: "error", message: "Submit sdt thất bại" };
    }

    const sendOtpJson = sendOtpResponse.data;
    if (sendOtpJson?.error?.code === "1340")
      return { status: "error", message: "Captcha không chính xác" };
    if (sendOtpJson?.error?.code === "1346") {
      await this.CancelOtp(phone.id);
      return { status: "error", message: "Không thêm được sdt" };
    }
    if (!sendOtpJson?.formattedInternationalPhoneNumber) {
      await this.CancelOtp(phone.id);
      return { status: "error", message: "Submit sdt thất bại" };
    }

    this.phoneFormat = sendOtpJson.formattedInternationalPhoneNumber.replace(/ /g, "").replace(/-/g, "");
    return await this.ProcessOtp(phone);
  }

  // ─────────────────────────────────────────────
  // HANDLE ACCRUE
  // ─────────────────────────────────────────────
  async HandleAccrue() {
    try {
      logWithTime("info", `${this.username} Đang xử lý accrue...`);
      const actionMatch = this.html?.match(/action="([^"]+)"/);
      if (!actionMatch) return { status: "error", message: "Không tìm thấy action URL trong form" };

      const actionUrl = actionMatch[1].replace(/&amp;/g, "&");
      const ppridM = this.html.match(/name="pprid"[^>]*value="([^"]+)"/);
      const iptM = this.html.match(/name="ipt"[^>]*value="([^"]+)"/);
      const uaidM = this.html.match(/name="uaid"[^>]*value="([^"]+)"/);
      if (!ppridM || !iptM || !uaidM)
        return { status: "error", message: "Không tìm thấy các trường ẩn trong form" };

      this.pprid = ppridM[1]; this.ipt = iptM[1]; this.uaid = uaidM[1];

      const response = await this._makeRequest({
        method: "post", url: actionUrl,
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://account.live.com", Referer: "https://login.live.com" },
        data: new URLSearchParams({ pprid: this.pprid, ipt: this.ipt, uaid: this.uaid }).toString(),
      });
      if (!response) return { status: "error", message: "Không thể submit form accrue bước 1" };

      this.html = response.data;

      if (this.html.includes("iAccrualForm") && this.html.includes("BirthDay")) {
        logWithTime("info", `${this.username} Cần cập nhật thông tin profile...`);
        const profileResult = await this.SubmitProfileForm();
        if (profileResult.status !== "success") return profileResult;
        this.cookie = null;
        return await this.UnlockAsync();
      }

      const sdMatch = this.html.match(/var ServerData\s*=\s*(\{.*?\});/s);
      const canaryMatch = this.html.match(/"sCanary":\s*"([^"]+)"/);

      if (sdMatch && canaryMatch) {
        logWithTime("info", `${this.username} Đang xác nhận điều khoản...`);
        const sd = JSON.parse(sdMatch[1]);
        this.urlRU = sd?.urlRU;
        if (!this.urlRU) return { status: "error", message: "Không lấy được urlRU từ ServerData" };

        const canary = canaryMatch[1].replace(/\\u[\dA-Fa-f]{4}/g, c => String.fromCharCode(parseInt(c.slice(2), 16)));
        const confirmResponse = await this._makeRequest({
          method: "post", url: this.urlRU,
          headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://account.live.com", Referer: actionUrl },
          data: new URLSearchParams({ canary }).toString(),
        });
        if (confirmResponse) this.html = confirmResponse.data;
        return { status: "success", message: "Đã hoàn thành accrue" };
      } else if (this.html.includes("login.srf") || this.html.includes("loginfmt")) {
        return { status: "success", message: "Đã xử lý accrue" };
      } else {
        return { status: "error", message: "Không thể xác định trạng thái sau khi xử lý profile" };
      }
    } catch (ex) {
      return { status: "error", message: `Lỗi xử lý accrue: ${ex.message}` };
    }
  }

  // ─────────────────────────────────────────────
  // SUBMIT PROFILE FORM
  // ─────────────────────────────────────────────
  async SubmitProfileForm() {
    try {
      const canaryM = this.html.match(/name="canary"\s+value="([^"]+)"/);
      if (!canaryM) return { status: "error", message: "Không tìm thấy canary trong profile form" };

      const formActionM = this.html.match(/<form[^>]*id="iAccrualForm"[^>]*action="([^"]+)"/);
      if (!formActionM) return { status: "error", message: "Không tìm thấy form action" };

      let formAction = formActionM[1].replace(/&amp;/g, "&");
      if (!formAction.startsWith("http")) formAction = "https://account.live.com" + formAction;

      const response = await this._makeRequest({
        method: "post", url: formAction,
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://account.live.com", Referer: formAction },
        data: new URLSearchParams({
          canary: canaryM[1],
          BirthDay: "1", BirthMonth: "1", BirthYear: "1990",
          iCountryRegion: "VN", idLastName: "healan", idFirstName: "pratte",
        }).toString(),
      });
      if (!response) return { status: "error", message: "Không thể submit profile form" };
      this.html = response.data;
      return { status: "success", message: "Đã cập nhật profile" };
    } catch (ex) {
      return { status: "error", message: `Lỗi submit profile: ${ex.message}` };
    }
  }

  // ─────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────
  _extractT0Json(html) {
    const matches = [...html.matchAll(/var t0\s*=\s*\{/g)];
    if (!matches.length) return null;
    const lastMatch = matches[matches.length - 1];
    const startIndex = lastMatch.index + lastMatch[0].length - 1;
    let depth = 0, endIndex = -1;
    for (let i = startIndex; i < html.length; i++) {
      if (html[i] === "{") depth++;
      else if (html[i] === "}") { depth--; if (depth === 0) { endIndex = i; break; } }
    }
    if (endIndex === -1) return null;
    return html.substring(startIndex, endIndex + 1);
  }

  _generatePassword(length = 10) {
    if (this.passIsRandom) {
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    }
    return this.passCustomValue;
  }

  async _generateEmail() {
    const localOrig = this.email.split("@")[0];
    const localPart = this.mailIsOg ? localOrig : `${localOrig}${this.mailCustomStr}`;
    const mailDomain = this.mailSite ?? "fviainboxes.com";
    this.recoveryEmail = `${localPart}@${mailDomain}`.toLowerCase();

    if (mailDomain === "dollicons.com") {
      for (let retry = 0; retry < 3; retry++) {
        try {
          await axios.post("https://api.mail.tm/accounts", {
            address: this.recoveryEmail, password: this.password,
          });
          break;
        } catch (ex) {
          logWithTime("warn", `${this.username} Lỗi khi tạo mkp lần ${retry + 1}: ${ex.message}`);
          if (retry === 2) throw ex;
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
    return this.recoveryEmail;
  }
}

module.exports = HotmailClass;