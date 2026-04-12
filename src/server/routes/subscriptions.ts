import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/schema.js';
import { refreshRecurringTable } from '../services/recurring-detector.js';

export function createSubscriptionsRoutes() {
  const router = Router();

  router.get('/', requireAuth, (_req, res) => {
    const rows = db.prepare(`
      SELECT * FROM recurring_charges
      WHERE active = 1
      ORDER BY ignored ASC, typical_amount ASC
    `).all();
    res.json({ ok: true, data: rows });
  });

  router.post('/refresh', requireAuth, (_req, res) => {
    const count = refreshRecurringTable();
    res.json({ ok: true, data: { detected: count } });
  });

  router.patch('/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const { ignored } = req.body ?? {};
    db.prepare(`UPDATE recurring_charges SET ignored = ? WHERE id = ?`).run(ignored ? 1 : 0, id);
    res.json({ ok: true, data: { id, ignored: !!ignored } });
  });

  return router;
}
