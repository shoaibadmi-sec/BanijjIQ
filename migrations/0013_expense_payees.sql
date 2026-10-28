-- Optional expense payee identity + payee ledger support.
-- Expense category remains the accounting classification; payee is an optional person/entity receiving money.
CREATE TABLE IF NOT EXISTS expense_payees (
  payee_id TEXT PRIMARY KEY,
  payee_name TEXT NOT NULL COLLATE NOCASE,
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_expense_payees_status_name
  ON expense_payees(status, payee_name COLLATE NOCASE);

-- Preserve any older expense rows that already used ledger_id / ledger_name.
INSERT OR IGNORE INTO expense_payees(payee_id, payee_name, status)
SELECT DISTINCT ledger_id, ledger_name, 'Active'
FROM expenses
WHERE COALESCE(ledger_id, '') <> '' AND COALESCE(ledger_name, '') <> '';

CREATE INDEX IF NOT EXISTS idx_expenses_payee_date
  ON expenses(ledger_id, expense_date DESC, created_at DESC);
