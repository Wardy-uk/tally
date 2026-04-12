import crypto from 'crypto';
import { db } from '../db/schema.js';
import { ensureFreshToken, fetchAccounts, fetchTransactions, TlTransaction } from './truelayer-client.js';
import { TransactionQueries } from '../db/queries.js';
import { applyRulesToTxIds } from './rules-engine.js';
import { detectTransfers } from './transfer-detector.js';
import { refreshRecurringTable } from './recurring-detector.js';

interface Connection {
  id: number;
  provider_name: string;
  last_sync_at: string | null;
}

function hashTx(accountId: number, date: string, amount: number, description: string): string {
  return crypto.createHash('sha256')
    .update(`${accountId}|${date}|${amount}|${description.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
}

/** Sync one linked account: fetch TrueLayer transactions since last sync, dedupe into Tally. */
async function syncOneTlAccount(
  connectionId: number,
  tlAccountId: string,
  tallyAccountId: number,
  fromDate: string,
): Promise<{ imported: number; skipped: number }> {
  const accessToken = await ensureFreshToken(connectionId);
  const to = new Date().toISOString().slice(0, 10);
  const txs = await fetchTransactions(accessToken, tlAccountId, fromDate, to);

  let imported = 0;
  let skipped = 0;
  const insertedIds: number[] = [];

  db.exec('BEGIN');
  try {
    for (const t of txs) {
      const date = t.timestamp.slice(0, 10);
      // TrueLayer gives amount unsigned with type; convert to signed pence
      const penceAmount = Math.round(Math.abs(t.amount) * 100);
      const signedAmount = t.transaction_type === 'DEBIT' ? -penceAmount : penceAmount;
      const description = (t.description ?? '').trim();
      const hash = hashTx(tallyAccountId, date, signedAmount, description);

      const existing = TransactionQueries.findByDedupeHash.get(hash, tallyAccountId);
      if (existing) { skipped++; continue; }

      const result = TransactionQueries.insert.run(
        tallyAccountId, date, signedAmount, description, t.merchant_name ?? null,
        null, 0, null, hash, t.running_balance ? Math.round(t.running_balance.amount * 100) : null,
      );
      insertedIds.push(Number(result.lastInsertRowid));
      imported++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  applyRulesToTxIds(insertedIds);

  db.prepare(`UPDATE truelayer_accounts SET last_sync_at = ? WHERE connection_id = ? AND external_id = ?`)
    .run(new Date().toISOString(), connectionId, tlAccountId);

  return { imported, skipped };
}

/** Sync all linked accounts across all active connections. */
export async function syncAllConnections(): Promise<{
  connections: number;
  accounts: number;
  imported: number;
  skipped: number;
  errors: string[];
}> {
  const connections = db.prepare(`SELECT id, provider_name, last_sync_at FROM truelayer_connections WHERE active = 1`).all() as Connection[];
  const errors: string[] = [];
  let totalImported = 0;
  let totalSkipped = 0;
  let accountsSynced = 0;

  for (const c of connections) {
    const linked = db.prepare(`
      SELECT external_id, linked_account_id FROM truelayer_accounts
      WHERE connection_id = ? AND linked_account_id IS NOT NULL
    `).all(c.id) as Array<{ external_id: string; linked_account_id: number }>;

    // Default: pull last 90 days, or incremental from last sync
    const defaultFrom = new Date();
    defaultFrom.setDate(defaultFrom.getDate() - 90);
    const fromDate = c.last_sync_at
      ? new Date(new Date(c.last_sync_at).getTime() - 2 * 86400_000).toISOString().slice(0, 10)
      : defaultFrom.toISOString().slice(0, 10);

    for (const row of linked) {
      try {
        const { imported, skipped } = await syncOneTlAccount(c.id, row.external_id, row.linked_account_id, fromDate);
        totalImported += imported;
        totalSkipped += skipped;
        accountsSynced++;
      } catch (e: any) {
        errors.push(`connection ${c.id} / ${row.external_id}: ${e.message}`);
      }
    }

    db.prepare(`UPDATE truelayer_connections SET last_sync_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), c.id);
  }

  if (totalImported > 0) {
    detectTransfers(3);
    refreshRecurringTable();
  }

  return { connections: connections.length, accounts: accountsSynced, imported: totalImported, skipped: totalSkipped, errors };
}
