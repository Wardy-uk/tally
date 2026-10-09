/**
 * Build 26 — current position, forward cashflow and the pressure state. PURE.
 *
 * The forward view uses ONLY reliable inputs: balances observed in the last 2 days, ESTABLISHED
 * recurring payments (explicit or strong) on those accounts, and planned payments recorded in Tally.
 * Day-to-day spending is NEVER projected as if it were certain — it is reported beside the projection
 * as an excluded unknown, with the recent normal it would come from. Weak patterns never count.
 *
 * Scope: the household's usable (current) accounts. Transfers between them cancel out by construction
 * (they are never in a recurring series). Someone else's own account is inside the household total but
 * its individual balance is never sent outbound (contract.ts).
 */
import { T } from './thresholds.js';
import { moneyOutEffect, ownerOf, type Owner, type RawAccount, type RawTlAccount, type Row } from './ledger.js';
import { ESTABLISHED, stepFrom, type Series } from './recurring.js';
import type { MonthSummary } from './trends.js';
import type { Planned } from './anomalies.js';
import { addDays, daysBetween, median, pounds } from './util.js';

export type Confidence = 'strong' | 'partial' | 'weak' | 'unavailable';
export type Pressure = 'comfortable' | 'tighter_than_usual' | 'stretched' | 'insufficient_data';

export interface Balance {
  accountId: number; name: string; owner: Owner; ownerName: string | null; type: string; role: 'current' | 'other';
  balancePence: number; observedAt: string | null; observedBasis: 'balance-fetch' | 'feed-refresh' | 'none';
  ageDays: number | null; fresh: boolean; usable: boolean; why: string;
}

const USABLE_TYPES = new Set(['current', 'cash']);

export function balances(accounts: RawAccount[], txSums: Map<number, number>, tlAccounts: RawTlAccount[], today: string): Balance[] {
  return accounts.filter((a) => a.active !== 0).map((a) => {
    const sync = tlAccounts.filter((x) => x.linked_account_id === a.id && x.last_sync_at).map((x) => x.last_sync_at!).sort().pop() ?? null;
    // balance_observed_at is stamped only when the bank's own balance was fetched; before Build 26 it
    // was never recorded, so the feed refresh (which fetches the balance) stands in, and says so.
    const observedAt = a.balance_observed_at ?? sync;
    const basis: Balance['observedBasis'] = a.balance_observed_at ? 'balance-fetch' : sync ? 'feed-refresh' : 'none';
    const ageDays = observedAt ? daysBetween(observedAt.slice(0, 10), today) : null;
    const fresh = ageDays != null && ageDays <= T.BALANCE_FRESH_DAYS;
    const usable = USABLE_TYPES.has(String(a.type).toLowerCase());
    const owner = ownerOf(a).owner;
    return {
      accountId: a.id, name: a.name, owner, ownerName: a.owner, type: a.type, role: usable ? 'current' : 'other',
      balancePence: Number(a.opening_balance || 0) + (txSums.get(a.id) ?? 0), observedAt, observedBasis: basis, ageDays, fresh, usable,
      why: !observedAt ? 'no bank balance has ever been observed (imported by hand)' : fresh
        ? `bank balance observed ${ageDays === 0 ? 'today' : `${ageDays} day${ageDays === 1 ? '' : 's'} ago`}${basis === 'feed-refresh' ? ' (at the last feed refresh)' : ''}`
        : `bank balance last observed ${observedAt.slice(0, 10)} (${ageDays} days ago) — not current`,
    };
  });
}

export interface FlowItem { date: string; direction: 'in' | 'out'; pence: number; lowPence: number; highPence: number; label: string; source: 'recurring' | 'planned'; seriesKey?: string; plannedId?: number; accountId: number | null; owner: Owner | null; variable: boolean; late: boolean; cadence?: string | null; category?: string | null }

