-- Phase G2-H Task 2: append-only source-exact allocation of whole-invoice split refunds.
CREATE TABLE IF NOT EXISTS sales_return_refund_allocations (
  allocation_id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES sales_returns(return_id),
  invoice_id TEXT NOT NULL REFERENCES sales(invoice_id),
  line_number INTEGER NOT NULL CHECK(line_number BETWEEN 1 AND 8),
  method TEXT NOT NULL CHECK(method IN ('Cash','Bank','Mobile Banking','Store Credit')),
  amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0),
  bank_account_id TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL DEFAULT '',
  source_key TEXT NOT NULL,
  UNIQUE(return_id,line_number), UNIQUE(return_id,source_key),
  CHECK((method IN ('Bank','Mobile Banking') AND bank_account_id<>'' AND customer_id='')
    OR (method='Store Credit' AND bank_account_id='' AND customer_id<>'')
    OR (method='Cash' AND bank_account_id='' AND customer_id=''))
);
CREATE TRIGGER trg_split_refund_allocation_no_update
BEFORE UPDATE ON sales_return_refund_allocations
BEGIN SELECT RAISE(ABORT,'SPLIT_REFUND_APPEND_ONLY'); END;
CREATE TRIGGER trg_split_refund_allocation_no_delete
BEFORE DELETE ON sales_return_refund_allocations
BEGIN SELECT RAISE(ABORT,'SPLIT_REFUND_APPEND_ONLY'); END;

