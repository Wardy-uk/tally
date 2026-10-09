/**
 * Build 26 — the ledger read model. PURE: one read of Tally's tables in, the
 * normalised rows out. Nothing here touches the database or the clock.
 *
 * Ported from NEURO's Build 23 finance-model (which measured these rules on the
 * real ledger) — under the Build 26 boundary the money logic lives HERE, in
 * Tally, and NEURO only consumes the result. Merchant identity is Tally's own
 * merchantIdentity(), the same key its categorisation rules use.
 */
import { merchantIdentity } from '../services/merchant.js';
import { T } from './thresholds.js';
import { addDays, alnum, daysBetween, median, monthEnd, up } from './util.js';

// ── inputs (exactly the columns the reader selects) ─────────────────────────
export interface RawTx {
  id: number; account_id: number; date: string; amount: number; description: string; merchant: string | null;
  category_id: number | null; category_name: string | null; category_kind: string | null;
  is_transfer: number; transfer_pair_id: number | null; balance_after: number | null; created_at: string | null;
}
export interface RawAccount {
  id: number; name: string; type: string; active: number; opening_balance: number;
  owner: string | null; balance_observed_at: string | null;
}
export interface RawTlAccount { id: number; connection_id: number; linked_account_id: number | null; last_sync_at: string | null; created_at: string | null }
export interface RawConnection { id: number; provider_name: string | null; expires_at: string | null; last_sync_at: string | null; active: number; created_at: string | null }

export type Owner = 'primary' | 'shared' | 'private';
export type Status = 'settled' | 'pending' | 'superseded_pending' | 'unresolved_duplicate';
export type TxType = 'spend' | 'fee' | 'financing' | 'card_repayment' | 'transfer_internal' | 'transfer_external'
  | 'income' | 'other_credit' | 'refund' | 'reversal';

export interface Row {
  id: number; date: string; amount: number; description: string;
  merchantKey: string | null; recurKey: string | null; payment: 'card' | 'account_transfer' | 'other';
  category: string | null; categoryKind: string | null;
  accountId: number; accountName: string; owner: Owner; ownerName: string | null;
  status: Status; pairedWith: number | null; statusBasis: string | null;
  type: TxType; transferInferred: string | null; refundOf: number | null;
  balanceAfter: number | null; createdAt: string | null;
}

const CARD_REPAYMENT_RE = /\b(CAPITAL ONE|MARBLES|ZABLE|BARCLAYCARD|AMERICAN EXPRESS|AMEX|CREDIT ?CARD)\b/;
const FINANCING_RE = /\b(INSTALMENT|INSTALLMENT|REPAYMENT|LENDABLE|MONEYBARN|TANDEM HL|KLARNA)\b/;
const FEE_RE = /\b(SNOOZE FEE|UNPAID TRANSAC|OVERDRAFT|ARRANGED OD|INTEREST CHARGE|LATE FEE)\b/;
const CARD_DATE_TOKEN = /^\d{4} \d{2}[A-Z]{3}\d{2} /;
const STOP = new Set(['LTD', 'LIMITED', 'PLC', 'UK', 'THE', 'VIA', 'MOBILE', 'XFER', 'ACCOUNT']);

/** The primary user — whose finances the outbound contract is for. Everyone else's own account is private. */
export const PRIMARY_OWNER = () => String(process.env.TALLY_PRIMARY_OWNER || 'Nick').trim().toLowerCase();

export function ownerOf(a: Pick<RawAccount, 'owner'> | null | undefined): { owner: Owner; name: string | null } {
  const o = String(a?.owner ?? '').trim();
  if (!o) return { owner: 'shared', name: null };
  return { owner: o.toLowerCase() === PRIMARY_OWNER() ? 'primary' : 'private', name: o };
}

/** Coarse key for recurrence: the merchant's first two meaningful words. */
export function recurKey(key: string | null): string | null {
  if (!key) return null;
  if (/A\/C \d/.test(key)) return key;                       // an account transfer IS its key
  const words = up(key).replace(/^ZILCH /, '').replace(/\.COM\b/g, '').replace(/[*/].*$/, '').replace(/[^A-Z& ]/g, ' ')
    .split(' ').filter((w) => w.length > 1 && !STOP.has(w));
  return words.slice(0, 2).join(' ') || null;
}

