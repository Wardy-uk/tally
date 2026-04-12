import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { BudgetQueries } from '../db/queries.js';
import { db } from '../db/schema.js';
import { getBudgetStatus, suggestBudgetsFromHistory } from '../services/budget-service.js';

const BudgetInput = z.object({
  categoryId: z.number().int(),
  monthlyAmount: z.number().int(), // pence
  source: z.enum(['ai', 'manual']).default('manual'),
});

export function createBudgetsRoutes() {
  const router = Router();

  router.get('/', requireAuth, (_req, res) => {
    const rows = BudgetQueries.list.all();
    res.json({ ok: true, data: rows });
  });

  router.get('/status', requireAuth, (req, res) => {
    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    res.json({ ok: true, data: getBudgetStatus(month) });
  });

  router.post('/', requireAuth, (req, res) => {
    const parsed = BudgetInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.message });
    const b = parsed.data;
    BudgetQueries.upsert.run(b.categoryId, b.monthlyAmount, b.source, new Date().toISOString().slice(0, 7));
    res.json({ ok: true, data: { saved: b } });
  });

  router.delete('/:id', requireAuth, (req, res) => {
    BudgetQueries.delete.run(Number(req.params.id));
    res.json({ ok: true, data: { deleted: Number(req.params.id) } });
  });

  // Bulk upsert (used by AI suggest-and-apply)
  router.post('/bulk', requireAuth, (req, res) => {
    const schema = z.object({
      items: z.array(z.object({
        categoryId: z.number().int(),
        monthlyAmount: z.number().int(),
      })),
      source: z.enum(['ai', 'manual']).default('manual'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.message });

    const month = new Date().toISOString().slice(0, 7);
    db.exec('BEGIN');
    try {
      for (const i of parsed.data.items) {
        BudgetQueries.upsert.run(i.categoryId, i.monthlyAmount, parsed.data.source, month);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.json({ ok: true, data: { saved: parsed.data.items.length } });
  });

  router.post('/suggest', requireAuth, async (req, res) => {
    const months = Number(req.body?.months ?? 3);
    try {
      const suggestions = await suggestBudgetsFromHistory(months);
      res.json({ ok: true, data: suggestions });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
