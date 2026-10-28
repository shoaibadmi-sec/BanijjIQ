-- Presentation grouping only: each child retains its own return_id and invoice_id.
ALTER TABLE sales_returns ADD COLUMN batch_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_sales_returns_batch ON sales_returns(batch_id, return_date);
