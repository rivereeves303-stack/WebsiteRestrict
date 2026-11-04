import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDomain, matches, validateRule, isBlocked, localDay, accrue, activeMilliseconds, nextAllowedAt, websiteStatus } from '../core.js';

test('URLs normalize safely; subdomains match without matching lookalike domains', () => {
  assert.equal(normalizeDomain(' https://www.BILIBILI.com/video/123 '), 'bilibili.com');
  assert.equal(normalizeDomain('例子.测试'), 'xn--fsqu00a.xn--0zwm56d');
  assert.equal(matches('example.com', 'https://video.example.com/watch'), true);
  assert.equal(matches('example.com', 'https://evil-example.com/'), false);
  assert.equal(matches('example.com', 'https://example.com.evil.test/'), false);
  assert.equal(matches('example.com', 'chrome://settings'), false);
  for (const value of ['', '*.example.com', 'hello world', 'javascript:alert(1)', 'https://user:pass@example.com', 'example.com:8080', 'foo..com']) assert.throws(() => normalizeDomain(value));
});

test('validation rejects invalid quotas, dates, weekdays and times', () => {
  const base = { domain: 'example.com' };
  for (const minutes of [0, -1, 1441, 1.5, 'abc']) assert.throws(() => validateRule({ ...base, type: 'quota', minutes }));
  assert.equal(validateRule({ ...base, type: 'quota', minutes: '30' }).minutes, 30);
  assert.throws(() => validateRule({ ...base, type: 'dates', from: '2026-02-30', to: '2026-03-02' }));
  assert.throws(() => validateRule({ ...base, type: 'dates', from: '2026-11-05', to: '2026-11-04' }));
  assert.throws(() => validateRule({ ...base, type: 'schedule', days: [], start: '09:00', end: '18:00' }));
  assert.throws(() => validateRule({ ...base, type: 'schedule', days: [1], start: '24:00', end: '18:00' }));
  assert.throws(() => validateRule({ ...base, type: 'schedule', days: [1], start: '09:00', end: '09:00' }));
});

test('same-day schedule includes the start and excludes the end', () => {
  const rule = { enabled: true, type: 'schedule', days: [1], start: '09:00', end: '18:00' };
  assert.equal(isBlocked(rule, {}, new Date('2026-11-02T08:59:59')), false);
  assert.equal(isBlocked(rule, {}, new Date('2026-11-02T09:00:00')), true);
  assert.equal(isBlocked(rule, {}, new Date('2026-11-02T17:59:59')), true);
  assert.equal(isBlocked(rule, {}, new Date('2026-11-02T18:00:00')), false);
  assert.equal(isBlocked(rule, {}, new Date('2026-11-03T10:00:00')), false);
});

test('overnight schedule uses selected start day, including Sunday to Monday', () => {
  const rule = { enabled: true, type: 'schedule', days: [0], start: '22:00', end: '06:00' };
  assert.equal(isBlocked(rule, {}, new Date('2026-11-01T23:00:00')), true);
  assert.equal(isBlocked(rule, {}, new Date('2026-11-02T05:59:59')), true);
  assert.equal(isBlocked(rule, {}, new Date('2026-11-02T06:00:00')), false);
  assert.equal(isBlocked(rule, {}, new Date('2026-11-01T05:00:00')), false);
});

test('date ranges include both days; quotas block exactly at allowance', () => {
  const rule = { enabled: true, type: 'dates', from: '2026-11-04', to: '2026-11-05' };
  assert.equal(isBlocked(rule, {}, new Date('2026-11-04T00:00:00')), true);
  assert.equal(isBlocked(rule, {}, new Date('2026-11-05T23:59:59')), true);
  assert.equal(isBlocked(rule, {}, new Date('2026-11-06T00:00:00')), false);
  const quota = { id: 'q', enabled: true, type: 'quota', minutes: 1 };
  assert.equal(isBlocked(quota, { q: 59999 }), false);
  assert.equal(isBlocked(quota, { q: 60000 }), true);
  assert.equal(isBlocked({ ...quota, enabled: false }, { q: 60000 }), false);
});

