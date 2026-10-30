-- G2-G Task 5: compatible, source-verified split-payment Store Credit redemption.
-- Retain the old single-tender protections and account liability from 0044.
-- Phase 3G2-C: backed, non-cash redemption for exactly one fully-paid POS sale.
-- A sale and its negative liability entry are inserted in one D1 batch; a
-- concurrent double-spend fails on the authoritative current journal balance.
DROP TRIGGER IF EXISTS trg_store_credit_validate_entry;
CREATE TRIGGER trg_store_credit_validate_entry
BEFORE INSERT ON customer_store_credit_entries
WHEN
  NEW.balance_after_cents <> COALESCE((SELECT SUM(delta_cents)
    FROM customer_store_credit_entries WHERE customer_id=NEW.customer_id),0)+COALESCE((SELECT SUM(a.delta_cents) FROM store_credit_historical_adjustments a WHERE a.customer_id=NEW.customer_id),0)+NEW.delta_cents
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
        WHERE (s.invoice_id=NEW.source_id AND s.customer_id=NEW.customer_id
          AND s.status='Completed' AND s.is_deleted=0
          AND s.payment_type='Cash' AND s.payment_method='Store Credit'
          AND s.paid_amount=s.grand_total AND s.due_amount=0
          AND s.grand_total>0 AND s.bank_account_id=''
          AND s.customer_phone=c.phone
          AND CAST(ROUND(s.grand_total*100) AS INTEGER)=-NEW.delta_cents) OR (
          s.invoice_id=NEW.source_id AND s.customer_id=NEW.customer_id
          AND s.status='Completed' AND s.is_deleted=0
          AND s.payment_type='Cash' AND s.payment_method='Split'
          AND s.paid_amount=s.grand_total AND s.due_amount=0
          AND s.grand_total>0 AND s.bank_account_id=''
          AND s.customer_phone=c.phone
          AND EXISTS (SELECT 1 FROM sale_tender_allocations a
            WHERE a.invoice_id=s.invoice_id AND a.method='Store Credit'
              AND a.customer_id=NEW.customer_id AND a.amount_cents=-NEW.delta_cents)
          AND (SELECT COALESCE(SUM(a.amount_cents),0)
            FROM sale_tender_allocations a WHERE a.invoice_id=s.invoice_id)
              =CAST(ROUND(s.grand_total*100) AS INTEGER)
        )
      )
      OR (EXISTS (SELECT 1 FROM sales s WHERE s.invoice_id=NEW.source_id AND s.payment_method='Store Credit')
        AND (
          EXISTS (SELECT 1 FROM cash_book cb WHERE cb.reference=NEW.source_id)
          OR EXISTS (SELECT 1 FROM bank_book bb WHERE bb.reference=NEW.source_id)
          OR EXISTS (SELECT 1 FROM customer_ledger cl WHERE cl.reference=NEW.source_id)
        ))
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


-- Entire checkout batch must supply exactly the declared payment sources
-- before its final CREATE_SALE audit; any mismatch rolls back FIFO and all books.
CREATE TRIGGER IF NOT EXISTS trg_split_sale_audit_requires_allocations
BEFORE INSERT ON audit_logs
WHEN NEW.action='CREATE_SALE'
  AND EXISTS (SELECT 1 FROM sales s WHERE s.invoice_id=NEW.entity_id AND s.payment_method='Split')
  AND NOT EXISTS (
    SELECT 1 FROM sales s
    WHERE s.invoice_id=NEW.entity_id
      AND s.status='Completed' AND s.is_deleted=0
      AND s.payment_type='Cash' AND s.bank_account_id=''
      AND s.due_amount=0 AND s.paid_amount=s.grand_total AND s.grand_total>0
      AND (SELECT COUNT(*) FROM sale_tender_allocations a WHERE a.invoice_id=s.invoice_id) BETWEEN 2 AND 8
      AND (SELECT SUM(a.amount_cents) FROM sale_tender_allocations a WHERE a.invoice_id=s.invoice_id)
        =CAST(ROUND(s.grand_total*100) AS INTEGER)
      AND (SELECT COUNT(*) FROM cash_book cb WHERE cb.reference=s.invoice_id AND cb.is_deleted=0)
        =(SELECT COUNT(*) FROM sale_tender_allocations a WHERE a.invoice_id=s.invoice_id AND a.method='Cash')
      AND (SELECT COALESCE(SUM(CAST(ROUND(cb.credit*100) AS INTEGER)),0) FROM cash_book cb
        WHERE cb.reference=s.invoice_id AND cb.is_deleted=0 AND cb.type='Sale' AND cb.debit=0)
        =(SELECT COALESCE(SUM(a.amount_cents),0) FROM sale_tender_allocations a
        WHERE a.invoice_id=s.invoice_id AND a.method='Cash')
      AND (SELECT COUNT(*) FROM bank_book bb WHERE bb.reference=s.invoice_id AND bb.is_deleted=0)
        =(SELECT COUNT(*) FROM sale_tender_allocations a WHERE a.invoice_id=s.invoice_id
        AND a.method IN ('Bank','Mobile Banking'))
      AND NOT EXISTS (
        SELECT 1 FROM sale_tender_allocations a
        LEFT JOIN bank_accounts bank ON bank.bank_account_id=a.bank_account_id
        LEFT JOIN bank_book bb ON bb.reference=a.invoice_id AND bb.bank_account_id=a.bank_account_id
          AND bb.type='Sale' AND bb.is_deleted=0 AND bb.debit=0
          AND CAST(ROUND(bb.credit*100) AS INTEGER)=a.amount_cents
          AND CAST(ROUND(bb.balance*100) AS INTEGER)=CAST(ROUND(bank.current_balance*100) AS INTEGER)
        WHERE a.invoice_id=s.invoice_id AND a.method IN ('Bank','Mobile Banking')
          AND (bank.bank_account_id IS NULL OR bank.status<>'Active'
            OR bank.account_type<>a.method OR bb.entry_id IS NULL)
      )
      AND (SELECT COUNT(*) FROM customer_store_credit_entries e
        WHERE e.entry_type='REDEEM' AND e.source_type='Sale' AND e.source_id=s.invoice_id)
        =(SELECT COUNT(*) FROM sale_tender_allocations a WHERE a.invoice_id=s.invoice_id AND a.method='Store Credit')
      AND (SELECT COALESCE(SUM(-e.delta_cents),0) FROM customer_store_credit_entries e
        WHERE e.entry_type='REDEEM' AND e.source_type='Sale' AND e.source_id=s.invoice_id)
        =(SELECT COALESCE(SUM(a.amount_cents),0) FROM sale_tender_allocations a
        WHERE a.invoice_id=s.invoice_id AND a.method='Store Credit')
      AND NOT EXISTS(SELECT 1 FROM customer_ledger cl WHERE cl.reference=s.invoice_id)
  )
BEGIN SELECT RAISE(ABORT,'SPLIT_TENDER_ACCOUNTING_CONFLICT'); END;
