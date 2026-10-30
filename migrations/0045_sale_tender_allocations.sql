-- Phase 3G2-G Task 4: custody for individually sourced POS tender rows.
-- This schema deliberately does NOT enable posting. Until Task 5 links the
-- source books and journal in a single guarded D1 transaction, checkout
-- rejects all explicit tenders to prevent unintentional cash recognition.
CREATE TABLE IF NOT EXISTS pos_sale_tender_allocations (
  allocation_id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES sales(invoice_id),
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 12),
  method TEXT NOT NULL CHECK(method IN ('Cash','Bank','Mobile Banking','Store Credit')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  bank_account_id TEXT NOT NULL DEFAULT '',
  source_entry_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
  UNIQUE(invoice_id,ordinal),
  CHECK (
    (method IN ('Bank','Mobile Banking') AND length(bank_account_id)>0)
    OR (method IN ('Cash','Store Credit') AND bank_account_id='')
  )
);
CREATE INDEX IF NOT EXISTS idx_pos_sale_tender_invoice
  ON pos_sale_tender_allocations(invoice_id,ordinal);
CREATE TRIGGER IF NOT EXISTS trg_sale_tender_append_only_update
BEFORE UPDATE ON pos_sale_tender_allocations
BEGIN SELECT RAISE(ABORT,'POS_TENDER_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS trg_sale_tender_append_only_delete
BEFORE DELETE ON pos_sale_tender_allocations
BEGIN SELECT RAISE(ABORT,'POS_TENDER_APPEND_ONLY'); END;
