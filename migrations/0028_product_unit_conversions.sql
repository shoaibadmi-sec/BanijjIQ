-- Optional product-specific quantity conversions. All stock and accounting remain
-- in the product's existing canonical (smallest) unit.
CREATE TABLE IF NOT EXISTS product_unit_conversions (
  product_id TEXT NOT NULL,
  unit_name TEXT NOT NULL COLLATE NOCASE,
  smaller_unit TEXT NOT NULL,
  units_per_smaller INTEGER NOT NULL CHECK (units_per_smaller > 1 AND units_per_smaller <= 1000000),
  base_factor INTEGER NOT NULL CHECK (base_factor > 1 AND base_factor <= 1000000000),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (product_id, unit_name),
  FOREIGN KEY (product_id) REFERENCES products(product_id)
);
CREATE INDEX IF NOT EXISTS idx_product_unit_conversions_product ON product_unit_conversions(product_id, sort_order);
-- Durable display snapshot; quantity/unit_price remain canonical and unchanged.
ALTER TABLE sale_items ADD COLUMN unit_breakdown_json TEXT NOT NULL DEFAULT '[]';
