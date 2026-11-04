import { localDay, matches, validateRule, isBlocked, accrue, activeMilliseconds, nextAllowedAt, describe, normalizeDomain, websiteStatus } from './core.js';
import { MUTATIONS, publicProtection, createProtection, challengeText, normalizeProtection, needsVerification, verifyKey } from './protection.js';

let queue = Promise.resolve();
function run(work) {
  const result = queue.then(work);
  queue = result.catch(error => console.error('留白：', error));
  return result;
}

async function refresh(change) {
  const now = Date.now();
  const saved = await chrome.storage.local.get({ rules: [], usage: {}, totalMs: 0, day: localDay(), enabled: true, protection: {} });
  saved.protection = normalizeProtection(saved.protection);
  const { active } = await chrome.storage.session.get('active');
  if (saved.day !== localDay()) saved.totalMs = 0;
  if (saved.enabled && active && saved.rules.some(r => r.enabled && r.type === 'quota' && matches(r.domain, active.url))) saved.totalMs += activeMilliseconds(active, now);
  saved.usage = accrue(saved.rules, saved.day === localDay() ? saved.usage : {}, active, now);
  saved.day = localDay();
  if (change) await change(saved);
  await chrome.storage.local.set(saved);

  const blocked = saved.enabled ? saved.rules.filter(r => isBlocked(r, saved.usage)) : [];
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map(r => r.id),
    addRules: blocked.map((r, i) => ({ id: i + 1, priority: 1, action: { type: 'redirect', redirect: { regexSubstitution: chrome.runtime.getURL('blocked.html?site=') + '\\1' } }, condition: { requestDomains: [r.domain], regexFilter: '^https?://([^/:]+).*', resourceTypes: ['main_frame'] } }))
  });
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (blocked.some(r => matches(r.domain, tab.url))) {
      await chrome.tabs.update(tab.id, { url: chrome.runtime.getURL(`blocked.html?site=${encodeURIComponent(new URL(tab.url).hostname)}`) }).catch(() => {});
    }
  }
  const focused = await chrome.windows.getLastFocused().catch(() => null);
  const idle = await chrome.idle.queryState(60);
  // An idle user may still be reading the homepage. Count visible foreground
  // time regardless of input activity or media playback; pause on screen lock.
  const tab = focused?.focused && idle !== 'locked' ? (await chrome.tabs.query({ active: true, windowId: focused.id }))[0] : null;
  const next = saved.enabled && tab?.url && /^https?:/.test(tab.url) && !blocked.some(r => matches(r.domain, tab.url)) ? { url: tab.url, tabId: tab.id, since: now } : null;
  await chrome.storage.session.set({ active: next });
  await chrome.alarms.clear('quota');
  if (next) {
    const remaining = saved.rules.filter(r => r.enabled && r.type === 'quota' && matches(r.domain, next.url)).map(r => r.minutes * 60000 - (saved.usage[r.id] || 0)).filter(ms => ms > 0);
    if (remaining.length) await chrome.alarms.create('quota', { when: now + Math.min(...remaining) });
  }
  await chrome.action.setBadgeText({ text: saved.enabled ? (blocked.length ? String(blocked.length) : '') : '停' });
  await chrome.action.setBadgeBackgroundColor({ color: saved.enabled ? '#246852' : '#8c8f88' });
  return saved;
}

function tick() { run(() => refresh()); }
async function boot() { await chrome.alarms.create('tick', { periodInMinutes: 0.5 }); await refresh(); }
chrome.runtime.onInstalled.addListener(() => run(boot));
chrome.runtime.onStartup.addListener(() => run(boot));
chrome.alarms.onAlarm.addListener(tick);
chrome.tabs.onActivated.addListener(tick);
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url || info.status === 'complete') tick(); });
chrome.tabs.onRemoved.addListener(tick);
chrome.windows.onFocusChanged.addListener(tick);
chrome.idle.onStateChanged.addListener(tick);

function publicState(saved) { return { ...saved, protection: publicProtection(saved.protection) }; }
function owner(sender) { return sender.documentId || `${sender.tab?.id ?? 'popup'}:${sender.url}`; }
async function mutation(message, saved, preparedProtection) {
    if (message.action === 'save') {
      const rule = validateRule(message.rule);
      if (saved.rules.length >= 500 && !saved.rules.some(r => r.id === rule.id)) throw new Error('最多可添加 500 条规则');
      const index = saved.rules.findIndex(r => r.id === rule.id);
      if (index < 0) saved.rules.push(rule); else saved.rules[index] = rule;
    }
    if (message.action === 'delete') { saved.rules = saved.rules.filter(r => r.id !== message.id); delete saved.usage[message.id]; }
    if (message.action === 'toggle') saved.rules = saved.rules.map(r => r.id === message.id ? { ...r, enabled: !r.enabled } : r);
    if (message.action === 'enabled') saved.enabled = Boolean(message.enabled);
    if (message.action === 'protection') saved.protection = preparedProtection || await createProtection(message.settings || {}, saved.protection);
    // Browser confirmation is always required; browser-native uninstall cannot be intercepted.
    if (message.action === 'uninstall') await chrome.management.uninstallSelf({ showConfirmDialog: true });
}

