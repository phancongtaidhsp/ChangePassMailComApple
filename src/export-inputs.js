const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const validEmail = value => /^[a-z0-9][a-z0-9._-]*@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);

function exportResultsFromFiles(options, { io = fs } = {}) {
  if (!options || typeof options.outputRoot !== 'string' || !options.outputRoot.trim()) throw new Error('Hãy chọn thư mục kết quả chứa success.txt, fail.txt và mailchinhfail.txt.');
  if (typeof options.emailFile !== 'string' || !options.emailFile.trim() || typeof options.aliasFile !== 'string' || !options.aliasFile.trim()) throw new Error('Hãy chọn file mail chính và mail phụ cần lọc.');
  let mainFile, aliasFile, outputDir;
  try {
    mainFile = io.realpathSync(options.emailFile); aliasFile = io.realpathSync(options.aliasFile);
    outputDir = io.realpathSync(options.outputRoot);
    if (!io.statSync(mainFile).isFile() || !io.statSync(aliasFile).isFile() || !io.statSync(outputDir).isDirectory()) throw new Error();
  } catch { throw new Error('Kiểm tra lại file mail chính, mail phụ và thư mục kết quả đang chọn.'); }
  if (mainFile === aliasFile) throw new Error('File mail chính và mail phụ không được trùng nhau.');
  const aliases = new Set(), mains = new Set();
  let filesRead = 0, skippedRecords = 0;
  // Đọc hết kết quả trước khi sửa đầu vào. Chỉ bỏ qua file chưa tồn tại.
  for (const name of ['success.txt', 'fail.txt', 'mailchinhfail.txt']) {
    const file = path.join(outputDir, name);
    let content;
    try {
      if ([mainFile, aliasFile].includes(io.realpathSync(file))) throw Object.assign(new Error(), { code: 'INPUT_CONFLICT' });
      content = io.readFileSync(file, 'utf8'); filesRead++;
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      if (error.code === 'INPUT_CONFLICT') throw new Error('File kết quả trùng file đầu vào; không thể lọc.');
      throw new Error(`Không đọc được ${name}. Kiểm tra quyền đọc và dữ liệu trong thư mục kết quả.`);
    }
    for (const line of content.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
      if (!line.trim()) continue;
      const parts = line.split('|');
      const main = parts[0].trim().toLowerCase();
      if (name === 'mailchinhfail.txt') {
        if (parts.length !== 2 || !validEmail(main)) { skippedRecords++; continue; }
        if (parts[1].trim() === 'main_login_failed') mains.add(main);
      } else {
        const alias = (parts[1] || '').trim().toLowerCase();
        if (parts.length < 3 || !validEmail(main) || !validEmail(alias) || !parts.slice(2).join('|').trim()) { skippedRecords++; continue; }
        if (name === 'success.txt' || parts.length === 3 && parts[2].trim() === 'unable_add_alias') aliases.add(alias);
      }
    }
  }
  const aliasesRemoved = removeInputRows(aliasFile, aliases, { io }).removed;
  const mainsRemoved = removeInputRows(mainFile, mains, { account: true, io }).removed;
  const message = filesRead
    ? `Đã xuất kết quả từ file TXT: xóa ${aliasesRemoved} dòng alias và ${mainsRemoved} dòng mail chính khỏi file đang chọn.${skippedRecords ? ` Bỏ qua ${skippedRecords} dòng kết quả không hợp lệ.` : ''}`
    : 'Chưa có file kết quả TXT trong thư mục đang chọn. File đầu vào được giữ nguyên.';
  return { done: true, aliasesRemoved, mainsRemoved, filesRead, skippedRecords, message };
}

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

module.exports = { removeInputRows, exportResultsFromFiles };