export interface Horizon {
  label: string; days: number; through: string; openingPence: number; moneyInPence: number; moneyOutPence: number;
  projectedPence: number; projectedRange: { lowPence: number; highPence: number } | null; lowestPoint: { date: string; pence: number };
  items: FlowItem[]; dayToDayNotProjectedPence: number | null;
}

export interface Cashflow {
  confidence: Confidence; confidenceWhy: string[]; openingPence: number | null; includedAccounts: number[];
  excludedAccounts: Array<{ accountId: number; name: string; owner: Owner; why: string }>;
  horizons: Horizon[]; nextIncome: { date: string; label: string; pence: number; seriesKey: string; owner: Owner } | null;
  toNextIncome: Horizon | null; excludedUnknowns: string[]; recurrenceCoveragePct: number | null; explanation: string[];
}

/** Share of the latest complete month's NON-card money out that belongs to established series. */
export function recurrenceCoverage(rows: Row[], series: Series[], summaries: MonthSummary[]): { pct: number | null; month: string | null } {
  const last = summaries.filter((s) => s.complete).sort((a, b) => b.month.localeCompare(a.month))[0];
  if (!last) return { pct: null, month: null };
  const est = new Set(series.filter(ESTABLISHED).flatMap((s) => s.txnIds));
  let all = 0, rec = 0;
  for (const t of rows) {
    if (t.date.slice(0, 7) !== last.month || t.payment === 'card') continue;
    const o = moneyOutEffect(t); if (!o) continue;
    all += o; if (est.has(t.id)) rec += o;
  }
  return { pct: all ? Math.round((rec / all) * 100) : null, month: last.month };
}

/** Day-to-day (non-recurring) money out per month: the median of the last 3 complete months. */
export function dayToDayPerMonth(summaries: MonthSummary[]): number | null {
  const c = summaries.filter((s) => s.complete).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 3);
  return c.length ? median(c.map((s) => s.moneyOutPence - s.recurringOutPence)) : null;
}

function horizon(label: string, days: number, today: string, opening: number, flows: FlowItem[], d2d: number | null): Horizon {
  const through = addDays(today, days);
  const items = flows.filter((f) => f.date <= through).sort((a, b) => a.date.localeCompare(b.date) || (a.direction === 'out' ? -1 : 1) || a.label.localeCompare(b.label));
  let bal = opening; let lowest = { date: today, pence: opening };
  let inP = 0, outP = 0, lowR = opening, highR = opening; let variable = false;
  for (const f of items) {
    if (f.direction === 'in') { inP += f.pence; bal += f.pence; lowR += f.lowPence; highR += f.highPence; }
    else { outP += f.pence; bal -= f.pence; lowR -= f.highPence; highR -= f.lowPence; }
    if (f.variable) variable = true;
    if (bal < lowest.pence) lowest = { date: f.date, pence: bal };
  }
  return { label, days, through, openingPence: opening, moneyInPence: inP, moneyOutPence: outP, projectedPence: opening + inP - outP,
    projectedRange: variable ? { lowPence: lowR, highPence: highR } : null, lowestPoint: lowest, items,
    dayToDayNotProjectedPence: d2d != null ? Math.round((d2d * days) / 30.44) : null };
}

