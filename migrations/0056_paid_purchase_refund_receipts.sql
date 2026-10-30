-- Phase 4I-C2: money-backed paid-purchase returns (additive; isolated D1 only).
-- The original money source, payable and receipt are validated inside the same D1 batch.
ALTER TABLE purchase_returns ADD COLUMN refund_request_id TEXT NOT NULL DEFAULT '';
ALTER TABLE purchase_returns ADD COLUMN refund_payload_json TEXT NOT NULL DEFAULT '';
ALTER TABLE purchase_returns ADD COLUMN refund_source_ledger_id TEXT NOT NULL DEFAULT '';
ALTER TABLE purchase_returns ADD COLUMN refund_bank_account_id TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_refund_request
 ON purchase_returns(refund_request_id) WHERE refund_request_id<>'';

CREATE TRIGGER IF NOT EXISTS purchase_paid_refund_source_guard
BEFORE INSERT ON purchase_returns
WHEN NEW.refund_method IN ('Cash','Bank','Mobile Banking')
BEGIN
 SELECT CASE WHEN
   NEW.refund_request_id='' OR NEW.refund_payload_json='' OR
   NEW.refund_source_ledger_id='' OR NEW.total_return_amount<=0 OR
   NOT EXISTS(SELECT 1 FROM cash_sessions WHERE status='Open') OR
   NOT EXISTS(
     SELECT 1 FROM purchases p
     JOIN suppliers s ON s.supplier_id=p.supplier_id AND s.status='Active' AND COALESCE(s.is_deleted,0)=0
     JOIN supplier_ledger sl ON sl.ledger_id=p.payment_ledger_id AND COALESCE(sl.is_deleted,0)=0
     WHERE p.purchase_id=NEW.purchase_id AND COALESCE(p.is_deleted,0)=0
       AND p.supplier_id=NEW.supplier_id AND p.status='Completed'
       AND p.payment_method=NEW.refund_method
       AND p.payment_ledger_id=NEW.refund_source_ledger_id
       AND p.paid_amount>0 AND ABS(p.paid_amount-p.grand_total)<=0.0001
       AND ABS(p.due_amount)<=0.0001 AND ABS(p.discount)<=0.0001
       AND COALESCE(p.returned_amount,0)+NEW.total_return_amount<=p.paid_amount+0.0001
       AND ABS(s.current_due-(SELECT COALESCE(SUM(l.debit-l.credit),0)
         FROM supplier_ledger l WHERE l.supplier_id=s.supplier_id AND COALESCE(l.is_deleted,0)=0))<=0.0001
       AND sl.supplier_id=p.supplier_id AND sl.type='Purchase Payment'
       AND sl.reference=p.purchase_id AND ABS(sl.debit)<=0.0001
       AND ABS(sl.credit-p.paid_amount)<=0.0001
       AND sl.payment_method=p.payment_method
       AND COALESCE(sl.bank_account_id,'')=COALESCE(p.bank_account_id,'')
       AND (
         (NEW.refund_method='Cash' AND NEW.refund_bank_account_id='' AND
           EXISTS(SELECT 1 FROM cash_book cb WHERE cb.reference=sl.ledger_id
             AND cb.type='Supplier Payment' AND cb.payment_method='Cash'
             AND ABS(cb.debit-p.paid_amount)<=0.0001 AND ABS(cb.credit)<=0.0001
             AND COALESCE(cb.is_deleted,0)=0))
         OR
         (NEW.refund_method IN ('Bank','Mobile Banking') AND
           p.bank_account_id=NEW.refund_bank_account_id AND
           EXISTS(SELECT 1 FROM bank_accounts ba WHERE ba.bank_account_id=p.bank_account_id
             AND ba.status='Active' AND ba.account_type=NEW.refund_method) AND
           EXISTS(SELECT 1 FROM bank_book bb WHERE bb.reference=sl.ledger_id
             AND bb.bank_account_id=p.bank_account_id AND bb.type='Supplier Payment'
             AND ABS(bb.debit-p.paid_amount)<=0.0001 AND ABS(bb.credit)<=0.0001
             AND COALESCE(bb.is_deleted,0)=0))
       )
   )
 THEN RAISE(ABORT,'purchase_refund_original_source_changed') END;
END;
