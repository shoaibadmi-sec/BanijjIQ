-- Phase 6D: financing reversals must not make the original bank account negative.
-- Abort the full atomic D1 batch if previously received money has already been spent.
CREATE TRIGGER IF NOT EXISTS trg_phase6d_finance_reverse_guard
BEFORE UPDATE OF is_deleted ON bank_book
WHEN OLD.type IN ('Owner Investment','Owner Withdrawal','Loan Received','Loan Repayment','Opening Owner Capital','Opening Loan')
 AND COALESCE(OLD.is_deleted,0)=0 AND NEW.is_deleted=1
BEGIN
 SELECT CASE WHEN NOT EXISTS(
   SELECT 1 FROM bank_accounts WHERE bank_account_id=OLD.bank_account_id
 ) THEN RAISE(ABORT,'Original finance account missing') END;
 SELECT CASE WHEN OLD.credit>OLD.debit AND
   (SELECT current_balance FROM bank_accounts WHERE bank_account_id=OLD.bank_account_id)+0.000000001<OLD.credit-OLD.debit
   THEN RAISE(ABORT,'Original financing funds unavailable for reversal') END;
END;
