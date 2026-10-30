-- Phase 3G2-P (internal only): partial original-source Store Credit ISSUE.
-- Keep 0047's whole refund validation EXACT, exempt only Split Partial from
-- two legacy/full-issue branches; separate strict partial proof below.
-- Never add a partial-refund HTTP endpoint through this migration alone.
DROP TRIGGER IF EXISTS trg_store_credit_issue_source_reconciles;
CREATE TRIGGER trg_store_credit_issue_source_reconciles
BEFORE INSERT ON customer_store_credit_entries
WHEN NEW.entry_type='ISSUE'
  AND COALESCE((SELECT refund_method FROM sales_returns WHERE return_id=NEW.source_id),'') NOT IN ('Split','Split Partial')
  AND NOT EXISTS (
  SELECT 1 FROM sales_returns sr
  JOIN sales s ON s.invoice_id=sr.invoice_id
  JOIN customers c ON c.customer_id=NEW.customer_id
  WHERE sr.return_id=NEW.source_id
    AND sr.customer_id=NEW.customer_id
    AND sr.customer_phone=c.phone
    AND s.customer_id=NEW.customer_id
    AND s.status='Completed' AND s.is_deleted=0
    AND s.payment_type='Cash' AND s.payment_method='Cash'
    AND s.paid_amount=s.grand_total AND s.due_amount=0
    AND c.current_due>=0 AND c.is_deleted=0 AND c.status='Active'
    AND NEW.source_type='Sales Return'
    AND sr.refund_method='Store Credit'
    AND CAST(ROUND(sr.total_return_amount*100) AS INTEGER)=NEW.delta_cents
    AND (SELECT COUNT(*) FROM sales_return_items item
      WHERE item.return_id=sr.return_id)>0
    AND CAST(ROUND(COALESCE((SELECT SUM(item.line_total) FROM sales_return_items item
      WHERE item.return_id=sr.return_id),0)*100) AS INTEGER)=NEW.delta_cents
    AND (SELECT COUNT(*) FROM cash_book cb
      WHERE cb.reference=s.invoice_id AND cb.type='Sale' AND cb.is_deleted=0
        AND cb.debit=0)=1
    AND CAST(ROUND(COALESCE((SELECT SUM(cb.credit) FROM cash_book cb
      WHERE cb.reference=s.invoice_id AND cb.type='Sale' AND cb.is_deleted=0),0)*100) AS INTEGER)
      =CAST(ROUND(s.paid_amount*100) AS INTEGER)
    AND (SELECT COALESCE(SUM(CAST(ROUND(pr.total_return_amount*100) AS INTEGER)),0)
      FROM sales_returns pr WHERE pr.invoice_id=s.invoice_id)
      <=CAST(ROUND(s.paid_amount*100) AS INTEGER)
    -- Legacy old negative-due credits cannot be silently treated as a
    -- newly issued balance or made spendable by posting another return.
    AND NOT EXISTS (
      SELECT 1 FROM customer_ledger cl WHERE cl.customer_id=NEW.customer_id
        AND cl.type='Sales Return Credit'
    )
    AND NOT EXISTS (
      SELECT 1 FROM store_credit_legacy_unreconciled legacy
      JOIN sales_returns old ON old.return_id=legacy.return_id
      WHERE legacy.return_id<>sr.return_id
        AND (old.customer_id=NEW.customer_id OR old.customer_phone=c.phone)
    )
    -- Previously posted returns must have a matching money or liability
    -- journal. The current issuance is excluded until it is inserted.
    AND NOT EXISTS (
      SELECT 1 FROM sales_returns old
      WHERE old.invoice_id=s.invoice_id AND old.return_id<>sr.return_id
        AND (
          (old.refund_method='Cash' AND
            (SELECT COUNT(*) FROM cash_book cb
              WHERE cb.reference=old.return_id AND cb.type='Sales Return'
                AND cb.is_deleted=0 AND cb.credit=0)<>1)
          OR (old.refund_method='Cash' AND
            CAST(ROUND(COALESCE((SELECT SUM(cb.debit) FROM cash_book cb
              WHERE cb.reference=old.return_id AND cb.type='Sales Return'
                AND cb.is_deleted=0),0)*100) AS INTEGER)
                <>CAST(ROUND(old.total_return_amount*100) AS INTEGER))
          OR (old.refund_method='Store Credit' AND NOT EXISTS (
            SELECT 1 FROM customer_store_credit_entries e
            WHERE e.entry_type='ISSUE' AND e.source_type='Sales Return'
              AND e.source_id=old.return_id AND e.customer_id=NEW.customer_id
              AND e.delta_cents=CAST(ROUND(old.total_return_amount*100) AS INTEGER)
          ))
          OR old.refund_method NOT IN ('Cash','Store Credit')
        )
    )
)
BEGIN SELECT RAISE(ABORT,'STORE_CREDIT_SOURCE_CONFLICT'); END;
DROP TRIGGER IF EXISTS trg_store_credit_validate_entry;
CREATE TRIGGER trg_store_credit_validate_entry
BEFORE INSERT ON customer_store_credit_entries
WHEN
  NEW.balance_after_cents <> COALESCE((SELECT SUM(delta_cents)
    FROM customer_store_credit_entries WHERE customer_id=NEW.customer_id),0)+COALESCE((SELECT SUM(a.delta_cents) FROM store_credit_historical_adjustments a WHERE a.customer_id=NEW.customer_id),0)+NEW.delta_cents
  OR NEW.balance_after_cents < 0
  OR NOT EXISTS (SELECT 1 FROM customers c WHERE c.customer_id=NEW.customer_id
    AND c.is_deleted=0 AND c.status='Active')
  OR (NEW.entry_type='ISSUE'
      AND COALESCE((SELECT refund_method FROM sales_returns WHERE return_id=NEW.source_id),'') NOT IN ('Split','Split Partial')
      AND (
      NEW.source_type<>'Sales Return' OR NEW.delta_cents<=0
      OR NOT EXISTS (
        SELECT 1 FROM sales_returns sr JOIN sales s ON s.invoice_id=sr.invoice_id
        WHERE sr.return_id=NEW.source_id AND sr.customer_id=NEW.customer_id
          AND sr.refund_method='Store Credit'
          AND CAST(ROUND(sr.total_return_amount*100) AS INTEGER)=NEW.delta_cents
          AND s.customer_id=NEW.customer_id
          AND s.paid_amount=s.grand_total AND s.due_amount=0
          AND s.grand_total>=sr.total_return_amount
      )
    ))
  OR (NEW.entry_type='REDEEM' AND (
      NEW.source_type<>'Sale' OR NEW.delta_cents>=0
      OR NOT EXISTS (
        SELECT 1 FROM sales s JOIN customers c ON c.customer_id=s.customer_id
        WHERE (s.invoice_id=NEW.source_id AND s.customer_id=NEW.customer_id
          AND s.status='Completed' AND s.is_deleted=0
          AND s.payment_type='Cash' AND s.payment_method='Store Credit'
          AND s.paid_amount=s.grand_total AND s.due_amount=0
          AND s.grand_total>0 AND s.bank_account_id=''
          AND s.customer_phone=c.phone
          AND CAST(ROUND(s.grand_total*100) AS INTEGER)=-NEW.delta_cents) OR (
          s.invoice_id=NEW.source_id AND s.customer_id=NEW.customer_id
          AND s.status='Completed' AND s.is_deleted=0
          AND s.payment_type='Cash' AND s.payment_method='Split'
          AND s.paid_amount=s.grand_total AND s.due_amount=0
          AND s.grand_total>0 AND s.bank_account_id=''
          AND s.customer_phone=c.phone
          AND EXISTS (SELECT 1 FROM sale_tender_allocations a
            WHERE a.invoice_id=s.invoice_id AND a.method='Store Credit'
              AND a.customer_id=NEW.customer_id AND a.amount_cents=-NEW.delta_cents)
          AND (SELECT COALESCE(SUM(a.amount_cents),0)
            FROM sale_tender_allocations a WHERE a.invoice_id=s.invoice_id)
              =CAST(ROUND(s.grand_total*100) AS INTEGER)
        )
      )
      OR (EXISTS (SELECT 1 FROM sales s WHERE s.invoice_id=NEW.source_id AND s.payment_method='Store Credit')
        AND (
          EXISTS (SELECT 1 FROM cash_book cb WHERE cb.reference=NEW.source_id)
          OR EXISTS (SELECT 1 FROM bank_book bb WHERE bb.reference=NEW.source_id)
          OR EXISTS (SELECT 1 FROM customer_ledger cl WHERE cl.reference=NEW.source_id)
        ))
      OR EXISTS (SELECT 1 FROM customer_ledger cl WHERE cl.reference=NEW.source_id)
      OR EXISTS (
        SELECT 1 FROM store_credit_legacy_unreconciled legacy
        JOIN sales_returns sr ON sr.return_id=legacy.return_id
        JOIN customers c ON c.customer_id=NEW.customer_id
        WHERE sr.customer_id=NEW.customer_id OR sr.customer_phone=c.phone
      )
      OR EXISTS (
        SELECT 1 FROM customer_ledger cl
        WHERE cl.customer_id=NEW.customer_id AND cl.type='Sales Return Credit'
      )
    ))
