-- POS + Cash Session + Sales core, ported from pos.html / CashSession.gs / Sales.gs
ALTER TABLE cash_sessions ADD COLUMN expected_cash REAL;
ALTER TABLE cash_sessions ADD COLUMN variance REAL;

ALTER TABLE stock_lots ADD COLUMN supplier_id TEXT NOT NULL DEFAULT '';
ALTER TABLE stock_lots ADD COLUMN supplier_name TEXT NOT NULL DEFAULT '';
ALTER TABLE stock_lots ADD COLUMN status TEXT NOT NULL DEFAULT 'Active';

CREATE TABLE IF NOT EXISTS customers (
  customer_id TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  father_name TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  current_due REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Active',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(customer_name);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS customer_ledger (
  ledger_id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  type TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  balance REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customer_ledger_customer ON customer_ledger(customer_id, date);
CREATE INDEX IF NOT EXISTS idx_customer_ledger_reference ON customer_ledger(reference);

CREATE TABLE IF NOT EXISTS vendors (
  vendor_id TEXT PRIMARY KEY,
  vendor_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  current_due REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vendors_status ON vendors(status);

CREATE TABLE IF NOT EXISTS vendor_ledger (
  ledger_id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  vendor_name TEXT NOT NULL,
  type TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  balance REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vendor_ledger_vendor ON vendor_ledger(vendor_id, date);

CREATE TABLE IF NOT EXISTS sales (
  invoice_id TEXT PRIMARY KEY,
  sale_date TEXT NOT NULL,
  sale_time TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_address TEXT NOT NULL DEFAULT '',
  customer_father_name TEXT NOT NULL DEFAULT '',
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  grand_total REAL NOT NULL DEFAULT 0,
  paid_amount REAL NOT NULL DEFAULT 0,
  due_amount REAL NOT NULL DEFAULT 0,
  payment_type TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  payment_method TEXT NOT NULL DEFAULT '',
  bank_account_id TEXT NOT NULL DEFAULT '',
  bank_account_name TEXT NOT NULL DEFAULT '',
  is_backdated INTEGER NOT NULL DEFAULT 0,
  backdated_reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Completed',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_customer_phone ON sales(customer_phone, sale_date DESC);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sale_items_invoice ON sale_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);

CREATE TABLE IF NOT EXISTS sale_item_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  lot_id TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  supplier_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sale_item_lots_invoice ON sale_item_lots(invoice_id, product_id);

CREATE TABLE IF NOT EXISTS vendor_sourcing (
  sourcing_id TEXT PRIMARY KEY,
  sale_date TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  vendor_name TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_cost REAL NOT NULL,
  total_cost REAL NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vendor_sourcing_invoice ON vendor_sourcing(invoice_id);
