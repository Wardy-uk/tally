/**
 * Build 26 — Tally's Outlook page, rendered for real (react-dom/server) from a real compose() payload.
 * A build proves the page compiles; this proves the sections draw from the data. Positive control: the
 * component is exported, so the test cannot pass by absence.
 */
process.env.TALLY_DB_PATH = ':memory:';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { compose } from '../src/server/intelligence/compose.ts';
import { household, tx, NOW, TODAY } from './fixtures/household.ts';

const { OutlookContent } = await import('../src/client/components/OutlookView.tsx');

const payload = (read = household()) => { const { _rows, ...rest } = compose(read, { now: NOW, today: TODAY }); return JSON.parse(JSON.stringify(rest)); };

test('positive control: the content component exists', () => {
  assert.equal(typeof OutlookContent, 'function');
});

test('the Outlook page renders every section from a real payload', () => {
  const html = renderToString(createElement(OutlookContent, { data: payload(household((add) => add(tx(2, '2026-09-20', -45000, '1717 20SEP26 SOFA WORLD GB')))) }));
  for (const s of ['Current position', 'Pressure', 'Sources', 'Next days', 'Monthly trend', 'Category trends', 'Recurring payments', 'Price changes', 'Unusual', 'Planned payments']) assert.ok(html.includes(s), s);
  assert.ok(html.includes('VIRGIN MEDIA PYMTS'), 'a recurring payment by name');
  assert.ok(html.includes('SOFA WORLD'), 'an unusual item');
  assert.ok(html.includes('never subtracted'), 'says day-to-day is not in the projection');
  assert.doesNotMatch(html, /fraud|suspicious/i);
});

test('an unavailable forecast says why instead of drawing numbers', () => {
  const r = household(undefined, { fresh: [] });
  const html = renderToString(createElement(OutlookContent, { data: payload(r) }));
  assert.ok(html.includes('unavailable confidence'));
  assert.ok(html.includes('No forward view'));
});