export function cashflow({ balances: bal, series, planned, rows, summaries, today, feedFresh }:
  { balances: Balance[]; series: Series[]; planned: Planned[]; rows: Row[]; summaries: MonthSummary[]; today: string; feedFresh: Map<number, boolean> }): Cashflow {
  const usable = bal.filter((b) => b.usable);
  const included = usable.filter((b) => b.fresh);
  const excluded = usable.filter((b) => !b.fresh).map((b) => ({ accountId: b.accountId, name: b.name, owner: b.owner, why: b.why }));
  for (const b of bal.filter((x) => !x.usable)) excluded.push({ accountId: b.accountId, name: b.name, owner: b.owner, why: `a ${b.type} account, not usable cash` });
  const inc = new Set(included.map((b) => b.accountId));
  const est = series.filter((s) => ESTABLISHED(s) && s.cadence && s.nextExpected && !s.missed);
  const flows: FlowItem[] = [];
  const end = addDays(today, 62);
  for (const s of est.filter((x) => inc.has(x.accountId))) {
    let d = s.nextExpected!;
    while (d <= end) {
      if (d >= today) {
        const v = s.amountKind === 'variable' && s.range;
        flows.push({ date: d, direction: s.direction, pence: s.typicalPence, lowPence: v ? s.range!.minPence : s.typicalPence, highPence: v ? s.range!.maxPence : s.typicalPence,
          label: s.label, source: 'recurring', seriesKey: s.key, accountId: s.accountId, owner: s.owner, variable: !!v, late: d === today && s.lateDays != null, cadence: s.cadence, category: s.category });
      }
      d = stepFrom(d, s.cadence!);
    }
  }
  for (const p of planned.filter((x) => x.status === 'open' && x.due_date >= today && x.due_date <= end && (x.account_id == null || inc.has(x.account_id)))) {
    const amt = Math.abs(p.amount);
    flows.push({ date: p.due_date, direction: p.amount > 0 ? 'in' : 'out', pence: amt, lowPence: amt, highPence: amt, label: p.title, source: 'planned', plannedId: p.id,
      accountId: p.account_id, owner: p.account_id != null ? bal.find((b) => b.accountId === p.account_id)?.owner ?? null : null, variable: false, late: false, category: null });
  }
  const opening = included.reduce((a, b) => a + b.balancePence, 0);
  const d2d = dayToDayPerMonth(summaries);
  const cov = recurrenceCoverage(rows, series, summaries);
  const incomeSeries = est.filter((s) => s.direction === 'in' && inc.has(s.accountId) && ['income', 'other_credit', 'transfer_external'].includes(s.flow))
    .sort((a, b) => a.nextExpected!.localeCompare(b.nextExpected!) || b.typicalPence - a.typicalPence);
  const ni = incomeSeries[0];
  const nextIncome = ni ? { date: ni.nextExpected!, label: ni.label, pence: ni.typicalPence, seriesKey: ni.key, owner: ni.owner } : null;

  const why: string[] = [];
  let confidence = 'strong' as Confidence;
  const lower = (c: Confidence) => { const order: Confidence[] = ['strong', 'partial', 'weak', 'unavailable']; if (order.indexOf(c) > order.indexOf(confidence)) confidence = c; };
  if (!usable.length) { lower('unavailable'); why.push('no current account in Tally'); }
  else if (!included.length) { lower('unavailable'); why.push('no account has a current bank balance'); }
  if (!est.length) { lower('unavailable'); why.push('no recurring payment is established yet'); }
  if (excluded.some((e) => usable.some((u) => u.accountId === e.accountId))) { lower('partial'); why.push(`${excluded.filter((e) => usable.some((u) => u.accountId === e.accountId)).length} account${excluded.length === 1 ? '' : 's'} left out because the balance is not current`); }
  if (!incomeSeries.length) { lower('weak'); why.push('no income is established as a recurring payment'); }
  if (cov.pct == null) { lower('weak'); why.push('no complete month to check how much regular money out is recognised'); }
  else if (cov.pct < T.RECUR_COVERAGE_PARTIAL * 100) { lower('weak'); why.push(`only ${cov.pct}% of ${cov.month}'s regular (non-card) money out is a recognised recurring payment`); }
  else if (cov.pct < T.RECUR_COVERAGE_STRONG * 100) { lower('partial'); why.push(`${cov.pct}% of ${cov.month}'s regular (non-card) money out is a recognised recurring payment`); }
  if (flows.some((f) => f.variable && f.date <= addDays(today, 30))) { lower('partial'); why.push('some bills vary in amount — a range is given'); }
  if (flows.some((f) => f.late)) { lower('partial'); why.push('a payment that was due has not been seen yet'); }
  if ([...feedFresh.entries()].some(([id, ok]) => inc.has(id) && !ok)) { lower('partial'); why.push('a bank feed is not refreshing, so recent payments may be missing'); }
  if (confidence === 'strong') why.push('current balances on every account, established income, and most regular money out recognised');

  const unknowns: string[] = [];
  if (d2d != null) unknowns.push(`day-to-day spending is not projected — it has run at about ${pounds(d2d)} a month recently (median of the last complete months)`);
  else unknowns.push('day-to-day spending is not projected, and there is no complete month to say what it usually is');
  for (const e of excluded) unknowns.push(`${e.name}: ${e.why}`);
  const weak = series.filter((s) => s.state === 'weak_pattern' && s.direction === 'out');
  if (weak.length) unknowns.push(`${weak.length} repeating payment${weak.length === 1 ? '' : 's'} not yet established (not projected)`);
  const missed = series.filter((s) => ESTABLISHED(s) && s.missed);
  if (missed.length) unknowns.push(`${missed.length} established payment${missed.length === 1 ? '' : 's'} did not arrive when expected (not projected)`);
  if (summaries.some((s) => s.cardRepaymentsPence > 0)) unknowns.push('credit-card spending is not in Tally — only the repayments are');

  const available = confidence !== 'unavailable';
  const horizons = available ? T.HORIZONS.map((h) => horizon(`${h} days`, h, today, opening, flows, d2d)) : [];
  const toNext = available && nextIncome && nextIncome.date > today
    ? horizon(`until the next income (${nextIncome.date})`, daysBetween(today, addDays(nextIncome.date, -1)), today, opening, flows.filter((f) => f.date < nextIncome.date), d2d) : null;
  return {
    confidence, confidenceWhy: why, openingPence: available ? opening : null, includedAccounts: [...inc], excludedAccounts: excluded,
    horizons, nextIncome, toNextIncome: toNext, excludedUnknowns: unknowns, recurrenceCoveragePct: cov.pct,
    explanation: available ? [
      `Opening balance ${pounds(opening)}: the current bank balances of ${included.map((b) => b.name).join(', ')}.`,
      `Money in and out are the established recurring payments (${est.filter((s) => inc.has(s.accountId)).length}) and planned payments recorded in Tally, on their expected dates.`,
      'Transfers between the household\'s own accounts cancel out and are not counted.',
      'Day-to-day spending is NOT subtracted; the projection is what the known payments alone would leave.',
    ] : ['No forward view: ' + why.join('; ') + '.'],
  };
}

