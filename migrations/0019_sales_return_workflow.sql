-- V30 Sales Return completion: backdated return metadata
ALTER TABLE sales_returns ADD COLUMN is_backdated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_returns ADD COLUMN backdated_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_returns ADD COLUMN backdated_reason TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_sales_returns_backdated
ON sales_returns(return_date, is_backdated, created_at);
