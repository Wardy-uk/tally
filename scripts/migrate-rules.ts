/**
 * Migrate unsafe categorisation rules (card+date keys, date fragments, short/generic substrings)
 * to merchant-keyed rules.
 *
 *   Dry run (default, opens the DB read-only):  npx tsx scripts/migrate-rules.ts [path/to/tally.db]
 *   Apply (backs up first):                     npx tsx scripts/migrate-rules.ts [db] --apply
 *
 * --apply never removes an unproven category; it marks it category_source='unverified' so it can
 * be reviewed. Add --clear-unproven to uncategorise those instead (only after review).
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { planMigration, type PlanRule, type PlanTx, type Plan } from '../src/server/services/rule-migration.ts';
import { merchantIdentity } from '../src/server/services/merchant.ts';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const clearUnproven = args.includes('--clear-unproven');
const dbPath = path.resolve(args.find(a => !a.startsWith('--')) ?? 'tally.db');

const db = new DatabaseSync(dbPath, { readOnly: !apply });
const cats = new Map((db.prepare('SELECT id, name FROM categories').all() as any[]).map(c => [c.id as number, c.name as string]));
const catName = (id: number | null | undefined) => (id == null ? '(uncategorised)' : cats.get(id) ?? `#${id}`);
const uncategorisedId = [...cats.entries()].find(([, n]) => n === 'Uncategorised')?.[0] ?? null;

const hasCol = (table: string, col: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).some(c => c.name === col);
const rules = db.prepare(`SELECT * FROM rules ${hasCol('rules', 'active') ? 'WHERE active = 1' : ''}`).all() as unknown as PlanRule[];
const txs = db.prepare(`SELECT id, date, account_id, amount, description, merchant, category_id, is_transfer FROM transactions`).all() as unknown as PlanTx[];
const txById = new Map(txs.map(t => [t.id, t]));

const plan = planMigration(rules, txs, { uncategorisedId });

// ------------------------------------------------------------------ report
const gbp = (p: number) => `£${(p / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
const count = <T>(xs: T[], f: (x: T) => string) => xs.reduce((m, x) => m.set(f(x), (m.get(f(x)) ?? 0) + 1), new Map<string, number>());

function report(p: Plan): string {
  const out: string[] = [];
  const b = p.before, a = p.after;
  out.push(`# Tally rule migration — ${apply ? 'APPLY' : 'dry run'}`, '', `DB: ${dbPath}`, '');
  out.push('## Coverage (spending = non-transfer debits)', '',
    '| | Before | After |', '|---|---|---|',
    `| Usable category (by count) | ${b.usableTx}/${b.spendingTx} (${pct(b.usableTx, b.spendingTx)}) | ${a.usableTx}/${a.spendingTx} (${pct(a.usableTx, a.spendingTx)}) |`,
    `| Usable category (by value) | ${gbp(b.usablePence)}/${gbp(b.spendingPence)} (${pct(b.usablePence, b.spendingPence)}) | ${gbp(a.usablePence)}/${gbp(a.spendingPence)} (${pct(a.usablePence, a.spendingPence)}) |`,
    `| Unknown (by count) | ${pct(b.spendingTx - b.usableTx, b.spendingTx)} | ${pct(a.spendingTx - a.usableTx, a.spendingTx)} |`,
    `| Conflicting (merchant has >1 category) | ${b.conflictingTx} (${pct(b.conflictingTx, b.usableTx)}) | ${a.conflictingTx} (${pct(a.conflictingTx, a.usableTx)}) |`,
    `| Active rules | ${b.activeRules} | ${a.activeRules} |`, '');

  out.push('## Rule types', '', ...[...count(p.audits, x => x.type)].map(([k, v]) => `- ${k}: ${v}`), '');
  const unsafe = p.audits.filter(x => x.unsafeReason);
  out.push(`## Migration of ${unsafe.length} unsafe rules`, '', ...[...count(unsafe, x => x.migration!.state)].map(([k, v]) => `- ${k}: ${v}`), '');
  out.push(`New merchant rules: ${p.newRules.length}`, '');
  for (const n of p.newRules) out.push(`- ${n.merchantKey} → ${catName(n.categoryId)} (from rule ${n.fromRuleIds.join(', ')})`);
  out.push('');

  const d = p.txDecisions;
  const oc = count(d, x => x.outcome);
  out.push('## Transactions currently categorised by unsafe rules', '',
    `- In scope: ${d.length}`,
    `- Keep same category: ${oc.get('keep') ?? 0}`,
    `- Change category: ${oc.get('change') ?? 0}`,
    `- Unproven (would become uncategorised if cleared): ${oc.get('uncategorise_unproven') ?? 0}`,
    `- Newly categorised by migrated merchant rules (were blank): ${p.newlyCategorised.length}`, '');

  // Most affected merchants (unproven + changed)
  const moved = d.filter(x => x.outcome !== 'keep');
  const byMerchant = new Map<string, { n: number; pence: number; cats: Set<string> }>();
  for (const x of moved) {
    const t = txById.get(x.txId)!;
    const k = merchantIdentity(t.description, t.merchant).key ?? '(no merchant)';
    const m = byMerchant.get(k) ?? { n: 0, pence: 0, cats: new Set() };
    m.n++; m.pence -= t.amount; m.cats.add(catName(x.from));
    byMerchant.set(k, m);
  }
  out.push('## Most affected merchants', '', '| Merchant | Tx | Value | Currently labelled |', '|---|---|---|---|');
  for (const [k, m] of [...byMerchant].sort((x, y) => y[1].pence - x[1].pence).slice(0, 20)) {
    out.push(`| ${k} | ${m.n} | ${gbp(m.pence)} | ${[...m.cats].join(', ')} |`);
  }
  out.push('');

  // Monthly category deltas (spending only)
  const delta = new Map<string, number>();
  const bump = (month: string, cat: string, pence: number) => delta.set(`${month}|${cat}`, (delta.get(`${month}|${cat}`) ?? 0) + pence);
  const changes = [...d.filter(x => x.to !== x.from).map(x => ({ id: x.txId, from: x.from as number | null, to: x.to })),
    ...p.newlyCategorised.map(n => ({ id: n.txId, from: null as number | null, to: n.categoryId as number | null }))];
  for (const c of changes) {
    const t = txById.get(c.id)!;
    if (t.amount >= 0) continue;
    const m = t.date.slice(0, 7);
    bump(m, catName(c.from), t.amount);   // spend leaves old label (amount negative → reduces)
    bump(m, catName(c.to), -t.amount);
  }
  out.push('## Biggest month × category deltas (spend moving in/out of a label)', '', '| Month | Category | Δ spend |', '|---|---|---|');
  for (const [k, v] of [...delta].filter(([, v]) => v !== 0).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 15)) {
    const [m, c] = k.split('|');
    out.push(`| ${m} | ${c} | ${v > 0 ? '+' : '−'}${gbp(Math.abs(v))} |`);
  }
  out.push('', 'Monthly spending totals are unchanged by construction — only labels move.', '');

  out.push('## Needs Nick\'s confirmation', '');
  for (const x of unsafe.filter(x => x.migration!.state === 'needs_confirmation')) {
    out.push(`- Rule ${x.rule.id} "${x.rule.match_value}" → ${catName(x.rule.category_id)}: ${x.migration!.reason} [${x.merchantKeys.join(' · ')}]`);
  }
  out.push('');
  out.push('## Every unsafe rule', '', '| Rule | Match | Category | Type | Matches | Attributed | Conflicting | State | Reason |', '|---|---|---|---|---|---|---|---|---|');
  for (const x of unsafe) {
    out.push(`| ${x.rule.id} | ${x.rule.match_value} | ${catName(x.rule.category_id)} | ${x.type} | ${x.matches} | ${x.attributed} | ${x.conflicting} | ${x.migration!.state} | ${x.migration!.reason} |`);
  }
  out.push('', '## Retained (safe) rules', '', '| Rule | Match | Category | Type | Matches | Conflicting | Confidence |', '|---|---|---|---|---|---|---|');
  for (const x of p.audits.filter(x => !x.unsafeReason)) {
    out.push(`| ${x.rule.id} | ${x.rule.match_value} | ${catName(x.rule.category_id)} | ${x.type} | ${x.matches} | ${x.conflicting} | ${x.confidence} |`);
  }
  return out.join('\n');
}

console.log(report(plan));

// ------------------------------------------------------------------ apply
if (apply) {
  if (!hasCol('transactions', 'category_source') || !hasCol('rules', 'active')) {
    console.error('\nSchema not migrated yet — start the updated Tally server once, then re-run.');
    process.exit(1);
  }
  const backup = path.join(path.dirname(dbPath), 'backups', `pre-rule-migration-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  console.log(`\nBackup written: ${backup}`);

  db.exec('BEGIN');
  try {
    const retire = db.prepare(`UPDATE rules SET active = 0, retired_reason = ? WHERE id = ?`);
    for (const x of plan.audits.filter(x => x.unsafeReason)) {
      retire.run(`${x.unsafeReason}; migration: ${x.migration!.state}`, x.rule.id);
    }
    const ruleIdForKey = new Map<string, number>();
    const ins = db.prepare(`INSERT INTO rules (name, match_field, match_type, match_value, category_id, priority, source)
      VALUES (?, 'merchant_key', 'equals', ?, ?, 100, 'migrated')`);
    for (const n of plan.newRules) ruleIdForKey.set(n.merchantKey, Number(ins.run(`Merchant: ${n.merchantKey}`, n.merchantKey, n.categoryId).lastInsertRowid));

    const set = db.prepare(`UPDATE transactions SET category_id = ?, category_source = ?, category_rule_id = ? WHERE id = ?`);
    for (const x of plan.txDecisions) {
      if (x.outcome === 'keep') set.run(x.from, 'migration', null, x.txId);
      else if (x.outcome === 'change') {
        const t = txById.get(x.txId)!;
        set.run(x.to, 'rule', ruleIdForKey.get(merchantIdentity(t.description, t.merchant).key!) ?? null, x.txId);
      } else if (clearUnproven) set.run(null, null, null, x.txId);
      else set.run(x.from, 'unverified', null, x.txId);
    }
    for (const n of plan.newlyCategorised) set.run(n.categoryId, 'rule', ruleIdForKey.get(n.merchantKey) ?? null, n.txId);
    db.exec('COMMIT');
    console.log('Applied.');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
