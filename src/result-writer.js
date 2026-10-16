const fs = require('node:fs');
const path = require('node:path');

// Append tuần tự theo file. Giữ offset byte để retry một lần ghi dở không lặp
// lại phần đã ghi. Nội dung tồn chỉ ở bộ nhớ, không đưa vào snapshot/log UI.
class ResultWriter {
  constructor(directory, io = fs) {
    this.directory = directory; this.io = io;
    this.queues = new Map(); this.errors = new Map();
  }
  enqueue(file, text) {
    const item = { buffer: Buffer.from(text), offset: 0, saved: false };
    if (!this.queues.has(file)) this.queues.set(file, []);
    this.queues.get(file).push(item);
    return item;
  }
  flush() {
    for (const [file, queue] of this.queues) {
      if (!queue.length) { this.errors.delete(file); continue; }
      let fd;
      try {
        this.io.mkdirSync(this.directory, { recursive: true });
        fd = this.io.openSync(file, 'a', 0o600);
        while (queue.length) {
          const item = queue[0];
          while (item.offset < item.buffer.length) {
            const bytes = this.io.writeSync(fd, item.buffer, item.offset, item.buffer.length - item.offset);
            if (!Number.isInteger(bytes) || bytes <= 0) throw Object.assign(new Error(), { code: 'EIO' });
            item.offset += bytes;
          }
          item.saved = true; item.buffer = Buffer.alloc(0); queue.shift();
        }
        this.errors.delete(file);
      } catch (error) {
        const code = /^E[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'EIO';
        this.errors.set(file, `Không ghi được ${path.basename(file)} (${code}).`);
      } finally {
        if (fd !== undefined) { try { this.io.closeSync(fd); } catch { /* Không gửi lại byte đã ghi. */ } }
      }
    }
  }
  get pendingCount() { return [...this.queues.values()].reduce((sum, queue) => sum + queue.length, 0); }
  get errorMessage() { return [...this.errors.values()].join(' '); }
}
module.exports = { ResultWriter };
