-- 6C: close and its audit entry are a single transaction. A concurrent
-- second close must fail, not append a second audit after a zero-row UPDATE.
CREATE UNIQUE INDEX IF NOT EXISTS idx_phase6_cash_close_audit_once
  ON audit_logs(entity_type,entity_id,action)
  WHERE entity_type='CASH_SESSION' AND action='CLOSE_CASH_SESSION';
