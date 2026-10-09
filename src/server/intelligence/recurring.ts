/**
 * Build 26 — recurring payments. PURE. Tally owns recurrence.
 *
 *   explicit_recurring  someone said so in Tally
 *   strong_pattern      ≥3 occurrences, regular cadence, still active, and either a steady amount
 *                       (FIXED) or a direct-debit-style bill whose amount varies within a range (VARIABLE)
 *   weak_pattern        repeats on a cadence but fails one of those — NEVER forecast
 *   not_recurring       someone said not
 *   unknown             repeats, but no cadence fits
 * Only explicit and strong drive forecasts ("established").
 *
 * Variable bills (energy, water, mobile usage) are recognised ONLY for non-card payments: a weekly
 * shop at the same supermarket is day-to-day spending, never a variable bill.
 */
import { T } from './thresholds.js';
import { COUNTS, type Coverage, type Owner, type Row, type TxType } from './ledger.js';
import { addDays, addMonths, daysBetween, median, pounds, shortHash } from './util.js';

export type RecurState = 'explicit_recurring' | 'strong_pattern' | 'weak_pattern' | 'not_recurring' | 'unknown';
export type Cadence = 'weekly' | 'fortnightly' | 'four_weekly' | 'monthly' | 'quarterly' | 'yearly';

export const PERIODS_PER_YEAR: Record<Cadence, number> = { weekly: 52, fortnightly: 26, four_weekly: 13, monthly: 12, quarterly: 4, yearly: 1 };
const DAYS: Record<Cadence, number> = { weekly: 7, fortnightly: 14, four_weekly: 28, monthly: 30, quarterly: 91, yearly: 365 };

export interface PriceChange {
  fromPence: number; toPence: number; changePence: number; changePct: number;
  annualEffectPence: number | null; firstObserved: string; seenTimes: number; confirmed: boolean; line: string;
}
export interface Series {
  key: string; accountId: number; accountName: string; owner: Owner; ownerName: string | null;
  label: string; recurKey: string; category: string | null; direction: 'in' | 'out'; flow: TxType;
  payment: Row['payment']; cadence: Cadence | null; occurrences: number; firstSeen: string; lastSeen: string;
  active: boolean; state: RecurState; amountKind: 'fixed' | 'variable';
  typicalPence: number; range: { minPence: number; maxPence: number } | null; recentPence: number[];
  priceChange: PriceChange | null; nextExpected: string | null; lateDays: number | null; missed: boolean;
  decision: string | null; txnIds: number[]; why: string[];
}
export const ESTABLISHED = (s: Pick<Series, 'state'>) => s.state === 'explicit_recurring' || s.state === 'strong_pattern';

const POOL: TxType[] = ['spend', 'fee', 'financing', 'card_repayment', 'income', 'other_credit', 'transfer_external'];

export function cadenceOf(gaps: number[]): Cadence | null {
  if (!gaps.length) return null;
  if (gaps.every((g) => g >= 27 && g <= 29)) return 'four_weekly';
  const m = median(gaps)!;
  if (m >= 6 && m <= 8) return 'weekly';
  if (m >= 13 && m <= 15) return 'fortnightly';
  if (m >= 26 && m <= 34) return 'monthly';
  if (m >= 85 && m <= 97) return 'quarterly';
  if (m >= 355 && m <= 375) return 'yearly';
  return null;
}
function gapFits(c: Cadence, g: number): boolean {
  switch (c) {
    case 'weekly': return g >= 6 && g <= 8;
    case 'fortnightly': return g >= 12 && g <= 16;
    case 'four_weekly': return g >= 27 && g <= 29;
    case 'monthly': return g >= 26 && g <= 34;
    case 'quarterly': return g >= 85 && g <= 97;
    case 'yearly': return g >= 355 && g <= 375;
  }
}
/**
 * How regular a series is. Every gap must fit its cadence, except that ONE irregularity is tolerated:
 *   skipped  a doubled gap — one occurrence missed or not seen (e.g. inside a feed gap)
 *   extra    two gaps that add up to one interval — one extra payment between two regular ones
 *            (measured: DWP paid an arrears top-up between two four-weekly payments)
 * The cadence is judged on the gaps with that one irregularity folded in.
 */
