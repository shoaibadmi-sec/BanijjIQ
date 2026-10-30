-- Phase 3G2-F: custody of manually verified historical credit cases.
-- Case discovery is read-only. This schema does not grant spendable credit,
-- modify customer receivables, or resolve any existing discrepancy.
-- Future case resolutions MUST be independently authorized, source-verified
-- and committed with their financial effects and an audit in one D1 batch.
CREATE TABLE IF NOT EXISTS store_credit_reconciliation_cases (
  case_id TEXT PRIMARY KEY,
  flag_code TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unverified'
    CHECK(status IN ('unverified','under_review','verified_outstanding','verified_settled','rejected')),
  evidence_json TEXT NOT NULL DEFAULT '[]',
  review_reason TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  reviewed_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
  reviewed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  UNIQUE(flag_code,customer_id,reference_id)
);
CREATE INDEX IF NOT EXISTS idx_credit_case_status
  ON store_credit_reconciliation_cases(status,created_at,case_id);
-- No API path currently inserts or updates this table.
