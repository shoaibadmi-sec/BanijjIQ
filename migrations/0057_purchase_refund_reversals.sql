-- Phase 4I-C3: append-only, one-time paid purchase refund reversal.
ALTER TABLE purchase_returns ADD COLUMN refund_status TEXT NOT NULL DEFAULT 'Posted';
ALTER TABLE purchase_returns ADD COLUMN reversal_request_id TEXT NOT NULL DEFAULT '';
ALTER TABLE purchase_returns ADD COLUMN reversal_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE purchase_returns ADD COLUMN reversed_by TEXT NOT NULL DEFAULT '';
ALTER TABLE purchase_returns ADD COLUMN reversed_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_refund_reversal_request
 ON purchase_returns(reversal_request_id) WHERE reversal_request_id<>'';

CREATE TRIGGER IF NOT EXISTS purchase_refund_reversal_state_guard
BEFORE UPDATE OF refund_status ON purchase_returns
WHEN NEW.refund_status<>OLD.refund_status
BEGIN
 SELECT CASE WHEN OLD.refund_status<>'Posted' OR NEW.refund_status<>'Reversed'
   OR OLD.refund_method NOT IN ('Cash','Bank','Mobile Banking')
   OR NEW.reversal_request_id='' OR LENGTH(NEW.reversal_reason)<4
 THEN RAISE(ABORT,'purchase_refund_reversal_invalid_state') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM purchases p
  WHERE p.purchase_id=OLD.purchase_id AND COALESCE(p.is_deleted,0)=0
    AND p.payment_ledger_id=OLD.refund_source_ledger_id
    AND p.payment_method=OLD.refund_method
    AND COALESCE(p.returned_amount,0)>=OLD.total_return_amount-0.0001
 ) THEN RAISE(ABORT,'purchase_refund_reversal_purchase_changed') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cash_sessions WHERE status='Open')
 THEN RAISE(ABORT,'purchase_refund_reversal_session_closed') END;
 SELECT CASE WHEN
  (OLD.refund_method='Cash' AND
   (SELECT COUNT(*) FROM cash_book cb WHERE cb.reference=OLD.return_id
     AND cb.type='Supplier Refund' AND cb.payment_method='Cash'
     AND COALESCE(cb.is_deleted,0)=0 AND ABS(cb.debit)<=0.0001
     AND ABS(cb.credit-OLD.total_return_amount)<=0.0001)<>1)
  OR (OLD.refund_method IN ('Bank','Mobile Banking') AND
   (SELECT COUNT(*) FROM bank_book bb WHERE bb.reference=OLD.return_id
     AND bb.type='Supplier Refund' AND bb.bank_account_id=OLD.refund_bank_account_id
     AND COALESCE(bb.is_deleted,0)=0 AND ABS(bb.debit)<=0.0001
     AND ABS(bb.credit-OLD.total_return_amount)<=0.0001)<>1)
 THEN RAISE(ABORT,'purchase_refund_reversal_source_changed') END;
 SELECT CASE WHEN OLD.refund_method IN ('Bank','Mobile Banking') AND NOT EXISTS(
   SELECT 1 FROM bank_accounts b WHERE b.bank_account_id=OLD.refund_bank_account_id
   AND b.account_type=OLD.refund_method AND b.status='Active'
   AND b.current_balance>=OLD.total_return_amount
 ) THEN RAISE(ABORT,'purchase_refund_reversal_bank_insufficient') END;
END;

CREATE TRIGGER IF NOT EXISTS purchase_refund_reversal_lot_capacity
BEFORE UPDATE OF remaining_quantity ON stock_lots
WHEN NEW.source_type='PURCHASE' AND
 (NEW.remaining_quantity > NEW.original_quantity+0.0001 OR NEW.remaining_quantity < -0.0001)
BEGIN SELECT RAISE(ABORT,'purchase_refund_reversal_lot_capacity'); END;

CREATE TRIGGER IF NOT EXISTS purchase_refund_reversal_invoice_nonnegative
BEFORE UPDATE OF returned_amount ON purchases
WHEN NEW.returned_amount < -0.0001
BEGIN SELECT RAISE(ABORT,'purchase_refund_reversal_invoice_negative'); END;
