const fs = require('node:fs');
const path = require('node:path');
const { loadProxies, requireProxy } = require('./services/required-proxy');
const { ResultWriter } = require('./result-writer');
const { exportResultsFromFiles } = require('./export-inputs');
const MAX_SEND_ATTEMPTS = 5;

function lines(file) {
  if (!file || !fs.statSync(file).isFile()) throw new Error('Hãy chọn file TXT hợp lệ.');
  if (fs.statSync(file).size > 20 * 1024 * 1024) throw new Error('File tối đa 20 MB.');
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(x => x.trim());
}
const validEmail = value => /^[a-z0-9][a-z0-9._-]*@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);
function loadPlan(options) {
  const accounts = [], seen = new Set();
  for (const [index, line] of lines(options.emailFile).entries()) {
    const separator = line.indexOf('|');
    const email = line.slice(0, separator).trim().toLowerCase();
    const password = line.slice(separator + 1);
    if (separator < 1 || !validEmail(email) || !password) throw new Error(`Mail chính dòng ${index + 1}: cần email|password.`);
    if (seen.has(email)) throw new Error(`Mail chính dòng ${index + 1} bị trùng.`);
    seen.add(email); accounts.push({ email, password });
  }
  const raw = lines(options.aliasFile).map(x => x.trim().toLowerCase());
  raw.forEach((email, index) => { if (!validEmail(email)) throw new Error(`Mail phụ dòng ${index + 1} không hợp lệ: cần địa chỉ đầy đủ.`); });
  const aliases = [...new Set(raw)];
  if (!accounts.length || !aliases.length) throw new Error('Danh sách mail chính và mail phụ không được rỗng.');
  if (aliases.some(email => seen.has(email))) throw new Error('Mail phụ trùng với một mail chính trong danh sách.');
  return { accounts, jobs: aliases.map((alias, i) => ({ alias, accountIndex: i })), duplicates: raw.length - aliases.length };
}

