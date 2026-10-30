-- Phase 6D: add request identity and source-account constraints without rewriting historic records.
ALTER TABLE finance_transactions ADD COLUMN client_request_id TEXT NOT NULL DEFAULT '';
ALTER TABLE finance_transactions ADD COLUMN request_fingerprint TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_phase6d_finance_request
  ON finance_transactions(client_request_id) WHERE client_request_id<>'';

-- Prevent a source ledger debit against a missing, inactive or underfunded account.
-- A posting using the finance source type must also belong to an existing finance transaction.
CREATE TRIGGER IF NOT EXISTS trg_phase6d_finance_bank_guard
BEFORE INSERT ON bank_book
WHEN NEW.type IN ('Owner Investment','Owner Withdrawal','Loan Received','Loan Repayment','Opening Owner Capital','Opening Loan')
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM bank_accounts
    WHERE bank_account_id=NEW.bank_account_id AND status='Active'
  ) THEN RAISE(ABORT,'Finance bank account unavailable') END;
  SELECT CASE WHEN NEW.debit>0 AND
    (SELECT current_balance FROM bank_accounts WHERE bank_account_id=NEW.bank_account_id)+0.000000001<NEW.debit
    THEN RAISE(ABORT,'Insufficient bank balance for finance withdrawal') END;
END;
