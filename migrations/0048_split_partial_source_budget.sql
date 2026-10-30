-- Phase 3G2-I: source-budget evidence for future partial split-payment Sales Returns.
-- Does NOT authorize financial posting. Never relax 0047's complete-invoice audits.
-- Each line is original-source/poisha exact and immutable. The final money/FIFO
-- audit and atomic POST must be added separately before enabling partial refunds.
CREATE TABLE split_partial_refund_allocations (
  allocation_id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES sales_returns(return_id),
  invoice_id TEXT NOT NULL REFERENCES sales(invoice_id),
  method TEXT NOT NULL CHECK(method IN ('Cash','Bank','Mobile Banking','Store Credit')),
  amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0),
  bank_account_id TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL DEFAULT '',
  source_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
  CHECK(
    (method='Cash' AND bank_account_id='' AND customer_id='' AND source_key='Cash')
    OR (method='Store Credit' AND bank_account_id='' AND customer_id<>'' AND source_key='Store Credit')
    OR (method IN ('Bank','Mobile Banking') AND bank_account_id<>'' AND customer_id=''
      AND source_key=method||':'||bank_account_id)
  ),
  UNIQUE(return_id,source_key)
);
CREATE INDEX idx_partial_split_invoice_source
  ON split_partial_refund_allocations(invoice_id,source_key);

-- The cumulative cap is tested at INSERT time. D1's serialized batch writes
-- cannot consume the same original-source balance twice.
CREATE TRIGGER trg_partial_split_source_capacity
BEFORE INSERT ON split_partial_refund_allocations
WHEN NOT EXISTS(
  SELECT 1 FROM sales_returns sr
  JOIN sales s ON s.invoice_id=sr.invoice_id
  JOIN customers c ON c.customer_id=s.customer_id
  JOIN sale_tender_allocations original
    ON original.invoice_id=s.invoice_id AND original.source_key=NEW.source_key
  WHERE sr.return_id=NEW.return_id AND sr.invoice_id=NEW.invoice_id
    AND sr.refund_method='Split Partial' AND sr.total_return_amount>0
    AND CAST(ROUND(sr.total_return_amount*100) AS INTEGER)>0
    AND s.status='Completed' AND s.is_deleted=0
    AND s.payment_method='Split' AND s.payment_type='Cash'
    AND s.paid_amount=s.grand_total AND s.due_amount=0
    AND s.grand_total>0 AND s.customer_id=sr.customer_id
    -- Unmodified full-price source: a doctored invoice must not mint
    -- a fresh refund budget against its old immutable payment allocations.
    AND CAST(ROUND(s.subtotal*100) AS INTEGER)=CAST(ROUND(s.grand_total*100) AS INTEGER)
    AND CAST(ROUND(s.discount*100) AS INTEGER)=0
    AND (SELECT COUNT(*) FROM sale_tender_allocations t
      WHERE t.invoice_id=s.invoice_id) BETWEEN 2 AND 8
    AND (SELECT COALESCE(SUM(t.amount_cents),0) FROM sale_tender_allocations t
      WHERE t.invoice_id=s.invoice_id)=CAST(ROUND(s.grand_total*100) AS INTEGER)
    AND c.customer_id=sr.customer_id AND c.is_deleted=0 AND c.status='Active'
    AND sr.customer_phone=c.phone AND s.customer_phone=c.phone
    AND original.method=NEW.method
    AND original.bank_account_id=NEW.bank_account_id
    AND original.customer_id=NEW.customer_id
    AND (NEW.method<>'Store Credit' OR NEW.customer_id=c.customer_id)
    AND (NEW.method NOT IN ('Bank','Mobile Banking') OR EXISTS(
      SELECT 1 FROM bank_accounts account WHERE account.bank_account_id=NEW.bank_account_id
        AND account.account_type=NEW.method AND account.status='Active'
    ))
    AND NOT EXISTS(
      SELECT 1 FROM sales_returns old WHERE old.invoice_id=s.invoice_id
        AND old.return_id<>sr.return_id AND old.refund_method<>'Split Partial'
    )
    AND NOT EXISTS(
      SELECT 1 FROM sales_return_refund_allocations complete
      WHERE complete.invoice_id=s.invoice_id
    )
    AND NEW.amount_cents + COALESCE((
      SELECT SUM(prior.amount_cents) FROM split_partial_refund_allocations prior
      WHERE prior.invoice_id=NEW.invoice_id AND prior.source_key=NEW.source_key
    ),0) <= original.amount_cents
    AND NEW.amount_cents + COALESCE((
      SELECT SUM(prior.amount_cents) FROM split_partial_refund_allocations prior
      WHERE prior.return_id=NEW.return_id
    ),0) <= CAST(ROUND(sr.total_return_amount*100) AS INTEGER)
)
BEGIN SELECT RAISE(ABORT,'PARTIAL_SPLIT_SOURCE_CONFLICT'); END;

CREATE TRIGGER trg_partial_split_no_update
BEFORE UPDATE ON split_partial_refund_allocations
BEGIN SELECT RAISE(ABORT,'PARTIAL_SPLIT_APPEND_ONLY'); END;
CREATE TRIGGER trg_partial_split_no_delete
BEFORE DELETE ON split_partial_refund_allocations
BEGIN SELECT RAISE(ABORT,'PARTIAL_SPLIT_APPEND_ONLY'); END;
