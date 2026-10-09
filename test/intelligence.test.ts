/**
 * Build 26 — finance intelligence. Numbers in test names follow the Build 26 test list.
 * Fixtures copy the SHAPES measured on the live ledger (9 Oct 2026): card lines "1717 09APR26 …",
 * direct debits with no card prefix, E.ON's £220.79→£184.92→£212.73 steps, Virgin's £63.05→£72.15,
 * DWP's four-weekly payments with one arrears top-up, and Helen's own account.
 * Run: npm test
 */
process.env.TALLY_DB_PATH = ':memory:';
process.env.TALLY_PRIMARY_OWNER = 'Nick';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compose, type IntelRead } from '../src/server/intelligence/compose.ts';
import { toContract, CONTRACT } from '../src/server/intelligence/contract.ts';
import { trendState } from '../src/server/intelligence/trends.ts';
import { assessCadence } from '../src/server/intelligence/recurring.ts';

import { household, tx, card, cat, TODAY, NOW } from './fixtures/household.ts';

const run = (read: IntelRead) => compose(read, { now: NOW, today: TODAY });
const series = (i: ReturnType<typeof run>, label: string) => i.recurring.find((s) => s.label === label);

// ── boundary: Tally calculates, and the contract carries the result ──────────────────────────

test('1–6. every finance calculation is produced by Tally and carried in the contract', () => {
  const c = toContract(run(household()));
  assert.ok(c.monthly.months.some((m) => m.complete && m.spendPence > 0), 'monthly spend');
  assert.ok(c.categories.latestMonth && Object.keys(c.categories.latestMonth.byCategory).length > 0, 'category totals');
  assert.ok(c.recurring.established.some((s) => s.typicalPence > 0), 'recurring amounts');
  assert.ok(c.cashflow.horizons.length === 3, 'cashflow');
  assert.ok(Array.isArray(c.unusual.items), 'anomalies');
  assert.ok(['comfortable', 'tighter_than_usual', 'stretched', 'insufficient_data'].includes(c.pressure.state), 'pressure');
});

// ── cashflow ─────────────────────────────────────────────────────────────────────────────────

test('8. fresh balances permit a forecast', () => {
  const i = run(household());
  assert.notEqual(i.cashflow.confidence, 'unavailable');
  assert.deepEqual(i.cashflow.horizons.map((h) => h.days), [7, 14, 30]);
  assert.equal(i.cashflow.excludedAccounts.length, 0);
});

test('9. a stale balance lowers confidence and is excluded by name', () => {
  const i = run(household(undefined, { fresh: [1, 2, 3] }));
  assert.equal(i.cashflow.confidence, 'partial');
  assert.deepEqual(i.cashflow.excludedAccounts.map((e) => e.name), ['Helen']);
  assert.ok(!i.cashflow.includedAccounts.includes(4));
  assert.match(i.cashflow.confidenceWhy.join(' '), /not current/);
});

test('10. with no current balance the forecast is blocked, not guessed', () => {
  const i = run(household(undefined, { fresh: [] }));
  assert.equal(i.cashflow.confidence, 'unavailable');
  assert.equal(i.cashflow.horizons.length, 0);
  assert.equal(i.cashflow.openingPence, null);
  assert.equal(i.pressure.state, 'insufficient_data');
});

test('11. a weak recurring pattern never drives the forecast', () => {
  const i = run(household((add) => { add(tx(3, '2026-08-05', -9900, 'WEAKCO LTD')); add(tx(3, '2026-09-05', -9900, 'WEAKCO LTD')); }));
  const s = series(i, 'WEAKCO LTD');
  assert.equal(s?.state, 'weak_pattern');
  assert.ok(!i.cashflow.horizons.flatMap((h) => h.items).some((x) => x.label === 'WEAKCO LTD'));
});

