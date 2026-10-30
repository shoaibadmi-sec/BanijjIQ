-- Phase 3G2-M: final atomic audit seal for future partial split-source returns.
-- No new POST route. Requires all source books, stock and immutable 0047
-- before/after FIFO snapshots to exist before this LAST db.batch statement.
-- Reuses immutable split_refund_lot_restorations, not a duplicate journal.
-- Never relax the G2-H whole-return 0047 or G2-I 0048 guards.
CREATE TRIGGER trg_partial_split_audit_header
BEFORE INSERT ON audit_logs
WHEN NEW.action='POST_PARTIAL_SPLIT_RETURN' AND (
  NEW.entity_type<>'SALES_RETURN'
  OR EXISTS(SELECT 1 FROM audit_logs old
    WHERE old.action='POST_PARTIAL_SPLIT_RETURN' AND old.entity_id=NEW.entity_id)
  OR NOT EXISTS(
    SELECT 1 FROM sales_returns sr
    JOIN sales s ON s.invoice_id=sr.invoice_id
    JOIN customers c ON c.customer_id=s.customer_id
    WHERE sr.return_id=NEW.entity_id AND sr.refund_method='Split Partial'
      AND sr.customer_id=c.customer_id AND sr.customer_phone=c.phone
      AND s.customer_phone=c.phone AND c.status='Active' AND c.is_deleted=0
      AND s.payment_method='Split' AND s.payment_type='Cash'
      AND s.status='Completed' AND s.is_deleted=0
      AND s.paid_amount=s.grand_total AND s.due_amount=0
      AND s.discount=0 AND s.subtotal=s.grand_total
      AND sr.total_return_amount>0
      AND (SELECT COALESCE(SUM(a.amount_cents),0)
        FROM split_partial_refund_allocations a WHERE a.return_id=sr.return_id)
          =CAST(ROUND(sr.total_return_amount*100) AS INTEGER)
      AND (SELECT COALESCE(SUM(t.amount_cents),0)
        FROM sale_tender_allocations t WHERE t.invoice_id=s.invoice_id)
          =CAST(ROUND(s.grand_total*100) AS INTEGER)
      AND NOT EXISTS(SELECT 1 FROM sales_return_refund_allocations complete
        WHERE complete.invoice_id=s.invoice_id)
      AND NOT EXISTS(SELECT 1 FROM sale_reversal_logs rev
        WHERE rev.invoice_id=s.invoice_id)
  )
)
BEGIN SELECT RAISE(ABORT,'PARTIAL_SPLIT_ACCOUNTING_CONFLICT'); END;

-- Money: one exact Cash/Bank/Mobile/Store Credit book row per source.
-- No unexplained extra journals, and no change to customer receivables.
CREATE TRIGGER trg_partial_split_audit_money
BEFORE INSERT ON audit_logs
WHEN NEW.action='POST_PARTIAL_SPLIT_RETURN' AND (
  (SELECT COUNT(*) FROM cash_book cb WHERE cb.reference=NEW.entity_id)
    <> (SELECT COUNT(*) FROM split_partial_refund_allocations a
      WHERE a.return_id=NEW.entity_id AND a.method='Cash')
  OR EXISTS(
    SELECT 1 FROM split_partial_refund_allocations a
    LEFT JOIN cash_book cb ON cb.reference=a.return_id
      AND cb.type='Sales Return' AND cb.payment_method='Cash'
      AND cb.is_deleted=0 AND cb.credit=0
      AND CAST(ROUND(cb.debit*100) AS INTEGER)=a.amount_cents
    WHERE a.return_id=NEW.entity_id AND a.method='Cash' AND cb.entry_id IS NULL
  )
  OR (SELECT COUNT(*) FROM bank_book bb WHERE bb.reference=NEW.entity_id)
    <> (SELECT COUNT(*) FROM split_partial_refund_allocations a
      WHERE a.return_id=NEW.entity_id AND a.method IN ('Bank','Mobile Banking'))
  OR EXISTS(
    SELECT 1 FROM split_partial_refund_allocations a
    LEFT JOIN bank_book bb ON bb.reference=a.return_id
      AND bb.bank_account_id=a.bank_account_id
      AND bb.type='Sales Return' AND bb.is_deleted=0 AND bb.status='Active'
      AND bb.credit=0 AND CAST(ROUND(bb.debit*100) AS INTEGER)=a.amount_cents
    LEFT JOIN bank_accounts bank ON bank.bank_account_id=a.bank_account_id
    WHERE a.return_id=NEW.entity_id AND a.method IN ('Bank','Mobile Banking')
      AND (bb.entry_id IS NULL OR bank.status<>'Active'
        OR bank.account_type<>a.method
        OR CAST(ROUND(bb.balance*100) AS INTEGER)
          <>CAST(ROUND(bank.current_balance*100) AS INTEGER))
  )
  OR (SELECT COUNT(*) FROM customer_store_credit_entries e
    WHERE e.source_type='Sales Return' AND e.source_id=NEW.entity_id)
    <> (SELECT COUNT(*) FROM split_partial_refund_allocations a
      WHERE a.return_id=NEW.entity_id AND a.method='Store Credit')
  OR EXISTS(
    SELECT 1 FROM split_partial_refund_allocations a
    LEFT JOIN customer_store_credit_entries e
      ON e.source_type='Sales Return' AND e.source_id=a.return_id
      AND e.entry_type='ISSUE' AND e.customer_id=a.customer_id
      AND e.delta_cents=a.amount_cents
    WHERE a.return_id=NEW.entity_id AND a.method='Store Credit'
      AND e.entry_id IS NULL
  )
  OR EXISTS(SELECT 1 FROM customer_ledger cl WHERE cl.reference=NEW.entity_id)
)
BEGIN SELECT RAISE(ABORT,'PARTIAL_SPLIT_ACCOUNTING_CONFLICT'); END;