/** A pending copy: no bank balance and no card+date token in the text. */
export function looksPending(r: Pick<RawTx, 'balance_after' | 'description'>): boolean {
  return r.balance_after == null && !CARD_DATE_TOKEN.test(up(r.description));
}

/**
 * Reconcile pending and settled copies. Deterministic (id order, each settled row used once).
 *   strong  same account + amount, within the window, one text a prefix of the other → superseded_pending
 *   weak    same account/amount/window, first word agrees → unresolved_duplicate (excluded, said)
 *   none    stands as pending (real money) if near the end of the data, else settled (bank charges look like this)
 */
export function reconcilePending(rows: RawTx[]): Map<number, { status: Status; pairedWith: number | null; basis: string | null }> {
  const out = new Map<number, { status: Status; pairedWith: number | null; basis: string | null }>();
  for (const r of rows) out.set(r.id, { status: 'settled', pairedWith: null, basis: null });
  const key = (d: string) => alnum(merchantIdentity(d).key ?? d);
  const settled = rows.filter((r) => !looksPending(r));
  const used = new Set<number>();
  const lastDate = new Map<number, string>();
  for (const r of rows) if (!lastDate.has(r.account_id) || r.date > lastDate.get(r.account_id)!) lastDate.set(r.account_id, r.date);
  for (const p of rows.filter(looksPending).sort((a, b) => a.id - b.id)) {
    const pk = key(p.description);
    const fits = settled.filter((s) => !used.has(s.id) && s.account_id === p.account_id && s.amount === p.amount && s.id !== p.id
      && Math.abs(daysBetween(p.date, s.date)) <= T.PENDING_WINDOW_DAYS && !s.is_transfer).sort((a, b) => a.id - b.id);
    const strong = fits.find((s) => { const sk = key(s.description); return pk.length >= 4 && (sk.startsWith(pk) || pk.startsWith(sk)); });
    if (strong) {
      used.add(strong.id);
      out.set(p.id, { status: 'superseded_pending', pairedWith: strong.id, basis: 'the pending copy of a transaction that has since settled' });
      out.set(strong.id, { status: 'settled', pairedWith: p.id, basis: 'settled copy of a pending transaction' });
      continue;
    }
    const first = (d: string) => up(merchantIdentity(d).key ?? d).split(' ')[0];
    const weak = fits.find((s) => first(s.description) && first(s.description) === first(p.description));
    if (weak) { out.set(p.id, { status: 'unresolved_duplicate', pairedWith: weak.id, basis: 'looks like the pending copy of another row, but the text does not match closely enough to be sure — excluded from totals' }); continue; }
    const nearEnd = daysBetween(p.date, lastDate.get(p.account_id)!) <= T.PENDING_WINDOW_DAYS;
    out.set(p.id, nearEnd
      ? { status: 'pending', pairedWith: null, basis: 'pending when the bank last synced; no settled copy yet' }
      : { status: 'settled', pairedWith: null, basis: 'no bank balance recorded, but too old to still be pending' });
  }
  return out;
}

/** Do pending and settled both count? Only one copy ever counts. */
export const COUNTS = (s: Status) => s === 'settled' || s === 'pending';

export function structuralType(r: RawTx, key: string | null, pairAccountKnown: boolean): TxType {
  if (r.is_transfer) return pairAccountKnown ? 'transfer_internal' : 'transfer_external';
  const cat = String(r.category_name ?? '').trim().toLowerCase();
  if (r.amount < 0) {
    if (cat === 'savings') return 'transfer_external';
    if (CARD_REPAYMENT_RE.test(key ?? '')) return 'card_repayment';
    if (FINANCING_RE.test(key ?? '')) return 'financing';
    if (FEE_RE.test(key ?? '')) return 'fee';
    return 'spend';
  }
  return String(r.category_kind ?? '') === 'income' ? 'income' : 'other_credit';
}

