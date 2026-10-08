/**
 * Categorisation rules key on stable merchant identity — never date, card or amount.
 * Run: npm test
 */
process.env.TALLY_DB_PATH = ':memory:';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merchantIdentity } from '../src/server/services/merchant.ts';
import { unsafeRuleReason, orderRules, findRuleForTx, type RuleLike } from '../src/server/services/rule-policy.ts';
import { planMigration, type PlanTx, type PlanRule } from '../src/server/services/rule-migration.ts';

const { db } = await import('../src/server/db/schema.ts');
const { applyRulesToTxIds, applyRulesToBacklog, invalidateRuleCache } = await import('../src/server/services/rules-engine.ts');

const GROCERIES = 4, EATING_OUT = 5, FUEL = 7, BILLS = 8, SHOPPING = 12, TRANSFER = 3, UNCATEGORISED = 19;

let nextId = 1;
const tx = (description: string, over: Partial<PlanTx> = {}): PlanTx => ({
  id: nextId++, date: '2026-04-09', account_id: 2, amount: -1000, description, merchant: null,
  category_id: null, is_transfer: 0, ...over,
});
const rule = (match_value: string, category_id: number, over: Partial<PlanRule> = {}): PlanRule => ({
  id: nextId++, name: `Auto: ${match_value}`, match_field: 'description', match_type: 'contains',
  match_value, category_id, priority: 100, ...over,
});
const merchantRule = (key: string, category_id: number): RuleLike =>
  ({ id: nextId++, match_field: 'merchant_key', match_type: 'equals', match_value: key, category_id, priority: 100 });

// ---------------------------------------------------------------- merchant identity

test('1. same merchant on different dates and cards matches the same rule', () => {
  const r = orderRules([merchantRule('W M MORRISONPLC', GROCERIES)]);
  for (const d of ['1717 09APR26 ZILCH W M MORRISONPLC GB GB', '1717 18JAN26 ZILCH W M MORRISONPLC GB GB', '5494 02JUN26 ZILCH W M MORRISONPLC GB GB']) {
    assert.equal(findRuleForTx(tx(d), r)?.category_id, GROCERIES, d);
  }
});

test('2+3. different merchant on the same card/date does not inherit the category', () => {
  const r = orderRules([merchantRule('W M MORRISONPLC', GROCERIES)]);
  assert.equal(findRuleForTx(tx('1717 09APR26 ZILCH WHITWICK FRYER GB GB'), r), null);
  assert.equal(findRuleForTx(tx('1717 09APR26 ZILCH CENTRAL ENGLAND GB GB'), r), null);
  // the old card+date key is refused outright
  assert.match(unsafeRuleReason({ match_field: 'description', match_type: 'contains', match_value: '1717 09APR26' })!, /card number \+ date/);
});

test('4. card-terminal noise is stripped without merging distinct merchants', () => {
  assert.equal(merchantIdentity('9913 03APR26 AMZNMKTPLAC E*NB8W09HN4 LONDON GB').key, 'AMZNMKTPLAC');
  assert.equal(merchantIdentity('5494 25MAY26 AMZNMKTPLAC E*NO3U05UL4 LONDON GB').key, 'AMZNMKTPLAC');
  assert.equal(merchantIdentity('4297 07MAR26 CD CENTRAL CO-OP RETALE67 5DT GB').key, 'CENTRAL CO-OP');
  assert.equal(merchantIdentity('1155 27FEB26 D MCDONALDS 8260564 DERBYSHIRE GB').key, 'MCDONALDS');
  assert.equal(merchantIdentity('1717 22MAY26 ZILCH KFC - COALVILLE GB GB').key, 'KFC COALVILLE');
  assert.equal(merchantIdentity('1717 21MAR26 OPENAI *CHATGPT SUBSCR SAN FRANCISCO US USD 24.00VRATE 1.3296N-S TRN FEE 0.50').key,
    'OPENAI *CHATGPT SUBSCR SAN FRANCISCO');
  assert.equal(merchantIdentity('CAPITAL ONE D074B73B-D2B9-454DTPP HSBC UK BANK PFP 20/03/26 10 36083614133178000N').key, 'CAPITAL ONE');
  assert.equal(merchantIdentity('To A/C 26620871 JOINT ACCOUNT Via Mobile Xfer').key, 'TO A/C 26620871');
  assert.equal(merchantIdentity('28JUL A/C 26688719').key, 'A/C 26688719');
  // similar-looking but distinct merchants stay distinct
  assert.notEqual(merchantIdentity('1717 31JUL26 ZILCH MORRISONS DERBY GB GB').key, merchantIdentity('1717 09APR26 ZILCH W M MORRISONPLC GB GB').key);
  assert.notEqual(merchantIdentity('SKY TV').key, merchantIdentity('SKY MOBILE').key);
  // a "D&G" merchant is not mistaken for the "D" channel code
  assert.equal(merchantIdentity('D&G APPLIANCE').key, 'D&G APPLIANCE');
});

