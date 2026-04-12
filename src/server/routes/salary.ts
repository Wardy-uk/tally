import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { SalaryQueries, UserQueries } from '../db/queries.js';

const SalaryInput = z.object({
  userId: z.number().int(),
  baseSalaryMonthly: z.number().int(), // pence (annual input is converted client-side)
  payDay: z.number().int().min(1).max(31),
  payDayType: z.enum(['day', 'last-working', 'working-before']).default('day'),
  accountId: z.number().int().nullable(),
  effectiveFrom: z.string(),
});

function row(r: any) {
  return {
    id: r.id,
    userId: r.user_id,
    baseSalaryMonthly: r.base_salary_monthly,
    payDay: r.pay_day,
    payDayType: r.pay_day_type ?? 'day',
    accountId: r.account_id,
    effectiveFrom: r.effective_from,
  };
}

export function createSalaryRoutes() {
  const router = Router();

  router.get('/', requireAuth, (_req, res) => {
    const users = UserQueries.list.all() as any[];
    const out = users.map(u => {
      const current = SalaryQueries.current.get(u.id) as any;
      return {
        userId: u.id,
        username: u.username,
        displayName: u.display_name,
        profile: current ? row(current) : null,
      };
    });
    res.json({ ok: true, data: out });
  });

  router.post('/', requireAuth, (req, res) => {
    const parsed = SalaryInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.message });
    const p = parsed.data;
    const result = SalaryQueries.create.run(
      p.userId, p.baseSalaryMonthly, p.payDay, p.payDayType, p.accountId, p.effectiveFrom,
    );
    res.json({ ok: true, data: { id: Number(result.lastInsertRowid) } });
  });

  router.delete('/:id', requireAuth, (req, res) => {
    SalaryQueries.delete.run(Number(req.params.id));
    res.json({ ok: true, data: { deleted: Number(req.params.id) } });
  });

  return router;
}