async function handle(message, sender) {
  if (message.action === 'pageStatus') {
    const snapshot = await chrome.storage.local.get({ rules: [] });
    if (!snapshot.rules.some(rule => matches(rule.domain, sender.url))) return { ok: true, status: { matched: false } };
    const saved = await refresh();
    const { active } = await chrome.storage.session.get('active');
    return { ok: true, status: { ...websiteStatus(saved.rules, saved.usage, saved.enabled, sender.url), tracking: Boolean(active && active.tabId === sender.tab.id && matches(new URL(sender.url).hostname, active.url)) } };
  }
  if (message.action === 'blockedStatus') {
    const saved = await refresh();
    const domain = normalizeDomain(message.site);
    const rules = saved.enabled ? saved.rules.filter(r => matches(r.domain, `https://${domain}/`)) : [];
    const active = rules.filter(r => isBlocked(r, saved.usage));
    return { ok: true, status: { domain, blocked: active.length > 0, until: nextAllowedAt(rules, saved.usage), reasons: active.map(describe), now: Date.now() } };
  }
  if (message.action === 'authorize') {
    const { pending = {} } = await chrome.storage.session.get('pending');
    const entry = pending[message.id];
    if (!entry || entry.owner !== owner(sender) || entry.expires < Date.now()) throw new Error('验证已过期，请取消后重新操作');
    const { protection: storedProtection } = await chrome.storage.local.get({ protection: {} });
    const protection = normalizeProtection(storedProtection);
    if (entry.version !== JSON.stringify(protection)) throw new Error('保护设置已变化，请重新操作');
    if (!(await verifyKey(message, protection, entry.text))) {
      throw new Error('密码或挑战文字不正确，请重新输入');
    }
    delete pending[message.id];
    await chrome.storage.session.set({ pending });
    return { ok: true, data: publicState(await refresh(saved => mutation(entry.message, saved, entry.preparedProtection))) };
  }
  if (MUTATIONS.has(message.action)) {
    const snapshot = await chrome.storage.local.get({ rules: [], protection: {} });
    const protection = normalizeProtection(snapshot.protection);
    if (needsVerification(message, { ...snapshot, protection })) {
      const { pending = {} } = await chrome.storage.session.get('pending');
      for (const [id, entry] of Object.entries(pending)) if (entry.expires < Date.now() || entry.owner === owner(sender)) delete pending[id];
      if (Object.keys(pending).length >= 30) throw new Error('待验证操作过多，请稍后重试');
      const id = crypto.randomUUID();
      const text = protection.challengeEnabled ? challengeText() : '';
      let preparedProtection;
      if (message.action === 'protection') {
        preparedProtection = await createProtection(message.settings || {}, protection);
        // Never retain a new plaintext password in a pending verification checkpoint.
        message = { action: 'protection' };
      }
      pending[id] = { message, preparedProtection, owner: owner(sender), text, version: JSON.stringify(protection), expires: Date.now() + 5 * 60000 };
      await chrome.storage.session.set({ pending });
      return { ok: false, requiresAuth: true, challenge: { id, text, ...publicProtection(protection) } };
    }
  }
  return { ok: true, data: publicState(await refresh(MUTATIONS.has(message.action) ? saved => mutation(message, saved) : undefined)) };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.action === 'pageStatus') {
    if (!sender.tab || sender.frameId !== 0 || !/^https?:\/\//.test(sender.url || '')) return;
    run(() => handle(message, sender)).then(respond, error => respond({ ok: false, error: error.message }));
    return true;
  }
  if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  const path = new URL(sender.url).pathname;
  if (message?.action === 'blockedStatus' ? path !== '/blocked.html' : !['/index.html', '/popup.html'].includes(path)) return;
  if (!['get', 'blockedStatus', 'authorize', ...MUTATIONS].includes(message?.action)) return;
  run(() => handle(message, sender)).then(respond, error => respond({ ok: false, error: error.message }));
  return true;
});
