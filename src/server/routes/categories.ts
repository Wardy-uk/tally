import { Router } from 'express';
import { z } from 'zod';
import { CategoryQueries } from '../db/queries.js';
import { requireAuth } from '../middleware/auth.js';

const CategoryInput = z.object({
  name: z.string().min(1).max(40),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  kind: z.enum(['expense', 'income', 'transfer']),
});

export function createCategoriesRoutes() {
  const router = Router();

  router.get('/', requireAuth, (_req, res) => {
    const rows = CategoryQueries.list.all() as any[];
    res.json({ ok: true, data: rows });
  });

  router.post('/', requireAuth, (req, res) => {
    const parsed = CategoryInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.message });
    const c = parsed.data;
    const result = CategoryQueries.create.run(c.name, null, c.icon ?? null, c.color ?? null, c.kind);
    const row = CategoryQueries.findById.get(Number(result.lastInsertRowid));
    res.json({ ok: true, data: row });
  });

  router.put('/:id', requireAuth, (req, res) => {
    const parsed = CategoryInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.message });
    const c = parsed.data;
    const id = Number(req.params.id);
    CategoryQueries.update.run(c.name, c.icon ?? null, c.color ?? null, c.kind, id);
    res.json({ ok: true, data: CategoryQueries.findById.get(id) });
  });

  router.delete('/:id', requireAuth, (req, res) => {
    CategoryQueries.delete.run(Number(req.params.id));
    res.json({ ok: true, data: { deleted: Number(req.params.id) } });
  });

  return router;
}
