-- Full-sale reversal is an append-only, one-per-invoice accounting event.
-- Original mixed-unit invoice, sale_item_unit_snapshots and FIFO sale allocations survive.
CREATE TABLE IF NOT EXISTS sale_reversal_logs (
  invoice_id TEXT PRIMARY KEY REFERENCES sales(invoice_id),
  return_id TEXT NOT NULL UNIQUE REFERENCES sales_returns(return_id),
  refund_amount_cents INTEGER NOT NULL CHECK(refund_amount_cents > 0),
  reason TEXT NOT NULL CHECK(length(trim(reason)) >= 8),
  reversed_by TEXT NOT NULL,
  reversed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
);
CREATE TRIGGER IF NOT EXISTS trg_sale_reversal_only_once
BEFORE INSERT ON sale_reversal_logs
WHEN NOT EXISTS (
  SELECT 1 FROM sales WHERE invoice_id=NEW.invoice_id
    AND status='Completed' AND is_deleted=0
)
BEGIN SELECT RAISE(ABORT,'SALE_REVERSAL_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS trg_sale_reversed_status_requires_log
BEFORE UPDATE OF status ON sales
WHEN NEW.status='Reversed' AND
  (OLD.status<>'Completed' OR NOT EXISTS (
    SELECT 1 FROM sale_reversal_logs WHERE invoice_id=NEW.invoice_id
  ))
BEGIN SELECT RAISE(ABORT,'SALE_REVERSAL_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS trg_sale_reversal_return_closed
BEFORE INSERT ON sales_returns
WHEN EXISTS (
  SELECT 1 FROM sale_reversal_logs WHERE invoice_id=NEW.invoice_id
)
BEGIN SELECT RAISE(ABORT,'SALE_REVERSAL_CONFLICT'); END;