BEGIN SELECT RAISE(ABORT,'STORE_CREDIT_LEDGER_CONFLICT'); END;

-- Cloudflare D1 expression depth <= 100. Keep the exact same
-- fail-closed partial proof in separate short BEFORE INSERT triggers.
-- The original full-refund and REDEEM triggers remain unchanged.
CREATE TRIGGER trg_store_credit_partial_issue_source
BEFORE INSERT ON customer_store_credit_entries
WHEN NEW.entry_type='ISSUE' AND COALESCE((SELECT refund_method FROM sales_returns WHERE return_id=NEW.source_id),'')='Split Partial'
  AND (NEW.source_type<>'Sales Return' OR NEW.delta_cents<=0
  OR NOT EXISTS (
    SELECT 1 FROM sales_returns sr
    JOIN sales s ON s.invoice_id=sr.invoice_id
    JOIN customers c ON c.customer_id=s.customer_id
    JOIN sale_tender_allocations original ON original.invoice_id=s.invoice_id
      AND original.method='Store Credit' AND original.source_key='Store Credit'
      AND original.customer_id=c.customer_id
    JOIN customer_store_credit_entries redeemed ON redeemed.source_type='Sale'
      AND redeemed.source_id=s.invoice_id AND redeemed.entry_type='REDEEM'
      AND redeemed.customer_id=c.customer_id AND redeemed.delta_cents=-original.amount_cents
    WHERE sr.return_id=NEW.source_id AND NEW.customer_id=c.customer_id
      AND sr.customer_id=c.customer_id AND sr.customer_phone=c.phone
      AND s.customer_phone=c.phone AND c.status='Active' AND c.is_deleted=0
      AND c.current_due>=0 AND s.status='Completed' AND s.is_deleted=0
      AND s.payment_type='Cash' AND s.payment_method='Split'
      AND s.paid_amount=s.grand_total AND s.due_amount=0
      AND s.subtotal=s.grand_total AND s.discount=0 AND s.grand_total>0
  ))
