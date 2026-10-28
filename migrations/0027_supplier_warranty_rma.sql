PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS supplier_warranty_rmas (
  rma_id TEXT PRIMARY KEY,
  rma_no TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  claim_id TEXT,
  warranty_id TEXT,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  serial_id TEXT,
  serial_number TEXT NOT NULL DEFAULT '',
  quantity REAL NOT NULL DEFAULT 1,
  customer_handling TEXT NOT NULL DEFAULT 'Waiting for Supplier',
  sent_date TEXT NOT NULL,
  supplier_reference TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'At Supplier',
  stock_was_on_hand INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  resolution_type TEXT NOT NULL DEFAULT '',
  resolved_date TEXT,
  resolution_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  resolved_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id),
  FOREIGN KEY (claim_id) REFERENCES warranty_claims(claim_id),
  FOREIGN KEY (warranty_id) REFERENCES warranty_records(warranty_id),
  FOREIGN KEY (product_id) REFERENCES products(product_id),
  FOREIGN KEY (serial_id) REFERENCES product_serials(serial_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_warranty_rma_supplier ON supplier_warranty_rmas(supplier_id, sent_date DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_warranty_rma_claim ON supplier_warranty_rmas(claim_id, status);
CREATE INDEX IF NOT EXISTS idx_supplier_warranty_rma_status ON supplier_warranty_rmas(status, sent_date DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_warranty_rma_serial ON supplier_warranty_rmas(serial_number);

CREATE TABLE IF NOT EXISTS supplier_warranty_rma_received_items (
  received_item_id TEXT PRIMARY KEY,
  rma_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  unit_value REAL NOT NULL DEFAULT 0,
  destination TEXT NOT NULL DEFAULT 'Inventory',
  lot_id TEXT NOT NULL DEFAULT '',
  tracking_status TEXT NOT NULL DEFAULT 'Ready',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (rma_id) REFERENCES supplier_warranty_rmas(rma_id),
  FOREIGN KEY (product_id) REFERENCES products(product_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_warranty_received_rma ON supplier_warranty_rma_received_items(rma_id);

CREATE TABLE IF NOT EXISTS supplier_warranty_rma_financials (
  financial_id TEXT PRIMARY KEY,
  rma_id TEXT NOT NULL,
  financial_type TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT '',
  bank_account_id TEXT NOT NULL DEFAULT '',
  supplier_ledger_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (rma_id) REFERENCES supplier_warranty_rmas(rma_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_warranty_financial_rma ON supplier_warranty_rma_financials(rma_id);
