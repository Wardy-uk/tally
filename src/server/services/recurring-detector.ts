import { db } from '../db/schema.js';

interface TxRow {
  id: number;
  date: string;
  amount: number;
  description: string;
}

interface RecurringGroup {
  merchant: string;
  typicalAmount: number; // pence, negative (expense)
  cadence: 'weekly' | 'monthly' | 'yearly' | 'irregular';
  count: number;
  firstSeen: string;
  lastSeen: string;
  nextExpected: string | null;
}

/** Normalise a description into a merchant-ish key for grouping. */
function normaliseMerchant(desc: string): string {
  return desc
    .toUpperCase()
    .replace(/\b(DEB|CR|POS|DD|SO|BGC|FPI|FPO|ATM|TFR|VIS)\b/g, '')
    .replace(/\d{6,}/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[^A-Z0-9 &]/g, '')
    .trim()
    .split(' ')
    .slice(0, 3)
    .join(' ');
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Detect recurring charges: groups transactions by normalised merchant key,
 * filters for ≥2 occurrences with similar amounts, classifies cadence by median gap.
 */
export function detectRecurring(): RecurringGroup[] {
  const rows = db.prepare(`
    SELECT id, date, amount, description
    FROM transactions
    WHERE is_transfer = 0 AND amount < 0
    ORDER BY date ASC
  `).all() as TxRow[];

  const groups = new Map<string, TxRow[]>();
  for (const r of rows) {
    const key = normaliseMerchant(r.description);
    if (!key || key.length < 3) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const out: RecurringGroup[] = [];
  for (const [merchant, txs] of groups) {
    if (txs.length < 2) continue;

    // Require amounts to be within 15% of each other OR exactly equal
    const amounts = txs.map(t => t.amount);
    const med = median(amounts);
    const close = amounts.filter(a => a === med || Math.abs(a - med) / Math.abs(med) < 0.15);
    if (close.length < 2) continue;

    // Compute median gap in days
    const dates = txs.map(t => new Date(t.date).getTime()).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) gaps.push((dates[i] - dates[i - 1]) / 86400000);
    const medGap = median(gaps);

    let cadence: RecurringGroup['cadence'];
    if (medGap >= 5 && medGap <= 9) cadence = 'weekly';
    else if (medGap >= 25 && medGap <= 35) cadence = 'monthly';
    else if (medGap >= 350 && medGap <= 380) cadence = 'yearly';
    else continue; // Not recurring

    const lastDate = new Date(dates[dates.length - 1]);
    const nextExpected = new Date(lastDate.getTime() + medGap * 86400000)
      .toISOString().slice(0, 10);

    out.push({
      merchant,
      typicalAmount: med,
      cadence,
      count: txs.length,
      firstSeen: new Date(dates[0]).toISOString().slice(0, 10),
      lastSeen: new Date(dates[dates.length - 1]).toISOString().slice(0, 10),
      nextExpected,
    });
  }

  return out.sort((a, b) => a.typicalAmount - b.typicalAmount);
}

/** Refresh the recurring_charges table from detected groups, preserving ignored flag. */
export function refreshRecurringTable(): number {
  const detected = detectRecurring();
  const existing = db.prepare(`SELECT merchant, ignored FROM recurring_charges`).all() as Array<{ merchant: string; ignored: number }>;
  const ignoredSet = new Set(existing.filter(r => r.ignored === 1).map(r => r.merchant));

  db.exec('BEGIN');
  try {
    db.exec(`DELETE FROM recurring_charges`);
    const ins = db.prepare(`
      INSERT INTO recurring_charges (merchant, typical_amount, cadence, last_seen, next_expected, active, ignored)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `);
    for (const r of detected) {
      ins.run(r.merchant, r.typicalAmount, r.cadence, r.lastSeen, r.nextExpected, ignoredSet.has(r.merchant) ? 1 : 0);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return detected.length;
}