BEGIN SELECT RAISE(ABORT,'SPLIT_PARTIAL_CREDIT_ISSUE_CONFLICT'); END;

CREATE TRIGGER trg_store_credit_partial_issue_tender
BEFORE INSERT ON customer_store_credit_entries
WHEN NEW.entry_type='ISSUE' AND COALESCE((SELECT refund_method FROM sales_returns WHERE return_id=NEW.source_id),'')='Split Partial'
  AND (NOT EXISTS(
    SELECT 1 FROM sales_returns sr JOIN sales s ON s.invoice_id=sr.invoice_id
    JOIN sale_tender_allocations c ON c.invoice_id=s.invoice_id
      AND c.method='Cash' AND c.source_key='Cash'
      AND c.customer_id='' AND c.bank_account_id=''
    JOIN sale_tender_allocations sc ON sc.invoice_id=s.invoice_id
      AND sc.method='Store Credit' AND sc.source_key='Store Credit'
      AND sc.customer_id=NEW.customer_id
    JOIN split_partial_refund_allocations issued ON issued.return_id=sr.return_id
      AND issued.method='Store Credit' AND issued.source_key='Store Credit'
      AND issued.customer_id=NEW.customer_id
      AND issued.amount_cents=NEW.delta_cents
    WHERE sr.return_id=NEW.source_id
      AND (SELECT COUNT(*) FROM sale_tender_allocations t
        WHERE t.invoice_id=s.invoice_id)=2
      AND sc.amount_cents+c.amount_cents=CAST(ROUND(s.grand_total*100) AS INTEGER)
      AND (SELECT COUNT(*) FROM customer_store_credit_entries e
        WHERE e.source_type='Sale' AND e.source_id=s.invoice_id
          AND e.entry_type='REDEEM')=1
      AND (SELECT COUNT(*) FROM split_partial_refund_allocations a
        WHERE a.return_id=sr.return_id)=2
      AND (SELECT COALESCE(SUM(a.amount_cents),0)
        FROM split_partial_refund_allocations a WHERE a.return_id=sr.return_id)
           =CAST(ROUND(sr.total_return_amount*100) AS INTEGER)
      AND (SELECT COALESCE(SUM(a.amount_cents),0)
        FROM split_partial_refund_allocations a
        WHERE a.return_id=sr.return_id AND a.method='Cash'
          AND a.source_key='Cash' AND a.bank_account_id='' AND a.customer_id='')>0
      AND (SELECT COALESCE(SUM(a.amount_cents),0)
        FROM split_partial_refund_allocations a
        WHERE a.invoice_id=s.invoice_id AND a.method='Store Credit')
           <=sc.amount_cents
  ))
