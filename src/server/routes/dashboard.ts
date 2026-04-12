import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/schema.js';
import { SalaryQueries, UserQueries } from '../db/queries.js';

export function createDashboardRoutes() {
  const router = Router();

  router.get('/', requireAuth, (req, res) => {
    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);

    // Net worth = sum of (opening_balance + all tx amounts) across all active accounts
    const netWorth = (db.prepare(`
      SELECT COALESCE(SUM(a.opening_balance), 0) + COALESCE(
        (SELECT SUM(amount) FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE active = 1)),
        0
      ) AS total
      FROM accounts a WHERE a.active = 1
    `).get() as { total: number }).total;

    // This-month income/expense
    const dateFrom = `${month}-01`;
    const dateTo = `${month}-31`;
    const income = (db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS t FROM transactions
      WHERE is_transfer = 0 AND amount > 0 AND date >= ? AND date <= ?
    `).get(dateFrom, dateTo) as { t: number }).t;
    const expense = (db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS t FROM transactions
      WHERE is_transfer = 0 AND amount < 0 AND date >= ? AND date <= ?
    `).get(dateFrom, dateTo) as { t: number }).t;

    // Previous month comparison
    const prevDate = new Date(`${month}-01`);
    prevDate.setMonth(prevDate.getMonth() - 1);
    const prevMonth = prevDate.toISOString().slice(0, 7);
    const prevExpense = (db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS t FROM transactions
      WHERE is_transfer = 0 AND amount < 0 AND date >= ? AND date <= ?
    `).get(`${prevMonth}-01`, `${prevMonth}-31`) as { t: number }).t;

    // 6-month trend (income + expense per month) — skip leading empty months
    // (we can't go back further than ~90 days with Open Banking).
    const fullTrend: Array<{ month: string; income: number; expense: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(`${month}-01`);
      d.setMonth(d.getMonth() - i);
      const m = d.toISOString().slice(0, 7);
      const inc = (db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS t FROM transactions
        WHERE is_transfer = 0 AND amount > 0 AND date >= ? AND date <= ?
      `).get(`${m}-01`, `${m}-31`) as { t: number }).t;
      const exp = (db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS t FROM transactions
        WHERE is_transfer = 0 AND amount < 0 AND date >= ? AND date <= ?
      `).get(`${m}-01`, `${m}-31`) as { t: number }).t;
      fullTrend.push({ month: m, income: inc, expense: Math.abs(exp) });
    }
    // Drop leading months with no activity (keeps trailing empty months — they're meaningful)
    const firstIdx = fullTrend.findIndex(t => t.income > 0 || t.expense > 0);
    const trend = firstIdx < 0 ? [] : fullTrend.slice(firstIdx);

    // Category breakdown this month
    const byCategory = db.prepare(`
      SELECT c.id, c.name, c.color, c.icon, COALESCE(SUM(t.amount), 0) AS total, COUNT(t.id) AS count
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.is_transfer = 0 AND t.amount < 0 AND t.date >= ? AND t.date <= ?
      GROUP BY c.id
      ORDER BY total ASC
      LIMIT 10
    `).all(dateFrom, dateTo);

    // Top merchants this month (by total spend)
    const topMerchants = db.prepare(`
      SELECT description, COUNT(*) AS count, SUM(amount) AS total
      FROM transactions
      WHERE is_transfer = 0 AND amount < 0 AND date >= ? AND date <= ?
      GROUP BY description
      ORDER BY total ASC
      LIMIT 8
    `).all(dateFrom, dateTo);

    // Recent transactions (last 8)
    const recent = db.prepare(`
      SELECT t.id, t.date, t.amount, t.description, t.merchant, t.is_transfer,
             c.name AS category_name, c.color AS category_color,
             a.name AS account_name
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.is_transfer = 0
      ORDER BY t.date DESC, t.id DESC
      LIMIT 8
    `).all();

    // Account summaries
    const accounts = db.prepare(`
      SELECT a.id, a.name, a.type, a.owner_user_id,
        COALESCE((SELECT SUM(amount) FROM transactions WHERE account_id = a.id), 0) + a.opening_balance AS balance
      FROM accounts a
      WHERE a.active = 1
      ORDER BY a.name
    `).all();

    // Salary variance per user (base vs actual income this month)
    const users = UserQueries.list.all() as any[];
    const salaryWidgets = users.map(u => {
      const profile = SalaryQueries.current.get(u.id) as any;
      if (!profile) {
        return {
          userId: u.id,
          displayName: u.display_name,
          hasProfile: false,
          baseMonthly: 0,
          actualMonth: 0,
          variance: 0,
        };
      }
      // Actual = all positive transactions on linked account this month (income category or any positive)
      const actual = profile.account_id
        ? (db.prepare(`
            SELECT COALESCE(SUM(amount), 0) AS t FROM transactions
            WHERE account_id = ? AND is_transfer = 0 AND amount > 0 AND date >= ? AND date <= ?
          `).get(profile.account_id, dateFrom, dateTo) as { t: number }).t
        : 0;
      return {
        userId: u.id,
        displayName: u.display_name,
        hasProfile: true,
        baseMonthly: profile.base_salary_monthly,
        actualMonth: actual,
        variance: actual - profile.base_salary_monthly,
        payDay: profile.pay_day,
        payDayType: profile.pay_day_type ?? 'day',
      };
    });

    res.json({
      ok: true,
      data: {
        month,
        netWorth,
        income,
        expense,
        net: income + expense,
        prevExpense,
        expenseDelta: expense - prevExpense,
        trend,
        byCategory,
        topMerchants,
        recent,
        accounts,
        salaryWidgets,
      },
    });
  });

  return router;
}
