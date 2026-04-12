import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../../tally.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

function buildSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      owner_user_id INTEGER,
      bank TEXT,
      account_number TEXT,
      sort_code TEXT,
      opening_balance INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (owner_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      icon TEXT,
      color TEXT,
      kind TEXT NOT NULL DEFAULT 'expense',
      system_locked INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (parent_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      imported_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      date_from TEXT,
      date_to TEXT,
      created_by_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      amount INTEGER NOT NULL,
      description TEXT NOT NULL,
      merchant TEXT,
      category_id INTEGER,
      notes TEXT,
      is_transfer INTEGER NOT NULL DEFAULT 0,
      transfer_pair_id INTEGER,
      import_batch_id INTEGER,
      dedupe_hash TEXT NOT NULL,
      balance_after INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions(account_id, date DESC);
    CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);
    CREATE INDEX IF NOT EXISTS idx_tx_dedupe ON transactions(dedupe_hash);
    CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date DESC);

    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      match_field TEXT NOT NULL,
      match_type TEXT NOT NULL,
      match_value TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      priority INTEGER NOT NULL DEFAULT 100,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL UNIQUE,
      monthly_amount INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      start_month TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS salary_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      base_salary_monthly INTEGER NOT NULL,
      pay_day INTEGER NOT NULL DEFAULT 28,
      account_id INTEGER,
      effective_from TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      filepath TEXT NOT NULL,
      thumbnail_path TEXT,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      ocr_merchant TEXT,
      ocr_total INTEGER,
      ocr_date TEXT,
      uploaded_by_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL,
      FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS recurring_charges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant TEXT NOT NULL,
      typical_amount INTEGER NOT NULL,
      cadence TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      next_expected TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      ignored INTEGER NOT NULL DEFAULT 0,
      detected_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS csv_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      delimiter TEXT NOT NULL DEFAULT ',',
      skip_rows INTEGER NOT NULL DEFAULT 0,
      date_column TEXT NOT NULL,
      date_format TEXT NOT NULL,
      description_column TEXT NOT NULL,
      amount_column TEXT,
      debit_column TEXT,
      credit_column TEXT,
      balance_column TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      target TEXT,
      meta TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

}

function seedCategories() {
  const count = (db.prepare('SELECT COUNT(*) as c FROM categories').get() as { c: number }).c;
  if (count > 0) return;

  const seed = db.prepare(`
    INSERT INTO categories (name, kind, icon, color, system_locked)
    VALUES (?, ?, ?, ?, ?)
  `);

  const cats: Array<[string, string, string, string, number]> = [
    ['Salary', 'income', 'briefcase', '#4ade80', 1],
    ['Other Income', 'income', 'trending-up', '#4ade80', 1],
    ['Transfer', 'transfer', 'arrow-left-right', '#94a3b8', 1],
    ['Groceries', 'expense', 'shopping-cart', '#fbbf24', 0],
    ['Eating Out', 'expense', 'utensils', '#fb7185', 0],
    ['Transport', 'expense', 'car', '#38bdf8', 0],
    ['Fuel', 'expense', 'fuel', '#38bdf8', 0],
    ['Bills & Utilities', 'expense', 'zap', '#a78bfa', 0],
    ['Rent / Mortgage', 'expense', 'home', '#a78bfa', 0],
    ['Entertainment', 'expense', 'film', '#fb7185', 0],
    ['Subscriptions', 'expense', 'repeat', '#a78bfa', 0],
    ['Shopping', 'expense', 'shopping-bag', '#fbbf24', 0],
    ['Health', 'expense', 'heart', '#4ade80', 0],
    ['Holidays', 'expense', 'plane', '#38bdf8', 0],
    ['Savings', 'expense', 'piggy-bank', '#4ade80', 0],
    ['Cash', 'expense', 'banknote', '#94a3b8', 0],
    ['Fees & Charges', 'expense', 'alert-circle', '#fb7185', 0],
    ['Gifts', 'expense', 'gift', '#fb7185', 0],
    ['Uncategorised', 'expense', 'help-circle', '#64748b', 1],
  ];

  for (const c of cats) seed.run(...c);
}

// Run schema init at module load so any downstream import gets a ready DB
buildSchema();
seedCategories();

export function initSchema() {
  // No-op kept for API compatibility; schema is built at module load.
}

