import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

test('Phase 3G2 cash-funded mixed-unit returns issue separate atomic customer liability without spending cash',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));
  let token='';
  async function api(method:string,path:string,body?:unknown){
   const headers:Record<string,string>={'content-type':'application/json'};
   if(token)headers.authorization='Bearer '+token;
   const response=await handleApiRequest(new Request('http://store-credit.test'+path,{
     method,headers,body:body===undefined?undefined:JSON.stringify(body)
   }),db);
   return {status:response.status,...await response.json() as any};
  }
  const row=(sql:string,...args:unknown[])=>db.native.prepare(sql).get(...args) as any;
  const rows=(sql:string,...args:unknown[])=>db.native.prepare(sql).all(...args) as any[];
  const admin=await api('POST','/api/setup/admin',{
   fullName:'Store Credit Accounting',phone:'01000009501',password:'StoreCredit3G2Pass2026!'
  });
  assert.equal(admin.ok,true,JSON.stringify(admin));token=admin.token;
  assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:0})).ok,true);
  db.native.prepare(
   "INSERT INTO customers (customer_id,customer_name,phone,current_due,status,is_deleted) "+
   "VALUES ('CREDIT-LINKED','Credit Customer','01000009502',0,'Active',0)"
  ).run();
  const product=await api('POST','/api/products',{
   productName:'G2 Box Cable',category:'Electrical',unit:'Pcs',purchasePrice:5,
   sellingPrice:10,currentStock:100,minimumStock:0,trackSerial:false,
   trackExpiry:false,trackWarranty:false,status:'Active'
  });
  assert.equal(product.ok,true,JSON.stringify(product));
  const productId=product.productId;
  assert.equal((await api('PUT','/api/products/'+productId+'/unit-profile',{expectedRevision:0,units:[
   {unit:'Box',symbol:'BOX',containsNext:20,sellingPrice:180},
   {unit:'Pcs',symbol:'PCS',sellingPrice:10}
  ]})).ok,true);
  const sale=await api('POST','/api/pos/sales',{
   clientRequestId:'phase3g2-paid-sale-0001',customerId:'CREDIT-LINKED',
   customerName:'Credit Customer',customerPhone:'01000009502',
   paymentType:'Cash',paymentMethod:'Cash',discount:0,items:[
    {productId,name:'G2 Box Cable',qty:23,unitPrice:0,
     unitQuantities:{Box:1,Pcs:3},unitProfileRevision:1,fulfillmentMode:'own'}
   ]
  });
  assert.equal(sale.ok,true,JSON.stringify(sale));
  const id=sale.invoice.invoiceId;
  assert.equal(row('SELECT customer_id FROM sales WHERE invoice_id=?',id).customer_id,'CREDIT-LINKED');
  assert.equal(row('SELECT grand_total FROM sales WHERE invoice_id=?',id).grand_total,210);
  assert.equal(row("SELECT COUNT(*) n FROM customer_ledger WHERE customer_id='CREDIT-LINKED'").n,0);
  assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',productId).current_stock,77);
  const before={
   cash:row('SELECT COUNT(*) n FROM cash_book').n,
   bank:row('SELECT COUNT(*) n FROM bank_book').n,
   balance:row('SELECT current_due FROM customers WHERE customer_id=?','CREDIT-LINKED').current_due
  };
  const invalid=await api('POST','/api/sales-returns',{
   invoiceId:id,refundMethod:'Store Credit',reason:'Pcs denomination not available',
   items:[{productId,qty:4,unitPrice:0,unitQuantities:{Pcs:4}}]
  });
  assert.equal(invalid.status,409,JSON.stringify(invalid));
  assert.equal(row('SELECT COUNT(*) n FROM sales_returns').n,0);
  assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',productId).current_stock,77);

  // Force the last audit write to fail after the return, FIFO restoration and
  // liability issuance have been queued. D1/SQLite batches must roll back all
  // earlier statements instead of leaving spendable orphan credit or stock.
  db.native.exec(
   "CREATE TRIGGER reject_credit_return_audit BEFORE INSERT ON audit_logs "+
   "WHEN NEW.action='CREATE_SALES_RETURN' BEGIN "+
   "SELECT RAISE(ABORT,'SIMULATED_AUDIT_WRITE_FAILURE'); END"
  );
  const rolledBack=await api('POST','/api/sales-returns',{
   invoiceId:id,refundMethod:'Store Credit',reason:'Three pieces returned for credit',
   items:[{productId,qty:3,unitPrice:0,unitQuantities:{Pcs:3}}]
  });
  assert.equal(rolledBack.status,500,JSON.stringify(rolledBack));
  assert.match(String(rolledBack.error),/SIMULATED_AUDIT_WRITE_FAILURE/);
  assert.equal(row('SELECT COUNT(*) n FROM sales_returns').n,0);
  assert.equal(row('SELECT COUNT(*) n FROM sales_return_items').n,0);
  assert.equal(row('SELECT COUNT(*) n FROM customer_store_credit_entries').n,0);
  assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',productId).current_stock,77);
  assert.equal(row('SELECT COUNT(*) n FROM cash_book').n,before.cash);
  assert.equal(row('SELECT COUNT(*) n FROM bank_book').n,before.bank);
  assert.equal(row('SELECT current_due FROM customers WHERE customer_id=?','CREDIT-LINKED').current_due,before.balance);
  assert.equal(row("SELECT COUNT(*) n FROM audit_logs WHERE action='CREATE_SALES_RETURN'").n,0);
  db.native.exec('DROP TRIGGER reject_credit_return_audit');

  const creditOne=await api('POST','/api/sales-returns',{
   invoiceId:id,refundMethod:'Store Credit',reason:'Three pieces returned for credit',
   items:[{productId,qty:3,unitPrice:0,unitQuantities:{Pcs:3}}]
  });
  assert.equal(creditOne.ok,true,JSON.stringify(creditOne));
  assert.equal(creditOne.totalReturnAmount,30);
  assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',productId).current_stock,80);
  assert.deepEqual(rows(
   "SELECT delta_cents,balance_after_cents FROM customer_store_credit_entries ORDER BY rowid"
  ).map(x=>[x.delta_cents,x.balance_after_cents]),[[3000,3000]]);
  assert.equal(row('SELECT COUNT(*) n FROM store_credit_legacy_unreconciled').n,0);
  assert.equal(row('SELECT current_due FROM customers WHERE customer_id=?','CREDIT-LINKED').current_due,before.balance);
  assert.equal(row('SELECT COUNT(*) n FROM cash_book').n,before.cash);
  assert.equal(row('SELECT COUNT(*) n FROM bank_book').n,before.bank);
  assert.equal(row("SELECT COUNT(*) n FROM customer_ledger WHERE customer_id='CREDIT-LINKED'").n,0);

  const creditTwo=await api('POST','/api/sales-returns',{
   invoiceId:id,refundMethod:'Store Credit',reason:'Remaining box returned for credit',
   items:[{productId,qty:20,unitPrice:0,unitQuantities:{Box:1}}]
  });
  assert.equal(creditTwo.ok,true,JSON.stringify(creditTwo));
  assert.equal(creditTwo.totalReturnAmount,180);
  assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',productId).current_stock,100);
  assert.deepEqual(rows(
   "SELECT delta_cents,balance_after_cents FROM customer_store_credit_entries ORDER BY rowid"
  ).map(x=>[x.delta_cents,x.balance_after_cents]),[[3000,3000],[18000,21000]]);
  assert.equal(row("SELECT available_cents FROM customer_store_credit_balance WHERE customer_id='CREDIT-LINKED'").available_cents,21000);
  assert.equal(row("SELECT COUNT(*) n FROM customer_ledger WHERE customer_id='CREDIT-LINKED'").n,0);
  assert.equal(row('SELECT COUNT(*) n FROM cash_book').n,before.cash);
  assert.equal(row('SELECT COUNT(*) n FROM bank_book').n,before.bank);
  assert.equal(row('SELECT COUNT(*) n FROM sales_returns').n,2);
  assert.equal(row('SELECT COUNT(*) n FROM audit_logs WHERE action=\'CREATE_SALES_RETURN\'').n,2);
  const replay=await api('POST','/api/sales-returns',{
   invoiceId:id,refundMethod:'Store Credit',reason:'Repeat already returned box',
   items:[{productId,qty:20,unitPrice:0,unitQuantities:{Box:1}}]
  });
  assert.equal(replay.status,400,JSON.stringify(replay));
  assert.equal(row('SELECT COUNT(*) n FROM customer_store_credit_entries').n,2);
  assert.equal(row('SELECT COUNT(*) n FROM sales_returns').n,2);
  assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',productId).current_stock,100);
  assert.equal((await api('GET','/api/sales-management/'+id+'/reverse')).preview.eligible,false);
 }finally{db.close();}
});

