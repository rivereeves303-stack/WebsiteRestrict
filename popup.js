import { isBlocked } from './core.js';
import { protectedRequest } from './guard-ui.js';
async function load(action = 'get', extra = {}) {
  const result = await protectedRequest(action, extra);
  if (!result?.ok) throw new Error(result?.error || '读取失败，请重新加载插件');
  document.querySelector('#enabled').checked = result.data.enabled;
  const blocked = result.data.rules.filter(r => result.data.enabled && isBlocked(r, result.data.usage)).length;
  document.querySelector('#summary').textContent = `${result.data.rules.length} 条网站规则 · ${blocked} 条正在限制`;
}
function error(e) { document.querySelector('#error').textContent = e.message; }
document.querySelector('#open').onclick = () => chrome.runtime.openOptionsPage();
document.querySelector('#enabled').onchange = event => { const checkbox = event.target; const enabled = checkbox.checked; checkbox.checked = !enabled; load('enabled', { enabled }).catch(error); };
load().catch(error);
