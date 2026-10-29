import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

test('Store Credit is redeemed once as a non-cash full sale; no cash, bank or A/R postings',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));let token='';
  async function api(method:string,path:string,body?:unknown){
   const headers:Record<string,string>={'content-type':'application/json'};
   if(token)headers.authorization='Bearer '+token;
   const response=await handleApiRequest(new Request('http://credit-redemption.test'+path,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body)}),db);
   return {status:response.status,...await response.json() as any};
  }
  const row=(sql:string,...args:unknown[])=>db.native.prepare(sql).get(...args) as any;
  const setup=await api('POST','/api/setup/admin',{
   fullName:'Credit Redeem Tester',phone:'01000009701',password:'CreditRedeemG2C2026!'
  });
  assert.equal(setup.ok,true,JSON.stringify(setup));token=setup.token;
  assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:0})).ok,true);
  db.native.prepare(
   "INSERT INTO customers (customer_id,customer_name,phone,current_due,status,is_deleted) "+
   "VALUES ('CR-CUSTOMER','Credit Redeemer','01000009702',0,'Active',0)"
  ).run();
  const product=await api('POST','/api/products',{
   productName:'Credit Test Cable',category:'Electrical',unit:'Pcs',purchasePrice:5,
   sellingPrice:10,currentStock:40,minimumStock:0,status:'Active'
  });
  assert.equal(product.ok,true,JSON.stringify(product));const id=product.productId;
  const original=await api('POST','/api/pos/sales',{
   clientRequestId:'credit-source-sale-0001',customerId:'CR-CUSTOMER',
   customerName:'Credit Redeemer',customerPhone:'01000009702',
   paymentType:'Cash',paymentMethod:'Cash',items:[{productId:id,qty:3,unitPrice:10}]
  });
  assert.equal(original.ok,true,JSON.stringify(original));
  const sourceId=original.invoice.invoiceId;
  const credited=await api('POST','/api/sales-returns',{
   invoiceId:sourceId,refundMethod:'Store Credit',reason:'Customer prefers future purchases',
   items:[{productId:id,qty:3,unitPrice:10}]
  });
  assert.equal(credited.ok,true,JSON.stringify(credited));
  assert.equal(row("SELECT available_cents FROM customer_store_credit_balance WHERE customer_id='CR-CUSTOMER'").available_cents,3000);
  const books={
   cash:row('SELECT COUNT(*) n FROM cash_book').n,
   bank:row('SELECT COUNT(*) n FROM bank_book').n,
   due:row("SELECT current_due FROM customers WHERE customer_id='CR-CUSTOMER'").current_due,
   ledger:row("SELECT COUNT(*) n FROM customer_ledger WHERE customer_id='CR-CUSTOMER'").n
  };
  const invalid=await api('POST','/api/pos/sales',{
   clientRequestId:'credit-overdraw-0001',customerId:'CR-CUSTOMER',
   customerName:'Credit Redeemer',customerPhone:'01000009702',
   paymentType:'Cash',paymentMethod:'Store Credit',
   items:[{productId:id,qty:4,unitPrice:10}]
  });
  assert.equal(invalid.status,409,JSON.stringify(invalid));
  assert.equal(row('SELECT COUNT(*) n FROM customer_store_credit_entries').n,1);
  const saleInput={
   clientRequestId:'credit-real-redemption-0001',customerId:'CR-CUSTOMER',
   customerName:'Credit Redeemer',customerPhone:'01000009702',
   paymentType:'Cash',paymentMethod:'Store Credit',bankAccountId:'',
   items:[{productId:id,qty:2,unitPrice:10}]
  };
  const spent=await api('POST','/api/pos/sales',saleInput);
  assert.equal(spent.ok,true,JSON.stringify(spent));
  assert.equal(spent.invoice.paymentMethod,'Store Credit');
  const saleId=spent.invoice.invoiceId;
  assert.equal(row('SELECT paid_amount FROM sales WHERE invoice_id=?',saleId).paid_amount,20);
  assert.equal(row('SELECT due_amount FROM sales WHERE invoice_id=?',saleId).due_amount,0);
  assert.equal(row("SELECT available_cents FROM customer_store_credit_balance WHERE customer_id='CR-CUSTOMER'").available_cents,1000);
  const redemption=row("SELECT delta_cents,balance_after_cents,source_id FROM customer_store_credit_entries WHERE entry_type='REDEEM'");
  assert.equal(redemption.delta_cents,-2000);
  assert.equal(redemption.balance_after_cents,1000);
  assert.equal(redemption.source_id,saleId);
  assert.equal(row('SELECT COUNT(*) n FROM cash_book').n,books.cash);
  assert.equal(row('SELECT COUNT(*) n FROM bank_book').n,books.bank);
  assert.equal(row("SELECT current_due FROM customers WHERE customer_id='CR-CUSTOMER'").current_due,books.due);
  assert.equal(row("SELECT COUNT(*) n FROM customer_ledger WHERE customer_id='CR-CUSTOMER'").n,books.ledger);
  const retry=await api('POST','/api/pos/sales',saleInput);
  assert.equal(retry.ok,true,JSON.stringify(retry));
  assert.equal(retry.invoice.invoiceId,saleId);
  assert.equal(row("SELECT COUNT(*) n FROM customer_store_credit_entries WHERE entry_type='REDEEM'").n,1);
  const excessive=await api('POST','/api/pos/sales',{...saleInput,clientRequestId:'credit-overdraw-0002'});
  assert.equal(excessive.status,409,JSON.stringify(excessive));
  const mismatch=await api('POST','/api/pos/sales',{...saleInput,
   clientRequestId:'credit-wrong-phone-0001',customerPhone:'01000009703',items:[{productId:id,qty:1,unitPrice:10}]});
  assert.equal(mismatch.status,409,JSON.stringify(mismatch));
  const part=await api('POST','/api/pos/sales',{...saleInput,clientRequestId:'credit-partial-00001',
   paymentType:'Partial',paidAmount:5,items:[{productId:id,qty:1,unitPrice:10}]});
  assert.equal(part.status,409,JSON.stringify(part));
  const edited=await api('PUT','/api/sales-management/'+saleId,
   {reason:'No unaudited edit of credit-paid sale',items:[]});
  assert.equal(edited.status,409,JSON.stringify(edited));
  const deleted=await api('DELETE','/api/sales-management/'+saleId,
   {reason:'No unaudited delete of credit-paid sale'});
  assert.equal(deleted.status,409,JSON.stringify(deleted));
  const noRequestKey=await api('POST','/api/pos/sales',{
   ...saleInput,clientRequestId:'',items:[{productId:id,qty:1,unitPrice:10}]
  });
  assert.equal(noRequestKey.status,409,JSON.stringify(noRequestKey));
  const creditDue=await api('POST','/api/pos/sales',{
   ...saleInput,clientRequestId:'credit-due-denial-0001',paymentType:'Due',
   items:[{productId:id,qty:1,unitPrice:10}]
  });
  assert.equal(creditDue.status,409,JSON.stringify(creditDue));
  const cashRefund=await api('POST','/api/sales-returns',{
   invoiceId:saleId,refundMethod:'Cash',reason:'No cash refund for store credit tender',
   items:[{productId:id,qty:1,unitPrice:10}]
  });
  assert.equal(cashRefund.status,409,JSON.stringify(cashRefund));
  assert.equal(row('SELECT COUNT(*) n FROM sales_returns WHERE invoice_id=?',saleId).n,0);
  assert.equal(row('SELECT COUNT(*) n FROM cash_book').n,books.cash);
  assert.equal(row("SELECT available_cents FROM customer_store_credit_balance WHERE customer_id='CR-CUSTOMER'").available_cents,1000);
  assert.equal(row('SELECT COUNT(*) n FROM audit_logs WHERE action=\'CREATE_SALE\' AND entity_id=?',saleId).n,1);
  // Two concurrent one-item checkouts cannot each spend the same last ৳10.
  const contenders=await Promise.all([
   api('POST','/api/pos/sales',{...saleInput,clientRequestId:'credit-race-checkout-0001',
     items:[{productId:id,qty:1,unitPrice:10}]}),
   api('POST','/api/pos/sales',{...saleInput,clientRequestId:'credit-race-checkout-0002',
     items:[{productId:id,qty:1,unitPrice:10}]})
  ]);
  assert.equal(contenders.filter(x=>x.ok===true).length,1,JSON.stringify(contenders));
  assert.equal(contenders.filter(x=>x.status===409).length,1,JSON.stringify(contenders));
  assert.equal(row("SELECT available_cents FROM customer_store_credit_balance WHERE customer_id='CR-CUSTOMER'").available_cents,0);
  assert.equal(row("SELECT COUNT(*) n FROM customer_store_credit_entries WHERE entry_type='REDEEM'").n,2);
  assert.equal(row('SELECT COUNT(*) n FROM cash_book').n,books.cash);
  assert.equal(row('SELECT COUNT(*) n FROM bank_book').n,books.bank);
  // No manual ledger edit/replay can steal the last credit.
  assert.throws(()=>db.native.prepare(
   "INSERT INTO customer_store_credit_entries "+
   "(entry_id,customer_id,entry_type,source_type,source_id,delta_cents,balance_after_cents,created_by) "+
   "VALUES ('FAKE-REDEEM','CR-CUSTOMER','REDEEM','Sale',?,-2000,-1000,'forged')"
  ).run(saleId),/CHECK constraint failed|STORE_CREDIT_LEDGER_CONFLICT/);
 }finally{db.close();}
});
