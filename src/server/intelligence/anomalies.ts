/**
 * Build 26 — unusual spend. PURE. Conservative and explained; the wording is always
 * "unusual compared with your recorded history" — never fraud, never a verdict.
 *
 * Signals (thresholds in thresholds.ts):
 *   above-merchant-history  ≥3× the median of ≥3 earlier payments to the merchant, and ≥£40
 *   above-category-history  ≥4× the median of ≥10 earlier payments in the category, and ≥£100
 *   unusual-merchant        a first-ever merchant, ≥£150, after the first month of data
 *   unusual-recurring-amount  a FIXED established payment ≥25% off its usual amount (not a price change)
 *   unusual-frequency       ≥5 payments to one merchant in 30 days, ≥3× its usual monthly count
 *   possible-duplicate      same account/merchant/amount within 2 days, both counted, same purchase date
 * Expected large items are NOT unusual: a payment in an established series (incl. yearly and variable
 * bills), a planned payment recorded in Tally near that date and amount, or one marked expected.
 */
import { T, UNUSABLE_CATEGORIES } from './thresholds.js';
import { COUNTS, type Row } from './ledger.js';
import { ESTABLISHED, type Series } from './recurring.js';
import { daysBetween, median, pounds, shortHash, up } from './util.js';

export interface Planned { id: number; title: string; kind: string; due_date: string; amount: number; account_id: number | null; status: string; note: string | null }
export type UnusualKind = 'above-merchant-history' | 'above-category-history' | 'unusual-merchant' | 'unusual-recurring-amount' | 'unusual-frequency' | 'possible-duplicate';
export interface Unusual { key: string; kind: UnusualKind; date: string; amountPence: number; txnIds: number[]; accountId: number; owner: Row['owner']; merchantKey: string | null; category: string | null; why: string; line: string; explainedBy: string | null; decision: string | null }

const purchaseToken = (d: string) => { const m = up(d).match(/^\d{4} (\d{2}[A-Z]{3}\d{2}) /); return m ? m[1] : null; };

