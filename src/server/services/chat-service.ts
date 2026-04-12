import { db } from '../db/schema.js';
import { getOpenAI, getModel, isConfigured } from './openai-service.js';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Build a compact financial context for chat queries.
 * Sends rich aggregated data + optionally relevant raw transactions matching the query.
 */
function buildChatContext(query: string): string {
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  const lastMonth = (() => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
  })();

  const aggregate = (m: string) => {
    const from = `${m}-01`, to = `${m}-31`;
    const income = (db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM transactions WHERE is_transfer=0 AND amount>0 AND date>=? AND date<=?`).get(from, to) as any).t;
    const expense = (db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM transactions WHERE is_transfer=0 AND amount<0 AND date>=? AND date<=?`).get(from, to) as any).t;
    const cats = db.prepare(`
      SELECT c.name, ABS(SUM(t.amount)) AS total
      FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
      WHERE t.is_transfer=0 AND t.amount<0 AND t.date>=? AND t.date<=?
      GROUP BY c.id ORDER BY total DESC
    `).all(from, to) as any[];
    return { income, expense, cats };
  };

  const thisData = aggregate(thisMonth);
  const lastData = aggregate(lastMonth);

  // Free-text search: grab matching tx across the whole DB
  const searchTerms = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const matches: any[] = [];
  for (const term of searchTerms.slice(0, 3)) {
    const rows = db.prepare(`
      SELECT t.date, t.amount, t.description, c.name AS category
      FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
      WHERE t.is_transfer=0 AND (LOWER(t.description) LIKE ? OR LOWER(COALESCE(c.name,'')) LIKE ?)
      ORDER BY t.date DESC LIMIT 30
    `).all(`%${term}%`, `%${term}%`) as any[];
    matches.push(...rows);
  }
  const uniqueMatches = Array.from(new Map(matches.map(m => [`${m.date}|${m.amount}|${m.description}`, m])).values()).slice(0, 50);

  // Account balances
  const accounts = db.prepare(`
    SELECT a.name, a.type,
      COALESCE((SELECT SUM(amount) FROM transactions WHERE account_id=a.id),0) + a.opening_balance AS balance
    FROM accounts a WHERE a.active=1
  `).all() as any[];

  const fmt = (p: number) => `£${(Math.abs(p) / 100).toFixed(2)}`;
  const lines: string[] = [];

  lines.push('ACCOUNTS:');
  for (const a of accounts) lines.push(`  ${a.name} (${a.type}): ${fmt(a.balance)}`);
  lines.push('');

  lines.push(`THIS MONTH (${thisMonth}):`);
  lines.push(`  Income: ${fmt(thisData.income)}, Expense: ${fmt(thisData.expense)}, Net: ${fmt(thisData.income + thisData.expense)}`);
  for (const c of thisData.cats) lines.push(`    ${c.name ?? 'Uncategorised'}: ${fmt(c.total)}`);
  lines.push('');

  lines.push(`LAST MONTH (${lastMonth}):`);
  lines.push(`  Income: ${fmt(lastData.income)}, Expense: ${fmt(lastData.expense)}`);
  for (const c of lastData.cats) lines.push(`    ${c.name ?? 'Uncategorised'}: ${fmt(c.total)}`);

  if (uniqueMatches.length > 0) {
    lines.push('');
    lines.push(`TRANSACTIONS MATCHING YOUR QUESTION:`);
    for (const m of uniqueMatches) {
      lines.push(`  ${m.date} | ${fmt(m.amount)}${m.amount < 0 ? ' out' : ' in'} | ${m.description} | ${m.category ?? '—'}`);
    }
  }

  return lines.join('\n');
}

export async function chat(
  conversationId: number,
  userMessage: string,
): Promise<{ reply: string; conversationId: number }> {
  if (!isConfigured()) throw new Error('OpenAI API key not set');

  // Ensure conversation exists
  let convId = conversationId;
  if (!convId) {
    const res = db.prepare(`INSERT INTO ai_conversations (user_id, title) VALUES (?, ?)`)
      .run(1, userMessage.slice(0, 60));
    convId = Number(res.lastInsertRowid);
  }

  // Save user message
  db.prepare(`INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, ?, ?)`)
    .run(convId, 'user', userMessage);

  // Load history
  const history = db.prepare(`
    SELECT role, content FROM ai_messages WHERE conversation_id = ? ORDER BY id ASC
  `).all(convId) as ChatMessage[];

  const context = buildChatContext(userMessage);

  const openai = getOpenAI()!;
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are Tally, a personal finance assistant for a UK couple. You have access to their transaction data, accounts, and budgets. Answer questions directly and specifically using the data below. Always use GBP formatting (£1,234.56). Be warm but concise — no fluff.

DATA AS OF NOW:
${context}`,
    },
    ...history,
  ];

  const res = await openai.chat.completions.create({
    model: getModel(),
    messages: messages as any,
    temperature: 0.4,
  });

  const reply = res.choices[0]?.message?.content ?? '(no reply)';
  db.prepare(`INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, ?, ?)`)
    .run(convId, 'assistant', reply);

  return { reply, conversationId: convId };
}

export function listConversations(userId: number) {
  return db.prepare(`
    SELECT c.id, c.title, c.created_at,
      (SELECT content FROM ai_messages WHERE conversation_id=c.id ORDER BY id DESC LIMIT 1) AS last_message
    FROM ai_conversations c WHERE c.user_id = ? ORDER BY c.id DESC LIMIT 50
  `).all(userId);
}

export function getConversation(id: number) {
  const conv = db.prepare(`SELECT * FROM ai_conversations WHERE id = ?`).get(id);
  if (!conv) return null;
  const messages = db.prepare(`SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY id ASC`).all(id);
  return { conversation: conv, messages };
}

export function deleteConversation(id: number) {
  db.prepare(`DELETE FROM ai_conversations WHERE id = ?`).run(id);
}
