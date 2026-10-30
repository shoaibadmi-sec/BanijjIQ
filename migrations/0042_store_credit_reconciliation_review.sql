-- Phase 3G2-E: READ-ONLY evidence for independent liability reconciliation.
-- This view never converts old negative receivables into spendable credit.
-- Do not add any automatic repair, write triggers or customer balance updates.
CREATE VIEW IF NOT EXISTS store_credit_reconciliation_flags AS
SELECT 'LEGACY_UNJOURNALED_RETURN' AS flag_code,
  COALESCE(NULLIF(l.customer_id,''),s.customer_id,'') AS customer_id,
  l.return_id AS reference_id, l.amount_cents AS expected_cents,
  0 AS recorded_cents
FROM store_credit_legacy_unreconciled l
LEFT JOIN sales s ON s.invoice_id=l.invoice_id
UNION ALL
SELECT 'LEGACY_RECEIVABLE_CREDIT', cl.customer_id, cl.reference,
  CAST(ROUND(cl.credit*100) AS INTEGER), 0
FROM customer_ledger cl WHERE cl.type='Sales Return Credit'
UNION ALL
SELECT 'NEGATIVE_RECEIVABLE', c.customer_id, c.customer_id,
  0, CAST(ROUND(c.current_due*100) AS INTEGER)
FROM customers c WHERE c.current_due<0
UNION ALL
SELECT 'ISSUE_SOURCE_MISMATCH', e.customer_id, e.source_id,
  CAST(ROUND(COALESCE(sr.total_return_amount,0)*100) AS INTEGER), e.delta_cents
FROM customer_store_credit_entries e
LEFT JOIN sales_returns sr ON sr.return_id=e.source_id
LEFT JOIN sales s ON s.invoice_id=sr.invoice_id
WHERE e.entry_type='ISSUE'
  AND (e.source_type<>'Sales Return' OR sr.return_id IS NULL
    OR sr.customer_id<>e.customer_id OR sr.refund_method<>'Store Credit'
    OR CAST(ROUND(sr.total_return_amount*100) AS INTEGER)<>e.delta_cents
    OR s.invoice_id IS NULL OR s.customer_id<>e.customer_id)
UNION ALL
SELECT 'REDEMPTION_SOURCE_MISMATCH', e.customer_id, e.source_id,
  -CAST(ROUND(COALESCE(s.grand_total,0)*100) AS INTEGER), e.delta_cents
FROM customer_store_credit_entries e
LEFT JOIN sales s ON s.invoice_id=e.source_id
WHERE e.entry_type='REDEEM'
  AND (e.source_type<>'Sale' OR s.invoice_id IS NULL
    OR s.customer_id<>e.customer_id OR s.payment_method<>'Store Credit'
    OR CAST(ROUND(s.grand_total*100) AS INTEGER)<>-e.delta_cents
    OR s.is_deleted<>0 OR s.status<>'Completed')
UNION ALL
SELECT 'CREDIT_SALE_WITHOUT_REDEMPTION', s.customer_id, s.invoice_id,
  -CAST(ROUND(s.grand_total*100) AS INTEGER), 0
FROM sales s WHERE s.payment_method='Store Credit'
  AND NOT EXISTS (
    SELECT 1 FROM customer_store_credit_entries e
    WHERE e.entry_type='REDEEM' AND e.source_type='Sale'
      AND e.source_id=s.invoice_id AND e.customer_id=s.customer_id
      AND e.delta_cents=-CAST(ROUND(s.grand_total*100) AS INTEGER)
  )
UNION ALL
SELECT 'CREDIT_SALE_HAS_CASH_RECEIPT', s.customer_id, s.invoice_id,
  0, CAST(ROUND(COALESCE(SUM(cb.credit-cb.debit),0)*100) AS INTEGER)
FROM sales s JOIN cash_book cb ON cb.reference=s.invoice_id
WHERE s.payment_method='Store Credit' AND cb.is_deleted=0
GROUP BY s.invoice_id
UNION ALL
SELECT 'CREDIT_SALE_HAS_BANK_RECEIPT', s.customer_id, s.invoice_id,
  0, CAST(ROUND(COALESCE(SUM(bb.credit-bb.debit),0)*100) AS INTEGER)
FROM sales s JOIN bank_book bb ON bb.reference=s.invoice_id
WHERE s.payment_method='Store Credit' AND bb.is_deleted=0
GROUP BY s.invoice_id
UNION ALL
SELECT 'NEGATIVE_LIABILITY', e.customer_id, e.customer_id,
  0, SUM(e.delta_cents)
FROM customer_store_credit_entries e
GROUP BY e.customer_id HAVING SUM(e.delta_cents)<0;
