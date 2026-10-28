-- Mohim ERP 2026-09-29: optional unit abbreviation is presentation-only.
-- Existing product/unit names and historical transaction units never change.
ALTER TABLE product_units ADD COLUMN symbol TEXT NOT NULL DEFAULT '';
