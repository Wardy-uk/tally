/**
 * Build 26 — monthly summaries and trends. PURE.
 *
 * Comparisons use COMPLETE calendar months only (every account with data covers the whole month, with
 * no suspected feed gap inside it). A partial month is summarised but never compared. Trend states
 * come from the fixed thresholds in thresholds.ts — no judgement, no model.
 */
import { DISCRETIONARY, T, UNUSABLE_CATEGORIES } from './thresholds.js';
import { COUNTS, monthCoverage, moneyInEffect, moneyOutEffect, spendEffect, type Coverage, type Row } from './ledger.js';
import { ESTABLISHED, type Series } from './recurring.js';
import { median, nextMonth, pounds, prevMonth } from './util.js';

export type TrendState = 'materially_up' | 'slightly_up' | 'broadly_stable' | 'slightly_down' | 'materially_down' | 'insufficient_data';

export interface MonthSummary {
  month: string; complete: boolean; coverageReasons: string[];
  spendPence: number; incomePence: number; moneyInPence: number; moneyOutPence: number; netMovementPence: number;
  recurringOutPence: number; discretionaryPence: number; discretionaryCoveragePct: number | null;
  financingPence: number; cardRepaymentsPence: number; transfersExcluded: { count: number; internalPence: number };
  refundsPence: number; byCategory: Record<string, number>; categorisedPct: number | null;
  owners: { primaryPence: number; sharedPence: number; privatePence: number };
  pendingExcluded: { count: number; pence: number }; unresolvedDuplicates: { count: number; pence: number };
  transactions: number;
}

const catName = (t: Row) => {
  const c = String(t.category ?? '').trim();
  return c && !UNUSABLE_CATEGORIES.has(c.toLowerCase()) ? c : 'Uncategorised';
};

export function monthsBetween(from: string | null, through: string | null): string[] {
  const out: string[] = [];
  if (!from || !through) return out;
  let m = from.slice(0, 7);
  while (m <= through.slice(0, 7)) { out.push(m); m = nextMonth(m); }
  return out;
}

export function monthlySummary(month: string, rows: Row[], coverage: Coverage[], series: Series[]): MonthSummary {
  const inM = rows.filter((t) => t.date.slice(0, 7) === month);
  const counted = inM.filter((t) => COUNTS(t.status));
  const established = new Set(series.filter(ESTABLISHED).flatMap((s) => s.txnIds));
  const byCategory: Record<string, number> = {};
  let spend = 0, moneyIn = 0, moneyOut = 0, recurringOut = 0, financing = 0, cardRep = 0, refunds = 0, disc = 0, discKnown = 0;
  const owners = { primaryPence: 0, sharedPence: 0, privatePence: 0 };
  let internalN = 0, internalP = 0;
  for (const t of counted) {
    const s = spendEffect(t);
    if (s) {
      spend += s; byCategory[catName(t)] = (byCategory[catName(t)] ?? 0) + s;
      if (t.owner === 'primary') owners.primaryPence += s; else if (t.owner === 'shared') owners.sharedPence += s; else owners.privatePence += s;
      if (catName(t) !== 'Uncategorised') { discKnown += s; if (DISCRETIONARY.has(catName(t).toLowerCase()) && !established.has(t.id)) disc += s; }
    }
    const o = moneyOutEffect(t); moneyOut += o; if (o && established.has(t.id)) recurringOut += o;
    moneyIn += moneyInEffect(t);
    if (t.type === 'financing') financing += -t.amount;
    if (t.type === 'card_repayment') cardRep += -t.amount;
    if (t.type === 'refund' || t.type === 'reversal') refunds += t.amount;
    if (t.type === 'transfer_internal') { internalN++; internalP += Math.abs(t.amount); }
  }
  const mc = monthCoverage(month, coverage);
  const sup = inM.filter((t) => t.status === 'superseded_pending');
  const unres = inM.filter((t) => t.status === 'unresolved_duplicate');
  return {
    month, complete: mc.complete, coverageReasons: mc.reasons,
    // Income = money arriving from outside the household (wages, benefits, other credits), whatever Tally
    // category it carries — a salary left uncategorised is still income. Refunds reduce spending instead.
    spendPence: spend, incomePence: moneyIn, moneyInPence: moneyIn, moneyOutPence: moneyOut, netMovementPence: moneyIn - moneyOut,
    recurringOutPence: recurringOut, discretionaryPence: disc, discretionaryCoveragePct: spend ? Math.round((discKnown / spend) * 100) : null,
    financingPence: financing, cardRepaymentsPence: cardRep, transfersExcluded: { count: internalN, internalPence: Math.round(internalP / 2) },
    refundsPence: refunds, byCategory: Object.fromEntries(Object.entries(byCategory).sort((a, b) => b[1] - a[1])),
    categorisedPct: spend ? Math.round(((spend - (byCategory.Uncategorised ?? 0)) / spend) * 100) : null,
    owners, pendingExcluded: { count: sup.length, pence: sup.reduce((a, t) => a - t.amount, 0) },
    unresolvedDuplicates: { count: unres.length, pence: unres.reduce((a, t) => a - t.amount, 0) },
    transactions: counted.length,
  };
}

