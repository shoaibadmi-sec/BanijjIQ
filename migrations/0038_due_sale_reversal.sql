-- Phase 3G: original invoice due cancellation is a non-cash settlement.
-- No settlement can silently spend cash, create customer credit or erase older activity.
CREATE TRIGGER IF NOT EXISTS trg_due_reversal_requires_exclusive_receivable
BEFORE INSERT ON sales_returns
WHEN NEW.refund_method='Due Adjustment'
  AND NOT EXISTS (
    SELECT 1 FROM sales s
    JOIN customers c ON c.customer_id=s.customer_id
    WHERE s.invoice_id=NEW.invoice_id AND s.status='Completed'
      AND s.is_deleted=0 AND s.payment_type='Due'
      AND COALESCE(s.payment_method,'')=''
      AND s.paid_amount=0 AND s.due_amount=s.grand_total
      AND s.grand_total=NEW.total_return_amount
      AND NEW.customer_id=s.customer_id AND c.is_deleted=0
      AND c.current_due=s.grand_total
      AND (SELECT COUNT(*) FROM customer_ledger
           WHERE customer_id=s.customer_id)=1
      AND (SELECT COUNT(*) FROM customer_ledger
           WHERE customer_id=s.customer_id AND type='Sale'
             AND reference=s.invoice_id AND debit=s.grand_total
             AND credit=0 AND balance=s.grand_total)=1
      AND NOT EXISTS (SELECT 1 FROM sales_returns r WHERE r.invoice_id=s.invoice_id)
  )
BEGIN SELECT RAISE(ABORT,'DUE_REVERSAL_CONFLICT'); END;

DROP TRIGGER IF EXISTS guard_reversal_refund_account;
CREATE TRIGGER guard_reversal_refund_account
BEFORE INSERT ON sale_reversal_logs
WHEN
  NOT EXISTS (
    SELECT 1 FROM sales_returns sr
    WHERE sr.return_id=NEW.return_id AND sr.invoice_id=NEW.invoice_id
      AND sr.refund_method=NEW.refund_method
      AND COALESCE(sr.refund_bank_account_id,'')=NEW.refund_bank_account_id
  )
  OR NEW.refund_method NOT IN ('Cash','Bank','Mobile Banking','Due Adjustment')
  OR (NEW.refund_method IN ('Cash','Due Adjustment') AND NEW.refund_bank_account_id<>'')
  OR (NEW.refund_method IN ('Bank','Mobile Banking') AND (
      NEW.refund_bank_account_id=''
      OR NOT EXISTS (
        SELECT 1 FROM bank_book bb WHERE bb.reference=NEW.return_id
          AND bb.bank_account_id=NEW.refund_bank_account_id
          AND bb.type='Sales Return' AND bb.is_deleted=0
          AND bb.credit=0 AND ROUND(bb.debit*100)=NEW.refund_amount_cents
      )
    ))
  OR (NEW.refund_method='Due Adjustment' AND NOT EXISTS (
    SELECT 1 FROM sales s
    JOIN customers c ON c.customer_id=s.customer_id
    WHERE s.invoice_id=NEW.invoice_id AND s.payment_type='Due'
      AND s.paid_amount=0 AND s.due_amount=s.grand_total
      AND s.grand_total*100=NEW.refund_amount_cents
      AND c.current_due=0
      AND (SELECT COUNT(*) FROM customer_ledger
           WHERE customer_id=s.customer_id)=2
      AND (SELECT COUNT(*) FROM customer_ledger
           WHERE customer_id=s.customer_id AND type='Sale Reversal'
            AND reference=NEW.return_id AND debit=0
            AND ROUND(credit*100)=NEW.refund_amount_cents AND balance=0)=1
      AND NOT EXISTS (SELECT 1 FROM cash_book WHERE reference=NEW.return_id)
      AND NOT EXISTS (SELECT 1 FROM bank_book WHERE reference=NEW.return_id)
  ))
BEGIN SELECT RAISE(ABORT,'SALE_REVERSAL_REFUND_ACCOUNT_CONFLICT'); END;
