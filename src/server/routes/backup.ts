import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { createBackup, listBackups, pruneBackups } from '../services/backup-service.js';
import { db } from '../db/schema.js';

export function createBackupRoutes() {
  const router = Router();

  router.get('/', requireAuth, requireAdmin, async (_req, res) => {
    const list = await listBackups();
    res.json({ ok: true, data: list });
  });

  router.post('/', requireAuth, requireAdmin, async (_req, res) => {
    const file = await createBackup();
    await pruneBackups(14);
    res.json({ ok: true, data: { file } });
  });

  // JSON export of the entire database (transactions, accounts, categories, rules, budgets)
  router.get('/export', requireAuth, requireAdmin, (_req, res) => {
    const dump = {
      exportedAt: new Date().toISOString(),
      accounts: db.prepare(`SELECT * FROM accounts`).all(),
      categories: db.prepare(`SELECT * FROM categories`).all(),
      transactions: db.prepare(`SELECT * FROM transactions`).all(),
      rules: db.prepare(`SELECT * FROM rules`).all(),
      budgets: db.prepare(`SELECT * FROM budgets`).all(),
      salary_profiles: db.prepare(`SELECT * FROM salary_profiles`).all(),
      recurring_charges: db.prepare(`SELECT * FROM recurring_charges`).all(),
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="tally-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.send(JSON.stringify(dump, null, 2));
  });

  return router;
}
