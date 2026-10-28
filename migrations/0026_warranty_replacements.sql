PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS warranty_replacements (
  replacement_id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  warranty_id TEXT NOT NULL,
  replacement_date TEXT NOT NULL,
  product_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  original_serial_id TEXT NOT NULL,
  original_serial_number TEXT NOT NULL,
  replacement_serial_id TEXT NOT NULL,
  replacement_serial_number TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (claim_id) REFERENCES warranty_claims(claim_id),
  FOREIGN KEY (warranty_id) REFERENCES warranty_records(warranty_id),
  FOREIGN KEY (product_id) REFERENCES products(product_id),
  FOREIGN KEY (original_serial_id) REFERENCES product_serials(serial_id),
  FOREIGN KEY (replacement_serial_id) REFERENCES product_serials(serial_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_warranty_replacements_claim ON warranty_replacements(claim_id);
CREATE INDEX IF NOT EXISTS idx_warranty_replacements_warranty ON warranty_replacements(warranty_id, replacement_date);
CREATE INDEX IF NOT EXISTS idx_warranty_replacements_product ON warranty_replacements(product_id, replacement_date);
