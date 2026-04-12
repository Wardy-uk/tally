import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/schema.js';
import { TransactionQueries, RuleQueries } from '../db/queries.js';
import { invalidateRuleCache } from '../services/rules-engine.js';

/**
 * Extract a useful merchant phrase from a transaction description.
 * Strips card metadata, numbers, and common noise; keeps the first 2-3 meaningful words.
 */
function extractMerchantPhrase(description: string): string {
  const cleaned = description
    .replace(/\b(DEB|CR|POS|DD|SO|BGC|FPI|FPO|ATM|TFR|VIS)\b/gi, '')
    .replace(/\d{6,}/g, '')
    .replace(/[^a-zA-Z0-9&\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter(w => w.length > 1);
  return words.slice(0, 2).join(' ') || description.slice(0, 20);
}

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
      /** If true and categoryId is provided, also create a rule + apply to all similar. */
      applyToSimilar: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.message });

    if (parsed.data.categoryId !== undefined) {
      TransactionQueries.updateCategory.run(parsed.data.categoryId, id);
    }
    if (parsed.data.notes !== undefined) {
      TransactionQueries.updateNotes.run(parsed.data.notes, id);
    }

    let appliedToSimilar = 0;
    if (parsed.data.applyToSimilar && parsed.data.categoryId !== null && parsed.data.categoryId !== undefined) {
      const tx = TransactionQueries.findById.get(id) as any;
      if (tx) {
        // Extract a sensible rule phrase from the description
        const phrase = extractMerchantPhrase(tx.description);
        // Create the rule
        RuleQueries.create.run(
          `Auto: ${phrase}`,
          'description',
          'contains',
          phrase,
          parsed.data.categoryId,
          100,
          req.user!.id,
        );
        invalidateRuleCache();

        // Apply to all matching uncategorised transactions immediately
        const result = db.prepare(`
          UPDATE transactions
          SET category_id = ?
          WHERE category_id IS NULL
            AND is_transfer = 0
            AND LOWER(description) LIKE ?
        `).run(parsed.data.categoryId, `%${phrase.toLowerCase()}%`);
        appliedToSimilar = Number(result.changes);
      }
    }

    res.json({
      ok: true,
      data: { ...(TransactionQueries.findById.get(id) as any), appliedToSimilar },
    });
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