test('provider-supplied merchant name beats parsed text', () => {
  assert.equal(merchantIdentity('1717 09APR26 SOMETHING', 'Tesco Stores').key, 'TESCO STORES');
});

// ---------------------------------------------------------------- policy

test('9. broad text substring rules are rejected', () => {
  assert.ok(unsafeRuleReason({ match_field: 'description', match_type: 'contains', match_value: 'O2' }));
  assert.ok(unsafeRuleReason({ match_field: 'description', match_type: 'contains', match_value: 'GENERAL' }));
  assert.ok(unsafeRuleReason({ match_field: 'description', match_type: 'contains', match_value: 'ZILCH' }));
  assert.equal(unsafeRuleReason({ match_field: 'description', match_type: 'contains', match_value: 'SPECSAVERS' }), null);
});

test('10. amount-only rules are rejected', () => {
  assert.match(unsafeRuleReason({ match_field: 'amount', match_type: 'equals', match_value: '-1599' })!, /amount/);
  assert.ok(unsafeRuleReason({ match_field: 'description', match_type: 'contains', match_value: '15.99' }));
});

test('11. date-only rules are rejected', () => {
  for (const v of ['27FEB', '27MAR', 'BMACH 12APR', '20/03/26']) {
    assert.match(unsafeRuleReason({ match_field: 'description', match_type: 'contains', match_value: v })!, /date/, v);
  }
});

test('unsafe legacy rules are ignored by the engine, safe ones still apply', () => {
  const r = orderRules([rule('1717 09APR26', FUEL) as RuleLike, rule('SPECSAVERS', 13) as RuleLike]);
  assert.equal(r.length, 1);
  assert.equal(findRuleForTx(tx('1717 09APR26 ZILCH CRUMBS 2GO LTD GB GB'), r), null);
  assert.equal(findRuleForTx(tx('9913 01MAY26 SPECSAVERS COALVILLE GB'), r)?.category_id, 13);
});

// ---------------------------------------------------------------- migration planning

test('5. conflicting merchant history blocks automatic migration', () => {
  nextId = 100;
  const bad = rule('1717 09APR26', GROCERIES);
  const swept = tx('1717 09APR26 ZILCH W M MORRISONPLC GB GB', { category_id: GROCERIES });
  // independent history says Morrisons is Shopping on two other days
  const other1 = tx('1717 01MAY26 ZILCH W M MORRISONPLC GB GB', { category_id: SHOPPING });
  const other2 = tx('1717 02MAY26 ZILCH W M MORRISONPLC GB GB', { category_id: SHOPPING });
  const plan = planMigration([bad], [swept, other1, other2]);
  const a = plan.audits.find(a => a.rule.id === bad.id)!;
  assert.equal(a.migration!.state, 'needs_confirmation');
  assert.equal(plan.newRules.length, 0);
});

test('mixed-merchant card/date cluster: no merchant rule, unproven sweeps flagged not guessed', () => {
  const bad = rule('1717 27MAY26', FUEL);
  const crumbs = tx('1717 27MAY26 ZILCH CRUMBS 2GO LTD GB GB', { category_id: FUEL });
  const shell = tx('1717 27MAY26 SHELL COALVILLE GB', { category_id: FUEL });
  const shellHistory = tx('1717 01JUN26 SHELL COALVILLE GB', { category_id: FUEL });
  const plan = planMigration([bad], [crumbs, shell, shellHistory]);
  assert.equal(plan.audits.find(a => a.rule.id === bad.id)!.migration!.state, 'needs_confirmation');
  const byTx = new Map(plan.txDecisions.map(d => [d.txId, d]));
  assert.equal(byTx.get(shell.id)!.outcome, 'keep', 'Shell history independently agrees');
  assert.equal(byTx.get(crumbs.id)!.outcome, 'uncategorise_unproven', 'Crumbs as Fuel cannot be proven');
});

test('8 (planning). a clear single-merchant decision migrates to a merchant rule', () => {
  const bad = rule('1717 09APR26', GROCERIES);
  const t = tx('1717 09APR26 ZILCH W M MORRISONPLC GB GB', { category_id: GROCERIES });
  const blank = tx('1717 20APR26 ZILCH W M MORRISONPLC GB GB');
  const plan = planMigration([bad], [t, blank]);
  assert.deepEqual(plan.newRules.map(n => [n.merchantKey, n.categoryId]), [['W M MORRISONPLC', GROCERIES]]);
  assert.deepEqual(plan.newlyCategorised.map(n => n.txId), [blank.id]);
});