export interface PressureRead { state: Pressure; why: string[]; basis: Record<string, number | string | null> }

/**
 * The household's daily balance history over the included accounts, from Tally's own arithmetic:
 * the balance on day d is today's balance minus everything dated after d. PURE.
 */
export function balanceHistory(transactions: Array<{ account_id: number; date: string; amount: number }>, openingToday: number, accountIds: number[], from: string, today: string): Map<string, number> {
  const inc = new Set(accountIds);
  const byDay = new Map<string, number>();
  for (const t of transactions) if (inc.has(t.account_id) && t.date > from) byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.amount);
  const out = new Map<string, number>();
  let bal = openingToday; let d = today;
  while (d >= from) { out.set(d, bal); bal -= byDay.get(d) ?? 0; d = addDays(d, -1); }
  return out;
}

/**
 * A bounded, read-only reading of how the next 30 days compare with the household's OWN usual, from
 * financial evidence only. Measured on the live ledger: Joint's bank balance routinely dips to about
 * −£200 before payday, so "tight" means tighter than that usual, never "below zero".
 *   usual low      the median of the lowest daily household balance in each of the last 3 complete months
 *   projected low  the lowest point in the next 30 days of known payments, with day-to-day spending
 *                  continuing at its usual pace (used for THIS reading only — never in the forecast)
 *   stretched           projected low is worse than the usual low by ≥25% of a usual month's money out
 *   tighter_than_usual  worse by ≥10%, or the latest complete month spent ≥115% of the median of the 3 before
 *   comfortable         otherwise
 *   insufficient_data   no usable 30-day view, or fewer than 2 complete months to say what is usual
 * Never "afford", never a judgement about a person.
 */