test('12. an established recurring payment is in the forecast on its expected date', () => {
  const i = run(household());
  const d30 = i.cashflow.horizons.find((h) => h.days === 30)!;
  const mort = d30.items.find((x) => x.label === 'MORTGAGE');
  assert.ok(mort, 'mortgage projected');
  assert.equal(mort!.date, '2026-11-01');
  assert.equal(mort!.pence, 52500);
});

test('13. transfers between household accounts are excluded from spending and forecasts', () => {
  const i = run(household());
  assert.ok(!i.recurring.some((s) => /A\/C/.test(s.label)), 'no transfer series');
  const sep = i.monthly.find((m) => m.month === '2026-09')!;
  assert.equal(sep.transfersExcluded.count, 2);
  assert.ok(!Object.keys(sep.byCategory).includes('Transfer'));
});

test('14. a refund reduces spending', () => {
  const base = run(household()).monthly.find((m) => m.month === '2026-09')!.spendPence;
  const i = run(household((add) => { add(tx(2, '2026-09-10', -5000, card('2026-09-10', 'ARGOS'), cat('Shopping'))); add(tx(2, '2026-09-14', 2000, 'ARGOS REFUND')); }));
  const sep = i.monthly.find((m) => m.month === '2026-09')!;
  assert.equal(sep.spendPence, base + 5000 - 2000);
  assert.equal(sep.refundsPence, 2000);
});

test('15. the next income is used only once it is established', () => {
  const two = run(household((add) => { add(tx(2, '2026-08-18', 195000, 'BELRON UK LTD')); add(tx(2, '2026-09-18', 195000, 'BELRON UK LTD')); }));
  assert.equal(series(two, 'BELRON')?.state ?? series(two, 'BELRON UK LTD')?.state, 'weak_pattern');
  assert.notEqual(two.cashflow.nextIncome?.label, 'BELRON UK LTD');
  const three = run(household((add) => { for (const d of ['2026-07-18', '2026-08-18', '2026-09-18']) add(tx(2, d, 195000, 'BELRON UK LTD')); }));
  assert.equal(three.cashflow.nextIncome?.label, 'BELRON UK LTD');
  assert.equal(three.cashflow.nextIncome?.date, '2026-10-18');
  assert.ok(three.cashflow.toNextIncome && three.cashflow.toNextIncome.through === '2026-10-17');
});

test('16. 7/14/30-day outputs are deterministic', () => {
  const a = run(household()); const b = run(household());
  assert.deepEqual(a.cashflow.horizons, b.cashflow.horizons);
  const d7 = a.cashflow.horizons[0];
  assert.equal(d7.projectedPence, d7.openingPence + d7.moneyInPence - d7.moneyOutPence);
  assert.ok(d7.dayToDayNotProjectedPence! > 0, 'day-to-day is reported, never subtracted');
});

// ── recurring and price changes ─────────────────────────────────────────────────────────────

test('17. a strong recurring payment is recognised', () => {
  const s = series(run(household()), 'MORTGAGE')!;
  assert.equal(s.state, 'strong_pattern');
  assert.equal(s.cadence, 'monthly');
  assert.equal(s.amountKind, 'fixed');
});

test('18. a weak pattern is reported but not forecast', () => {
  const i = run(household((add) => { add(tx(3, '2026-03-05', -9900, 'WEAKCO LTD')); add(tx(3, '2026-04-05', -9900, 'WEAKCO LTD')); }));
  const s = series(i, 'WEAKCO LTD')!;
  assert.equal(s.state, 'weak_pattern');
  assert.equal(s.nextExpected, null);
});

