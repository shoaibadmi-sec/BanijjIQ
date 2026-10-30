-- Cash-to-bank withdrawals must never exceed the source bank balance.
-- Keep the check inside D1's atomic batch so concurrent writers cannot race.
CREATE TRIGGER IF NOT EXISTS trg_phase6_cash_withdrawal_bank_guard
BEFORE INSERT ON bank_book WHEN NEW.type='Cash Withdrawal'
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM bank_accounts
      WHERE bank_account_id=NEW.bank_account_id AND status='Active'
        AND current_balance+0.000000001>=NEW.debit
  ) THEN RAISE(ABORT,'Insufficient bank funds for cash withdrawal') END;
END;
