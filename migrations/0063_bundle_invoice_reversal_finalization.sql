-- Phase 7E3B2B2A: no-money invoice finalization after complete cash refund/restoration.
-- Never replaces a sale or item; all original journal/stock source evidence stays immutable.
CREATE TABLE IF NOT EXISTS bundle_invoice_finalizations(
 invoice_id TEXT PRIMARY KEY REFERENCES sales(invoice_id),
 request_id TEXT NOT NULL UNIQUE,
 payload_sha256 TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(trim(reason))>=8),
 reversed_by TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
);
-- This is a hard SQL gate, not an application-level "looks refunded" guess.
CREATE TRIGGER IF NOT EXISTS guard_bundle_invoice_finalization
BEFORE INSERT ON bundle_invoice_finalizations
BEGIN
 SELECT CASE WHEN
   NOT EXISTS(SELECT 1 FROM sales s WHERE s.invoice_id=NEW.invoice_id
     AND s.status='Completed' AND s.is_deleted=0 AND s.payment_type='Cash'
     AND s.payment_method='Cash' AND s.discount=0 AND s.due_amount=0
     AND ABS(s.grand_total-s.paid_amount)<0.00000001)
   OR NOT EXISTS(SELECT 1 FROM sale_bundle_components b WHERE b.invoice_id=NEW.invoice_id)
   OR EXISTS(SELECT 1 FROM sale_reversal_logs s WHERE s.invoice_id=NEW.invoice_id)
   OR NOT EXISTS(SELECT 1 FROM sales_returns r WHERE r.invoice_id=NEW.invoice_id)
   OR EXISTS(
     SELECT 1 FROM sale_items i WHERE i.invoice_id=NEW.invoice_id
     AND ABS(i.quantity-COALESCE((
       SELECT SUM(ri.return_quantity) FROM sales_return_items ri
       WHERE ri.invoice_id=i.invoice_id AND ri.product_id=i.product_id
     ),0))>0.00000001
   )
   OR EXISTS(
     SELECT 1 FROM bundle_sale_allocations a WHERE a.invoice_id=NEW.invoice_id
     AND ABS(a.quantity-
       COALESCE((SELECT SUM(p.quantity) FROM bundle_partial_return_allocations p
                 WHERE p.source_allocation_id=a.id),0)
       -COALESCE((SELECT SUM(f.quantity) FROM bundle_return_allocations f
                 WHERE f.source_allocation_id=a.id),0)
     )>0.00000001
   )
   OR EXISTS(
     SELECT 1 FROM sales_returns r WHERE r.invoice_id=NEW.invoice_id
     AND (
       (SELECT COUNT(*) FROM cash_book cb WHERE cb.reference=r.return_id
        AND cb.type='Sales Return' AND cb.is_deleted=0 AND cb.payment_method='Cash')<>1
       OR ABS(r.total_return_amount-COALESCE((
         SELECT SUM(cb.debit) FROM cash_book cb WHERE cb.reference=r.return_id
         AND cb.type='Sales Return' AND cb.is_deleted=0
       ),0))>0.00000001
       OR ((SELECT COUNT(*) FROM bundle_cash_return_requests f
            WHERE f.return_id=r.return_id AND f.invoice_id=NEW.invoice_id)
          +(SELECT COUNT(*) FROM bundle_partial_return_requests p
            WHERE p.return_id=r.return_id AND p.invoice_id=NEW.invoice_id)
          +(SELECT COUNT(*) FROM bundle_ordinary_return_requests o
            WHERE o.return_id=r.return_id AND o.invoice_id=NEW.invoice_id))<>1
     )
   )
   OR NOT EXISTS(
     SELECT 1 FROM sales s WHERE s.invoice_id=NEW.invoice_id
       AND (SELECT COUNT(*) FROM cash_book cb
            WHERE cb.reference=s.invoice_id AND cb.type='Sale'
              AND cb.is_deleted=0 AND cb.payment_method='Cash' AND cb.debit=0
              AND ABS(cb.credit-s.paid_amount)<0.00000001)=1
       AND ABS(s.paid_amount-COALESCE((
          SELECT SUM(r.total_return_amount) FROM sales_returns r
          WHERE r.invoice_id=s.invoice_id
       ),0))<0.00000001
   )
 THEN RAISE(ABORT,'BUNDLE_REVERSAL_REQUIRES_COMPLETE_CASH_FIFO_RECONCILIATION') END;