test('19. a variable direct-debit bill uses the median and range; a variable card shop is never a bill', () => {
  const water = [-7100, -8400, -6500, -9200, -7800, -8800];
  const i = run(household((add) => {
    ['2026-04-05', '2026-05-05', '2026-06-05', '2026-07-06', '2026-08-05', '2026-09-05'].forEach((d, n) => add(tx(3, d, water[n], 'SEVERN TRENT WATER')));
    ['2026-07-03', '2026-08-03', '2026-09-03'].forEach((d, n) => add(tx(2, d, [-4100, -9000, -5600][n], card(d, 'BIG DIY'))));
  }));
  const w = series(i, 'SEVERN TRENT WATER')!;
  assert.equal(w.amountKind, 'variable');
  assert.equal(w.state, 'strong_pattern');
  assert.deepEqual(w.range, { minPence: 6500, maxPence: 9200 });
  assert.equal(w.typicalPence, 8800); // median of the last 3: 9200, 7800, 8800
  const d30 = i.cashflow.horizons.find((h) => h.days === 30)!;
  const item = d30.items.find((x) => x.label === 'SEVERN TRENT WATER')!;
  assert.ok(item.variable && item.lowPence === 6500 && item.highPence === 9200);
  assert.ok(!i.recurring.some((s) => s.label === 'BIG DIY' && s.state === 'strong_pattern'));
});

test('20. a price increase is detected (Virgin Media)', () => {
  const pc = run(household()).priceChanges.find((p) => p.label === 'VIRGIN MEDIA PYMTS')!;
  assert.equal(pc.fromPence, 6305);
  assert.equal(pc.toPence, 7215);
  assert.equal(pc.changePence, 910);
  assert.equal(pc.firstObserved, '2026-05-11');
  assert.equal(pc.annualEffectPence, 910 * 12);
});

test('21. a price decrease is detected, and E.ON reads as steps in time, not a variable bill', () => {
  const i = run(household((add) => { for (const [d, a] of [['2026-05-20', -10884], ['2026-06-20', -10884], ['2026-07-20', -10884], ['2026-08-20', -7921], ['2026-09-21', -7921]] as const) add(tx(3, d, a, 'NFU MUTUAL INS-BC')); }));
  const nfu = i.priceChanges.find((p) => p.label === 'NFU MUTUAL INS-BC')!;
  assert.equal(nfu.changePence, 7921 - 10884);
  assert.ok(nfu.changePence < 0);
  const eon = series(i, 'E.ON NEXT LTD')!;
  assert.equal(eon.amountKind, 'fixed');
  const pc = i.priceChanges.find((p) => p.label === 'E.ON NEXT LTD')!;
  assert.equal(pc.fromPence, 18492);
  assert.equal(pc.toPence, 21273);
});

test('22. the annual effect is given only when the cadence is known', () => {
  const i = run(household((add) => { for (const [d, a] of [['2026-02-11', -1000], ['2026-03-30', -1000], ['2026-05-02', -1000], ['2026-07-25', -1200], ['2026-08-01', -1200]] as const) add(tx(3, d, a, 'ODDCO SUBS')); }));
  const p = i.priceChanges.find((x) => x.label === 'ODDCO SUBS');
  // irregular gaps → not established → no price change offered at all; and where it is offered with no cadence the effect is null
  assert.equal(p, undefined);
  const s = i.recurring.find((x) => x.label === 'ODDCO SUBS');
  assert.ok(!s || s.cadence === null || s.state !== 'strong_pattern');
  // known cadence → ×12
  assert.equal(run(household()).priceChanges.find((x) => x.label === 'VIRGIN MEDIA PYMTS')!.annualEffectPence, 10920);
});

test('one extra payment between two regular ones does not break a four-weekly series (DWP)', () => {
  assert.deepEqual(assessCadence([28, 28, 28, 7, 21, 28]), { cadence: 'four_weekly', regular: true, skipped: 0, extra: 1 });
  assert.equal(assessCadence([28, 9, 9, 28]).regular, false); // two irregularities are not tolerated
});

test('income is never a "price change"; a moving salary is a variable series', () => {
  const i = run(household((add) => { for (const [d, a] of [['2026-05-29', 268085], ['2026-06-30', 260034], ['2026-07-31', 272499], ['2026-08-28', 313717], ['2026-09-30', 304334]] as const) add(tx(2, d, a, 'BIGCO PAYROLL')); }));
  assert.ok(!i.priceChanges.some((p) => p.label === 'BIGCO PAYROLL'));
  assert.equal(series(i, 'BIGCO PAYROLL')?.amountKind, 'variable');
});

