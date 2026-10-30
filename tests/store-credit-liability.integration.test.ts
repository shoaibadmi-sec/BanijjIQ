import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';

test('Phase 3G2 liability journal isolates Store Credit from receivables and flags legacy returns',()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));
  const get=(sql:string,...args:unknown[])=>db.native.prepare(sql).get(...args) as any;
  const insertCredit=db.native.prepare(
   'INSERT INTO customer_store_credit_entries (entry_id,customer_id,entry_type,source_type,source_id,delta_cents,balance_after_cents,created_by) VALUES (?,?,?,?,?,?,?,?)'
  );
  db.native.prepare(
   "INSERT INTO customers (customer_id,customer_name,phone,current_due,status,is_deleted) VALUES ('CREDIT-CUS','Credit Customer','01000009991',40,'Active',0)"
  ).run();
  db.native.prepare(
   "INSERT INTO customers (customer_id,customer_name,phone,current_due,status,is_deleted) VALUES ('OTHER-CUS','Other Customer','01000009992',0,'Active',0)"
  ).run();
  db.native.prepare(
   "INSERT INTO sales (invoice_id,sale_date,customer_id,customer_name,customer_phone,grand_total,paid_amount,due_amount,payment_type,payment_status,payment_method) "+
   "VALUES ('CREDIT-SALE','2026-10-29','CREDIT-CUS','Credit Customer','01000009991',100,100,0,'Cash','Paid','Cash')"
  ).run();
  db.native.prepare(
   "INSERT INTO cash_book (entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) "+
   "VALUES ('CREDIT-CASH','2026-10-29','Sale','CREDIT-SALE','Original paid sale',0,100,'Cash',0)"
  ).run();
  db.native.prepare(
   "INSERT INTO sale_items (invoice_id,product_id,product_name,quantity,unit_price,line_total) "+
   "VALUES ('CREDIT-SALE','CREDIT-PROD','Test Product',3,33.333333,100)"
  ).run();
  const addItem=db.native.prepare(
   "INSERT INTO sales_return_items (return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total) "+
   "VALUES (?,'CREDIT-SALE','CREDIT-PROD','Test Product',1,?,?)"
  );
  const returnStmt=db.native.prepare(
   'INSERT INTO sales_returns (return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,refund_method,total_return_amount,reason) VALUES (?,\'2026-10-29\',\'CREDIT-SALE\',\'CREDIT-CUS\',\'Credit Customer\',\'01000009991\',\'Store Credit\',?,\'Test credited return\')'
  );
  returnStmt.run('CREDIT-RETURN-1',20);
  addItem.run('CREDIT-RETURN-1',20,20);
  assert.equal(get("SELECT amount_cents FROM store_credit_legacy_unreconciled WHERE return_id='CREDIT-RETURN-1'").amount_cents,2000);
  assert.equal(get("SELECT available_cents FROM customer_store_credit_balance WHERE customer_id='CREDIT-CUS'").available_cents,0);
  assert.equal(get("SELECT receivable_due FROM customer_store_credit_balance WHERE customer_id='CREDIT-CUS'").receivable_due,40);
  assert.throws(()=>insertCredit.run('WRONG-OWNER','OTHER-CUS','ISSUE','Sales Return','CREDIT-RETURN-1',2000,2000,'tester'),/STORE_CREDIT_(LEDGER|SOURCE)_CONFLICT/);
  insertCredit.run('CREDIT-ENTRY-1','CREDIT-CUS','ISSUE','Sales Return','CREDIT-RETURN-1',2000,2000,'tester');
  assert.equal(get("SELECT COUNT(*) n FROM store_credit_legacy_unreconciled").n,0);
  assert.equal(get("SELECT available_cents FROM customer_store_credit_balance WHERE customer_id='CREDIT-CUS'").available_cents,2000);
  assert.equal(get("SELECT current_due FROM customers WHERE customer_id='CREDIT-CUS'").current_due,40);
  assert.throws(()=>insertCredit.run('DUPLICATE-ISSUE','CREDIT-CUS','ISSUE','Sales Return','CREDIT-RETURN-1',2000,4000,'tester'),/UNIQUE constraint failed/);
  returnStmt.run('CREDIT-RETURN-2',10);
  addItem.run('CREDIT-RETURN-2',10,10);
  assert.throws(()=>insertCredit.run('WRONG-BALANCE','CREDIT-CUS','ISSUE','Sales Return','CREDIT-RETURN-2',1000,1000,'tester'),/STORE_CREDIT_LEDGER_CONFLICT/);
  insertCredit.run('CREDIT-ENTRY-2','CREDIT-CUS','ISSUE','Sales Return','CREDIT-RETURN-2',1000,3000,'tester');
  assert.equal(get("SELECT available_cents FROM customer_store_credit_balance WHERE customer_id='CREDIT-CUS'").available_cents,3000);
  assert.throws(()=>insertCredit.run('EARLY-REDEEM','CREDIT-CUS','REDEEM','Sale','CREDIT-SALE',-100,2900,'tester'),/STORE_CREDIT_LEDGER_CONFLICT/);
  assert.throws(()=>db.native.prepare("UPDATE customer_store_credit_entries SET delta_cents=0 WHERE entry_id='CREDIT-ENTRY-1'").run(),/STORE_CREDIT_APPEND_ONLY/);
  assert.throws(()=>db.native.prepare("DELETE FROM customer_store_credit_entries WHERE entry_id='CREDIT-ENTRY-1'").run(),/STORE_CREDIT_APPEND_ONLY/);
  assert.equal(get("SELECT SUM(delta_cents) n FROM customer_store_credit_entries WHERE customer_id='CREDIT-CUS'").n,3000);
 }finally{db.close();}
});
