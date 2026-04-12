import { Settings } from '../db/settings-store.js';
import { db } from '../db/schema.js';

/**
 * TrueLayer Data API client. Supports live + sandbox.
 * Register an app at https://console.truelayer.com — you'll need:
 *   - client_id, client_secret
 *   - redirect URI (set to http://localhost:3002/api/truelayer/callback for dev)
 *   - Sandbox mode on until you go live
 */

export interface TlTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: 'Bearer';
}

export interface TlAccount {
  account_id: string;
  account_type: string;
  display_name: string;
  currency: string;
  account_number: {
    iban?: string;
    number?: string;
    sort_code?: string;
  };
  provider: {
    display_name: string;
    provider_id: string;
  };
}

export interface TlTransaction {
  transaction_id: string;
  timestamp: string; // ISO
  description: string;
  amount: number;
  currency: string;
  transaction_type: 'DEBIT' | 'CREDIT';
  transaction_category: string;
  transaction_classification: string[];
  merchant_name?: string;
  running_balance?: { amount: number; currency: string };
}

function config() {
  const useSandbox = Settings.get<boolean>('truelayer_sandbox', true);
  return {
    clientId: Settings.get<string>('truelayer_client_id') ?? '',
    clientSecret: Settings.get<string>('truelayer_client_secret') ?? '',
    redirectUri: Settings.get<string>('truelayer_redirect_uri') ?? 'http://localhost:3002/api/truelayer/callback',
    authHost: useSandbox ? 'https://auth.truelayer-sandbox.com' : 'https://auth.truelayer.com',
    apiHost: useSandbox ? 'https://api.truelayer-sandbox.com' : 'https://api.truelayer.com',
    sandbox: useSandbox,
  };
}

export function isConfigured(): boolean {
  const c = config();
  return !!c.clientId && !!c.clientSecret;
}

export function buildAuthUrl(state: string): string {
  const c = config();
  const providers = c.sandbox
    ? 'uk-cs-mock uk-ob-all uk-oauth-all'
    : 'uk-ob-all uk-oauth-all';

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: c.clientId,
    scope: 'info accounts balance transactions offline_access',
    redirect_uri: c.redirectUri,
    providers,
    state,
  });
  return `${c.authHost}/?${params}`;
}

export async function exchangeCode(code: string): Promise<TlTokens> {
  const c = config();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: c.clientId,
    client_secret: c.clientSecret,
    redirect_uri: c.redirectUri,
    code,
  });
  const res = await fetch(`${c.authHost}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`TrueLayer token exchange failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<TlTokens>;
}

export async function refreshTokens(refreshToken: string): Promise<TlTokens> {
  const c = config();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: c.clientId,
    client_secret: c.clientSecret,
    refresh_token: refreshToken,
  });
  const res = await fetch(`${c.authHost}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`TrueLayer refresh failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<TlTokens>;
}

async function apiGet<T>(path: string, accessToken: string): Promise<T> {
  const c = config();
  const res = await fetch(`${c.apiHost}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`TrueLayer API ${path} failed: ${res.status} ${await res.text()}`);
  const json = await res.json() as { results: T };
  return json.results;
}

export function fetchAccounts(accessToken: string): Promise<TlAccount[]> {
  return apiGet<TlAccount[]>('/data/v1/accounts', accessToken);
}

export function fetchTransactions(
  accessToken: string,
  accountId: string,
  from?: string,
  to?: string,
): Promise<TlTransaction[]> {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const path = `/data/v1/accounts/${accountId}/transactions${qs.toString() ? `?${qs}` : ''}`;
  return apiGet<TlTransaction[]>(path, accessToken);
}

/** Get a valid access token for the connection, refreshing if near expiry. */
export async function ensureFreshToken(connectionId: number): Promise<string> {
  const row = db.prepare(`SELECT * FROM truelayer_connections WHERE id = ?`).get(connectionId) as any;
  if (!row) throw new Error('Connection not found');

  const expiresAt = new Date(row.expires_at).getTime();
  const now = Date.now();
  const bufferMs = 60_000; // refresh if <1min left

  if (expiresAt - now > bufferMs) return row.access_token;

  const fresh = await refreshTokens(row.refresh_token);
  const newExpiresAt = new Date(now + fresh.expires_in * 1000).toISOString();
  // TrueLayer's refresh response doesn't always include scope/refresh_token — keep existing values as fallback.
  db.prepare(`
    UPDATE truelayer_connections
    SET access_token = ?, refresh_token = ?, expires_at = ?, scope = ?
    WHERE id = ?
  `).run(
    fresh.access_token,
    fresh.refresh_token ?? row.refresh_token,
    newExpiresAt,
    fresh.scope ?? row.scope ?? null,
    connectionId,
  );
  return fresh.access_token;
}
