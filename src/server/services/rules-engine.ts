import { db } from '../db/schema.js';
import { findRuleForTx, orderRules, type RuleLike, type TxLite } from './rule-policy.js';

interface Rule extends RuleLike {
  name: string;
}

let cache: Rule[] | null = null;

export function invalidateRuleCache() {
  cache = null;
}

/** Active rules that pass the safety policy, in evaluation order. */
export function loadRules(): Rule[] {
  if (cache) return cache;
  cache = orderRules(db.prepare(`SELECT * FROM rules WHERE active = 1`).all() as unknown as Rule[]);
  return cache;
}

/** Find the first (highest-priority) matching rule's category for a transaction. */
export function findCategoryForTx(tx: TxLite, rules?: Rule[]): number | null {
  return findRuleForTx(tx, rules ?? loadRules())?.category_id ?? null;
}

function applyTo(rows: TxLite[]): number {
  const rules = loadRules();
  if (rules.length === 0) return 0;
  const update = db.prepare(
    `UPDATE transactions SET category_id = ?, category_source = 'rule', category_rule_id = ? WHERE id = ?`,
  );
  let n = 0;
  db.exec('BEGIN');
  try {
    for (const tx of rows) {
      const rule = findRuleForTx(tx, rules);
      if (rule) {
        update.run(rule.category_id, rule.id, tx.id);
        n++;
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return n;
}

/** Apply all rules to every uncategorised transaction. Returns count updated. */
export function applyRulesToBacklog(): number {
  return applyTo(db.prepare(`
    SELECT id, description, merchant, amount
    FROM transactions
    WHERE category_id IS NULL AND is_transfer = 0
  `).all() as unknown as TxLite[]);
}

/** Apply all rules to a specific batch of newly-imported transaction IDs. */
export function applyRulesToTxIds(ids: number[]): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  return applyTo(db.prepare(`
    SELECT id, description, merchant, amount
    FROM transactions
    WHERE id IN (${placeholders}) AND category_id IS NULL AND is_transfer = 0
  `).all(...ids) as unknown as TxLite[]);
}
