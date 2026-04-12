import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { RuleQueries } from '../db/queries.js';
import { applyRulesToBacklog, invalidateRuleCache } from '../services/rules-engine.js';

const RuleInput = z.object({
  name: z.string().min(1).max(60),
  matchField: z.enum(['description', 'merchant', 'amount']),
  matchType: z.enum(['contains', 'equals', 'regex', 'startsWith']),
  matchValue: z.string().min(1),
  categoryId: z.number().int(),
  priority: z.number().int().default(100),
});

export function createRulesRoutes() {
  const router = Router();

  router.get('/', requireAuth, (_req, res) => {
    const rows = RuleQueries.list.all();
    res.json({ ok: true, data: rows });
  });

  router.post('/', requireAuth, (req, res) => {
    const parsed = RuleInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.message });
    const r = parsed.data;
    const result = RuleQueries.create.run(
      r.name, r.matchField, r.matchType, r.matchValue, r.categoryId, r.priority, req.user!.id,
    );
    invalidateRuleCache();
    res.json({ ok: true, data: { id: Number(result.lastInsertRowid) } });
  });

  router.delete('/:id', requireAuth, (req, res) => {
    RuleQueries.delete.run(Number(req.params.id));
    invalidateRuleCache();
    res.json({ ok: true, data: { deleted: Number(req.params.id) } });
  });

  router.post('/apply', requireAuth, (_req, res) => {
    const n = applyRulesToBacklog();
    res.json({ ok: true, data: { applied: n } });
  });

  return router;
}
