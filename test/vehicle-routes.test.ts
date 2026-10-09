/**
 * Build 27 — /api/intelligence/vehicle/* over real HTTP, real auth, an in-memory database.
 * Pins: the review list (single transactions) is a person's only — the service account NEURO uses gets
 * 403; a decision by a person changes the contract's totals at once (cache dropped); the contract
 * carries vehicleFinance and no transaction text.
 */
process.env.TALLY_DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-vehicle-routes-0123456789abcdef';

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
const shell = Number(ins.run('2026-09-08', -2306, '1717 08SEP26 ZILCH SHELL GB GB', `h${h++}`).lastInsertRowid);
ins.run('2026-09-10', -2232, '1717 10SEP26 ZILCH SHELL GB GB', `h${h++}`);
ins.run('2026-09-12', -1200, '1717 12SEP26 TESCO STORES GB', `h${h++}`);

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
const post = (path: string, token: string, body: unknown) => call(path, token, { method: 'POST', body: JSON.stringify(body) });

test('the review list is a person\'s only; the connected system gets 403', async () => {
  assert.equal((await call('/vehicle/review', service)).status, 403);
  const r = await call('/vehicle/review', person);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.data.groups[0].merchantKey, 'SHELL');
  assert.equal(j.data.groups[0].count, 2);
});

test('a connected system cannot classify or make rules', async () => {
  assert.equal((await post(`/vehicle/decide/${shell}`, service, { decision: 'vehicle', spendType: 'fuel', vehicleRef: 'vehicle:captur' })).status, 403);
  assert.equal((await post('/vehicle/rules', service, { matchKind: 'merchant', merchantKey: 'SHELL', spendType: 'fuel' })).status, 403);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM vehicle_spend_decisions').get() as { n: number }).n, 0);
});

test('a person\'s rule changes the contract at once; the contract carries no transaction text', async () => {
  const before = (await (await call('/contract', service)).json()).data.vehicleFinance;
  assert.equal(before.vehicles.length, 0);
  const r = await post('/vehicle/rules', person, { matchKind: 'merchant', merchantKey: 'SHELL', spendType: 'fuel', vehicleRef: 'vehicle:captur' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).data.matches, 2);
  const after = (await (await call('/contract', service)).json()).data.vehicleFinance;
  const sep = after.vehicles[0].months.find((m: any) => m.month === '2026-09');
  assert.equal(sep.fuelSpendPence, 4538);
  assert.equal(after.vehicles[0].vehicleRef, 'vehicle:captur');
  assert.ok(!JSON.stringify(after).includes('SHELL'));
  assert.ok(!JSON.stringify(after).includes('TESCO'));
});

test('a decision beats the rule; bad input is refused, not normalised', async () => {
  assert.equal((await post(`/vehicle/decide/${shell}`, person, { decision: 'vehicle', spendType: 'petrol' })).status, 400);
  assert.equal((await post(`/vehicle/decide/${shell}`, person, { decision: 'maybe' })).status, 400);
  assert.equal((await post('/vehicle/decide/999999', person, { decision: 'not_vehicle' })).status, 404);
  assert.equal((await post(`/vehicle/decide/${shell}`, person, { decision: 'not_vehicle' })).status, 200);
  const c = (await (await call('/contract', service)).json()).data.vehicleFinance;
  assert.equal(c.vehicles[0].months.find((m: any) => m.month === '2026-09').fuelSpendPence, 2232);
  const ruleId = (db.prepare('SELECT id FROM vehicle_spend_rules').get() as { id: number }).id;
  assert.equal((await post(`/vehicle/rules/${ruleId}/retire`, person, {})).status, 200);
  const c2 = (await (await call('/contract', service)).json()).data.vehicleFinance;
  assert.equal(c2.vehicles.length, 0, 'retiring the rule stops it counting; the not-the-car decision counts nothing');
});
