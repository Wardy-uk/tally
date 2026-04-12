import { db } from '../db/schema.js';

interface TxRow {
  id: number;
  account_id: number;
  date: string;
  amount: number;
  description: string;
}

/**
 * Find transfer pairs: matching +X and -X across different accounts within N days.
 * Marks both sides is_transfer=1, sets transfer_pair_id to the other's id,
 * and sets category_id to the "Transfer" system category.
 *
 * Returns the number of pairs detected.
 */
export function detectTransfers(windowDays = 3): number {
  const transferCat = db.prepare(
    `SELECT id FROM categories WHERE name = 'Transfer' LIMIT 1`,
  ).get() as { id: number } | undefined;
  if (!transferCat) return 0;

  const candidates = db.prepare(`
    SELECT id, account_id, date, amount, description
    FROM transactions
    WHERE is_transfer = 0
    ORDER BY date ASC, id ASC
  `).all() as TxRow[];

  // Group by amount magnitude for fast lookup
  const byAbs = new Map<number, TxRow[]>();
  for (const t of candidates) {
    const k = Math.abs(t.amount);
    if (k === 0) continue;
    if (!byAbs.has(k)) byAbs.set(k, []);
    byAbs.get(k)!.push(t);
  }

  const pairUpdate = db.prepare(
    `UPDATE transactions SET is_transfer = 1, transfer_pair_id = ?, category_id = ? WHERE id = ?`,
  );

  const matched = new Set<number>();
  let pairs = 0;

  db.exec('BEGIN');
  try {
    for (const [, txs] of byAbs) {
      for (let i = 0; i < txs.length; i++) {
        const a = txs[i];
        if (matched.has(a.id)) continue;

        for (let j = i + 1; j < txs.length; j++) {
          const b = txs[j];
          if (matched.has(b.id)) continue;
          if (a.account_id === b.account_id) continue;
          if (a.amount + b.amount !== 0) continue; // must net to zero
          const dayDiff = Math.abs(
            (new Date(a.date).getTime() - new Date(b.date).getTime()) / 86400000,
          );
          if (dayDiff > windowDays) continue;

          pairUpdate.run(b.id, transferCat.id, a.id);
          pairUpdate.run(a.id, transferCat.id, b.id);
          matched.add(a.id);
          matched.add(b.id);
          pairs++;
          break;
        }
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return pairs;
}

/** Undo transfer flags for a specific transaction (and its pair). */
export function unmarkTransfer(txId: number): void {
  const tx = db.prepare(
    `SELECT id, transfer_pair_id FROM transactions WHERE id = ?`,
  ).get(txId) as { id: number; transfer_pair_id: number | null } | undefined;
  if (!tx) return;

  const clear = db.prepare(
    `UPDATE transactions SET is_transfer = 0, transfer_pair_id = NULL, category_id = NULL WHERE id = ?`,
  );
  db.exec('BEGIN');
  try {
    clear.run(tx.id);
    if (tx.transfer_pair_id) clear.run(tx.transfer_pair_id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
