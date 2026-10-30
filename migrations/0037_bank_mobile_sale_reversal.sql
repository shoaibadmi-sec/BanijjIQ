-- Phase 3F: original-payment-account refund provenance for audited mixed sale reversals.
ALTER TABLE sales_returns ADD COLUMN refund_bank_account_id TEXT NOT NULL DEFAULT '';
ALTER TABLE sale_reversal_logs ADD COLUMN refund_method TEXT NOT NULL DEFAULT 'Cash';
ALTER TABLE sale_reversal_logs ADD COLUMN refund_bank_account_id TEXT NOT NULL DEFAULT '';

-- The full reversal must match the return's actual posted refund method/account.
CREATE TRIGGER IF NOT EXISTS guard_reversal_refund_account
BEFORE INSERT ON sale_reversal_logs
WHEN NOT EXISTS (
 SELECT 1 FROM sales_returns sr
 WHERE sr.return_id=NEW.return_id AND sr.invoice_id=NEW.invoice_id
   AND sr.refund_method=NEW.refund_method
   AND COALESCE(sr.refund_bank_account_id,'')=NEW.refund_bank_account_id
) OR (
 NEW.refund_method NOT IN ('Cash','Bank','Mobile Banking')
) OR (
 NEW.refund_method='Cash' AND NEW.refund_bank_account_id<>''
) OR (
 NEW.refund_method IN ('Bank','Mobile Banking') AND (
   NEW.refund_bank_account_id='' OR
   NOT EXISTS (
     SELECT 1 FROM bank_book bb WHERE bb.reference=NEW.return_id
       AND bb.bank_account_id=NEW.refund_bank_account_id
       AND bb.type='Sales Return' AND bb.is_deleted=0
       AND bb.credit=0 AND ROUND(bb.debit*100)=NEW.refund_amount_cents
   )
 )
)
BEGIN SELECT RAISE(ABORT,'SALE_REVERSAL_REFUND_ACCOUNT_CONFLICT'); END;
