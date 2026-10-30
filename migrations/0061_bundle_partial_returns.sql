-- Phase 7E3B1: repeated partial returns of complete bundle sets with per-source lifetime capacity.
-- Existing full-invoice bundle cash refund provenance stays immutable and operational.
CREATE TABLE IF NOT EXISTS bundle_partial_return_requests(
 request_id TEXT PRIMARY KEY,
 return_id TEXT NOT NULL UNIQUE,
 invoice_id TEXT NOT NULL REFERENCES sales(invoice_id),
 bundle_id TEXT NOT NULL REFERENCES products(product_id),
 sets_returned INTEGER NOT NULL CHECK(sets_returned>0),
 payload_sha256 TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bundle_partial_invoice ON bundle_partial_return_requests(invoice_id,created_at);

CREATE TABLE IF NOT EXISTS bundle_partial_return_allocations(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 return_id TEXT NOT NULL REFERENCES sales_returns(return_id),
 invoice_id TEXT NOT NULL REFERENCES sales(invoice_id),
 visible_product_id TEXT NOT NULL REFERENCES products(product_id),
 component_id TEXT NOT NULL REFERENCES products(product_id),
 lot_id TEXT NOT NULL REFERENCES stock_lots(lot_id),
 source_allocation_id INTEGER NOT NULL REFERENCES bundle_sale_allocations(id),
 movement_id TEXT NOT NULL UNIQUE REFERENCES stock_movements(movement_id),
 quantity INTEGER NOT NULL CHECK(quantity>0),
 unit_cost REAL NOT NULL CHECK(unit_cost>0),
 cost_minor INTEGER NOT NULL CHECK(cost_minor>=0),
 created_at TEXT NOT NULL DEFAULT(datetime('now')),
 UNIQUE(return_id,source_allocation_id)
);
CREATE INDEX IF NOT EXISTS idx_bundle_partial_source ON bundle_partial_return_allocations(source_allocation_id,return_id);

-- Two simultaneous checkouts cannot return more complete sets than originally sold.
CREATE TRIGGER IF NOT EXISTS guard_partial_bundle_set_capacity
BEFORE INSERT ON bundle_partial_return_requests
BEGIN
 SELECT CASE WHEN
  (SELECT COUNT(*) FROM sale_items
   WHERE invoice_id=NEW.invoice_id AND product_id=NEW.bundle_id)<>1
  OR EXISTS(SELECT 1 FROM bundle_cash_return_requests f WHERE f.invoice_id=NEW.invoice_id)
  OR (NEW.sets_returned+COALESCE((
   SELECT SUM(r.sets_returned) FROM bundle_partial_return_requests r
   WHERE r.invoice_id=NEW.invoice_id AND r.bundle_id=NEW.bundle_id
  ),0)) > COALESCE((
    SELECT quantity FROM sale_items WHERE invoice_id=NEW.invoice_id AND product_id=NEW.bundle_id
  ),0)
 THEN RAISE(ABORT,'BUNDLE_PARTIAL_SET_CONFLICT') END;
END;

-- Guard cumulative original FIFO source capacity even across many return documents.
CREATE TRIGGER IF NOT EXISTS guard_partial_bundle_fifo_capacity
BEFORE INSERT ON bundle_partial_return_allocations
BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM bundle_sale_allocations a
  WHERE a.id=NEW.source_allocation_id AND a.invoice_id=NEW.invoice_id
    AND a.visible_product_id=NEW.visible_product_id
    AND a.component_id=NEW.component_id AND a.lot_id=NEW.lot_id
    AND ABS(a.unit_cost-NEW.unit_cost)<0.000000001
 ) THEN RAISE(ABORT,'BUNDLE_PARTIAL_SOURCE_MISMATCH') END;
 SELECT CASE WHEN (
   NEW.quantity+
   COALESCE((SELECT SUM(x.quantity) FROM bundle_partial_return_allocations x
     WHERE x.source_allocation_id=NEW.source_allocation_id),0)
   +COALESCE((SELECT SUM(f.quantity) FROM bundle_return_allocations f
     WHERE f.source_allocation_id=NEW.source_allocation_id),0)
 ) > COALESCE((SELECT a.quantity FROM bundle_sale_allocations a
   WHERE a.id=NEW.source_allocation_id),0)
 THEN RAISE(ABORT,'BUNDLE_PARTIAL_SOURCE_CONFLICT') END;
END;

-- All legacy mutation APIs remain blocked; new allowed inserts must have a matching immutable marker.
DROP TRIGGER IF EXISTS guard_bundle_return;
CREATE TRIGGER guard_bundle_return
BEFORE INSERT ON sales_returns
WHEN EXISTS(SELECT 1 FROM sale_bundle_components WHERE invoice_id=NEW.invoice_id)
 AND NOT EXISTS(SELECT 1 FROM bundle_cash_return_requests f
   WHERE f.invoice_id=NEW.invoice_id AND f.return_id=NEW.return_id)
 AND NOT EXISTS(SELECT 1 FROM bundle_partial_return_requests p
   WHERE p.invoice_id=NEW.invoice_id AND p.return_id=NEW.return_id)
BEGIN SELECT RAISE(ABORT,'BUNDLE_RETURN_UNAUTHORIZED'); END;

DROP TRIGGER IF EXISTS guard_bundle_return_item;
CREATE TRIGGER guard_bundle_return_item
BEFORE INSERT ON sales_return_items
WHEN EXISTS(SELECT 1 FROM sale_bundle_components WHERE invoice_id=NEW.invoice_id)
 AND NOT EXISTS(SELECT 1 FROM bundle_cash_return_requests f
   WHERE f.invoice_id=NEW.invoice_id AND f.return_id=NEW.return_id)
 AND NOT EXISTS(SELECT 1 FROM bundle_partial_return_requests p
   WHERE p.invoice_id=NEW.invoice_id AND p.return_id=NEW.return_id)
BEGIN SELECT RAISE(ABORT,'BUNDLE_RETURN_UNAUTHORIZED'); END;

DROP TRIGGER IF EXISTS guard_bundle_cash_return_receipt;
CREATE TRIGGER guard_bundle_cash_return_receipt
BEFORE INSERT ON cash_book
WHEN NEW.type='Sales Return'
 AND EXISTS (SELECT 1 FROM sale_bundle_components b
   JOIN sales_returns r ON r.invoice_id=b.invoice_id WHERE r.return_id=NEW.reference)
 AND NOT EXISTS(SELECT 1 FROM bundle_cash_return_requests f WHERE f.return_id=NEW.reference)
 AND NOT EXISTS(SELECT 1 FROM bundle_partial_return_requests p WHERE p.return_id=NEW.reference)
BEGIN SELECT RAISE(ABORT,'BUNDLE_RETURN_UNAUTHORIZED'); END;
