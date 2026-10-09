/**
 * Build 26 — finance intelligence: small shared helpers. PURE.
 *
 * Dates are plain YYYY-MM-DD strings handled in UTC arithmetic, so a day is a
 * day whatever zone the server runs in. "Today" is always passed in (the caller
 * decides it once, in Europe/London), never read from a clock in here.
 */
import crypto from 'crypto';

export const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
export function daysBetween(a: string, b: string): number { return Math.round((dayMs(b) - dayMs(a)) / 86400000); }
export function addDays(d: string, n: number): string {
  const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10);
}
/** Same day next month, clamped to the month's last day (31 Jan → 28/29 Feb). */
export function addMonths(d: string, n: number): string {
  const [y, m, day] = d.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, last));
  return base.toISOString().slice(0, 10);
}
export function monthEnd(m: string): string {
  const x = new Date(`${m}-01T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + 1); x.setUTCDate(0); return x.toISOString().slice(0, 10);
}
export function prevMonth(m: string): string {
  const x = new Date(`${m}-01T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() - 1); return x.toISOString().slice(0, 7);
}
export function nextMonth(m: string): string {
  const x = new Date(`${m}-01T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + 1); return x.toISOString().slice(0, 7);
}
export function median(nums: number[]): number | null {
  const s = [...nums].sort((a, b) => a - b); if (!s.length) return null;
  const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
export function shortHash(s: string): string { return crypto.createHash('sha256').update(s).digest('hex').slice(0, 12); }
export const pounds = (p: number) => `£${(Math.abs(p) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
export const up = (s: unknown) => String(s ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
export const alnum = (s: unknown) => up(s).replace(/[^A-Z0-9]/g, '');

/** Today's date in Europe/London — the one place "today" is decided. */
export function londonToday(nowMs: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(nowMs));
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
