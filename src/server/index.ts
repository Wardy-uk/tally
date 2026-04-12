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

app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, data: { status: 'ok', time: new Date().toISOString() } });
});

app.use('/api/auth', createAuthRoutes());
app.use('/api/settings', createSettingsRoutes());
app.use('/api/accounts', createAccountsRoutes());
app.use('/api/categories', createCategoriesRoutes());
app.use('/api/transactions', createTransactionsRoutes());
app.use('/api/import', createImportRoutes());
app.use('/api/salary', createSalaryRoutes());
app.use('/api/rules', createRulesRoutes());
app.use('/api/ai', createAiRoutes());
app.use('/api/subscriptions', createSubscriptionsRoutes());
app.use('/api/dashboard', createDashboardRoutes());
app.use('/api/budgets', createBudgetsRoutes());
app.use('/api/insights', createInsightsRoutes());
app.use('/api/chat', createChatRoutes());
app.use('/api/truelayer', createTrueLayerRoutes());
app.use('/api/receipts', createReceiptsRoutes());
app.use('/api/backup', createBackupRoutes());

// Serve client build in production
if (process.env.NODE_ENV === 'production') {
  const clientDir = path.resolve(__dirname, '../client');
  app.use(express.static(clientDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

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
