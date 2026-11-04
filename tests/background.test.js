import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDay } from '../core.js';

test('background persists rules, applies network redirects, accounts foreground use, and removes restrictions', async () => {
  const events = {};
  const event = name => ({ addListener(fn) { events[name] = fn; } });
  let local = { rules: [], usage: {}, totalMs: 0, day: localDay(), enabled: true };
  let session = {}, dynamic = [], focused = true, idleState = 'idle';
  const tabs = [{ id: 1, url: 'https://example.com/', active: true }];
  globalThis.chrome = {
    storage: {
      local: { get: async defaults => structuredClone({ ...defaults, ...local }), set: async value => { local = structuredClone(value); } },
      session: { get: async () => structuredClone(session), set: async value => { session = { ...session, ...structuredClone(value) }; } }
    },
    declarativeNetRequest: { getDynamicRules: async () => dynamic, updateDynamicRules: async value => { dynamic = value.addRules; } },
    tabs: { query: async () => structuredClone(tabs), update: async (id, value) => Object.assign(tabs.find(t => t.id === id), value), onActivated: event('activated'), onUpdated: event('updated'), onRemoved: event('removed') },
    windows: { getLastFocused: async () => ({ id: 1, focused }), onFocusChanged: event('focus') },
    idle: { queryState: async () => idleState, onStateChanged: event('idle') },
    alarms: { create: async () => {}, clear: async () => {}, onAlarm: event('alarm') },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    management: { uninstallSelf: async options => { assert.equal(options.showConfirmDialog, true); uninstallCalls++; } },
    runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}`, onInstalled: event('install'), onStartup: event('startup'), onMessage: event('message') }
  };
  let uninstallCalls = 0;
  await import('../background.js');
  const sender = { id: 'test', url: 'chrome-extension://test/index.html' };
  const send = message => new Promise(resolve => events.message(message, sender, resolve));
  let result = await send({ action: 'save', rule: { domain: 'example.com', type: 'quota', minutes: 1 } });
  assert.equal(result.ok, true);
  const id = result.data.rules[0].id;
  assert.equal(dynamic.length, 0);
  assert.equal(session.active.url, 'https://example.com/');
  const pageSender = { id: 'test', tab: { id: 1 }, frameId: 0, url: 'https://example.com/' };
  const fromPage = message => new Promise(resolve => events.message(message, pageSender, resolve));
  const pageState = await fromPage({ action: 'pageStatus', site: 'unrelated.test' });
  assert.equal(pageState.status.matched, true);
  assert.equal(pageState.status.tracking, true);
  assert.ok(pageState.status.quotaMs > 59000 && pageState.status.quotaMs <= 60000);
  assert.equal(pageState.data, undefined, 'Webpages receive no settings or password state');
  assert.equal(events.message({ action: 'enabled', enabled: false }, pageSender, () => {}), undefined);
  assert.equal(events.message({ action: 'pageStatus' }, { ...pageSender, frameId: 1 }, () => {}), undefined);
  session.active.since = Date.now() - 30000;
  result = await send({ action: 'get' });
  assert.ok(result.data.usage[id] >= 30000);
  assert.ok(result.data.totalMs >= 30000);
  assert.equal(session.active.url, 'https://example.com/', 'An idle user on a static homepage keeps counting without playback');
  idleState = 'locked';
  await send({ action: 'get' });
  assert.equal(session.active, null, 'Locking the screen stops counting');
  const lockedUsage = local.usage[id];
  await send({ action: 'get' });
  assert.equal(local.usage[id], lockedUsage, 'Locked-screen time is not added');
  idleState = 'idle';
  await send({ action: 'get' });
  assert.equal(session.active.url, 'https://example.com/', 'Unlocking resumes counting even without mouse or keyboard activity');
  focused = false;
  await send({ action: 'get' });
  assert.equal(session.active, null);
  assert.equal((await fromPage({ action: 'pageStatus' })).status.tracking, false);
  focused = true;
  await send({ action: 'get' });
  session.active.since = Date.now() - 40000;
  result = await send({ action: 'get' });
  assert.equal(dynamic.length, 1);
  assert.equal(dynamic[0].condition.requestDomains[0], 'example.com');
  assert.equal(dynamic[0].action.redirect.regexSubstitution, 'chrome-extension://test/blocked.html?site=\\1');
  assert.match(tabs[0].url, /^chrome-extension:\/\/test\/blocked.html\?site=example.com/);
  assert.equal(session.active, null);
  result = await send({ action: 'enabled', enabled: false });
  assert.equal(result.data.enabled, false);
  assert.equal(dynamic.length, 0);
  await send({ action: 'enabled', enabled: true });
  assert.equal(dynamic.length, 1);
  await send({ action: 'toggle', id });
  assert.equal(dynamic.length, 0);
  result = await send({ action: 'save', rule: { domain: 'bad input', type: 'always' } });
  assert.equal(result.ok, false);
  result = await send({ action: 'delete', id });
  assert.equal(result.data.rules.length, 0);
  assert.equal(result.data.usage[id], undefined);

  result = await send({ action: 'protection', settings: { passwordEnabled: true, newPassword: '0012', challengeEnabled: true } });
  assert.equal(result.data.protection.passwordEnabled, true);
  assert.equal(result.data.protection.challengeEnabled, true);
  assert.equal(result.data.protection.passwordHash, undefined);
  result = await send({ action: 'save', rule: { domain: 'example.com', type: 'always', enabled: false } });
  assert.equal(result.ok, true, 'Adding a rule needs no verification');
  const protectedId = result.data.rules[0].id;
  assert.equal((await send({ action: 'toggle', id: protectedId })).ok, true, 'Enabling a rule needs no verification');
  result = await send({ action: 'toggle', id: protectedId });
  assert.equal(result.requiresAuth, true);
  const first = result.challenge;
  assert.equal(first.passwordEnabled, true); assert.equal(first.challengeEnabled, true);
  assert.equal((await send({ action: 'authorize', id: first.id, method: 'password', password: 'wrong', text: first.text })).ok, false);
  result = await send({ action: 'authorize', id: first.id, method: 'password', password: '0012' });
  assert.equal(result.ok, true); assert.equal(local.rules[0].enabled, false);
  assert.equal((await send({ action: 'authorize', id: first.id, method: 'password', password: '0012' })).ok, false);
  await send({ action: 'toggle', id: protectedId });
  result = await send({ action: 'enabled', enabled: false });
  const second = result.challenge;
  assert.equal((await send({ action: 'authorize', id: second.id, method: 'challenge', text: second.text })).ok, true);
  assert.equal(local.enabled, false);
  assert.equal((await send({ action: 'enabled', enabled: true })).ok, true, 'Enabling the global switch needs no verification');
  for (const message of [{ action: 'save', rule: { id: protectedId, domain: 'other.com', type: 'always' } }, { action: 'delete', id: protectedId }, { action: 'protection', settings: {} }, { action: 'uninstall' }]) {
    result = await send(message); assert.equal(result.requiresAuth, true);
  }
  assert.equal(uninstallCalls, 0);
  assert.equal((await send({ action: 'authorize', id: result.challenge.id, method: 'challenge', text: result.challenge.text })).ok, true);
  assert.equal(uninstallCalls, 1);
  result = await send({ action: 'protection', settings: { passwordEnabled: true, newPassword: '9876', challengeEnabled: true } });
  assert.equal(JSON.stringify(session.pending).includes('9876'), false);
  const replace = result.challenge;
  const wrongOwner = await new Promise(resolve => events.message({ action: 'authorize', id: replace.id, method: 'challenge', text: replace.text }, { ...sender, documentId: 'other' }, resolve));
  assert.equal(wrongOwner.ok, false);
  assert.equal((await send({ action: 'authorize', id: replace.id, method: 'challenge', text: replace.text })).ok, true);
  result = await send({ action: 'enabled', enabled: false });
  const retry = result.challenge;
  session.authFailure = { count: 100, until: Date.now() + 600000 };
  for (let i = 0; i < 10; i++) {
    const failed = await send({ action: 'authorize', id: retry.id, method: 'password', password: '9999' });
    assert.equal(failed.ok, false);
    assert.match(failed.error, /不正确/);
  }
  assert.equal((await send({ action: 'authorize', id: retry.id, method: 'password', password: '9876' })).ok, true, 'Unlimited retries, including when a legacy cooldown exists');
  result = await send({ action: 'delete', id: protectedId });
  session.pending[result.challenge.id].expires = Date.now() - 1;
  assert.equal((await send({ action: 'authorize', id: result.challenge.id, method: 'password', password: '9876' })).ok, false);
  assert.equal(events.message({ action: 'delete', id: protectedId }, pageSender, () => {}), undefined);
  delete globalThis.chrome;
});