test('6. a transaction-specific exception stays transaction-specific', () => {
  const bad = rule('1717 01APR26', BILLS);
  const inst = tx('1717 01APR26 ZILCH INSTALMENT GB GB', { category_id: BILLS });
  const laterInst = tx('1717 01MAY26 ZILCH INSTALMENT GB GB');
  const plan = planMigration([bad], [inst, laterInst]);
  assert.equal(plan.audits[0].migration!.state, 'transaction_specific');
  assert.equal(plan.txDecisions[0].outcome, 'keep');
  assert.equal(plan.newRules.length, 0);
  assert.equal(plan.newlyCategorised.length, 0, 'other instalments are not swept');
});

test('7. Zilch does not become one global category', () => {
  const a = merchantIdentity('1717 09APR26 ZILCH W M MORRISONPLC GB GB');
  const b = merchantIdentity('1717 09APR26 ZILCH WHITWICK FRYER GB GB');
  const c = merchantIdentity('1717 14JAN26 ZILCH INSTALMENT GB GB');
  const d = merchantIdentity('ZILCH INSTALMENT');
  assert.equal(a.wrapper, 'ZILCH');
  assert.notEqual(a.key, b.key);
  assert.ok(!a.key!.includes('ZILCH'), 'underlying merchant is the identity');
  assert.ok(c.wrapperOnly && d.wrapperOnly);
  assert.equal(c.key, d.key);
});

test('14. historical totals unchanged; only labels move', () => {
  const bad = rule('1717 27MAY26', FUEL);
  const txs = [
    tx('1717 27MAY26 ZILCH CRUMBS 2GO LTD GB GB', { category_id: FUEL, date: '2026-05-27' }),
    tx('1717 27MAY26 SHELL COALVILLE GB', { category_id: FUEL, date: '2026-05-27' }),
    tx('SKY TV', { category_id: BILLS, date: '2026-05-01', amount: -10149 }),
  ];
  const plan = planMigration([bad], txs);
  assert.equal(plan.before.spendingPence, plan.after.spendingPence);
  assert.equal(plan.before.spendingTx, plan.after.spendingTx);
  assert.ok(plan.after.usablePence <= plan.before.usablePence, 'unproven labels come off, not invented');
});

test('Uncategorised category does not count as usable coverage', () => {
  const plan = planMigration([], [tx('X SHOP', { category_id: UNCATEGORISED }), tx('Y SHOP', { category_id: SHOPPING })], { uncategorisedId: UNCATEGORISED });
  assert.equal(plan.before.usableTx, 1);
});

// ---------------------------------------------------------------- engine against the real schema

