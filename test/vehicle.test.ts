/**
 * Build 27 — vehicle finance in Tally. The car's costs are Tally's calculation; NEURO only reads them.
 * Fixtures copy the live shapes (9 Oct 2026): "1717 02OCT26 ZILCH SHELL GB GB", "CD SHELL TALBOT STREET
 * COALVILLE", Highcross car park, a Zilch instalment, a pending + settled copy of one fill.
 */
process.env.TALLY_DB_PATH = ':memory:';
process.env.TALLY_PRIMARY_OWNER = 'Nick';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose, type IntelRead } from '../src/server/intelligence/compose.ts';
import { toContract } from '../src/server/intelligence/contract.ts';
import { classify, hintFor, reviewGroups, ruleMatches, validateRule, BUCKET_OF, SPEND_TYPES, type VehicleDecision, type VehicleRule } from '../src/server/intelligence/vehicle.ts';
import { household, tx, card, cat, TODAY, NOW } from './fixtures/household.ts';

const CAR = 'vehicle:captur';
const run = (read: IntelRead) => compose(read, { now: NOW, today: TODAY });

/** A household that fills up at Shell every Saturday-ish, with a few motoring oddities. */
function withCar({ decisions = [] as VehicleDecision[], rules = [] as VehicleRule[], extras = (_add: any) => {} } = {}) {
  const ids: Record<string, number> = {};
  const read = household((add) => {
    const keep = (name: string, t: any) => { ids[name] = t.id; add(t); };
    for (let m = 1; m <= 9; m++) {
      const mm = String(m).padStart(2, '0');
      keep(`shell-${mm}`, tx(1, `2026-${mm}-06`, -4500, card(`2026-${mm}-06`, 'ZILCH SHELL GB')));
    }
    keep('talbot', tx(2, '2026-09-14', -2315, '4232 14SEP26 CD SHELL TALBOT STREET COALVILLE GB'));
    keep('carpark', tx(2, '2026-09-15', -400, '4297 15SEP26 CD HIGHCROSS CAR PARK0116 242 8644 GB'));
    keep('instalment', tx(1, '2026-09-20', -1125, 'ZILCH INSTALMENT'));
    keep('helen-fuel', tx(4, '2026-09-16', -3000, card('2026-09-16', 'ESSO ASHBY ROAD')));
    keep('crumbs', tx(2, '2026-09-17', -350, card('2026-09-17', 'CRUMBS 2GO'), cat('Fuel')));
    keep('rac', tx(2, '2026-08-03', -1450, 'RAC MOTORING SERVICES'));
    extras((t: any) => add(t));
  });
  read.vehicleDecisions = decisions.map((d) => ({ ...d, transactionId: typeof d.transactionId === 'string' ? ids[d.transactionId as any] : d.transactionId }));
  read.vehicleRules = rules;
  return { read, ids };
}
const shellRule: VehicleRule = { id: 1, matchKind: 'merchant', merchantKey: 'SHELL', categoryName: null, spendType: 'fuel', vehicleRef: CAR, active: true };

test('27C: nothing is the car\'s until a person says so — hints are only candidates', () => {
  const { read } = withCar();
  const v = run(read).vehicle;
  assert.equal(v.vehicles.length, 0, 'no vehicle spend without a decision or rule');
  assert.ok(v.review.pending >= 10, 'Shell, Talbot, car park, RAC and the Fuel-category row are offered');
  const c = toContract(run(read)).vehicleFinance;
  assert.equal(c.meta.confidence, 'unavailable');
});

test('27C: a confirmed rule counts at read time; a decision beats a rule; a not-vehicle stays out', () => {
  const { read, ids } = withCar({ rules: [shellRule] });
  read.vehicleDecisions = [{ transactionId: ids['shell-09'], decision: 'not_vehicle', spendType: null, vehicleRef: null, basis: 'confirmed-once', ruleId: null }];
  const v = run(read).vehicle;
  const car = v.vehicles.find((x) => x.vehicleRef === CAR)!;
  const sep = car.months.find((m) => m.month === '2026-09')!;
  assert.equal(sep.fuelSpendPence, 0, 'the September fill was said not to be the car — a decision beats the rule');
  const aug = car.months.find((m) => m.month === '2026-08')!;
  assert.equal(aug.fuelSpendPence, 4500);
  assert.equal(aug.totalVehicleSpendPence, 4500);
});

test('27C: the instalment is financing, Helen\'s fuel is never offered, CRUMBS in Fuel is only a candidate', () => {
  const { read, ids } = withCar();
  const k = classify(run(read)._rows, [], []);
  const offered = new Set(k.candidates.map((c) => c.row.id));
  assert.ok(!offered.has(ids.instalment), 'pay-later instalments are never motoring candidates');
  assert.ok(!offered.has(ids['helen-fuel']), 'someone else\'s own account is never offered for review');
  assert.ok(k.privateHinted >= 1, '…and is counted as not offered');
  assert.ok(offered.has(ids.crumbs), 'a category is evidence for a suggestion, never a classification');
});

