import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

test('mixed-unit fully-unpaid due reversal cancels receivable without spending cash/bank or duplicating FIFO',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));
  let token='';
  async function api(method:string,path:string,body?:unknown){
   const headers:Record<string,string>={'content-type':'application/json'};
   if(token)headers.authorization='Bearer '+token;
   const response=await handleApiRequest(new Request('http://due-reversal.test'+path,{
     method,headers,body:body===undefined?undefined:JSON.stringify(body)
   }),db);
   return {status:response.status,...await response.json() as any};
  }
  const row=(sql:string,...params:unknown[])=>db.native.prepare(sql).get(...params) as any;
  const rows=(sql:string,...params:unknown[])=>db.native.prepare(sql).all(...params) as any[];
  const admin=await api('POST','/api/setup/admin',{
    fullName:'Due Reversal Tester',phone:'01000008611',password:'DueReversal3G2026!'
  });
  assert.equal(admin.ok,true,JSON.stringify(admin));token=admin.token;
  assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:0})).ok,true);
  const product=await api('POST','/api/products',{
    productName:'Due Mixed Cable',category:'Electrical',unit:'Pcs',
    purchasePrice:5,sellingPrice:10,currentStock:100,minimumStock:0,
    trackSerial:false,trackExpiry:false,trackWarranty:false,status:'Active'
  });
  assert.equal(product.ok,true,JSON.stringify(product));
  const id=product.productId;
  const initialLot=row('SELECT lot_id FROM stock_lots WHERE product_id=?',id).lot_id;
  db.native.prepare(
    "INSERT INTO stock_lots (lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost,status) VALUES (?,?,'PURCHASE','PHASE3G',300,300,7,'Active')"
  ).run('PHASE3G-LOT2',id);
  db.native.prepare('UPDATE products SET current_stock=400 WHERE product_id=?').run(id);
  assert.equal((await api('PUT','/api/products/'+id+'/unit-profile',{expectedRevision:0,units:[
    {unit:'Carton',symbol:'CT',containsNext:12,sellingPrice:2100},
    {unit:'Box',symbol:'BOX',containsNext:20,sellingPrice:180},
    {unit:'Pcs',symbol:'PCS',sellingPrice:10}
  ]})).ok,true);
  const sale=await api('POST','/api/pos/sales',{
    clientRequestId:'phase3g-unpaid-original-001',customerName:'Only Due Buyer',
    customerPhone:'01000008617',paymentType:'Due',paymentMethod:'',
    discount:0,items:[{productId:id,name:'Due Mixed Cable',qty:283,unitPrice:0,
      unitQuantities:{Carton:1,Box:2,Pcs:3},unitProfileRevision:1,fulfillmentMode:'own'}]
  });
  assert.equal(sale.ok,true,JSON.stringify(sale));
  const inv=sale.invoice.invoiceId;
  const original=row('SELECT customer_id,grand_total,paid_amount,due_amount,payment_type,payment_method FROM sales WHERE invoice_id=?',inv);
  const cid=original.customer_id;
  assert.ok(cid);
  assert.equal(original.grand_total,2490);
  assert.equal(original.paid_amount,0);
  assert.equal(original.due_amount,2490);
  assert.equal(row('SELECT current_due FROM customers WHERE customer_id=?',cid).current_due,2490);
  assert.equal(row('SELECT COUNT(*) n FROM customer_ledger WHERE customer_id=?',cid).n,1);
  assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,117);
  const before={cash:row('SELECT COUNT(*) n FROM cash_book').n,bank:row('SELECT COUNT(*) n FROM bank_book').n};
  const preview=await api('GET','/api/sales-management/'+inv+'/reverse');
  assert.equal(preview.ok,true,JSON.stringify(preview));
  assert.equal(preview.preview.eligible,true,JSON.stringify(preview));
  assert.equal(preview.preview.refundMethod,'Due Adjustment');
  assert.equal(preview.preview.refundAmount,2490);
  assert.equal(preview.preview.customerDueBefore,2490);
  assert.equal(preview.preview.refundBankAccountId,'');
  const direct=await api('POST','/api/sales-returns',{
    invoiceId:inv,refundMethod:'Due Adjustment',reason:'Do not bypass the audited due cancellation',
    items:[{productId:id,qty:283,unitPrice:0,unitQuantities:{Carton:1,Box:2,Pcs:3}}]
  });
  assert.equal(direct.status,409);
  assert.equal(row('SELECT COUNT(*) n FROM sales_returns').n,0);
  const bad=await api('POST','/api/sales-management/'+inv+'/reverse',{reason:'short'});
  assert.equal(bad.ok,false);
  const reversed=await api('POST','/api/sales-management/'+inv+'/reverse',{
    reason:'Customer cancelled the unpaid invoice in full'
  });
  assert.equal(reversed.ok,true,JSON.stringify(reversed));
  assert.equal(reversed.totalReturnAmount,2490);
  assert.equal(row('SELECT status FROM sales WHERE invoice_id=?',inv).status,'Reversed');
  assert.equal(row('SELECT current_due FROM customers WHERE customer_id=?',cid).current_due,0);
  assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,400);
  assert.equal(row('SELECT remaining_quantity FROM stock_lots WHERE lot_id=?',initialLot).remaining_quantity,100);
  assert.equal(row("SELECT remaining_quantity FROM stock_lots WHERE lot_id='PHASE3G-LOT2'").remaining_quantity,300);
  assert.equal(row('SELECT COUNT(*) n FROM cash_book').n,before.cash);
  assert.equal(row('SELECT COUNT(*) n FROM bank_book').n,before.bank);
  const ledger=rows('SELECT type,reference,debit,credit,balance FROM customer_ledger WHERE customer_id=? ORDER BY rowid',cid);
  assert.equal(ledger.length,2);
  assert.equal(ledger[0].type,'Sale');assert.equal(ledger[0].reference,inv);
  assert.equal(ledger[0].debit,2490);assert.equal(ledger[0].balance,2490);
  assert.equal(ledger[1].type,'Sale Reversal');assert.equal(ledger[1].reference,reversed.returnId);
  assert.equal(ledger[1].credit,2490);assert.equal(ledger[1].debit,0);assert.equal(ledger[1].balance,0);
  const record=row('SELECT refund_method,refund_bank_account_id FROM sales_returns WHERE return_id=?',reversed.returnId);
  assert.equal(record.refund_method,'Due Adjustment');assert.equal(record.refund_bank_account_id,'');
  const audit=row('SELECT refund_method,refund_amount_cents FROM sale_reversal_logs WHERE invoice_id=?',inv);
  assert.equal(audit.refund_method,'Due Adjustment');assert.equal(audit.refund_amount_cents,249000);
  const saved=(await api('GET','/api/pos/invoices/'+inv)).invoice;
  assert.equal(saved.items[0].unitDescription,'1 CT 2 BOX 3 PCS');
  assert.equal(saved.items[0].unitSnapshot.profile.units[0].sellingPrice,2100);
  const replay=await api('POST','/api/sales-management/'+inv+'/reverse',{
    reason:'Attempt to cancel the same unpaid invoice twice'
  });
  assert.equal(replay.status,409);
  assert.equal(row('SELECT COUNT(*) n FROM customer_ledger WHERE customer_id=?',cid).n,2);
  assert.equal(row('SELECT COUNT(*) n FROM sales_returns WHERE invoice_id=?',inv).n,1);
  assert.equal(row('SELECT COUNT(*) n FROM sale_reversal_logs WHERE invoice_id=?',inv).n,1);
  assert.equal(row('SELECT COUNT(*) n FROM cash_book').n,before.cash);
  assert.equal(row('SELECT COUNT(*) n FROM bank_book').n,before.bank);
  assert.deepEqual(rows('SELECT lot_id,SUM(quantity) q FROM sales_return_item_lots WHERE invoice_id=? GROUP BY lot_id',inv)
    .map(x=>[x.lot_id,x.q]).sort(),[[initialLot,100],['PHASE3G-LOT2',183]].sort());
 }finally{db.close();}
});

