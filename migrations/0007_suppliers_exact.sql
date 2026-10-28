-- Supplier module exact-port support from Suppliers.gs / DeleteEngine.gs
ALTER TABLE supplier_ledger ADD COLUMN bank_account_id TEXT NOT NULL DEFAULT '';
ALTER TABLE supplier_ledger ADD COLUMN is_backdated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE supplier_ledger ADD COLUMN backdated_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE supplier_ledger ADD COLUMN backdated_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE supplier_ledger ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE supplier_ledger ADD COLUMN delete_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE supplier_ledger ADD COLUMN deleted_by TEXT NOT NULL DEFAULT '';
ALTER TABLE supplier_ledger ADD COLUMN deleted_at TEXT;

ALTER TABLE suppliers ADD COLUMN delete_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN deleted_by TEXT NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN deleted_at TEXT;

CREATE TABLE IF NOT EXISTS cash_sessions (
  session_id TEXT PRIMARY KEY,
  opened_by TEXT NOT NULL DEFAULT '',
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  opening_cash REAL NOT NULL DEFAULT 0,
  opening_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Open',
  closed_at TEXT,
  counted_cash REAL,
  closing_note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_status ON cash_sessions(status, opened_at DESC);

CREATE TABLE IF NOT EXISTS cash_book (
  entry_id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'Cash',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cash_book_reference ON cash_book(reference);

CREATE TABLE IF NOT EXISTS bank_book (
  entry_id TEXT PRIMARY KEY,
  bank_account_id TEXT NOT NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bank_book_reference ON bank_book(reference);
