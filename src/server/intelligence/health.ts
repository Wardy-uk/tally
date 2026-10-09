/**
 * Build 26 — finance source health. PURE. Six separate facts, never collapsed into one "healthy":
 *   bankFeed       did the bank refresh recently (per account + household)
 *   balances       when each balance was observed
 *   transactions   the newest transaction per account (a quiet account is not a stale one)
 *   categories     how much recent spending carries a usable category
 *   recurrence     how much regular money out is a recognised recurring payment
 *   forecast       whether a forward view can be given, and how confidently
 */
import { T } from './thresholds.js';
import { COUNTS, ownerOf, spendEffect, type Coverage, type Owner, type RawAccount, type RawConnection, type RawTlAccount, type Row } from './ledger.js';
import type { Balance, Cashflow } from './cashflow.js';
import { addDays, daysBetween } from './util.js';
import { UNUSABLE_CATEGORIES } from './thresholds.js';

export type FeedState = 'healthy' | 'stale' | 'reconnect_required' | 'unknown';
export interface FeedAccount { accountId: number; name: string; owner: Owner; state: FeedState; lastRefreshAt: string | null; ageDays: number | null; why: string }

export function feedHealth(accounts: RawAccount[], tlAccounts: RawTlAccount[], connections: RawConnection[], now: number, today: string) {
  const conn = new Map(connections.map((c) => [c.id, c]));
  const per: FeedAccount[] = accounts.filter((a) => a.active !== 0).map((a) => {
    const links = tlAccounts.filter((t) => t.linked_account_id === a.id).map((t) => ({ ...t, connection: conn.get(t.connection_id) ?? null }));
    const live = links.filter((l) => l.connection && l.connection.active);
    const best = [...live].sort((x, y) => String(y.last_sync_at ?? '').localeCompare(String(x.last_sync_at ?? '')))[0] ?? null;
    const base = { accountId: a.id, name: a.name, owner: ownerOf(a).owner, lastRefreshAt: best?.last_sync_at ?? null };
    if (!links.length) return { ...base, state: 'unknown' as FeedState, ageDays: null, why: 'no bank link — imported by hand, if at all' };
    if (!best || !best.last_sync_at) return { ...base, state: 'unknown' as FeedState, ageDays: null, why: 'linked to the bank but never refreshed' };
    const age = daysBetween(best.last_sync_at.slice(0, 10), today);
    if (age <= T.FEED_FRESH_DAYS) return { ...base, state: 'healthy' as FeedState, ageDays: age, why: `refreshed ${age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`}` };
    const exp = best.connection?.expires_at ? Date.parse(best.connection.expires_at) : NaN;
    const expiredDays = Number.isFinite(exp) ? Math.floor((now - exp) / 86400000) : null;
    if (age >= T.RECONNECT_AFTER_DAYS && expiredDays != null && expiredDays >= T.RECONNECT_AFTER_DAYS) {
      return { ...base, state: 'reconnect_required' as FeedState, ageDays: age, why: `no refresh since ${best.last_sync_at.slice(0, 10)} and the bank link stopped renewing — it needs re-approving at ${best.connection?.provider_name ?? 'the bank'}` };
    }
    return { ...base, state: 'stale' as FeedState, ageDays: age, why: `last refreshed ${best.last_sync_at.slice(0, 10)} (${age} days ago)` };
  });
  const states = per.map((p) => p.state);
  let household: 'healthy' | 'partial' | 'stale' | 'reconnect_required' | 'unknown';
  if (!per.length) household = 'unknown';
  else if (states.every((s) => s === 'healthy')) household = 'healthy';
  else if (states.some((s) => s === 'healthy')) household = 'partial';
  else if (states.every((s) => s === 'unknown')) household = 'unknown';
  else household = states.includes('reconnect_required') ? 'reconnect_required' : 'stale';
  return { household, accounts: per, rule: `Healthy means the bank refreshed in the last ${T.FEED_FRESH_DAYS} days. Stored history is never health.` };
}

export function sourceHealth({ rows, accounts, tlAccounts, connections, coverage, balances, cashflow, now, today }:
  { rows: Row[]; accounts: RawAccount[]; tlAccounts: RawTlAccount[]; connections: RawConnection[]; coverage: Coverage[]; balances: Balance[]; cashflow: Cashflow; now: number; today: string }) {
  const bankFeed = feedHealth(accounts, tlAccounts, connections, now, today);
  const from = addDays(today, -90);
  let spend = 0, known = 0, n = 0, nKnown = 0;
  for (const t of rows) {
    if (t.date < from || !COUNTS(t.status)) continue;
    const s = spendEffect(t); if (s <= 0) continue;
    spend += s; n++;
    if (t.category && !UNUSABLE_CATEGORIES.has(t.category.toLowerCase())) { known += s; nKnown++; }
  }
  const catPct = spend ? Math.round((known / spend) * 100) : null;
  const catState = catPct == null ? 'unknown' : catPct >= T.CATEGORY_GOOD * 100 ? 'good' : catPct >= T.CATEGORY_PARTIAL * 100 ? 'partial' : 'poor';
  const rc = cashflow.recurrenceCoveragePct;
  return {
    bankFeed,
    balances: balances.map((b) => ({ accountId: b.accountId, name: b.name, owner: b.owner, observedAt: b.observedAt, observedBasis: b.observedBasis, ageDays: b.ageDays, fresh: b.fresh, why: b.why })),
    transactions: coverage.map((c) => ({ accountId: c.accountId, name: c.name, owner: c.owner, newest: c.newest, ageDays: c.newest ? daysBetween(c.newest, today) : null,
      from: c.from, gaps: c.gaps, why: c.newest ? `newest transaction ${c.newest}${c.gaps.length ? `; ${c.gaps.length} suspected gap${c.gaps.length === 1 ? '' : 's'} in the history` : ''}` : 'no transactions' })),
    categories: { state: catState, valuePct: catPct, countPct: n ? Math.round((nKnown / n) * 100) : null, window: `${from} – ${today}`,
      why: catPct == null ? 'no spending in the last 90 days' : `${catPct}% of the last 90 days' spending (by value) carries a category` },
    recurrence: { state: rc == null ? 'unknown' : rc >= T.RECUR_COVERAGE_STRONG * 100 ? 'good' : rc >= T.RECUR_COVERAGE_PARTIAL * 100 ? 'partial' : 'poor', pct: rc,
      why: rc == null ? 'no complete month to measure' : `${rc}% of the latest complete month's regular (non-card) money out is a recognised recurring payment` },
    forecast: { state: cashflow.confidence, why: cashflow.confidenceWhy },
  };
}