/** The deterministic trend state for one figure. Thresholds in thresholds.ts. */
export function trendState(cur: number, prev: number, { materialPence = T.TREND_MATERIAL_PENCE as number, slightPence = T.TREND_SLIGHT_PENCE as number }: { materialPence?: number; slightPence?: number } = {}): TrendState {
  if (!prev) return 'insufficient_data';
  const d = cur - prev; const r = d / prev;
  if (r >= T.TREND_MATERIAL_RATIO && d >= materialPence) return 'materially_up';
  if (r <= -T.TREND_MATERIAL_RATIO && -d >= materialPence) return 'materially_down';
  if (r >= T.TREND_SLIGHT_RATIO && d >= slightPence) return 'slightly_up';
  if (r <= -T.TREND_SLIGHT_RATIO && -d >= slightPence) return 'slightly_down';
  return 'broadly_stable';
}
const signed = (p: number) => `${p < 0 ? '−' : ''}${pounds(p)}`;
const WORD: Record<TrendState, string> = {
  materially_up: 'materially up', slightly_up: 'slightly up', broadly_stable: 'broadly stable',
  slightly_down: 'slightly down', materially_down: 'materially down', insufficient_data: 'not comparable',
};

/** The latest two consecutive complete months, or why there are none. */
export function comparablePair(summaries: MonthSummary[]): { cur: MonthSummary; prev: MonthSummary } | { why: string } {
  const complete = summaries.filter((s) => s.complete).sort((a, b) => a.month.localeCompare(b.month));
  if (complete.length < 2) return { why: `${complete.length} complete month${complete.length === 1 ? '' : 's'} of data` };
  const cur = complete[complete.length - 1]; const prev = complete[complete.length - 2];
  if (prev.month !== prevMonth(cur.month)) return { why: `the latest complete months (${prev.month}, ${cur.month}) are not consecutive` };
  return { cur, prev };
}

export interface Timing { shiftedIn: string[]; shiftedOut: string[]; netPence: number; note: string }
export interface Trend { measure: string; state: TrendState; timing?: Timing | null; current?: string; previous?: string; currentPence?: number; previousPence?: number; deltaPence?: number; deltaPct?: number | null; baselinePence?: number | null; line: string; why?: string }

/**
 * Monthly payments that landed twice in one month and not at all in the other (a weekend or bank-holiday
 * shift) — said beside the trend, never "corrected" out of it: the money really did leave in that month.
 */
export function timingShifts(series: Series[], rows: Row[], cur: string, prev: string): Timing | null {
  const byId = new Map(rows.map((t) => [t.id, t]));
  const shiftedIn: string[] = []; const shiftedOut: string[] = []; let net = 0;
  for (const s of series.filter((x) => ESTABLISHED(x) && x.cadence === 'monthly' && x.direction === 'out')) {
    const dates = s.txnIds.map((id) => byId.get(id)).filter(Boolean).map((t) => t!.date.slice(0, 7));
    const c = dates.filter((m) => m === cur).length; const p = dates.filter((m) => m === prev).length;
    if (c === 2 && p === 0) { shiftedIn.push(s.label); net += s.typicalPence; }
    if (p === 2 && c === 0) { shiftedOut.push(s.label); net -= s.typicalPence; }
  }
  if (!shiftedIn.length && !shiftedOut.length) return null;
  const parts = [];
  if (shiftedIn.length) parts.push(`${shiftedIn.length} monthly payment${shiftedIn.length === 1 ? '' : 's'} (${shiftedIn.slice(0, 4).join(', ')}${shiftedIn.length > 4 ? '…' : ''}) landed twice in ${cur} and not in ${prev}`);
  if (shiftedOut.length) parts.push(`${shiftedOut.length} landed twice in ${prev} and not in ${cur}`);
  return { shiftedIn, shiftedOut, netPence: net, note: `${parts.join('; ')} — payment timing, about ${net >= 0 ? '+' : '−'}${pounds(net)} of the change` };
}