BEGIN SELECT RAISE(ABORT,'SPLIT_PARTIAL_CREDIT_ISSUE_CONFLICT'); END;

CREATE TRIGGER trg_store_credit_partial_issue_money
BEFORE INSERT ON customer_store_credit_entries
WHEN NEW.entry_type='ISSUE' AND COALESCE((SELECT refund_method FROM sales_returns WHERE return_id=NEW.source_id),'')='Split Partial'
  AND (NOT EXISTS (
    SELECT 1 FROM sales_returns sr JOIN sales s ON s.invoice_id=sr.invoice_id
    JOIN sale_tender_allocations c ON c.invoice_id=s.invoice_id
      AND c.method='Cash' AND c.source_key='Cash'
    JOIN split_partial_refund_allocations cash ON cash.return_id=sr.return_id
      AND cash.method='Cash' AND cash.source_key='Cash'
    WHERE sr.return_id=NEW.source_id
      AND (SELECT COUNT(*) FROM cash_book cb WHERE cb.reference=s.invoice_id)=1
      AND (SELECT COALESCE(SUM(CAST(ROUND(cb.credit*100) AS INTEGER)),0)
        FROM cash_book cb WHERE cb.reference=s.invoice_id
          AND cb.type='Sale' AND cb.payment_method='Cash'
          AND cb.debit=0 AND cb.is_deleted=0)=c.amount_cents
      AND (SELECT COUNT(*) FROM cash_book cb WHERE cb.reference=sr.return_id)=1
      AND (SELECT COALESCE(SUM(CAST(ROUND(cb.debit*100) AS INTEGER)),0)
        FROM cash_book cb WHERE cb.reference=sr.return_id
          AND cb.type='Sales Return' AND cb.payment_method='Cash'
          AND cb.credit=0 AND cb.is_deleted=0)=cash.amount_cents
      AND (SELECT COUNT(*) FROM bank_book bb WHERE bb.reference=sr.return_id)=0
      AND (SELECT COUNT(*) FROM customer_ledger cl WHERE cl.reference=sr.return_id)=0
  ))
BEGIN SELECT RAISE(ABORT,'SPLIT_PARTIAL_CREDIT_ISSUE_CONFLICT'); END;

