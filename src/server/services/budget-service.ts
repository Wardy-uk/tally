import { db } from '../db/schema.js';
import { getOpenAI, getModel, isConfigured } from './openai-service.js';

export interface BudgetStatus {
  id: number;
  categoryId: number;
  categoryName: string;
  categoryColor: string | null;
  categoryIcon: string | null;
  monthlyAmount: number; // pence (positive)
  spent: number; // pence (positive)
  remaining: number;
  percent: number;
  source: 'ai' | 'manual';
}

/** Compute budget status for the given month for all active budgets. */
export function getBudgetStatus(month: string): BudgetStatus[] {
  const dateFrom = `${month}-01`;
  const dateTo = `${month}-31`;

  const rows = db.prepare(`
    SELECT b.id, b.category_id, b.monthly_amount, b.source,
           c.name AS category_name, c.color AS category_color, c.icon AS category_icon,
           COALESCE((
             SELECT ABS(SUM(amount)) FROM transactions
             WHERE category_id = b.category_id
               AND is_transfer = 0
               AND amount < 0
               AND date >= ? AND date <= ?
           ), 0) AS spent
    FROM budgets b
    JOIN categories c ON c.id = b.category_id
    WHERE b.active = 1
    ORDER BY c.name
  `).all(dateFrom, dateTo) as any[];

  return rows.map(r => {
    const percent = r.monthly_amount > 0
      ? Math.round((r.spent / r.monthly_amount) * 100)
      : 0;
    return {
      id: r.id,
      categoryId: r.category_id,
      categoryName: r.category_name,
      categoryColor: r.category_color,
      categoryIcon: r.category_icon,
      monthlyAmount: r.monthly_amount,
      spent: r.spent,
      remaining: r.monthly_amount - r.spent,
      percent,
      source: r.source,
    };
  });
}

/** Ask GPT to suggest budgets from the last N months of spending history. */
export async function suggestBudgetsFromHistory(months = 3): Promise<Array<{
  categoryId: number;
  categoryName: string;
  suggestedMonthly: number;
  average: number;
  rationale: string;
}>> {
  if (!isConfigured()) throw new Error('OpenAI API key not set');

  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - months);
  const dateFrom = from.toISOString().slice(0, 10);
  const dateTo = to.toISOString().slice(0, 10);

  // Aggregate spending by category over the window
  const history = db.prepare(`
    SELECT c.id AS category_id, c.name, ABS(SUM(t.amount)) AS total, COUNT(*) AS n
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE t.is_transfer = 0
      AND t.amount < 0
      AND c.kind = 'expense'
      AND t.date >= ? AND t.date <= ?
    GROUP BY c.id
    HAVING total > 0
    ORDER BY total DESC
  `).all(dateFrom, dateTo) as Array<{ category_id: number; name: string; total: number; n: number }>;

  if (history.length === 0) return [];

  const summary = history.map(h => ({
    categoryId: h.category_id,
    name: h.name,
    averagePerMonth: Math.round(h.total / months),
    txCount: h.n,
  }));

  const openai = getOpenAI()!;
  const list = summary.map(s =>
    `${s.categoryId}|${s.name}|avg £${(s.averagePerMonth / 100).toFixed(2)}/mo over ${s.txCount} tx`,
  ).join('\n');

  const res = await openai.chat.completions.create({
    model: getModel(),
    messages: [
      {
        role: 'system',
        content: 'You are a personal finance advisor. Suggest a sensible monthly budget for each spending category based on the user\'s history. Round to the nearest £5 for small categories, £10 for medium, £25 for large. Slightly lower than average for discretionary categories (eating out, entertainment, shopping). Match average for fixed categories (rent, bills, subscriptions). Return JSON only.',
      },
      {
        role: 'user',
        content: `Last ${months} months spending history (id|category|avg):\n${list}\n\nReturn JSON: { "suggestions": [{"categoryId": N, "suggestedMonthly": PENCE, "rationale": "..."}, ...] }`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  const content = res.choices[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(content) as {
    suggestions: Array<{ categoryId: number; suggestedMonthly: number; rationale: string }>;
  };

  return parsed.suggestions.map(s => {
    const h = summary.find(x => x.categoryId === s.categoryId);
    return {
      categoryId: s.categoryId,
      categoryName: h?.name ?? '?',
      suggestedMonthly: s.suggestedMonthly,
      average: h?.averagePerMonth ?? 0,
      rationale: s.rationale,
    };
  });
}