test('due reversal rejects customer payments, shared ledger histories and changed due balances',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));
  let token='';
  async function api(method:string,path:string,body?:unknown){
   const headers:Record<string,string>={'content-type':'application/json'};
   if(token)headers.authorization='Bearer '+token;
   const response=await handleApiRequest(new Request('http://due-guard.test'+path,{
     method,headers,body:body===undefined?undefined:JSON.stringify(body)
   }),db);
   return {status:response.status,...await response.json() as any};
  }
  const row=(sql:string,...params:unknown[])=>db.native.prepare(sql).get(...params) as any;
  const admin=await api('POST','/api/setup/admin',{fullName:'Due Guard Tester',phone:'01000008621',password:'DueGuard3G2026!'});
  assert.equal(admin.ok,true,JSON.stringify(admin));token=admin.token;
  await api('POST','/api/pos/cash-session/start',{openingCash:0});
  const p=await api('POST','/api/products',{productName:'Due Test Box',category:'Electrical',
    unit:'Pcs',purchasePrice:5,sellingPrice:10,currentStock:200,minimumStock:0,
    trackSerial:false,trackExpiry:false,trackWarranty:false,status:'Active'});
  assert.equal(p.ok,true,JSON.stringify(p));
  assert.equal((await api('PUT','/api/products/'+p.productId+'/unit-profile',{
    expectedRevision:0,units:[{unit:'Box',symbol:'BOX',containsNext:20,sellingPrice:180},
      {unit:'Pcs',symbol:'PCS',sellingPrice:10}]
  })).ok,true);
  async function makeSale(key:string,phone:string){
   return api('POST','/api/pos/sales',{
     clientRequestId:key,customerName:'Due Test Person',customerPhone:phone,
     paymentType:'Due',paymentMethod:'',discount:0,
     items:[{productId:p.productId,name:'Due Test Box',qty:20,unitPrice:0,
       unitQuantities:{Box:1},unitProfileRevision:1,fulfillmentMode:'own'}]
   });
  }
  const first=await makeSale('phase3g-shared-original-001','01000008626');
  assert.equal(first.ok,true,JSON.stringify(first));const inv=first.invoice.invoiceId;
  const cid=row('SELECT customer_id FROM sales WHERE invoice_id=?',inv).customer_id;
  const second=await makeSale('phase3g-shared-additional-002','01000008626');
  assert.equal(second.ok,true,JSON.stringify(second));
  assert.equal(row('SELECT current_due FROM customers WHERE customer_id=?',cid).current_due,360);
  const blocked=await api('GET','/api/sales-management/'+inv+'/reverse');
  assert.equal(blocked.preview.eligible,false);
  assert.match(blocked.preview.reason,/customer due|ledger/i);
  assert.equal((await api('POST','/api/sales-management/'+inv+'/reverse',{
    reason:'Attempt reversal with customer shared due activity'
  })).status,409);
  assert.equal(row('SELECT current_due FROM customers WHERE customer_id=?',cid).current_due,360);
  // A manipulated balance without any ledger adjustment is also rejected.
  const unique=await makeSale('phase3g-due-balance-003','01000008627');
  assert.equal(unique.ok,true,JSON.stringify(unique));const secondInv=unique.invoice.invoiceId;
  const otherCid=row('SELECT customer_id FROM sales WHERE invoice_id=?',secondInv).customer_id;
  db.native.prepare('UPDATE customers SET current_due=current_due-10 WHERE customer_id=?').run(otherCid);
  const changed=await api('GET','/api/sales-management/'+secondInv+'/reverse');
  assert.equal(changed.preview.eligible,false);
  assert.match(changed.preview.reason,/customer due/i);
  assert.equal((await api('POST','/api/sales-management/'+secondInv+'/reverse',{
    reason:'Attempt reversal after due balance was edited'
  })).status,409);
  assert.equal(row('SELECT COUNT(*) n FROM sale_reversal_logs').n,0);
 }finally{db.close();}
});
