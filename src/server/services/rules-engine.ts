import { db } from '../db/schema.js';

interface Rule {
  id: number;
  name: string;
  match_field: 'description' | 'merchant' | 'amount';
  match_type: 'contains' | 'equals' | 'regex' | 'startsWith';
  match_value: string;
  category_id: number;
  priority: number;
}

interface TxLite {
  id: number;
  description: string;
  merchant: string | null;
  amount: number;
}

let cache: Rule[] | null = null;

export function invalidateRuleCache() {
  cache = null;
}

export function loadRules(): Rule[] {
  if (cache) return cache;
  cache = db.prepare(`SELECT * FROM rules ORDER BY priority DESC, id`).all() as Rule[];
  return cache;
}

function matches(rule: Rule, tx: TxLite): boolean {
  const haystack = (() => {
    if (rule.match_field === 'description') return tx.description;
    if (rule.match_field === 'merchant') return tx.merchant ?? tx.description;
    if (rule.match_field === 'amount') return String(tx.amount);
    return '';
  })().toLowerCase();
  const needle = rule.match_value.toLowerCase();

  switch (rule.match_type) {
    case 'contains':   return haystack.includes(needle);
    case 'equals':     return haystack === needle;
    case 'startsWith': return haystack.startsWith(needle);
    case 'regex':
      try { return new RegExp(rule.match_value, 'i').test(haystack); }
      catch { return false; }
  }
}

/** Find the first (highest-priority) matching rule for a transaction. */
export function findCategoryForTx(tx: TxLite, rules?: Rule[]): number | null {
  const rs = rules ?? loadRules();
  for (const r of rs) {
    if (matches(r, tx)) return r.category_id;
  }
  return null;
}

/** Apply all rules to every uncategorised transaction. Returns count updated. */
export function applyRulesToBacklog(): number {
  const rules = loadRules();
  if (rules.length === 0) return 0;

  const rows = db.prepare(`
    SELECT id, description, merchant, amount
    FROM transactions
    WHERE category_id IS NULL AND is_transfer = 0
  `).all() as TxLite[];

  const update = db.prepare(`UPDATE transactions SET category_id = ? WHERE id = ?`);
  let n = 0;
  db.exec('BEGIN');
  try {
    for (const tx of rows) {
      const catId = findCategoryForTx(tx, rules);
      if (catId !== null) {
        update.run(catId, tx.id);
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

/** Apply all rules to a specific batch of newly-imported transaction IDs. */
export function applyRulesToTxIds(ids: number[]): number {
  if (ids.length === 0) return 0;
  const rules = loadRules();
  if (rules.length === 0) return 0;

  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, description, merchant, amount
    FROM transactions
    WHERE id IN (${placeholders}) AND category_id IS NULL AND is_transfer = 0
  `).all(...ids) as TxLite[];

  const update = db.prepare(`UPDATE transactions SET category_id = ? WHERE id = ?`);
  let n = 0;
  db.exec('BEGIN');
  try {
    for (const tx of rows) {
      const catId = findCategoryForTx(tx, rules);
      if (catId !== null) {
        update.run(catId, tx.id);
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
