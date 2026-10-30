-- Phase 4E: reuse existing planner/orders, enforce one-way, single-use conversion.
-- No new plan engine or purchase table; guard the existing source reference.
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_one_active_supplier_order
 ON purchases(purchase_plan_order_id)
 WHERE purchase_plan_order_id<>'' AND COALESCE(is_deleted,0)=0;
CREATE TRIGGER IF NOT EXISTS guard_supplier_order_conversion
 BEFORE INSERT ON purchases
 WHEN COALESCE(NEW.purchase_plan_order_id,'')<>''
 BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM purchase_plan_orders o
    JOIN purchase_plans p ON p.plan_id=o.plan_id
    WHERE o.order_id=NEW.purchase_plan_order_id
    AND o.supplier_id=NEW.supplier_id AND o.status='Open'
    AND COALESCE(o.converted_purchase_id,'')=''
    AND p.status IN ('Approved','Partially Converted')
  ) THEN RAISE(ABORT,'supplier_order_already_converted_or_invalid') END;
 END;
CREATE TRIGGER IF NOT EXISTS guard_supplier_order_purchase_reference
 BEFORE UPDATE OF purchase_plan_order_id,is_deleted ON purchases
 WHEN COALESCE(OLD.purchase_plan_order_id,'')<>''
  AND (COALESCE(NEW.purchase_plan_order_id,'')<>OLD.purchase_plan_order_id
       OR NEW.is_deleted<>OLD.is_deleted)
 BEGIN SELECT RAISE(ABORT,'supplier_order_purchase_reference_immutable'); END;
