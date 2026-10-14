const fs = require('node:fs');
const path = require('node:path');
const ProtonMail = require('./services/protonmail');
const { normalizeProxyUrl } = require('./services/proxy');

function readList(filename) {
  if (!filename || !fs.statSync(filename).isFile()) throw new Error('Hãy chọn file TXT hợp lệ.');
  if (fs.statSync(filename).size > 20 * 1024 * 1024) throw new Error('File tối đa 20 MB.');
  return fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
}

function loadEmails(filename) {
  const lines = readList(filename);
  // Cho phép nhập file cũ nhưng không giữ mật khẩu hay email khôi phục.
  const emails = [...new Set(lines.map(line => line.split('|')[0].trim().toLowerCase()).filter(Boolean))];
  if (!emails.length) throw new Error('File chưa có email.');
  return { emails, duplicates: lines.length - emails.length };
}

function atomicWrite(filename, content) {
  const temporary = `${filename}.tmp.txt`;
  try {
    fs.writeFileSync(temporary, content, 'utf8');
    fs.renameSync(temporary, filename);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

const textField = value => String(value ?? '').replace(/[\r\n|]/g, ' ');

class Batch {
  constructor(options, { createChecker = proxy => new ProtonMail(proxy), onUpdate = () => {} } = {}) {
    const { emails, duplicates } = loadEmails(options.emailFile);
    const concurrency = Number(options.concurrency ?? 1);
    const delayMs = Number(options.delayMs ?? 1500);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 200) throw new Error('Số luồng phải từ 1 đến 200.');
    if (!Number.isFinite(delayMs) || delayMs < 1000 || delayMs > 60000) throw new Error('Khoảng nghỉ phải từ 1.000 đến 60.000 ms.');
    this.proxies = options.proxyFile ? readList(options.proxyFile).map(normalizeProxyUrl) : [];
    this.emails = emails;
    this.duplicates = duplicates;
    this.concurrency = concurrency;
    this.delayMs = delayMs;
    this.createChecker = createChecker;
    this.onUpdate = onUpdate;
    this.results = new Map();
    this.state = 'ready';
    this.message = '';
    this.elapsedMs = 0;
    this.waiters = new Set();
    this.counts = { available: 0, unavailable: 0, unknown: 0 };
    fs.mkdirSync(options.outputRoot, { recursive: true });
    this.outputDir = fs.mkdtempSync(path.join(options.outputRoot, `${new Date().toISOString().replace(/[:.]/g, '-')}-`));
    fs.writeFileSync(path.join(this.outputDir, 'results.txt'), '');
    this.exportFiles();
  }

  snapshot() {
    return {
      state: this.state, message: this.message, total: this.emails.length,
      completed: this.results.size, duplicates: this.duplicates, ...this.counts,
      elapsedMs: this.elapsedMs + (this.startedAt ? Date.now() - this.startedAt : 0),
      outputDir: this.outputDir,
    };
  }

  emit(result) { this.onUpdate({ ...this.snapshot(), result }); }

  pause(message = 'Đang chờ các yêu cầu đang chạy hoàn tất…') {
    if (this.state !== 'running') return;
    this.state = 'pausing';
    this.message = message;
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

  exportFiles() {
    const groups = { available: [], unavailable: [], unknown: [] };
    for (const email of this.emails) {
      const result = this.results.get(email);
      if (result) groups[result.availability].push(email);
    }
    const writeLines = (name, lines) => atomicWrite(path.join(this.outputDir, name), lines.length ? `${lines.join('\n')}\n` : '');
    for (const [name, emails] of Object.entries(groups)) writeLines(`${name}.txt`, emails);
    writeLines('pending.txt', this.emails.filter(email => !this.results.has(email)));
    const snapshot = this.snapshot();
    writeLines('summary.txt', [
      `Trạng thái: ${snapshot.state}`, `Thông báo: ${textField(snapshot.message)}`,
      `Tổng email: ${snapshot.total}`, `Đã kiểm tra: ${snapshot.completed}`,
      `Còn đăng ký được: ${snapshot.available}`, `Không khả dụng: ${snapshot.unavailable}`,
      `Chưa xác định: ${snapshot.unknown}`, `Chưa kiểm tra: ${snapshot.total - snapshot.completed}`,
      `Email trùng bỏ qua: ${snapshot.duplicates}`, `Thời gian (ms): ${snapshot.elapsedMs}`,
    ]);
  }

  async run() {
    if (!['ready', 'paused'].includes(this.state)) throw new Error('Lượt kiểm tra này không thể bắt đầu/tiếp tục.');
    this.state = 'running';
    this.message = 'Đang kiểm tra email…';
    this.startedAt = Date.now();
    this.emit();
    const pending = this.emails.filter(email => !this.results.has(email));
    let next = 0;
    let failure;
    const worker = async index => {
      try {
        const checker = this.createChecker(this.proxies.length ? this.proxies[index % this.proxies.length] : null);
        while (this.state === 'running' && next < pending.length) {
          const email = pending[next++];
          let result;
          try { result = await checker.CheckEmail(email); }
          catch { result = { status: 'error', availability: 'unknown', exists: null, message: 'Không thể kiểm tra email.' }; }
          const availability = result.status === 'success' && ['available', 'unavailable'].includes(result.availability)
            ? result.availability : 'unknown';
          const record = { ...result, email, availability, checkedAt: new Date().toISOString() };
          // Nhật ký văn bản: chỉ tăng bộ đếm khi đã ghi thành công.
          const detail = [email, availability, record.message, record.httpStatus, record.code,
            record.errorCode, record.retries ?? 0, record.checkedAt].map(textField).join('|');
          fs.appendFileSync(path.join(this.outputDir, 'results.txt'), `${detail}\n`);
          this.results.set(email, record);
          this.counts[availability]++;
          if (result.httpStatus === 429 || result.verificationRequired || result.code === 5003) {
            this.pause(result.httpStatus === 429
              ? `Proton giới hạn yêu cầu. Đã tạm dừng${result.retryAfter ? `; Retry-After: ${result.retryAfter}` : ''}.`
              : result.message);
          }
          this.emit(record);
          if (this.state === 'running' && next < pending.length) await this.wait();
        }
      } catch (error) {
        failure = error;
        this.pause('Đã dừng vì lỗi xử lý hoặc lưu kết quả.');
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, pending.length) }, (_, i) => worker(i)));
    this.elapsedMs += Date.now() - this.startedAt;
    this.startedAt = null;
    this.state = failure ? 'error' : this.results.size === this.emails.length ? 'completed' : 'paused';
    if (failure) this.message = `Lỗi xử lý/lưu kết quả: ${failure.message}`;
    else if (this.state === 'completed') this.message = 'Đã kiểm tra hết danh sách.';
    else if (this.message === 'Đang chờ các yêu cầu đang chạy hoàn tất…') this.message = 'Đã tạm dừng. Có thể tiếp tục lượt này.';
    try { this.exportFiles(); }
    catch (error) { this.state = 'error'; this.message = `Không thể xuất file: ${error.message}. Kết quả đã ghi nằm trong results.txt.`; }
    this.emit();
    return this.snapshot();
  }
}

module.exports = { Batch, loadEmails };
