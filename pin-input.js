export function createPinPad(inputs, container) {
  let active = inputs[0];
  const pad = document.createElement('div');
  pad.className = 'pin-pad';
  pad.setAttribute('role', 'group');
  pad.setAttribute('aria-label', '点击按钮输入四位数字密码');
  function select(input) {
    active = input;
    for (const field of inputs) field.classList.toggle('pin-active', field === input);
  }
  for (const input of inputs) {
    input.readOnly = true;
    input.inputMode = 'none';
    input.maxLength = 4;
    input.classList.add('pin-display');
    input.addEventListener('focus', () => select(input));
  }
  for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '清空', '0', '⌫']) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = key; button.dataset.key = key;
    button.setAttribute('aria-label', key === '⌫' ? '删除一位' : key === '清空' ? '清空密码' : `输入数字 ${key}`);
    button.addEventListener('click', () => {
      if (active.disabled) return;
      if (key === '清空') active.value = '';
      else if (key === '⌫') active.value = active.value.slice(0, -1);
      else if (active.value.length < 4) active.value += key;
      active.dispatchEvent(new Event('input', { bubbles: true }));
    });
    pad.append(button);
  }
  container.append(pad);
  select(active);
  return {
    reset() { for (const input of inputs) input.value = ''; select(inputs[0]); },
    setDisabled(disabled) { pad.querySelectorAll('button').forEach(button => button.disabled = disabled); }
  };
}
