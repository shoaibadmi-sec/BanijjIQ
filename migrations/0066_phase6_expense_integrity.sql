-- Phase 6F. Preserve historical records and enable safe retries for new expenses.
ALTER TABLE expenses ADD COLUMN client_request_id TEXT NOT NULL DEFAULT '';
ALTER TABLE expenses ADD COLUMN request_fingerprint TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_phase6_expense_client_request
 ON expenses(client_request_id) WHERE client_request_id<>'';

-- Evaluate the actual source account at money-book insertion time inside D1 batch.
CREATE TRIGGER IF NOT EXISTS trg_phase6_expense_source_guard
BEFORE INSERT ON bank_book
WHEN NEW.type IN ('Expense','Expense Update') AND NEW.debit>0
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM bank_accounts
    WHERE bank_account_id=NEW.bank_account_id AND status='Active'
  ) THEN RAISE(ABORT,'Expense account unavailable') END;
  SELECT CASE WHEN NEW.debit>
    (SELECT current_balance FROM bank_accounts WHERE bank_account_id=NEW.bank_account_id)+0.000000001
    THEN RAISE(ABORT,'Insufficient bank funds for expense') END;
END;
