PRAGMA foreign_keys = ON;

-- Optional preferred supplier on the product master. Existing products remain valid.
ALTER TABLE products ADD COLUMN preferred_supplier_id TEXT NOT NULL DEFAULT '';

-- Trace an approved supplier order through to the actual received purchase.
ALTER TABLE purchases ADD COLUMN purchase_plan_order_id TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS purchase_plans (
  plan_id TEXT PRIMARY KEY,
  plan_no TEXT NOT NULL UNIQUE,
  plan_date TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'ALL',
  scope_supplier_id TEXT NOT NULL DEFAULT '',
  sales_window_days INTEGER NOT NULL DEFAULT 30,
  target_cover_days INTEGER NOT NULL DEFAULT 30,
  budget_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Draft',
  total_investment REAL NOT NULL DEFAULT 0,
  expected_sales_value REAL NOT NULL DEFAULT 0,
  expected_gross_profit REAL NOT NULL DEFAULT 0,
  margin_percent REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT
);

CREATE TABLE IF NOT EXISTS purchase_plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  supplier_id TEXT NOT NULL DEFAULT '',
  supplier_name TEXT NOT NULL DEFAULT '',
  current_stock REAL NOT NULL DEFAULT 0,
  reorder_level REAL NOT NULL DEFAULT 0,
  recent_sales_qty REAL NOT NULL DEFAULT 0,
  sales_velocity REAL NOT NULL DEFAULT 0,
  stock_cover_days REAL,
  pending_order_qty REAL NOT NULL DEFAULT 0,
  last_purchase_cost REAL NOT NULL DEFAULT 0,
  selling_price REAL NOT NULL DEFAULT 0,
  priority TEXT NOT NULL DEFAULT 'Low',
  suggested_qty INTEGER NOT NULL DEFAULT 0,
  planned_qty INTEGER NOT NULL DEFAULT 0,
  planned_investment REAL NOT NULL DEFAULT 0,
  expected_sales_value REAL NOT NULL DEFAULT 0,
  expected_gross_profit REAL NOT NULL DEFAULT 0,
  margin_percent REAL NOT NULL DEFAULT 0,
  is_new_product INTEGER NOT NULL DEFAULT 0,
  included INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_plan_orders (
  order_id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  plan_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  order_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Open',
  converted_purchase_id TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_plan_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_preferred_supplier
ON products(preferred_supplier_id, status, is_deleted);

CREATE INDEX IF NOT EXISTS idx_sales_planner_active_date
ON sales(is_deleted, status, sale_date, invoice_id);

CREATE INDEX IF NOT EXISTS idx_sale_items_planner_product_invoice
ON sale_items(product_id, invoice_id);

CREATE INDEX IF NOT EXISTS idx_sales_returns_planner_date_invoice
ON sales_returns(return_date, invoice_id);

CREATE INDEX IF NOT EXISTS idx_sales_return_items_planner_product_invoice
ON sales_return_items(product_id, invoice_id);

CREATE INDEX IF NOT EXISTS idx_purchases_planner_active_date
ON purchases(is_deleted, status, purchase_date, purchase_id);

CREATE INDEX IF NOT EXISTS idx_purchase_items_planner_product_purchase
ON purchase_items(product_id, purchase_id);

CREATE INDEX IF NOT EXISTS idx_purchase_plan_items_plan_supplier
ON purchase_plan_items(plan_id, supplier_id, included);

CREATE INDEX IF NOT EXISTS idx_purchase_plan_items_product
ON purchase_plan_items(product_id, plan_id);

CREATE INDEX IF NOT EXISTS idx_purchase_plan_orders_plan_status
ON purchase_plan_orders(plan_id, status);

CREATE INDEX IF NOT EXISTS idx_purchase_plan_orders_supplier_status
ON purchase_plan_orders(supplier_id, status, order_date);

CREATE INDEX IF NOT EXISTS idx_purchase_plan_order_items_order_product
ON purchase_plan_order_items(order_id, product_id);

CREATE INDEX IF NOT EXISTS idx_purchases_plan_order
ON purchases(purchase_plan_order_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_plan_order_unique
ON purchases(purchase_plan_order_id)
WHERE purchase_plan_order_id <> '';
