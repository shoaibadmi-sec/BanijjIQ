-- Phase 6C: additive cash session safety. No hosted D1 mutation from this branch.
ALTER TABLE cash_sessions ADD COLUMN client_request_id TEXT NOT NULL DEFAULT '';
ALTER TABLE cash_sessions ADD COLUMN open_fingerprint TEXT NOT NULL DEFAULT '';
ALTER TABLE cash_sessions ADD COLUMN close_request_id TEXT NOT NULL DEFAULT '';
ALTER TABLE cash_sessions ADD COLUMN closed_by TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_phase6_cash_only_one_open
  ON cash_sessions(status) WHERE status='Open';
CREATE UNIQUE INDEX IF NOT EXISTS idx_phase6_cash_open_request
  ON cash_sessions(client_request_id) WHERE client_request_id<>'';
CREATE UNIQUE INDEX IF NOT EXISTS idx_phase6_cash_close_request
  ON cash_sessions(close_request_id) WHERE close_request_id<>'';

-- All comparisons take place in the same SQLite/D1 transaction as closing,
-- so a new cash posting between preflight and close aborts the entire batch.
CREATE TRIGGER IF NOT EXISTS trg_phase6_cash_close_reconcile
BEFORE UPDATE OF status ON cash_sessions WHEN NEW.status='Closed'
BEGIN
 SELECT CASE WHEN OLD.status<>'Open' THEN
   RAISE(ABORT,'Cash session already closed') END;
 SELECT CASE WHEN NOT EXISTS(
   SELECT 1 FROM cash_book
   WHERE reference=OLD.session_id AND type='Session Open' AND is_deleted=0
 ) THEN RAISE(ABORT,'Cash session opening entry missing') END;
 SELECT CASE WHEN ROUND(NEW.expected_cash,4)<>ROUND(
   OLD.opening_cash+COALESCE((
     SELECT SUM(credit-debit) FROM cash_book
     WHERE is_deleted=0 AND
       rowid>(SELECT rowid FROM cash_book
              WHERE reference=OLD.session_id AND type='Session Open' AND is_deleted=0
              ORDER BY rowid DESC LIMIT 1)
       AND type NOT IN ('Session Open','Day Close Adjustment')
   ),0),4)
   THEN RAISE(ABORT,'Cash book changed during close') END;
 SELECT CASE WHEN ABS(ROUND(NEW.counted_cash-NEW.expected_cash-NEW.variance,4))>0.0000001
   THEN RAISE(ABORT,'Cash count variance mismatch') END;
 SELECT CASE WHEN NEW.variance<>0 AND LENGTH(TRIM(NEW.closing_note))<8
   THEN RAISE(ABORT,'Cash count discrepancy requires a reason') END;
END;
