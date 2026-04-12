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
