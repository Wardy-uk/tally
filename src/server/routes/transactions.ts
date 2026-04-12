import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/schema.js';
import { TransactionQueries } from '../db/queries.js';

export function createTransactionsRoutes() {
  const router = Router();

  // List with filters
  router.get('/', requireAuth, (req, res) => {
    const q = req.query;
    const where: string[] = [];
    const params: any[] = [];

    if (q.accountId) {
      where.push('t.account_id = ?');
      params.push(Number(q.accountId));
    }
    if (q.categoryId) {
      if (q.categoryId === 'none') {
        where.push('t.category_id IS NULL');
      } else {
        where.push('t.category_id = ?');
        params.push(Number(q.categoryId));
      }
    }
    if (q.dateFrom) {
      where.push('t.date >= ?');
      params.push(String(q.dateFrom));
    }
    if (q.dateTo) {
      where.push('t.date <= ?');
      params.push(String(q.dateTo));
    }
    if (q.search) {
      where.push('(t.description LIKE ? OR t.merchant LIKE ?)');
      params.push(`%${q.search}%`, `%${q.search}%`);
    }
    if (q.includeTransfers !== 'true') {
      where.push('t.is_transfer = 0');
    }
    if (q.type === 'income') {
      where.push('t.amount > 0');
    } else if (q.type === 'expense') {
      where.push('t.amount < 0');
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Number(q.limit) || 100, 500);
    const offset = Number(q.offset) || 0;

    const sql = `
      SELECT t.*, c.name AS category_name, c.color AS category_color, c.icon AS category_icon,
             a.name AS account_name
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
      ${whereSql}
      ORDER BY t.date DESC, t.id DESC
      LIMIT ? OFFSET ?
    `;
    const rows = db.prepare(sql).all(...params, limit, offset);

    const countSql = `SELECT COUNT(*) as c FROM transactions t ${whereSql}`;
    const total = (db.prepare(countSql).get(...params) as { c: number }).c;

    res.json({ ok: true, data: { rows, total, limit, offset } });
  });

  router.get('/:id', requireAuth, (req, res) => {
    const row = TransactionQueries.findById.get(Number(req.params.id));
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, data: row });
  });

  router.patch('/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const schema = z.object({
      categoryId: z.number().int().nullable().optional(),
      notes: z.string().nullable().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.message });

    if (parsed.data.categoryId !== undefined) {
      TransactionQueries.updateCategory.run(parsed.data.categoryId, id);
    }
    if (parsed.data.notes !== undefined) {
      TransactionQueries.updateNotes.run(parsed.data.notes, id);
    }
    res.json({ ok: true, data: TransactionQueries.findById.get(id) });
  });

  router.delete('/:id', requireAuth, (req, res) => {
    TransactionQueries.delete.run(Number(req.params.id));
    res.json({ ok: true, data: { deleted: Number(req.params.id) } });
  });

  // Monthly summary for dashboard
  router.get('/summary/monthly', requireAuth, (req, res) => {
    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    const dateFrom = `${month}-01`;
    const dateTo = `${month}-31`;

    const income = (db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
      WHERE is_transfer = 0 AND amount > 0 AND date >= ? AND date <= ?
    `).get(dateFrom, dateTo) as { total: number }).total;

    const expense = (db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
      WHERE is_transfer = 0 AND amount < 0 AND date >= ? AND date <= ?
    `).get(dateFrom, dateTo) as { total: number }).total;

    const byCategory = db.prepare(`
      SELECT c.id, c.name, c.color, c.icon, COALESCE(SUM(t.amount), 0) AS total, COUNT(t.id) AS count
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.is_transfer = 0 AND t.amount < 0 AND t.date >= ? AND t.date <= ?
      GROUP BY c.id
      ORDER BY total ASC
    `).all(dateFrom, dateTo);

    res.json({
      ok: true,
      data: {
        month,
        income,
        expense,
        net: income + expense,
        byCategory,
      },
    });
  });

  return router;
}
