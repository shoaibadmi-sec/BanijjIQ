import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {quotePartialSplitRefundFromD1} from '../server/modules/sales/partial-refund-d1.ts';

function fixture(){
  const db=new SqliteDatabase(':memory:');
  runMigrations(db.native,resolve('migrations'));
  const q=db.native;
  q.prepare("INSERT INTO customers(customer_id,customer_name,phone,current_due,status,is_deleted) VALUES ('D1-C','D1 Buyer','01000007651',0,'Active',0)").run();
  q.prepare("INSERT INTO products(product_id,product_name,category,unit,purchase_price,selling_price,current_stock,status) VALUES ('D1-P','D1 Wire','Electrical','Pcs',5,10,5,'Active')").run();
  q.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost,status) VALUES ('D1-LOT','D1-P','OPENING','Opening stock',10,5,5,'Active')").run();
  q.prepare("INSERT INTO sales(invoice_id,sale_date,customer_id,customer_name,customer_phone,subtotal,grand_total,discount,paid_amount,due_amount,payment_type,payment_status,payment_method,status,is_deleted) VALUES ('D1-S','2026-10-30','D1-C','D1 Buyer','01000007651',50,50,0,50,0,'Cash','Paid','Split','Completed',0)").run();
  q.prepare("INSERT INTO sale_items(invoice_id,product_id,product_name,quantity,unit_price,line_total) VALUES ('D1-S','D1-P','D1 Wire',5,10,50)").run();
  q.prepare("INSERT INTO sale_item_lots(invoice_id,product_id,lot_id,quantity,unit_cost) VALUES ('D1-S','D1-P','D1-LOT',5,5)").run();
  for(const [line,method,cents,customer] of [[1,'Cash',2000,''],[2,'Store Credit',3000,'D1-C']] as const)
    q.prepare("INSERT INTO sale_tender_allocations(allocation_id,invoice_id,line_number,method,amount_cents,bank_account_id,customer_id,source_key) VALUES (?, 'D1-S', ?, ?, ?, '', ?, ?)")
      .run('T-'+line,line,method,cents,customer,method);
  const postReturn=(id:string,source:'Cash'|'Store Credit')=>{
    q.prepare("INSERT INTO sales_returns(return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,refund_method,total_return_amount,reason) VALUES (?,'2026-10-30','D1-S','D1-C','D1 Buyer','01000007651','Split Partial',10,'Original cash refund')").run(id);
    q.prepare("INSERT INTO sales_return_items(return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total) VALUES (?,'D1-S','D1-P','D1 Wire',1,10,10)").run(id);
    q.prepare("INSERT INTO sales_return_item_lots(return_id,invoice_id,product_id,lot_id,quantity) VALUES (?,'D1-S','D1-P','D1-LOT',1)").run(id);
    q.prepare("INSERT INTO split_partial_refund_allocations(allocation_id,return_id,invoice_id,method,amount_cents,customer_id,source_key) VALUES (?,?, 'D1-S',?,1000,?,?)")
      .run('AL-'+id,id,source,source==='Store Credit'?'D1-C':'',source);
    if(source==='Cash')
      q.prepare("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES (?,'2026-10-30','Sales Return',?,'Test refund',10,0,'Cash',0)").run('CB-'+id,id);
    q.prepare("INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id) VALUES (?,'D1-P','Sales Return',1,0,6,?,NULL)").run('SM-'+id,id);
    q.prepare("UPDATE stock_lots SET remaining_quantity=remaining_quantity+1 WHERE lot_id='D1-LOT'").run();
    q.prepare("UPDATE products SET current_stock=current_stock+1 WHERE product_id='D1-P'").run();
  };
  return {db,q,postCashReturn:(id:string)=>postReturn(id,'Cash'),
    postUnfundedCreditReturn:(id:string)=>postReturn(id,'Store Credit')};
}

test('G2-L quotes remaining original-source funds from real migrated Cash + FIFO return journals',async()=>{
  const f=fixture();
  try{
    f.postCashReturn('D1-R1');
    assert.deepEqual(await quotePartialSplitRefundFromD1(f.db,'D1-S',1000),[
      {sourceKey:'Cash',amountCents:250},
      {sourceKey:'Store Credit',amountCents:750}
    ]);
    assert.equal((f.q.prepare("SELECT COUNT(*) n FROM cash_book").get() as any).n,1,
      'read-only quote must not post another refund');
    assert.equal((f.q.prepare("SELECT current_stock n FROM products WHERE product_id='D1-P'").get() as any).n,6);
    await assert.rejects(quotePartialSplitRefundFromD1(f.db,'D1-S',4001),/exceeds remaining/i);
  }finally{f.db.close();}
});

test('G2-L rejects absent, duplicate, altered, or deleted real Cash Book payout',async()=>{
  for(const tamper of [
    "DELETE FROM cash_book WHERE reference='D1-R1'",
    "UPDATE cash_book SET debit=9 WHERE reference='D1-R1'",
    "UPDATE cash_book SET credit=2 WHERE reference='D1-R1'",
    "UPDATE cash_book SET is_deleted=1 WHERE reference='D1-R1'",
    "INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES ('CB-DUP','2026-10-30','Sales Return','D1-R1','Duplicate',10,0,'Cash',0)"
  ]){
    const f=fixture();
    try{
      f.postCashReturn('D1-R1');
      f.q.exec(tamper);
      await assert.rejects(quotePartialSplitRefundFromD1(f.db,'D1-S',100),
        /journal|reconcil|account/i,tamper);
    }finally{f.db.close();}
  }
});

test('G2-L rejects missing stock movement, mismatched quantity and unfunded credit allocation',async()=>{
  for(const tamper of [
    "DELETE FROM stock_movements WHERE note='D1-R1'",
    "UPDATE stock_movements SET quantity_in=2 WHERE note='D1-R1'",
    "UPDATE stock_movements SET quantity_out=1 WHERE note='D1-R1'",
    "UPDATE stock_movements SET movement_type='Sale' WHERE note='D1-R1'",
    "UPDATE sales_return_items SET line_total=9 WHERE return_id='D1-R1'"
  ]){
    const f=fixture();
    try{
      f.postCashReturn('D1-R1');
      f.q.exec(tamper);
      await assert.rejects(quotePartialSplitRefundFromD1(f.db,'D1-S',100),
        /journal|reconcil|stock|FIFO|item/i,tamper);
    }finally{f.db.close();}
  }
});

test('G2-L fails closed if historical return has no real source journal at all',async()=>{
  const f=fixture();
  try{
    f.q.prepare("INSERT INTO sales_returns(return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,refund_method,total_return_amount,reason) VALUES ('D1-UNPOSTED','2026-10-30','D1-S','D1-C','D1 Buyer','01000007651','Split Partial',10,'Unposted')").run();
    await assert.rejects(quotePartialSplitRefundFromD1(f.db,'D1-S',100),/journal|reconcil|stock|FIFO|item/i);
  }finally{f.db.close();}
});

test('G2-L rejects a valid original Store Credit allocation when its ISSUE journal is absent',async()=>{
  const f=fixture();
  try{
    f.postUnfundedCreditReturn('D1-CREDIT-RETURN');
    await assert.rejects(quotePartialSplitRefundFromD1(f.db,'D1-S',100),
      /journal|reconcil|Store Credit/i,
      'original Store Credit is customer liability, never an invented cash refund');
  }finally{f.db.close();}
});
