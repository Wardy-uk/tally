/**
 * Tally JWT secret — the Oct 2026 fix for the public 'dev-insecure-secret' fallback.
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import {
  resolveJwtSecret, JwtSecretError, INSECURE_DEV_SECRET, MIN_SECRET_LENGTH,
} from '../src/server/security/jwt-secret.ts';
import { signTokenWith, verifyTokenWith } from '../src/server/security/token.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOOD = 'a'.repeat(40) + 'B9';
const OTHER = 'z'.repeat(40) + 'Q1';
const USER = { id: 1, username: 'nickw', displayName: 'Nick', role: 'admin' as const };

test('a configured secret is used, settings before env', () => {
  assert.deepEqual(resolveJwtSecret({ configured: GOOD, env: OTHER, nodeEnv: 'production' }),
    { secret: GOOD, source: 'settings' });
  assert.deepEqual(resolveJwtSecret({ configured: null, env: OTHER, nodeEnv: 'production' }),
    { secret: OTHER, source: 'env' });
});

test('production refuses to run with no secret', () => {
  assert.throws(() => resolveJwtSecret({ configured: null, env: null, nodeEnv: 'production' }), JwtSecretError);
  assert.throws(() => resolveJwtSecret({ configured: '', env: '  ', nodeEnv: 'production' }), JwtSecretError);
});

test('NODE_ENV unset is NOT development — fails closed', () => {
  assert.throws(() => resolveJwtSecret({ configured: null, env: null, nodeEnv: null }), JwtSecretError);
  assert.throws(() => resolveJwtSecret({ configured: null, env: null, nodeEnv: 'staging' }), JwtSecretError);
});

test('production refuses the known insecure literal and short secrets', () => {
  assert.throws(() => resolveJwtSecret({ configured: INSECURE_DEV_SECRET, nodeEnv: 'production' }), /insecure/);
  assert.throws(() => resolveJwtSecret({ configured: 'x'.repeat(MIN_SECRET_LENGTH - 1), nodeEnv: 'production' }), /shorter/);
});

test('the dev fallback exists only in explicit development/test', () => {
  for (const nodeEnv of ['development', 'test']) {
    assert.deepEqual(resolveJwtSecret({ configured: null, env: null, nodeEnv }),
      { secret: INSECURE_DEV_SECRET, source: 'dev-fallback' });
  }
});

test('a refusal never echoes the secret', () => {
  try { resolveJwtSecret({ configured: 'short-but-secret', nodeEnv: 'production' }); assert.fail(); }
  catch (e: any) { assert.ok(!String(e.message).includes('short-but-secret')); }
});

test('rotation: a token signed with the old secret is rejected', () => {
  const old = signTokenWith(USER, INSECURE_DEV_SECRET);
  assert.equal(verifyTokenWith(old, GOOD), null);
  // positive control: it was a valid token under the secret that signed it
  assert.equal(verifyTokenWith(old, INSECURE_DEV_SECRET)?.username, 'nickw');
});

test('a valid token signed with the new secret is accepted', () => {
  const fresh = signTokenWith(USER, GOOD);
  assert.deepEqual(verifyTokenWith(fresh, GOOD), USER);
});

test('an unsigned (alg none) or other-algorithm token is rejected', () => {
  const none = jwt.sign({ ...USER }, '', { algorithm: 'none' as any });
  assert.equal(verifyTokenWith(none, GOOD), null);
  const hs512 = jwt.sign({ ...USER }, GOOD, { algorithm: 'HS512' });
  assert.equal(verifyTokenWith(hs512, GOOD), null);
});

function tmpSettings(obj: object): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-jwt-'));
  const p = path.join(dir, 'settings.json');
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}

function runTsx(args: string[], env: Record<string, string>) {
  const cleanEnv: Record<string, string> = { ...process.env as any };
  delete cleanEnv.JWT_SECRET;
  return spawnSync(process.execPath, [path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'), ...args], {
    cwd: ROOT, env: { ...cleanEnv, ...env }, encoding: 'utf-8', timeout: 30000,
  });
}

test('loadJwtSecret reads settings.json (real loader, child process)', () => {
  const code = "import {loadJwtSecret} from './src/server/security/jwt-secret.ts'; try { console.log('SOURCE=' + loadJwtSecret().source) } catch (e) { console.log('REFUSED=' + e.name) }";
  const ok = runTsx(['--eval', code], { NODE_ENV: 'production', TALLY_SETTINGS_PATH: tmpSettings({ jwt_secret: GOOD }) });
  assert.match(ok.stdout, /SOURCE=settings/);
  const refused = runTsx(['--eval', code], { NODE_ENV: 'production', TALLY_SETTINGS_PATH: tmpSettings({}) });
  assert.match(refused.stdout, /REFUSED=JwtSecretError/);
});

test('the real server entry refuses to start in production without a secret', () => {
  const r = runTsx(['--no-warnings', 'src/server/index.ts'], {
    NODE_ENV: 'production', TALLY_SETTINGS_PATH: tmpSettings({}), PORT: '0',
  });
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /FATAL: No jwt_secret configured/);
  assert.doesNotMatch(r.stdout, /api ready/);
});

test('source: the guard runs before the schema and the port; no literal fallback remains in auth', () => {
  const idx = fs.readFileSync(path.join(ROOT, 'src/server/index.ts'), 'utf-8');
  const guard = idx.indexOf('loadJwtSecret()');
  assert.ok(guard > 0, 'index.ts must call loadJwtSecret');
  assert.ok(guard < idx.indexOf('initSchema();'), 'guard before initSchema');
  assert.ok(guard < idx.indexOf('app.listen('), 'guard before listen');
  const auth = fs.readFileSync(path.join(ROOT, 'src/server/middleware/auth.ts'), 'utf-8');
  assert.ok(!auth.includes(INSECURE_DEV_SECRET), 'auth.ts must not carry the literal');
  assert.ok(auth.includes('loadJwtSecret'), 'positive control: auth resolves through the guard');
});
