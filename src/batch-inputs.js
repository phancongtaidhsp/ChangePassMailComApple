const fs = require('node:fs');

function lines(file) {
  if (!file || !fs.statSync(file).isFile()) throw new Error('Hãy chọn file TXT hợp lệ.');
  if (fs.statSync(file).size > 20 * 1024 * 1024) throw new Error('File tối đa 20 MB.');
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(x => x.trim());
}
const validEmail = value => /^[a-z0-9][a-z0-9._-]*@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);
function loadAccounts(file) {
  const accounts = [], seen = new Set();
  for (const [index, line] of lines(file).entries()) {
    const separator = line.indexOf('|');
    const email = line.slice(0, separator).trim().toLowerCase();
    const password = line.slice(separator + 1);
    if (separator < 1 || !validEmail(email) || !password) throw new Error(`Mail chính dòng ${index + 1}: cần email|password.`);
    if (seen.has(email)) throw new Error(`Mail chính dòng ${index + 1} bị trùng.`);
    seen.add(email); accounts.push({ email, password });
  }
  return accounts;
}
module.exports = { lines, validEmail, loadAccounts };
