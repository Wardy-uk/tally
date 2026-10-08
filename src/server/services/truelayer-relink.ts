/**
 * Reconnecting a bank must carry on where the dead connection stopped.
 *
 * Found Oct 2026: both NatWest connections stopped refreshing on 27 Jun 2026
 * (TrueLayer `invalid_grant`). A reconnect creates a NEW connection whose accounts
 * are unlinked, and a never-synced account fetched only 90 days back — by then the
 * gap was 103 days, so a plain reconnect would have lost the oldest fortnight with
 * nothing saying so. UK banks typically release more than 90 days of history only
 * in the first minutes after consent, which is why the callback syncs immediately.
 *
 * Takes the DB as a parameter (no import of schema.ts) so it tests against :memory:.
 */
import type { DatabaseSync } from 'node:sqlite';

const DAY = 86_400_000;
export const DEFAULT_LOOKBACK_DAYS = 90;
export const OVERLAP_DAYS = 2;

/**
 * Pure. Where an account's fetch should start:
 *   synced before          -> its last sync minus the overlap (unchanged behaviour)
 *   never synced, but the Tally account already holds transactions
 *                          -> the newest one minus the overlap (a reconnect — close the gap)
 *   neither                -> the default lookback
 * The overlap is safe because inserts dedupe on (account, date, amount, description).
 */
export function fetchFromDate(args: { lastSyncAt: string | null; latestTxDate: string | null; now: Date }): string {
  const { lastSyncAt, latestTxDate, now } = args;
  if (lastSyncAt) return new Date(new Date(lastSyncAt).getTime() - OVERLAP_DAYS * DAY).toISOString().slice(0, 10);
  if (latestTxDate && /^\d{4}-\d{2}-\d{2}$/.test(latestTxDate)) {
    return new Date(Date.parse(`${latestTxDate}T00:00:00Z`) - OVERLAP_DAYS * DAY).toISOString().slice(0, 10);
  }
  return new Date(now.getTime() - DEFAULT_LOOKBACK_DAYS * DAY).toISOString().slice(0, 10);
}

export interface RelinkResult {
  relinked: Array<{ newAccountRowId: number; tallyAccountId: number; fromConnectionId: number }>;
  retiredConnections: number[];
}

/**
 * After a new connection's accounts are inserted, link each one to the Tally account
 * its predecessor (same account number AND sort code, on an older connection) fed.
 * Match is exact and must be unique — an ambiguous match links nothing.
 * An older connection is marked inactive (never deleted) only when EVERY one of its
 * linked accounts now has a successor, so a partial reconnect retires nothing.
 */
export function relinkNewConnection(db: DatabaseSync, connectionId: number): RelinkResult {
  const fresh = db.prepare(`
    SELECT id, account_number, sort_code FROM truelayer_accounts
    WHERE connection_id = ? AND linked_account_id IS NULL
  `).all(connectionId) as Array<{ id: number; account_number: string | null; sort_code: string | null }>;

  const relinked: RelinkResult['relinked'] = [];
  const findOld = db.prepare(`
    SELECT ta.connection_id, ta.linked_account_id FROM truelayer_accounts ta
    WHERE ta.connection_id <> ? AND ta.linked_account_id IS NOT NULL
      AND ta.account_number = ? AND ta.sort_code = ?
  `);
  const link = db.prepare(`UPDATE truelayer_accounts SET linked_account_id = ? WHERE id = ?`);

  for (const a of fresh) {
    if (!a.account_number || !a.sort_code) continue;
    const olds = findOld.all(connectionId, a.account_number, a.sort_code) as Array<{ connection_id: number; linked_account_id: number }>;
    const targets = new Set(olds.map(o => o.linked_account_id));
    if (targets.size !== 1) continue;
    const old = olds[0];
    link.run(old.linked_account_id, a.id);
    relinked.push({ newAccountRowId: a.id, tallyAccountId: old.linked_account_id, fromConnectionId: old.connection_id });
  }

  const retiredConnections: number[] = [];
  const candidates = new Set(relinked.map(r => r.fromConnectionId));
  for (const oldConn of candidates) {
    const oldLinked = db.prepare(`
      SELECT account_number, sort_code FROM truelayer_accounts
      WHERE connection_id = ? AND linked_account_id IS NOT NULL
    `).all(oldConn) as Array<{ account_number: string; sort_code: string }>;
    const allMoved = oldLinked.every(o => db.prepare(`
      SELECT 1 FROM truelayer_accounts WHERE connection_id = ? AND account_number = ? AND sort_code = ? AND linked_account_id IS NOT NULL
    `).get(connectionId, o.account_number, o.sort_code));
    if (allMoved) {
      db.prepare(`UPDATE truelayer_connections SET active = 0 WHERE id = ?`).run(oldConn);
      retiredConnections.push(oldConn);
    }
  }
  return { relinked, retiredConnections };
}