-- Preserve strict old issue validation; allow verified original-source credit reissue.
DROP TRIGGER IF EXISTS trg_store_credit_issue_source_reconciles;
-- Phase 3G2-B: a credit is valid only when a real paid, reconciled sale
-- and return exist. Inserting a liability cannot invent receipts or rewrite A/R.
CREATE TRIGGER trg_store_credit_issue_source_reconciles
BEFORE INSERT ON customer_store_credit_entries
WHEN NEW.entry_type='ISSUE' AND NOT EXISTS (
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
  OR EXISTS (
  SELECT 1 FROM sales_returns sr
  JOIN sales s ON s.invoice_id=sr.invoice_id
  JOIN customers c ON c.customer_id=NEW.customer_id
  JOIN sales_return_refund_allocations r ON r.return_id=sr.return_id
  JOIN sale_tender_allocations original ON original.invoice_id=s.invoice_id
    AND original.source_key=r.source_key
  JOIN customer_store_credit_entries redeemed ON redeemed.source_type='Sale'
    AND redeemed.source_id=s.invoice_id AND redeemed.entry_type='REDEEM'
    AND redeemed.customer_id=NEW.customer_id
  WHERE sr.return_id=NEW.source_id AND sr.customer_id=NEW.customer_id
    AND sr.customer_phone=c.phone AND s.customer_id=NEW.customer_id
    AND s.status='Completed' AND s.is_deleted=0
    AND s.payment_method='Split' AND s.payment_type='Cash'
    AND s.paid_amount=s.grand_total AND s.due_amount=0
    AND s.grand_total=sr.total_return_amount
    AND sr.refund_method='Split'
    AND r.method='Store Credit' AND r.customer_id=NEW.customer_id
    AND original.method='Store Credit' AND original.customer_id=NEW.customer_id
    AND original.amount_cents=r.amount_cents
    AND r.amount_cents=NEW.delta_cents
    AND redeemed.delta_cents=-NEW.delta_cents
    AND c.status='Active' AND c.is_deleted=0 AND c.current_due>=0
    AND NOT EXISTS (SELECT 1 FROM customer_ledger cl
      WHERE cl.customer_id=NEW.customer_id AND cl.type='Sales Return Credit')
    AND NOT EXISTS (
      SELECT 1 FROM store_credit_legacy_unreconciled legacy
      JOIN sales_returns old ON old.return_id=legacy.return_id
      WHERE old.customer_id=NEW.customer_id OR old.customer_phone=c.phone)
    AND NOT EXISTS (SELECT 1 FROM sales_returns old
      WHERE old.invoice_id=s.invoice_id AND old.return_id<>sr.return_id)
    AND (SELECT COUNT(*) FROM sales_return_items i WHERE i.return_id=sr.return_id)>0
    AND CAST(ROUND(COALESCE((SELECT SUM(i.line_total) FROM sales_return_items i
      WHERE i.return_id=sr.return_id),0)*100) AS INTEGER)
        =CAST(ROUND(sr.total_return_amount*100) AS INTEGER)
    AND (SELECT COALESCE(SUM(amount_cents),0) FROM sales_return_refund_allocations
      WHERE return_id=sr.return_id)=CAST(ROUND(sr.total_return_amount*100) AS INTEGER)
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
  OR (NEW.entry_type='ISSUE' AND (
      NEW.source_type<>'Sales Return' OR NEW.delta_cents<=0
      OR NOT EXISTS (
        SELECT 1 FROM sales_returns sr JOIN sales s ON s.invoice_id=sr.invoice_id
        WHERE sr.return_id=NEW.source_id AND sr.customer_id=NEW.customer_id
          AND (
            (sr.refund_method='Store Credit'
              AND CAST(ROUND(sr.total_return_amount*100) AS INTEGER)=NEW.delta_cents)
            OR (sr.refund_method='Split' AND s.payment_method='Split'
              AND s.status='Completed' AND s.is_deleted=0
              AND s.grand_total=sr.total_return_amount
              AND EXISTS (SELECT 1 FROM sales_return_refund_allocations a
                WHERE a.return_id=sr.return_id AND a.method='Store Credit'
                  AND a.customer_id=NEW.customer_id AND a.amount_cents=NEW.delta_cents)
              AND EXISTS (SELECT 1 FROM customer_store_credit_entries redeemed
                WHERE redeemed.source_type='Sale' AND redeemed.source_id=s.invoice_id
                  AND redeemed.entry_type='REDEEM' AND redeemed.customer_id=NEW.customer_id
                  AND redeemed.delta_cents=-NEW.delta_cents))
          )
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



DROP TRIGGER IF EXISTS guard_reversal_refund_account;
CREATE TRIGGER guard_reversal_refund_account
BEFORE INSERT ON sale_reversal_logs
WHEN
  NOT EXISTS (
    SELECT 1 FROM sales_returns sr
    WHERE sr.return_id=NEW.return_id AND sr.invoice_id=NEW.invoice_id
      AND sr.refund_method=NEW.refund_method
      AND COALESCE(sr.refund_bank_account_id,'')=NEW.refund_bank_account_id
  )
  OR NEW.refund_method NOT IN ('Cash','Bank','Mobile Banking','Due Adjustment','Split')
  OR (NEW.refund_method IN ('Cash','Due Adjustment') AND NEW.refund_bank_account_id<>'')
  OR (NEW.refund_method IN ('Bank','Mobile Banking') AND (
      NEW.refund_bank_account_id=''
      OR NOT EXISTS (
        SELECT 1 FROM bank_book bb WHERE bb.reference=NEW.return_id
          AND bb.bank_account_id=NEW.refund_bank_account_id
          AND bb.type='Sales Return' AND bb.is_deleted=0
          AND bb.credit=0 AND ROUND(bb.debit*100)=NEW.refund_amount_cents
      )
    ))
  OR (NEW.refund_method='Split' AND (
    NEW.refund_bank_account_id<>''
    OR NOT EXISTS (
      SELECT 1 FROM sales_returns sr JOIN sales s ON s.invoice_id=sr.invoice_id
      WHERE sr.return_id=NEW.return_id AND s.invoice_id=NEW.invoice_id
        AND sr.refund_method='Split' AND s.payment_method='Split'
        AND s.grand_total=sr.total_return_amount
        AND CAST(ROUND(sr.total_return_amount*100) AS INTEGER)=NEW.refund_amount_cents
        AND (SELECT SUM(amount_cents) FROM sales_return_refund_allocations a
          WHERE a.return_id=NEW.return_id)=NEW.refund_amount_cents
        AND (SELECT COUNT(*) FROM sales_return_refund_allocations a
          WHERE a.return_id=NEW.return_id) BETWEEN 2 AND 8
    )
  ))
  OR (NEW.refund_method='Due Adjustment' AND NOT EXISTS (
    SELECT 1 FROM sales s
    JOIN customers c ON c.customer_id=s.customer_id
    WHERE s.invoice_id=NEW.invoice_id AND s.payment_type='Due'
      AND s.paid_amount=0 AND s.due_amount=s.grand_total
      AND s.grand_total*100=NEW.refund_amount_cents
      AND c.current_due=0
      AND (SELECT COUNT(*) FROM customer_ledger
           WHERE customer_id=s.customer_id)=2
      AND (SELECT COUNT(*) FROM customer_ledger
           WHERE customer_id=s.customer_id AND type='Sale Reversal'
            AND reference=NEW.return_id AND debit=0
            AND ROUND(credit*100)=NEW.refund_amount_cents AND balance=0)=1
      AND NOT EXISTS (SELECT 1 FROM cash_book WHERE reference=NEW.return_id)
      AND NOT EXISTS (SELECT 1 FROM bank_book WHERE reference=NEW.return_id)
  ))
BEGIN SELECT RAISE(ABORT,'SALE_REVERSAL_REFUND_ACCOUNT_CONFLICT'); END;

-- Final audit is last in the batch: if even one money/credit source is
-- absent or mismatched, D1 reverts the entire stock+refund+liability batch.
-- Original FIFO lot snapshot is saved before the restore, append-only.
-- Final audit checks the *new* balance equals the pre-update balance plus
-- exactly the quantity originally drawn by this invoice. No silent 0-row UPDATE.
CREATE TABLE IF NOT EXISTS split_refund_lot_restorations (
  return_id TEXT NOT NULL REFERENCES sales_returns(return_id),
  invoice_id TEXT NOT NULL REFERENCES sales(invoice_id),
  lot_id TEXT NOT NULL REFERENCES stock_lots(lot_id),
  product_id TEXT NOT NULL REFERENCES products(product_id),
  quantity REAL NOT NULL CHECK(quantity>0),
  prior_remaining REAL NOT NULL CHECK(prior_remaining>=0),
  PRIMARY KEY(return_id,lot_id)
);
CREATE TRIGGER split_refund_lots_immutable_update BEFORE UPDATE ON split_refund_lot_restorations
BEGIN SELECT RAISE(ABORT,'SPLIT_REFUND_LOTS_APPEND_ONLY'); END;
CREATE TRIGGER split_refund_lots_immutable_delete BEFORE DELETE ON split_refund_lot_restorations
BEGIN SELECT RAISE(ABORT,'SPLIT_REFUND_LOTS_APPEND_ONLY'); END;

CREATE TRIGGER trg_split_refund_audit_reconciles
BEFORE INSERT ON audit_logs
WHEN NEW.action='REVERSE_SPLIT_SALE'
AND NOT EXISTS (
  SELECT 1 FROM sales_returns sr JOIN sales s ON s.invoice_id=sr.invoice_id
  WHERE sr.invoice_id=NEW.entity_id AND sr.refund_method='Split'
    AND s.status='Reversed' AND s.payment_method='Split' AND s.is_deleted=0
    AND sr.total_return_amount=s.grand_total
    AND (SELECT COUNT(*) FROM sale_reversal_logs log
      WHERE log.invoice_id=s.invoice_id AND log.return_id=sr.return_id
        AND log.refund_method='Split'
        AND log.refund_amount_cents=CAST(ROUND(s.grand_total*100) AS INTEGER))=1
    AND (SELECT COUNT(*) FROM sales_return_refund_allocations a
      WHERE a.return_id=sr.return_id)
      =(SELECT COUNT(*) FROM sale_tender_allocations original
        WHERE original.invoice_id=s.invoice_id)
    AND NOT EXISTS (
      SELECT 1 FROM sale_tender_allocations original
      LEFT JOIN sales_return_refund_allocations a
        ON a.invoice_id=original.invoice_id AND a.return_id=sr.return_id
          AND a.source_key=original.source_key AND a.method=original.method
          AND a.amount_cents=original.amount_cents
          AND a.bank_account_id=original.bank_account_id
          AND a.customer_id=original.customer_id
      WHERE original.invoice_id=s.invoice_id AND a.allocation_id IS NULL
    )
    AND (SELECT COALESCE(SUM(amount_cents),0) FROM sales_return_refund_allocations a
      WHERE a.return_id=sr.return_id)=CAST(ROUND(s.grand_total*100) AS INTEGER)
    AND NOT EXISTS (
      SELECT 1 FROM sales_return_refund_allocations a
      LEFT JOIN cash_book cb ON cb.reference=a.return_id
        AND cb.type='Sales Return' AND cb.is_deleted=0 AND cb.credit=0
        AND CAST(ROUND(cb.debit*100) AS INTEGER)=a.amount_cents
      WHERE a.return_id=sr.return_id AND a.method='Cash' AND cb.entry_id IS NULL
    )
    AND (SELECT COUNT(*) FROM cash_book cb WHERE cb.reference=sr.return_id)
      =(SELECT COUNT(*) FROM sales_return_refund_allocations a
        WHERE a.return_id=sr.return_id AND a.method='Cash')
    AND NOT EXISTS (
      SELECT 1 FROM sales_return_refund_allocations a
      LEFT JOIN bank_book bb ON bb.reference=a.return_id AND bb.bank_account_id=a.bank_account_id
        AND bb.type='Sales Return' AND bb.is_deleted=0 AND bb.credit=0
        AND CAST(ROUND(bb.debit*100) AS INTEGER)=a.amount_cents
      LEFT JOIN bank_accounts bank ON bank.bank_account_id=a.bank_account_id
      WHERE a.return_id=sr.return_id AND a.method IN ('Bank','Mobile Banking')
        AND (bb.entry_id IS NULL OR bank.status<>'Active'
          OR bank.account_type<>a.method
          OR CAST(ROUND(bank.current_balance*100) AS INTEGER)
              <>CAST(ROUND(bb.balance*100) AS INTEGER))
    )
    AND (SELECT COUNT(*) FROM bank_book bb WHERE bb.reference=sr.return_id)
      =(SELECT COUNT(*) FROM sales_return_refund_allocations a
        WHERE a.return_id=sr.return_id AND a.method IN ('Bank','Mobile Banking'))
    AND (SELECT COUNT(*) FROM customer_store_credit_entries e WHERE e.source_type='Sales Return'
      AND e.source_id=sr.return_id AND e.entry_type='ISSUE')
      =(SELECT COUNT(*) FROM sales_return_refund_allocations a
        WHERE a.return_id=sr.return_id AND a.method='Store Credit')
    AND NOT EXISTS(
      SELECT 1 FROM sales_return_refund_allocations a
      LEFT JOIN customer_store_credit_entries e ON e.source_type='Sales Return'
        AND e.source_id=a.return_id AND e.entry_type='ISSUE' AND e.customer_id=a.customer_id
        AND e.delta_cents=a.amount_cents
      WHERE a.return_id=sr.return_id AND a.method='Store Credit' AND e.entry_id IS NULL
    )
    AND (SELECT COALESCE(SUM(CAST(ROUND(item.line_total*100) AS INTEGER)),0)
      FROM sales_return_items item WHERE item.return_id=sr.return_id)
        =CAST(ROUND(sr.total_return_amount*100) AS INTEGER)
    AND (SELECT COUNT(*) FROM split_refund_lot_restorations evidence
      WHERE evidence.return_id=sr.return_id)
      =(SELECT COUNT(DISTINCT sold.lot_id) FROM sale_item_lots sold
        WHERE sold.invoice_id=s.invoice_id)
    AND NOT EXISTS (
      SELECT 1 FROM split_refund_lot_restorations evidence
      LEFT JOIN stock_lots lot ON lot.lot_id=evidence.lot_id
      WHERE evidence.return_id=sr.return_id
        AND (evidence.invoice_id<>s.invoice_id
          OR lot.lot_id IS NULL
          OR ABS(lot.remaining_quantity-evidence.prior_remaining-evidence.quantity)>0.00001
          OR lot.remaining_quantity>lot.original_quantity
          OR NOT EXISTS (SELECT 1 FROM sale_item_lots sold
            WHERE sold.invoice_id=s.invoice_id AND sold.lot_id=evidence.lot_id
              AND sold.product_id=evidence.product_id))
    )
    AND NOT EXISTS (
      SELECT 1 FROM sale_item_lots sold
      WHERE sold.invoice_id=s.invoice_id AND (
        SELECT ABS(COALESCE(SUM(evidence.quantity),0)
          -COALESCE((SELECT SUM(original.quantity) FROM sale_item_lots original
            WHERE original.invoice_id=s.invoice_id AND original.lot_id=sold.lot_id),0))
        FROM split_refund_lot_restorations evidence
        WHERE evidence.return_id=sr.return_id AND evidence.lot_id=sold.lot_id
      )>0.00001
    )
    AND NOT EXISTS (
      SELECT 1 FROM sales_return_items item
      LEFT JOIN products product ON product.product_id=item.product_id
      WHERE item.return_id=sr.return_id AND (
        product.product_id IS NULL
        OR (SELECT COUNT(*) FROM stock_movements sm
          WHERE sm.note=sr.return_id AND sm.product_id=item.product_id
            AND sm.movement_type='Sales Return')<>1
        OR ABS(product.current_stock-COALESCE((SELECT sm.balance_after
          FROM stock_movements sm WHERE sm.note=sr.return_id AND sm.product_id=item.product_id
            AND sm.movement_type='Sales Return' LIMIT 1),-1))>0.00001
      )
    )
    AND NOT EXISTS (SELECT 1 FROM customer_ledger cl WHERE cl.reference=sr.return_id)
)
BEGIN SELECT RAISE(ABORT,'SPLIT_REFUND_ACCOUNTING_CONFLICT'); END;
