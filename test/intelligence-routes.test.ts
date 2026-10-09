/**
 * Build 26 — /api/intelligence over real HTTP, real auth, an in-memory database.
 * Pins: the contract is served to an authenticated caller; finance decisions are refused for the
 * service account another system uses (tally-api) and accepted from a person; a write drops the cache.
 */
process.env.TALLY_DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-intelligence-routes-0123456789';

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';

const { db } = await import('../src/server/db/schema.ts');
const { signToken } = await import('../src/server/middleware/auth.ts');
const { createIntelligenceRoutes } = await import('../src/server/routes/intelligence.ts');

db.exec(`INSERT INTO users (id, username, display_name, password_hash, role) VALUES (1, 'nickw', 'Nick', 'x', 'admin'), (3, 'tally-api', 'Tally MCP', 'x', 'user')`);
db.exec(`INSERT INTO accounts (id, name, type, owner_user_id, opening_balance, active, balance_observed_at) VALUES (2, 'Joint', 'current', NULL, 100000, 1, '2026-10-09T05:00:00Z')`);
const ins = db.prepare(`INSERT INTO transactions (account_id, date, amount, description, dedupe_hash, balance_after) VALUES (2, ?, ?, ?, ?, 1)`);
let h = 0;
for (const m of ['2026-06', '2026-07', '2026-08', '2026-09']) ins.run(`${m}-01`, -52500, 'MORTGAGE', `h${h++}`);

const app = express();
app.use(express.json());
app.use('/api/intelligence', createIntelligenceRoutes());
const server = app.listen(0);
after(() => server.close());
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/intelligence`;
const person = signToken({ id: 1, username: 'nickw', displayName: 'Nick', role: 'admin' });
const service = signToken({ id: 3, username: 'tally-api', displayName: 'Tally MCP', role: 'user' });
const call = (path: string, token: string | null, init: RequestInit = {}) =>
  fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });

test('the contract needs a login and answers finance-intelligence-v1', async () => {
  assert.equal((await call('/contract', null)).status, 401);
  const r = await call('/contract', service);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.data.contract, 'finance-intelligence-v1');
  assert.ok(!('_rows' in j.data));
});

test('the full view never ships the raw rows', async () => {
  const j = await (await call('/', person)).json();
  assert.ok(!('_rows' in j.data));
  assert.ok(Array.isArray(j.data.recurring));
});

test('a connected system cannot make finance decisions; a person can', async () => {
  const intel = await (await call('/', person)).json();
  const key = intel.data.recurring.find((s: any) => s.label === 'MORTGAGE').key;
  const refused = await call(`/recurring/${key}`, service, { method: 'POST', body: JSON.stringify({ decision: 'not_recurring' }) });
  assert.equal(refused.status, 403);
  assert.match((await refused.json()).error, /by a person/);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM recurring_decisions').get() as { n: number }).n, 0, 'nothing written');
  const planned = await call('/planned', service, { method: 'POST', body: JSON.stringify({ title: 'Car insurance', dueDate: '2026-11-01', amountPence: -48000 }) });
  assert.equal(planned.status, 403);

  const ok = await call(`/recurring/${key}`, person, { method: 'POST', body: JSON.stringify({ decision: 'recurring' }) });
  assert.equal(ok.status, 200);
  const after = await (await call('/', person)).json();
  assert.equal(after.data.recurring.find((s: any) => s.key === key).state, 'explicit_recurring', 'the write is visible at once (cache dropped)');
});

test('planned payments: validated, then they enter the forecast', async () => {
  assert.equal((await call('/planned', person, { method: 'POST', body: JSON.stringify({ title: 'x', dueDate: 'soon', amountPence: 1 }) })).status, 400);
  const r = await call('/planned', person, { method: 'POST', body: JSON.stringify({ title: 'Car insurance', dueDate: '2099-01-01', amountPence: -48000, kind: 'annual_bill' }) });
  assert.equal(r.status, 200);
  const c = await (await call('/contract', service)).json();
  assert.ok(c.data.upcoming.planned.some((p: any) => p.title === 'Car insurance' && p.amountPence === -48000));
});