export function pressure(cf: Cashflow, summaries: MonthSummary[], history: Map<string, number> | null = null): PressureRead {
  const complete = summaries.filter((s) => s.complete).sort((a, b) => b.month.localeCompare(a.month));
  const d30 = cf.horizons.find((h) => h.days === 30);
  if (!d30 || cf.confidence === 'unavailable' || cf.confidence === 'weak') return { state: 'insufficient_data', why: [`the 30-day view is ${cf.confidence}: ${cf.confidenceWhy[0] ?? 'not available'}`], basis: {} };
  if (complete.length < 2) return { state: 'insufficient_data', why: ['fewer than two complete months to say what is usual'], basis: {} };
  const lows = history ? complete.slice(0, 3).map((s) => { const v = [...history].filter(([d]) => d.slice(0, 7) === s.month).map(([, b]) => b); return v.length ? Math.min(...v) : null; }).filter((x): x is number => x != null) : [];
  if (lows.length < 2) return { state: 'insufficient_data', why: ['the household balance history does not cover two complete months'], basis: {} };
  const usualLow = median(lows)!;
  const d2d = dayToDayPerMonth(summaries)!;
  const usualOut = median(complete.slice(0, 3).map((s) => s.moneyOutPence))!;
  // Walk the next 30 days: known payments on their dates, day-to-day spending at its usual daily pace.
  const rate = d2d / 30.44;
  let low = { date: d30.items[0]?.date ?? d30.through, pence: Number.POSITIVE_INFINITY };
  const start = addDays(d30.through, -30);
  for (let i = 0; i <= 30; i++) {
    const day = addDays(start, i);
    const known = d30.items.filter((f) => f.date <= day).reduce((a, f) => a + (f.direction === 'in' ? f.pence : -f.pence), 0);
    const bal = Math.round(d30.openingPence + known - rate * i);
    if (bal < low.pence) low = { date: day, pence: bal };
  }
  const shortfall = usualLow - low.pence;
  const latest = complete[0]; const before = complete.slice(1, 4);
  const baseSpend = before.length ? median(before.map((s) => s.spendPence)) : null;
  const spendUp = baseSpend ? latest.spendPence >= baseSpend * T.PRESSURE_SPEND_UP_RATIO : false;
  const sign = (p: number) => `${p < 0 ? '−' : ''}${pounds(p)}`;
  const basis = { usualLowPence: usualLow, usualLowMonths: lows.length, projectedLowPence: low.pence, projectedLowDate: low.date, usualDayToDayPence: d2d,
    usualMoneyOutPence: usualOut, shortfallPence: shortfall, latestMonth: latest.month, latestSpendPence: latest.spendPence, baselineSpendPence: baseSpend };
  const why = [
    `Usually the household balance bottoms out around ${sign(usualLow)} in a month (median of the last ${lows.length} complete months).`,
    `With the known payments and day-to-day spending at its usual pace (about ${pounds(d2d)} a month), the next 30 days bottom out around ${sign(low.pence)} (${low.date}).`,
    shortfall > 0 ? `That is ${pounds(shortfall)} lower than usual.` : `That is no lower than usual.`,
  ];
  if (spendUp) why.push(`${latest.month} spending (${pounds(latest.spendPence)}) was at least 15% above the usual ${pounds(baseSpend!)}.`);
  let state: Pressure = 'comfortable';
  if (shortfall >= usualOut * T.PRESSURE_STRETCHED_SHARE) state = 'stretched';
  else if (shortfall >= usualOut * T.PRESSURE_TIGHT_SHARE || spendUp) state = 'tighter_than_usual';
  if (cf.confidence === 'partial') why.push(`The forward view is partial (${cf.confidenceWhy[0]}).`);
  return { state, why, basis };
}