-- FIFO: each saved source lot has an immutable pre-restore amount (0047),
-- which MUST equal the actual post-restore lot balance before certification.
CREATE TRIGGER trg_partial_split_audit_inventory
BEFORE INSERT ON audit_logs
WHEN NEW.action='POST_PARTIAL_SPLIT_RETURN' AND (
  (SELECT COUNT(*) FROM sales_return_items item WHERE item.return_id=NEW.entity_id)=0
  OR (SELECT COALESCE(SUM(CAST(ROUND(item.line_total*100) AS INTEGER)),0)
      FROM sales_return_items item WHERE item.return_id=NEW.entity_id)
      <>COALESCE((SELECT CAST(ROUND(sr.total_return_amount*100) AS INTEGER)
        FROM sales_returns sr WHERE sr.return_id=NEW.entity_id),-1)
  OR EXISTS(
    SELECT 1 FROM sales_return_items item
    JOIN sales_returns sr ON sr.return_id=item.return_id
    LEFT JOIN sale_items sold ON sold.invoice_id=item.invoice_id
      AND sold.product_id=item.product_id
    WHERE item.return_id=NEW.entity_id AND (
      item.invoice_id<>sr.invoice_id OR sold.id IS NULL
      OR item.return_quantity<=0
      OR item.return_quantity<>CAST(item.return_quantity AS INTEGER)
      OR item.return_price<>sold.unit_price
      OR CAST(ROUND(item.line_total*100) AS INTEGER)
        <>CAST(ROUND(item.return_quantity*sold.unit_price*100) AS INTEGER)
      OR (SELECT COALESCE(SUM(lot.quantity),0) FROM sales_return_item_lots lot
        WHERE lot.return_id=NEW.entity_id AND lot.product_id=item.product_id)
           <>item.return_quantity
      OR (SELECT COUNT(*) FROM stock_movements move
        WHERE move.note=NEW.entity_id AND move.product_id=item.product_id
          AND move.movement_type='Sales Return' AND move.quantity_in=item.return_quantity
          AND move.quantity_out=0
          AND move.balance_after=(SELECT p.current_stock FROM products p
            WHERE p.product_id=item.product_id))<>1
    )
  )
  OR (SELECT COUNT(*) FROM stock_movements move WHERE move.note=NEW.entity_id)
      <>(SELECT COUNT(*) FROM sales_return_items item
        WHERE item.return_id=NEW.entity_id)
  OR (SELECT COUNT(*) FROM split_refund_lot_restorations evidence
      WHERE evidence.return_id=NEW.entity_id)
      <>(SELECT COUNT(*) FROM sales_return_item_lots lot
        WHERE lot.return_id=NEW.entity_id)
  OR EXISTS(
    SELECT 1 FROM sales_return_item_lots lot
    LEFT JOIN split_refund_lot_restorations evidence
      ON evidence.return_id=lot.return_id AND evidence.lot_id=lot.lot_id
      AND evidence.invoice_id=lot.invoice_id
      AND evidence.product_id=lot.product_id AND evidence.quantity=lot.quantity
    LEFT JOIN stock_lots saved ON saved.lot_id=lot.lot_id
      AND saved.product_id=lot.product_id
    WHERE lot.return_id=NEW.entity_id AND (
      evidence.lot_id IS NULL OR saved.lot_id IS NULL
      OR saved.source_type='OVERSOLD'
      OR saved.remaining_quantity>saved.original_quantity
      OR ABS(saved.remaining_quantity-evidence.prior_remaining-evidence.quantity)>0.00001
    )
  )
)
BEGIN SELECT RAISE(ABORT,'PARTIAL_SPLIT_ACCOUNTING_CONFLICT'); END;

CREATE TRIGGER trg_partial_split_audit_no_update
BEFORE UPDATE ON audit_logs
WHEN OLD.action='POST_PARTIAL_SPLIT_RETURN'
BEGIN SELECT RAISE(ABORT,'PARTIAL_SPLIT_AUDIT_APPEND_ONLY'); END;

CREATE TRIGGER trg_partial_split_audit_no_delete
BEFORE DELETE ON audit_logs
WHEN OLD.action='POST_PARTIAL_SPLIT_RETURN'
BEGIN SELECT RAISE(ABORT,'PARTIAL_SPLIT_AUDIT_APPEND_ONLY'); END;
