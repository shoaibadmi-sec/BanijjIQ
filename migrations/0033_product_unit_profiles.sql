-- Product-specific 2–4 level chains. Inventory remains stored in the existing smallest/base product unit.
-- This migration does NOT enable mixed-unit sale posting. Profile revisions will be frozen per invoice
-- before any mixed-unit write path is released.
ALTER TABLE product_units ADD COLUMN symbol TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS product_unit_profiles (
  product_id TEXT PRIMARY KEY REFERENCES products(product_id),
  base_unit TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
);
