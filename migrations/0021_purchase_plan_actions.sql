ALTER TABLE purchase_plans ADD COLUMN rejected_at TEXT;
ALTER TABLE purchase_plans ADD COLUMN rejected_by TEXT NOT NULL DEFAULT '';
ALTER TABLE purchase_plans ADD COLUMN rejection_reason TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_purchase_plans_status_date
ON purchase_plans(status, plan_date, created_at);