CREATE TRIGGER trg_store_credit_partial_issue_fifo
BEFORE INSERT ON customer_store_credit_entries
WHEN NEW.entry_type='ISSUE' AND COALESCE((SELECT refund_method FROM sales_returns WHERE return_id=NEW.source_id),'')='Split Partial'
  AND (NOT EXISTS (
    SELECT 1 FROM sales_returns sr JOIN sales_return_items i ON i.return_id=sr.return_id
    JOIN sale_items sold ON sold.invoice_id=i.invoice_id AND sold.product_id=i.product_id
    WHERE sr.return_id=NEW.source_id AND i.invoice_id=sr.invoice_id
      AND (SELECT COUNT(*) FROM sales_return_items item
        WHERE item.return_id=sr.return_id)=1
      AND i.return_quantity>0 AND i.return_quantity=CAST(i.return_quantity AS INTEGER)
      AND i.return_price=sold.unit_price
      AND CAST(ROUND(i.line_total*100) AS INTEGER)
         =CAST(ROUND(sr.total_return_amount*100) AS INTEGER)
      AND (SELECT COALESCE(SUM(lot.quantity),0)
        FROM sales_return_item_lots lot
        WHERE lot.return_id=sr.return_id AND lot.product_id=i.product_id)=i.return_quantity
      AND (SELECT COUNT(*) FROM stock_movements m
        WHERE m.note=sr.return_id AND m.product_id=i.product_id
          AND m.movement_type='Sales Return'
          AND m.quantity_in=i.return_quantity AND m.quantity_out=0)=1
  )
  OR EXISTS (
    SELECT 1 FROM sales_return_item_lots lot
    WHERE lot.return_id=NEW.source_id AND NOT EXISTS (
      SELECT 1 FROM split_refund_lot_restorations snap
      JOIN stock_lots sl ON sl.lot_id=snap.lot_id
      WHERE snap.return_id=NEW.source_id AND snap.invoice_id=lot.invoice_id
        AND snap.product_id=lot.product_id AND snap.lot_id=lot.lot_id
        AND snap.quantity=lot.quantity AND sl.source_type<>'OVERSOLD'
        AND ABS(sl.remaining_quantity-snap.prior_remaining-snap.quantity)<0.00001
    )
  ))
BEGIN SELECT RAISE(ABORT,'SPLIT_PARTIAL_CREDIT_ISSUE_CONFLICT'); END;

CREATE TRIGGER trg_store_credit_partial_issue_history
BEFORE INSERT ON customer_store_credit_entries
WHEN NEW.entry_type='ISSUE' AND COALESCE((SELECT refund_method FROM sales_returns WHERE return_id=NEW.source_id),'')='Split Partial'
  AND (EXISTS (
    SELECT 1 FROM customer_ledger cl
    WHERE cl.customer_id=NEW.customer_id AND cl.type='Sales Return Credit'
  )
  OR EXISTS (
    SELECT 1 FROM store_credit_legacy_unreconciled legacy
    JOIN sales_returns old ON old.return_id=legacy.return_id
    JOIN customers c ON c.customer_id=NEW.customer_id
    WHERE old.customer_id=NEW.customer_id OR old.customer_phone=c.phone
  )
  OR EXISTS (
    SELECT 1 FROM sales_returns sr
    JOIN sales_returns old ON old.invoice_id=sr.invoice_id AND old.return_id<>sr.return_id
    WHERE sr.return_id=NEW.source_id AND old.refund_method<>'Split Partial'
  )
  OR EXISTS (
    SELECT 1 FROM sales_returns sr
    JOIN sales_return_refund_allocations complete ON complete.invoice_id=sr.invoice_id
    WHERE sr.return_id=NEW.source_id
  )
  OR EXISTS (
    SELECT 1 FROM sales_returns sr JOIN sale_reversal_logs rev ON rev.invoice_id=sr.invoice_id
    WHERE sr.return_id=NEW.source_id
  ))
BEGIN SELECT RAISE(ABORT,'SPLIT_PARTIAL_CREDIT_ISSUE_CONFLICT'); END;

