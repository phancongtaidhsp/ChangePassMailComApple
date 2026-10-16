const $ = id => document.getElementById(id);
const api = window.mailcomAPI;
let current = { state: 'ready', elapsedMs: 0 };
let tickAt = Date.now();
let requesting = false;
let exporting = false;
function resultPresentation(result) {
  if (result.exportStatus === 'success') return { className: 'success', text: 'Đổi pass thành công' };
  if (result.exportStatus === 'fail') return { className: 'failure', text: 'Không hoàn tất' };
  if (result.status === 'attention') return { className: 'failure', text: 'Cần xử lý' };
  if (result.cleanupStatus === 'removing') return { className: 'pending', text: 'Đang xóa alias' };
  if (result.passwordChangeStatus === 'changing') return { className: 'pending', text: 'Đang đổi pass' };
  if (result.sendStatus === 'retrying') return { className: 'pending', text: 'Chờ gửi lại thư' };
  if (result.sendStatus === 'sending') return { className: 'pending', text: 'Đang gửi thư' };
  if (result.inboxStatus === 'checking') return { className: 'pending', text: 'Đang tìm link Apple' };
  if (result.status === 'added') return { className: 'pending', text: 'Đã thêm alias' };
  return { className: 'failure', text: 'Không hoàn tất' };
}

function showError(error) {
  $('message').textContent = error.message || String(error);
  $('message').classList.add('error');
}

async function call(promise) {
  const response = await promise;
  if (!response.ok) throw new Error(response.error);
  return response.value;
}

function update(snapshot) {
  current = snapshot;
  tickAt = Date.now();
  const busy = ['running', 'pausing'].includes(snapshot.state);
  const paused = snapshot.state === 'paused';
  if (Number.isInteger(snapshot.concurrency)) $('concurrency').value = snapshot.concurrency;
  if (Number.isFinite(snapshot.delayMs)) $('delayMs').value = snapshot.delayMs;
  for (const id of ['choose-email', 'choose-alias', 'choose-proxy', 'choose-output', 'concurrency', 'delayMs', 'start']) $(id).disabled = busy;
  $('start').disabled = busy || !!snapshot.pendingWrites;
  $('retry-writes').disabled = !snapshot.pendingWrites;
  $('export-results').disabled = exporting || snapshot.state !== 'completed' || !!snapshot.pendingWrites || !!snapshot.inputsExported;
  $('export-results').textContent = snapshot.inputsExported ? 'Đã xuất kết quả' : 'Xuất kết quả';
  $('input-export-status').hidden = !snapshot.inputExportMessage;
  $('input-export-status').textContent = snapshot.inputExportMessage || '';
  $('main-failures').textContent = snapshot.loginFailed || 0;
  $('write-status').hidden = !snapshot.pendingWrites;
  $('write-status').textContent = snapshot.pendingWrites
    ? `${snapshot.writeError || 'Chưa ghi được kết quả.'} Còn ${snapshot.pendingWrites} bản ghi trong bộ nhớ. Các luồng vẫn tiếp tục. Sau khi khắc phục, bấm Thử ghi lại; đóng ứng dụng sẽ mất phần chưa ghi.` : '';
  if (!snapshot.pendingWrites) {
    for (const label of document.querySelectorAll('.export-message')) label.textContent = `Đã ghi ${label.dataset.file}.`;
  }
  $('start').textContent = paused || snapshot.attempted ? 'Lượt đổi pass alias mới' : 'Bắt đầu đổi pass alias';
  $('pause').disabled = snapshot.state !== 'running';
  $('resume').hidden = !paused;
  $('resume').disabled = busy;
  $('open-results').disabled = !snapshot.outputDir;
  $('status').textContent = ({ ready: 'Sẵn sàng', running: 'Đang xử lý', pausing: 'Đang tạm dừng', paused: 'Đã tạm dừng', completed: 'Hoàn tất', error: 'Có lỗi' })[snapshot.state];
  $('passwordChanged').textContent = snapshot.finalSuccess || 0;
  $('linksFound').textContent = snapshot.linksFound || 0;
  $('passwordFailed').textContent = snapshot.finalFailed || 0;
  $('inProgress').textContent = Math.max(0, (snapshot.attempted || 0) - (snapshot.finalSuccess || 0) - (snapshot.finalFailed || 0));
  $('attention').textContent = snapshot.attention || 0;
  $('duplicates').textContent = `${snapshot.duplicates || 0} email trùng được bỏ qua`;
  $('progress').max = snapshot.total || 1;
  $('progress').value = (snapshot.finalSuccess || 0) + (snapshot.finalFailed || 0);
  $('message').textContent = snapshot.message || 'Chọn danh sách email để bắt đầu.';
  $('message').classList.toggle('error', snapshot.state === 'error' || !!snapshot.attention);
  if (snapshot.result) {
    $('empty')?.remove();
    const row = document.createElement('tr');
    row.dataset.jobId = String(snapshot.result.jobId);
    for (const old of [...$('rows').children]) { if (old.dataset.jobId === row.dataset.jobId) old.remove(); }
    const email = document.createElement('td'); email.textContent = snapshot.result.mainEmail;
    const alias = document.createElement('td'); alias.textContent = snapshot.result.alias;
    const status = document.createElement('td');
    const presentation = resultPresentation(snapshot.result);
    const badge = document.createElement('span'); badge.className = `badge ${presentation.className}`; badge.textContent = presentation.text; status.append(badge);
    const detail = document.createElement('td');
    if (snapshot.result.newPassword) {
      const password = document.createElement('code');
      password.textContent = snapshot.result.newPassword;
      detail.append('Mật khẩu mới: ', password);
      if (snapshot.result.cleanupStatus === 'removed') detail.append(' · Alias đã được xóa khỏi mail chính.');
      else if (snapshot.result.cleanupStatus === 'error') detail.append(` · ${snapshot.result.cleanupMessage || 'Xóa alias thất bại.'}`);
    } else {
      detail.textContent = (snapshot.result.exportStatus === 'fail' || snapshot.result.status === 'attention'
          ? (snapshot.result.cleanupStatus === 'error' ? snapshot.result.cleanupMessage : '') || snapshot.result.finalMessage || snapshot.result.passwordChangeMessage || snapshot.result.inboxMessage || snapshot.result.sendMessage || snapshot.result.message
          : ['sending', 'retrying'].includes(snapshot.result.sendStatus) ? snapshot.result.sendMessage : '') || 'Đang cập nhật…';
      if (snapshot.result.exportMessage) {
        const label = document.createElement('span'); label.className = 'export-message';
        label.dataset.file = snapshot.result.exportStatus === 'success' ? 'success.txt' : 'fail.txt';
        label.textContent = snapshot.result.exportMessage;
        detail.append(' · ', label);
      }
    }
    row.append(email, alias, status, detail); $('rows').prepend(row);
    while ($('rows').children.length > 100) $('rows').lastElementChild.remove();
  }
  renderTime();
}