test('foreground usage accumulates only matching enabled quotas and resets at local midnight', () => {
  const rules = [
    { id: 'a', type: 'quota', enabled: true, domain: 'example.com' },
    { id: 'b', type: 'quota', enabled: false, domain: 'example.com' },
    { id: 'c', type: 'quota', enabled: true, domain: 'other.com' }
  ];
  const now = new Date('2026-11-04T10:00:00').getTime();
  assert.deepEqual(accrue(rules, {}, { url: 'https://example.com', since: now - 15000 }, now), { a: 15000 });
  assert.deepEqual(accrue(rules, { a: 5000 }, null, now), { a: 5000 });
  const midnight = new Date('2026-11-05T00:00:10').getTime();
  assert.deepEqual(accrue(rules, { a: 999999 }, { url: 'https://example.com', since: midnight - 20000 }, midnight), { a: 10000 });
  assert.equal(localDay(new Date('2026-11-04T23:59:59')), '2026-11-04');
  assert.equal(activeMilliseconds({ since: now - 3600000 }, now), 60000);
});

test('release time covers quotas, dates, overnight schedules, and chains of overlapping rules', () => {
  const now = new Date('2026-11-02T10:00:00');
  const schedule = { enabled: true, type: 'schedule', days: [1], start: '09:00', end: '12:00' };
  assert.equal(nextAllowedAt([schedule], {}, now), new Date('2026-11-02T12:00:00').getTime());
  const later = { ...schedule, start: '11:00', end: '14:00' };
  assert.equal(nextAllowedAt([schedule, later], {}, now), new Date('2026-11-02T14:00:00').getTime());
  const quota = { enabled: true, type: 'quota', id: 'q', minutes: 1 };
  assert.equal(nextAllowedAt([quota], { q: 60000 }, now), new Date('2026-11-03T00:00:00').getTime());
  const dates = { enabled: true, type: 'dates', from: '2026-11-02', to: '2026-11-03' };
  assert.equal(nextAllowedAt([dates], {}, now), new Date('2026-11-04T00:00:00').getTime());
  const night = { ...schedule, start: '22:00', end: '06:00' };
  assert.equal(nextAllowedAt([night], {}, new Date('2026-11-03T02:00:00')), new Date('2026-11-03T06:00:00').getTime());
  assert.equal(nextAllowedAt([{ enabled: true, type: 'always' }], {}, now), null);
  assert.equal(nextAllowedAt([{ enabled: false, type: 'always' }], {}, now), now.getTime());
  const days = [0, 1, 2, 3, 4, 5, 6];
  assert.equal(nextAllowedAt([{ ...schedule, days, start: '00:00', end: '12:00' }, { ...schedule, days, start: '12:00', end: '00:00' }], {}, now), null);
});

test('website timer selects the smallest remaining quota across matching subdomain rules', () => {
  const rules = [
    { id: 'a', domain: 'example.com', enabled: true, type: 'quota', minutes: 30 },
    { id: 'b', domain: 'video.example.com', enabled: true, type: 'quota', minutes: 10 },
    { id: 'c', domain: 'example.com', enabled: false, type: 'quota', minutes: 1 }
  ];
  const status = websiteStatus(rules, { a: 120000, b: 240000 }, true, 'https://video.example.com/watch');
  assert.equal(status.quotaMs, 360000);
  assert.equal(status.matched, true);
  assert.equal(status.blocked, false);
  assert.equal(websiteStatus(rules, {}, false, 'https://example.com').enabled, false);
  assert.equal(websiteStatus(rules, {}, true, 'https://unrelated.test').matched, false);
  assert.equal(websiteStatus(rules, { b: 600000 }, true, 'https://video.example.com').blocked, true);
});

test('website timer finds the next weekly or date restriction and ignores expired dates', () => {
  const now = new Date('2026-11-02T08:00:00');
  const schedule = { domain: 'example.com', enabled: true, type: 'schedule', days: [1], start: '09:00', end: '18:00' };
  const url = 'https://example.com';
  let status = websiteStatus([schedule], {}, true, url, now);
  assert.equal(status.quotaMs, null);
  assert.equal(status.nextBlockAt, new Date('2026-11-02T09:00:00').getTime());
  status = websiteStatus([schedule], {}, true, url, new Date('2026-11-02T19:00:00'));
  assert.equal(status.nextBlockAt, new Date('2026-11-09T09:00:00').getTime());
  const dates = { domain: 'example.com', enabled: true, type: 'dates', from: '2026-11-03', to: '2026-11-04' };
  assert.equal(websiteStatus([dates], {}, true, url, now).nextBlockAt, new Date('2026-11-03T00:00:00').getTime());
  assert.equal(websiteStatus([dates], {}, true, url, new Date('2026-11-05T00:00:00')).nextBlockAt, null);
});
