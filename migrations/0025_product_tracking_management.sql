PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS warranty_claims (
  claim_id TEXT PRIMARY KEY,
  warranty_id TEXT NOT NULL,
  claim_date TEXT NOT NULL,
  issue TEXT NOT NULL,
  resolution TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Open',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (warranty_id) REFERENCES warranty_records(warranty_id)
);

CREATE INDEX IF NOT EXISTS idx_warranty_claims_warranty ON warranty_claims(warranty_id, status, claim_date);
CREATE INDEX IF NOT EXISTS idx_warranty_claims_status ON warranty_claims(status, claim_date);