export function assessCadence(gaps: number[]): { cadence: Cadence | null; regular: boolean; skipped: number; extra: number } {
  const fits = (c: Cadence | null, gs: number[]) => !!c && gs.every((g) => gapFits(c, g));
  const c0 = cadenceOf(gaps);
  if (fits(c0, gaps)) return { cadence: c0, regular: true, skipped: 0, extra: 0 };
  if (gaps.length >= 3) {
    for (let i = 0; i + 1 < gaps.length; i++) {
      const merged = [...gaps.slice(0, i), gaps[i] + gaps[i + 1], ...gaps.slice(i + 2)];
      const c = cadenceOf(merged);
      if (fits(c, merged)) return { cadence: c, regular: true, skipped: 0, extra: 1 };
    }
    if (c0) {
      const odd = gaps.filter((g) => !gapFits(c0, g));
      if (odd.length === 1 && Math.abs(odd[0] - 2 * DAYS[c0]) <= Math.max(3, DAYS[c0] * 0.1)) return { cadence: c0, regular: true, skipped: 1, extra: 0 };
    }
  }
  return { cadence: c0, regular: false, skipped: 0, extra: 0 };
}
export function stepFrom(date: string, c: Cadence): string {
  if (c === 'monthly') return addMonths(date, 1);
  if (c === 'quarterly') return addMonths(date, 3);
  if (c === 'yearly') return addMonths(date, 12);
  return addDays(date, DAYS[c]);
}

interface Cluster { items: Row[]; median: number }

/**
 * Fixed series are read IN TIME ORDER first: consecutive runs at one amount, a step between runs being a
 * price change. Measured: E.ON went £220.79 ×2 → £184.92 ×3 → £212.73 ×4 — grouping by amount alone merged
 * February with July (within 10%) and lost both price steps. Only when the runs interleave (two policies with
 * one insurer, say) does it fall back to grouping by amount.
 */
function clustersOf(list: Row[]): Cluster[][] {
  const timed = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const runs: Cluster[] = [];
  for (const t of timed) {
    const cur = runs[runs.length - 1];
    if (cur && Math.abs(t.amount - cur.median) <= Math.abs(cur.median) * T.RECUR_AMOUNT_TOLERANCE) { cur.items.push(t); cur.median = median(cur.items.map((i) => i.amount))!; }
    else runs.push({ items: [t], median: t.amount });
  }
  const clean = runs.every((r, i) => i === runs.length - 1 || r.items.length >= 2)
    && runs.every((r, i) => i === 0 || Math.abs(r.median - runs[i - 1].median) <= Math.abs(runs[i - 1].median) * T.RECUR_PRICE_STEP);
  if (clean) return [runs];
  const byAmt = [...list].sort((a, b) => a.amount - b.amount || a.id - b.id);
  const clusters: Cluster[] = [];
  for (const t of byAmt) {
    const c = clusters.find((x) => Math.abs(t.amount - x.median) <= Math.abs(x.median) * T.RECUR_AMOUNT_TOLERANCE);
    if (c) { c.items.push(t); c.median = median(c.items.map((i) => i.amount))!; } else clusters.push({ items: [t], median: t.amount });
  }
  for (const c of clusters) c.items.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  clusters.sort((a, b) => a.items[0].date.localeCompare(b.items[0].date) || a.median - b.median);
  // A later cluster continues an earlier one as a PRICE CHANGE when it starts after that one ends.
  const chains: Cluster[][] = [];
  for (const c of clusters) {
    const prev = chains.find((ch) => {
      const last = ch[ch.length - 1]; const lastDate = last.items[last.items.length - 1].date;
      return c.items[0].date > lastDate && Math.abs(c.median - last.median) <= Math.abs(last.median) * T.RECUR_PRICE_STEP && last.items.length >= 2;
    });
    if (prev) prev.push(c); else chains.push([c]);
  }
  return chains;
}

