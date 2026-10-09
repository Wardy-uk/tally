/**
 * Build 26 — reads Tally's own tables for the intelligence. Every column named; bank tokens
 * (truelayer_connections.access_token / refresh_token) and account numbers are never selected.
 */
import { db } from '../db/schema.js';
import type { IntelRead } from './compose.js';
import type { RawAccount, RawConnection, RawTlAccount, RawTx } from './ledger.js';
import type { Planned } from './anomalies.js';

export function readIntel(): IntelRead {
  const transactions = db.prepare(`
    SELECT t.id, t.account_id, t.date, t.amount, t.description, t.merchant, t.category_id, c.name AS category_name, c.kind AS category_kind,
           t.is_transfer, t.transfer_pair_id, t.balance_after, t.created_at
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    ORDER BY t.id`).all() as unknown as RawTx[];
  const accounts = db.prepare(`
    SELECT a.id, a.name, a.type, a.active, a.opening_balance, a.balance_observed_at, u.display_name AS owner
    FROM accounts a LEFT JOIN users u ON u.id = a.owner_user_id ORDER BY a.id`).all() as unknown as RawAccount[];
  const tlAccounts = db.prepare(`SELECT id, connection_id, linked_account_id, last_sync_at, created_at FROM truelayer_accounts ORDER BY id`).all() as unknown as RawTlAccount[];
  const connections = db.prepare(`SELECT id, provider_name, expires_at, last_sync_at, active, created_at FROM truelayer_connections ORDER BY id`).all() as unknown as RawConnection[];
  const recurringDecisions = new Map((db.prepare(`SELECT series_key, decision FROM recurring_decisions`).all() as Array<{ series_key: string; decision: string }>).map((r) => [r.series_key, r.decision]));
  const unusualDecisions = new Map((db.prepare(`SELECT item_key, decision FROM unusual_decisions`).all() as Array<{ item_key: string; decision: string }>).map((r) => [r.item_key, r.decision]));
  const planned = db.prepare(`SELECT id, title, kind, due_date, amount, account_id, status, note FROM planned_payments ORDER BY due_date, id`).all() as unknown as Planned[];
  return { transactions, accounts, tlAccounts, connections, recurringDecisions, unusualDecisions, planned };
}
