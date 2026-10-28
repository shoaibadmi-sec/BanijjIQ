-- Business Finance + Finance Ledger
-- Ported from finance.html / financeLedger.html / FinanceModule.gs / DeleteEngine.gs

CREATE TABLE IF NOT EXISTS finance_persons (
  person_id TEXT PRIMARY KEY,
  person_name TEXT NOT NULL,
  person_type TEXT NOT NULL CHECK(person_type IN ('Owner','Lender')),
  phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_person_name_nocase ON finance_persons(lower(person_name));
CREATE INDEX IF NOT EXISTS idx_finance_person_status_type ON finance_persons(status, person_type, person_name);

CREATE TABLE IF NOT EXISTS finance_transactions (
  finance_id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  person_id TEXT NOT NULL,
  person_name TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  bank_account_id TEXT NOT NULL DEFAULT '',
  bank_account_name TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  reference_no TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_backdated INTEGER NOT NULL DEFAULT 0,
  backdated_days INTEGER NOT NULL DEFAULT 0,
  backdated_reason TEXT NOT NULL DEFAULT '',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  delete_reason TEXT NOT NULL DEFAULT '',
  deleted_by TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  FOREIGN KEY(person_id) REFERENCES finance_persons(person_id)
);

CREATE INDEX IF NOT EXISTS idx_finance_tx_active_date ON finance_transactions(is_deleted, date, created_at);
CREATE INDEX IF NOT EXISTS idx_finance_tx_person ON finance_transactions(person_id, is_deleted, date);
CREATE INDEX IF NOT EXISTS idx_finance_tx_type ON finance_transactions(transaction_type, is_deleted, date);
CREATE INDEX IF NOT EXISTS idx_finance_tx_payment ON finance_transactions(payment_method, bank_account_id, is_deleted, date);
