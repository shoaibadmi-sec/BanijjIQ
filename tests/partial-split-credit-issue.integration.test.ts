import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {postCashCreditPartialSplitReturn} from '../server/modules/sales/partial-split-credit-posting.ts';

/** G2-P: real full-migration proof for one already redeemed original
 * Store Credit source; the reissued refund must remain liability, never cash. */
function fixture(preposted=true,creditFirst=false){
  const db=new SqliteDatabase(':memory:');runMigrations(db.native,resolve('migrations'));
  const q=db.native;
  const statements=[
    "INSERT INTO customers(customer_id,customer_name,phone,current_due,status,is_deleted) VALUES ('CR-C','Credit Return Buyer','01000006951',0,'Active',0)",
    "INSERT INTO products(product_id,product_name,category,unit,purchase_price,selling_price,current_stock,status) VALUES ('CR-P','Credit Wire','Electrical','Pcs',5,10,5,'Active')",
    "INSERT INTO stock_lots(lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost,status) VALUES ('CR-L','CR-P','OPENING','Opening',10,5,5,'Active')",
    "INSERT INTO sales(invoice_id,sale_date,customer_id,customer_name,customer_phone,subtotal,grand_total,paid_amount,due_amount,payment_type,payment_status,payment_method,status,is_deleted) VALUES ('CR-ORIG','2026-10-30','CR-C','Credit Return Buyer','01000006951',40,40,40,0,'Cash','Paid','Cash','Completed',0)",
    "INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES ('CR-ORIG-CB','2026-10-30','Sale','CR-ORIG','Original cash sale',0,40,'Cash',0)",
    "INSERT INTO sale_items(invoice_id,product_id,product_name,quantity,unit_price,line_total) VALUES ('CR-ORIG','CR-P','Credit Wire',4,10,40)",
    "INSERT INTO sales_returns(return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,refund_method,total_return_amount,reason) VALUES ('CR-ORIG-RETURN','2026-10-30','CR-ORIG','CR-C','Credit Return Buyer','01000006951','Store Credit',30,'Backed legacy-free credit source')",
    "INSERT INTO sales_return_items(return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total) VALUES ('CR-ORIG-RETURN','CR-ORIG','CR-P','Credit Wire',3,10,30)",
    "INSERT INTO customer_store_credit_entries(entry_id,customer_id,entry_type,source_type,source_id,delta_cents,balance_after_cents,created_by) VALUES ('CR-INITIAL-CREDIT','CR-C','ISSUE','Sales Return','CR-ORIG-RETURN',3000,3000,'auditor')",
    "INSERT INTO sales(invoice_id,sale_date,customer_id,customer_name,customer_phone,subtotal,grand_total,paid_amount,due_amount,payment_type,payment_status,payment_method,status,is_deleted) VALUES ('CR-S','2026-10-30','CR-C','Credit Return Buyer','01000006951',50,50,50,0,'Cash','Paid','Split','Completed',0)",
    "INSERT INTO sale_items(invoice_id,product_id,product_name,quantity,unit_price,line_total) VALUES ('CR-S','CR-P','Credit Wire',5,10,50)",
    "INSERT INTO sale_item_lots(invoice_id,product_id,lot_id,quantity,unit_cost) VALUES ('CR-S','CR-P','CR-L',5,5)",
    "INSERT INTO sale_tender_allocations(allocation_id,invoice_id,line_number,method,amount_cents,bank_account_id,customer_id,source_key) VALUES ('CR-S-CASH','CR-S',"+(creditFirst?2:1)+",'Cash',2000,'','','Cash')",
    "INSERT INTO sale_tender_allocations(allocation_id,invoice_id,line_number,method,amount_cents,bank_account_id,customer_id,source_key) VALUES ('CR-S-CREDIT','CR-S',"+(creditFirst?1:2)+",'Store Credit',3000,'','CR-C','Store Credit')",
    "INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES ('CR-S-CB','2026-10-30','Sale','CR-S','Split cash receipt',0,20,'Cash',0)",
    "INSERT INTO customer_store_credit_entries(entry_id,customer_id,entry_type,source_type,source_id,delta_cents,balance_after_cents,created_by) VALUES ('CR-REDEEM','CR-C','REDEEM','Sale','CR-S',-3000,0,'auditor')",
    "INSERT INTO sales_returns(return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,refund_method,total_return_amount,reason) VALUES ('CR-R','2026-10-30','CR-S','CR-C','Credit Return Buyer','01000006951','Split Partial',10,'Source exact partial return')",
    "INSERT INTO sales_return_items(return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total) VALUES ('CR-R','CR-S','CR-P','Credit Wire',1,10,10)",
    "INSERT INTO sales_return_item_lots(return_id,invoice_id,product_id,lot_id,quantity) VALUES ('CR-R','CR-S','CR-P','CR-L',1)",
    "INSERT INTO split_refund_lot_restorations(return_id,invoice_id,lot_id,product_id,quantity,prior_remaining) VALUES ('CR-R','CR-S','CR-L','CR-P',1,5)",
    "UPDATE stock_lots SET remaining_quantity=6 WHERE lot_id='CR-L'",
    "UPDATE products SET current_stock=6 WHERE product_id='CR-P'",
    "INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id) VALUES ('CR-M','CR-P','Sales Return',1,0,6,'CR-R',NULL)",
    "INSERT INTO split_partial_refund_allocations(allocation_id,return_id,invoice_id,method,amount_cents,customer_id,source_key) VALUES ('CR-A-CREDIT','CR-R','CR-S','Store Credit',600,'CR-C','Store Credit')",
    "INSERT INTO split_partial_refund_allocations(allocation_id,return_id,invoice_id,method,amount_cents,source_key) VALUES ('CR-A-CASH','CR-R','CR-S','Cash',400,'Cash')",
    "INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES ('CR-R-CB','2026-10-30','Sales Return','CR-R','Partial cash refund',4,0,'Cash',0)"
  ];
  for(const sql of statements){
    if(!preposted && (
      sql.includes("'CR-R'") ||
      sql.startsWith("UPDATE stock_lots SET remaining_quantity=6") ||
      sql.startsWith("UPDATE products SET current_stock=6")
    ))continue;
    q.exec(sql);
  }
  const issue=(delta=600,balance=600,customer='CR-C')=>q.prepare(
    "INSERT INTO customer_store_credit_entries(entry_id,customer_id,entry_type,source_type,source_id,delta_cents,balance_after_cents,created_by) "+
    "VALUES ('CR-R-ISSUE',?,'ISSUE','Sales Return','CR-R',?,?,'auditor')"
  ).run(customer,delta,balance);
  const seal=()=>q.prepare(
    "INSERT INTO audit_logs(action,entity_type,entity_id,note) "+
    "VALUES ('POST_PARTIAL_SPLIT_RETURN','SALES_RETURN','CR-R','Verified cash and Store Credit liability refund')"
  ).run();
  const count=(table:string)=>Number((q.prepare('SELECT COUNT(*) n FROM '+table).get() as any).n);
  return {db,q,issue,seal,count};
}