END;
CREATE TRIGGER IF NOT EXISTS guard_bundle_invoice_finalization_update
BEFORE UPDATE ON bundle_invoice_finalizations
BEGIN SELECT RAISE(ABORT,'BUNDLE_REVERSAL_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS guard_bundle_invoice_finalization_delete
BEFORE DELETE ON bundle_invoice_finalizations
BEGIN SELECT RAISE(ABORT,'BUNDLE_REVERSAL_IMMUTABLE'); END;

-- Narrow the 0059 blanket block to ONE authorized Completed -> Reversed change.
-- Reject changing any original invoice column while changing status.
DROP TRIGGER IF EXISTS guard_bundle_sale_update;
CREATE TRIGGER guard_bundle_sale_update
BEFORE UPDATE ON sales
WHEN EXISTS(SELECT 1 FROM sale_bundle_components WHERE invoice_id=OLD.invoice_id)
AND NOT (
 OLD.status='Completed' AND NEW.status='Reversed'
 AND EXISTS(SELECT 1 FROM bundle_invoice_finalizations v WHERE v.invoice_id=OLD.invoice_id)
 AND NEW.invoice_id IS OLD.invoice_id
 AND NEW.sale_date IS OLD.sale_date AND NEW.sale_time IS OLD.sale_time
 AND NEW.customer_id IS OLD.customer_id AND NEW.customer_name IS OLD.customer_name
 AND NEW.customer_phone IS OLD.customer_phone
 AND NEW.customer_address IS OLD.customer_address AND NEW.customer_father_name IS OLD.customer_father_name
 AND NEW.subtotal IS OLD.subtotal AND NEW.discount IS OLD.discount
 AND NEW.grand_total IS OLD.grand_total AND NEW.paid_amount IS OLD.paid_amount
 AND NEW.due_amount IS OLD.due_amount
 AND NEW.payment_type IS OLD.payment_type AND NEW.payment_status IS OLD.payment_status
 AND NEW.payment_method IS OLD.payment_method
 AND NEW.bank_account_id IS OLD.bank_account_id AND NEW.bank_account_name IS OLD.bank_account_name
 AND NEW.is_backdated IS OLD.is_backdated AND NEW.backdated_reason IS OLD.backdated_reason
 AND NEW.created_by IS OLD.created_by AND NEW.created_at IS OLD.created_at
 AND NEW.is_deleted IS OLD.is_deleted AND NEW.delete_reason IS OLD.delete_reason
 AND NEW.deleted_by IS OLD.deleted_by AND NEW.deleted_at IS OLD.deleted_at
)
BEGIN SELECT RAISE(ABORT,'BUNDLE_LIFECYCLE_IMMUTABLE: only certified reversal finalization allowed'); END;

-- Preserve standard return flow and require historical reversal evidence for all invoice types.
DROP TRIGGER IF EXISTS trg_sale_reversed_status_requires_log;
CREATE TRIGGER trg_sale_reversed_status_requires_log
BEFORE UPDATE OF status ON sales
WHEN NEW.status='Reversed' AND
  (OLD.status<>'Completed' OR NOT EXISTS (
    SELECT 1 FROM sale_reversal_logs WHERE invoice_id=NEW.invoice_id
    UNION ALL
    SELECT 1 FROM bundle_invoice_finalizations WHERE invoice_id=NEW.invoice_id
  ))
BEGIN SELECT RAISE(ABORT,'SALE_REVERSAL_CONFLICT'); END;

-- Canonical status closes the invoice to any later cash/item refund creation.
CREATE TRIGGER IF NOT EXISTS guard_bundle_finalized_return_closed
BEFORE INSERT ON sales_returns
WHEN EXISTS(SELECT 1 FROM bundle_invoice_finalizations v WHERE v.invoice_id=NEW.invoice_id)
BEGIN SELECT RAISE(ABORT,'BUNDLE_REVERSAL_ALREADY_FINALIZED'); END;
