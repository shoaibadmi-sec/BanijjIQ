-- Phase 3G2-B: a credit is valid only when a real paid, reconciled sale
-- and return exist. Inserting a liability cannot invent receipts or rewrite A/R.
CREATE TRIGGER IF NOT EXISTS trg_store_credit_issue_source_reconciles
BEFORE INSERT ON customer_store_credit_entries
WHEN NEW.entry_type='ISSUE' AND NOT EXISTS (
  SELECT 1 FROM sales_returns sr
  JOIN sales s ON s.invoice_id=sr.invoice_id
  JOIN customers c ON c.customer_id=NEW.customer_id
  WHERE sr.return_id=NEW.source_id
    AND sr.customer_id=NEW.customer_id
    AND sr.customer_phone=c.phone
    AND s.customer_id=NEW.customer_id
    AND s.status='Completed' AND s.is_deleted=0
    AND s.payment_type='Cash' AND s.payment_method='Cash'
    AND s.paid_amount=s.grand_total AND s.due_amount=0
    AND c.current_due>=0 AND c.is_deleted=0 AND c.status='Active'
    AND NEW.source_type='Sales Return'
    AND sr.refund_method='Store Credit'
    AND CAST(ROUND(sr.total_return_amount*100) AS INTEGER)=NEW.delta_cents
    AND (SELECT COUNT(*) FROM sales_return_items item
      WHERE item.return_id=sr.return_id)>0
    AND CAST(ROUND(COALESCE((SELECT SUM(item.line_total) FROM sales_return_items item
      WHERE item.return_id=sr.return_id),0)*100) AS INTEGER)=NEW.delta_cents
    AND (SELECT COUNT(*) FROM cash_book cb
      WHERE cb.reference=s.invoice_id AND cb.type='Sale' AND cb.is_deleted=0
        AND cb.debit=0)=1
    AND CAST(ROUND(COALESCE((SELECT SUM(cb.credit) FROM cash_book cb
      WHERE cb.reference=s.invoice_id AND cb.type='Sale' AND cb.is_deleted=0),0)*100) AS INTEGER)
      =CAST(ROUND(s.paid_amount*100) AS INTEGER)
    AND (SELECT COALESCE(SUM(CAST(ROUND(pr.total_return_amount*100) AS INTEGER)),0)
      FROM sales_returns pr WHERE pr.invoice_id=s.invoice_id)
      <=CAST(ROUND(s.paid_amount*100) AS INTEGER)
    -- Legacy old negative-due credits cannot be silently treated as a
    -- newly issued balance or made spendable by posting another return.
    AND NOT EXISTS (
      SELECT 1 FROM customer_ledger cl WHERE cl.customer_id=NEW.customer_id
        AND cl.type='Sales Return Credit'
    )
    AND NOT EXISTS (
      SELECT 1 FROM store_credit_legacy_unreconciled legacy
      JOIN sales_returns old ON old.return_id=legacy.return_id
      WHERE legacy.return_id<>sr.return_id
        AND (old.customer_id=NEW.customer_id OR old.customer_phone=c.phone)
    )
    -- Previously posted returns must have a matching money or liability
    -- journal. The current issuance is excluded until it is inserted.
    AND NOT EXISTS (
      SELECT 1 FROM sales_returns old
      WHERE old.invoice_id=s.invoice_id AND old.return_id<>sr.return_id
        AND (
          (old.refund_method='Cash' AND
            (SELECT COUNT(*) FROM cash_book cb
              WHERE cb.reference=old.return_id AND cb.type='Sales Return'
                AND cb.is_deleted=0 AND cb.credit=0)<>1)
          OR (old.refund_method='Cash' AND
            CAST(ROUND(COALESCE((SELECT SUM(cb.debit) FROM cash_book cb
              WHERE cb.reference=old.return_id AND cb.type='Sales Return'
                AND cb.is_deleted=0),0)*100) AS INTEGER)
                <>CAST(ROUND(old.total_return_amount*100) AS INTEGER))
          OR (old.refund_method='Store Credit' AND NOT EXISTS (
            SELECT 1 FROM customer_store_credit_entries e
            WHERE e.entry_type='ISSUE' AND e.source_type='Sales Return'
              AND e.source_id=old.return_id AND e.customer_id=NEW.customer_id
              AND e.delta_cents=CAST(ROUND(old.total_return_amount*100) AS INTEGER)
          ))
          OR old.refund_method NOT IN ('Cash','Store Credit')
        )
    )
)
BEGIN SELECT RAISE(ABORT,'STORE_CREDIT_SOURCE_CONFLICT'); END;
