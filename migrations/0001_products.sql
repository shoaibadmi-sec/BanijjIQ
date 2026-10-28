PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS product_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id TEXT NOT NULL UNIQUE,
  category_name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id TEXT NOT NULL UNIQUE,
  unit_name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL UNIQUE,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL,
  purchase_price REAL NOT NULL DEFAULT 0,
  selling_price REAL NOT NULL DEFAULT 0,
  current_stock REAL NOT NULL DEFAULT 0,
  minimum_stock REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Active',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_name_active
ON products(LOWER(product_name))
WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_products_category
ON products(category);

CREATE INDEX IF NOT EXISTS idx_products_unit
ON products(unit);

CREATE INDEX IF NOT EXISTS idx_products_stock
ON products(current_stock, minimum_stock);

CREATE TABLE IF NOT EXISTS stock_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id TEXT NOT NULL UNIQUE,
  product_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  original_quantity REAL NOT NULL DEFAULT 0,
  remaining_quantity REAL NOT NULL DEFAULT 0,
  unit_cost REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  FOREIGN KEY (product_id) REFERENCES products(product_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_lots_product_remaining
ON stock_lots(product_id, remaining_quantity);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  movement_id TEXT NOT NULL UNIQUE,
  product_id TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  quantity_in REAL NOT NULL DEFAULT 0,
  quantity_out REAL NOT NULL DEFAULT 0,
  balance_after REAL NOT NULL DEFAULT 0,
  note TEXT,
  lot_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(product_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product_created
ON stock_movements(product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_type
ON stock_movements(movement_type);
