import { isBlocked, describe, localDay } from './core.js';
import { protectedRequest } from './guard-ui.js';
import { createPinPad } from './pin-input.js';
const $ = s => document.querySelector(s);
let state = { rules: [], usage: {}, enabled: true }, view = 'all', filter = 'all', editing = null;
const form = $('#rule-form');
async function request(action, extra = {}) {
  const result = await protectedRequest(action, extra);
  if (!result?.ok) throw new Error(result?.error || '无法连接插件后台，请在扩展管理页重新加载插件');
  state = result.data;
  render();
}
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 3200); }
function el(tag, className, text) { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; }
function render() {
  const total = state.rules.length;
  $('#nav-count').textContent = total;
  $('#stat-total').replaceChildren(document.createTextNode(total), el('small', '', '条'));
  $('#stat-blocked').replaceChildren(document.createTextNode(new Set(state.rules.filter(r => state.enabled && isBlocked(r, state.usage)).map(r => r.domain)).size), el('small', '', '个网站'));
  $('#stat-usage').replaceChildren(document.createTextNode(Math.floor((state.totalMs || 0) / 60000)), el('small', '', '分钟'));
  $('#global-enabled').checked = state.enabled;
  $('#global-label').textContent = state.enabled ? '限制已开启' : '限制已暂停';
  const protection = state.protection || {};
  $('#protection-status').textContent = protection.passwordEnabled ? '密码或文字挑战，任选一种验证' : protection.challengeEnabled ? '文字挑战已开启，可设置密码作为另一把钥匙' : '尚未设置保护';
  const query = $('#search').value.trim().toLowerCase();
  const rules = state.rules.filter(r => (view === 'all' || r.type === view) && (filter === 'all' || r.enabled === (filter === 'enabled')) && `${r.name} ${r.domain}`.toLowerCase().includes(query));
  $('#rule-count').textContent = rules.length;
  $('#rules').replaceChildren();
  $('#empty').hidden = rules.length > 0;
  $('#empty h3').textContent = total ? '这里还没有匹配的规则' : '从一个小小的边界开始';
  $('#empty p').textContent = total ? '试试其他筛选条件，或添加一条新规则。' : '添加一个容易分心的网站，为今天留出专注时间。';
  $('#empty-add').textContent = total ? '＋ 添加网站规则' : '＋ 添加第一条规则';
  for (const rule of rules) {
    const row = el('article', 'rule-card');
    const icon = el('div', `site-icon ${rule.type}`, rule.domain.charAt(0).toUpperCase());
    const info = el('div', 'rule-info');
    const title = el('h3', '', rule.name || rule.domain);
    if (rule.name) title.append(el('span', 'domain', rule.domain));
    info.append(title, el('div', 'rule-description', describe(rule)));
    const status = el('div', 'rule-state');
    const active = state.enabled && rule.enabled;
    const blocked = active && isBlocked(rule, state.usage);
    status.append(el('span', `badge ${!active ? 'paused' : blocked ? 'blocked' : ''}`, !active ? '已暂停' : blocked ? '限制访问中' : '可正常访问'));
    if (rule.type === 'quota') {
      const minutes = (state.usage[rule.id] || 0) / 60000;
      status.append(el('small', 'usage-caption', `已用 ${Math.floor(minutes)} / ${rule.minutes} 分钟`));
      const progress = el('div', 'progress'); const fill = el('span', ''); fill.style.width = `${Math.min(100, minutes / rule.minutes * 100)}%`; progress.append(fill); status.append(progress);
    }
    const actions = el('div', 'row-actions');
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.setAttribute('role', 'switch'); toggle.checked = rule.enabled; toggle.setAttribute('aria-label', `${rule.enabled ? '暂停' : '启用'} ${rule.domain}`);
    toggle.addEventListener('change', () => request('toggle', { id: rule.id }).catch(error => { toast(error.message); render(); }));
    const edit = el('button', 'icon-button', '✎'); edit.title = '编辑规则'; edit.setAttribute('aria-label', `编辑 ${rule.domain}`); edit.addEventListener('click', () => openEditor(rule));
    const remove = el('button', 'icon-button', '×'); remove.title = '删除规则'; remove.setAttribute('aria-label', `删除 ${rule.domain}`); remove.addEventListener('click', () => { if (confirm(`删除 ${rule.name || rule.domain} 的限制规则？`)) request('delete', { id: rule.id }).then(() => toast('规则已删除')).catch(e => toast(e.message)); });
    actions.append(toggle, edit, remove); row.append(icon, info, status, actions); $('#rules').append(row);
  }
}
function panels() {
  for (const panel of document.querySelectorAll('[data-panel]')) {
    panel.hidden = panel.dataset.panel !== form.elements.type.value;
    for (const input of panel.querySelectorAll('input')) input.disabled = panel.hidden;
  }
}
function openEditor(rule) {
  editing = rule || null; form.reset(); $('#form-error').textContent = '';
  $('#editor-title').textContent = rule ? '编辑网站规则' : '添加网站规则';
  if (rule) {
    for (const key of ['domain', 'name', 'type', 'minutes', 'start', 'end', 'from', 'to']) if (rule[key] !== undefined) form.elements[key].value = rule[key];
    for (const input of form.querySelectorAll('[name="days"]')) input.checked = (rule.days || []).includes(Number(input.value));
  } else { form.elements.from.value = localDay(); form.elements.to.value = localDay(); }
  panels(); $('#editor').showModal();
}
$('#add-rule').onclick = () => openEditor(); $('#empty-add').onclick = () => openEditor();
$('#close-editor').onclick = $('#cancel-editor').onclick = () => $('#editor').close();
form.elements.type.onchange = panels;
form.addEventListener('submit', async event => {
  event.preventDefault(); $('#save-rule').disabled = true; $('#form-error').textContent = '';
  const values = Object.fromEntries(new FormData(form));
  values.days = [...form.querySelectorAll('[name="days"]:checked')].map(i => Number(i.value));
  if (editing) { values.id = editing.id; values.enabled = editing.enabled; }
  try { await request('save', { rule: values }); $('#editor').close(); toast('规则已保存并生效'); } catch (error) { $('#form-error').textContent = error.message; } finally { $('#save-rule').disabled = false; }
});
document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => { view = button.dataset.view; document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b === button)); render(); });
document.querySelectorAll('[data-filter]').forEach(button => button.onclick = () => { filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('selected', b === button)); render(); });
$('#search').oninput = render;
$('#global-enabled').onchange = event => request('enabled', { enabled: event.target.checked }).catch(e => { toast(e.message); render(); });
$('#today').textContent = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
request('get').catch(e => toast(e.message));
setInterval(() => { if (!document.hidden && !$('#editor').open) request('get').catch(e => toast(e.message)); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) request('get').catch(e => toast(e.message)); });