function insertTx(over: Record<string, unknown> = {}): number {
  const t = { account_id: 2, date: '2026-04-09', amount: -1000, description: 'X', category_id: null, is_transfer: 0, ...over };
  const r = db.prepare(`INSERT INTO transactions (account_id, date, amount, description, category_id, is_transfer, dedupe_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(t.account_id as number, t.date as string, t.amount as number, t.description as string,
    t.category_id as number | null, t.is_transfer as number, `h${Math.random()}`);
  return Number(r.lastInsertRowid);
}
const row = (id: number) => db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as any;

db.exec(`INSERT INTO accounts (id, name, type) VALUES (2, 'Joint', 'current'), (4, 'Helen', 'current')`);

test('8 (engine). user-confirmed merchant rule categorises future imports and records provenance', () => {
  db.exec(`DELETE FROM rules`);
  db.prepare(`INSERT INTO rules (name, match_field, match_type, match_value, category_id, source) VALUES ('Merchant: WHITWICK FRYER', 'merchant_key', 'equals', 'WHITWICK FRYER', ?, 'user_confirmed')`).run(EATING_OUT);
  invalidateRuleCache();
  const later = insertTx({ description: '1717 03OCT26 ZILCH WHITWICK FRYER GB GB', date: '2026-10-03' });
  const sameDayOther = insertTx({ description: '1717 03OCT26 ZILCH CENTRAL ENGLAND GB GB', date: '2026-10-03' });
  applyRulesToTxIds([later, sameDayOther]);
  assert.equal(row(later).category_id, EATING_OUT);
  assert.equal(row(later).category_source, 'rule');
  assert.ok(row(later).category_rule_id);
  assert.equal(row(sameDayOther).category_id, null);
});

test('retired and unsafe rules never fire', () => {
  db.exec(`DELETE FROM rules`);
  db.prepare(`INSERT INTO rules (name, match_field, match_type, match_value, category_id) VALUES ('Auto: 1717 05OCT26', 'description', 'contains', '1717 05OCT26', ?)`).run(FUEL);
  db.prepare(`INSERT INTO rules (name, match_field, match_type, match_value, category_id, active) VALUES ('old', 'merchant_key', 'equals', 'SHELL COALVILLE', ?, 0)`).run(FUEL);
  invalidateRuleCache();
  const a = insertTx({ description: '1717 05OCT26 ZILCH CRUMBS 2GO LTD GB GB' });
  const b = insertTx({ description: '1717 05OCT26 SHELL COALVILLE GB' });
  applyRulesToTxIds([a, b]);
  assert.equal(row(a).category_id, null);
  assert.equal(row(b).category_id, null);
});

test('12+13. transfers, refunds and settled rows: rules change category only', () => {
  db.exec(`DELETE FROM rules`);
  db.prepare(`INSERT INTO rules (name, match_field, match_type, match_value, category_id) VALUES ('m', 'merchant_key', 'equals', 'AMZNMKTPLAC', ?)`).run(SHOPPING);
  invalidateRuleCache();
  const transfer = insertTx({ description: 'To A/C 26620871 JOINT ACCOUNT Via Mobile Xfer', is_transfer: 1, category_id: TRANSFER });
  const purchase = insertTx({ description: '5494 25MAY26 AMZNMKTPLAC E*NO3U05UL4 LONDON GB', amount: -1594 });
  const refund = insertTx({ description: '5494 30MAY26 AMZNMKTPLAC E*ZZ9Q11AA1 LONDON GB', amount: 1594 });
  const before = [transfer, purchase, refund].map(row);
  applyRulesToBacklog();
  const after = [transfer, purchase, refund].map(row);
  assert.equal(after[0].category_id, TRANSFER, 'transfer untouched');
  assert.equal(after[0].is_transfer, 1);
  assert.equal(after[1].category_id, SHOPPING);
  assert.equal(after[2].category_id, SHOPPING, 'refund lands in the same category, offsetting spend');
  for (let i = 0; i < 3; i++) {
    for (const f of ['amount', 'date', 'account_id', 'is_transfer', 'transfer_pair_id', 'dedupe_hash', 'description']) {
      assert.equal(after[i][f], before[i][f], `${f} unchanged`);
    }
  }
});

test('15. no household ownership leakage: account attribution never changes', () => {
  db.exec(`DELETE FROM rules`);
  db.prepare(`INSERT INTO rules (name, match_field, match_type, match_value, category_id) VALUES ('m', 'merchant_key', 'equals', 'MY JUNIPER LONDON', 13)`).run();
  invalidateRuleCache();
  const helen = insertTx({ account_id: 4, description: '9913 19JUN26 MY JUNIPER LONDON GB' });
  applyRulesToBacklog();
  assert.equal(row(helen).account_id, 4);
  assert.equal(row(helen).category_id, 13);
});

test('older categories left in a card/date cluster by earlier rule states are scrutinised too', () => {
  const bad = rule('1717 21MAY26', 11); // rule now says Subscriptions (last click: Fasthosts)
  const fasthosts = tx('1717 21MAY26 FASTHOSTS GB', { category_id: 11 });
  const asdaPetrol = tx('1717 21MAY26 ASDA PETROL GB', { category_id: EATING_OUT });
  const fryer = tx('1717 21MAY26 ZILCH WHITWICK FRYER GB GB', { category_id: EATING_OUT });
  const byTx = new Map(planMigration([bad], [fasthosts, asdaPetrol, fryer]).txDecisions.map(d => [d.txId, d.outcome]));
  assert.equal(byTx.get(fasthosts.id), 'keep');
  assert.equal(byTx.get(asdaPetrol.id), 'uncategorise_unproven', 'Asda petrol as Eating Out was a sweep, not a decision');
  assert.equal(byTx.get(fryer.id), 'uncategorise_unproven');
});

test('short real merchant names like O2 get an exact key', () => {
  assert.equal(merchantIdentity('O2').key, 'O2');
  assert.equal(merchantIdentity('1717 01MAY26 C GB').key, null);
});

test('a short legacy rule migrates to its origin merchant; incidental substring hits do not', () => {
  const bad = rule('O2', BILLS);
  const bills = [tx('O2', { category_id: BILLS }), tx('O2', { category_id: BILLS, date: '2026-05-09' })];
  const stray = tx('5494 25MAY26 AMZNMKTPLAC E*NO2XYZ9Q1 LONDON GB', { category_id: BILLS });
  const plan = planMigration([bad], [...bills, stray]);
  assert.deepEqual(plan.newRules.map(n => [n.merchantKey, n.categoryId]), [['O2', BILLS]]);
  const byTx = new Map(plan.txDecisions.map(d => [d.txId, d.outcome]));
  assert.equal(byTx.get(bills[0].id), 'keep');
  assert.equal(byTx.get(stray.id), 'uncategorise_unproven', 'a substring hit got its label by sweep, not a click');
});