test('G2-P reissues only 600 original-source poisha as Store Credit liability and seals return',()=>{
  const f=fixture();
  try{
    f.issue();f.seal();
    assert.equal((f.q.prepare("SELECT available_cents n FROM customer_store_credit_balance WHERE customer_id='CR-C'").get() as any).n,600);
    assert.equal((f.q.prepare("SELECT debit n FROM cash_book WHERE reference='CR-R'").get() as any).n,4);
    assert.equal(f.count('customer_ledger'),0,'liability must not alter receivables');
    assert.equal((f.q.prepare("SELECT COUNT(*) n FROM customer_store_credit_entries WHERE source_id='CR-R' AND entry_type='ISSUE'").get() as any).n,1);
    assert.equal((f.q.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='POST_PARTIAL_SPLIT_RETURN'").get() as any).n,1);
    assert.throws(()=>f.issue(),/UNIQUE|CONFLICT|conflict/i,'duplicate partial ISSUE cannot mint again');
  }finally{f.db.close();}
});

test('G2-P rejects forged ISSUE amount, stale credit balance, or absent original redemption',()=>{
  for(const [tamper,amount,balance] of [
    ['',700,700],
    ['',600,601],
    ["DELETE FROM customer_store_credit_entries WHERE entry_id='CR-REDEEM'",600,3600],
    ["UPDATE customer_store_credit_entries SET delta_cents=-2000 WHERE entry_id='CR-REDEEM'",600,1600],
    ["DELETE FROM cash_book WHERE reference='CR-R'",600,600],
    ["UPDATE cash_book SET debit=9 WHERE reference='CR-R'",600,600]
  ] as const){
    const f=fixture();
    try{
      if(tamper) {
        if(tamper.startsWith('DELETE FROM customer_store_credit_entries')||tamper.startsWith('UPDATE customer_store_credit_entries')){
          assert.throws(()=>f.q.exec(tamper),/STORE_CREDIT_APPEND_ONLY/);
          continue;
        }
        f.q.exec(tamper);
      }
      assert.throws(()=>f.issue(amount,balance),/CREDIT|LEDGER|SOURCE|CONFLICT|conflict/i,tamper||'forged amount/balance');
      assert.equal((f.q.prepare("SELECT COUNT(*) n FROM customer_store_credit_entries WHERE source_id='CR-R'").get() as any).n,0);
    }finally{f.db.close();}
  }
});

test('G2-P cannot issue without complete source allocation, valid customer, or item/FIFO proof',()=>{
  for(const tamper of [
    "DELETE FROM cash_book WHERE reference='CR-R'",
    "UPDATE sales_return_items SET line_total=9 WHERE return_id='CR-R'",
    "DELETE FROM stock_movements WHERE note='CR-R'",
    "UPDATE customers SET status='Inactive' WHERE customer_id='CR-C'",
    "UPDATE sales_returns SET customer_phone='01000000000' WHERE return_id='CR-R'"
  ]){
    const f=fixture();
    try{
      f.q.exec(tamper);
      assert.throws(()=>f.issue(),/CREDIT|LEDGER|SOURCE|CONFLICT|conflict/i,tamper);
    }finally{f.db.close();}
  }
});

test('G2-P forged or missing Store Credit ISSUE rolls back the same D1 batch',async()=>{
  const f=fixture();
  try{
    const oldStock=(f.q.prepare("SELECT current_stock n FROM products WHERE product_id='CR-P'").get() as any).n;
    await assert.rejects(f.db.batch([
      f.db.prepare("UPDATE products SET current_stock=current_stock+1 WHERE product_id='CR-P'"),
      f.db.prepare(
        "INSERT INTO customer_store_credit_entries(entry_id,customer_id,entry_type,source_type,source_id,delta_cents,balance_after_cents,created_by) "+
        "VALUES ('CR-FAKE','CR-C','ISSUE','Sales Return','CR-R',700,700,'auditor')"
      ),
      f.db.prepare(
        "INSERT INTO audit_logs(action,entity_type,entity_id,note) VALUES ('POST_PARTIAL_SPLIT_RETURN','SALES_RETURN','CR-R','must not post')"
      )
    ]),/CREDIT|LEDGER|SOURCE|CONFLICT|conflict/i);
    assert.equal((f.q.prepare("SELECT current_stock n FROM products WHERE product_id='CR-P'").get() as any).n,oldStock);
    assert.equal((f.q.prepare("SELECT COUNT(*) n FROM customer_store_credit_entries WHERE source_id='CR-R'").get() as any).n,0);
    assert.equal((f.q.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='POST_PARTIAL_SPLIT_RETURN'").get() as any).n,0);
  }finally{f.db.close();}
});


test('G2-Q atomic Cash+Store Credit return creates exactly one refund and one liability ISSUE',async()=>{
  const f=fixture(false);
  try{
    const posted=await postCashCreditPartialSplitReturn(f.db,{
      invoiceId:'CR-S',productId:'CR-P',quantity:1,
      requestId:'CR-FIRST-RETURN',reason:'Original receipt verified and items returned'
    });
    assert.equal(posted.returnId,'SRT-CR-FIRST-RETURN');
    assert.equal(posted.alreadyPosted,false);
    assert.deepEqual(posted.allocations,[
      {sourceKey:'Cash',amountCents:400},{sourceKey:'Store Credit',amountCents:600}
    ]);
    assert.equal(f.count('sales_returns'),2,'only one new partial refund');
    assert.equal((f.q.prepare("SELECT debit n FROM cash_book WHERE reference='SRT-CR-FIRST-RETURN'").get() as any).n,4);
    assert.equal((f.q.prepare("SELECT delta_cents n FROM customer_store_credit_entries WHERE source_id='SRT-CR-FIRST-RETURN'").get() as any).n,600);
    assert.equal((f.q.prepare("SELECT available_cents n FROM customer_store_credit_balance WHERE customer_id='CR-C'").get() as any).n,600);
    assert.equal((f.q.prepare("SELECT current_stock n FROM products WHERE product_id='CR-P'").get() as any).n,6);
    assert.equal((f.q.prepare("SELECT remaining_quantity n FROM stock_lots WHERE lot_id='CR-L'").get() as any).n,6);
    assert.equal((f.q.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='POST_PARTIAL_SPLIT_RETURN' AND entity_id='SRT-CR-FIRST-RETURN'").get() as any).n,1);
    assert.equal(f.count('bank_book'),0,'Store Credit reissue is never a bank payout');
    assert.equal(f.count('customer_ledger'),0,'Store Credit is not negative receivable');
  }finally{f.db.close();}
});

test('G2-Q idempotent replay does not mint additional liability or cash refunds',async()=>{
  const f=fixture(false);
  const input={invoiceId:'CR-S',productId:'CR-P',quantity:1,
    requestId:'CR-IDEMP-RETURN',reason:'Original receipt verified and items returned'};
  try{
    const first=await postCashCreditPartialSplitReturn(f.db,input);
    const repeated=await postCashCreditPartialSplitReturn(f.db,input);
    assert.equal(first.alreadyPosted,false);
    assert.equal(repeated.alreadyPosted,true);
    assert.equal(f.count('sales_returns'),2);
    assert.equal((f.q.prepare("SELECT COUNT(*) n FROM customer_store_credit_entries WHERE source_type='Sales Return' AND source_id='SRT-CR-IDEMP-RETURN'").get() as any).n,1);
    await assert.rejects(postCashCreditPartialSplitReturn(f.db,{...input,quantity:2}),
      /idempotency|different|conflict/i);
    assert.equal(f.count('sales_returns'),2);
  }finally{f.db.close();}
});

test('G2-Q forced final-audit rejection rolls back Cash, ISSUE, FIFO and inventory together',async()=>{
  const f=fixture(false);
  try{
    f.q.exec("CREATE TRIGGER force_credit_refund_failure BEFORE INSERT ON audit_logs WHEN NEW.action='POST_PARTIAL_SPLIT_RETURN' BEGIN SELECT RAISE(ABORT,'INJECTED_CREDIT_REFUND_ROLLBACK'); END");
    await assert.rejects(postCashCreditPartialSplitReturn(f.db,{
      invoiceId:'CR-S',productId:'CR-P',quantity:1,
      requestId:'CR-ROLLBACK',reason:'Original receipt verified and items returned'
    }),/INJECTED_CREDIT_REFUND_ROLLBACK|rollback|failed/i);
    assert.equal(f.count('sales_returns'),1);
    assert.equal(f.count('split_partial_refund_allocations'),0);
    assert.equal(f.count('split_refund_lot_restorations'),0);
    assert.equal((f.q.prepare("SELECT current_stock n FROM products WHERE product_id='CR-P'").get() as any).n,5);
    assert.equal((f.q.prepare("SELECT remaining_quantity n FROM stock_lots WHERE lot_id='CR-L'").get() as any).n,5);
    assert.equal((f.q.prepare("SELECT COUNT(*) n FROM cash_book WHERE reference='SRT-CR-ROLLBACK'").get() as any).n,0);
    assert.equal((f.q.prepare("SELECT COUNT(*) n FROM customer_store_credit_entries WHERE source_id='SRT-CR-ROLLBACK'").get() as any).n,0);
  }finally{f.db.close();}
});

test('G2-Q accepts original Cash and Store Credit tenders in either row order',async()=>{
  // Original allocations are immutable; the fixture creates credit-first at checkout.
  const f=fixture(false,true);
  try{
    const posted=await postCashCreditPartialSplitReturn(f.db,{
      invoiceId:'CR-S',productId:'CR-P',quantity:1,
      requestId:'CR-REVERSE-TENDER',reason:'Cash and Store Credit sources were independently verified'
    });
    assert.deepEqual(Object.fromEntries(posted.allocations.map(a=>[a.sourceKey,a.amountCents])),{
      Cash:400,'Store Credit':600
    });
    assert.equal((f.q.prepare("SELECT delta_cents n FROM customer_store_credit_entries WHERE source_id='SRT-CR-REVERSE-TENDER'").get() as any).n,600);
    assert.equal((f.q.prepare("SELECT debit n FROM cash_book WHERE reference='SRT-CR-REVERSE-TENDER'").get() as any).n,4);
  }finally{f.db.close();}
});
