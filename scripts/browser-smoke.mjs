import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// Optional integration check. Uses an isolated profile and never touches the user's browser.
const browser = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = await mkdtemp(join(tmpdir(), 'website-restrict-smoke-'));
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><html lang="zh-CN"><head><title>网站计时验证</title></head><body style="font-family: sans-serif;padding:60px;background:#f5f7f2"><h1>网站正常浏览中</h1><p>每日剩余额度显示在此网页右下角。</p><a href="/next">站内下一页</a></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const websiteUrl = `http://localhost:${server.address().port}/`;
const child = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--disable-extensions-except=${resolve('.')}`, `--load-extension=${resolve('.')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(r => setTimeout(r, ms));
let socket;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await pause(150); }
  }
  assert.ok(port, 'Browser debugging endpoint started');
  console.log('Browser debugging endpoint ready');
  let worker;
  for (let i = 0; i < 50; i++) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    worker = targets.find(t => t.type === 'service_worker' && t.url.endsWith('/background.js'));
    if (worker) break;
    await pause(150);
  }
  assert.ok(worker, 'Unpacked extension loaded');
  console.log('Extension background loaded');
  const extension = new URL(worker.url).host;
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(`chrome-extension://${extension}/index.html`)}`, { method: 'PUT' })).json();
  console.log('Dashboard target created');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (pending.has(message.id)) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); if (message.error) reject(new Error(message.error.message)); else resolve(message.result); }
  };
  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  }
  async function evaluate(expression) {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1365, height: 950, deviceScaleFactor: 1, mobile: false });
  await pause(1000);
  assert.equal(await evaluate('document.title'), '留白 · 网站使用限制');
  assert.equal(await evaluate('document.querySelector("#empty").hidden'), false);
  await evaluate('document.querySelector("#add-rule").click(); document.querySelector("[name=domain]").value = "localhost"; document.querySelector("[name=type]").value = "always"; document.querySelector("[name=type]").dispatchEvent(new Event("change")); document.querySelector("#rule-form").requestSubmit()');
  await pause(750);
  assert.equal(await evaluate('document.querySelectorAll(".rule-card").length'), 1);
  assert.equal(await evaluate('document.querySelector(".badge").textContent'), '限制访问中');
  const shot = await cdp('Page.captureScreenshot', { format: 'png' });
  const screenshot = join(profile, 'dashboard.png');
  await writeFile(screenshot, Buffer.from(shot.data, 'base64'));
  await cdp('Page.navigate', { url: websiteUrl });
  await pause(750);
  assert.match(await evaluate('location.href'), /chrome-extension:\/\/.*\/blocked.html/);
  assert.equal(await evaluate('document.querySelector("h1").textContent'), '停一下，把注意力带回来。');
  assert.equal(await evaluate('document.querySelector("#remaining-time").textContent'), '持续限制中');
  await cdp('Page.navigate', { url: `chrome-extension://${extension}/index.html` });
  await pause(500);
  const result = await evaluate('(async () => { const result = await chrome.runtime.sendMessage({action:"enabled",enabled:false}); return {ok:result.ok, rules:await chrome.declarativeNetRequest.getDynamicRules()}; })()');
  assert.equal(result.ok, true); assert.equal(result.rules.length, 0);
  // Verify the timer on the actual website BEFORE the quota is exhausted.
  await evaluate('(async () => { const state = await chrome.runtime.sendMessage({action:"get"}); await chrome.runtime.sendMessage({action:"save",rule:{id:state.data.rules[0].id,domain:"localhost",type:"quota",minutes:1}}); await chrome.runtime.sendMessage({action:"enabled",enabled:true}); await chrome.windows.update((await chrome.windows.getCurrent()).id,{focused:true}); })()');
  await cdp('Page.navigate', { url: websiteUrl });
  await cdp('Page.bringToFront');
  await pause(1000);
  assert.equal(await evaluate('document.title'), '网站计时验证');
  assert.equal(await evaluate('document.querySelector("#liubai-time-widget")?.shadowRoot.querySelectorAll("header,button,#label,#detail").length'), 0);
  const position = await evaluate('(() => { const r = document.querySelector("#liubai-time-widget").getBoundingClientRect(); return {right:innerWidth-r.right,bottom:innerHeight-r.bottom,width:r.width}; })()');
  assert.equal(position.right, 16); assert.equal(position.bottom, 16); assert.ok(position.width < 130);
  assert.match(await evaluate('document.querySelector("#liubai-time-widget").shadowRoot.querySelector("#time").textContent'), /^00:0[01]:\d{2}$/);
  const beforeTick = await evaluate('document.querySelector("#liubai-time-widget").shadowRoot.querySelector("#time").textContent');
  let afterTick = beforeTick;
  for (let attempt = 0; attempt < 12 && afterTick === beforeTick; attempt++) {
    await pause(1000);
    afterTick = await evaluate('document.querySelector("#liubai-time-widget").shadowRoot.querySelector("#time").textContent');
  }
  assert.notEqual(afterTick, beforeTick, 'Remaining foreground time must visibly count down');
  await writeFile(join(profile, 'website-timer.png'), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await cdp('Page.navigate', { url: websiteUrl + 'next' });
  await pause(750);
  assert.equal(await evaluate('!!document.querySelector("#liubai-time-widget")?.shadowRoot.querySelector("#time")'), true);
  // Use the extension page to pause, then confirm the website displays paused status.
  // The current target can navigate back without changing any user browser state.
  await cdp('Page.navigate', { url: `chrome-extension://${extension}/index.html` });
  await pause(500);
  await evaluate('chrome.runtime.sendMessage({action:"enabled",enabled:false})');
  await cdp('Page.navigate', { url: websiteUrl });
  await pause(750);
  assert.equal(await evaluate('document.querySelector("#liubai-time-widget") === null'), true);
  await cdp('Page.navigate', { url: `chrome-extension://${extension}/index.html` });
  await pause(500);
  // Replace the permanent block with a date rule and verify its real countdown page.
  await evaluate('(async () => { const state = await chrome.runtime.sendMessage({action:"get"}); const rule = state.data.rules[0]; const d = new Date(); const day = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; await chrome.runtime.sendMessage({action:"save",rule:{id:rule.id,domain:"localhost",type:"dates",from:day,to:day}}); await chrome.runtime.sendMessage({action:"enabled",enabled:true}); })()');
  await cdp('Page.navigate', { url: websiteUrl });
  await pause(750);
  assert.match(await evaluate('document.querySelector("#remaining-time").textContent'), /^\d{2}:\d{2}:\d{2}$/);
  assert.match(await evaluate('document.querySelector("#release-at").textContent'), /预计可访问/);
  await writeFile(join(profile, 'countdown.png'), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await cdp('Page.navigate', { url: `chrome-extension://${extension}/index.html` });
  await pause(500);

  await evaluate('document.querySelector("#configure-protection").click(); const f = document.querySelector("#protection-form"); f.elements.protectionEnabled.click(); for(const name of ["newPassword","confirmPassword"]){f.elements[name].focus(); for(const digit of "0123")document.querySelector(`#setup-pin-pad [data-key="${digit}"]`).click();} f.requestSubmit()');
  await pause(750);
  assert.equal(await evaluate('document.querySelector("#protection-status").textContent'), '密码或文字挑战，任选一种验证');
  await evaluate('document.querySelector("#add-rule").click(); document.querySelector("[name=domain]").value="new.test"; document.querySelector("#rule-form").requestSubmit()');
  await pause(500);
  assert.equal(await evaluate('document.querySelectorAll(".rule-card").length'), 2);
  assert.equal(await evaluate('document.querySelector(".auth-dialog") === null'), true);
  // Password alone authorizes closing restrictions.
  await evaluate('document.querySelector("#global-enabled").click()');
  await pause(250);
  assert.equal(await evaluate('document.querySelectorAll(".auth-methods button").length'), 2);
  assert.equal(await evaluate('document.querySelector("#auth-password").readOnly'), true);
  assert.equal(await evaluate('document.querySelector("#auth-password").maxLength'), 4);
  await evaluate('document.querySelector("#auth-password").focus()');
  await cdp('Input.insertText', { text: '1234' });
  assert.equal(await evaluate('document.querySelector("#auth-password").value'), '');
  await evaluate('for(const digit of "12345")document.querySelector(`#auth-password-field [data-key="${digit}"]`).click()');
  assert.equal(await evaluate('document.querySelector("#auth-password").value'), '1234');
  await evaluate('document.querySelector(`#auth-password-field [data-key="⌫"]`).click()');
  assert.equal(await evaluate('document.querySelector("#auth-password").value'), '123');
  await evaluate('document.querySelector(`#auth-password-field [data-key="清空"]`).click()');
  assert.equal(await evaluate('document.querySelector("#auth-password").value'), '');
  for(let attempt=0; attempt<7; attempt++) {
    await evaluate('for(const digit of "9999")document.querySelector(`#auth-password-field [data-key="${digit}"]`).click(); document.querySelector(".auth-dialog form").requestSubmit()');
    await pause(250);
    assert.match(await evaluate('document.querySelector("#auth-error").textContent'), /不正确/);
    assert.equal(await evaluate('document.querySelector("#auth-submit").disabled'), false);
    assert.equal(await evaluate('document.querySelector(`#auth-password-field [data-key="1"]`).disabled'), false);
    assert.equal(await evaluate('document.querySelector("#auth-password").value'), '');
  }
  await writeFile(join(profile,'pin-keypad.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate('for(const digit of "0123")document.querySelector(`#auth-password-field [data-key="${digit}"]`).click(); document.querySelector(".auth-dialog form").requestSubmit()');
  await pause(750);
  assert.equal(await evaluate('document.querySelector("#global-enabled").checked'), false);
  await evaluate('document.querySelector("#global-enabled").click()');
  await pause(500);
  assert.equal(await evaluate('document.querySelector(".auth-dialog") === null'), true);
  assert.equal(await evaluate('document.querySelector("#global-enabled").checked'), true);
  // Choose the other key on the next closing operation, without changing protection settings.
  await evaluate('document.querySelector("#global-enabled").click()');
  await pause(250);
  await evaluate('document.querySelector(".auth-methods [data-method=challenge]").click()');
  assert.equal(await evaluate('document.querySelector("#auth-password").disabled'), true);
  assert.equal(await evaluate('(() => {const e=new Event("paste",{bubbles:true,cancelable:true});document.querySelector("#auth-text").dispatchEvent(e);return e.defaultPrevented;})()'), true);
  const text = await evaluate('document.querySelector("#challenge-source").textContent');
  await evaluate('document.querySelector("#auth-text").focus()');
  await cdp('Input.insertText', { text });
  await writeFile(join(profile, 'two-keys.png'), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await evaluate('document.querySelector(".auth-dialog form").requestSubmit()');
  await pause(750);
  assert.equal(await evaluate('document.querySelector("#global-enabled").checked'), false);
  await cdp('Page.navigate', { url: `chrome-extension://${extension}/popup.html` });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 420, height: 580, deviceScaleFactor: 1, mobile: false });
  await pause(500);
  await evaluate('document.querySelector("#enabled").click()');
  await pause(500);
  assert.equal(await evaluate('document.querySelector("#enabled").checked'), true);
  assert.equal(await evaluate('document.querySelector(".auth-dialog") === null'), true);
  await evaluate('document.querySelector("#enabled").click()');
  await pause(250);
  assert.equal(await evaluate('document.querySelectorAll(".auth-methods button").length'), 2);
  await evaluate('document.querySelector("#auth-cancel").click()');
  await pause(250);
  assert.equal((await evaluate('chrome.runtime.sendMessage({action:"get"})')).data.enabled, true);
  console.log(`Browser smoke passed: timer, direct rule creation and enabling, password OR challenge on disabling, popup cancellation. Screenshots: ${profile}`);
} finally {
  socket?.close();
  child.kill();
  server.closeAllConnections(); server.close();
}