// ── trends ──────────────────────────────────────────────────────────────────────────────────

test('23. trends compare the latest two consecutive complete months', () => {
  const i = run(household());
  const spend = i.trends.find((t) => t.measure === 'spending')!;
  assert.equal(spend.current, '2026-09');
  assert.equal(spend.previous, '2026-08');
  assert.notEqual(spend.state, 'insufficient_data');
});

test('24. a partial month is never compared', () => {
  const i = run(household());
  const oct = i.monthly.find((m) => m.month === '2026-10')!;
  assert.equal(oct.complete, false);
  assert.ok(!i.trends.some((t) => t.current === '2026-10' || t.previous === '2026-10'));
  // a feed gap inside September makes September partial too → August vs July
  const gap = household();
  gap.transactions = gap.transactions.filter((t) => !(t.account_id === 2 && t.date >= '2026-09-05' && t.date <= '2026-09-25'));
  const g = run(gap);
  assert.equal(g.monthly.find((m) => m.month === '2026-09')!.complete, false);
  assert.match(g.monthly.find((m) => m.month === '2026-09')!.coverageReasons.join(' '), /gap/);
  assert.equal(g.trends[0].current, '2026-08');
});

test('25. category trends need category coverage in both months', () => {
  const ok = run(household());
  assert.equal(ok.categoryTrends.available, true);
  const poor = run(household(undefined, { categorise: false }));
  assert.equal(poor.categoryTrends.available, false);
  assert.match(String(poor.categoryTrends.why), /need 70% in both/);
});

test('26. trend thresholds are deterministic at their boundaries', () => {
  assert.equal(trendState(115000, 100000), 'materially_up');      // +15% and +£150
  assert.equal(trendState(114900, 100000), 'slightly_up');
  assert.equal(trendState(105000, 100000), 'slightly_up');        // +5% and +£50
  assert.equal(trendState(104900, 100000), 'broadly_stable');
  assert.equal(trendState(13000, 10000), 'slightly_up');          // +30% but only £30: not material (needs £100)
  assert.equal(trendState(11600, 10000), 'broadly_stable');       // +16% but only £16: below the £25 slight floor
  assert.equal(trendState(85000, 100000), 'materially_down');
  assert.equal(trendState(95000, 100000), 'slightly_down');
  assert.equal(trendState(5000, 0), 'insufficient_data');
});

test('27. transfers do not affect the spending trend', () => {
  const a = run(household()).trends.find((t) => t.measure === 'spending')!;
  const b = run(household((add) => {
    const x = tx(2, '2026-09-12', -90000, 'To A/C 26688719 BILLS Via Mobile Xfer', { is_transfer: 1 });
    const y = tx(3, '2026-09-12', 90000, 'From A/C 26620871 JOINT ACCOUNT Via Mobile', { is_transfer: 1 });
    x.transfer_pair_id = y.id; y.transfer_pair_id = x.id; add(x); add(y);
  })).trends.find((t) => t.measure === 'spending')!;
  assert.equal(a.currentPence, b.currentPence);
  assert.equal(a.state, b.state);
});

// ── unusual spend ───────────────────────────────────────────────────────────────────────────

test('28. a large first-ever merchant can be flagged as unusual', () => {
  const i = run(household((add) => add(tx(2, '2026-09-20', -45000, card('2026-09-20', 'SOFA WORLD')))));
  const u = i.unusual.find((x) => x.merchantKey === 'SOFA WORLD')!;
  assert.equal(u.kind, 'unusual-merchant');
  assert.equal(u.explainedBy, null);
  assert.match(u.line, /^Unusual compared with your recorded history/);
});

