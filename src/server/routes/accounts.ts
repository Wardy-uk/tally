import { Router } from 'express';
import { z } from 'zod';
import { AccountQueries } from '../db/queries.js';
import { requireAuth } from '../middleware/auth.js';

const AccountInput = z.object({
  name: z.string().min(1).max(60),
  type: z.enum(['current', 'savings', 'credit', 'loan', 'investment']),
  ownerUserId: z.number().nullable(),
  bank: z.string().nullable().optional(),
  accountNumber: z.string().nullable().optional(),
  sortCode: z.string().nullable().optional(),
  openingBalance: z.number().int(), // pence
});

function rowToAccount(row: any) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    ownerUserId: row.owner_user_id,
    bank: row.bank,
    accountNumber: row.account_number,
    sortCode: row.sort_code,
    openingBalance: row.opening_balance,
    currentBalance: row.current_balance ?? row.opening_balance,
    active: row.active,
    createdAt: row.created_at,
  };
}

export function createAccountsRoutes() {
  const router = Router();

  router.get('/', requireAuth, (_req, res) => {
    const rows = AccountQueries.list.all() as any[];
    res.json({ ok: true, data: rows.map(rowToAccount) });
  });

  router.get('/:id', requireAuth, (req, res) => {
    const row = AccountQueries.findById.get(Number(req.params.id)) as any;
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, data: rowToAccount(row) });
  });

  router.post('/', requireAuth, (req, res) => {
    const parsed = AccountInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.message });
    const a = parsed.data;
    const result = AccountQueries.create.run(
      a.name, a.type, a.ownerUserId, a.bank ?? null,
      a.accountNumber ?? null, a.sortCode ?? null, a.openingBalance,
    );
    const row = AccountQueries.findById.get(Number(result.lastInsertRowid)) as any;
    res.json({ ok: true, data: rowToAccount(row) });
  });

  router.put('/:id', requireAuth, (req, res) => {
    const parsed = AccountInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.message });
    const a = parsed.data;
    const id = Number(req.params.id);
    AccountQueries.update.run(
      a.name, a.type, a.ownerUserId, a.bank ?? null,
      a.accountNumber ?? null, a.sortCode ?? null, a.openingBalance, id,
    );
    const row = AccountQueries.findById.get(id) as any;
    res.json({ ok: true, data: rowToAccount(row) });
  });

  router.delete('/:id', requireAuth, (req, res) => {
    AccountQueries.archive.run(Number(req.params.id));
    res.json({ ok: true, data: { archived: Number(req.params.id) } });
  });

  return router;
}
