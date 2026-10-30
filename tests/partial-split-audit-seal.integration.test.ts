import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';

/** Migrated SQLite exercises the same D1 SQL audit trigger. No payment API enabled. */
function fixture(){
  const db=new SqliteDatabase(':memory:');
  runMigrations(db.native,resolve('migrations'));
  const q=db.native;
  q.prepare("INSERT INTO customers(customer_id,customer_name,phone,current_due,status,is_deleted) VALUES ('AUD-C','Audit Buyer','01000007781',0,'Active',0)").run();
  q.prepare("INSERT INTO products(product_id,product_name,category,unit,purchase_price,selling_price,current_stock,status) VALUES ('AUD-P','Audit Wire','Electrical','Pcs',5,10,5,'Active')").run();
  q.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost,status) VALUES ('AUD-L','AUD-P','OPENING','Opening',10,5,5,'Active')").run();
  q.prepare("INSERT INTO sales(invoice_id,sale_date,customer_id,customer_name,customer_phone,subtotal,grand_total,discount,paid_amount,due_amount,payment_type,payment_status,payment_method,status,is_deleted) VALUES ('AUD-S','2026-10-30','AUD-C','Audit Buyer','01000007781',50,50,0,50,0,'Cash','Paid','Split','Completed',0)").run();
  q.prepare("INSERT INTO sale_items(invoice_id,product_id,product_name,quantity,unit_price,line_total) VALUES ('AUD-S','AUD-P','Audit Wire',5,10,50)").run();
  q.prepare("INSERT INTO sale_item_lots(invoice_id,product_id,lot_id,quantity,unit_cost) VALUES ('AUD-S','AUD-P','AUD-L',5,5)").run();
  q.prepare("INSERT INTO sale_tender_allocations(allocation_id,invoice_id,line_number,method,amount_cents,bank_account_id,customer_id,source_key) VALUES ('AUD-T1','AUD-S',1,'Cash',2000,'','','Cash')").run();
  q.prepare("INSERT INTO sale_tender_allocations(allocation_id,invoice_id,line_number,method,amount_cents,bank_account_id,customer_id,source_key) VALUES ('AUD-T2','AUD-S',2,'Store Credit',3000,'','AUD-C','Store Credit')").run();
  q.prepare("INSERT INTO sales_returns(return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,refund_method,total_return_amount,reason) VALUES ('AUD-R','2026-10-30','AUD-S','AUD-C','Audit Buyer','01000007781','Split Partial',10,'Partial return')").run();
  q.prepare("INSERT INTO sales_return_items(return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total) VALUES ('AUD-R','AUD-S','AUD-P','Audit Wire',1,10,10)").run();
  q.prepare("INSERT INTO sales_return_item_lots(return_id,invoice_id,product_id,lot_id,quantity) VALUES ('AUD-R','AUD-S','AUD-P','AUD-L',1)").run();
  // Reuse existing immutable G2-H pre-restore snapshot, not another table.
  q.prepare("INSERT INTO split_refund_lot_restorations(return_id,invoice_id,lot_id,product_id,quantity,prior_remaining) VALUES ('AUD-R','AUD-S','AUD-L','AUD-P',1,5)").run();
  q.prepare("INSERT INTO split_partial_refund_allocations(allocation_id,return_id,invoice_id,method,amount_cents,source_key) VALUES ('AUD-A','AUD-R','AUD-S','Cash',1000,'Cash')").run();
  q.prepare("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES ('AUD-CB','2026-10-30','Sales Return','AUD-R','Source refund',10,0,'Cash',0)").run();
  q.prepare("INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id) VALUES ('AUD-SM','AUD-P','Sales Return',1,0,6,'AUD-R',NULL)").run();
  q.prepare("UPDATE products SET current_stock=current_stock+1 WHERE product_id='AUD-P'").run();
  q.prepare("UPDATE stock_lots SET remaining_quantity=remaining_quantity+1 WHERE lot_id='AUD-L'").run();
  const seal=()=>q.prepare("INSERT INTO audit_logs(action,entity_type,entity_id,note) VALUES ('POST_PARTIAL_SPLIT_RETURN','SALES_RETURN','AUD-R','Atomic refund proof')").run();
  const count=()=>Number((q.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='POST_PARTIAL_SPLIT_RETURN'").get() as any).n);
  return {db,q,seal,count};
}
test('G2-M audit seal accepts exactly one balanced partial cash return and rejects replay',()=>{
  const f=fixture();
  try{
    f.seal();assert.equal(f.count(),1);
    assert.throws(f.seal,/PARTIAL_SPLIT_ACCOUNTING_CONFLICT/);
    assert.throws(()=>f.q.prepare("UPDATE audit_logs SET note='Changed' WHERE action='POST_PARTIAL_SPLIT_RETURN'").run(),/PARTIAL_SPLIT_AUDIT_APPEND_ONLY/);
    assert.throws(()=>f.q.prepare("DELETE FROM audit_logs WHERE action='POST_PARTIAL_SPLIT_RETURN'").run(),/PARTIAL_SPLIT_AUDIT_APPEND_ONLY/);
    assert.equal(f.count(),1);
  }finally{f.db.close();}
});
test('G2-M audit seal rejects missing, overpaid or duplicate Cash Book refund',()=>{
  for(const sql of [
    "DELETE FROM cash_book WHERE reference='AUD-R'",
    "UPDATE cash_book SET debit=9 WHERE reference='AUD-R'",
    "UPDATE cash_book SET credit=1 WHERE reference='AUD-R'",
    "UPDATE cash_book SET is_deleted=1 WHERE reference='AUD-R'",
    "INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES ('AUD-DUP','2026-10-30','Sales Return','AUD-R','Duplicate',10,0,'Cash',0)"
  ]){
    const f=fixture();
    try{f.q.exec(sql);assert.throws(f.seal,/PARTIAL_SPLIT_ACCOUNTING_CONFLICT/,sql);assert.equal(f.count(),0);}
    finally{f.db.close();}
  }
});
test('G2-M audit seal rejects return totals, FIFO or inventory ledger mismatch',()=>{
  for(const sql of [
    "UPDATE sales_return_items SET line_total=9 WHERE return_id='AUD-R'",
    "DELETE FROM sales_return_item_lots WHERE return_id='AUD-R'", 
    "DELETE FROM stock_movements WHERE note='AUD-R'",
    "UPDATE stock_movements SET quantity_in=2 WHERE note='AUD-R'",
    "UPDATE products SET current_stock=5 WHERE product_id='AUD-P'",
    "UPDATE stock_lots SET remaining_quantity=5 WHERE lot_id='AUD-L'",
    "UPDATE sales_returns SET total_return_amount=9 WHERE return_id='AUD-R'"
  ]){
    const f=fixture();
    try{
      if(sql.includes('DELETE FROM sales_return_item_lots')){
        assert.throws(()=>f.q.exec(sql),/SPLIT_PARTIAL_FIFO_APPEND_ONLY/);
        continue;
      }
      f.q.exec(sql);assert.throws(f.seal,/PARTIAL_SPLIT_ACCOUNTING_CONFLICT/,sql);assert.equal(f.count(),0);
    }finally{f.db.close();}
  }
});
test('G2-M audit seal failure rolls back preceding money/stock batch statements',async()=>{
  const f=fixture();
  try{
    f.q.prepare("DELETE FROM cash_book WHERE reference='AUD-R'").run();
    const originalStock=(f.q.prepare("SELECT current_stock n FROM products WHERE product_id='AUD-P'").get() as any).n;
    await assert.rejects(f.db.batch([
      f.db.prepare("UPDATE products SET current_stock=current_stock+1 WHERE product_id='AUD-P'"),
      f.db.prepare("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES ('BAD-CASH','2026-10-30','Sales Return','AUD-R','Wrong refund',9,0,'Cash',0)"),
      f.db.prepare("INSERT INTO audit_logs(action,entity_type,entity_id,note) VALUES ('POST_PARTIAL_SPLIT_RETURN','SALES_RETURN','AUD-R','Fail transaction')")
    ]),/PARTIAL_SPLIT_ACCOUNTING_CONFLICT/);
    assert.equal((f.q.prepare("SELECT current_stock n FROM products WHERE product_id='AUD-P'").get() as any).n,originalStock);
    assert.equal((f.q.prepare("SELECT COUNT(*) n FROM cash_book WHERE entry_id='BAD-CASH'").get() as any).n,0);
    assert.equal(f.count(),0);
  }finally{f.db.close();}
});
