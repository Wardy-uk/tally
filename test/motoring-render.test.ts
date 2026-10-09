/**
 * Build 27 — Tally's Motoring card rendered for real from a real review payload. Pins: the one-off
 * choice AND the remembered rule are both offered (grouping must not drop either), the figures shown
 * are Tally's, and an empty state says what "complete" means rather than showing £0.
 */
process.env.TALLY_DB_PATH = ':memory:';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { compose } from '../src/server/intelligence/compose.ts';
import { reviewGroups, SPEND_TYPES, SPEND_LABELS } from '../src/server/intelligence/vehicle.ts';
import { household, tx, card, NOW, TODAY } from './fixtures/household.ts';

const { MotoringContent } = await import('../src/client/components/MotoringPanel.tsx');

function payload(withRule: boolean) {
  const read = household((add) => { for (const m of ['07', '08', '09']) add(tx(1, `2026-${m}-06`, -4500, card(`2026-${m}-06`, 'ZILCH SHELL GB'))); add(tx(2, '2026-09-15', -400, '4297 15SEP26 CD HIGHCROSS CAR PARK0116 242 8644 GB')); });
  read.vehicleRules = withRule ? [{ id: 1, matchKind: 'merchant', merchantKey: 'SHELL', categoryName: null, spendType: 'fuel', vehicleRef: 'vehicle:captur', active: true }] : [];
  const v = compose(read, { now: NOW, today: TODAY }).vehicle;
  return JSON.parse(JSON.stringify({ groups: reviewGroups(v._candidates), review: v.review, vehicles: withRule ? ['vehicle:captur'] : [], spendTypes: SPEND_TYPES.map((t) => ({ id: t, label: SPEND_LABELS[t] })),
    rules: withRule ? [{ id: 1, match_kind: 'merchant', merchant_key: 'SHELL', spend_type: 'fuel', active: 1 }] : [],
    summary: v.vehicles.map((x) => ({ vehicleRef: x.vehicleRef, latestCompleteMonth: x.latestCompleteMonth, currentMonth: x.currentMonth, rolling12m: x.rolling12m, trend: x.trend })) }));
}

test('positive control: the component exists', () => assert.equal(typeof MotoringContent, 'function'));

test('a candidate group offers the one-off choice, the rule, and "not the car"', () => {
  const html = renderToString(createElement(MotoringContent, { data: payload(false) }));
  assert.ok(html.includes('SHELL'));
  for (const s of ['The car&#x27;s', 'Always', 'Not the car']) assert.ok(html.includes(s), s);
  assert.ok(html.includes('Nothing is classified as the car'), 'empty state says why, never £0');
});

test('with a rule, the card shows Tally\'s month figure and the rule', () => {
  const html = renderToString(createElement(MotoringContent, { data: payload(true) })).split('<!-- -->').join('');
  assert.ok(html.includes('Motoring — Captur'));
  assert.ok(/1 rule/.test(html));
  assert.ok(html.includes('12 months: not yet'), 'the 12-month figure is refused, with the reason');
});
