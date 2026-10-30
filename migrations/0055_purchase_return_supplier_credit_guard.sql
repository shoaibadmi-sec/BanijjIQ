-- Phase 4I-C1: Supplier Credit is an offset against a verified existing payable.
-- The service preflights for a user-facing 409; this trigger protects the D1 batch
-- from concurrent balance changes and source-ledger tampering.
CREATE TRIGGER IF NOT EXISTS purchase_return_supplier_credit_reconcile
BEFORE INSERT ON purchase_returns
WHEN NEW.refund_method='Supplier Credit'
BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM suppliers s
  WHERE s.supplier_id=NEW.supplier_id
    AND COALESCE(s.is_deleted,0)=0
    AND s.current_due>=NEW.total_return_amount-0.0001
    AND ABS(s.current_due-(SELECT COALESCE(SUM(sl.debit-sl.credit),0)
      FROM supplier_ledger sl
      WHERE sl.supplier_id=s.supplier_id AND COALESCE(sl.is_deleted,0)=0))<=0.0001
 ) THEN RAISE(ABORT,'supplier_credit_payable_unreconciled') END;
END;