interface Ctx { through: string | null; today: string; decisions: Map<string, string> }

function build(items: Row[], amountKind: 'fixed' | 'variable', chain: Cluster[] | null, key: string, ctx: Ctx): Series {
  // (amountKind / chain may be overridden below for money in)
  const first = items[0]; const last = items[items.length - 1];
  const gaps = items.slice(1).map((t, i) => daysBetween(items[i].date, t.date));
  const reg = assessCadence(gaps);
  const cad = reg.cadence;
  const through = ctx.through ?? last.date;
  const active = !!cad && daysBetween(last.date, through) <= Math.round(DAYS[cad] * 1.5);
  const abs = items.map((t) => Math.abs(t.amount));
  const recent = abs.slice(-T.VARIABLE_LAST_N);
  // Money IN never has a "price": income that moves (salary, benefits) is a variable series with a range.
  if (last.amount > 0 && Math.max(...recent) > Math.min(...recent) * (1 + T.RECUR_AMOUNT_TOLERANCE)) { amountKind = 'variable'; chain = null; }
  const typical = amountKind === 'fixed' ? Math.abs(chain![chain!.length - 1].median) : median(abs.slice(-T.VARIABLE_TYPICAL_N))!;
  const decision = ctx.decisions.get(key) ?? null;
  let state: RecurState;
  if (decision === 'not_recurring') state = 'not_recurring';
  else if (decision === 'recurring') state = 'explicit_recurring';
  else if (cad && reg.regular && items.length >= T.RECUR_STRONG_MIN && active) state = 'strong_pattern';
  else if (cad) state = 'weak_pattern';
  else state = 'unknown';

  let priceChange: PriceChange | null = null;
  // A price change is about what a bill or subscription COSTS — never income, instalments of different
  // purchases (financing) or card repayments.
  if (amountKind === 'fixed' && chain && chain.length >= 2 && last.amount < 0 && (last.type === 'spend' || last.type === 'fee')) {
    const before = chain[chain.length - 2]; const now = chain[chain.length - 1];
    const from = Math.abs(before.median); const to = Math.abs(now.median);
    const change = to - from;
    if (Math.abs(change) >= T.PRICE_CHANGE_MIN_PENCE && Math.abs(change) / from >= T.PRICE_CHANGE_MIN_RATIO) {
      const annual = cad ? change * PERIODS_PER_YEAR[cad] : null;
      priceChange = {
        fromPence: from, toPence: to, changePence: change, changePct: Math.round((change / from) * 1000) / 10,
        annualEffectPence: annual, firstObserved: now.items[0].date, seenTimes: now.items.length, confirmed: now.items.length >= 2,
        line: `${change > 0 ? 'Up' : 'Down'} from ${pounds(from)} to ${pounds(to)} (${change > 0 ? '+' : '−'}${pounds(change)}, ${Math.abs(Math.round((change / from) * 100))}%)`
          + (annual != null ? `, about ${change > 0 ? '+' : '−'}${pounds(annual)} a year at this cadence` : ', annual effect unknown (no regular cadence)')
          + (now.items.length === 1 ? ' — seen once so far' : ''),
      };
    }
  }

  let nextExpected: string | null = null; let lateDays: number | null = null; let missed = false;
  if (cad && (state === 'strong_pattern' || state === 'explicit_recurring')) {
    nextExpected = stepFrom(last.date, cad);
    if (nextExpected < ctx.today) {
      const late = daysBetween(nextExpected, ctx.today);
      if (late <= T.RECUR_LATE_GRACE_DAYS) { lateDays = late; nextExpected = ctx.today; }
      else { missed = true; while (nextExpected < ctx.today) nextExpected = stepFrom(nextExpected, cad); }
    }
  }
  const flow = last.type;
  return {
    key, accountId: first.accountId, accountName: first.accountName, owner: first.owner, ownerName: first.ownerName,
    label: last.merchantKey ?? first.recurKey!, recurKey: first.recurKey!, category: last.category, direction: last.amount > 0 ? 'in' : 'out',
    flow, payment: last.payment, cadence: cad, occurrences: items.length, firstSeen: first.date, lastSeen: last.date, active, state, amountKind,
    typicalPence: typical, range: amountKind === 'variable' ? { minPence: Math.min(...recent), maxPence: Math.max(...recent) } : null,
    recentPence: recent, priceChange, nextExpected, lateDays, missed, decision, txnIds: items.map((t) => t.id),
    why: [
      `${items.length} payment${items.length === 1 ? '' : 's'} ${last.amount > 0 ? 'into' : 'from'} ${first.accountName}`,
      cad ? `about every ${DAYS[cad]} days (${cad.replace('_', '-')})` : `no regular cadence (median gap ${median(gaps)} days)`,
      cad ? (reg.regular ? (reg.skipped ? 'regular, with one occurrence not seen' : reg.extra ? 'regular, with one extra payment between two regular ones' : 'gaps are regular') : 'gaps vary') : null,
      amountKind === 'variable' ? `the amount varies (${pounds(Math.min(...recent))}–${pounds(Math.max(...recent))} over the last ${recent.length}); typical is the median of the last ${Math.min(T.VARIABLE_TYPICAL_N, abs.length)}` : 'a steady amount',
      active ? 'still being paid at the end of the data' : `last paid ${last.date}, before the data ends (${through})`,
      lateDays != null ? `due ${lateDays} day${lateDays === 1 ? '' : 's'} ago and not seen yet — still expected` : null,
      missed ? 'the expected payment has not arrived' : null,
      decision ? `marked ${decision === 'recurring' ? 'recurring' : 'not recurring'} in Tally` : null,
    ].filter(Boolean) as string[],
  };
}

