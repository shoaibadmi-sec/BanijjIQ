ALTER TABLE purchases ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN delete_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE purchases ADD COLUMN deleted_by TEXT NOT NULL DEFAULT '';
ALTER TABLE purchases ADD COLUMN deleted_at TEXT;

CREATE TABLE IF NOT EXISTS purchase_returns (
  return_id TEXT PRIMARY KEY,
  return_date TEXT NOT NULL,
  purchase_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL DEFAULT '',
  supplier_name TEXT NOT NULL DEFAULT '',
  total_return_amount REAL NOT NULL DEFAULT 0,
  refund_method TEXT NOT NULL DEFAULT 'Supplier Credit',
  reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  processed_by TEXT NOT NULL DEFAULT '',
  is_backdated INTEGER NOT NULL DEFAULT 0,
  backdated_reason TEXT NOT NULL DEFAULT '',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  return_quantity REAL NOT NULL DEFAULT 0,
  return_price REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_edit_logs (
  log_id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'PURCHASE',
  reason TEXT NOT NULL DEFAULT '',
  before_total REAL NOT NULL DEFAULT 0,
  after_total REAL NOT NULL DEFAULT 0,
  edited_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_purchase_returns_purchase ON purchase_returns(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_return_items_purchase ON purchase_return_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_return_items_return ON purchase_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_invoice_edit_logs_invoice ON invoice_edit_logs(invoice_id);
