-- Phase 4I-C7: require exactly one immutable original money-book source for each paid refund.
-- Additive D1 guard; existing 0056 provenance checks remain unchanged.
CREATE TRIGGER IF NOT EXISTS purchase_paid_refund_original_book_unique
BEFORE INSERT ON purchase_returns
WHEN NEW.refund_method IN ('Cash','Bank','Mobile Banking')
BEGIN
 SELECT CASE WHEN
   (NEW.refund_method='Cash' AND
     (SELECT COUNT(*) FROM cash_book cb
      WHERE cb.reference=NEW.refund_source_ledger_id
        AND COALESCE(cb.is_deleted,0)=0)<>1)
   OR
   (NEW.refund_method IN ('Bank','Mobile Banking') AND
     (SELECT COUNT(*) FROM bank_book bb
      WHERE bb.reference=NEW.refund_source_ledger_id
        AND COALESCE(bb.is_deleted,0)=0)<>1)
 THEN RAISE(ABORT,'purchase_refund_original_source_not_unique') END;
END;
