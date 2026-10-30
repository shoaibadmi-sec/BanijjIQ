-- Phase 4D: audited supplier settlements, append-only financial journal.
-- No rewrite of legacy supplier ledger entries or historical bank/cash rows.
CREATE TABLE IF NOT EXISTS supplier_settlement_entries(
 settlement_id TEXT PRIMARY KEY,
 request_id TEXT NOT NULL UNIQUE,
 payload_json TEXT NOT NULL,
 supplier_id TEXT NOT NULL REFERENCES suppliers(supplier_id),
 supplier_name TEXT NOT NULL,
 ledger_id TEXT NOT NULL UNIQUE REFERENCES supplier_ledger(ledger_id) DEFERRABLE INITIALLY DEFERRED,
 amount REAL NOT NULL CHECK(amount > 0),
 method TEXT NOT NULL CHECK(method IN ('Cash','Bank','Mobile Banking')),
 bank_account_id TEXT NOT NULL DEFAULT '',
 due_before REAL NOT NULL CHECK(due_before >= 0),
 due_after REAL NOT NULL CHECK(due_after >= 0),
 date TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'Posted' CHECK(status IN ('Posted','Reversed')),
 reversal_ledger_id TEXT UNIQUE,
 reversed_at TEXT,
 reversal_reason TEXT NOT NULL DEFAULT '',
 reversed_by TEXT NOT NULL DEFAULT '',
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT(datetime('now')),
 CHECK(due_before >= due_after),
 CHECK(amount <= due_before+0.000001)
);
CREATE INDEX IF NOT EXISTS idx_supplier_settlement_supplier
 ON supplier_settlement_entries(supplier_id,created_at DESC);
CREATE TRIGGER IF NOT EXISTS supplier_settlement_atomic_preflight
BEFORE INSERT ON supplier_settlement_entries
BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM suppliers s WHERE s.supplier_id=NEW.supplier_id
  AND s.is_deleted=0 AND s.status='Active'
  AND ABS(s.current_due-NEW.due_before)<0.000001
  AND ABS(s.current_due-(
    SELECT COALESCE(SUM(sl.debit-sl.credit),0) FROM supplier_ledger sl
    WHERE sl.supplier_id=NEW.supplier_id AND sl.is_deleted=0
  ))<0.0001
 ) THEN RAISE(ABORT,'supplier_due_changed_or_unreconciled') END;
 SELECT CASE WHEN NEW.method IN ('Bank','Mobile Banking') AND NOT EXISTS(
  SELECT 1 FROM bank_accounts b WHERE b.bank_account_id=NEW.bank_account_id
  AND b.status='Active' AND b.current_balance >= NEW.amount-0.000001
 ) THEN RAISE(ABORT,'bank_balance_insufficient_or_inactive') END;
 SELECT CASE WHEN NEW.method='Cash' AND NEW.bank_account_id<>''
 THEN RAISE(ABORT,'cash_must_not_have_bank_account') END;
END;
CREATE TRIGGER IF NOT EXISTS supplier_settlement_atomic_bank_guard
BEFORE UPDATE OF current_balance ON bank_accounts
WHEN NEW.current_balance < -0.000001
BEGIN SELECT RAISE(ABORT,'bank_balance_negative'); END;
CREATE TRIGGER IF NOT EXISTS supplier_settlement_atomic_due_guard
BEFORE UPDATE OF current_due ON suppliers
WHEN NEW.current_due < -0.000001
BEGIN SELECT RAISE(ABORT,'supplier_due_negative'); END;
CREATE TRIGGER IF NOT EXISTS supplier_settlement_reverse_guard
BEFORE UPDATE OF status ON supplier_settlement_entries
WHEN NEW.status='Reversed' AND OLD.status<>'Posted'
BEGIN SELECT RAISE(ABORT,'supplier_payment_already_reversed'); END;
