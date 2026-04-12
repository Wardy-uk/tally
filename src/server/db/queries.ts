import { db } from './schema.js';

// ===== Users =====
export const UserQueries = {
  findByUsername: db.prepare(`SELECT * FROM users WHERE username = ?`),
  findById: db.prepare(`SELECT * FROM users WHERE id = ?`),
  list: db.prepare(`SELECT id, username, display_name, role, created_at FROM users ORDER BY id`),
  create: db.prepare(`
    INSERT INTO users (username, display_name, password_hash, role)
    VALUES (?, ?, ?, ?)
  `),
  count: db.prepare(`SELECT COUNT(*) as c FROM users`),
  updatePassword: db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`),
  updateProfile: db.prepare(`UPDATE users SET display_name = ?, role = ? WHERE id = ?`),
  delete: db.prepare(`DELETE FROM users WHERE id = ?`),
};

// ===== Accounts =====
export const AccountQueries = {
  list: db.prepare(`
    SELECT a.*,
      COALESCE((SELECT SUM(amount) FROM transactions WHERE account_id = a.id), 0) + a.opening_balance AS current_balance
    FROM accounts a
    WHERE a.active = 1
    ORDER BY a.name
  `),
  findById: db.prepare(`SELECT * FROM accounts WHERE id = ?`),
  create: db.prepare(`
    INSERT INTO accounts (name, type, owner_user_id, bank, account_number, sort_code, opening_balance)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  update: db.prepare(`
    UPDATE accounts SET name = ?, type = ?, owner_user_id = ?, bank = ?,
      account_number = ?, sort_code = ?, opening_balance = ?
    WHERE id = ?
  `),
  archive: db.prepare(`UPDATE accounts SET active = 0 WHERE id = ?`),
  delete: db.prepare(`DELETE FROM accounts WHERE id = ?`),
};

// ===== Categories =====
export const CategoryQueries = {
  list: db.prepare(`SELECT * FROM categories ORDER BY kind, name`),
  findById: db.prepare(`SELECT * FROM categories WHERE id = ?`),
  findByName: db.prepare(`SELECT * FROM categories WHERE LOWER(name) = LOWER(?)`),
  create: db.prepare(`
    INSERT INTO categories (name, parent_id, icon, color, kind)
    VALUES (?, ?, ?, ?, ?)
  `),
  update: db.prepare(`
    UPDATE categories SET name = ?, icon = ?, color = ?, kind = ? WHERE id = ?
  `),
  delete: db.prepare(`DELETE FROM categories WHERE id = ? AND system_locked = 0`),
};

// ===== Transactions =====
export const TransactionQueries = {
  listByAccount: db.prepare(`
    SELECT t.*, c.name AS category_name, c.color AS category_color, c.icon AS category_icon
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.account_id = ?
    ORDER BY t.date DESC, t.id DESC
    LIMIT ? OFFSET ?
  `),
  listAll: db.prepare(`
    SELECT t.*, c.name AS category_name, c.color AS category_color, c.icon AS category_icon,
           a.name AS account_name
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN accounts a ON a.id = t.account_id
    ORDER BY t.date DESC, t.id DESC
    LIMIT ? OFFSET ?
  `),
  findById: db.prepare(`SELECT * FROM transactions WHERE id = ?`),
  findByDedupeHash: db.prepare(`SELECT id FROM transactions WHERE dedupe_hash = ? AND account_id = ?`),
  insert: db.prepare(`
    INSERT INTO transactions (account_id, date, amount, description, merchant,
      category_id, is_transfer, import_batch_id, dedupe_hash, balance_after)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateCategory: db.prepare(`UPDATE transactions SET category_id = ? WHERE id = ?`),
  updateTransferPair: db.prepare(`
    UPDATE transactions SET is_transfer = 1, transfer_pair_id = ? WHERE id = ?
  `),
  updateNotes: db.prepare(`UPDATE transactions SET notes = ? WHERE id = ?`),
  delete: db.prepare(`DELETE FROM transactions WHERE id = ?`),
  deleteByBatch: db.prepare(`DELETE FROM transactions WHERE import_batch_id = ?`),
  // Aggregates
  monthlySumByCategory: db.prepare(`
    SELECT category_id, SUM(amount) AS total, COUNT(*) AS count
    FROM transactions
    WHERE is_transfer = 0 AND date >= ? AND date <= ?
    GROUP BY category_id
  `),
  countUncategorised: db.prepare(`
    SELECT COUNT(*) as c FROM transactions WHERE category_id IS NULL AND is_transfer = 0
  `),
};

// ===== Rules =====
export const RuleQueries = {
  list: db.prepare(`SELECT * FROM rules ORDER BY priority DESC, id`),
  create: db.prepare(`
    INSERT INTO rules (name, match_field, match_type, match_value, category_id, priority, created_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  delete: db.prepare(`DELETE FROM rules WHERE id = ?`),
};

// ===== Budgets =====
export const BudgetQueries = {
  list: db.prepare(`
    SELECT b.*, c.name AS category_name, c.color AS category_color, c.icon AS category_icon
    FROM budgets b JOIN categories c ON c.id = b.category_id
    WHERE b.active = 1
    ORDER BY c.name
  `),
  upsert: db.prepare(`
    INSERT INTO budgets (category_id, monthly_amount, source, start_month, active)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(category_id) DO UPDATE SET
      monthly_amount = excluded.monthly_amount,
      source = excluded.source,
      active = 1
  `),
  delete: db.prepare(`DELETE FROM budgets WHERE id = ?`),
};

// ===== Salary =====
export const SalaryQueries = {
  listByUser: db.prepare(`SELECT * FROM salary_profiles WHERE user_id = ? ORDER BY effective_from DESC`),
  current: db.prepare(`
    SELECT * FROM salary_profiles WHERE user_id = ?
    ORDER BY effective_from DESC LIMIT 1
  `),
  create: db.prepare(`
    INSERT INTO salary_profiles (user_id, base_salary_monthly, pay_day, pay_day_type, account_id, effective_from)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  delete: db.prepare(`DELETE FROM salary_profiles WHERE id = ?`),
};

// ===== Import batches =====
export const ImportBatchQueries = {
  list: db.prepare(`
    SELECT ib.*, a.name AS account_name, u.display_name AS created_by_name
    FROM import_batches ib
    LEFT JOIN accounts a ON a.id = ib.account_id
    LEFT JOIN users u ON u.id = ib.created_by_user_id
    ORDER BY ib.id DESC
    LIMIT 50
  `),
  create: db.prepare(`
    INSERT INTO import_batches (account_id, filename, row_count, imported_count, skipped_count, date_from, date_to, created_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  delete: db.prepare(`DELETE FROM import_batches WHERE id = ?`),
};

// ===== Audit =====
export const AuditQueries = {
  log: db.prepare(`INSERT INTO audit_log (user_id, action, target, meta) VALUES (?, ?, ?, ?)`),
  list: db.prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT 200`),
};
