-- Phase 3G2-C: backed, non-cash redemption for exactly one fully-paid POS sale.
-- A sale and its negative liability entry are inserted in one D1 batch; a
-- concurrent double-spend fails on the authoritative current journal balance.
DROP TRIGGER IF EXISTS trg_store_credit_validate_entry;
CREATE TRIGGER trg_store_credit_validate_entry
BEFORE INSERT ON customer_store_credit_entries
WHEN
  NEW.balance_after_cents <> COALESCE((SELECT SUM(delta_cents)
    FROM customer_store_credit_entries WHERE customer_id=NEW.customer_id),0)+NEW.delta_cents
  OR NEW.balance_after_cents < 0
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
  OR (NEW.entry_type='REDEEM' AND (
      NEW.source_type<>'Sale' OR NEW.delta_cents>=0
      OR NOT EXISTS (
        SELECT 1 FROM sales s JOIN customers c ON c.customer_id=s.customer_id
        WHERE s.invoice_id=NEW.source_id AND s.customer_id=NEW.customer_id
          AND s.status='Completed' AND s.is_deleted=0
          AND s.payment_type='Cash' AND s.payment_method='Store Credit'
          AND s.paid_amount=s.grand_total AND s.due_amount=0
          AND s.grand_total>0 AND s.bank_account_id=''
          AND s.customer_phone=c.phone
          AND CAST(ROUND(s.grand_total*100) AS INTEGER)=-NEW.delta_cents
      )
      OR EXISTS (SELECT 1 FROM cash_book cb WHERE cb.reference=NEW.source_id)
      OR EXISTS (SELECT 1 FROM bank_book bb WHERE bb.reference=NEW.source_id)
      OR EXISTS (SELECT 1 FROM customer_ledger cl WHERE cl.reference=NEW.source_id)
      OR EXISTS (
        SELECT 1 FROM store_credit_legacy_unreconciled legacy
        JOIN sales_returns sr ON sr.return_id=legacy.return_id
        JOIN customers c ON c.customer_id=NEW.customer_id
        WHERE sr.customer_id=NEW.customer_id OR sr.customer_phone=c.phone
      )
      OR EXISTS (
        SELECT 1 FROM customer_ledger cl
        WHERE cl.customer_id=NEW.customer_id AND cl.type='Sales Return Credit'
      )
    ))
BEGIN SELECT RAISE(ABORT,'STORE_CREDIT_LEDGER_CONFLICT'); END;

-- Ensure a Store Credit sale cannot commit with a missing or mismatched
-- redemption even if the normal server writes its audit record last.
CREATE TRIGGER IF NOT EXISTS trg_store_credit_sale_requires_journal
BEFORE INSERT ON audit_logs
WHEN NEW.action='CREATE_SALE' AND EXISTS (
  SELECT 1 FROM sales s
  WHERE s.invoice_id=NEW.entity_id AND s.payment_method='Store Credit'
    AND NOT EXISTS (
      SELECT 1 FROM customer_store_credit_entries sc
      WHERE sc.entry_type='REDEEM' AND sc.source_type='Sale'
        AND sc.source_id=s.invoice_id AND sc.customer_id=s.customer_id
        AND sc.delta_cents=-CAST(ROUND(s.grand_total*100) AS INTEGER)
    )
)
BEGIN SELECT RAISE(ABORT,'STORE_CREDIT_REDEMPTION_REQUIRED'); END;
