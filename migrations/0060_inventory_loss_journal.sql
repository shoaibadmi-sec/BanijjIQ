-- Phase 7C: immutable, source-backed physical damage / wastage audit.
-- No cash, customer due, or P&L journal is created by stock loss posting.
CREATE TABLE IF NOT EXISTS inventory_losses (
  request_id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(product_id),
  reason TEXT NOT NULL CHECK (reason IN ('DAMAGE','WASTAGE')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  note TEXT NOT NULL DEFAULT '',
  cost_minor INTEGER NOT NULL CHECK (cost_minor >= 0),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inventory_losses_product ON inventory_losses(product_id,created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_loss_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES inventory_losses(request_id),
  lot_id TEXT NOT NULL REFERENCES stock_lots(lot_id),
  movement_id TEXT NOT NULL UNIQUE REFERENCES stock_movements(movement_id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_cost REAL NOT NULL CHECK (unit_cost >= 0),
  cost_minor INTEGER NOT NULL CHECK (cost_minor >= 0),
  UNIQUE (request_id,lot_id)
);
