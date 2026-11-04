const $ = selector => document.querySelector(selector);
const site = new URLSearchParams(location.search).get('site');
let status = null;
$('#manage').href = chrome.runtime.getURL('index.html');
function draw() {
  if (!status) return;
  $('#reason').textContent = `${status.domain} ${status.blocked ? '正处于你设置的限制中。' : '当前已可以访问。'}`;
  $('#remaining-label').textContent = status.blocked ? '距离下次可访问还剩' : '限制已解除';
  if (!status.blocked) $('#remaining-time').textContent = '现在可以访问';
  else if (status.until === null) $('#remaining-time').textContent = '持续限制中';
  else {
    const seconds = Math.max(0, Math.ceil((status.until - Date.now()) / 1000));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor(seconds % 86400 / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    $('#remaining-time').textContent = seconds === 0 ? '正在确认是否解除…' : `${days ? `${days} 天 ` : ''}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  $('#release-at').textContent = status.blocked ? (status.until === null ? '始终禁用或重复规则连续覆盖，没有自动解除时间。' : `预计可访问：${new Date(status.until).toLocaleString('zh-CN')}（本机时间）`) : '点击下方按钮重新访问网站。';
  $('#retry').hidden = status.blocked;
  $('#retry').href = `https://${status.domain}/`;
  $('#block-reasons').replaceChildren(...status.reasons.map(reason => { const li = document.createElement('li'); li.textContent = reason; return li; }));
}
async function update() {
  if (!site) { $('#remaining-time').textContent = '缺少网站信息'; $('#release-at').textContent = '请重新访问原网站以查看对应倒计时。'; return; }
  try {
    const result = await chrome.runtime.sendMessage({ action: 'blockedStatus', site });
    if (!result?.ok) throw new Error(result?.error || '读取失败');
    status = result.status; draw(); $('#countdown-error').textContent = '';
  } catch { $('#countdown-error').textContent = '暂时无法更新限制状态，请刷新页面重试。'; }
}
update();
setInterval(draw, 1000);
setInterval(update, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