class AliasBatch {
  constructor(options, { createClient, sendMail, changePassword, generatePassword = require('./helper/helper').generatePassword, onUpdate = () => { }, outputIO } = {}) {
    Object.assign(this, loadPlan(options));
    this.mainPasswords = new Map(this.accounts.map(account => [account.email, account.password]));
    // Giữ chuỗi đầu vào cho sendMail/changePassword; chỉ chuẩn hóa khi tạo client mail.com.
    this.proxies = loadProxies(options.proxyFile, { raw: true });
    this.sendMail = sendMail;
    this.changePassword = changePassword;
    this.generatePassword = generatePassword;
    this.passwords = new WeakMap();
    this.exported = new Set();
    this.createClient = createClient || ((report, proxy) => new (require('./services/mailcom-alias').MailComAliasClient)(report, { proxy }));
    this.onUpdate = onUpdate;
    this.latest = new Map(); this.results = new Map(); this.state = 'ready'; this.message = ''; this.elapsedMs = 0;
    this.clients = new Set(); this.waiters = new Set();
    this.accountErrors = new Map();
    this.loginFailed = new Set(); this.storageErrorsLogged = new Set(); this.exportTickets = new WeakMap();
    this.finishedAccounts = new Set(); this.assignments = new Map(); this.nextAlias = 0;
    this.pendingInbox = new Map();
    // Các số này phản ánh kết quả cuối của mỗi cặp mail, tách khỏi kết quả
    // kỹ thuật của bước thêm alias ở mail.com.
    this.finalCounts = { success: 0, failed: 0, linksFound: 0 };
    this.concurrency = Number(options.concurrency ?? 50);
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1 || this.concurrency > 200) throw new Error('Số luồng phải từ 1 đến 200.');
    this.concurrency = Math.min(this.concurrency, this.accounts.length);
    this.counts = { added: 0, existing: 0, failed: 0 };
    this.delayMs = Number(options.delayMs ?? 1000);
    if (!Number.isFinite(this.delayMs) || this.delayMs < 1000 || this.delayMs > 60000) throw new Error('Khoảng nghỉ phải từ 1.000 đến 60.000 ms.');
    if (typeof options.outputRoot !== 'string' || !options.outputRoot.trim()) throw new Error('Hãy chọn thư mục kết quả.');
    this.outputDir = path.resolve(options.outputRoot);
    this.resultFile = path.join(this.outputDir, 'alias-results.jsonl');
    this.successFile = path.join(this.outputDir, 'success.txt');
    this.failFile = path.join(this.outputDir, 'fail.txt');
    this.mainFailFile = path.join(this.outputDir, 'mailchinhfail.txt');
    const inputs = [options.emailFile, options.aliasFile, options.proxyFile].map(f => fs.realpathSync(f));
    this.inputFiles = Object.freeze({ main: inputs[0], alias: inputs[1] });
    this.inputExport = { done: false, aliasesRemoved: 0, mainsRemoved: 0 };
    this.inputExportMessage = '';
    const outputs = [this.resultFile, this.successFile, this.failFile, this.mainFailFile].map(file => fs.existsSync(file) ? fs.realpathSync(file) : file);
    if (outputs.some(file => inputs.includes(file))) throw new Error('File kết quả trùng đầu vào.');
    this.writer = new ResultWriter(this.outputDir, outputIO);
    for (const file of [this.resultFile, this.successFile, this.failFile, this.mainFailFile]) this.writer.enqueue(file, '');
    this.writer.flush();
  }
  snapshot() {
    return {
      state: this.state, message: this.message, total: this.jobs.length, completed: this.counts.added,
      concurrency: this.concurrency, delayMs: this.delayMs,
      totalAccounts: this.accounts.length, fullAccounts: this.finishedAccounts.size,
      accountsNeedingAttention: this.accountErrors.size,
      loginFailed: this.loginFailed.size, pendingWrites: this.writer.pendingCount, writeError: this.writer.errorMessage,
      inputsExported: this.inputExport.done, inputExportMessage: this.inputExportMessage,
      attempted: this.results.size, remainingAliases: this.jobs.length - this.nextAlias,
      attention: [...this.latest.values()].filter(x => x.status === 'attention').length,
      finalSuccess: this.finalCounts.success,
      finalFailed: this.finalCounts.failed,
      linksFound: this.finalCounts.linksFound,
      duplicates: this.duplicates, ...this.counts, outputDir: this.outputDir,
      elapsedMs: this.elapsedMs + (this.startedAt ? Date.now() - this.startedAt : 0)
    };
  }
  emit(result) { try { this.onUpdate({ ...this.snapshot(), result }); } catch { /* UI đóng không được làm dừng worker. */ } }
  writeResult(file, text, record) {
    const ticket = this.writer.enqueue(file, text);
    this.writer.flush();
    if (this.writer.errorMessage && record?.mainEmail) {
      const key = `${record.jobId}:${file}`;
      if (!this.storageErrorsLogged.has(key)) {
        this.storageErrorsLogged.add(key);
        this.writer.enqueue(this.failFile, this.failureLine(record, 'result_write_failed'));
      }
    }
    return ticket;
  }
  flushWrites() {
    this.writer.flush();
    for (const record of this.results.values()) {
      if (this.exportTickets.get(record)?.saved) record.exportMessage = `Đã ghi ${record.exportStatus === 'success' ? 'success.txt' : 'fail.txt'}.`;
    }
    this.emit();
    return this.snapshot();
  }
  exportInputFiles(options = { emailFile: this.inputFiles.main, aliasFile: this.inputFiles.alias, outputRoot: this.outputDir }) {
    if (this.state !== 'completed') throw new Error('Chỉ xuất kết quả sau khi lượt chạy hoàn tất.');
    this.flushWrites();
    if (this.writer.pendingCount) throw new Error('Cần ghi hết kết quả TXT trước khi lọc file đầu vào. Bấm Thử ghi lại sau khi khắc phục lỗi ghi file.');
    try {
      this.inputExport = exportResultsFromFiles(options);
      this.inputExportMessage = this.inputExport.message;
      this.emit();
      return { ...this.inputExport };
    } catch (error) {
      this.inputExportMessage = error.message;
      this.emit();
      throw error;
    }
  }
  pause(message = 'Đang tạm dừng: không nhận alias mới, chờ các luồng xử lý hết alias hiện tại…') {
    if (this.state !== 'running') return;
    this.state = 'pausing'; this.message = message;
    for (const wake of this.waiters) wake();
    this.emit();
  }
  processing() { return ['running', 'pausing'].includes(this.state); }
  wait(ms = this.delayMs, { idle = false } = {}) {
    return new Promise(resolve => {
      const wake = () => { clearTimeout(timer); this.waiters.delete(wake); resolve(); };
      const timer = setTimeout(wake, ms);
      if (idle) this.waiters.add(wake);
    });
  }
  saveFollowup(record, displayRecord = record) {
    this.writeResult(this.resultFile, JSON.stringify({ ...record, event: 'mail-followup', updatedAt: new Date().toISOString() }) + '\n', record);
    this.emit(displayRecord);
  }
  exportSuccess(record, password) {
    if (this.exported.has(record.jobId)) return;
    if (typeof password !== 'string' || !password) throw new Error('Không có mật khẩu mới để xuất kết quả thành công.');
    const ticket = this.writeResult(this.successFile, `${record.mainEmail}|${record.alias}|${password}\n`, record);
    this.exportTickets.set(record, ticket);
    this.exported.add(record.jobId);
    this.finalCounts.success++;
    record.exportStatus = 'success';
    record.exportMessage = ticket.saved ? 'Đã ghi success.txt.' : 'Đang chờ ghi success.txt trong bộ nhớ.';
    // Chỉ gửi mật khẩu cho giao diện ở bộ nhớ. JSONL không bao giờ chứa nó.
    this.saveFollowup(record, { ...record, newPassword: password });
  }
  exportFail(record, message) {
    if (this.exported.has(record.jobId)) return;
    record.errorCode ||= 'alias_processing_failed';
    record.finalMessage ||= message;
    const ticket = this.writeResult(this.failFile, this.failureLine(record, record.errorCode), record);
    this.exportTickets.set(record, ticket);
    this.exported.add(record.jobId);
    this.finalCounts.failed++;
    record.exportStatus = 'fail';
    record.exportMessage = ticket.saved ? 'Đã ghi fail.txt.' : 'Đang chờ ghi fail.txt trong bộ nhớ.';
    this.saveFollowup(record);
  }
  failureLine(record, code) {
    // Mật khẩu mail chính chỉ đưa vào fail.txt, không gắn vào record/snapshot/JSONL.
    return `${record.mainEmail}|${this.mainPasswords.get(record.mainEmail) || ''}|${record.alias || ''}|${code}\n`;
  }
  async sendVerification(record, pending, proxy) {
    pending.sendAttempts = (pending.sendAttempts || 0) + 1;
    const attempt = pending.sendAttempts;
    const sentAt = Date.now();
    let success = false, simulated = false;
    record.sendStatus = 'sending';
    record.sendAttempts = attempt;
    record.sendMessage = `Đang gửi thư lần ${attempt}/${MAX_SEND_ATTEMPTS}…`;
    this.emit(record);
    try {
      if (typeof this.sendMail !== 'function') {
        record.sendMessage = 'Chưa cấu hình hàm sendMail.';
      } else {
        const sent = await this.sendMail(record.alias, proxy);
        success = sent === 'successfully';
        simulated = sent?.simulated === true;
        record.sendMessage = success
          ? `Gửi thư lần ${attempt}/${MAX_SEND_ATTEMPTS} thành công${simulated ? ' (giả lập — không gửi thư thật)' : ''}.`
          : `Gửi thư lần ${attempt}/${MAX_SEND_ATTEMPTS} thất bại.`;
      }
    } catch {
      record.sendMessage = `Gửi thư lần ${attempt}/${MAX_SEND_ATTEMPTS} thất bại.`;
    }
    record.sendStatus = success ? (simulated ? 'simulated' : 'sent') : 'failed';
    this.message = `${record.sendMessage} ${record.alias}`;
    if (success) pending.since = simulated ? 0 : sentAt;
    this.saveFollowup(record);
    return success;
  }
  async cleanupAlias(record, client) {
    if (record.cleanupStatus === 'removed') return;
    record.cleanupStatus = 'removing';
    record.cleanupMessage = 'Đang dọn dẹp: xóa alias khỏi mail chính…';
    this.saveFollowup(record);
    try {
      if (typeof client.removeAlias !== 'function') throw new Error('Chưa cấu hình API xóa alias.');
      const result = await client.removeAlias(record.alias);
      if (!['removed', 'absent'].includes(result?.status)) throw new Error('Kết quả xóa alias không hợp lệ.');
      record.cleanupStatus = 'removed';
      record.cleanupMessage = result.message || 'Đã xóa alias khỏi mail chính.';
      this.saveFollowup(record);
    } catch (error) {
      record.cleanupStatus = error.code === 'CANCELLED' ? 'paused' : 'error';
      record.cleanupMessage = error.safeMessage || 'Không xóa được alias khỏi mail chính.';
      this.saveFollowup(record);
      throw Object.assign(new Error(record.cleanupMessage), { code: error.code === 'CANCELLED' ? 'CANCELLED' : 'NEEDS_ATTENTION', safeMessage: record.cleanupMessage });
    }
  }
  async finishFollowup(accountIndex, client, completion) {
    const pending = this.pendingInbox.get(accountIndex);
    // Giữ kết quả cuối trước khi dọn dẹp. Lỗi xóa được ghi cùng kết quả alias;
    // không giữ hàng đợi hoặc hủy công việc của những luồng khác.
    pending.completion ||= completion;
    const { record } = pending;
    const { success, message, errorCode } = pending.completion;
    if (!success && errorCode) record.errorCode = errorCode;
    record.finalMessage = message;
    try { await this.cleanupAlias(record, client); }
    catch (error) {
      if (!success && error.code === 'CANCELLED' && !this.processing()) throw error;
      if (!success) record.finalMessage = `${message} Dọn dẹp thất bại: ${record.cleanupMessage}`;
      this.writeResult(this.failFile, this.failureLine(record, 'alias_cleanup_failed'), record);
    }
    if (success) this.exportSuccess(record, this.passwords.get(record));
    else this.exportFail(record, record.finalMessage);
    this.passwords.delete(record);
    this.pendingInbox.delete(accountIndex);
  }
  async readVerification(accountIndex, client) {
    const pending = this.pendingInbox.get(accountIndex);
    const { record, attempts } = pending;
    while (record.inboxStatus !== 'found' && !pending.verificationExhausted && pending.sendAttempts < MAX_SEND_ATTEMPTS) {
      if (pending.sendAttempts) {
        const reason = record.sendStatus === 'failed' ? 'Gửi thư thất bại' : 'Chưa tìm thấy link Apple';
        record.sendStatus = 'retrying';
        record.sendMessage = `${reason}; thử gửi lần ${pending.sendAttempts + 1}/${MAX_SEND_ATTEMPTS} sau 2 giây.`;
        this.message = `${record.sendMessage} ${record.alias}`;
        this.saveFollowup(record);
        await this.wait(2000);
      }
      if (!this.processing()) throw Object.assign(new Error('Lượt chạy không hoạt động.'), { code: 'CANCELLED' });
      const sent = await this.sendVerification(record, pending, this.proxies[accountIndex % this.proxies.length]);
      if (!sent) continue;
      record.inboxStatus = 'checking';
      record.inboxMessage = `Đang tìm thư Apple sau lần gửi ${pending.sendAttempts}/${MAX_SEND_ATTEMPTS}…`;
      this.emit(record);
      try {
        const result = await client.waitForAppleVerification({ recipient: record.alias, since: pending.since, attempts });
        record.inboxStatus = result.status;
        record.inboxMessage = result.status === 'found' ? 'Đã tìm thấy link xác minh Apple.'
          : `Chưa có link sau lần gửi ${pending.sendAttempts}/${MAX_SEND_ATTEMPTS}${result.truncated ? ' (đã đạt giới hạn 250 thư mới nhất)' : ''}.`;
        if (result.status === 'found') {
          record.verificationLink = result.link;
          record.appleMessageId = result.messageId;
          this.finalCounts.linksFound++;
        }
      } catch (error) {
        record.inboxStatus = error.code === 'CANCELLED' ? 'paused' : 'error';
        record.inboxMessage = error.safeMessage || 'Không đọc được Inbox.';
        if (error.code !== 'CANCELLED') record.errorCode = 'inbox_read_failed';
        this.saveFollowup(record);
        throw error;
      }
      this.saveFollowup(record);
    }
    if (record.inboxStatus !== 'found') pending.verificationExhausted = true;
    if (record.inboxStatus === 'found' && typeof this.changePassword === 'function') {
      const changed = await this.changePasswordForRecord(record, this.proxies[accountIndex % this.proxies.length]);
      await this.finishFollowup(accountIndex, client, { success: changed, message: record.passwordChangeMessage, errorCode: 'password_change_failed' });
    } else if (record.inboxStatus !== 'found') {
      const message = record.sendStatus === 'failed'
        ? record.sendMessage
        : pending.sendAttempts >= MAX_SEND_ATTEMPTS
        ? `Không tìm thấy link Apple sau ${MAX_SEND_ATTEMPTS} lần gọi gửi thư.`
        : record.sendMessage || record.inboxMessage;
      record.inboxMessage = message;
      await this.finishFollowup(accountIndex, client, { success: false, message, errorCode: record.sendStatus === 'failed' ? 'send_mail_failed' : 'apple_link_not_found' });
    } else {
      await this.finishFollowup(accountIndex, client, { success: false, message: 'Chưa cấu hình hàm changePassword.', errorCode: 'password_change_not_configured' });
    }
  }
  async changePasswordForRecord(record, proxy) {
    if (record.passwordChangeStatus === 'successfully') return true;
    while ((record.passwordChangeAttempts || 0) < 5) {
      if (!this.processing()) {
        record.passwordChangeStatus = 'paused';
        record.passwordChangeMessage = 'Đã tạm dừng đổi mật khẩu giả lập; Tiếp tục sẽ dùng link đã lấy.';
        this.saveFollowup(record);
        throw Object.assign(new Error('Đã tạm dừng.'), { code: 'CANCELLED', safeMessage: record.passwordChangeMessage });
      }
      if (!this.passwords.has(record)) {
        record.errorCode = 'password_generation_failed';
        const password = this.generatePassword();
        if (typeof password !== 'string' || !password.length) throw new Error('Không tạo được mật khẩu mới.');
        this.passwords.set(record, password);
        delete record.errorCode;
      }
      record.passwordChangeAttempts = (record.passwordChangeAttempts || 0) + 1;
      record.passwordChangeStatus = 'changing';
      record.passwordChangeMessage = `Đang đổi mật khẩu giả lập (${record.passwordChangeAttempts}/5)…`;
      this.emit(record);
      let result;
      try { result = await this.changePassword(this.passwords.get(record), record.verificationLink, proxy); }
      catch { /* Lỗi gọi hàm cũng tính là một lần thất bại; không ghi dữ liệu nhạy cảm. */ }
      if (result === 'successfully') {
        record.passwordChangeStatus = 'successfully';
        record.passwordChangeMessage = 'Đổi mật khẩu thành công (giả lập — không đổi mật khẩu thật).';
        this.saveFollowup(record);
        return true;
      }
      record.passwordChangeStatus = 'failed';
      record.passwordChangeMessage = record.passwordChangeAttempts === 5
        ? 'Đổi mật khẩu giả lập thất bại sau 5 lần.'
        : `Đổi mật khẩu giả lập chưa thành công (${record.passwordChangeAttempts}/5); thử lại sau 2 giây.`;
      this.saveFollowup(record);
      if (record.passwordChangeAttempts < 5 && this.processing()) await this.wait(2000);
    }
    return false;
  }
  // Chỉ cấp alias bằng thao tác đồng bộ, trước bất kỳ await nào. nextAlias chỉ
  // tăng, không đưa alias đã cấp trở lại hàng đợi hoặc chuyển sang tài khoản khác.
  claimAlias(accountIndex) {
    if (this.assignments.has(accountIndex)) return this.assignments.get(accountIndex);
    if (this.nextAlias >= this.jobs.length) return undefined;
    const index = this.nextAlias++;
    this.jobs[index].accountIndex = accountIndex;
    this.assignments.set(accountIndex, index);
    return index;
  }
  async processFollowup(accountIndex, client) {
    const pending = this.pendingInbox.get(accountIndex);
    if (!this.processing()) throw Object.assign(new Error('Lượt chạy không hoạt động.'), { code: 'CANCELLED' });
    if (pending.completion) return this.finishFollowup(accountIndex, client);
    try {
      if (typeof this.sendMail !== 'function') {
        pending.record.sendMessage = 'Chưa cấu hình hàm sendMail.';
        await this.finishFollowup(accountIndex, client, { success: false, message: pending.record.sendMessage, errorCode: 'send_mail_failed' });
        return;
      }
      await this.readVerification(accountIndex, client);
    } catch (error) {
      if (error.code === 'CANCELLED' && !this.processing()) throw error;
      // Lỗi kết thúc ngoài các nhánh dự kiến cũng phải đi qua bước xóa alias.
      await this.finishFollowup(accountIndex, client, { success: false, message: error.safeMessage || 'Lỗi xử lý sau khi thêm alias.' });
    }
  }
  recordOutcome(index, accountIndex, outcome) {
    if (!Object.prototype.hasOwnProperty.call(this.counts, outcome.status)) throw new Error('Kết quả thêm alias không hợp lệ.');
    const record = {
      jobId: index, mainEmail: this.accounts[accountIndex].email, alias: this.jobs[index].alias,
      status: outcome.status, message: outcome.status === 'failed' ? `Không thể add mail phụ: ${outcome.message}` : outcome.message,
      ...(outcome.status !== 'added' ? { errorCode: outcome.status === 'existing' ? 'alias_already_exists' : 'unable_add_alias' } : {}),
      ...(outcome.httpStatus ? { httpStatus: outcome.httpStatus } : {}), at: new Date().toISOString()
    };
    this.latest.set(index, record); this.results.set(index, record); this.counts[record.status]++;
    this.writeResult(this.resultFile, JSON.stringify(record) + '\n', record);
    this.emit(record);
    return record;
  }
  async failAlias(index, accountIndex, error, client) {
    const message = error?.safeMessage || 'Lỗi xử lý alias.';
    this.accountErrors.set(accountIndex, message);
    const record = this.results.get(index) || this.recordOutcome(index, accountIndex, {
      status: 'failed', message, httpStatus: error?.httpStatus
    });
    if (!this.pendingInbox.has(accountIndex) && error?.aliasSubmitted) {
      this.pendingInbox.set(accountIndex, { record, sendAttempts: 0, attempts: 5 });
    }
    if (this.pendingInbox.has(accountIndex)) {
      await this.finishFollowup(accountIndex, client, { success: record.passwordChangeStatus === 'successfully', message });
    } else this.exportFail(record, message);
    this.assignments.delete(accountIndex);
    this.jobs[index].uncertain = false;
  }
  async run() {
    if (this.state !== 'ready') throw new Error('Lượt này đã chạy. Hãy bắt đầu lượt mới.');
    this.accountErrors.clear();
    this.state = 'running'; this.startedAt = Date.now(); this.message = 'Đang đăng nhập mail chính…'; this.emit();
    const pending = this.accounts.map((account, index) => index).filter(index => !this.finishedAccounts.has(index) && !this.loginFailed.has(index));
    let next = 0;
    const worker = async workerIndex => {
      while (this.state === 'running' && next < pending.length) {
        const accountIndex = pending[next++];
        let index = this.pendingInbox.get(accountIndex)?.record.jobId ?? this.assignments.get(accountIndex);
        if (index === undefined && this.nextAlias >= this.jobs.length) continue;
        let client, loggedIn = false, lastRecord;
        const proxy = requireProxy(this.proxies[accountIndex % this.proxies.length]);
        try {
          client = this.createClient(message => {
            if (this.processing()) {
              this.message = `${this.state === 'pausing' ? 'Đang tạm dừng, hoàn tất alias hiện tại. ' : ''}Luồng ${workerIndex + 1}: ${message}`;
              this.emit();
            }
          }, proxy);
          this.clients.add(client);
          await client.login(this.accounts[accountIndex]);
          loggedIn = true;
          if (this.pendingInbox.has(accountIndex)) {
            await this.processFollowup(accountIndex, client);
            index = undefined;
            if (this.state === 'running' && this.nextAlias < this.jobs.length) await this.wait(this.delayMs, { idle: true });
          }
          while (this.state === 'running') {
            if (index === undefined) index = this.claimAlias(accountIndex);
            if (index === undefined) break;
            const job = this.jobs[index];
            try {
              let outcome;
              if (job.uncertain) {
                // Không gọi addAlias lần hai: chỉ đối chiếu alias trên tài khoản đã
                // giữ nó. Alias vắng mặt cũng kết thúc, không chuyển qua luồng khác.
                const addresses = await client.listAddresses();
                outcome = addresses.some(x => x.address.toLowerCase() === job.alias)
                  ? { status: 'added', message: 'Đã đối chiếu alias sau khi tiếp tục; không gửi lại request tạo.' }
                  : { status: 'failed', message: 'Chưa xác nhận tạo alias sau request trước. Không thử lại alias này.' };
              } else {
                job.uncertain = true;
                outcome = await client.addAlias(job.alias);
              }
              const record = this.recordOutcome(index, accountIndex, outcome);
              lastRecord = record;
              job.uncertain = false;
              this.assignments.delete(accountIndex);
              const done = outcome.accountFull === true;
              if (done) this.finishedAccounts.add(accountIndex);
              if (record.status !== 'added') this.exportFail(record, record.message);
              // Chỉ gửi khi đã xác nhận thêm mail phụ thành công.
              if (record.status === 'added') {
                const pending = { record, since: 0, attempts: 5, sendAttempts: 0 };
                this.pendingInbox.set(accountIndex, pending);
                await this.processFollowup(accountIndex, client);
              }
              if (done) { index = undefined; break; }
            } catch (error) {
              if (error?.code === 'CANCELLED' && !this.processing()) throw error;
              await this.failAlias(index, accountIndex, error, client);
              lastRecord = this.results.get(index);
            }
            index = undefined;
            if (this.state !== 'running' || this.nextAlias >= this.jobs.length) break;
            await this.wait(this.delayMs, { idle: true });
          }
        } catch (error) {
          if (!(error?.code === 'CANCELLED' && !this.processing())) {
            const message = error?.safeMessage || (loggedIn ? 'Lỗi xử lý tài khoản.' : 'Không đăng nhập được mail chính.');
            this.accountErrors.set(accountIndex, message);
            if (!loggedIn) {
              this.loginFailed.add(accountIndex);
              const record = { jobId: `login-${accountIndex}`, mainEmail: this.accounts[accountIndex].email, alias: '' };
              this.writeResult(this.mainFailFile, `${record.mainEmail}|main_login_failed\n`, record);
              this.writeResult(this.resultFile, JSON.stringify({ ...record, event: 'main-login-failed', errorCode: 'main_login_failed', message, at: new Date().toISOString() }) + '\n', record);
              this.message = `Không đăng nhập được mail chính; chuyển sang tài khoản khác. ${message}`;
              this.emit();
            }
            if (index !== undefined) await this.failAlias(index, accountIndex, error, client);
          }
        } finally {
          try { await client?.close(); } catch (error) {
            const record = lastRecord || { mainEmail: this.accounts[accountIndex].email, alias: index === undefined ? '' : this.jobs[index].alias, jobId: index };
            this.writeResult(this.failFile, this.failureLine(record, 'session_close_failed'), record);
          }
          this.clients.delete(client);
        }
        if (this.state === 'running' && next < pending.length) await this.wait(this.delayMs, { idle: true });
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, pending.length) }, (_, i) => worker(i)));
    this.elapsedMs += Date.now() - this.startedAt; this.startedAt = null;
    const manuallyPaused = this.state !== 'running';
    this.state = 'completed';
    this.message = manuallyPaused ? `Đã xử lý xong các alias đang chạy và tạm dừng. Còn ${this.jobs.length - this.nextAlias} alias chưa chạy. Có thể xuất kết quả hoặc bắt đầu lượt mới.`
      : `Hoàn tất: đổi mật khẩu thành công ${this.finalCounts.success} alias, thất bại ${this.finalCounts.failed} alias; ${this.loginFailed.size} mail chính đăng nhập lỗi.${this.nextAlias === this.jobs.length ? ' Đã hết mail phụ trong file.' : ` Còn ${this.jobs.length - this.nextAlias} alias chưa chạy do đã hết mail chính có thể dùng.`}`;
    this.writer.flush();
    this.emit();
    return this.snapshot();
  }
}
module.exports = { AliasBatch, loadPlan };
