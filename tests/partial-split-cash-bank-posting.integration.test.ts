import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {postCashBankPartialSplitReturn} from '../server/modules/sales/partial-split-posting.ts';

function fixture(){
  const db=new SqliteDatabase(':memory:');runMigrations(db.native,resolve('migrations'));
  const q=db.native;
  for(const sql of [
    "INSERT INTO customers(customer_id,customer_name,phone,current_due,status,is_deleted) VALUES ('CB-C','Buyer','01000007891',0,'Active',0)",
    "INSERT INTO products(product_id,product_name,category,unit,purchase_price,selling_price,current_stock,status) VALUES ('CB-P','Wire','Electrical','Pcs',5,10,5,'Active')",
    "INSERT INTO stock_lots(lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost,status) VALUES ('CB-L','CB-P','OPENING','Opening',10,5,5,'Active')",
    "INSERT INTO sales(invoice_id,sale_date,customer_id,customer_name,customer_phone,subtotal,grand_total,discount,paid_amount,due_amount,payment_type,payment_status,payment_method,status,is_deleted) VALUES ('CB-S','2026-10-30','CB-C','Buyer','01000007891',50,50,0,50,0,'Cash','Paid','Split','Completed',0)",
    "INSERT INTO sale_items(invoice_id,product_id,product_name,quantity,unit_price,line_total) VALUES ('CB-S','CB-P','Wire',5,10,50)",
    "INSERT INTO sale_item_lots(invoice_id,product_id,lot_id,quantity,unit_cost) VALUES ('CB-S','CB-P','CB-L',5,5)",
    "INSERT INTO bank_accounts(bank_account_id,account_name,opening_balance,current_balance,status,account_type) VALUES ('CB-B','Bank One',70,100,'Active','Bank')",
    "INSERT INTO sale_tender_allocations(allocation_id,invoice_id,line_number,method,amount_cents,bank_account_id,customer_id,source_key) VALUES ('CB-T1','CB-S',1,'Cash',2000,'','','Cash')",
    "INSERT INTO sale_tender_allocations(allocation_id,invoice_id,line_number,method,amount_cents,bank_account_id,customer_id,source_key) VALUES ('CB-T2','CB-S',2,'Bank',3000,'CB-B','','Bank:CB-B')",
    "INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES ('CB-ORIG','2026-10-30','Sale','CB-S','Original cash',0,20,'Cash',0)",
    "INSERT INTO bank_book(entry_id,bank_account_id,bank_account_name,date,type,reference,description,debit,credit,balance,status,is_deleted) VALUES ('BB-ORIG','CB-B','Bank One','2026-10-30','Sale','CB-S','Original bank',0,30,100,'Active',0)"
  ])q.exec(sql);
  const n=(table:string)=>Number((q.prepare('SELECT COUNT(*) n FROM '+table).get() as any).n);
  const val=(sql:string)=>Number((q.prepare(sql).get() as any).n);
  const refund=(requestId:string,quantity=1,reason='Original receipt accepted with returned items')=>
    postCashBankPartialSplitReturn(db,{invoiceId:'CB-S',productId:'CB-P',quantity,requestId,reason});
  return {db,q,n,val,refund};
}
test('G2-N source-exact Cash+Bank refund restores only one sold unit',async()=>{
  const f=fixture();
  try{
    const posted=await f.refund('IDEMP-ONE');
    assert.deepEqual(posted.allocations,[{sourceKey:'Cash',amountCents:400},{sourceKey:'Bank:CB-B',amountCents:600}]);
    assert.equal(posted.returnId,'SRT-IDEMP-ONE');assert.equal(posted.alreadyPosted,false);
    assert.equal(f.n('sales_returns'),1);assert.equal(f.n('split_partial_refund_allocations'),2);
    assert.equal(f.n('sales_return_item_lots'),1);assert.equal(f.n('split_refund_lot_restorations'),1);
    assert.equal(f.val("SELECT current_stock n FROM products WHERE product_id='CB-P'"),6);
    assert.equal(f.val("SELECT remaining_quantity n FROM stock_lots WHERE lot_id='CB-L'"),6);
    assert.equal(f.val("SELECT current_balance n FROM bank_accounts WHERE bank_account_id='CB-B'"),94);
    assert.equal(f.val("SELECT debit n FROM cash_book WHERE reference='SRT-IDEMP-ONE'"),4);
    assert.equal(f.val("SELECT debit n FROM bank_book WHERE reference='SRT-IDEMP-ONE'"),6);
    assert.equal(f.val("SELECT COUNT(*) n FROM audit_logs WHERE action='POST_PARTIAL_SPLIT_RETURN'"),1);
    assert.equal(f.n('customer_ledger'),0);
  }finally{f.db.close();}
});
test('G2-N two partial refunds, exact remaining budgets, and idempotency conflict',async()=>{
  const f=fixture();
  try{
    await f.refund('IDEMP-ONE');
    const second=await f.refund('IDEMP-TWO',2);
    assert.deepEqual(second.allocations,[{sourceKey:'Cash',amountCents:800},{sourceKey:'Bank:CB-B',amountCents:1200}]);
    assert.equal((await f.refund('IDEMP-ONE')).alreadyPosted,true);
    assert.equal(f.n('sales_returns'),2);assert.equal(f.val("SELECT current_stock n FROM products WHERE product_id='CB-P'"),8);
    assert.equal(f.val("SELECT current_balance n FROM bank_accounts WHERE bank_account_id='CB-B'"),82);
    await assert.rejects(f.refund('IDEMP-ONE',2),/idempotency|different|conflict/i);
    await assert.rejects(f.refund('IDEMP-THREE',3),/quantity|remaining|sold/i);
    assert.equal(f.n('sales_returns'),2);
  }finally{f.db.close();}
});
test('G2-N rejects doctored original source receipts and account balances',async()=>{
  for(const sql of ["UPDATE cash_book SET credit=19 WHERE reference='CB-S'",
    "UPDATE bank_book SET credit=29 WHERE reference='CB-S'",
    "UPDATE bank_accounts SET current_balance=99 WHERE bank_account_id='CB-B'",
    "UPDATE bank_accounts SET status='Inactive' WHERE bank_account_id='CB-B'"]){
    const f=fixture();
    try{f.q.exec(sql);await assert.rejects(f.refund('BAD-SOURCE'),/source|cash|bank|original|reconcil/i);assert.equal(f.n('sales_returns'),0);}
    finally{f.db.close();}
  }
});
test('G2-N failed final D1 audit rolls back original-source payments and FIFO atomically',async()=>{
  const f=fixture();
  try{
    f.q.exec("CREATE TRIGGER block_partial_seal BEFORE INSERT ON audit_logs WHEN NEW.action='POST_PARTIAL_SPLIT_RETURN' BEGIN SELECT RAISE(ABORT,'INJECTED_REFUND_SEAL_FAILURE'); END");
    await assert.rejects(f.refund('FAIL-ROLLBACK'),/INJECTED_REFUND_SEAL_FAILURE|rollback|failed/i);
    assert.equal(f.n('sales_returns'),0);assert.equal(f.n('split_partial_refund_allocations'),0);
    assert.equal(f.n('sales_return_item_lots'),0);assert.equal(f.n('split_refund_lot_restorations'),0);
    assert.equal(f.val("SELECT current_stock n FROM products WHERE product_id='CB-P'"),5);
    assert.equal(f.val("SELECT remaining_quantity n FROM stock_lots WHERE lot_id='CB-L'"),5);
    assert.equal(f.val("SELECT current_balance n FROM bank_accounts WHERE bank_account_id='CB-B'"),100);
    assert.equal(f.n('cash_book'),1);assert.equal(f.n('bank_book'),1);
  }finally{f.db.close();}
});


