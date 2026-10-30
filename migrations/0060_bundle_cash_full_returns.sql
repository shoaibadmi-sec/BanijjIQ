-- Phase7E3A: exact original FIFO restoration and one guarded full-invoice CASH refund.
-- Replaces only the return-insert guards. Editing/deleting a bundle sale remains forbidden.
CREATE TABLE IF NOT EXISTS bundle_cash_return_requests (
 request_id TEXT PRIMARY KEY,
 invoice_id TEXT NOT NULL UNIQUE REFERENCES sales(invoice_id),
 return_id TEXT NOT NULL UNIQUE,
 payload_sha256 TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS bundle_return_allocations (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 return_id TEXT NOT NULL REFERENCES sales_returns(return_id),
 invoice_id TEXT NOT NULL REFERENCES sales(invoice_id),
 visible_product_id TEXT NOT NULL REFERENCES products(product_id),
 component_id TEXT NOT NULL REFERENCES products(product_id),
 lot_id TEXT NOT NULL REFERENCES stock_lots(lot_id),
 source_allocation_id INTEGER NOT NULL UNIQUE REFERENCES bundle_sale_allocations(id),
 movement_id TEXT NOT NULL UNIQUE REFERENCES stock_movements(movement_id),
 quantity REAL NOT NULL CHECK(quantity>0),
 unit_cost REAL NOT NULL CHECK(unit_cost>0),
 cost_minor INTEGER NOT NULL CHECK(cost_minor>=0),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bundle_return_invoice ON bundle_return_allocations(invoice_id,return_id);

DROP TRIGGER IF EXISTS guard_bundle_return;
CREATE TRIGGER guard_bundle_return
BEFORE INSERT ON sales_returns
WHEN EXISTS(SELECT 1 FROM sale_bundle_components WHERE invoice_id=NEW.invoice_id)
AND NOT EXISTS (
 SELECT 1 FROM bundle_cash_return_requests r
 WHERE r.invoice_id=NEW.invoice_id AND r.return_id=NEW.return_id
)
BEGIN SELECT RAISE(ABORT,'BUNDLE_RETURN_UNAUTHORIZED: use guarded full cash return'); END;

DROP TRIGGER IF EXISTS guard_bundle_return_item;
CREATE TRIGGER guard_bundle_return_item
BEFORE INSERT ON sales_return_items
WHEN EXISTS(SELECT 1 FROM sale_bundle_components WHERE invoice_id=NEW.invoice_id)
AND NOT EXISTS (
 SELECT 1 FROM bundle_cash_return_requests r
 WHERE r.invoice_id=NEW.invoice_id AND r.return_id=NEW.return_id
)
BEGIN SELECT RAISE(ABORT,'BUNDLE_RETURN_UNAUTHORIZED: no legacy component returns'); END;

-- Guard full cash refunds at DB level against missing or mismatched return marker.
CREATE TRIGGER IF NOT EXISTS guard_bundle_cash_return_receipt
BEFORE INSERT ON cash_book
WHEN NEW.type='Sales Return'
AND EXISTS (SELECT 1 FROM sale_bundle_components b
 JOIN sales_returns r ON r.invoice_id=b.invoice_id WHERE r.return_id=NEW.reference)
AND NOT EXISTS (
 SELECT 1 FROM bundle_cash_return_requests x WHERE x.return_id=NEW.reference
)
BEGIN SELECT RAISE(ABORT,'BUNDLE_RETURN_UNAUTHORIZED: refund receipt'); END;
