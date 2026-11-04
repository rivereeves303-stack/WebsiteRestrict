const encoder = new TextEncoder();
export const MUTATIONS = new Set(['save', 'delete', 'toggle', 'enabled', 'protection', 'uninstall']);
export const protectedMode = protection => Boolean(protection?.passwordHash || protection?.challengeEnabled);
export function normalizeProtection(protection = {}) {
  return { ...protection, challengeEnabled: Boolean(protection.passwordHash || protection.challengeEnabled) };
}
export function publicProtection(protection) {
  const normalized = normalizeProtection(protection);
  return { passwordEnabled: Boolean(normalized.passwordHash), challengeEnabled: normalized.challengeEnabled, passwordNumeric: ['numeric', 'pin4'].includes(normalized.passwordFormat) };
}
function hex(bytes) { return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join(''); }
async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations, hash: 'SHA-256' }, key, 256));
}
export async function createProtection(input, current = {}) {
  const result = { challengeEnabled: Boolean(input.passwordEnabled || input.challengeEnabled) };
  if (input.passwordEnabled) {
    if (input.newPassword) {
      if (typeof input.newPassword !== 'string' || !/^\d{4}$/.test(input.newPassword)) throw new Error('请点击数字按钮输入完整的 4 位密码');
      result.passwordFormat = 'pin4';
      result.salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      result.iterations = 210000;
      result.passwordHash = await derive(input.newPassword, result.salt, result.iterations);
    } else if (current.passwordHash) {
      Object.assign(result, { passwordHash: current.passwordHash, salt: current.salt, iterations: current.iterations });
      if (current.passwordFormat) result.passwordFormat = current.passwordFormat;
    } else throw new Error('请设置保护密码');
  }
  return result;
}
export function needsVerification(message, saved) {
  if (!protectedMode(saved.protection)) return false;
  if (message.action === 'save') return saved.rules.some(rule => rule.id === message.rule?.id);
  if (message.action === 'toggle') return Boolean(saved.rules.find(rule => rule.id === message.id)?.enabled);
  if (message.action === 'enabled') return !message.enabled;
  return ['delete', 'protection', 'uninstall'].includes(message.action);
}
export async function verifyKey(message, protection, text) {
  if (message.method === 'challenge') return Boolean(protection.challengeEnabled && typeof message.text === 'string' && message.text === text);
  if (message.method === 'password') return Boolean(protection.passwordHash) && verifyPassword(message.password, protection);
  return false;
}
export async function verifyPassword(password, protection) {
  if (!protection?.passwordHash) return true;
  if (typeof password !== 'string' || password.length > 128) return false;
  if (protection.passwordFormat === 'pin4' && !/^\d{4}$/.test(password)) return false;
  if (protection.passwordFormat === 'numeric' && !/^\d{1,12}$/.test(password)) return false;
  const actual = await derive(password, protection.salt, protection.iterations);
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ protection.passwordHash.charCodeAt(i);
  return diff === 0;
}
export function challengeText() {
  const phrases = ['我选择把注意力留给真正重要的事情', '短暂的冲动不必改变我已经做好的决定', '在修改规则之前我要认真想一想自己的目标', '我愿意给未来的自己多留一点专注的时间'];
  const numbers = crypto.getRandomValues(new Uint32Array(3));
  const first = numbers[0] % phrases.length;
  return `${phrases[first]}，${phrases[(first + 1 + numbers[1] % 3) % phrases.length]}。确认码${1000 + numbers[2] % 9000}`;
}
