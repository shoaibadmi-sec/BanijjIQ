-- Phase 4I-A: a paid purchase is inseparable from its supplier, stock and money-book postings.
-- Old due-only and imported purchases retain empty immutable payment source IDs.
ALTER TABLE purchases ADD COLUMN payment_request_id TEXT NOT NULL DEFAULT '';
ALTER TABLE purchases ADD COLUMN payment_payload_json TEXT NOT NULL DEFAULT '';
ALTER TABLE purchases ADD COLUMN payment_ledger_id TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_payment_request
 ON purchases(payment_request_id) WHERE payment_request_id<>'';
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_payment_ledger
 ON purchases(payment_ledger_id) WHERE payment_ledger_id<>'';

CREATE TRIGGER IF NOT EXISTS paid_purchase_atomic_preflight
BEFORE INSERT ON purchases WHEN NEW.paid_amount > 0
BEGIN
 SELECT CASE WHEN NEW.payment_request_id='' OR NEW.payment_ledger_id='' OR
   NEW.paid_amount > NEW.grand_total+0.000001 OR
   ABS(NEW.due_amount-(NEW.grand_total-NEW.paid_amount))>0.0001 OR
   NEW.payment_method NOT IN ('Cash','Bank','Mobile Banking') OR
   (NEW.payment_method='Cash' AND NEW.bank_account_id<>'')
  THEN RAISE(ABORT,'invalid_paid_purchase') END;
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM cash_sessions WHERE status='Open'
 ) THEN RAISE(ABORT,'cash_session_closed') END;
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM suppliers s WHERE s.supplier_id=NEW.supplier_id
   AND s.status='Active' AND s.is_deleted=0 AND s.current_due>=0
   AND ABS(s.current_due-(SELECT COALESCE(SUM(sl.debit-sl.credit),0)
    FROM supplier_ledger sl WHERE sl.supplier_id=s.supplier_id
    AND COALESCE(sl.is_deleted,0)=0))<0.0001
 ) THEN RAISE(ABORT,'supplier_due_unreconciled') END;
 SELECT CASE WHEN NEW.payment_method IN ('Bank','Mobile Banking') AND NOT EXISTS (
  SELECT 1 FROM bank_accounts b WHERE b.bank_account_id=NEW.bank_account_id
   AND b.status='Active' AND b.current_balance>=NEW.paid_amount
 ) THEN RAISE(ABORT,'purchase_bank_balance_or_account_changed') END;
END;

-- Due purchases must respect the same supplier master/ledger invariant as paid purchases.
CREATE TRIGGER IF NOT EXISTS purchase_due_supplier_reconcile
BEFORE INSERT ON purchases WHEN NEW.paid_amount=0 AND NEW.supplier_id<>''
BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM suppliers s WHERE s.supplier_id=NEW.supplier_id
   AND s.status='Active' AND s.is_deleted=0
   AND ABS(s.current_due-(SELECT COALESCE(SUM(sl.debit-sl.credit),0)
     FROM supplier_ledger sl WHERE sl.supplier_id=s.supplier_id
       AND COALESCE(sl.is_deleted,0)=0))<0.0001
 ) THEN RAISE(ABORT,'supplier_due_unreconciled') END;
END;