/** One read → the normalised rows. Refunds/reversals matched against their original spend. */
export function normalise(transactions: RawTx[], accounts: RawAccount[]): Row[] {
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const byId = new Map(transactions.map((t) => [t.id, t]));
  const pend = reconcilePending(transactions);
  const rows: Row[] = transactions.map((r) => {
    const a = acc.get(r.account_id);
    const id = merchantIdentity(r.description, r.merchant);
    const key = id.key;
    const own = ownerOf(a);
    const p = pend.get(r.id)!;
    const pair = r.transfer_pair_id ? byId.get(r.transfer_pair_id) : null;
    return {
      id: r.id, date: r.date, amount: r.amount, description: r.description,
      merchantKey: key, recurKey: recurKey(key), payment: id.kind,
      category: r.category_name, categoryKind: r.category_kind,
      accountId: r.account_id, accountName: a ? a.name : `Account ${r.account_id}`, owner: own.owner, ownerName: own.name,
      status: p.status, pairedWith: p.pairedWith, statusBasis: p.basis,
      type: structuralType(r, key, !!(pair && acc.has(pair.account_id))), transferInferred: null, refundOf: null,
      balanceAfter: r.balance_after, createdAt: r.created_at,
    };
  });
  // A transfer whose other side is missing (Build 23, measured): a counterparty Tally itself paired as
  // a transfer ≥3 times (≥60% of its rows) is a transfer counterparty; an unpaired row to it is a
  // household transfer whose partner is not in Tally yet (a feed gap) — internal, and said.
  const byKey = new Map<string, { paired: number; total: number }>();
  for (const t of rows) { if (!t.merchantKey) continue; const s = byKey.get(t.merchantKey) ?? { paired: 0, total: 0 }; s.total++; if (t.type === 'transfer_internal') s.paired++; byKey.set(t.merchantKey, s); }
  for (const t of rows) {
    if (t.type === 'transfer_internal' || t.type === 'transfer_external' || !t.merchantKey) continue;
    const s = byKey.get(t.merchantKey);
    if (s && s.paired >= T.TRANSFER_PAIRED_MIN && s.paired / s.total >= T.TRANSFER_PAIRED_SHARE) {
      t.type = 'transfer_internal';
      t.transferInferred = `Tally paired ${s.paired} earlier payments to the same account as transfers; this one's other side is not in Tally`;
    }
  }
  // Refunds and reversals: a credit whose merchant matches an earlier counted spend.
  const spends = rows.filter((t) => t.type === 'spend' && COUNTS(t.status));
  for (const t of rows) {
    if (t.type !== 'other_credit' || !COUNTS(t.status)) continue;
    const k = alnum(t.merchantKey);
    if (k.length < 4) continue;
    const orig = spends.filter((s) => s.date <= t.date && daysBetween(s.date, t.date) <= T.REFUND_LOOKBACK_DAYS && alnum(s.merchantKey).length >= 4
      && (alnum(s.merchantKey).startsWith(k) || k.startsWith(alnum(s.merchantKey))))
      .sort((a, b) => (Math.abs(a.amount + t.amount) - Math.abs(b.amount + t.amount)) || b.date.localeCompare(a.date) || a.id - b.id);
    if (!orig.length) continue;
    const o = orig[0];
    t.type = o.amount + t.amount === 0 && daysBetween(o.date, t.date) <= T.REVERSAL_DAYS ? 'reversal' : 'refund';
    t.refundOf = o.id;
    if (!t.category) { t.category = o.category; t.categoryKind = o.categoryKind; }
  }
  return rows;
}

/** Spending effect (positive pence): spend and fees, net of refunds. Transfers never count. */
export function spendEffect(t: Row): number {
  if (!COUNTS(t.status)) return 0;
  if (t.type === 'spend' || t.type === 'fee' || t.type === 'refund' || t.type === 'reversal') return -t.amount;
  return 0;
}
/** Money out (positive pence): spending plus financing, card repayments and money leaving the household. */
export function moneyOutEffect(t: Row): number {
  if (!COUNTS(t.status)) return 0;
  if (['spend', 'fee', 'financing', 'card_repayment', 'refund', 'reversal'].includes(t.type)) return -t.amount;
  if (t.type === 'transfer_external' && t.amount < 0) return -t.amount;
  return 0;
}
/** Money in (positive pence): income and other credits, and money arriving from outside the household. */
export function moneyInEffect(t: Row): number {
  if (!COUNTS(t.status)) return 0;
  if (t.type === 'income' || t.type === 'other_credit') return t.amount;
  if (t.type === 'transfer_external' && t.amount > 0) return t.amount;
  return 0;
}