test('27C: a car decision on Helen\'s account counts in totals; the contract carries no transaction', () => {
  const { read, ids } = withCar();
  read.vehicleDecisions = [{ transactionId: ids['helen-fuel'], decision: 'vehicle', spendType: 'fuel', vehicleRef: CAR, basis: 'confirmed-once', ruleId: null }];
  const c = toContract(run(read)).vehicleFinance;
  const sep = c.vehicles[0].months.find((m: any) => m.month === '2026-09');
  assert.equal(sep.fuelSpendPence, 3000);
  const text = JSON.stringify(c);
  for (const s of ['ESSO', 'ASHBY', 'SHELL', 'HIGHCROSS', 'description', 'merchantKey', '"rows"']) assert.ok(!text.includes(s), `contract must not carry ${s}`);
  assert.equal(c.reviewIn, 'Tally → Outlook → Motoring');
});

test('27Q: buckets — every spend type lands in exactly one contract bucket', () => {
  for (const t of SPEND_TYPES) assert.ok(BUCKET_OF[t], t);
  const { read, ids } = withCar();
  read.vehicleDecisions = [
    { transactionId: ids.rac, decision: 'vehicle', spendType: 'breakdown_cover', vehicleRef: CAR, basis: 'confirmed-once', ruleId: null },
    { transactionId: ids.carpark, decision: 'vehicle', spendType: 'parking', vehicleRef: CAR, basis: 'confirmed-once', ruleId: null },
    { transactionId: ids.talbot, decision: 'vehicle', spendType: 'fuel', vehicleRef: CAR, basis: 'confirmed-once', ruleId: null },
  ];
  const car = run(read).vehicle.vehicles[0];
  const sep = car.months.find((m) => m.month === '2026-09')!;
  assert.equal(sep.fuelSpendPence, 2315);
  assert.equal(sep.otherMotoringSpendPence, 400);
  assert.equal(sep.totalVehicleSpendPence, 2715);
  assert.equal(car.months.find((m) => m.month === '2026-08')!.breakdownSpendPence, 1450);
});

test('27C: a month with an unreviewed candidate is partial, and says why', () => {
  const { read } = withCar({ rules: [shellRule] });
  const car = run(read).vehicle.vehicles[0];
  const sep = car.months.find((m) => m.month === '2026-09')!;
  assert.equal(sep.ledgerComplete, true);
  assert.equal(sep.complete, false);
  assert.ok(sep.reasons.some((r) => /not yet reviewed/.test(r)));
  assert.equal(car.confidence, 'partial');
});

test('27C: windows need consecutive complete months; the trend needs six', () => {
  const { read, ids } = withCar({ rules: [shellRule] });
  // decide every other candidate as not the car, so every month is fully reviewed
  const k = classify(run(read)._rows, [], [shellRule]);
  read.vehicleDecisions = k.candidates.map((c) => ({ transactionId: c.row.id, decision: 'not_vehicle' as const, spendType: null, vehicleRef: null, basis: 'confirmed-once', ruleId: null }));
  const car = run(read).vehicle.vehicles[0];
  assert.equal(car.confidence, 'strong');
  assert.equal(car.last3CompleteMonths.available, true);
  assert.equal(car.last3CompleteMonths.fuelSpendPence, 13500);
  assert.equal(car.rolling12m.available, false, 'January to September is not twelve months');
  assert.match(String(car.rolling12m.why), /12 complete months/);
  assert.equal((car.trend as any).state, 'broadly_stable', 'the same fill every month is stable');
  void ids;
});

test('27C: a pending copy and its settled copy count once', () => {
  const { read } = withCar({
    rules: [shellRule],
    extras: (add: any) => {
      add(tx(1, '2026-09-27', -3333, 'ZILCH SHELL', { balance_after: null }));
      add(tx(1, '2026-09-27', -3333, card('2026-09-27', 'ZILCH SHELL GB')));
    },
  });
  const sep = run(read).vehicle.vehicles[0].months.find((m) => m.month === '2026-09')!;
  assert.equal(sep.fuelSpendPence, 4500 + 3333);
});

test('rules: exact keys only, validated', () => {
  assert.equal(validateRule({ matchKind: 'merchant', merchantKey: 'S', spendType: 'fuel' }), 'a merchant rule needs the exact merchant key');
  assert.equal(validateRule({ matchKind: 'merchant', merchantKey: 'SHELL', spendType: 'petrol' })?.startsWith('spendType'), true);
  const row: any = { merchantKey: 'SHELL TALBOT STREET COALVILLE', category: null };
  assert.equal(ruleMatches(shellRule, row), false, 'SHELL does not match SHELL TALBOT…');
  assert.equal(hintFor({ ...row, description: 'X' } as any)?.proposedType, 'fuel');
});

test('review groups are by merchant and carry the rows only for Tally\'s own list', () => {
  const { read } = withCar();
  const groups = reviewGroups(classify(run(read)._rows, [], []).candidates);
  const shell = groups.find((g) => g.merchantKey === 'SHELL')!;
  assert.equal(shell.count, 9);
  assert.equal(shell.totalPence, 9 * 4500);
});
