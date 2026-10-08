import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fetchFromDate, relinkNewConnection } from '../src/server/services/truelayer-relink.ts';

const NOW = new Date('2026-10-08T12:00:00Z');

test('fetchFromDate: a synced account keeps its incremental window', () => {
  assert.equal(fetchFromDate({ lastSyncAt: '2026-06-27T12:11:47Z', latestTxDate: '2026-06-26', now: NOW }), '2026-06-25');
});

test('fetchFromDate: a reconnect starts from the newest stored transaction, beyond 90 days', () => {
  const from = fetchFromDate({ lastSyncAt: null, latestTxDate: '2026-06-26', now: NOW });
  assert.equal(from, '2026-06-24');
  // positive control: the old fixed lookback would have started in July and lost the gap
  assert.equal(fetchFromDate({ lastSyncAt: null, latestTxDate: null, now: NOW }), '2026-07-10');
});

function seed() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE truelayer_connections (id INTEGER PRIMARY KEY, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE truelayer_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, connection_id INTEGER, external_id TEXT,
      account_number TEXT, sort_code TEXT, linked_account_id INTEGER);
    INSERT INTO truelayer_connections (id) VALUES (1), (2);
    INSERT INTO truelayer_accounts (connection_id, external_id, account_number, sort_code, linked_account_id) VALUES
      (1,'a','11111111','600000',2),(1,'b','22222222','600000',3),(2,'c','44444444','600000',4);`);
  return db;
}

test('relink: every account matched -> linked to the same Tally account, old connection retired', () => {
  const db = seed();
  db.exec(`INSERT INTO truelayer_connections (id) VALUES (3);
    INSERT INTO truelayer_accounts (connection_id, external_id, account_number, sort_code) VALUES
      (3,'x','11111111','600000'),(3,'y','22222222','600000');`);
  const r = relinkNewConnection(db, 3);
  assert.deepEqual(r.relinked.map(x => x.tallyAccountId).sort(), [2, 3]);
  assert.deepEqual(r.retiredConnections, [1]);
  assert.equal((db.prepare('select active from truelayer_connections where id=2').get() as any).active, 1, "Helen's connection untouched");
});

test('relink: a partial reconnect retires nothing', () => {
  const db = seed();
  db.exec(`INSERT INTO truelayer_connections (id) VALUES (3);
    INSERT INTO truelayer_accounts (connection_id, external_id, account_number, sort_code) VALUES (3,'x','11111111','600000');`);
  const r = relinkNewConnection(db, 3);
  assert.equal(r.relinked.length, 1);
  assert.deepEqual(r.retiredConnections, []);
});

test('relink: sort code must match too, and an unknown account links nothing', () => {
  const db = seed();
  db.exec(`INSERT INTO truelayer_connections (id) VALUES (3);
    INSERT INTO truelayer_accounts (connection_id, external_id, account_number, sort_code) VALUES
      (3,'x','11111111','609999'),(3,'z','99999999','600000');`);
  assert.deepEqual(relinkNewConnection(db, 3), { relinked: [], retiredConnections: [] });
});
