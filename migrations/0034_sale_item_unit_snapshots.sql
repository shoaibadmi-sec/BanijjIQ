-- Mixed-unit sales always draw inventory from base units; keep immutable entered units
-- and the exact price/factor profile on every posted invoice.
CREATE TABLE IF NOT EXISTS sale_item_unit_snapshots (
 invoice_id TEXT NOT NULL,
 product_id TEXT NOT NULL,
 profile_revision INTEGER NOT NULL CHECK(profile_revision >= 1),
 profile_json TEXT NOT NULL,
 quantities_json TEXT NOT NULL,
 description TEXT NOT NULL,
 base_quantity INTEGER NOT NULL CHECK(base_quantity > 0),
 line_total_cents INTEGER NOT NULL CHECK(line_total_cents >= 0),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(invoice_id,product_id),
 FOREIGN KEY(invoice_id) REFERENCES sales(invoice_id),
 FOREIGN KEY(product_id) REFERENCES products(product_id)
);

-- Profile changes racing with posting must abort the ENTIRE invoice transaction.
CREATE TRIGGER IF NOT EXISTS trg_unit_snapshot_profile_version
BEFORE INSERT ON sale_item_unit_snapshots
WHEN NOT EXISTS (
 SELECT 1 FROM product_unit_profiles p
 WHERE p.product_id = NEW.product_id
   AND p.revision = NEW.profile_revision
   AND p.profile_json = NEW.profile_json
)
BEGIN
 SELECT RAISE(ABORT,'UNIT_PROFILE_CONFLICT');
END;
