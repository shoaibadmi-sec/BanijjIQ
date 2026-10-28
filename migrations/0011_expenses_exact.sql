-- Expense module exact-port support from expense.html / expenseList.html / expenseCategory.html / Expense.gs / ExpenseSettings.gs
CREATE TABLE IF NOT EXISTS expense_categories (
  category_id TEXT PRIMARY KEY,
  category_name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expense_categories_status_name ON expense_categories(status, category_name);

CREATE TABLE IF NOT EXISTS expenses (
  expense_id TEXT PRIMARY KEY,
  expense_date TEXT NOT NULL,
  category_id TEXT NOT NULL,
  category_name TEXT NOT NULL,
  ledger_id TEXT NOT NULL DEFAULT '',
  ledger_name TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  reference_no TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  bank_account_id TEXT NOT NULL DEFAULT '',
  bank_account_name TEXT NOT NULL DEFAULT '',
  is_backdated INTEGER NOT NULL DEFAULT 0,
  backdated_days INTEGER NOT NULL DEFAULT 0,
  backdated_reason TEXT NOT NULL DEFAULT '',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_by TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  delete_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_payment ON expenses(payment_method, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status, is_deleted, expense_date DESC);
