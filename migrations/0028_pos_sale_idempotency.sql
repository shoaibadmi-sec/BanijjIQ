-- Stores the caller's POS request key in the same transaction as the sale.
-- Existing invoices remain unchanged. Legacy callers can omit the key.
CREATE TABLE IF NOT EXISTS pos_sale_requests (
  request_id TEXT PRIMARY KEY,
  payload_sha256 TEXT NOT NULL,
  invoice_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pos_sale_requests_created ON pos_sale_requests(created_at);
