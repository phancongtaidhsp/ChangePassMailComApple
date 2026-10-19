const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const validEmail = value => /^[a-z0-9][a-z0-9._-]*@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);

function exportResultsFromFiles(options, { io = fs } = {}) {
  if (!options || typeof options.outputRoot !== 'string' || !options.outputRoot.trim()) throw new Error('Hãy chọn thư mục kết quả chứa success.txt, fail.txt và mailchinhfail.txt.');
  const retryMode = options.mode === 'retry';
  if (retryMode) {
    if (typeof options.retryFile !== 'string' || !options.retryFile.trim()) throw new Error('Hãy chọn file record lỗi cần lọc.');
  } else if (typeof options.emailFile !== 'string' || !options.emailFile.trim() || typeof options.aliasFile !== 'string' || !options.aliasFile.trim()) throw new Error('Hãy chọn file mail chính và mail phụ cần lọc.');
  let mainFile, aliasFile, outputDir;
  try {
    if (retryMode) aliasFile = io.realpathSync(options.retryFile);
    else { mainFile = io.realpathSync(options.emailFile); aliasFile = io.realpathSync(options.aliasFile); }
    outputDir = io.realpathSync(options.outputRoot);
    if (mainFile && !io.statSync(mainFile).isFile() || !io.statSync(aliasFile).isFile() || !io.statSync(outputDir).isDirectory()) throw new Error();
  } catch { throw new Error(retryMode ? 'Kiểm tra lại file record lỗi và thư mục kết quả đang chọn.' : 'Kiểm tra lại file mail chính, mail phụ và thư mục kết quả đang chọn.'); }
  if (mainFile === aliasFile) throw new Error('File mail chính và mail phụ không được trùng nhau.');
  const aliases = new Set(), mains = new Set();
  let filesRead = 0, skippedRecords = 0;
  // Đọc hết kết quả trước khi sửa đầu vào. Chỉ bỏ qua file chưa tồn tại.
  for (const name of ['success.txt', 'fail.txt', 'mailchinhfail.txt']) {
    const file = path.join(outputDir, name);
    let content;
    try {
      if ([mainFile, aliasFile].includes(io.realpathSync(file)) && !(retryMode && name === 'fail.txt')) throw Object.assign(new Error(), { code: 'INPUT_CONFLICT' });
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
      } else if (name === 'fail.txt') {
        // Hỗ trợ dòng cũ main|alias|code và dòng mới main|password|alias|code.
        // Đọc alias/code từ cuối để giữ đúng mật khẩu có chứa dấu |.
        const alias = (parts.at(-2) || '').trim().toLowerCase();
        const code = (parts.at(-1) || '').trim();
        if (parts.length < 3 || !validEmail(main) || !validEmail(alias) || !code) { skippedRecords++; continue; }
        if (code === 'unable_add_alias') aliases.add(alias);
      } else {
        // Dòng mới: main|password (có thể chứa |)|alias|password mới.
        // Dòng cũ: main|alias|password mới (giữ hỗ trợ cả password cũ chứa |).
        const newFormat = parts.length >= 4 && validEmail(parts.at(-2).trim());
        const alias = (newFormat ? parts.at(-2) : parts[1] || '').trim().toLowerCase();
        const password = newFormat ? parts.at(-1) : parts.slice(2).join('|');
        if (parts.length < 3 || !validEmail(main) || !validEmail(alias) || !password.trim()) { skippedRecords++; continue; }
        aliases.add(alias);
      }
    }
  }
  const aliasesRemoved = removeInputRows(aliasFile, aliases, { io, retryRecords: retryMode, failedMains: mains }).removed;
  const mainsRemoved = retryMode ? 0 : removeInputRows(mainFile, mains, { account: true, io }).removed;
  const message = filesRead
    ? `Đã xuất kết quả từ file TXT: ${retryMode ? `xóa ${aliasesRemoved} record khỏi file lỗi đang chọn` : `xóa ${aliasesRemoved} dòng alias và ${mainsRemoved} dòng mail chính khỏi file đang chọn`}.${skippedRecords ? ` Bỏ qua ${skippedRecords} dòng kết quả không hợp lệ.` : ''}`
    : 'Chưa có file kết quả TXT trong thư mục đang chọn. File đầu vào được giữ nguyên.';
  return { done: true, aliasesRemoved, mainsRemoved, filesRead, skippedRecords, message };
}

// Giữ nguyên BOM, nội dung từng dòng và kiểu xuống dòng của phần được giữ lại.
function removeInputRows(file, emails, { account = false, io = fs, retryRecords = false, failedMains = new Set() } = {}) {
  if (!emails.size && (!retryRecords || !failedMains.size)) return { removed: 0 };
  let temporary;
  try {
    const original = io.readFileSync(file, 'utf8');
    const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
    const rows = original.slice(bom.length).match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) || [];
    let removed = 0;
    const remaining = rows.filter(row => {
      const value = row.replace(/[\r\n]+$/, '');
      if (retryRecords) {
        const parts = value.split('|');
        if (parts.length < 4) return true;
        const main = parts[0].trim().toLowerCase(), alias = parts.at(-2).trim().toLowerCase();
        if (!validEmail(main) || !validEmail(alias) || !/^[a-z][a-z0-9_]*$/.test(parts.at(-1).trim())) return true;
        if (!emails.has(alias) && !failedMains.has(main)) return true;
        removed++; return false;
      }
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