export function monthTrends(summaries: MonthSummary[], timing: (cur: string, prev: string) => Timing | null = () => null): Trend[] {
  const pair = comparablePair(summaries);
  const measures: Array<[keyof MonthSummary, string]> = [['spendPence', 'spending'], ['incomePence', 'income'], ['moneyOutPence', 'money out'], ['recurringOutPence', 'recurring money out'], ['netMovementPence', 'net movement']];
  if ('why' in pair) return measures.map(([, m]) => ({ measure: m, state: 'insufficient_data', line: `No ${m} trend: ${pair.why}.`, why: pair.why }));
  const { cur, prev } = pair;
  const complete = summaries.filter((s) => s.complete && s.month < prev.month).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 2);
  return measures.map(([k, m]) => {
    const c = cur[k] as number; const p = prev[k] as number;
    // Net movement can be negative: compare it on the absolute change only, never as a ratio of a negative.
    const state = k === 'netMovementPence'
      ? (Math.abs(c - p) < T.TREND_SLIGHT_PENCE ? 'broadly_stable' : c - p >= T.TREND_MATERIAL_PENCE ? 'materially_up' : c - p > 0 ? 'slightly_up' : p - c >= T.TREND_MATERIAL_PENCE ? 'materially_down' : 'slightly_down')
      : trendState(c, p);
    const base = median([p, ...complete.map((s) => s[k] as number)]);
    const delta = c - p;
    const tm = ['spendPence', 'moneyOutPence', 'recurringOutPence', 'netMovementPence'].includes(k as string) ? timing(cur.month, prev.month) : null;
    return {
      measure: m, state, timing: tm, current: cur.month, previous: prev.month, currentPence: c, previousPence: p, deltaPence: delta,
      deltaPct: p > 0 && k !== 'netMovementPence' ? Math.round((delta / p) * 1000) / 10 : null, baselinePence: base,
      line: `${cur.month} ${m} ${WORD[state]} against ${prev.month}: ${signed(c)} vs ${signed(p)} (${delta >= 0 ? '+' : '−'}${pounds(delta)})${tm ? `; ${tm.note}` : ''}`,
    };
  });
}

export interface CategoryTrend {
  category: string; state: TrendState; currentPence: number; previousPence: number; deltaPence: number; deltaPct: number | null;
  contributors: Array<{ merchantKey: string; deltaPence: number; private: boolean }>; line: string;
}

/**
 * Category changes, only when classification coverage is good enough in BOTH months. Contributors are
 * the merchants whose change moved the category most (flagged private when on someone else's own account).
 */
export function categoryTrends(summaries: MonthSummary[], rows: Row[]): { available: boolean; why: string | null; current?: string; previous?: string; coverage?: { currentPct: number | null; previousPct: number | null }; items: CategoryTrend[] } {
  const pair = comparablePair(summaries);
  if ('why' in pair) return { available: false, why: pair.why, items: [] };
  const { cur, prev } = pair;
  const cov = { currentPct: cur.categorisedPct, previousPct: prev.categorisedPct };
  const min = T.CATEGORY_COVERAGE_MIN * 100;
  if ((cur.categorisedPct ?? 0) < min || (prev.categorisedPct ?? 0) < min) {
    return { available: false, current: cur.month, previous: prev.month, coverage: cov, items: [],
      why: `only ${cur.categorisedPct}% (${cur.month}) and ${prev.categorisedPct}% (${prev.month}) of spending carries a category — category trends need ${min}% in both` };
  }
  const cats = new Set([...Object.keys(cur.byCategory), ...Object.keys(prev.byCategory)].filter((c) => c !== 'Uncategorised'));
  const merchantDelta = (cat: string) => {
    const m = new Map<string, { d: number; private: boolean }>();
    for (const t of rows) {
      if (catName(t) !== cat || !t.merchantKey) continue;
      const mo = t.date.slice(0, 7); const s = spendEffect(t);
      if (!s || (mo !== cur.month && mo !== prev.month)) continue;
      const e = m.get(t.merchantKey) ?? { d: 0, private: false };
      e.d += mo === cur.month ? s : -s; e.private = e.private || t.owner === 'private';
      m.set(t.merchantKey, e);
    }
    return [...m].filter(([, e]) => e.d !== 0).sort((a, b) => Math.abs(b[1].d) - Math.abs(a[1].d)).slice(0, 3)
      .map(([merchantKey, e]) => ({ merchantKey, deltaPence: e.d, private: e.private }));
  };
  const items: CategoryTrend[] = [];
  for (const c of cats) {
    const a = cur.byCategory[c] ?? 0; const b = prev.byCategory[c] ?? 0;
    if (Math.max(a, b) < T.CATEGORY_MIN_PENCE) continue;
    const state = b === 0 ? 'insufficient_data' : trendState(a, b, { materialPence: T.CATEGORY_MATERIAL_PENCE, slightPence: T.CATEGORY_SLIGHT_PENCE });
    const pctv = b ? Math.round(((a - b) / b) * 1000) / 10 : null;
    items.push({ category: c, state, currentPence: a, previousPence: b, deltaPence: a - b, deltaPct: pctv, contributors: merchantDelta(c),
      line: b === 0 ? `${c}: ${pounds(a)} in ${cur.month}, nothing in ${prev.month}` : `${c} ${WORD[state]} — ${pounds(a)} vs ${pounds(b)}${pctv != null ? ` (${pctv > 0 ? '+' : ''}${pctv}%)` : ''}` });
  }
  items.sort((x, y) => Math.abs(y.deltaPence) - Math.abs(x.deltaPence) || x.category.localeCompare(y.category));
  return { available: true, why: null, current: cur.month, previous: prev.month, coverage: cov, items };
}
