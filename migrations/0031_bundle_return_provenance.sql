-- Each bundle sale is one visible sale_item; all component provenance remains immutable.
-- Store exact returned lots so repeated set returns never restore the same sale units twice.
CREATE TABLE sale_return_bundle_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  bundle_id TEXT NOT NULL,
  component_id TEXT NOT NULL,
  lot_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity>0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(return_id) REFERENCES sales_returns(return_id)
);
CREATE INDEX idx_bundle_return_lots_source ON sale_return_bundle_lots(invoice_id,bundle_id,component_id,lot_id);
CREATE INDEX idx_bundle_return_lots_return ON sale_return_bundle_lots(return_id);
