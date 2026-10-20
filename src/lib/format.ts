// Display formatting. Client-safe and deterministic (no locale surprises between server and client).

const intFmt = new Intl.NumberFormat('en-US');
const compactFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export function int(n: number | null | undefined): string {
  return intFmt.format(Math.round(n ?? 0));
}

export function compact(n: number | null | undefined): string {
  const v = n ?? 0;
  return Math.abs(v) < 10_000 ? int(v) : compactFmt.format(v);
}

export function ratio(a: number, b: number): number {
  return b > 0 ? a / b : a;
}

export function kd(kills: number, deaths: number): string {
  return ratio(kills, deaths).toFixed(2);
}

export function pct(part: number, whole: number, digits = 1): string {
  if (!whole) return '0%';
  return `${((part / whole) * 100).toFixed(digits)}%`;
}

export function metres(m: number | null | undefined): string {
  if (m == null) return '—';
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

export function money(n: number | null | undefined): string {
  return `$${int(n)}`;
}

/** `3h 12m`, `12m`, `45s`. */
export function duration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(seconds ?? 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

/** Whole hours, for playtime columns: `1,234h`. */
export function hours(seconds: number): string {
  const h = seconds / 3600;
  return h < 10 ? `${h.toFixed(1)}h` : `${int(h)}h`;
}

export function ago(ts: number | null | undefined, now = Date.now() / 1000): string {
  if (!ts) return 'never';
  const d = Math.max(0, now - ts);
  if (d < 45) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  if (d < 86400 * 30) return `${Math.round(d / 86400)}d ago`;
  return date(ts);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Day, month, year, hour and minute of a moment in a timezone (an IANA name; UTC by default). */
function parts(ts: number, timeZone: string) {
  const d = new Date(ts * 1000);
  if (timeZone === 'UTC') return { day: d.getUTCDate(), month: d.getUTCMonth(), year: d.getUTCFullYear(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      .formatToParts(d)
      .map((x) => [x.type, Number(x.value)]),
  );
  return { day: p.day, month: p.month - 1, year: p.year, hour: p.hour, minute: p.minute };
}

/** `14 Sep 2026`, in `timeZone` (UTC by default). */
export function date(ts: number, timeZone = 'UTC'): string {
  const p = parts(ts, timeZone);
  return `${p.day} ${MONTHS[p.month]} ${p.year}`;
}

/** `14 Sep, 18:04 UTC`; in another timezone, `14 Sep, 19:04` (the page says which). */
export function dateTime(ts: number, timeZone = 'UTC'): string {
  const p = parts(ts, timeZone);
  const hm = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  return `${p.day} ${MONTHS[p.month]}, ${hm}${timeZone === 'UTC' ? ' UTC' : ''}`;
}

/** `18:04` in `timeZone`. */
export function hourMinute(ts: number, timeZone = 'UTC'): string {
  const p = parts(ts, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** `14/9` in `timeZone`. */
export function dayMonth(ts: number, timeZone = 'UTC'): string {
  const p = parts(ts, timeZone);
  return `${p.day}/${p.month + 1}`;
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${m}:${sec}` : `${m}:${sec}`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
