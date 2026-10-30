-- Phase 7D stocktaking. Cost audit only, no expense or cash posting.
CREATE TABLE IF NOT EXISTS stock_counts (
 count_id TEXT PRIMARY KEY,
 product_id TEXT NOT NULL REFERENCES products(product_id),
 expected_quantity REAL NOT NULL CHECK(expected_quantity>=0),
 counted_quantity REAL NOT NULL CHECK(counted_quantity>=0),
 verified_unit_cost REAL,
 note TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED')),
 cost_minor INTEGER,
 created_by TEXT NOT NULL,
 approved_by TEXT,
 created_at TEXT NOT NULL DEFAULT(datetime('now')),
 approved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_stock_counts_product ON stock_counts(product_id,created_at DESC);
CREATE TABLE IF NOT EXISTS stock_count_lots (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 count_id TEXT NOT NULL REFERENCES stock_counts(count_id),
 lot_id TEXT NOT NULL REFERENCES stock_lots(lot_id),
 movement_id TEXT NOT NULL UNIQUE REFERENCES stock_movements(movement_id),
 quantity REAL NOT NULL CHECK(quantity>0),
 unit_cost REAL NOT NULL CHECK(unit_cost>0),
 cost_minor INTEGER NOT NULL CHECK(cost_minor>=0),
 UNIQUE(count_id,lot_id)
);