test('29. an expected large item (a planned annual bill) is not listed as unusual', () => {
  const r = household((add) => add(tx(3, '2026-09-20', -48000, 'DIRECT INSURE CO')));
  r.planned = [{ id: 1, title: 'Car insurance renewal', kind: 'annual_bill', due_date: '2026-09-21', amount: -48000, account_id: 3, status: 'open', note: null }];
  const i = run(r);
  const u = i.unusual.find((x) => x.merchantKey === 'DIRECT INSURE CO')!;
  assert.match(String(u.explainedBy), /planned payment/);
  assert.ok(!toContract(i).unusual.items.some((x) => x.merchantKey === 'DIRECT INSURE CO'));
});

test('30. possible duplicates are conservative', () => {
  const i = run(household((add) => {
    add(tx(2, '2026-09-15', -2500, card('2026-09-15', 'CINEMA WORLD'))); add(tx(2, '2026-09-15', -2500, card('2026-09-15', 'CINEMA WORLD'))); // same purchase date → candidate
    add(tx(2, '2026-09-20', -2500, card('2026-09-19', 'CAFE NERO'))); add(tx(2, '2026-09-20', -2500, card('2026-09-20', 'CAFE NERO')));   // two purchase dates → two purchases
    add(tx(2, '2026-09-22', -1999, 'PIZZA PALACE', { balance_after: null })); add(tx(2, '2026-09-23', -1999, card('2026-09-22', 'PIZZA PALACE'))); // pending + settled
  }));
  const d = i.unusual.filter((x) => x.kind === 'possible-duplicate');
  assert.equal(d.length, 1);
  assert.equal(d[0].merchantKey, 'CINEMA WORLD');
  assert.match(d[0].line, /^Possible duplicate/);
});

test('31. no fraud wording anywhere', () => {
  const i = run(household((add) => { add(tx(2, '2026-09-20', -45000, card('2026-09-20', 'SOFA WORLD'))); add(tx(2, '2026-09-15', -2500, card('2026-09-15', 'CINEMA WORLD'))); add(tx(2, '2026-09-15', -2500, card('2026-09-15', 'CINEMA WORLD'))); }));
  const text = JSON.stringify(toContract(i)) + JSON.stringify(i.unusual);
  assert.doesNotMatch(text, /fraud|suspicious|scam|stolen|criminal/i);
  for (const f of ['anomalies.ts', 'contract.ts', 'cashflow.ts']) assert.doesNotMatch(readFileSync(new URL(`../src/server/intelligence/${f}`, import.meta.url), 'utf8').replace(/never fraud/g, ''), /fraud|suspicious/i, f);
});

test('32. Helen\'s merchant detail never reaches the contract; her totals do', () => {
  const i = run(household((add) => {
    add(tx(4, '2026-09-20', -60000, card('2026-09-20', 'HELENS BIG PURCHASE')));
    for (const d of ['2026-07-03', '2026-08-03', '2026-09-03']) add(tx(4, d, -1299, 'HELEN PRIVATE SUB'));
  }));
  assert.ok(i.unusual.some((u) => u.merchantKey === 'HELENS BIG PURCHASE'), 'Tally itself still sees it');
  const c = toContract(i);
  const json = JSON.stringify(c);
  for (const name of ['HELENS SECRET SHOP', 'HELENS BIG PURCHASE', 'HELEN PRIVATE SUB', 'HELEN GYM DD']) assert.ok(!json.includes(name), name);
  assert.ok(c.unusual.privateAccounts >= 1);
  assert.ok(c.recurring.privateAccounts >= 1);
  assert.equal(c.balances.accounts.find((a) => a.name === 'Helen')!.balancePence, null);
  assert.ok(c.monthly.months.find((m) => m.month === '2026-09')!.owners.othersOwnAccountsPence > 0, 'her spending is in the totals');
  assert.equal(c.balances.household.usableLiquidPence, i.balances.reduce((s, b) => s + b.balancePence, 0), 'her balance is inside the household total');
  assert.ok(c.balances.accounts.find((a) => a.name === 'Helen')!.inHouseholdTotalOnly);
});

