-- Phase 3G2 (part A): store credit is a distinct customer liability, never negative A/R.
-- An append-only, integer-cent journal is the authoritative balance. Existing
-- unjournaled Store Credit returns are reported for manual reconciliation,
-- not migrated into spendable balances automatically.
CREATE TABLE IF NOT EXISTS customer_store_credit_entries (
  entry_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(customer_id),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('ISSUE','REDEEM')),
  source_type TEXT NOT NULL CHECK (source_type IN ('Sales Return','Sale')),
  source_id TEXT NOT NULL,
  delta_cents INTEGER NOT NULL CHECK (delta_cents <> 0),
  balance_after_cents INTEGER NOT NULL CHECK (balance_after_cents >= 0),
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
  UNIQUE(entry_type,source_type,source_id)
);
CREATE INDEX IF NOT EXISTS idx_store_credit_customer ON customer_store_credit_entries(customer_id, created_at, entry_id);

CREATE TRIGGER IF NOT EXISTS trg_store_credit_validate_entry
BEFORE INSERT ON customer_store_credit_entries
WHEN
  NEW.balance_after_cents <> COALESCE((SELECT SUM(delta_cents)
    FROM customer_store_credit_entries WHERE customer_id=NEW.customer_id),0)+NEW.delta_cents
  OR NOT EXISTS (SELECT 1 FROM customers c WHERE c.customer_id=NEW.customer_id
    AND c.is_deleted=0 AND c.status='Active')
  OR (NEW.entry_type='ISSUE' AND (
      NEW.source_type<>'Sales Return' OR NEW.delta_cents<=0
      OR NOT EXISTS (
        SELECT 1 FROM sales_returns sr JOIN sales s ON s.invoice_id=sr.invoice_id
        WHERE sr.return_id=NEW.source_id AND sr.customer_id=NEW.customer_id
          AND sr.refund_method='Store Credit'
          AND CAST(ROUND(sr.total_return_amount*100) AS INTEGER)=NEW.delta_cents
          AND s.customer_id=NEW.customer_id
          AND s.paid_amount=s.grand_total AND s.due_amount=0
          AND s.grand_total>=sr.total_return_amount
      )
    ))
  -- Future phase G2-C must introduce an atomic, source-verified POS tender
  -- before enabling REDEEM. Until then this must fail closed.
  OR NEW.entry_type='REDEEM'
BEGIN SELECT RAISE(ABORT,'STORE_CREDIT_LEDGER_CONFLICT'); END;

CREATE TRIGGER IF NOT EXISTS trg_store_credit_entries_immutable_update
BEFORE UPDATE ON customer_store_credit_entries
BEGIN SELECT RAISE(ABORT,'STORE_CREDIT_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS trg_store_credit_entries_immutable_delete
BEFORE DELETE ON customer_store_credit_entries
BEGIN SELECT RAISE(ABORT,'STORE_CREDIT_APPEND_ONLY'); END;

CREATE VIEW IF NOT EXISTS customer_store_credit_balance AS
  SELECT c.customer_id, c.customer_name,
    COALESCE((SELECT SUM(e.delta_cents) FROM customer_store_credit_entries e
      WHERE e.customer_id=c.customer_id),0) AS available_cents,
    c.current_due AS receivable_due
  FROM customers c WHERE c.is_deleted=0;

CREATE VIEW IF NOT EXISTS store_credit_legacy_unreconciled AS
  SELECT sr.return_id, sr.invoice_id, sr.customer_id,
    CAST(ROUND(sr.total_return_amount*100) AS INTEGER) AS amount_cents,
    sr.created_at
  FROM sales_returns sr
  WHERE sr.refund_method='Store Credit'
    AND NOT EXISTS (SELECT 1 FROM customer_store_credit_entries e
      WHERE e.entry_type='ISSUE' AND e.source_type='Sales Return' AND e.source_id=sr.return_id);