const protectionForm = $('#protection-form');
const setupPin = createPinPad([protectionForm.elements.newPassword, protectionForm.elements.confirmPassword], $('#setup-pin-pad'));
function passwordFields() {
  const password = protectionForm.elements.protectionEnabled.checked;
  $('#password-fields').hidden = !password;
  for (const name of ['newPassword', 'confirmPassword']) protectionForm.elements[name].disabled = !password;
}
$('#configure-protection').onclick = () => {
  protectionForm.reset();
  setupPin.reset();
  protectionForm.elements.protectionEnabled.checked = Boolean(state.protection?.passwordEnabled || state.protection?.challengeEnabled);
  $('#protection-error').textContent = '';
  passwordFields(); $('#protection-editor').showModal();
};
protectionForm.elements.protectionEnabled.onchange = passwordFields;
$('#close-protection').onclick = $('#cancel-protection').onclick = () => $('#protection-editor').close();
protectionForm.onsubmit = async event => {
  event.preventDefault(); $('#protection-error').textContent = '';
  const fields = protectionForm.elements;
  const enabled = fields.protectionEnabled.checked;
  const newPassword = enabled ? fields.newPassword.value : '';
  const passwordEnabled = enabled && Boolean(newPassword || state.protection?.passwordEnabled);
  if (newPassword && !/^\d{4}$/.test(newPassword)) { $('#protection-error').textContent = '请点击数字按钮输入完整的 4 位密码'; return; }
  if (enabled && newPassword !== fields.confirmPassword.value) { $('#protection-error').textContent = '两次输入的密码不一致'; return; }
  $('#save-protection').disabled = true;
  try {
    await request('protection', { settings: { passwordEnabled, challengeEnabled: enabled, newPassword } });
    protectionForm.reset(); $('#protection-editor').close(); toast('修改保护已更新');
  } catch (error) { $('#protection-error').textContent = error.message; } finally { $('#save-protection').disabled = false; }
};
$('#uninstall').onclick = () => { if (confirm('将验证当前保护并申请卸载，浏览器随后会显示最终确认。是否继续？')) request('uninstall').catch(e => toast(e.message)); };
