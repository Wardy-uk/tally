import crypto from 'crypto';
import { db } from '../db/schema.js';
import { ensureFreshToken, fetchAccounts, fetchTransactions, fetchBalance, TlTransaction } from './truelayer-client.js';
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

  // Fetch live balance from TrueLayer and back-calculate opening balance so
  // Tally's current_balance matches reality. opening = live - sum(all tx).
  //
  // For current accounts we compute `available - overdraft` rather than using
  // TrueLayer's `current` field. Why: `current` is the cleared balance
  // (excluding pending transactions) whereas `available` is what you can
  // actually spend right now. Subtracting the overdraft limit gives the
  // "true" balance including pending transactions and any overdraft usage.
  //   no overdraft:  available - 0        = available (same as current)
  //   in credit:     available - overdraft = money you actually have
  //   overdrawn:     available - overdraft = negative (amount you really owe)
  //
  // For credit cards TrueLayer reports debt as positive in `current`; we
  // invert to show as a negative Tally balance.
  try {
    const balance = await fetchBalance(accessToken, tlAccountId);
    if (balance) {
      const account = db.prepare(`SELECT type FROM accounts WHERE id = ?`).get(tallyAccountId) as { type: string } | undefined;
      const signedCurrent = account?.type === 'credit'
        ? -Math.round(Math.abs(balance.current) * 100)
        : Math.round((balance.available - (balance.overdraft ?? 0)) * 100);

      const txSum = (db.prepare(
        `SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE account_id = ?`,
      ).get(tallyAccountId) as { s: number }).s;

      const opening = signedCurrent - txSum;
      db.prepare(`UPDATE accounts SET opening_balance = ? WHERE id = ?`).run(opening, tallyAccountId);
    }
  } catch (e: any) {
    console.warn(`[truelayer-sync] balance fetch failed for account ${tallyAccountId}: ${e.message}`);
  }

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
      SELECT id, external_id, linked_account_id, last_sync_at FROM truelayer_accounts
      WHERE connection_id = ? AND linked_account_id IS NOT NULL
    `).all(c.id) as Array<{ id: number; external_id: string; linked_account_id: number; last_sync_at: string | null }>;

    // Per-account incremental: use each account's own last_sync_at (not the connection's),
    // so a failed account sync doesn't make the next run skip 88 days of data.
    const defaultFrom = new Date();
    defaultFrom.setDate(defaultFrom.getDate() - 90);
    const defaultFromStr = defaultFrom.toISOString().slice(0, 10);

    let anyAccountSucceeded = false;
    for (const row of linked) {
      const fromDate = row.last_sync_at
        ? new Date(new Date(row.last_sync_at).getTime() - 2 * 86400_000).toISOString().slice(0, 10)
        : defaultFromStr;
      try {
        const { imported, skipped } = await syncOneTlAccount(c.id, row.external_id, row.linked_account_id, fromDate);
        totalImported += imported;
        totalSkipped += skipped;
        accountsSynced++;
        anyAccountSucceeded = true;
      } catch (e: any) {
        const msg = `[truelayer-sync] connection ${c.id} / account ${row.external_id} failed: ${e.message}`;
        console.error(msg);
        if (e.stack) console.error(e.stack);
        errors.push(msg);
      }
    }

    // Only stamp the connection as synced if at least one account succeeded
    if (anyAccountSucceeded) {
      db.prepare(`UPDATE truelayer_connections SET last_sync_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), c.id);
    }
  }

  if (totalImported > 0) {
    detectTransfers(3);
    refreshRecurringTable();
  }

  return { connections: connections.length, accounts: accountsSynced, imported: totalImported, skipped: totalSkipped, errors };
}
