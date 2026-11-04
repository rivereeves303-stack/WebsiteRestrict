(() => {
  if (globalThis.__liubaiTimerLoaded) return;
  globalThis.__liubaiTimerLoaded = true;
  let host, root, state, receivedAt = 0, timer, requestInFlight = false, stopped = false;

  function mount() {
    if (host?.isConnected) return;
    host = document.createElement('div');
    host.id = 'liubai-time-widget';
    host.style.cssText = 'all:initial!important;position:fixed!important;bottom:16px!important;right:16px!important;z-index:2147483647!important;display:block!important;color-scheme:light!important;pointer-events:none!important;max-width:calc(100vw - 32px)!important;';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:#365640;color-scheme:light}
      #time{display:block;box-sizing:border-box;padding:7px 11px;background:#f7faf3ed;border:1px solid #dce6d5;border-radius:8px;box-shadow:0 2px 9px #203d2412;font-size:16px;font-weight:500;font-variant-numeric:tabular-nums;letter-spacing:.5px;line-height:1.4;white-space:nowrap}
      #time.urgent{color:#a66e38;border-color:#e6cfb3;background:#fff8eeed}
    </style><span id="time" role="timer" aria-label="网站剩余可用时间"></span>`;
    document.documentElement.append(host);
  }
  function duration(ms) {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    const days = Math.floor(seconds / 86400);
    return `${days ? `${days}天 ` : ''}${String(Math.floor(seconds % 86400 / 3600)).padStart(2, '0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function remainingQuota() { return state.quotaMs === null ? null : Math.max(0, state.quotaMs - (state.tracking ? performance.now() - receivedAt : 0)); }
  function draw() {
    if (!state?.matched || !state.enabled || state.blocked) { host?.remove(); return; }
    const quota = remainingQuota();
    const untilBlock = state.nextBlockAt === null ? null : Math.max(0, state.nextBlockAt - Date.now());
    const values = [quota, untilBlock].filter(ms => ms !== null);
    if (!values.length) { host?.remove(); return; }
    const remaining = Math.min(...values);
    mount();
    root.querySelector('#time').textContent = duration(remaining);
    root.querySelector('#time').classList.toggle('urgent', remaining <= 60000);
  }
  async function update() {
    if (stopped || requestInFlight) return;
    clearTimeout(timer); requestInFlight = true;
    try {
      const response = await chrome.runtime.sendMessage({ action: 'pageStatus' });
      if (!response?.ok) throw new Error('status unavailable');
      state = response.status; receivedAt = performance.now(); draw();
    } catch {
      if (!chrome.runtime?.id) { stopped = true; host?.remove(); clearInterval(ticker); return; }
      if (state?.matched) { state.quotaMs = remainingQuota(); state.tracking = false; host?.remove(); }
    } finally { requestInFlight = false; if (!stopped) timer = setTimeout(update, state?.matched ? 10000 : 60000); }
  }
  function pause() {
    if (state?.matched) { state.quotaMs = remainingQuota(); state.tracking = false; receivedAt = performance.now(); draw(); }
  }
  const ticker = setInterval(draw, 1000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else update(); });
  window.addEventListener('blur', pause);
  window.addEventListener('focus', update);
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && (changes.rules || changes.enabled)) update(); });
  update();
})();
