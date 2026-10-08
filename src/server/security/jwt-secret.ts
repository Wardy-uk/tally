/**
 * Where Tally's JWT signing secret comes from — and when it refuses.
 *
 * Until Oct 2026 the server fell back to the literal 'dev-insecure-secret' whenever
 * no secret was configured. Production on pi-dev had none configured, the repo is
 * public, and the API is on the internet behind Tailscale Funnel — so anyone could
 * mint a valid admin token. This module exists so that can never happen silently again.
 *
 * Rules:
 *   - A configured secret (settings.json `jwt_secret`, else env JWT_SECRET) wins.
 *   - The insecure literal is ONLY allowed when NODE_ENV is explicitly
 *     'development' or 'test'. Anything else — including NODE_ENV unset — refuses,
 *     because a pm2 config that loses its env must fail closed, not fall open.
 *   - Outside dev/test a configured secret must be at least MIN_SECRET_LENGTH chars
 *     and must not BE the insecure literal.
 *
 * Deliberately imports nothing that opens the database, so it can be checked
 * before anything else starts and tested without a DB.
 */
import { Settings } from '../db/settings-store.js';

export const INSECURE_DEV_SECRET = 'dev-insecure-secret';
export const MIN_SECRET_LENGTH = 32;
const DEV_MODES = new Set(['development', 'test']);

export class JwtSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JwtSecretError';
  }
}

export interface SecretInputs {
  configured?: string | null;
  env?: string | null;
  nodeEnv?: string | null;
}

export interface ResolvedSecret {
  secret: string;
  source: 'settings' | 'env' | 'dev-fallback';
}

function clean(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** Pure. Never logs or returns anything but the decision. */
export function resolveJwtSecret({ configured, env, nodeEnv }: SecretInputs): ResolvedSecret {
  const devMode = DEV_MODES.has(String(nodeEnv ?? ''));
  const fromSettings = clean(configured);
  const fromEnv = clean(env);
  const secret = fromSettings ?? fromEnv;
  const source = fromSettings ? 'settings' : 'env';

  if (secret) {
    if (!devMode) {
      if (secret === INSECURE_DEV_SECRET) {
        throw new JwtSecretError(
          `jwt_secret is the known insecure development value; refusing to start (NODE_ENV=${nodeEnv ?? 'unset'}).`,
        );
      }
      if (secret.length < MIN_SECRET_LENGTH) {
        throw new JwtSecretError(
          `jwt_secret is shorter than ${MIN_SECRET_LENGTH} characters; refusing to start (NODE_ENV=${nodeEnv ?? 'unset'}).`,
        );
      }
    }
    return { secret, source };
  }

  if (devMode) return { secret: INSECURE_DEV_SECRET, source: 'dev-fallback' };

  throw new JwtSecretError(
    `No jwt_secret configured (settings.json "jwt_secret" or env JWT_SECRET) and NODE_ENV=${nodeEnv ?? 'unset'} ` +
      `is not development/test. Refusing to start rather than sign tokens with a public fallback.`,
  );
}

let cached: ResolvedSecret | null = null;

/** Reads settings.json + env once per process. Throws JwtSecretError when it must refuse. */
export function loadJwtSecret(): ResolvedSecret {
  if (cached) return cached;
  cached = resolveJwtSecret({
    configured: Settings.get<string>('jwt_secret') ?? null,
    env: process.env.JWT_SECRET ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
  });
  return cached;
}
