-- Phase 3G2-G Task 4: immutable tender provenance for future split POS sales.
-- No API writes this table until independently tested Task 5.
-- Monetary values are strictly positive integer poisha, never floating BDT.
CREATE TABLE IF NOT EXISTS sale_tender_allocations (
  allocation_id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES sales(invoice_id),
  line_number INTEGER NOT NULL CHECK(line_number>=1 AND line_number<=8),
  method TEXT NOT NULL CHECK(method IN ('Cash','Bank','Mobile Banking','Store Credit')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0 AND amount_cents<=9000000000000000),
  bank_account_id TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL DEFAULT '',
  source_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
  CHECK(
    (method IN ('Bank','Mobile Banking') AND length(bank_account_id)>0
      AND source_key=method||':'||bank_account_id)
    OR
    (method IN ('Cash','Store Credit') AND bank_account_id=''
      AND source_key=method)
  ),
  CHECK(method<>'Store Credit' OR length(customer_id)>0),
  UNIQUE(invoice_id,line_number),
  UNIQUE(invoice_id,source_key)
);
CREATE INDEX IF NOT EXISTS idx_sale_tender_invoice
  ON sale_tender_allocations(invoice_id,line_number);
CREATE INDEX IF NOT EXISTS idx_sale_tender_customer
  ON sale_tender_allocations(customer_id,invoice_id);

CREATE TRIGGER IF NOT EXISTS trg_sale_tender_no_update
BEFORE UPDATE ON sale_tender_allocations
BEGIN SELECT RAISE(ABORT,'SALE_TENDER_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sale_tender_no_delete
BEFORE DELETE ON sale_tender_allocations
BEGIN SELECT RAISE(ABORT,'SALE_TENDER_IMMUTABLE'); END;

-- Allocation insertion and source verification will be implemented in Task 5.
-- Until then, the POS endpoint must reject a tenders array rather than
-- silently allocating the entire total to the legacy paymentMethod.
