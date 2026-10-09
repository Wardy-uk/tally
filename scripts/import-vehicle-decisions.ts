/**
 * Build 27 — bring Nick's car-spend decisions and rules across from NEURO, ONCE.
 *
 * Build 21 kept them in NEURO (vehicle_spend_decisions / vehicle_spend_rules), keyed on Tally's own
 * transaction ids. Under the Build 26 boundary they are finance decisions and belong here. This reads
 * NEURO's export (backend/scripts/export-vehicle-finance.js → JSON) and writes nothing unless --apply.
 *
 *   • every decision's transaction id must exist here with the SAME description, or it is refused
 *     (a reused id on another ledger would silently move a decision onto the wrong payment);
 *   • a rule is RE-KEYED with Tally's own merchant identity, read from the transaction it was first
 *     confirmed on — NEURO's key ("CD SHELL TALBOT STREET COALVILLE") is not Tally's ("SHELL TALBOT
 *     STREET COALVILLE"); two rules that become the same key fold into one;
 *   • a decision NEURO's rule made is NOT copied when the re-keyed rule matches the same transaction
 *     at read time; one it no longer matches is kept as an explicit 'imported' decision, so nothing
 *     Nick classified stops counting;
 *   • idempotent: a decision already here is never overwritten; a rule already here is reused.
 *
 *   npx tsx scripts/import-vehicle-decisions.ts --file=/tmp/neuro-vehicle-finance.json [--apply]
 *   (validate on a COPY first: TALLY_DB_PATH=/tmp/x.db …)
 */
import { readFileSync } from 'node:fs';
import { db } from '../src/server/db/schema.js';
import { merchantIdentity } from '../src/server/services/merchant.js';
import { readIntel } from '../src/server/intelligence/reader.js';
import { compose } from '../src/server/intelligence/compose.js';
import { ruleMatches, SPEND_TYPES, type VehicleRule } from '../src/server/intelligence/vehicle.js';
import { londonToday } from '../src/server/intelligence/util.js';
import { COUNTS } from '../src/server/intelligence/ledger.js';

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const apply = process.argv.includes('--apply');
const file = arg('file');
if (!file) { console.error('--file=<export.json> is required'); process.exit(2); }

type NDecision = { source_txn_id: number; decision: string; spend_type: string | null; vehicle_id: string | null; basis: string; rule_id: string | null; decided_by: string; decided_at: string };
type NRule = { rule_id: string; match_kind: string; merchant_key: string | null; category_name: string | null; spend_type: string; vehicle_id: string | null; examples_json: string | null; confirmed_at: string; active: number };
type NTxn = { source_txn_id: number; description: string; txn_date: string; amount_pence: number };
const exp = JSON.parse(readFileSync(file, 'utf8')) as { exportedAt: string; decisions: NDecision[]; rules: NRule[]; txns: NTxn[] };
const neuroTxn = new Map(exp.txns.map((t) => [t.source_txn_id, t]));
const tallyTxn = (id: number) => db.prepare('SELECT id, description, date, amount FROM transactions WHERE id = ?').get(id) as { id: number; description: string; date: string; amount: number } | undefined;

const problems: string[] = [];
// 1 — rules, re-keyed through Tally's merchant identity.
const rules: Array<{ neuroIds: string[]; matchKind: string; merchantKey: string | null; categoryName: string | null; spendType: string; vehicleRef: string | null; note: string }> = [];
for (const r of exp.rules.filter((x) => x.active)) {
  if (!SPEND_TYPES.includes(r.spend_type as any)) { problems.push(`rule ${r.rule_id}: unknown spend type ${r.spend_type}`); continue; }
  let key: string | null = null;
  if (r.match_kind !== 'category') {
    const ex = r.examples_json ? JSON.parse(r.examples_json) : {};
    const t = ex.confirmedOn ? tallyTxn(Number(ex.confirmedOn)) : undefined;
    if (!t) { problems.push(`rule ${r.rule_id} (${r.merchant_key}): its example transaction ${ex.confirmedOn} is not in Tally`); continue; }
    key = merchantIdentity(t.description).key;
    if (!key) { problems.push(`rule ${r.rule_id}: Tally finds no merchant in "${t.description}"`); continue; }
  }
  const same = rules.find((x) => x.matchKind === r.match_kind && x.merchantKey === key && String(x.categoryName ?? '').toLowerCase() === String(r.category_name ?? '').toLowerCase());
  if (same) { same.neuroIds.push(r.rule_id); if (same.spendType !== r.spend_type) problems.push(`rules ${same.neuroIds.join(', ')} fold to "${key}" but disagree on type (${same.spendType} / ${r.spend_type}) — kept ${same.spendType}`); continue; }
  rules.push({ neuroIds: [r.rule_id], matchKind: r.match_kind, merchantKey: key, categoryName: r.category_name, spendType: r.spend_type, vehicleRef: r.vehicle_id,
    note: `imported from NEURO (Build 21, confirmed ${r.confirmed_at.slice(0, 10)}; NEURO key "${r.merchant_key}")` });
}

