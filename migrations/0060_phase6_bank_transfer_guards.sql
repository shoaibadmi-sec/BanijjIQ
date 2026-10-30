-- Phase 6B: retry-safe bank/mobile transfers, without rewriting historic postings.
-- 0060 is reserved outside Phase 4's pending 0050-0053 migration sequence.
ALTER TABLE bank_transfers ADD COLUMN client_request_id TEXT NOT NULL DEFAULT '';
ALTER TABLE bank_transfers ADD COLUMN request_fingerprint TEXT NOT NULL DEFAULT '';
ALTER TABLE bank_transfers ADD COLUMN reversed_at TEXT NOT NULL DEFAULT '';
ALTER TABLE bank_transfers ADD COLUMN reversed_by TEXT NOT NULL DEFAULT '';
ALTER TABLE bank_transfers ADD COLUMN reversal_reason TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_transfer_request
  ON bank_transfers(client_request_id) WHERE client_request_id <> '';

CREATE TRIGGER IF NOT EXISTS trg_phase6_bank_transfer_insert
BEFORE INSERT ON bank_transfers WHEN NEW.client_request_id <> ''
BEGIN
  SELECT CASE WHEN NEW.amount <= 0 OR NEW.from_account_id = NEW.to_account_id
    THEN RAISE(ABORT,'Invalid bank transfer') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM bank_accounts
    WHERE bank_account_id=NEW.from_account_id AND status='Active'
  ) OR NOT EXISTS(
    SELECT 1 FROM bank_accounts
    WHERE bank_account_id=NEW.to_account_id AND status='Active'
  ) THEN RAISE(ABORT,'Inactive or missing bank account') END;
  SELECT CASE WHEN (
    SELECT current_balance FROM bank_accounts WHERE bank_account_id=NEW.from_account_id
  ) + 0.000000001 < NEW.amount
    THEN RAISE(ABORT,'Insufficient source account funds') END;
END;

-- Reverse only once, with enough value remaining in the destination account.
CREATE TRIGGER IF NOT EXISTS trg_phase6_bank_transfer_reverse
BEFORE UPDATE OF reversed_at ON bank_transfers WHEN NEW.reversed_at <> ''
BEGIN
  SELECT CASE WHEN OLD.reversed_at <> ''
    THEN RAISE(ABORT,'Bank transfer already reversed') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM bank_accounts
    WHERE bank_account_id=OLD.from_account_id AND status='Active'
  ) OR NOT EXISTS(
    SELECT 1 FROM bank_accounts
    WHERE bank_account_id=OLD.to_account_id AND status='Active'
  ) THEN RAISE(ABORT,'Inactive or missing bank account') END;
  SELECT CASE WHEN (
    SELECT current_balance FROM bank_accounts WHERE bank_account_id=OLD.to_account_id
  ) + 0.000000001 < OLD.amount
    THEN RAISE(ABORT,'Insufficient destination funds for reversal') END;
END;
