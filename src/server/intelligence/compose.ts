/**
 * Build 26 — one read of Tally → the full finance intelligence. PURE (now/today passed in).
 * This is what Tally's own Outlook page shows. The outbound, privacy-shaped version for other
 * systems is contract.ts, built FROM this — never a second calculation.
 */
import { accountCoverage, normalise, type RawAccount, type RawConnection, type RawTlAccount, type RawTx } from './ledger.js';
import { detectRecurring, ESTABLISHED, type Series } from './recurring.js';
import { categoryTrends, monthlySummary, monthsBetween, monthTrends, timingShifts } from './trends.js';
import { unusualSpend, type Planned } from './anomalies.js';
import { balanceHistory, balances, cashflow, pressure } from './cashflow.js';
import { feedHealth, sourceHealth } from './health.js';
import { addDays, pounds } from './util.js';

export interface IntelRead {
  transactions: RawTx[]; accounts: RawAccount[]; tlAccounts: RawTlAccount[]; connections: RawConnection[];
  recurringDecisions: Map<string, string>; unusualDecisions: Map<string, string>; planned: Planned[];
}

export function compose(read: IntelRead, { now, today }: { now: number; today: string }) {
  const rows = normalise(read.transactions, read.accounts);
  const coverage = accountCoverage(rows, read.accounts, read.tlAccounts);
  const dataFrom = coverage.map((c) => c.from).filter(Boolean).sort()[0] ?? null;
  const dataThrough = coverage.map((c) => c.through).filter(Boolean).sort().slice(-1)[0] ?? null;
  const series = detectRecurring(rows, { coverage, decisions: read.recurringDecisions, today });
  const summaries = monthsBetween(dataFrom, dataThrough).map((m) => monthlySummary(m, rows, coverage, series));
  const txSums = new Map<number, number>();
  for (const t of read.transactions) txSums.set(t.account_id, (txSums.get(t.account_id) ?? 0) + t.amount);
  const bal = balances(read.accounts, txSums, read.tlAccounts, today);
  const feed = new Map<number, boolean>();
  for (const a of feedHealth(read.accounts, read.tlAccounts, read.connections, now, today).accounts) feed.set(a.accountId, a.state === 'healthy');
  const cf = cashflow({ balances: bal, series, planned: read.planned, rows, summaries, today, feedFresh: feed });
  const health = sourceHealth({ rows, accounts: read.accounts, tlAccounts: read.tlAccounts, connections: read.connections, coverage, balances: bal, cashflow: cf, now, today });
  const historyFrom = summaries.filter((m) => m.complete).map((m) => `${m.month}-01`).sort()[0] ?? null;
  const history = historyFrom && cf.openingPence != null ? balanceHistory(read.transactions, cf.openingPence, cf.includedAccounts, historyFrom, today) : null;
  const unusual = unusualSpend(rows, { series, planned: read.planned, decisions: read.unusualDecisions, dataFrom, today });

  const usable = bal.filter((b) => b.usable);
  const fresh = usable.filter((b) => b.fresh);
  const position = {
    usableLiquidPence: fresh.length ? fresh.reduce((a, b) => a + b.balancePence, 0) : null,
    includedAccounts: fresh.map((b) => b.accountId),
    excluded: usable.filter((b) => !b.fresh).map((b) => ({ accountId: b.accountId, name: b.name, owner: b.owner, why: b.why })),
    coverage: !usable.length ? 'none' : fresh.length === usable.length ? 'complete' : fresh.length ? 'partial' : 'none',
    statement: !usable.length ? 'No current accounts in Tally.'
      : fresh.length === usable.length ? `Every current account's bank balance is current (${fresh.length} of ${usable.length}).`
      : fresh.length ? `${fresh.length} of ${usable.length} current accounts have a current bank balance; the total leaves out ${usable.filter((b) => !b.fresh).map((b) => b.name).join(', ')}.`
      : 'No current account has a current bank balance — the total would not be today\'s.',
  };

  // Dated money movements ahead: the next 30 days of the forward view, plus established annual payments
  // in the next 90 days (they are rare and large, so they are worth seeing early).
  const upcoming = (cf.horizons.find((h) => h.days === 30)?.items ?? []).map((f) => ({ ...f, kind: f.source === 'planned' ? 'planned' : 'recurring' }));
  const annual = series.filter((s) => ESTABLISHED(s) && s.cadence === 'yearly' && s.nextExpected && s.nextExpected <= addDays(today, 90) && s.nextExpected > addDays(today, 30))
    .map((s) => ({ date: s.nextExpected!, direction: s.direction, pence: s.typicalPence, lowPence: s.typicalPence, highPence: s.typicalPence, label: s.label, source: 'recurring' as const,
      seriesKey: s.key, accountId: s.accountId, owner: s.owner, variable: false, late: false, cadence: s.cadence, category: s.category, kind: 'annual' }));

  return {
    generatedAt: new Date(now).toISOString(), today,
    source: { system: 'tally', transactionsRead: read.transactions.length, dataFrom, dataThrough, coverage },
    health, balances: bal, position, cashflow: cf, pressure: pressure(cf, summaries, history),
    monthly: summaries, trends: monthTrends(summaries, (c, p) => timingShifts(series, rows, c, p)), categoryTrends: categoryTrends(summaries, rows),
    recurring: series.filter((s) => s.state !== 'unknown'),
    recurringCounts: series.reduce((o: Record<string, number>, s) => { o[s.state] = (o[s.state] ?? 0) + 1; return o; }, {}),
    priceChanges: series.filter((s) => ESTABLISHED(s) && s.priceChange).map((s) => ({ seriesKey: s.key, label: s.label, accountId: s.accountId, owner: s.owner, cadence: s.cadence, category: s.category, ...s.priceChange! })),
    unusual, upcoming: [...upcoming, ...annual],
    planned: read.planned,
    counts: {
      statuses: rows.reduce((o: Record<string, number>, t) => { o[t.status] = (o[t.status] ?? 0) + 1; return o; }, {}),
      types: rows.reduce((o: Record<string, number>, t) => { o[t.type] = (o[t.type] ?? 0) + 1; return o; }, {}),
      transfersInferred: rows.filter((t) => t.transferInferred).length,
    },
    _rows: rows,
  };
}
export type Intelligence = ReturnType<typeof compose>;
export const describeSeries = (s: Series) => `${s.label}: ${pounds(s.typicalPence)} ${s.cadence ?? ''}`.trim();
