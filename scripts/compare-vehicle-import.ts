/**
 * Build 27 — after import, compare Tally's vehicle month totals with what NEURO's Build 21 path
 * computed from the same decisions (NEURO's export), so the move is shown to change no figure —
 * or every difference is explained. Read-only.
 *   npx tsx scripts/compare-vehicle-import.ts --file=<export.json>
 */
import { readFileSync } from 'node:fs';
import { readIntel } from '../src/server/intelligence/reader.js';
import { compose } from '../src/server/intelligence/compose.js';
import { londonToday } from '../src/server/intelligence/util.js';

const file = process.argv.find((a) => a.startsWith('--file='))!.slice(7);
const exp = JSON.parse(readFileSync(file, 'utf8'));
const txn = new Map<number, any>(exp.txns.map((t: any) => [t.source_txn_id, t]));
// NEURO's Build 21 fold: same account, date, amount and NEURO merchant key = one purchase; gone rows drop.
const groups = new Map<string, number[]>();
for (const t of exp.txns) { const k = [t.account_name, t.txn_date, t.amount_pence, t.merchant_key].join('|'); groups.set(k, [...(groups.get(k) ?? []), t.source_txn_id]); }
const rep = new Map<number, number>(); for (const ids of groups.values()) { const lo = Math.min(...ids); for (const i of ids) rep.set(i, lo); }
const neuro: Record<string, number> = {};
for (const d of exp.decisions) {
  const t = txn.get(d.source_txn_id);
  if (d.decision !== 'vehicle' || !t || !t.in_source || rep.get(t.source_txn_id) !== t.source_txn_id) continue;
  neuro[t.txn_date.slice(0, 7)] = (neuro[t.txn_date.slice(0, 7)] ?? 0) + -t.amount_pence;
}
const intel = compose(readIntel(), { now: Date.now(), today: londonToday() });
const v = intel.vehicle.vehicles.find((x) => x.vehicleRef === 'vehicle:captur');
const tally: Record<string, number> = {};
for (const c of intel.vehicle._car) tally[c.row.date.slice(0, 7)] = (tally[c.row.date.slice(0, 7)] ?? 0) + c.pence;
const months = [...new Set([...Object.keys(neuro), ...Object.keys(tally)])].sort();
let diffs = 0;
for (const m of months) {
  const a = neuro[m] ?? 0; const b = tally[m] ?? 0;
  if (a !== b) diffs++;
  console.log(`${m}  NEURO ${(a / 100).toFixed(2).padStart(8)}  Tally ${(b / 100).toFixed(2).padStart(8)}${a !== b ? '   <-- differs' : ''}`);
}
// Explain each difference by transaction.
const neuroIds = new Set(exp.decisions.filter((d: any) => d.decision === 'vehicle').map((d: any) => d.source_txn_id));
for (const c of intel.vehicle._car) if (!neuroIds.has(c.row.id)) console.log(`  Tally counts ${c.row.id} ${c.row.date} ${c.row.description} (${c.basis}${c.ruleId ? ` rule ${c.ruleId}` : ''}) — NEURO had not decided it`);
for (const c of intel.vehicle._car) if (neuroIds.has(c.row.id) && c.pence !== -c.row.amount) console.log(`  Tally counts ${c.row.id} as ${c.pence} (status ${c.row.status}, type ${c.row.type})`);
console.log(`${diffs} month(s) differ; pending review ${intel.vehicle.review.pending}; vehicle confidence ${v?.confidence}`);
console.log(JSON.stringify({ latestComplete: v?.latestCompleteMonth, current: v?.currentMonth, w3: v?.last3CompleteMonths, rolling12m: v?.rolling12m, trend: v?.trend }, null, 1));
