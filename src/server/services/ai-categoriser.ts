import { db } from '../db/schema.js';
import { getOpenAI, getModel, isConfigured } from './openai-service.js';

interface UncategorisedTx {
  id: number;
  description: string;
  merchant: string | null;
  amount: number;
}

interface Category {
  id: number;
  name: string;
  kind: string;
}

interface CategoriseResult {
  categorised: number;
  skipped: number;
  errors: string[];
}

/**
 * Ask GPT to categorise a batch of uncategorised transactions.
 * Sends categories + transactions, expects JSON array of {id, categoryId}.
 * Hits a batch of at most 50 per call to keep prompts small.
 */
export async function aiCategoriseUncategorised(limit = 100): Promise<CategoriseResult> {
  if (!isConfigured()) {
    return { categorised: 0, skipped: 0, errors: ['OpenAI API key not set'] };
  }

  const txs = db.prepare(`
    SELECT id, description, merchant, amount FROM transactions
    WHERE category_id IS NULL AND is_transfer = 0
    ORDER BY date DESC
    LIMIT ?
  `).all(limit) as UncategorisedTx[];
  if (txs.length === 0) return { categorised: 0, skipped: 0, errors: [] };

  const cats = db.prepare(
    `SELECT id, name, kind FROM categories WHERE name != 'Transfer' ORDER BY kind, name`,
  ).all() as Category[];

  const openai = getOpenAI()!;
  const model = getModel();

  const catsList = cats.map(c => `${c.id}:${c.name} (${c.kind})`).join('\n');
  const txList = txs.map(t =>
    `${t.id}|${t.description}|${(t.amount / 100).toFixed(2)}`,
  ).join('\n');

  const system = `You are a personal finance categoriser. Given a list of bank transactions and a list of categories, return a JSON object mapping each transaction ID to the best category ID. Only return the JSON object, nothing else. If you're unsure about a transaction, assign it to "Uncategorised". Salary-like credits go to "Salary". Large one-off credits from people/entities you don't recognise go to "Other Income".`;

  const user = `CATEGORIES (id:name):
${catsList}

TRANSACTIONS (id|description|amount_gbp):
${txList}

Return JSON: { "categorisations": [{"txId": 1, "categoryId": 5}, ...] }`;

  const update = db.prepare(`UPDATE transactions SET category_id = ? WHERE id = ?`);
  const errors: string[] = [];
  let categorised = 0;

  try {
    const res = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });

    const content = res.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content) as { categorisations: Array<{ txId: number; categoryId: number }> };
    const assignments = parsed.categorisations ?? [];

    const validCatIds = new Set(cats.map(c => c.id));
    const validTxIds = new Set(txs.map(t => t.id));

    db.exec('BEGIN');
    try {
      for (const a of assignments) {
        if (!validTxIds.has(a.txId) || !validCatIds.has(a.categoryId)) continue;
        update.run(a.categoryId, a.txId);
        categorised++;
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } catch (e: any) {
    errors.push(e.message ?? String(e));
  }

  return { categorised, skipped: txs.length - categorised, errors };
}
