import { db } from '../db/schema.js';
import { getOpenAI, getModel, isConfigured } from './openai-service.js';

export interface MonthlyInsight {
  month: string;
  summary: string;
  highlights: string[];
  concerns: string[];
  wins: string[];
  advice: string[];
  generatedAt: string;
}

/** Build a compact financial summary string for the given month to feed to GPT. */
function buildContext(month: string): string {
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

  const cats = db.prepare(`
    SELECT c.name, ABS(SUM(t.amount)) AS total, COUNT(*) AS n
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.is_transfer = 0 AND t.amount < 0 AND t.date >= ? AND t.date <= ?
    GROUP BY c.id
    ORDER BY total DESC
  `).all(dateFrom, dateTo) as Array<{ name: string | null; total: number; n: number }>;

  // Compare with previous month
  const prev = new Date(`${month}-01`);
  prev.setMonth(prev.getMonth() - 1);
  const prevM = prev.toISOString().slice(0, 7);
  const prevExpense = (db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS t FROM transactions
    WHERE is_transfer = 0 AND amount < 0 AND date >= ? AND date <= ?
  `).get(`${prevM}-01`, `${prevM}-31`) as { t: number }).t;

  // Top merchants
  const merchants = db.prepare(`
    SELECT description, COUNT(*) AS n, ABS(SUM(amount)) AS total
    FROM transactions
    WHERE is_transfer = 0 AND amount < 0 AND date >= ? AND date <= ?
    GROUP BY description ORDER BY total DESC LIMIT 10
  `).all(dateFrom, dateTo) as Array<{ description: string; n: number; total: number }>;

  // Budgets status
  const budgets = db.prepare(`
    SELECT c.name, b.monthly_amount,
      COALESCE((SELECT ABS(SUM(amount)) FROM transactions
                WHERE category_id = b.category_id AND is_transfer = 0 AND amount < 0
                AND date >= ? AND date <= ?), 0) AS spent
    FROM budgets b JOIN categories c ON c.id = b.category_id WHERE b.active = 1
  `).all(dateFrom, dateTo) as Array<{ name: string; monthly_amount: number; spent: number }>;

  const fmt = (p: number) => `£${(Math.abs(p) / 100).toFixed(2)}`;
  const lines: string[] = [];
  lines.push(`Month: ${month}`);
  lines.push(`Income: ${fmt(income)}`);
  lines.push(`Expenses: ${fmt(expense)} (prev month: ${fmt(prevExpense)})`);
  lines.push(`Net: ${fmt(income + expense)}`);
  lines.push('');
  lines.push('Categories:');
  for (const c of cats) lines.push(`  ${c.name ?? 'Uncategorised'}: ${fmt(c.total)} (${c.n} tx)`);
  lines.push('');
  lines.push('Top merchants:');
  for (const m of merchants) lines.push(`  ${m.description}: ${fmt(m.total)} (${m.n}x)`);
  if (budgets.length > 0) {
    lines.push('');
    lines.push('Budgets (spent/limit):');
    for (const b of budgets) lines.push(`  ${b.name}: ${fmt(b.spent)}/${fmt(b.monthly_amount)}`);
  }
  return lines.join('\n');
}

export async function generateMonthlyInsight(month: string): Promise<MonthlyInsight> {
  if (!isConfigured()) throw new Error('OpenAI API key not set');

  const context = buildContext(month);
  const openai = getOpenAI()!;

  const res = await openai.chat.completions.create({
    model: getModel(),
    messages: [
      {
        role: 'system',
        content: `You are a helpful, direct personal finance advisor for a couple in the UK. You receive a month's spending summary and produce a structured insight: a plain-English overall summary, notable highlights, things to watch out for, wins to celebrate, and concrete advice. Keep language warm but honest. Be specific — reference actual numbers and category names. Never moralise. Return JSON only.`,
      },
      {
        role: 'user',
        content: `${context}\n\nReturn JSON:\n{\n  "summary": "1-2 sentence plain-English overview",\n  "highlights": ["notable thing", ...],\n  "concerns": ["what to watch", ...],\n  "wins": ["good things", ...],\n  "advice": ["specific actionable suggestion", ...]\n}`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.4,
  });

  const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}') as any;

  const insight: MonthlyInsight = {
    month,
    summary: parsed.summary ?? '',
    highlights: parsed.highlights ?? [],
    concerns: parsed.concerns ?? [],
    wins: parsed.wins ?? [],
    advice: parsed.advice ?? [],
    generatedAt: new Date().toISOString(),
  };

  // Persist
  db.prepare(`INSERT INTO ai_insights (month, kind, content) VALUES (?, ?, ?)`)
    .run(month, 'monthly', JSON.stringify(insight));

  return insight;
}

export function listInsights(limit = 12): MonthlyInsight[] {
  const rows = db.prepare(`
    SELECT month, content FROM ai_insights WHERE kind = 'monthly'
    ORDER BY id DESC LIMIT ?
  `).all(limit) as Array<{ month: string; content: string }>;
  return rows.map(r => JSON.parse(r.content) as MonthlyInsight);
}
