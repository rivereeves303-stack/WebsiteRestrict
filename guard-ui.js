import { createPinPad } from './pin-input.js';
let busy = false;
async function authenticate(challenge) {
  const dialog = document.createElement('dialog');
  dialog.className = 'auth-dialog';
  dialog.innerHTML = `<form><div class="eyebrow">PAUSE BEFORE YOU CHANGE</div><h2>验证后继续本次操作</h2><p class="hint">验证仅对本次操作有效，5 分钟内完成。取消不会修改任何规则。</p><label class="field" id="auth-password-field">保护密码<input id="auth-password" type="password" autocomplete="current-password" maxlength="128"></label><div id="auth-challenge-field"><label class="field-label" for="auth-text">请逐字手动输入下方文字（含标点和确认码）</label><p id="challenge-source" class="challenge-source" aria-label="挑战文字"></p><textarea id="auth-text" rows="4" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="手动输入挑战文字"></textarea><p class="hint">此区域禁用复制、剪切、粘贴和拖放，支持中文输入法。</p><p id="auth-progress" class="hint" aria-live="polite"></p></div><p id="auth-error" class="error" role="alert"></p><div class="dialog-footer"><button type="button" class="secondary" id="auth-cancel">取消</button><button class="primary" type="submit" id="auth-submit">验证并继续</button></div></form>`;
  document.body.append(dialog);
  const $ = s => dialog.querySelector(s);
  $('#auth-password').placeholder = '点击下方数字按钮';
  const pin = createPinPad([$('#auth-password')], $('#auth-password-field'));
  let method = challenge.passwordEnabled ? 'password' : 'challenge';
  const choices = document.createElement('div');
  choices.className = 'tabs auth-methods';
  choices.setAttribute('aria-label', '选择本次验证方式');
  for (const [value, label, available] of [['password', '使用密码', challenge.passwordEnabled], ['challenge', '文字挑战', challenge.challengeEnabled]]) {
    if (!available) continue;
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.method = value;
    button.onclick = () => { method = value; showMethod(); };
    choices.append(button);
  }
  $('#auth-password-field').before(choices);
  $('#challenge-source').textContent = challenge.text;
  const area = $('#auth-text');
  function showMethod() {
    const password = method === 'password';
    $('#auth-password-field').hidden = !password;
    $('#auth-password').required = password; $('#auth-password').disabled = !password;
    $('#auth-challenge-field').hidden = password;
    area.required = !password; area.disabled = password;
    $('#auth-error').textContent = '';
    choices.querySelectorAll('button').forEach(button => { button.classList.toggle('selected', button.dataset.method === method); button.setAttribute('aria-pressed', String(button.dataset.method === method)); });
    (password ? $('#auth-password') : area).focus();
  }
  showMethod();
  area.maxLength = challenge.text.length;
  function blocked(event) { event.preventDefault(); $('#auth-error').textContent = '请手动输入挑战文字，不能复制、粘贴或拖放。'; }
  for (const type of ['copy', 'cut', 'paste', 'drop', 'contextmenu']) $('#auth-challenge-field').addEventListener(type, blocked);
  area.addEventListener('beforeinput', event => { if (!event.isTrusted || /paste|drop|replacement/i.test(event.inputType)) blocked(event); });
  area.addEventListener('input', () => { $('#auth-progress').textContent = `已输入 ${area.value.length} / ${challenge.text.length} 字符`; });
  return new Promise((resolve, reject) => {
    let settled = false;
    let submitting = false;
    const cancel = () => { if (!settled && !submitting) { settled = true; dialog.close(); dialog.remove(); const error = new Error('已取消操作'); error.cancelled = true; reject(error); } };
    $('#auth-cancel').onclick = cancel;
    dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
    $('form').onsubmit = async event => {
      event.preventDefault();
      if (submitting) return;
      if (method === 'password' && !/^\d{4}$/.test($('#auth-password').value)) { $('#auth-error').textContent = '请点击数字按钮输入完整的 4 位密码'; return; }
      if (method === 'challenge' && area.value !== challenge.text) { $('#auth-error').textContent = '挑战文字不一致，请检查标点、空格和确认码。'; return; }
      submitting = true; $('#auth-submit').disabled = true; $('#auth-cancel').disabled = true;
      pin.setDisabled(true);
      choices.querySelectorAll('button').forEach(button => button.disabled = true);
      try {
        const result = await chrome.runtime.sendMessage({ action: 'authorize', id: challenge.id, method, password: method === 'password' ? $('#auth-password').value : undefined, text: method === 'challenge' ? area.value : undefined });
        if (!result?.ok) throw new Error(result?.error || '验证失败');
        settled = true; dialog.close(); dialog.remove(); resolve(result);
      } catch (error) { $('#auth-error').textContent = error.message; if (method === 'password') pin.reset(); pin.setDisabled(false); submitting = false; $('#auth-submit').disabled = false; $('#auth-cancel').disabled = false; choices.querySelectorAll('button').forEach(button => button.disabled = false); }
    };
    dialog.showModal();
    (challenge.passwordEnabled ? $('#auth-password') : area).focus();
  });
}
export async function protectedRequest(action, extra = {}) {
  const mutation = ['save', 'delete', 'toggle', 'enabled', 'protection', 'uninstall'].includes(action);
  if (mutation && busy) throw new Error('请先完成当前验证');
  if (mutation) busy = true;
  try {
    let result = await chrome.runtime.sendMessage({ action, ...extra });
    if (result?.requiresAuth) result = await authenticate(result.challenge);
    if (!result?.ok) throw new Error(result?.error || '无法连接插件后台，请重新加载扩展');
    return result;
  } finally { if (mutation) busy = false; }
}
