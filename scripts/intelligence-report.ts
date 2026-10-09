/**
 * Build 26 — print the finance intelligence for a database, for live validation.
 *   TALLY_DB_PATH=/tmp/tally-copy.db npx tsx scripts/intelligence-report.ts [--contract] [--json]
 * Point it at a COPY: opening the schema adds Build 26's columns and tables to whatever file it opens.
 */
import { pounds } from '../src/server/intelligence/util.js';

const { readIntel } = await import('../src/server/intelligence/reader.js');
const { compose } = await import('../src/server/intelligence/compose.js');
const { toContract } = await import('../src/server/intelligence/contract.js');
const { londonToday } = await import('../src/server/intelligence/util.js');

const now = Date.now();
const t0 = Date.now();
const intel = compose(readIntel(), { now, today: londonToday(now) });
const ms = Date.now() - t0;
if (process.argv.includes('--json')) {
  const { _rows, ...rest } = intel;
  console.log(JSON.stringify(process.argv.includes('--contract') ? toContract(intel) : rest, null, 1));
  process.exit(0);
}
const p = (n: number | null | undefined) => (n == null ? '—' : `${n < 0 ? '−' : ''}${pounds(n)}`);
console.log(`today ${intel.today}; ${intel.source.transactionsRead} transactions ${intel.source.dataFrom} – ${intel.source.dataThrough}; composed in ${ms} ms`);
console.log('\n== source health');
for (const a of intel.health.bankFeed.accounts) console.log(`  feed ${a.name.padEnd(6)} ${a.state.padEnd(18)} ${a.why}`);
for (const b of intel.health.balances) console.log(`  balance ${b.name.padEnd(6)} fresh=${b.fresh} ${b.why}`);
for (const t of intel.health.transactions) console.log(`  txns ${t.name.padEnd(6)} ${t.why}${t.gaps.length ? ' ' + JSON.stringify(t.gaps) : ''}`);
console.log(`  categories ${intel.health.categories.state}: ${intel.health.categories.why}`);
console.log(`  recurrence ${intel.health.recurrence.state}: ${intel.health.recurrence.why}`);
console.log(`  forecast ${intel.health.forecast.state}: ${intel.health.forecast.why.join('; ')}`);
console.log('\n== position');
for (const b of intel.balances) console.log(`  ${b.name.padEnd(6)} ${p(b.balancePence).padStart(12)}  ${b.owner}`);
console.log(`  household usable ${p(intel.position.usableLiquidPence)} — ${intel.position.statement}`);
console.log('\n== cashflow', intel.cashflow.confidence, '—', intel.cashflow.confidenceWhy.join('; '));
for (const h of intel.cashflow.horizons) console.log(`  ${h.label.padEnd(8)} open ${p(h.openingPence)} in ${p(h.moneyInPence)} out ${p(h.moneyOutPence)} → ${p(h.projectedPence)}${h.projectedRange ? ` (${p(h.projectedRange.lowPence)}–${p(h.projectedRange.highPence)})` : ''}; lowest ${p(h.lowestPoint.pence)} on ${h.lowestPoint.date}; day-to-day not projected ~${p(h.dayToDayNotProjectedPence)}`);
if (intel.cashflow.nextIncome) console.log(`  next income ${intel.cashflow.nextIncome.date} ${intel.cashflow.nextIncome.label} ${p(intel.cashflow.nextIncome.pence)}`);
if (intel.cashflow.toNextIncome) console.log(`  to next income → ${p(intel.cashflow.toNextIncome.projectedPence)} (lowest ${p(intel.cashflow.toNextIncome.lowestPoint.pence)})`);
for (const u of intel.cashflow.excludedUnknowns) console.log(`  excluded: ${u}`);
console.log('\n== pressure', intel.pressure.state); for (const w of intel.pressure.why) console.log('  ' + w);
console.log('\n== months'); for (const s of intel.monthly) console.log(`  ${s.month} ${s.complete ? 'complete' : 'partial '} spend ${p(s.spendPence).padStart(10)} in ${p(s.moneyInPence).padStart(10)} out ${p(s.moneyOutPence).padStart(10)} recurring ${p(s.recurringOutPence).padStart(9)} cat ${s.categorisedPct}%${s.complete ? '' : '  ' + s.coverageReasons.join('; ')}`);
console.log('\n== trends'); for (const t of intel.trends) console.log(`  ${t.state.padEnd(16)} ${t.line}`);
console.log('\n== category trends', intel.categoryTrends.available ? '' : intel.categoryTrends.why);
for (const c of intel.categoryTrends.items.slice(0, 12)) console.log(`  ${c.state.padEnd(16)} ${c.line}  [${c.contributors.map((x) => `${x.private ? '(private)' : x.merchantKey} ${p(x.deltaPence)}`).join(', ')}]`);
console.log('\n== recurring', JSON.stringify(intel.recurringCounts));
for (const s of intel.recurring.filter((x) => x.state === 'strong_pattern' || x.state === 'explicit_recurring')) console.log(`  ${s.direction} ${s.accountName.padEnd(6)} ${s.label.slice(0, 34).padEnd(34)} ${s.cadence?.padEnd(11)} ${s.amountKind.padEnd(8)} ${p(s.typicalPence).padStart(9)}${s.range ? ` [${p(s.range.minPence)}–${p(s.range.maxPence)}]` : ''} next ${s.nextExpected}${s.lateDays != null ? ` late ${s.lateDays}d` : ''}${s.missed ? ' MISSED' : ''}`);
console.log('\n== price changes'); for (const c of intel.priceChanges) console.log(`  ${c.label}: ${c.line}`);
console.log('\n== unusual'); for (const u of intel.unusual) console.log(`  ${u.date} ${u.kind.padEnd(24)} ${u.owner.padEnd(8)} ${u.explainedBy ? `[explained: ${u.explainedBy}] ` : ''}${u.why}`);
console.log('\n== upcoming (30d + annual)'); for (const i of intel.upcoming) console.log(`  ${i.date} ${i.direction} ${p(i.pence).padStart(10)} ${i.label} ${i.owner} ${(i as any).kind}`);
console.log('\n== counts', JSON.stringify(intel.counts));
const c = toContract(intel);
const s = JSON.stringify(c);
console.log(`\ncontract ${c.contract}: ${s.length} bytes; sections ${Object.keys(c).join(', ')}`);
