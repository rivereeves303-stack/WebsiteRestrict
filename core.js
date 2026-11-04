export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function normalizeDomain(value) {
  const input = String(value || '').trim();
  if (!input || /[\s*]/.test(input)) throw new Error('请输入有效的网址，例如 bilibili.com');
  let url;
  try { url = new URL(input.includes('://') ? input : `https://${input}`); } catch { throw new Error('网址格式不正确'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.port) throw new Error('请使用不带端口号的 HTTP / HTTPS 网站地址');
  const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (!/^(localhost|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/.test(host) || host.includes('..')) throw new Error('请输入有效的网站域名');
  return host;
}

export function matches(domain, url) {
  try { const u = new URL(url); return ['http:', 'https:'].includes(u.protocol) && (u.hostname === domain || u.hostname.endsWith(`.${domain}`)); } catch { return false; }
}

export function validateRule(input) {
  const rule = { id: input.id || crypto.randomUUID(), domain: normalizeDomain(input.domain), name: String(input.name || '').trim().slice(0, 40), enabled: input.enabled !== false, type: input.type };
  if (rule.type === 'quota') {
    rule.minutes = Number(input.minutes);
    if (!Number.isInteger(rule.minutes) || rule.minutes < 1 || rule.minutes > 1440) throw new Error('每日额度须为 1–1440 分钟');
  } else if (rule.type === 'schedule') {
    rule.days = [...new Set(input.days || [])].map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6);
    rule.start = input.start; rule.end = input.end;
    if (!rule.days.length) throw new Error('请至少选择一天');
    if (![rule.start, rule.end].every(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) || rule.start === rule.end) throw new Error('请设置不同的开始和结束时间；全天禁用请选择“始终禁用”');
  } else if (rule.type === 'dates') {
    rule.from = input.from; rule.to = input.to;
    const valid = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && localDay(new Date(`${v}T12:00:00`)) === v;
    if (!valid(rule.from) || !valid(rule.to) || rule.from > rule.to) throw new Error('请选择有效的日期范围，结束日期不能早于开始日期');
  } else if (rule.type !== 'always') throw new Error('未知的限制方式');
  return rule;
}

export function isBlocked(rule, usage = {}, now = new Date()) {
  if (!rule.enabled) return false;
  if (rule.type === 'always') return true;
  if (rule.type === 'quota') return (usage[rule.id] || 0) >= rule.minutes * 60000;
  if (rule.type === 'dates') { const day = localDay(now); return day >= rule.from && day <= rule.to; }
  if (rule.type === 'schedule') {
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const day = now.getDay();
    return rule.start < rule.end
      ? rule.days.includes(day) && time >= rule.start && time < rule.end
      : (rule.days.includes(day) && time >= rule.start) || (rule.days.includes((day + 6) % 7) && time < rule.end);
  }
  return false;
}

export function describe(rule) {
  if (rule.type === 'quota') return `每天可用 ${rule.minutes} 分钟`;
  if (rule.type === 'always') return '全天限制访问';
  if (rule.type === 'dates') return `${rule.from} 至 ${rule.to}（含当天）`;
  const names = ['日', '一', '二', '三', '四', '五', '六'];
  return `周${rule.days.map(d => names[d]).join('、')} · ${rule.start}–${rule.end}${rule.start > rule.end ? '（次日）' : ''}`;
}

export function accrue(rules, usage, active, now) {
  if (!active || now <= active.since) return usage;
  const start = new Date(active.since);
  if (localDay(start) !== localDay(new Date(now))) usage = {};
  for (const rule of rules) {
    if (rule.enabled && rule.type === 'quota' && matches(rule.domain, active.url)) usage[rule.id] = (usage[rule.id] || 0) + activeMilliseconds(active, now);
  }
  return usage;
}

export function activeMilliseconds(active, now) {
  if (!active) return 0;
  const midnight = new Date(`${localDay(new Date(now))}T00:00:00`).getTime();
  // Alarms run every 30 seconds. Do not charge hours of device sleep as browsing.
  return Math.max(0, Math.min(60000, now - Math.max(active.since, midnight)));
}

export function nextAllowedAt(rules, usage = {}, now = new Date()) {
  const initialDay = localDay(now);
  let candidate = new Date(now);
  for (let i = 0; i < 800; i++) {
    const active = rules.filter(r => isBlocked(r, localDay(candidate) === initialDay ? usage : {}, candidate));
    if (!active.length) return candidate.getTime();
    if (active.some(r => r.type === 'always')) return null;
    const ends = active.map(rule => {
      if (rule.type === 'dates') { const end = new Date(`${rule.to}T00:00:00`); end.setDate(end.getDate() + 1); return end.getTime(); }
      const end = new Date(candidate);
      if (rule.type === 'quota') { end.setHours(24, 0, 0, 0); return end.getTime(); }
      const [hour, minute] = rule.end.split(':').map(Number);
      end.setHours(hour, minute, 0, 0);
      if (end <= candidate) end.setDate(end.getDate() + 1);
      return end.getTime();
    });
    candidate = new Date(Math.max(...ends));
  }
  // A repeating combination may cover every hour of every week.
  return null;
}

export function websiteStatus(rules, usage, enabled, url, now = new Date()) {
  const matching = rules.filter(rule => matches(rule.domain, url));
  if (!matching.length) return { matched: false };
  const active = enabled ? matching.filter(rule => rule.enabled) : [];
  const quotas = active.filter(rule => rule.type === 'quota');
  const starts = [];
  for (const rule of active) {
    if (rule.type === 'schedule') {
      for (let offset = 0; offset <= 7; offset++) {
        const start = new Date(now);
        start.setDate(start.getDate() + offset);
        const [hour, minute] = rule.start.split(':').map(Number);
        start.setHours(hour, minute, 0, 0);
        if (rule.days.includes(start.getDay()) && start > now) starts.push(start.getTime());
      }
    }
    if (rule.type === 'dates') {
      const start = new Date(`${rule.from}T00:00:00`);
      if (start > now) starts.push(start.getTime());
    }
  }
  return {
    matched: true,
    enabled: active.length > 0,
    blocked: active.some(rule => isBlocked(rule, usage, now)),
    quotaMs: quotas.length ? Math.max(0, Math.min(...quotas.map(rule => rule.minutes * 60000 - (usage[rule.id] || 0)))) : null,
    nextBlockAt: starts.length ? Math.min(...starts) : null
  };
}
