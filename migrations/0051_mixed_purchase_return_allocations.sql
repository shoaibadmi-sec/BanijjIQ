-- Phase 4C: append-only mixed-unit purchase return allocations, exact original-cost audit.
-- Does not modify existing purchases, product costs, or the Phase 3 migrations.
CREATE TABLE IF NOT EXISTS purchase_unit_return_allocations(
 return_id TEXT NOT NULL REFERENCES purchase_returns(return_id),
 purchase_id TEXT NOT NULL,
 product_id TEXT NOT NULL,
 lot_id TEXT NOT NULL REFERENCES stock_lots(lot_id),
 base_quantity INTEGER NOT NULL CHECK(base_quantity > 0),
 previous_return_quantity INTEGER NOT NULL CHECK(previous_return_quantity >= 0),
 return_micro INTEGER NOT NULL CHECK(return_micro >= 0),
 quantities_json TEXT NOT NULL,
 description TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(return_id, product_id),
 FOREIGN KEY(purchase_id, product_id) REFERENCES purchase_unit_snapshots(purchase_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_purchase_unit_returns_source
 ON purchase_unit_return_allocations(purchase_id, product_id);
CREATE TABLE IF NOT EXISTS purchase_unit_return_requests(
 request_id TEXT PRIMARY KEY,
 payload_json TEXT NOT NULL,
 return_id TEXT NOT NULL UNIQUE REFERENCES purchase_returns(return_id),
 total_amount REAL NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- All guards execute inside D1.batch. Parallel return requests cannot overdraw
-- the original source lot, the master stock, or the previously returned quantity.
CREATE TRIGGER IF NOT EXISTS purchase_unit_return_allocate_guard
 BEFORE INSERT ON purchase_unit_return_allocations
 BEGIN
  SELECT CASE WHEN NOT EXISTS(
   SELECT 1 FROM purchase_unit_snapshots s
    WHERE s.purchase_id=NEW.purchase_id AND s.product_id=NEW.product_id
      AND s.lot_id=NEW.lot_id
  ) THEN RAISE(ABORT,'wrong_original_purchase_lot') END;
  SELECT CASE WHEN NEW.previous_return_quantity<>COALESCE((
   SELECT SUM(base_quantity) FROM purchase_unit_return_allocations
    WHERE purchase_id=NEW.purchase_id AND product_id=NEW.product_id),0)
  THEN RAISE(ABORT,'stale_purchase_return_quantity') END;
  SELECT CASE WHEN NEW.base_quantity+NEW.previous_return_quantity>(
   SELECT base_quantity FROM purchase_unit_snapshots
    WHERE purchase_id=NEW.purchase_id AND product_id=NEW.product_id)
  THEN RAISE(ABORT,'purchase_return_exceeds_original_quantity') END;
  SELECT CASE WHEN NEW.base_quantity>COALESCE((
   SELECT remaining_quantity FROM stock_lots WHERE lot_id=NEW.lot_id),0)
  THEN RAISE(ABORT,'original_purchase_lot_already_consumed') END;
  SELECT CASE WHEN NEW.base_quantity>COALESCE((
   SELECT current_stock FROM products WHERE product_id=NEW.product_id),0)
  THEN RAISE(ABORT,'insufficient_stock_for_purchase_return') END;
 END;
CREATE TRIGGER IF NOT EXISTS mixed_purchase_return_lot_nonnegative
 BEFORE UPDATE OF remaining_quantity ON stock_lots
 WHEN NEW.remaining_quantity < 0 AND EXISTS(
  SELECT 1 FROM purchase_unit_snapshots s WHERE s.lot_id=OLD.lot_id)
 BEGIN SELECT RAISE(ABORT,'mixed_purchase_lot_negative'); END;
CREATE TRIGGER IF NOT EXISTS mixed_purchase_return_credit_guard
 BEFORE INSERT ON supplier_ledger
 WHEN NEW.type='Mixed Purchase Return Credit'
 BEGIN
  SELECT CASE WHEN (SELECT current_due FROM suppliers
    WHERE supplier_id=NEW.supplier_id) < -0.000001
    THEN RAISE(ABORT,'mixed_purchase_return_credit_exceeds_due') END;
 END;
