import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/schema.js';
import { TransactionQueries, RuleQueries } from '../db/queries.js';
import { invalidateRuleCache } from '../services/rules-engine.js';
import { merchantIdentity } from '../services/merchant.js';

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
      /** Opt out of rule creation — categorise this one transaction only. Defaults to true. */
      createRule: z.boolean().optional(),
      /** Also apply to existing uncategorised transactions from the same merchant. Defaults to true. */
      applyToSimilar: z.boolean().optional(),
      /** User has confirmed a rule the server flagged as ambiguous. */
      confirmRule: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.message });
    const { categoryId, notes } = parsed.data;

    if (categoryId !== undefined) {
      TransactionQueries.updateCategory.run(categoryId, categoryId === null ? null : 'user', null, id);
    }
    if (notes !== undefined) {
      TransactionQueries.updateNotes.run(notes, id);
    }

    const createRule = parsed.data.createRule !== false;
    const applyToSimilar = parsed.data.applyToSimilar !== false;

    let appliedToSimilar = 0;
    let ruleCreated = false;
    let ruleUpdated = false;
    let merchantKey: string | null = null;
    /** Set when no rule was made because the merchant identity is unclear — client may confirm. */
    let needsConfirmation: { reason: string; message: string } | null = null;
    let ruleSkipped: string | null = null;

    // "Always use this category for this merchant": the rule keys on the normalised merchant,
    // never on the date, card number or other incidental description text.
    if (createRule && categoryId !== null && categoryId !== undefined) {
      const tx = TransactionQueries.findById.get(id) as any;
      const ident = tx ? merchantIdentity(tx.description, tx.merchant) : null;
      merchantKey = ident?.key ?? null;

      if (!ident || !ident.key) {
        ruleSkipped = 'No stable merchant in this description — categorised this transaction only.';
      } else if (ident.wrapperOnly && !parsed.data.confirmRule) {
        needsConfirmation = {
          reason: 'wrapper_only',
          message: `"${ident.key}" has no underlying merchant, so a rule would put every such line in one category. Create it anyway?`,
        };
      } else {
        const conflicts = (db.prepare(`
          SELECT id, description, merchant, category_id FROM transactions
          WHERE category_source = 'user' AND category_id IS NOT NULL AND category_id != ? AND id != ?
        `).all(categoryId, id) as any[])
          .filter(t => merchantIdentity(t.description, t.merchant).key === ident.key);
        if (conflicts.length > 0 && !parsed.data.confirmRule) {
          needsConfirmation = {
            reason: 'conflicting_history',
            message: `You've previously put ${conflicts.length} "${ident.key}" transaction${conflicts.length > 1 ? 's' : ''} in a different category. Make this the rule for all future "${ident.key}" transactions?`,
          };
        }
      }

      if (ident?.key && !needsConfirmation) {
        const key = ident.key;
        const existing = db.prepare(`
          SELECT id, category_id FROM rules
          WHERE active = 1 AND match_field = 'merchant_key' AND match_value = ?
          LIMIT 1
        `).get(key) as { id: number; category_id: number } | undefined;

        let ruleId: number;
        if (existing) {
          ruleId = existing.id;
          if (existing.category_id !== categoryId) {
            db.prepare(`UPDATE rules SET category_id = ?, source = 'user_confirmed' WHERE id = ?`).run(categoryId, existing.id);
            ruleUpdated = true;
          }
        } else {
          const r = RuleQueries.create.run(`Merchant: ${key}`, 'merchant_key', 'equals', key, categoryId, 100, req.user!.id, 'user_confirmed');
          ruleId = Number(r.lastInsertRowid);
          ruleCreated = true;
        }
        invalidateRuleCache();

        if (applyToSimilar) {
          const similar = (db.prepare(`
            SELECT id, description, merchant FROM transactions
            WHERE category_id IS NULL AND is_transfer = 0
          `).all() as any[]).filter(t => merchantIdentity(t.description, t.merchant).key === key);
          const upd = db.prepare(`UPDATE transactions SET category_id = ?, category_source = 'rule', category_rule_id = ? WHERE id = ?`);
          for (const t of similar) upd.run(categoryId, ruleId, t.id);
          appliedToSimilar = similar.length;
        }
      }
    }

    res.json({
      ok: true,
      data: {
        ...(TransactionQueries.findById.get(id) as any),
        appliedToSimilar,
        ruleCreated,
        ruleUpdated,
        merchantKey,
        needsConfirmation,
        ruleSkipped,
      },
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
