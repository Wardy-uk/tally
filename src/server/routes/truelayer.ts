import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import {
  buildAuthUrl, exchangeCode, fetchAccounts, isConfigured,
} from '../services/truelayer-client.js';
import { syncAllConnections } from '../services/truelayer-sync.js';
import { db } from '../db/schema.js';

const pendingStates = new Map<string, { userId: number; createdAt: number }>();

// Clean old states every 10 min
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingStates) {
    if (now - v.createdAt > 10 * 60 * 1000) pendingStates.delete(k);
  }
}, 10 * 60 * 1000);

export function createTrueLayerRoutes() {
  const router = Router();

  router.get('/status', requireAuth, (_req, res) => {
    const connections = db.prepare(`
      SELECT id, provider_name, last_sync_at, created_at, active FROM truelayer_connections
      ORDER BY id DESC
    `).all();
    res.json({
      ok: true,
      data: {
        configured: isConfigured(),
        connections,
      },
    });
  });

  router.get('/auth-url', requireAuth, (req, res) => {
    if (!isConfigured()) {
      return res.status(400).json({ ok: false, error: 'TrueLayer client credentials not set in Settings' });
    }
    const state = crypto.randomBytes(16).toString('hex');
    pendingStates.set(state, { userId: req.user!.id, createdAt: Date.now() });
    res.json({ ok: true, data: { url: buildAuthUrl(state), state } });
  });

  // OAuth callback — NOT auth'd (called by browser redirect from TrueLayer)
  router.get('/callback', async (req, res) => {
    const { code, state, error: oauthError } = req.query as Record<string, string>;

    const frontendUrl = process.env.FRONTEND_URL ?? '';

    if (oauthError) {
      return res.redirect(`${frontendUrl}/?tl_error=${encodeURIComponent(oauthError)}`);
    }
    if (!code || !state || !pendingStates.has(state)) {
      return res.redirect(`${frontendUrl}/?tl_error=invalid_state`);
    }

    const pending = pendingStates.get(state)!;
    pendingStates.delete(state);

    try {
      const tokens = await exchangeCode(code);
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

      // Fetch accounts to label the connection
      const accounts = await fetchAccounts(tokens.access_token);
      const providerName = accounts[0]?.provider.display_name ?? 'Unknown';
      const providerId = accounts[0]?.provider.provider_id ?? null;

      const result = db.prepare(`
        INSERT INTO truelayer_connections
          (provider_id, provider_name, access_token, refresh_token, expires_at, scope, connected_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(providerId, providerName, tokens.access_token, tokens.refresh_token, expiresAt, tokens.scope, pending.userId);
      const connectionId = Number(result.lastInsertRowid);

      // Upsert each TrueLayer account
      const upsert = db.prepare(`
        INSERT OR IGNORE INTO truelayer_accounts
          (connection_id, external_id, display_name, account_type, currency, account_number, sort_code)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const a of accounts) {
        upsert.run(
          connectionId,
          a.account_id,
          a.display_name,
          a.account_type,
          a.currency,
          a.account_number?.number ?? a.account_number?.iban ?? null,
          a.account_number?.sort_code ?? null,
        );
      }

      res.redirect(`${frontendUrl}/?tl_connected=1`);
    } catch (e: any) {
      console.error('[truelayer callback]', e);
      res.redirect(`${frontendUrl}/?tl_error=${encodeURIComponent(e.message ?? 'exchange_failed')}`);
    }
  });

  router.get('/connections/:id/accounts', requireAuth, (req, res) => {
    const rows = db.prepare(`
      SELECT * FROM truelayer_accounts WHERE connection_id = ?
    `).all(Number(req.params.id));
    res.json({ ok: true, data: rows });
  });

  // Link a TrueLayer account to a Tally account
  router.post('/link', requireAuth, (req, res) => {
    const schema = z.object({
      truelayerAccountId: z.number().int(),
      tallyAccountId: z.number().int().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.message });
    db.prepare(`UPDATE truelayer_accounts SET linked_account_id = ? WHERE id = ?`)
      .run(parsed.data.tallyAccountId, parsed.data.truelayerAccountId);
    res.json({ ok: true, data: { linked: parsed.data.truelayerAccountId } });
  });

  router.post('/sync', requireAuth, async (_req, res) => {
    try {
      const result = await syncAllConnections();
      res.json({ ok: true, data: result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.delete('/connections/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    db.prepare(`DELETE FROM truelayer_connections WHERE id = ?`).run(id);
    res.json({ ok: true, data: { deleted: id } });
  });

  return router;
}
