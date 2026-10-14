const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const MailCom = require('./services/mailcom');
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

function appendEmail(filename, email) {
  const fd = fs.openSync(filename, 'a+');
  try {
    const size = fs.fstatSync(fd).size;
    const last = Buffer.alloc(1);
    if (size) fs.readSync(fd, last, 0, 1, size - 1);
    const separator = size && last[0] !== 10 ? '\n' : '';
    fs.appendFileSync(fd, `${separator}${email}\n`);
  } finally {
    fs.closeSync(fd);
  }
}

const OUTPUT_FILES = { available: 'die.txt', unavailable: 'live.txt', unknown: 'unknown.txt' };

function nextEmailDelay(result, defaultDelayMs, now = Date.now()) {
  if (result.httpStatus !== 429) return defaultDelayMs;
  const header = String(result.retryAfter ?? '').trim();
  const retryMs = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - now;
  return Math.min(2147483647, Math.max(defaultDelayMs, Number.isFinite(retryMs) ? retryMs : 30000));
}

class Batch {
  constructor(options, { createChecker = proxy => new MailCom(proxy), onUpdate = () => {} } = {}) {
    const { emails, duplicates } = loadEmails(options.emailFile);
    const concurrency = Number(options.concurrency ?? 1);
    const delayMs = Number(options.delayMs ?? 1500);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 200) throw new Error('Số luồng phải từ 1 đến 200.');
    if (!Number.isFinite(delayMs) || delayMs < 1000 || delayMs > 60000) throw new Error('Khoảng nghỉ phải từ 1.000 đến 60.000 ms.');
    this.proxies = options.proxyFile ? readList(options.proxyFile).map(normalizeProxyUrl) : [];
    this.emails = emails;
    this.emailFile = fs.realpathSync(options.emailFile);
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
    this.outputDir = path.resolve(options.outputRoot);
    const inputs = [options.emailFile, options.proxyFile].filter(Boolean).map(file => fs.realpathSync(file));
    for (const name of Object.values(OUTPUT_FILES)) {
      const target = path.join(this.outputDir, name);
      const resolved = fs.existsSync(target) ? fs.realpathSync(target) : target;
      if (inputs.includes(resolved)) throw new Error('File kết quả trùng file đầu vào. Hãy chọn thư mục kết quả khác.');
    }
    for (const name of Object.values(OUTPUT_FILES)) {
      fs.appendFileSync(path.join(this.outputDir, name), '');
    }
  }

  snapshot() {
    return {
      state: this.state, message: this.message, total: this.emails.length,
      completed: this.results.size, duplicates: this.duplicates, ...this.counts,
      elapsedMs: this.elapsedMs + (this.startedAt ? Date.now() - this.startedAt : 0),
      outputDir: this.outputDir, emailFile: this.emailFile,
    };
  }

  emit(result) { this.onUpdate({ ...this.snapshot(), result }); }

  exportResults() {
    if (!['paused', 'completed', 'error'].includes(this.state)) {
      throw new Error('Hãy tạm dừng hoặc chờ kiểm tra hoàn tất trước khi xuất kết quả.');
    }
    // Chỉ loại kết quả của lượt này đã ghi thành công vào file live/die.
    const resolved = new Set([...this.results.values()]
      .filter(result => ['available', 'unavailable'].includes(result.availability))
      .map(result => result.email));
    const original = fs.readFileSync(this.emailFile, 'utf8');
    const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
    const lines = original.slice(bom.length).match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) || [];
    let removed = 0;
    const kept = lines.filter(line => {
      const email = line.trim().split('|')[0].trim().toLowerCase();
      if (email && resolved.has(email)) { removed++; return false; }
      return true;
    });
    const content = bom + kept.join('');
    if (removed) {
      const temporary = `${this.emailFile}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, content, { flag: 'wx', mode: fs.statSync(this.emailFile).mode & 0o777 });
        fs.renameSync(temporary, this.emailFile);
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
    }
    const remaining = kept.filter(line => line.trim()).length;
    this.message = `Đã xuất kết quả: xóa ${removed} dòng live/die khỏi file đầu vào, còn ${remaining} dòng. Bấm “Lượt kiểm tra mới” để kiểm tra lại phần còn lại.`;
    this.emit();
    return { removed, remaining, emailFile: this.emailFile };
  }

  pause(message = 'Đang chờ các yêu cầu đang chạy hoàn tất…') {
    if (this.state !== 'running') return;
    this.state = 'pausing';
    this.message = message;
    for (const wake of this.waiters) wake();
    this.emit();
  }

  wait(delayMs = this.delayMs) {
    return new Promise(resolve => {
      const wake = () => { clearTimeout(timer); this.waiters.delete(wake); resolve(); };
      const timer = setTimeout(wake, delayMs);
      this.waiters.add(wake);
    });
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
          // Lưu ngay từng email; chỉ tăng bộ đếm khi ghi thành công.
          appendEmail(path.join(this.outputDir, OUTPUT_FILES[availability]), email);
          this.results.set(email, record);
          this.counts[availability]++;
          this.emit(record);
          // Lỗi một email không dừng hàng đợi. Luồng nhận email tiếp theo sau khoảng nghỉ.
          if (this.state === 'running' && next < pending.length) await this.wait(nextEmailDelay(result, this.delayMs));
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
    this.emit();
    return this.snapshot();
  }
}

module.exports = { Batch, loadEmails, nextEmailDelay };
