const fs = require('node:fs');
const path = require('node:path');
const { loadAccounts, validEmail } = require('./batch-inputs');
const { loadProxies } = require('./services/required-proxy');
const { ResultWriter } = require('./result-writer');

class AliasListBatch {
  constructor(options, { createClient, onUpdate = () => {}, outputIO } = {}) {
    this.mode = 'list';
    this.accounts = loadAccounts(options.emailFile);
    if (!this.accounts.length) throw new Error('Danh sách mail chính không được rỗng.');
    this.proxies = loadProxies(options.proxyFile);
    this.concurrency = Number(options.concurrency ?? 50);
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1 || this.concurrency > 200) throw new Error('Số luồng phải từ 1 đến 200.');
    this.concurrency = Math.min(this.concurrency, this.accounts.length);
    this.delayMs = Number(options.delayMs ?? 1000);
    if (!Number.isFinite(this.delayMs) || this.delayMs < 1000 || this.delayMs > 60000) throw new Error('Khoảng nghỉ phải từ 1.000 đến 60.000 ms.');
    if (typeof options.outputRoot !== 'string' || !options.outputRoot.trim()) throw new Error('Hãy chọn thư mục kết quả.');
    this.outputDir = path.resolve(options.outputRoot);
    if (fs.existsSync(this.outputDir)) this.outputDir = fs.realpathSync(this.outputDir);
    this.resultFile = path.join(this.outputDir, 'mailchinh-alias.txt');
    this.failFile = path.join(this.outputDir, 'fail.txt');
    this.mainFailFile = path.join(this.outputDir, 'mailchinhfail.txt');
    const inputs = [options.emailFile, options.proxyFile].map(file => fs.realpathSync(file));
    const files = [this.resultFile, this.failFile, this.mainFailFile];
    if (files.some(file => inputs.includes(fs.existsSync(file) ? fs.realpathSync(file) : file))) throw new Error('File kết quả trùng đầu vào.');
    this.createClient = createClient || ((report, proxy) => new (require('./services/mailcom-alias').MailComAliasClient)(report, { proxy }));
    this.onUpdate = onUpdate; this.state = 'ready'; this.message = '';
    this.nextAccount = 0; this.attempted = 0; this.succeeded = 0; this.failed = 0;
    this.aliasesFound = 0; this.loginFailed = 0; this.elapsedMs = 0; this.startedAt = null;
    this.waiters = new Set(); this.storageErrors = new Set();
    this.writer = new ResultWriter(this.outputDir, outputIO);
    for (const file of files) this.writer.enqueue(file, '');
    this.writer.flush();
  }
  snapshot() {
    return { mode: this.mode, state: this.state, message: this.message, outputDir: this.outputDir,
      concurrency: this.concurrency, delayMs: this.delayMs, total: this.accounts.length,
      totalAccounts: this.accounts.length, attempted: this.attempted,
      finalSuccess: this.succeeded, finalFailed: this.failed, aliasesFound: this.aliasesFound,
      loginFailed: this.loginFailed, remainingAccounts: this.accounts.length - this.nextAccount,
      pendingWrites: this.writer.pendingCount, writeError: this.writer.errorMessage,
      elapsedMs: this.elapsedMs + (this.startedAt ? Date.now() - this.startedAt : 0) };
  }
  emit(result) { try { this.onUpdate({ ...this.snapshot(), result }); } catch { /* A closed UI must not stop workers. */ } }
  write(file, text, account, index) {
    const ticket = this.writer.enqueue(file, text);
    this.writer.flush();
    const key = `${index}:${file}`;
    if (this.writer.errorMessage && !this.storageErrors.has(key)) {
      this.storageErrors.add(key);
      this.writer.enqueue(this.failFile, `${account.email}|${account.password}||result_write_failed\n`);
    }
    return ticket;
  }
  flushWrites() { this.writer.flush(); this.emit(); return this.snapshot(); }
  pause(message = 'Đang tạm dừng: chờ đọc xong các mail chính đang xử lý và lưu danh sách alias…') {
    if (this.state !== 'running') return;
    this.state = 'pausing'; this.message = message;
    for (const wake of this.waiters) wake();
    this.emit();
  }
  wait() {
    return new Promise(resolve => {
      const wake = () => { clearTimeout(timer); this.waiters.delete(wake); resolve(); };
      const timer = setTimeout(wake, this.delayMs);
      this.waiters.add(wake);
    });
  }
  async run() {
    if (this.state !== 'ready') throw new Error('Lượt này đã chạy. Hãy bắt đầu lượt mới.');
    this.state = 'running'; this.startedAt = Date.now(); this.message = 'Đang đăng nhập để đọc danh sách alias…'; this.emit();
    const worker = async workerIndex => {
      while (this.state === 'running' && this.nextAccount < this.accounts.length) {
        const index = this.nextAccount++, account = this.accounts[index];
        this.attempted++; this.emit();
        let client, loggedIn = false;
        const record = { operation: 'list', jobId: `list-${index}`, mainEmail: account.email, alias: '' };
        try {
          client = this.createClient(message => {
            this.message = `Luồng ${workerIndex + 1}: ${message}`; this.emit();
          }, this.proxies[index % this.proxies.length]);
          await client.login(account); loggedIn = true;
          const addresses = await client.listAddresses();
          if (!Array.isArray(addresses) || addresses.some(item => !validEmail(item?.address))) throw new Error('Invalid address list');
          const aliases = [...new Set(addresses.map(item => item.address.trim().toLowerCase()))].filter(alias => alias !== account.email);
          if (aliases.length) this.write(this.resultFile,
            aliases.map(alias => `${account.email}|${account.password}|${alias}\n`).join(''), account, index);
          this.succeeded++; this.aliasesFound += aliases.length;
          if (!aliases.length) this.emit({ ...record, status: 'empty', message: 'Mail chính hiện không có alias.' });
          aliases.forEach((alias, aliasIndex) => this.emit({ ...record, jobId: aliasIndex ? `${record.jobId}-${aliasIndex}` : record.jobId,
            alias, status: 'listed', message: 'Alias hiện có trong mail chính.',
            exportMessage: this.writer.pendingCount ? 'Có kết quả đang chờ ghi vào file.' : 'Đã ghi mailchinh-alias.txt.' }));
        } catch (error) {
          this.failed++;
          const code = loggedIn ? 'alias_list_failed' : 'main_login_failed';
          if (!loggedIn) {
            this.loginFailed++;
            this.write(this.mainFailFile, `${account.email}|${code}\n`, account, index);
          } else this.write(this.failFile, `${account.email}|${account.password}||${code}\n`, account, index);
          this.emit({ ...record, status: 'failed', errorCode: code,
            message: error?.safeMessage || (loggedIn ? 'Không đọc được danh sách alias.' : 'Không đăng nhập được mail chính.') });
        } finally {
          try { await client?.close(); }
          catch { this.write(this.failFile, `${account.email}|${account.password}||session_close_failed\n`, account, index); }
        }
        if (this.state === 'running' && this.nextAccount < this.accounts.length) await this.wait();
      }
    };
    await Promise.all(Array.from({ length: this.concurrency }, (_, index) => worker(index)));
    this.elapsedMs += Date.now() - this.startedAt; this.startedAt = null;
    const paused = this.state === 'pausing'; this.state = 'completed'; this.writer.flush();
    this.message = `${paused ? 'Đã tạm dừng' : 'Hoàn tất'}: đọc ${this.succeeded} mail chính, tìm thấy ${this.aliasesFound} alias; ${this.failed} mail chính lỗi.${paused ? ` Còn ${this.accounts.length - this.nextAccount} mail chính chưa chạy.` : ''}`;
    this.emit(); return this.snapshot();
  }
}
module.exports = { AliasListBatch };