function renderTime() {
  const seconds = Math.floor(((current.elapsedMs || 0) + (['running', 'pausing'].includes(current.state) ? Date.now() - tickAt : 0)) / 1000);
  $('elapsed').textContent = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

for (const [kind, field] of [['email', 'emailFile'], ['alias', 'aliasFile'], ['proxy', 'proxyFile'], ['output', 'outputRoot']]) {
  $(`choose-${kind}`).addEventListener('click', async () => {
    try { const filename = await call(api.choose(kind)); if (filename) $(field).value = filename; }
    catch (error) { showError(error); }
  });
}
$('start').addEventListener('click', async () => {
  if (requesting) return;
  requesting = true;
  const previous = $('rows').cloneNode(true);
  try {
    // Xóa trước khi invoke để sự kiện kết quả nhanh không bị xóa sau đó.
    $('rows').replaceChildren();
    await call(api.start({ emailFile: $('emailFile').value, aliasFile: $('aliasFile').value, proxyFile: $('proxyFile').value,
      outputRoot: $('outputRoot').value, concurrency: Number($('concurrency').value), delayMs: Number($('delayMs').value) }));
  } catch (error) { $('rows').replaceChildren(...previous.childNodes); showError(error); }
  finally { requesting = false; }
});
$('pause').addEventListener('click', () => call(api.pause()).catch(showError));
$('resume').addEventListener('click', () => call(api.resume()).catch(showError));
$('open-results').addEventListener('click', () => call(api.openResults()).catch(showError));
$('retry-writes').addEventListener('click', () => call(api.retryWrites()).catch(showError));
$('export-results').addEventListener('click', async () => {
  if (exporting) return;
  exporting = true;
  $('export-results').disabled = true;
  try { await call(api.exportResults()); }
  catch (error) { showError(error); }
  finally {
    exporting = false;
    $('export-results').disabled = current.state !== 'completed' || !!current.pendingWrites || !!current.inputsExported;
  }
});
api.onUpdate(update);
call(api.config()).then(config => { $('outputRoot').value = config.outputRoot || ''; $('emailFile').value = config.emailFile || ''; $('aliasFile').value = config.aliasFile || ''; $('proxyFile').value = config.proxyFile || ''; if (config.snapshot) update(config.snapshot); }).catch(showError);
setInterval(renderTime, 1000);
