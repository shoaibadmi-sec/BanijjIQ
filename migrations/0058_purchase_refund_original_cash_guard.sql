-- Phase 4I-C5: independently verified financial-source release guard.
-- A paid Cash refund reversal must still match exactly one original Cash supplier payment.
-- Additive migration: never rewrite 0056/0057 already applied to deployed tenants.
CREATE TRIGGER IF NOT EXISTS purchase_refund_reversal_original_cash_source_guard
BEFORE UPDATE OF refund_status ON purchase_returns
WHEN OLD.refund_method='Cash' AND OLD.refund_status='Posted' AND NEW.refund_status='Reversed'
BEGIN
 SELECT CASE WHEN (
   SELECT COUNT(*) FROM cash_book cb
   JOIN purchases p ON p.purchase_id=OLD.purchase_id
   WHERE p.payment_ledger_id=OLD.refund_source_ledger_id
     AND cb.reference=OLD.refund_source_ledger_id
     AND cb.type='Supplier Payment'
     AND cb.payment_method='Cash'
     AND COALESCE(cb.is_deleted,0)=0
     AND ABS(cb.debit-p.paid_amount)<=0.0001
     AND ABS(cb.credit)<=0.0001
 )<>1
 THEN RAISE(ABORT,'purchase_refund_reversal_original_cash_source_changed') END;
END;
