-- G2-F: historical due-side Store Credit reclassification.
-- Do not rewrite the immutable ISSUE/REDEEM journal or any historical customer ledger.
CREATE TABLE IF NOT EXISTS store_credit_historical_adjustments (
  case_id TEXT PRIMARY KEY REFERENCES store_credit_reconciliation_cases(case_id),
  customer_id TEXT NOT NULL REFERENCES customers(customer_id),
  return_id TEXT NOT NULL UNIQUE REFERENCES sales_returns(return_id),
  old_ledger_id TEXT NOT NULL UNIQUE REFERENCES customer_ledger(ledger_id),
  delta_cents INTEGER NOT NULL CHECK(delta_cents > 0),
  balance_after_cents INTEGER NOT NULL CHECK(balance_after_cents >= 0),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
);
CREATE INDEX IF NOT EXISTS idx_credit_historical_customer
  ON store_credit_historical_adjustments(customer_id,created_at,case_id);

CREATE TRIGGER IF NOT EXISTS trg_credit_historical_guard
BEFORE INSERT ON store_credit_historical_adjustments
WHEN
  NEW.balance_after_cents <> NEW.delta_cents
    + COALESCE((SELECT SUM(e.delta_cents) FROM customer_store_credit_entries e
      WHERE e.customer_id=NEW.customer_id),0)
    + COALESCE((SELECT SUM(a.delta_cents) FROM store_credit_historical_adjustments a
      WHERE a.customer_id=NEW.customer_id),0)
  OR NOT EXISTS (
    SELECT 1 FROM store_credit_reconciliation_cases rc
    JOIN customers c ON c.customer_id=rc.customer_id
    JOIN sales_returns sr ON sr.return_id=rc.reference_id
    JOIN sales s ON s.invoice_id=sr.invoice_id
    JOIN customer_ledger old ON old.ledger_id=NEW.old_ledger_id
    JOIN customer_ledger correction
      ON correction.reference=rc.case_id AND correction.customer_id=c.customer_id
      AND correction.type='Store Credit Reclassification'
    WHERE rc.case_id=NEW.case_id
      AND rc.status='verified_outstanding'
      AND rc.flag_code='LEGACY_UNJOURNALED_RETURN'
      AND rc.customer_id=NEW.customer_id
      AND rc.reference_id=NEW.return_id
      AND rc.reviewed_by=NEW.created_by
      AND c.status='Active' AND c.is_deleted=0
      AND c.current_due=0 AND c.phone=sr.customer_phone
      AND sr.customer_id=c.customer_id AND sr.refund_method='Store Credit'
      AND CAST(ROUND(sr.total_return_amount*100) AS INTEGER)=NEW.delta_cents
      AND s.customer_id=c.customer_id AND s.customer_phone=c.phone
      AND s.payment_method='Cash' AND s.payment_type='Cash'
      AND s.status='Completed' AND s.is_deleted=0
      AND s.paid_amount=s.grand_total AND s.due_amount=0
      AND CAST(ROUND(s.grand_total*100) AS INTEGER)>=NEW.delta_cents
      AND old.customer_id=c.customer_id
      AND old.type='Sales Return Credit' AND old.reference=sr.return_id
      AND CAST(ROUND(old.credit*100) AS INTEGER)=NEW.delta_cents
      AND old.debit=0
      AND correction.debit=sr.total_return_amount
      AND correction.credit=0 AND correction.balance=0
      AND (SELECT COUNT(*) FROM customer_ledger lc
        WHERE lc.customer_id=c.customer_id AND lc.type='Sales Return Credit')=1
      AND (SELECT COUNT(*) FROM sales_returns other
        WHERE other.invoice_id=s.invoice_id)=1
      AND (SELECT COUNT(*) FROM sales_return_items ri
        WHERE ri.return_id=sr.return_id)>0
      AND CAST(ROUND(COALESCE((SELECT SUM(ri.line_total) FROM sales_return_items ri
        WHERE ri.return_id=sr.return_id),0)*100) AS INTEGER)=NEW.delta_cents
      AND (SELECT COUNT(*) FROM cash_book cb
        WHERE cb.reference=s.invoice_id AND cb.type='Sale'
          AND cb.is_deleted=0 AND cb.debit=0)=1
      AND CAST(ROUND(COALESCE((SELECT SUM(cb.credit) FROM cash_book cb
        WHERE cb.reference=s.invoice_id AND cb.type='Sale'
          AND cb.is_deleted=0),0)*100) AS INTEGER)
          =CAST(ROUND(s.paid_amount*100) AS INTEGER)
      AND NOT EXISTS(SELECT 1 FROM cash_book cb
        WHERE cb.reference=sr.return_id AND cb.is_deleted=0)
      AND NOT EXISTS(SELECT 1 FROM bank_book bb
        WHERE bb.reference=sr.return_id AND bb.is_deleted=0)
      AND NOT EXISTS(SELECT 1 FROM customer_store_credit_entries e
        WHERE e.customer_id=c.customer_id)
      AND NOT EXISTS(SELECT 1 FROM store_credit_historical_adjustments a
        WHERE a.customer_id=c.customer_id)
  )
BEGIN SELECT RAISE(ABORT,'STORE_CREDIT_HISTORICAL_SOURCE_CONFLICT'); END;

CREATE TRIGGER IF NOT EXISTS trg_credit_historical_update_guard
BEFORE UPDATE ON store_credit_historical_adjustments
BEGIN SELECT RAISE(ABORT,'STORE_CREDIT_HISTORICAL_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS trg_credit_historical_delete_guard
BEFORE DELETE ON store_credit_historical_adjustments
BEGIN SELECT RAISE(ABORT,'STORE_CREDIT_HISTORICAL_APPEND_ONLY'); END;

-- Audit must be last in the batch. Its trigger fails the whole batch when
-- any case, receivable correction or liability posting is missing.
CREATE TRIGGER IF NOT EXISTS trg_credit_historical_audit_guard
BEFORE INSERT ON audit_logs
WHEN NEW.action='RECONCILE_STORE_CREDIT'
  AND NOT EXISTS (
    SELECT 1 FROM store_credit_historical_adjustments a
    JOIN store_credit_reconciliation_cases rc ON rc.case_id=a.case_id
    JOIN customer_ledger cl ON cl.reference=a.case_id
      AND cl.customer_id=a.customer_id
      AND cl.type='Store Credit Reclassification'
    JOIN customers c ON c.customer_id=a.customer_id
    WHERE rc.case_id=NEW.entity_id
      AND NEW.entity_type='STORE_CREDIT_CASE'
      AND rc.reviewed_by=NEW.user_id AND a.created_by=NEW.user_id
      AND c.current_due=0 AND cl.balance=0
      AND CAST(ROUND(cl.debit*100) AS INTEGER)=a.delta_cents
  )
BEGIN SELECT RAISE(ABORT,'STORE_CREDIT_HISTORICAL_AUDIT_REQUIRED'); END;

-- All new credit-account queries use the combined liability, while the
-- original append-only ISSUE/REDEEM journal remains untouched.
DROP VIEW IF EXISTS customer_store_credit_balance;
CREATE VIEW customer_store_credit_balance AS
  SELECT c.customer_id,c.customer_name,
    COALESCE((SELECT SUM(e.delta_cents) FROM customer_store_credit_entries e
      WHERE e.customer_id=c.customer_id),0)
    +COALESCE((SELECT SUM(a.delta_cents) FROM store_credit_historical_adjustments a
      WHERE a.customer_id=c.customer_id),0) AS available_cents,
    c.current_due AS receivable_due
  FROM customers c WHERE c.is_deleted=0;