export function unusualSpend(rows: Row[], { series = [], planned = [], decisions = new Map<string, string>(), dataFrom = null, today }:
  { series?: Series[]; planned?: Planned[]; decisions?: Map<string, string>; dataFrom?: string | null; today: string }): Unusual[] {
  const est = series.filter(ESTABLISHED);
  const inSeries = new Map<number, Series>(); for (const s of est) for (const id of s.txnIds) inSeries.set(id, s);
  const spends = rows.filter((t) => COUNTS(t.status) && (t.type === 'spend' || t.type === 'fee')).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const recentFrom = today ? new Date(Date.parse(`${today}T00:00:00Z`) - T.UNUSUAL_LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10) : '0000';
  const out: Unusual[] = [];
  const repeatIdsAll = new Set<number>();
  for (const s of series) if (s.amountKind === 'fixed' && s.occurrences >= 2) for (const id of s.txnIds) repeatIdsAll.add(id);
  const explain = (t: Row, amt: number): string | null => {
    const s = inSeries.get(t.id);
    if (s) return s.cadence === 'yearly' ? 'a known annual payment' : s.amountKind === 'variable' ? 'a known bill whose amount varies' : 'part of an established recurring payment';
    const p = planned.find((x) => x.status !== 'cancelled' && Math.abs(Math.abs(x.amount) - amt) <= Math.abs(x.amount) * 0.1 && Math.abs(daysBetween(x.due_date, t.date)) <= 7);
    if (p) return `the planned payment "${p.title}" recorded in Tally`;
    if (repeatIdsAll.has(t.id)) return 'a payment that repeats at this amount';
    return null;
  };
  const push = (kind: UnusualKind, t: Row, why: string, txns: Row[] = [t]) => {
    const key = `ri_${shortHash(`${kind}|${txns.map((x) => x.id).join('|')}`)}`;
    const amt = Math.abs(t.amount);
    const d = decisions.get(key) ?? null;
    out.push({ key, kind, date: t.date, amountPence: amt, txnIds: txns.map((x) => x.id), accountId: t.accountId, owner: t.owner, merchantKey: t.merchantKey, category: t.category,
      why, line: kind === 'possible-duplicate' ? `Possible duplicate: ${why}` : `Unusual compared with your recorded history: ${why}`,
      explainedBy: d === 'expected' ? 'marked expected in Tally' : (kind === 'possible-duplicate' || kind === 'unusual-frequency' ? null : explain(t, amt)), decision: d });
  };
  // One ordered pass, keeping each merchant's and category's history as it goes (no rescans).
  const byMerchant = new Map<string, number[]>();
  const byCategory = new Map<string, number[]>();
  const seenCoarse = new Set<string>();
  const repeatIds = repeatIdsAll;
  const ddSeries = est.filter((s) => s.amountKind === 'fixed' && s.direction === 'out' && s.payment !== 'card');
  for (const t of spends) {
    const amt = -t.amount;
    const prior = t.merchantKey ? byMerchant.get(t.merchantKey) ?? [] : [];
    const usableCat = !!t.category && !UNUSABLE_CATEGORIES.has(t.category.toLowerCase());
    const catPrior = usableCat && t.payment === 'card' ? byCategory.get(t.category!) ?? [] : [];
    const coarseSeen = !!t.recurKey && seenCoarse.has(t.recurKey);
    if (t.date >= recentFrom) {
      const dd = !inSeries.has(t.id) && t.payment !== 'card' ? ddSeries.find((s) => s.accountId === t.accountId && s.recurKey === t.recurKey) : null;
      if (dd && Math.abs(amt - dd.typicalPence) / dd.typicalPence >= T.UNUSUAL_RECUR_RATIO) {
        push('unusual-recurring-amount', t, `${pounds(amt)} to ${t.merchantKey}, which is usually ${pounds(dd.typicalPence)} (${dd.cadence})`);
      } else if (prior.length >= T.UNUSUAL_HISTORY_MIN) {
        const m = median(prior)!;
        if (amt >= T.UNUSUAL_MIN_PENCE && amt >= m * T.UNUSUAL_MERCHANT_MULT) push('above-merchant-history', t, `${pounds(amt)} against a usual ${pounds(m)} across ${prior.length} earlier payments to ${t.merchantKey}`);
      } else if (!prior.length && !coarseSeen && amt >= T.UNUSUAL_NEW_MIN_PENCE && dataFrom && daysBetween(dataFrom, t.date) >= T.NEW_MERCHANT_WARMUP_DAYS) {
        push('unusual-merchant', t, `${pounds(amt)} to ${t.merchantKey}, a merchant not seen before in the recorded history`);
      } else if (catPrior.length >= T.UNUSUAL_CATEGORY_HISTORY_MIN && !repeatIds.has(t.id)) {
        const m = median(catPrior)!;
        if (amt >= T.UNUSUAL_CATEGORY_MIN_PENCE && amt >= m * T.UNUSUAL_CATEGORY_MULT) push('above-category-history', t, `${pounds(amt)} in ${t.category}, where a card payment is usually ${pounds(m)} (${catPrior.length} earlier)`);
      }
    }
    if (t.merchantKey) byMerchant.set(t.merchantKey, [...prior, amt]);
    if (usableCat && t.payment === 'card') byCategory.set(t.category!, [...(byCategory.get(t.category!) ?? []), amt]);
    if (t.recurKey) seenCoarse.add(t.recurKey);
  }
  // Frequency: lots of payments to one merchant in the last 30 days against its usual monthly count.
  if (today) {
    const winFrom = new Date(Date.parse(`${today}T00:00:00Z`) - T.FREQUENCY_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
    const byM = new Map<string, Row[]>();
    for (const t of spends) if (t.merchantKey) byM.set(t.merchantKey, [...(byM.get(t.merchantKey) ?? []), t]);
    for (const [k, list] of byM) {
      const recent = list.filter((t) => t.date > winFrom);
      const before = list.filter((t) => t.date <= winFrom);
      if (recent.length < T.FREQUENCY_MIN || !before.length) continue;
      const span = Math.max(1, Math.round(daysBetween(before[0].date, winFrom) / 30.44));
      const usual = before.length / span;
      if (recent.length >= usual * T.FREQUENCY_MULT) push('unusual-frequency', recent[recent.length - 1], `${recent.length} payments to ${k} in the last 30 days, against about ${Math.round(usual * 10) / 10} a month before`, recent);
    }
  }
  // Possible duplicates.
  const weekly = new Set(series.filter((s) => ESTABLISHED(s) && s.cadence === 'weekly').flatMap((s) => s.txnIds));
  const seen = new Set<number>();
  const pool = spends.filter((t) => t.merchantKey && t.date >= recentFrom).sort((a, b) => a.id - b.id);
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
    const a = pool[i]; const b = pool[j];
    if (seen.has(b.id) || a.accountId !== b.accountId || a.merchantKey !== b.merchantKey || a.amount !== b.amount) continue;
    if (Math.abs(daysBetween(a.date, b.date)) > T.DUPLICATE_WINDOW_DAYS) continue;
    if (weekly.has(a.id) && weekly.has(b.id)) continue;
    if (a.pairedWith === b.id || b.pairedWith === a.id) continue;
    const pa = purchaseToken(a.description); const pb = purchaseToken(b.description);
    if (!pa || !pb || pa !== pb) continue; // without the card's purchase date, two payments are just two payments
    seen.add(b.id);
    push('possible-duplicate', a, `two ${pounds(-a.amount)} payments to ${a.merchantKey} with the same purchase date (${a.date}${a.date === b.date ? '' : ` and ${b.date}`}) from ${a.accountName}`, [a, b]);
  }
  return out.sort((x, y) => y.date.localeCompare(x.date) || x.key.localeCompare(y.key));
}
