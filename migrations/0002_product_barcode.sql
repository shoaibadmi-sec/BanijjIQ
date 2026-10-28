ALTER TABLE products ADD COLUMN barcode TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_products_barcode
ON products(barcode)
WHERE barcode <> '';
