-- Sales Management + Sales Return, ported from sales.html / SalesManagement.gs / SalesReturn.gs / DeleteEngine.gs
ALTER TABLE sales ADD COLUMN delete_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE sales ADD COLUMN deleted_by TEXT NOT NULL DEFAULT '';
ALTER TABLE sales ADD COLUMN deleted_at TEXT;

CREATE TABLE IF NOT EXISTS sales_returns (
  return_id TEXT PRIMARY KEY,
  return_date TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  customer_id TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  refund_method TEXT NOT NULL,
  total_return_amount REAL NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  processed_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales_return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  return_quantity REAL NOT NULL DEFAULT 0,
  return_price REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sales_returns_invoice ON sales_returns(invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_return_items_invoice ON sales_return_items(invoice_id, product_id);
CREATE INDEX IF NOT EXISTS idx_sales_return_items_return ON sales_return_items(return_id);
