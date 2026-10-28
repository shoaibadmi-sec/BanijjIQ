-- V29 Vendor Ledger / Consignment settlement
ALTER TABLE vendors ADD COLUMN current_receivable REAL NOT NULL DEFAULT 0;

ALTER TABLE vendor_ledger ADD COLUMN payment_method TEXT NOT NULL DEFAULT '';
ALTER TABLE vendor_ledger ADD COLUMN balance_type TEXT NOT NULL DEFAULT 'Payable';
ALTER TABLE vendor_ledger ADD COLUMN is_backdated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vendor_ledger ADD COLUMN backdated_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vendor_ledger ADD COLUMN backdated_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE vendor_ledger ADD COLUMN created_by TEXT NOT NULL DEFAULT '';
ALTER TABLE vendor_ledger ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;

ALTER TABLE vendor_sourcing ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS vendor_returns (
  return_id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  vendor_name TEXT NOT NULL,
  sourcing_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  unit_cost REAL NOT NULL DEFAULT 0,
  total_value REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vendor_issues (
  issue_id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  vendor_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  unit_value REAL NOT NULL DEFAULT 0,
  total_value REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vendor_returns_received (
  return_id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  vendor_name TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  unit_value REAL NOT NULL DEFAULT 0,
  total_value REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_vendor_returns_vendor_sourcing
ON vendor_returns(vendor_id, sourcing_id, is_deleted);

CREATE INDEX IF NOT EXISTS idx_vendor_issues_vendor
ON vendor_issues(vendor_id, date, is_deleted);

CREATE INDEX IF NOT EXISTS idx_vendor_returns_received_vendor_issue
ON vendor_returns_received(vendor_id, issue_id, is_deleted);

CREATE INDEX IF NOT EXISTS idx_vendor_ledger_vendor_balance
ON vendor_ledger(vendor_id, balance_type, date, is_deleted);

CREATE INDEX IF NOT EXISTS idx_vendor_sourcing_vendor
ON vendor_sourcing(vendor_id, sale_date, is_deleted);
