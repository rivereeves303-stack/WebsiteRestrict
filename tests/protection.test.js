import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProtection, verifyPassword, challengeText, publicProtection, protectedMode, verifyKey, needsVerification } from '../protection.js';

test('passwords are salted and hashed; keeping or replacing a password preserves intended behavior', async () => {
  const first = await createProtection({ passwordEnabled: true, newPassword: '0012', challengeEnabled: false });
  const second = await createProtection({ passwordEnabled: true, newPassword: '0012' });
  assert.notEqual(first.passwordHash, second.passwordHash);
  assert.equal(await verifyPassword('0012', first), true);
  assert.equal(await verifyPassword('9999', first), false);
  const kept = await createProtection({ passwordEnabled: true }, first);
  assert.equal(kept.passwordHash, first.passwordHash);
  const changed = await createProtection({ passwordEnabled: true, newPassword: '9876' }, first);
  assert.equal(await verifyPassword('0012', changed), false);
  assert.equal(await verifyPassword('9876', changed), true);
  assert.deepEqual(publicProtection(first), { passwordEnabled: true, challengeEnabled: true, passwordNumeric: true });
  assert.deepEqual(publicProtection({ ...first, challengeEnabled: false }), { passwordEnabled: true, challengeEnabled: true, passwordNumeric: true });
  const both = await createProtection({ passwordEnabled: true, challengeEnabled: true, newPassword: '0012' });
  assert.equal(await verifyKey({ method: 'password', password: '0012' }, both, 'challenge'), true);
  assert.equal(await verifyKey({ method: 'challenge', text: 'challenge' }, both, 'challenge'), true);
  assert.equal(await verifyKey({ method: 'password', password: 'wrong', text: 'challenge' }, both, 'challenge'), false);
  assert.equal(await verifyKey({ method: 'challenge', text: 'wrong', password: '0012' }, both, 'challenge'), false);
  const challengeOnly = await createProtection({ challengeEnabled: true }, first);
  assert.equal(challengeOnly.passwordHash, undefined);
  assert.deepEqual(publicProtection(challengeOnly), { passwordEnabled: false, challengeEnabled: true, passwordNumeric: false });
  assert.equal(protectedMode(first), true);
  assert.equal(protectedMode({ challengeEnabled: true }), true);
  assert.equal(protectedMode({}), false);
  assert.deepEqual(await createProtection({ passwordEnabled: false, challengeEnabled: false }, first), { challengeEnabled: false });
  await assert.rejects(createProtection({ passwordEnabled: true, newPassword: 'short' }));
  await assert.rejects(createProtection({ passwordEnabled: true }));
});

test('PIN passwords require exactly four digits and preserve leading zeroes', async () => {
  const pin = await createProtection({ passwordEnabled: true, newPassword: '0001' });
  assert.equal(await verifyPassword('0001', pin), true);
  assert.equal(await verifyPassword('1', pin), false);
  assert.equal(pin.passwordFormat, 'pin4');
  assert.equal((await createProtection({ passwordEnabled: true }, pin)).passwordFormat, 'pin4');
  for (const value of ['7', '123', '12345', '12ab', '12 34', '12.34', '-1234', '１２３４', '1234567890123', 1234]) await assert.rejects(createProtection({ passwordEnabled: true, newPassword: value }));
});

test('legacy text passwords remain verifiable until replaced with a numeric password', async () => {
  const salt = 'legacy-salt';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('old-password'), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 210000, hash: 'SHA-256' }, key, 256);
  const passwordHash = [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
  const legacy = { passwordHash, salt, iterations: 210000, challengeEnabled: true };
  assert.equal(await verifyPassword('old-password', legacy), true);
  assert.equal(publicProtection(legacy).passwordNumeric, false);
  const replaced = await createProtection({ passwordEnabled: true, newPassword: '1234' }, legacy);
  assert.equal(await verifyPassword('1234', replaced), true);
  assert.equal(await verifyPassword('old-password', replaced), false);
});

test('challenge includes a randomized code and meaningful manual text', () => {
  const text = challengeText();
  assert.match(text, /。确认码\d{4}$/);
  assert.ok(text.length > 35);
});

test('only existing rule changes, removal, disabling and protection changes require verification', () => {
  const saved = { protection: { challengeEnabled: true }, rules: [{ id: 'on', enabled: true }, { id: 'off', enabled: false }] };
  for (const message of [{ action: 'save', rule: { domain: 'new.test' } }, { action: 'save', rule: { id: 'new-id' } }, { action: 'toggle', id: 'off' }, { action: 'enabled', enabled: true }]) assert.equal(needsVerification(message, saved), false);
  for (const message of [{ action: 'save', rule: { id: 'on' } }, { action: 'save', rule: { id: 'off' } }, { action: 'toggle', id: 'on' }, { action: 'enabled', enabled: false }, { action: 'delete', id: 'on' }, { action: 'protection' }, { action: 'uninstall' }]) assert.equal(needsVerification(message, saved), true);
});