test('Phase 3G2 refuses Store Credit for an unlinked cash buyer without creating orphan customer',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));let token='';
  async function api(method:string,path:string,body?:unknown){
   const headers:Record<string,string>={'content-type':'application/json'};
   if(token)headers.authorization='Bearer '+token;
   const response=await handleApiRequest(new Request('http://store-credit.test'+path,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body)}),db);
   return {status:response.status,...await response.json() as any};
  }
  const user=await api('POST','/api/setup/admin',{fullName:'No Credit Account',
   phone:'01000009503',password:'StoreCredit3G2Pass2026!'});
  assert.equal(user.ok,true);token=user.token;
  assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:0})).ok,true);
  const product=await api('POST','/api/products',{productName:'Cash Only Item',
   category:'Electrical',unit:'Pcs',purchasePrice:5,sellingPrice:10,
   currentStock:10,minimumStock:0,status:'Active'});
  assert.equal(product.ok,true,JSON.stringify(product));
  const sale=await api('POST','/api/pos/sales',{
   customerName:'Anonymous Buyer',customerPhone:'01000009504',
   paymentType:'Cash',paymentMethod:'Cash',
   items:[{productId:product.productId,qty:1,unitPrice:10}]
  });
  assert.equal(sale.ok,true,JSON.stringify(sale));
  const posted=await api('POST','/api/sales-returns',{
   invoiceId:sale.invoice.invoiceId,refundMethod:'Store Credit',
   reason:'Must link a real customer first',
   items:[{productId:product.productId,qty:1,unitPrice:10}]
  });
  assert.equal(posted.status,409,JSON.stringify(posted));
  assert.equal((db.native.prepare('SELECT COUNT(*) n FROM customers').get() as any).n,0);
  assert.equal((db.native.prepare('SELECT COUNT(*) n FROM sales_returns').get() as any).n,0);
  assert.equal((db.native.prepare('SELECT COUNT(*) n FROM customer_store_credit_entries').get() as any).n,0);
 }finally{db.close();}
});
