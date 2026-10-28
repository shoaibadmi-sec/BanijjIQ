PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS product_brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id TEXT NOT NULL UNIQUE,
  brand_name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE products ADD COLUMN brand TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
