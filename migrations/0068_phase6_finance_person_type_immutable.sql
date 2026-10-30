-- Phase 6I: preserve historical classification in the finance-person ledger.
-- An Owner cannot turn into a Lender (or vice versa) after any posting,
-- including a reversed/cancelled posting. IDs remain the stable join key.
-- Existing rows are never rewritten by this migration.
CREATE TRIGGER IF NOT EXISTS trg_phase6_finance_person_type_locked
BEFORE UPDATE OF person_type ON finance_persons
WHEN NEW.person_type<>OLD.person_type AND EXISTS(
  SELECT 1 FROM finance_transactions WHERE person_id=OLD.person_id
)
BEGIN
  SELECT RAISE(ABORT, 'Finance person type cannot change after history exists');
END;