// ── contract ────────────────────────────────────────────────────────────────────────────────

test('40. the contract is versioned', () => {
  const c = toContract(run(household()));
  assert.equal(c.contract, 'finance-intelligence-v1');
  assert.equal(CONTRACT, 'finance-intelligence-v1');
});

test('42. stale states stay explicit', () => {
  const c = toContract(run(household(undefined, { fresh: [1, 2, 3] })));
  const helen = c.sourceHealth.bankFeed.accounts.find((a) => a.name === 'Helen')!;
  assert.equal(helen.state, 'stale');
  assert.equal(c.sourceHealth.bankFeed.household, 'partial');
  assert.equal(c.balances.accounts.find((a) => a.name === 'Helen')!.fresh, false);
  assert.equal(c.cashflow.meta.freshness.state, 'partial');
});

test('43. every section explains itself and states its coverage', () => {
  const c = toContract(run(household())) as Record<string, any>;
  for (const k of ['sourceHealth', 'coverage', 'balances', 'cashflow', 'monthly', 'trends', 'categories', 'recurring', 'priceChanges', 'unusual', 'pressure', 'upcoming']) {
    const m = c[k].meta;
    assert.ok(m, `${k} has meta`);
    assert.equal(m.source, 'tally');
    assert.ok(Array.isArray(m.explanation) && m.explanation.length > 0, `${k} explanation`);
    assert.ok(typeof m.coverage === 'string' && m.coverage.length > 0, `${k} coverage`);
    assert.ok('freshness' in m && 'confidence' in m && 'period' in m, `${k} freshness/confidence/period`);
  }
});

test('44. source freshness is separate from calculation confidence', () => {
  // Every feed fresh, but nothing established yet → fresh data, unavailable forecast.
  const r = household();
  r.transactions = r.transactions.filter((t) => t.date >= '2026-09-20');
  const c = toContract(run(r));
  assert.equal(c.cashflow.meta.freshness.state, 'healthy');
  assert.equal(c.cashflow.meta.confidence, 'unavailable');
});

test('balances: freshness is the bank balance observation, and a stale one never counts as current', () => {
  const i = run(household(undefined, { fresh: [1, 2, 3] }));
  assert.equal(i.position.coverage, 'partial');
  assert.match(i.position.statement, /leaves out Helen/);
  assert.equal(i.position.usableLiquidPence, i.balances.filter((b) => b.fresh).reduce((a, b) => a + b.balancePence, 0));
});

test('instalments of different purchases are never a "price change"', () => {
  const i = run(household((add) => { for (const [d, a] of [['2026-05-05', -1786], ['2026-06-05', -1786], ['2026-07-05', -1786], ['2026-08-05', -1298], ['2026-09-05', -1298]] as const) add(tx(2, d, a, 'ZILCH INSTALMENT')); }));
  const s = i.recurring.find((x) => x.label === 'ZILCH INSTALMENT');
  assert.equal(s?.flow, 'financing');
  assert.ok(!i.priceChanges.some((p) => p.label === 'ZILCH INSTALMENT'));
});

test('two identical direct debits on one day are not called duplicates without card purchase dates', () => {
  const i = run(household((add) => { add(tx(3, '2026-09-21', -15800, 'N.W.L.D.C. GENERAL')); add(tx(3, '2026-09-21', -15800, 'N.W.L.D.C. GENERAL')); }));
  assert.ok(i.unusual.length >= 0 && i._rows.filter((t) => t.merchantKey === 'N.W.L.D.C. GENERAL' && t.type === 'spend').length === 2, 'positive control: both are spends');
  assert.ok(!i.unusual.some((u) => u.kind === 'possible-duplicate' && u.merchantKey === 'N.W.L.D.C. GENERAL'));
});