export function detectRecurring(rows: Row[], { coverage = [], decisions = new Map<string, string>(), today }:
  { coverage?: Coverage[]; decisions?: Map<string, string>; today: string }): Series[] {
  const pool = rows.filter((t) => COUNTS(t.status) && POOL.includes(t.type) && t.recurKey);
  const groups = new Map<string, Row[]>();
  for (const t of pool) { const k = `${t.accountId}|${t.recurKey}|${t.amount > 0 ? 'in' : 'out'}`; groups.set(k, [...(groups.get(k) ?? []), t]); }
  const cov = new Map(coverage.map((c) => [c.accountId, c]));
  const out: Series[] = [];
  for (const [gk, list] of groups) {
    if (list.length < 2) continue;
    const [accountId, rk, dir] = gk.split('|');
    const ctx: Ctx = { through: cov.get(Number(accountId))?.through ?? null, today, decisions };
    const fixed: Series[] = [];
    for (const chain of clustersOf(list)) {
      const items = chain.flatMap((c) => c.items).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
      if (items.length < 2) continue;
      fixed.push(build(items, 'fixed', chain, `rs_${shortHash(`${accountId}|${rk}|${dir}|${chain[0].median}`)}`, ctx));
    }
    // Variable bill: no fixed chain established, paid by direct debit/transfer (not card), and the whole
    // group runs on a regular cadence with its amounts inside a bounded range.
    const items = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    const nonCard = items.every((t) => t.payment !== 'card');
    const recent = items.slice(-T.VARIABLE_LAST_N).map((t) => Math.abs(t.amount));
    const bounded = Math.min(...recent) > 0 && Math.max(...recent) / Math.min(...recent) <= T.VARIABLE_MAX_RATIO;
    if (!fixed.some((s) => s.state === 'strong_pattern') && nonCard && bounded && items.length >= T.RECUR_STRONG_MIN && fixed.length > 1) {
      const v = build(items, 'variable', null, `rs_${shortHash(`${accountId}|${rk}|${dir}|variable`)}`, ctx);
      if (v.state === 'strong_pattern' || v.state === 'explicit_recurring' || v.state === 'not_recurring') { out.push(v); continue; }
    }
    out.push(...fixed);
  }
  return out.sort((a, b) => b.typicalPence - a.typicalPence || a.key.localeCompare(b.key));
}
