-- 0050 reserved for independent Phase 4 development; previous phases use 0037-0042.
-- Snapshot is immutable source data; all stock and legacy purchase quantities stay in base units.
CREATE TABLE IF NOT EXISTS purchase_unit_snapshots(
 purchase_id TEXT NOT NULL REFERENCES purchases(purchase_id),
 product_id TEXT NOT NULL REFERENCES products(product_id),
 lot_id TEXT NOT NULL REFERENCES stock_lots(lot_id),
 profile_revision INTEGER NOT NULL CHECK(profile_revision>=1),
 profile_json TEXT NOT NULL,
 quantities_json TEXT NOT NULL,
 price_unit TEXT NOT NULL,
 entered_unit_price REAL NOT NULL CHECK(entered_unit_price>=0),
 base_quantity INTEGER NOT NULL CHECK(base_quantity>0),
 base_unit_cost REAL NOT NULL CHECK(base_unit_cost>=0),
 line_total REAL NOT NULL CHECK(line_total>=0),
 description TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT(datetime('now')),
 PRIMARY KEY(purchase_id,product_id),
 UNIQUE(lot_id)
);
CREATE TRIGGER IF NOT EXISTS purchase_unit_snapshot_revision_guard
BEFORE INSERT ON purchase_unit_snapshots
BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM product_unit_profiles
  WHERE product_id=NEW.product_id AND revision=NEW.profile_revision AND profile_json=NEW.profile_json
 ) THEN RAISE(ABORT,'purchase_unit_profile_stale') END;
END;
