-- Source-faithful ProductSettings bilingual category and brand labels.
-- Additive only; no seeded example names or reinterpretation of previous records.
ALTER TABLE product_categories ADD COLUMN category_name_bn TEXT NOT NULL DEFAULT '';
ALTER TABLE product_brands ADD COLUMN brand_name_bn TEXT NOT NULL DEFAULT '';
