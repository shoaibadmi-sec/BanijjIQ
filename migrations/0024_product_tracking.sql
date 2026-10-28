PRAGMA foreign_keys = ON;

ALTER TABLE products ADD COLUMN track_serial INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN track_expiry INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN track_warranty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN warranty_period_value INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN warranty_period_unit TEXT NOT NULL DEFAULT 'Months';

ALTER TABLE stock_lots ADD COLUMN tracking_required_quantity REAL NOT NULL DEFAULT 0;
ALTER TABLE stock_lots ADD COLUMN tracking_status TEXT NOT NULL DEFAULT 'Ready';

CREATE TABLE IF NOT EXISTS stock_expiry_batches (
  expiry_batch_id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  batch_no TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL,
  original_quantity REAL NOT NULL DEFAULT 0,
  remaining_quantity REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (lot_id) REFERENCES stock_lots(lot_id),
  FOREIGN KEY (product_id) REFERENCES products(product_id)
);
CREATE INDEX IF NOT EXISTS idx_expiry_batches_product_date ON stock_expiry_batches(product_id, expiry_date, remaining_quantity);
CREATE INDEX IF NOT EXISTS idx_expiry_batches_lot ON stock_expiry_batches(lot_id);

CREATE TABLE IF NOT EXISTS product_serials (
  serial_id TEXT PRIMARY KEY,
  serial_number TEXT NOT NULL COLLATE NOCASE,
  product_id TEXT NOT NULL,
  lot_id TEXT NOT NULL,
  expiry_batch_id TEXT,
  status TEXT NOT NULL DEFAULT 'In Stock',
  sale_invoice_id TEXT NOT NULL DEFAULT '',
  sold_at TEXT,
  returned_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(product_id),
  FOREIGN KEY (lot_id) REFERENCES stock_lots(lot_id),
  FOREIGN KEY (expiry_batch_id) REFERENCES stock_expiry_batches(expiry_batch_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_serial_unique ON product_serials(serial_number COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_product_serial_product_status ON product_serials(product_id, status);
CREATE INDEX IF NOT EXISTS idx_product_serial_lot ON product_serials(lot_id);
CREATE INDEX IF NOT EXISTS idx_product_serial_invoice ON product_serials(sale_invoice_id);

CREATE TABLE IF NOT EXISTS sale_item_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  lot_id TEXT NOT NULL,
  serial_id TEXT,
  serial_number TEXT NOT NULL DEFAULT '',
  expiry_batch_id TEXT,
  quantity REAL NOT NULL DEFAULT 0,
  returned_quantity REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(product_id),
  FOREIGN KEY (lot_id) REFERENCES stock_lots(lot_id),
  FOREIGN KEY (serial_id) REFERENCES product_serials(serial_id),
  FOREIGN KEY (expiry_batch_id) REFERENCES stock_expiry_batches(expiry_batch_id)
);
CREATE INDEX IF NOT EXISTS idx_sale_tracking_invoice_product ON sale_item_tracking(invoice_id, product_id);

CREATE TABLE IF NOT EXISTS warranty_records (
  warranty_id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  sale_date TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  customer_id TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  serial_id TEXT,
  serial_number TEXT NOT NULL DEFAULT '',
  quantity REAL NOT NULL DEFAULT 1,
  remaining_quantity REAL NOT NULL DEFAULT 1,
  warranty_end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(product_id),
  FOREIGN KEY (serial_id) REFERENCES product_serials(serial_id)
);
CREATE INDEX IF NOT EXISTS idx_warranty_invoice ON warranty_records(invoice_id, product_id);
CREATE INDEX IF NOT EXISTS idx_warranty_serial ON warranty_records(serial_number);
CREATE INDEX IF NOT EXISTS idx_warranty_end ON warranty_records(warranty_end_date, status);
