-- Phase 6G: one compensating leg per original bank-book entry.
-- Unlike a UNIQUE index, this does not reject historical duplicate data on migration.
CREATE TRIGGER IF NOT EXISTS trg_phase6_bank_reversal_single
BEFORE INSERT ON bank_book
WHEN NEW.reversal_of<>'' AND EXISTS(
 SELECT 1 FROM bank_book WHERE reversal_of=NEW.reversal_of
)
BEGIN
 SELECT RAISE(ABORT,'Bank entry already reversed');
END;