test('G2-O refuses idempotent replay when a previously posted Cash or Bank journal was changed',async()=>{
  for(const sql of [
    "UPDATE cash_book SET debit=3 WHERE reference='SRT-IDEMP-ONE'",
    "DELETE FROM cash_book WHERE reference='SRT-IDEMP-ONE'",
    "INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES ('EXTRA-CB','2026-10-30','Sales Return','SRT-IDEMP-ONE','Forged',4,0,'Cash',0)",
    "UPDATE bank_book SET debit=5 WHERE reference='SRT-IDEMP-ONE'",
    "DELETE FROM bank_book WHERE reference='SRT-IDEMP-ONE'",
    "UPDATE bank_book SET is_deleted=1 WHERE reference='SRT-IDEMP-ONE'"
  ]){
    const f=fixture();
    try{
      await f.refund('IDEMP-ONE');
      f.q.exec(sql);
      await assert.rejects(f.refund('IDEMP-ONE'),/replay|journal|conflict|source|reconcil/i,
        'A successful prior audit cannot excuse later altered refund books: '+sql);
      assert.equal(f.n('sales_returns'),1,'tampered replay must not create new refund');
    }finally{f.db.close();}
  }
});
test('G2-O replay fails closed if immutable lot proof or stock movement has missing evidence',async()=>{
  for(const sql of [
    "DELETE FROM stock_movements WHERE note='SRT-IDEMP-ONE'",
    "UPDATE stock_movements SET quantity_in=2 WHERE note='SRT-IDEMP-ONE'",
    "UPDATE stock_movements SET quantity_out=1 WHERE note='SRT-IDEMP-ONE'"
  ]){
    const f=fixture();
    try{
      await f.refund('IDEMP-ONE');f.q.exec(sql);
      await assert.rejects(f.refund('IDEMP-ONE'),/replay|stock|FIFO|journal|reconcil|conflict/i,sql);
      assert.equal(f.n('sales_returns'),1);
    }finally{f.db.close();}
  }
});
test('G2-O same request races settle exactly once, including Cash, Bank, FIFO and audit',async()=>{
  const f=fixture();
  try{
    const outcome=await Promise.all([f.refund('RACE-SAME'),f.refund('RACE-SAME')]);
    assert.deepEqual(outcome.map(r=>r.alreadyPosted).sort(),[false,true]);
    assert.equal(f.n('sales_returns'),1);
    assert.equal(f.val("SELECT COUNT(*) n FROM cash_book WHERE reference='SRT-RACE-SAME'"),1);
    assert.equal(f.val("SELECT COUNT(*) n FROM bank_book WHERE reference='SRT-RACE-SAME'"),1);
    assert.equal(f.val("SELECT COUNT(*) n FROM audit_logs WHERE action='POST_PARTIAL_SPLIT_RETURN' AND entity_id='SRT-RACE-SAME'"),1);
    assert.equal(f.val("SELECT current_stock n FROM products WHERE product_id='CB-P'"),6);
  }finally{f.db.close();}
});
test('G2-O competing three-unit returns cannot together consume six of five sold units',async()=>{
  const f=fixture();
  try{
    const attempts=await Promise.allSettled([f.refund('RACE-A',3),f.refund('RACE-B',3)]);
    assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(attempts.filter(r=>r.status==='rejected').length,1);
    assert.equal(f.n('sales_returns'),1);
    assert.equal(f.val("SELECT current_stock n FROM products WHERE product_id='CB-P'"),8);
    assert.equal(f.val("SELECT remaining_quantity n FROM stock_lots WHERE lot_id='CB-L'"),8);
    assert.equal(f.val("SELECT current_balance n FROM bank_accounts WHERE bank_account_id='CB-B'"),82);
  }finally{f.db.close();}
});
