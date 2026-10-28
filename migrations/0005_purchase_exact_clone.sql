CREATE TABLE IF NOT EXISTS suppliers (
  supplier_id TEXT PRIMARY KEY,
  supplier_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  opening_balance REAL NOT NULL DEFAULT 0,
  current_due REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(supplier_name);
CREATE INDEX IF NOT EXISTS idx_suppliers_status ON suppliers(status, is_deleted);

CREATE TABLE IF NOT EXISTS supplier_ledger (
  ledger_id TEXT PRIMARY KEY,
  date TEXT NOT NULL DEFAULT (datetime('now')),
  supplier_id TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  type TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  balance REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier ON supplier_ledger(supplier_id, date);
CREATE INDEX IF NOT EXISTS idx_supplier_ledger_reference ON supplier_ledger(reference);

CREATE TABLE IF NOT EXISTS bank_accounts (
  bank_account_id TEXT PRIMARY KEY,
  account_name TEXT NOT NULL,
  bank_name TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL DEFAULT '',
  opening_balance REAL NOT NULL DEFAULT 0,
  current_balance REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active',
  account_type TEXT NOT NULL DEFAULT 'Bank',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_status ON bank_accounts(status);

ALTER TABLE purchases ADD COLUMN supplier_id TEXT NOT NULL DEFAULT '';
ALTER TABLE purchases ADD COLUMN discount REAL NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN grand_total REAL NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN paid_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN due_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'Paid';
ALTER TABLE purchases ADD COLUMN payment_method TEXT NOT NULL DEFAULT '';
ALTER TABLE purchases ADD COLUMN bank_account_id TEXT NOT NULL DEFAULT '';
ALTER TABLE purchases ADD COLUMN bank_account_name TEXT NOT NULL DEFAULT '';
ALTER TABLE purchases ADD COLUMN returned_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN is_backdated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN backdated_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN backdated_reason TEXT NOT NULL DEFAULT '';

UPDATE purchases
SET grand_total = CASE WHEN grand_total = 0 THEN subtotal ELSE grand_total END,
    payment_status = CASE WHEN due_amount > 0 THEN 'Due' ELSE 'Paid' END;