// 2 — decisions, each checked against Tally's own transaction.
const rows = compose(readIntel(), { now: Date.now(), today: londonToday() })._rows;
const rowById = new Map(rows.map((t) => [t.id, t]));
const asRules: VehicleRule[] = rules.map((r, i) => ({ id: -(i + 1), matchKind: r.matchKind as any, merchantKey: r.merchantKey, categoryName: r.categoryName, spendType: r.spendType as any, vehicleRef: r.vehicleRef, active: true }));
const decisions: Array<{ id: number; decision: string; spendType: string | null; vehicleRef: string | null; why: string }> = [];
let coveredByRule = 0;
for (const d of exp.decisions) {
  const t = tallyTxn(d.source_txn_id);
  const n = neuroTxn.get(d.source_txn_id);
  if (!t) { problems.push(`decision on ${d.source_txn_id}: no such transaction in Tally`); continue; }
  if (n && n.description !== t.description) { problems.push(`decision on ${d.source_txn_id}: NEURO saw "${n.description}", Tally has "${t.description}" — refused`); continue; }
  const decision = d.decision === 'not-vehicle' ? 'not_vehicle' : d.decision;
  if (!['vehicle', 'not_vehicle', 'unknown'].includes(decision)) { problems.push(`decision on ${d.source_txn_id}: unknown decision ${d.decision}`); continue; }
  if (d.basis === 'rule' && decision === 'vehicle') {
    const row = rowById.get(d.source_txn_id);
    const eligible = row && COUNTS(row.status) && (row.type === 'spend' || row.type === 'fee') && row.amount < 0;
    const hit = eligible && asRules.find((r) => ruleMatches(r, row));
    if (hit && hit.spendType === d.spend_type) { coveredByRule++; continue; }
  }
  decisions.push({ id: d.source_txn_id, decision, spendType: decision === 'vehicle' ? d.spend_type : null, vehicleRef: decision === 'vehicle' ? d.vehicle_id : null,
    why: d.basis === 'rule' ? 'NEURO rule decision the re-keyed rule no longer matches' : `decided by ${d.decided_by} ${d.decided_at.slice(0, 10)}` });
}

console.log(`NEURO export ${exp.exportedAt}: ${exp.decisions.length} decisions, ${exp.rules.length} rules`);
console.log(`→ ${rules.length} Tally rule(s):`);
for (const r of rules) console.log(`   ${r.matchKind} "${r.merchantKey ?? r.categoryName}" → ${r.spendType} (${r.vehicleRef}) from ${r.neuroIds.length} NEURO rule(s)`);
console.log(`→ ${decisions.length} explicit decision(s); ${coveredByRule} rule decision(s) re-derived by the re-keyed rules`);
for (const p of problems) console.log(`   ! ${p}`);
if (!apply) { console.log('dry run — nothing written (add --apply)'); process.exit(problems.length ? 1 : 0); }
if (problems.length) { console.error('refusing to apply with problems listed above'); process.exit(1); }

db.exec('BEGIN');
try {
  let newRules = 0; let newDecisions = 0;
  for (const r of rules) {
    const have = db.prepare(`SELECT id FROM vehicle_spend_rules WHERE active = 1 AND match_kind = ? AND COALESCE(merchant_key, '') = COALESCE(?, '') AND LOWER(COALESCE(category_name, '')) = LOWER(COALESCE(?, ''))`).get(r.matchKind, r.merchantKey, r.categoryName);
    if (have) continue;
    db.prepare(`INSERT INTO vehicle_spend_rules (match_kind, merchant_key, category_name, spend_type, vehicle_ref, source, note) VALUES (?, ?, ?, ?, ?, 'neuro-import', ?)`).run(r.matchKind, r.merchantKey, r.categoryName, r.spendType, r.vehicleRef, r.note);
    newRules++;
  }
  for (const d of decisions) {
    const res = db.prepare(`INSERT OR IGNORE INTO vehicle_spend_decisions (transaction_id, decision, spend_type, vehicle_ref, basis, source) VALUES (?, ?, ?, ?, 'imported', 'neuro-import')`).run(d.id, d.decision, d.spendType, d.vehicleRef);
    newDecisions += Number(res.changes);
  }
  db.prepare(`INSERT INTO audit_log (user_id, action, target, meta) VALUES (NULL, 'intelligence.vehicle.import', 'neuro', ?)`).run(JSON.stringify({ exportedAt: exp.exportedAt, newRules, newDecisions, coveredByRule }));
  db.exec('COMMIT');
  console.log(`applied: ${newRules} rule(s), ${newDecisions} decision(s) written`);
} catch (e) { db.exec('ROLLBACK'); throw e; }
