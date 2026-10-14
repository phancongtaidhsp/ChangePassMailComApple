const $ = id => document.getElementById(id);
const api = window.protonAPI;
let current = { state: 'ready', elapsedMs: 0 };
let tickAt = Date.now();
let requesting = false;
const labels = { available: 'Còn đăng ký được', unavailable: 'Không khả dụng', unknown: 'Chưa xác định' };

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
  for (const id of ['choose-email', 'choose-proxy', 'clear-proxy', 'choose-output', 'concurrency', 'delayMs', 'start']) $(id).disabled = busy;
  $('start').textContent = paused || snapshot.completed ? 'Lượt kiểm tra mới' : 'Bắt đầu kiểm tra';
  $('pause').disabled = snapshot.state !== 'running';
  $('resume').hidden = !paused;
  $('resume').disabled = busy;
  $('open-results').disabled = !snapshot.outputDir;
  $('status').textContent = ({ ready: 'Sẵn sàng', running: 'Đang kiểm tra', pausing: 'Đang tạm dừng', paused: 'Đã tạm dừng', completed: 'Hoàn tất', error: 'Có lỗi' })[snapshot.state];
  $('completed').replaceChildren(document.createTextNode(`${snapshot.completed || 0} `));
  const total = document.createElement('small'); total.textContent = `/ ${snapshot.total || 0}`; $('completed').append(total);
  for (const key of ['available', 'unavailable', 'unknown']) $(key).textContent = snapshot[key] || 0;
  $('duplicates').textContent = `${snapshot.duplicates || 0} email trùng được bỏ qua`;
  $('progress').max = snapshot.total || 1;
  $('progress').value = snapshot.completed || 0;
  $('message').textContent = snapshot.message || 'Chọn danh sách email để bắt đầu.';
  $('message').classList.toggle('error', snapshot.state === 'error');
  if (snapshot.result) {
    $('empty')?.remove();
    const row = document.createElement('tr');
    const email = document.createElement('td'); email.textContent = snapshot.result.email;
    const status = document.createElement('td');
    const badge = document.createElement('span'); badge.className = `badge ${snapshot.result.availability}`; badge.textContent = labels[snapshot.result.availability]; status.append(badge);
    const detail = document.createElement('td'); detail.textContent = snapshot.result.message;
    row.append(email, status, detail); $('rows').prepend(row);
    while ($('rows').children.length > 100) $('rows').lastElementChild.remove();
  }
  renderTime();
}

function renderTime() {
  const seconds = Math.floor(((current.elapsedMs || 0) + (['running', 'pausing'].includes(current.state) ? Date.now() - tickAt : 0)) / 1000);
  $('elapsed').textContent = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

for (const [kind, field] of [['email', 'emailFile'], ['proxy', 'proxyFile'], ['output', 'outputRoot']]) {
  $(`choose-${kind}`).addEventListener('click', async () => {
    try { const filename = await call(api.choose(kind)); if (filename) $(field).value = filename; }
    catch (error) { showError(error); }
  });
}
$('clear-proxy').addEventListener('click', () => { $('proxyFile').value = ''; });
$('start').addEventListener('click', async () => {
  if (requesting) return;
  requesting = true;
  const previous = $('rows').cloneNode(true);
  try {
    // Xóa trước khi invoke để sự kiện kết quả nhanh không bị xóa sau đó.
    $('rows').replaceChildren();
    await call(api.start({ emailFile: $('emailFile').value, proxyFile: $('proxyFile').value,
      outputRoot: $('outputRoot').value, concurrency: Number($('concurrency').value), delayMs: Number($('delayMs').value) }));
  } catch (error) { $('rows').replaceChildren(...previous.childNodes); showError(error); }
  finally { requesting = false; }
});
$('pause').addEventListener('click', () => call(api.pause()).catch(showError));
$('resume').addEventListener('click', () => call(api.resume()).catch(showError));
$('open-results').addEventListener('click', () => call(api.openResults()).catch(showError));
api.onUpdate(update);
call(api.config()).then(config => { $('outputRoot').value = config.outputRoot; if (config.snapshot) update(config.snapshot); }).catch(showError);
setInterval(renderTime, 1000);
