import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initSchema } from './db/schema.js';
import { createAuthRoutes } from './routes/auth.js';
import { createSettingsRoutes } from './routes/settings.js';
import { createAccountsRoutes } from './routes/accounts.js';
import { createCategoriesRoutes } from './routes/categories.js';
import { createTransactionsRoutes } from './routes/transactions.js';
import { createImportRoutes } from './routes/import.js';
import { createSalaryRoutes } from './routes/salary.js';
import { createRulesRoutes } from './routes/rules.js';
import { createAiRoutes } from './routes/ai.js';
import { createSubscriptionsRoutes } from './routes/subscriptions.js';
import { createDashboardRoutes } from './routes/dashboard.js';
import { createBudgetsRoutes } from './routes/budgets.js';
import { createInsightsRoutes } from './routes/insights.js';
import { createChatRoutes } from './routes/chat.js';
import { createTrueLayerRoutes } from './routes/truelayer.js';
import { createReceiptsRoutes } from './routes/receipts.js';
import { createBackupRoutes } from './routes/backup.js';
import { syncAllConnections } from './services/truelayer-sync.js';
import { createBackup, pruneBackups } from './services/backup-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

initSchema();

const app = express();
const PORT = Number(process.env.PORT ?? 3002);

// Optional path prefix for when running behind a reverse proxy that mounts us
// under a sub-path (e.g. Tailscale Serve /tally -> this server). Set via env.
// Example: API_PREFIX=/tally  ->  routes become /tally/api/*
const API_PREFIX = process.env.API_PREFIX ?? '';
const p = (route: string) => `${API_PREFIX}${route}`;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '25mb' }));

app.get(p('/api/health'), (_req, res) => {
  res.json({ ok: true, data: { status: 'ok', time: new Date().toISOString(), prefix: API_PREFIX } });
});

app.use(p('/api/auth'), createAuthRoutes());
app.use(p('/api/settings'), createSettingsRoutes());
app.use(p('/api/accounts'), createAccountsRoutes());
app.use(p('/api/categories'), createCategoriesRoutes());
app.use(p('/api/transactions'), createTransactionsRoutes());
app.use(p('/api/import'), createImportRoutes());
app.use(p('/api/salary'), createSalaryRoutes());
app.use(p('/api/rules'), createRulesRoutes());
app.use(p('/api/ai'), createAiRoutes());
app.use(p('/api/subscriptions'), createSubscriptionsRoutes());
app.use(p('/api/dashboard'), createDashboardRoutes());
app.use(p('/api/budgets'), createBudgetsRoutes());
app.use(p('/api/insights'), createInsightsRoutes());
app.use(p('/api/chat'), createChatRoutes());
app.use(p('/api/truelayer'), createTrueLayerRoutes());
app.use(p('/api/receipts'), createReceiptsRoutes());
app.use(p('/api/backup'), createBackupRoutes());

// Note: in production the frontend is hosted on Netlify and proxies /api/*
// calls back here, so the server does NOT serve static files.

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err);
  res.status(500).json({ ok: false, error: err.message ?? 'Internal error' });
});

app.listen(PORT, () => {
  console.log(`[tally] api ready on :${PORT}`);
});

// === Scheduled background jobs ===

// TrueLayer daily sync (every 6 hours)
setInterval(async () => {
  try {
    const result = await syncAllConnections();
    if (result.connections > 0) {
      console.log(`[tally] truelayer sync: ${result.imported} new, ${result.skipped} dupes across ${result.accounts} accounts`);
    }
  } catch (e: any) {
    console.warn('[tally] truelayer sync failed', e.message);
  }
}, 6 * 60 * 60 * 1000);

// Daily DB backup (every 24 hours)
setInterval(async () => {
  try {
    const file = await createBackup();
    await pruneBackups(14);
    console.log(`[tally] backup created: ${file}`);
  } catch (e: any) {
    console.warn('[tally] backup failed', e.message);
  }
}, 24 * 60 * 60 * 1000);

// Initial backup 30s after start
setTimeout(async () => {
  try {
    await createBackup();
    await pruneBackups(14);
  } catch {}
}, 30_000);
