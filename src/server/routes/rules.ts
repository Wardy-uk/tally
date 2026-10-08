import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { RuleQueries } from '../db/queries.js';
import { applyRulesToBacklog, invalidateRuleCache } from '../services/rules-engine.js';
import { unsafeRuleReason } from '../services/rule-policy.js';

const RuleInput = z.object({
  name: z.string().min(1).max(60),
  matchField: z.enum(['merchant_key', 'description', 'merchant', 'amount']),
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
    const unsafe = unsafeRuleReason({ match_field: r.matchField, match_type: r.matchType, match_value: r.matchValue });
    if (unsafe) return res.status(400).json({ ok: false, error: `Rule rejected: ${unsafe}` });
    const value = r.matchField === 'merchant_key' ? r.matchValue.trim().toUpperCase() : r.matchValue;
    const result = RuleQueries.create.run(
      r.name, r.matchField, r.matchType, value, r.categoryId, r.priority, req.user!.id, 'user',
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