// ── coverage ─────────────────────────────────────────────────────────────────

export interface Coverage {
  accountId: number; name: string; owner: Owner; ownerName: string | null;
  from: string | null; through: string | null; newest: string | null; rows: number; lastSyncAt: string | null;
  gaps: Array<{ from: string; to: string; days: number }>;
}

/**
 * How far each account's data can be trusted. `through` is the day before its last bank refresh
 * (a day's transactions arrive when the bank releases them), else its newest transaction. A quiet
 * stretch longer than the account's own rhythm allows is a SUSPECTED gap (see thresholds).
 */
export function accountCoverage(rows: Row[], accounts: RawAccount[], tlAccounts: RawTlAccount[]): Coverage[] {
  return accounts.filter((a) => a.active !== 0).map((a) => {
    const dates = [...new Set(rows.filter((t) => t.accountId === a.id).map((t) => t.date))].sort();
    const n = rows.filter((t) => t.accountId === a.id).length;
    const tl = tlAccounts.filter((x) => x.linked_account_id === a.id && x.last_sync_at).map((x) => x.last_sync_at!).sort();
    const lastSync = tl.length ? tl[tl.length - 1] : null;
    const through = lastSync ? addDays(lastSync.slice(0, 10), -1) : (dates.length ? dates[dates.length - 1] : null);
    const gaps: Coverage['gaps'] = [];
    if (n >= T.GAP_MIN_ROWS && dates.length >= 3) {
      const steps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
      // An account's own NORMAL quiet spells are not gaps: a bursty account (Nick's — busy around the
      // 1st, silent for weeks) has long quiet spells every month, so the limit also covers 1.5× its
      // 90th-percentile quiet spell. A busy account (Joint, ~4 a day) still trips at 10 days.
      const sorted = [...steps].sort((a, b) => a - b);
      const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] ?? 1;
      const limit = Math.max(T.GAP_MIN_DAYS, T.GAP_RATE_MULT * (median(steps) ?? 1), Math.ceil(T.GAP_P90_MULT * p90));
      // Only stretches BETWEEN transactions: after the newest one, a refreshing feed has confirmed
      // there is nothing new — that is quiet, not a gap (Nick's own account is quiet for weeks).
      for (let i = 1; i < dates.length; i++) {
        const d = daysBetween(dates[i - 1], dates[i]);
        if (d > limit) gaps.push({ from: addDays(dates[i - 1], 1), to: addDays(dates[i], -1), days: d - 1 });
      }
    }
    const own = ownerOf(a);
    return { accountId: a.id, name: a.name, owner: own.owner, ownerName: own.name, from: dates[0] ?? null, through,
      newest: dates[dates.length - 1] ?? null, rows: n, lastSyncAt: lastSync, gaps };
  });
}

/** Is a calendar month fully covered by every account that has data? Reasons say why not. */
export function monthCoverage(month: string, cov: Coverage[]): { month: string; complete: boolean; reasons: string[] } {
  const start = `${month}-01`; const end = monthEnd(month);
  const withData = cov.filter((c) => c.rows > 0);
  const reasons: string[] = [];
  for (const c of withData) {
    if (!c.from || c.from > addDays(start, 6)) reasons.push(`${c.name} data starts ${c.from}`);
    else if (!c.through || c.through < end) reasons.push(`${c.name} data runs only to ${c.through}`);
    for (const g of c.gaps) if (g.from <= end && g.to >= start) reasons.push(`${c.name} has no data ${g.from} – ${g.to} (a ${g.days}-day gap)`);
  }
  if (!withData.length) reasons.push('no account has data');
  return { month, complete: reasons.length === 0, reasons };
}
