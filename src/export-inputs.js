const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Giữ nguyên BOM, nội dung từng dòng và kiểu xuống dòng của phần được giữ lại.
function removeInputRows(file, emails, { account = false, io = fs } = {}) {
  if (!emails.size) return { removed: 0 };
  let temporary;
  try {
    const original = io.readFileSync(file, 'utf8');
    const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
    const rows = original.slice(bom.length).match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) || [];
    let removed = 0;
    const remaining = rows.filter(row => {
      const value = row.replace(/[\r\n]+$/, '');
      const email = (account ? value.split('|', 1)[0] : value).trim().toLowerCase();
      if (!email || !emails.has(email)) return true;
      removed++; return false;
    });
    if (!removed) return { removed: 0 };
    temporary = `${file}.export-${randomUUID()}.tmp`;
    io.writeFileSync(temporary, bom + remaining.join(''), { flag: 'wx', mode: io.statSync(file).mode & 0o777 });
    if (io.readFileSync(file, 'utf8') !== original) throw Object.assign(new Error(), { code: 'INPUT_CHANGED' });
    io.renameSync(temporary, file);
    return { removed };
  } catch (error) {
    const code = /^(?:E[A-Z0-9_]+|INPUT_CHANGED)$/.test(error.code || '') ? error.code : 'EIO';
    throw new Error(`Không cập nhật được ${path.basename(file)} (${code}). File đã cập nhật trước đó được giữ; có thể bấm Xuất kết quả để thử lại.`);
  } finally {
    if (temporary) { try { io.unlinkSync(temporary); } catch { /* File đã đổi tên hoặc chưa được tạo. */ } }
  }
}

module.exports = { removeInputRows };
