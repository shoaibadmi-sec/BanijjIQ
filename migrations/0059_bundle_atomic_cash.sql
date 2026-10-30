-- Virtual bundle master, immutable sale recipe, FIFO source attribution, and safety hold.
-- This slice posts only cash sales. Returns, edits and cancellations are deliberately forbidden
-- until exact historical recipe / lot / cash refund reversals are implemented.
ALTER TABLE products ADD COLUMN product_type TEXT NOT NULL DEFAULT 'Standard'
  CHECK(product_type IN ('Standard','Bundle'));
ALTER TABLE products ADD COLUMN bundle_revision INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS bundle_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bundle_id TEXT NOT NULL REFERENCES products(product_id),
  revision INTEGER NOT NULL CHECK(revision>=1),
  component_id TEXT NOT NULL REFERENCES products(product_id),
  quantity_per_set INTEGER NOT NULL CHECK(quantity_per_set>0),
  unit_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  UNIQUE(bundle_id,revision,component_id)
);
CREATE INDEX IF NOT EXISTS idx_bundle_component_lookup ON bundle_components(bundle_id,revision,id);

CREATE TABLE IF NOT EXISTS sale_bundle_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id TEXT NOT NULL REFERENCES sales(invoice_id),
  bundle_id TEXT NOT NULL REFERENCES products(product_id),
  revision INTEGER NOT NULL,
  component_id TEXT NOT NULL REFERENCES products(product_id),
  quantity_per_set INTEGER NOT NULL CHECK(quantity_per_set>0),
  sets_sold INTEGER NOT NULL CHECK(sets_sold>0),
  component_quantity INTEGER NOT NULL CHECK(component_quantity>0),
  unit_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  UNIQUE(invoice_id,bundle_id,component_id)
);

CREATE TABLE IF NOT EXISTS bundle_sale_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id TEXT NOT NULL REFERENCES sales(invoice_id),
  visible_product_id TEXT NOT NULL REFERENCES products(product_id),
  component_id TEXT NOT NULL REFERENCES products(product_id),
  lot_id TEXT NOT NULL REFERENCES stock_lots(lot_id),
  movement_id TEXT NOT NULL UNIQUE REFERENCES stock_movements(movement_id),
  quantity REAL NOT NULL CHECK(quantity>0),
  unit_cost REAL NOT NULL CHECK(unit_cost>0),
  cost_minor INTEGER NOT NULL CHECK(cost_minor>=0),
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bundle_sale_alloc_invoice ON bundle_sale_allocations(invoice_id,visible_product_id);
-- Prevent legacy sale editing, invoice deletion and returns from incorrectly restoring a virtual
-- bundle instead of its physical components. The financial lifecycle is a separate Phase 7E3 gate.
CREATE TRIGGER IF NOT EXISTS guard_bundle_sale_update
BEFORE UPDATE ON sales
WHEN EXISTS(SELECT 1 FROM sale_bundle_components WHERE invoice_id=OLD.invoice_id)
BEGIN SELECT RAISE(ABORT,'BUNDLE_LIFECYCLE_NOT_READY: sale immutable until component reversals'); END;
CREATE TRIGGER IF NOT EXISTS guard_bundle_sale_delete
BEFORE DELETE ON sales
WHEN EXISTS(SELECT 1 FROM sale_bundle_components WHERE invoice_id=OLD.invoice_id)
BEGIN SELECT RAISE(ABORT,'BUNDLE_LIFECYCLE_NOT_READY'); END;
CREATE TRIGGER IF NOT EXISTS guard_bundle_return
BEFORE INSERT ON sales_returns
WHEN EXISTS(SELECT 1 FROM sale_bundle_components WHERE invoice_id=NEW.invoice_id)
BEGIN SELECT RAISE(ABORT,'BUNDLE_LIFECYCLE_NOT_READY: whole-set return not implemented'); END;
CREATE TRIGGER IF NOT EXISTS guard_bundle_return_item
BEFORE INSERT ON sales_return_items
WHEN EXISTS(SELECT 1 FROM sale_bundle_components WHERE invoice_id=NEW.invoice_id)
BEGIN SELECT RAISE(ABORT,'BUNDLE_LIFECYCLE_NOT_READY'); END;
CREATE TRIGGER IF NOT EXISTS guard_bundle_item_update
BEFORE UPDATE ON sale_items
WHEN EXISTS(SELECT 1 FROM sale_bundle_components WHERE invoice_id=OLD.invoice_id)
BEGIN SELECT RAISE(ABORT,'BUNDLE_LIFECYCLE_NOT_READY'); END;
CREATE TRIGGER IF NOT EXISTS guard_bundle_item_delete
BEFORE DELETE ON sale_items
WHEN EXISTS(SELECT 1 FROM sale_bundle_components WHERE invoice_id=OLD.invoice_id)
BEGIN SELECT RAISE(ABORT,'BUNDLE_LIFECYCLE_NOT_READY'); END;


-- Virtual bundles have no physical stock. Other modules must update components, not the kit.
CREATE TRIGGER IF NOT EXISTS guard_virtual_bundle_stock_update
BEFORE UPDATE OF current_stock ON products
WHEN OLD.product_type='Bundle' AND NEW.current_stock<>0
BEGIN SELECT RAISE(ABORT,'VIRTUAL_BUNDLE_STOCK_FORBIDDEN'); END;
CREATE TRIGGER IF NOT EXISTS guard_virtual_bundle_fifo_lot_insert
BEFORE INSERT ON stock_lots
WHEN EXISTS(SELECT 1 FROM products WHERE product_id=NEW.product_id AND product_type='Bundle')
BEGIN SELECT RAISE(ABORT,'VIRTUAL_BUNDLE_FIFO_LOT_FORBIDDEN'); END;
CREATE TRIGGER IF NOT EXISTS guard_virtual_bundle_movement_insert
BEFORE INSERT ON stock_movements
WHEN EXISTS(SELECT 1 FROM products WHERE product_id=NEW.product_id AND product_type='Bundle')
BEGIN SELECT RAISE(ABORT,'VIRTUAL_BUNDLE_STOCK_MOVEMENT_FORBIDDEN'); END;
CREATE TRIGGER IF NOT EXISTS guard_bundle_product_type_change
BEFORE UPDATE OF product_type ON products
WHEN OLD.product_type<>NEW.product_type
BEGIN SELECT RAISE(ABORT,'BUNDLE_PRODUCT_TYPE_IMMUTABLE'); END;
