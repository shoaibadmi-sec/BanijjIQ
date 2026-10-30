-- Phase 3G2-J: immutable FIFO provenance for future split-funded partial returns.
-- Reuse sales_return_item_lots (0035); do not invent a second lot journal.
-- No posting endpoint or Store Credit change. Full-reversal 0047 unchanged.
CREATE TRIGGER trg_split_partial_lot_provenance
BEFORE INSERT ON sales_return_item_lots
WHEN EXISTS (
  SELECT 1 FROM sales_returns sr WHERE sr.return_id=NEW.return_id
    AND sr.refund_method='Split Partial'
) AND NOT EXISTS (
  SELECT 1 FROM sales_returns sr
  JOIN sales s ON s.invoice_id=sr.invoice_id
  JOIN sales_return_items item ON item.return_id=sr.return_id
    AND item.invoice_id=sr.invoice_id AND item.product_id=NEW.product_id
  JOIN sale_items sold ON sold.invoice_id=sr.invoice_id
    AND sold.product_id=item.product_id
  JOIN sale_item_lots original ON original.invoice_id=sr.invoice_id
    AND original.product_id=item.product_id AND original.lot_id=NEW.lot_id
  JOIN stock_lots lot ON lot.lot_id=original.lot_id AND lot.product_id=item.product_id
  JOIN products p ON p.product_id=item.product_id
  WHERE sr.return_id=NEW.return_id AND sr.invoice_id=NEW.invoice_id
    AND s.status='Completed' AND s.is_deleted=0
    AND s.payment_method='Split' AND s.payment_type='Cash'
    AND lot.source_type<>'OVERSOLD'
    AND p.track_serial=0 AND p.track_expiry=0 AND p.track_warranty=0
    AND NOT EXISTS (
      SELECT 1 FROM sale_item_unit_snapshots unit
      WHERE unit.invoice_id=s.invoice_id AND unit.product_id=item.product_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM vendor_sourcing sourcing
      WHERE sourcing.invoice_id=s.invoice_id AND sourcing.product_id=item.product_id
    )
    AND CAST(NEW.quantity AS INTEGER)=NEW.quantity AND NEW.quantity>0
    AND CAST(item.return_quantity AS INTEGER)=item.return_quantity
    AND NEW.quantity+COALESCE((
      SELECT SUM(prior.quantity) FROM sales_return_item_lots prior
      WHERE prior.return_id=NEW.return_id AND prior.product_id=NEW.product_id
    ),0)<=item.return_quantity
)
BEGIN SELECT RAISE(ABORT,'SPLIT_PARTIAL_FIFO_PROVENANCE_CONFLICT'); END;

-- The previously shared mixed-unit lot journal remains untouched for
-- ordinary returns; only Split Partial rows are append-only.
CREATE TRIGGER trg_split_partial_lot_no_update
BEFORE UPDATE ON sales_return_item_lots
WHEN EXISTS(
  SELECT 1 FROM sales_returns sr
  WHERE sr.return_id=OLD.return_id AND sr.refund_method='Split Partial'
)
BEGIN SELECT RAISE(ABORT,'SPLIT_PARTIAL_FIFO_APPEND_ONLY'); END;

CREATE TRIGGER trg_split_partial_lot_no_delete
BEFORE DELETE ON sales_return_item_lots
WHEN EXISTS(
  SELECT 1 FROM sales_returns sr
  WHERE sr.return_id=OLD.return_id AND sr.refund_method='Split Partial'
)
BEGIN SELECT RAISE(ABORT,'SPLIT_PARTIAL_FIFO_APPEND_ONLY'); END;
