-- Bundles are virtual sale kits: zero physical stock, components own their own stock.
ALTER TABLE products ADD COLUMN product_type TEXT NOT NULL DEFAULT 'Standard'
  CHECK(product_type IN ('Standard','Bundle'));
ALTER TABLE products ADD COLUMN bundle_revision INTEGER NOT NULL DEFAULT 0;
CREATE TABLE bundle_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bundle_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>=1),
  component_id TEXT NOT NULL,
  quantity_per_set INTEGER NOT NULL CHECK(quantity_per_set>=1),
  unit_snapshot TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(bundle_id,revision,component_id),
  FOREIGN KEY (bundle_id) REFERENCES products(product_id),
  FOREIGN KEY (component_id) REFERENCES products(product_id)
);
CREATE INDEX idx_bundle_components_current ON bundle_components(bundle_id,revision,is_active);
CREATE INDEX idx_bundle_components_physical ON bundle_components(component_id,is_active);
-- Future sale posting must capture the exact recipe; no rewriting historical components.
CREATE TABLE sale_bundle_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id TEXT NOT NULL,
  bundle_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  component_id TEXT NOT NULL,
  quantity_per_set INTEGER NOT NULL,
  sets_sold INTEGER NOT NULL,
  component_quantity INTEGER NOT NULL,
  unit_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(invoice_id,bundle_id,component_id)
);
ALTER TABLE sale_items ADD COLUMN sold_product_type TEXT NOT NULL DEFAULT 'Standard';
ALTER TABLE sale_item_lots ADD COLUMN source_sale_product_id TEXT NOT NULL DEFAULT '';
ALTER TABLE stock_movements ADD COLUMN source_sale_product_id TEXT NOT NULL DEFAULT '';
ALTER TABLE sales_return_items ADD COLUMN sold_product_type TEXT NOT NULL DEFAULT 'Standard';
