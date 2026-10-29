-- Immutable per-unit allocation for mixed-unit returns. Never reprice against today's product profile.
CREATE TABLE IF NOT EXISTS sales_return_item_units (
 return_id TEXT NOT NULL REFERENCES sales_returns(return_id),
 invoice_id TEXT NOT NULL,
 product_id TEXT NOT NULL,
 quantities_json TEXT NOT NULL CHECK(json_valid(quantities_json)),
 base_quantity INTEGER NOT NULL CHECK(base_quantity > 0),
 line_total_cents INTEGER NOT NULL CHECK(line_total_cents >= 0),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(return_id,product_id),
 FOREIGN KEY(invoice_id,product_id) REFERENCES sale_item_unit_snapshots(invoice_id,product_id)
);
-- The trigger runs within the SAME db.batch as the return and its stock/cash updates.
-- Concurrent attempts to return the same sold unit must fail atomically.
CREATE TRIGGER IF NOT EXISTS trg_mixed_return_unit_capacity
BEFORE INSERT ON sales_return_item_units
BEGIN
 SELECT CASE WHEN NOT EXISTS (
   SELECT 1 FROM sale_item_unit_snapshots s
   WHERE s.invoice_id=NEW.invoice_id AND s.product_id=NEW.product_id
 ) THEN RAISE(ABORT,'MIXED_RETURN_CONFLICT') END;
 SELECT CASE WHEN EXISTS (
   SELECT 1 FROM json_each(NEW.quantities_json) wanted
   LEFT JOIN sale_item_unit_snapshots original
      ON original.invoice_id=NEW.invoice_id AND original.product_id=NEW.product_id
   WHERE wanted.type <> 'integer' OR CAST(wanted.value AS INTEGER) < 0
     OR CAST(wanted.value AS INTEGER) > (
       COALESCE(CAST(json_extract(original.quantities_json,
          '$."'||REPLACE(wanted.key,'"','')||'"') AS INTEGER),0)
       - COALESCE((SELECT SUM(CAST(json_extract(prior.quantities_json,
          '$."'||REPLACE(wanted.key,'"','')||'"') AS INTEGER))
          FROM sales_return_item_units prior
          WHERE prior.invoice_id=NEW.invoice_id AND prior.product_id=NEW.product_id),0)
     )
 ) THEN RAISE(ABORT,'MIXED_RETURN_CONFLICT') END;
 SELECT CASE WHEN NOT EXISTS (
   SELECT 1 FROM sales_return_items line
   WHERE line.return_id=NEW.return_id AND line.product_id=NEW.product_id
    AND line.invoice_id=NEW.invoice_id
    AND line.return_quantity=NEW.base_quantity
 ) THEN RAISE(ABORT,'MIXED_RETURN_CONFLICT') END;
END;


-- Mixed-unit partial refunds restore each FIFO lot at most once, even across repeated returns.
CREATE TABLE IF NOT EXISTS sales_return_item_lots (
 return_id TEXT NOT NULL REFERENCES sales_returns(return_id),
 invoice_id TEXT NOT NULL,
 product_id TEXT NOT NULL,
 lot_id TEXT NOT NULL REFERENCES stock_lots(lot_id),
 quantity INTEGER NOT NULL CHECK(quantity > 0),
 PRIMARY KEY(return_id,product_id,lot_id)
);
CREATE TRIGGER IF NOT EXISTS trg_mixed_return_lot_capacity
BEFORE INSERT ON sales_return_item_lots
WHEN (
 NEW.quantity+COALESCE((
   SELECT SUM(prior.quantity) FROM sales_return_item_lots prior
   WHERE prior.invoice_id=NEW.invoice_id AND prior.product_id=NEW.product_id AND prior.lot_id=NEW.lot_id
 ),0)
) > COALESCE((
 SELECT SUM(sold.quantity) FROM sale_item_lots sold
 WHERE sold.invoice_id=NEW.invoice_id AND sold.product_id=NEW.product_id AND sold.lot_id=NEW.lot_id
),0)
BEGIN
 SELECT RAISE(ABORT,'MIXED_RETURN_CONFLICT');
END;
