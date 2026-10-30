-- Phase7E3B2B1: guarded refunds of ordinary Standard invoice lines on mixed-cart bundle sales.
-- Provenance reuses bundle_partial_return_allocations' exact FIFO-source capacity trigger.
CREATE TABLE IF NOT EXISTS bundle_ordinary_return_requests (
 request_id TEXT PRIMARY KEY,
 return_id TEXT NOT NULL UNIQUE,
 invoice_id TEXT NOT NULL REFERENCES sales(invoice_id),
 product_id TEXT NOT NULL REFERENCES products(product_id),
 quantity INTEGER NOT NULL CHECK(quantity>0),
 payload_sha256 TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bundle_ordinary_invoice ON bundle_ordinary_return_requests(invoice_id,product_id,return_id);

CREATE TRIGGER IF NOT EXISTS guard_bundle_ordinary_return_quantity
BEFORE INSERT ON bundle_ordinary_return_requests
BEGIN
 SELECT CASE WHEN
   NOT EXISTS (SELECT 1 FROM sale_bundle_components b WHERE b.invoice_id=NEW.invoice_id)
   OR NOT EXISTS (SELECT 1 FROM sale_items i JOIN products p ON p.product_id=i.product_id
      WHERE i.invoice_id=NEW.invoice_id AND i.product_id=NEW.product_id
        AND p.product_type='Standard' AND i.quantity>=NEW.quantity)
   OR EXISTS (SELECT 1 FROM bundle_cash_return_requests f WHERE f.invoice_id=NEW.invoice_id)
   OR (NEW.quantity+COALESCE((
       SELECT SUM(prior.quantity) FROM bundle_ordinary_return_requests prior
       WHERE prior.invoice_id=NEW.invoice_id AND prior.product_id=NEW.product_id
     ),0)) > COALESCE((
       SELECT i.quantity FROM sale_items i
       WHERE i.invoice_id=NEW.invoice_id AND i.product_id=NEW.product_id
     ),0)
   OR EXISTS (SELECT 1 FROM bundle_cash_return_requests f WHERE f.request_id=NEW.request_id)
   OR EXISTS (SELECT 1 FROM bundle_partial_return_requests p WHERE p.request_id=NEW.request_id)
 THEN RAISE(ABORT,'BUNDLE_ORDINARY_RETURN_CONFLICT') END;
END;

-- Legacy returns cannot use these bundle invoice IDs without the immutable marker.
DROP TRIGGER IF EXISTS guard_bundle_return;
CREATE TRIGGER guard_bundle_return
BEFORE INSERT ON sales_returns
WHEN EXISTS(SELECT 1 FROM sale_bundle_components WHERE invoice_id=NEW.invoice_id)
 AND NOT EXISTS(SELECT 1 FROM bundle_cash_return_requests f
   WHERE f.invoice_id=NEW.invoice_id AND f.return_id=NEW.return_id)
 AND NOT EXISTS(SELECT 1 FROM bundle_partial_return_requests p
   WHERE p.invoice_id=NEW.invoice_id AND p.return_id=NEW.return_id)
 AND NOT EXISTS(SELECT 1 FROM bundle_ordinary_return_requests o
   WHERE o.invoice_id=NEW.invoice_id AND o.return_id=NEW.return_id)
BEGIN SELECT RAISE(ABORT,'BUNDLE_RETURN_UNAUTHORIZED'); END;

DROP TRIGGER IF EXISTS guard_bundle_return_item;
CREATE TRIGGER guard_bundle_return_item
BEFORE INSERT ON sales_return_items
WHEN EXISTS(SELECT 1 FROM sale_bundle_components WHERE invoice_id=NEW.invoice_id)
 AND NOT EXISTS(SELECT 1 FROM bundle_cash_return_requests f
   WHERE f.invoice_id=NEW.invoice_id AND f.return_id=NEW.return_id)
 AND NOT EXISTS(SELECT 1 FROM bundle_partial_return_requests p
   WHERE p.invoice_id=NEW.invoice_id AND p.return_id=NEW.return_id)
 AND NOT EXISTS(SELECT 1 FROM bundle_ordinary_return_requests o
   WHERE o.invoice_id=NEW.invoice_id AND o.return_id=NEW.return_id)
BEGIN SELECT RAISE(ABORT,'BUNDLE_RETURN_UNAUTHORIZED'); END;

DROP TRIGGER IF EXISTS guard_bundle_cash_return_receipt;
CREATE TRIGGER guard_bundle_cash_return_receipt
BEFORE INSERT ON cash_book
WHEN NEW.type='Sales Return'
 AND EXISTS (SELECT 1 FROM sale_bundle_components b
   JOIN sales_returns r ON r.invoice_id=b.invoice_id WHERE r.return_id=NEW.reference)
 AND NOT EXISTS(SELECT 1 FROM bundle_cash_return_requests f WHERE f.return_id=NEW.reference)
 AND NOT EXISTS(SELECT 1 FROM bundle_partial_return_requests p WHERE p.return_id=NEW.reference)
 AND NOT EXISTS(SELECT 1 FROM bundle_ordinary_return_requests o WHERE o.return_id=NEW.reference)
BEGIN SELECT RAISE(ABORT,'BUNDLE_RETURN_UNAUTHORIZED'); END;
