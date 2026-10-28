-- Guard ordinary FIFO inventory from concurrent checkouts.
-- Negative-stock sales use separate OVERSOLD lots, which are intentionally excluded.
-- A failed UPDATE inside the sale D1 batch rolls the entire invoice back.
CREATE TRIGGER IF NOT EXISTS guard_fifo_lot_nonnegative
BEFORE UPDATE OF remaining_quantity ON stock_lots
WHEN NEW.remaining_quantity < 0 AND UPPER(COALESCE(OLD.source_type,'')) <> 'OVERSOLD'
BEGIN
  SELECT RAISE(ABORT, 'POS_STOCK_CONFLICT: lot already consumed by another sale');
END;
