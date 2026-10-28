-- Phase 12: concurrency guards for sale reversals.
-- On a racing refund the losing D1 batch MUST roll back its return header,
-- refund entry, stock restoration and audit event, not merely report a warning.
-- Exclude vendor-sourced quantities, which never entered our stock.
CREATE TRIGGER IF NOT EXISTS guard_sales_return_available_quantity
BEFORE INSERT ON sales_return_items
WHEN NEW.return_quantity <= 0 OR
  NEW.return_quantity +
    COALESCE((SELECT SUM(sri.return_quantity) FROM sales_return_items sri
      WHERE sri.invoice_id=NEW.invoice_id AND sri.product_id=NEW.product_id),0)
    >
    COALESCE((SELECT SUM(si.quantity) FROM sale_items si
      WHERE si.invoice_id=NEW.invoice_id AND si.product_id=NEW.product_id),0)
    -
    COALESCE((SELECT SUM(vs.quantity) FROM vendor_sourcing vs
      WHERE vs.invoice_id=NEW.invoice_id AND vs.product_id=NEW.product_id),0)
BEGIN
  SELECT RAISE(ABORT, 'SALES_RETURN_QUANTITY_CONFLICT');
END;

-- A concurrent second DELETE must not issue another compensation transaction.
-- The cancellation batch sets is_deleted only after other reversal statements;
-- raising here rolls back that entire second transaction.
CREATE TRIGGER IF NOT EXISTS guard_sale_delete_once
BEFORE UPDATE OF is_deleted ON sales
WHEN NEW.is_deleted=1 AND OLD.is_deleted=1
BEGIN
  SELECT RAISE(ABORT, 'SALE_ALREADY_DELETED');
END;
