import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

for(const method of ['Bank','Mobile Banking'] as const){
 test('mixed-unit '+method+' full reversal refunds original account once with net-zero ledger and FIFO',async()=>{
  const db=new SqliteDatabase(':memory:');
  try{
   runMigrations(db.native,resolve('migrations'));
   let token='';
   async function api(verb:string,path:string,body?:unknown){
    const headers:Record<string,string>={'content-type':'application/json'};
    if(token)headers.authorization='Bearer '+token;
    const response=await handleApiRequest(new Request('http://bank-reversal.test'+path,{
      method:verb,headers,body:body===undefined?undefined:JSON.stringify(body)
    }),db);
    return {status:response.status,...await response.json() as any};
   }
   const row=(sql:string,...args:unknown[])=>db.native.prepare(sql).get(...args) as any;
   const rows=(sql:string,...args:unknown[])=>db.native.prepare(sql).all(...args) as any[];
   const admin=await api('POST','/api/setup/admin',{
     fullName:'Bank Reversal Tester',phone:method==='Bank'?'01000007201':'01000007202',
     password:'Phase3FBank2026!'
   });
   assert.equal(admin.ok,true,JSON.stringify(admin));token=admin.token;
   assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:0})).ok,true);
   const bank=await api('POST','/api/bank/accounts',{
     name:method==='Bank'?'Test Current Bank':'Test Mobile Wallet',
     accountType:method,openingBalance:5000
   });
   assert.equal(bank.ok,true,JSON.stringify(bank));
   const bankId=bank.id;
   assert.equal(row('SELECT current_balance FROM bank_accounts WHERE bank_account_id=?',bankId).current_balance,5000);
   const product=await api('POST','/api/products',{
     productName:'Phase3F Unit Cable',category:'Electrical',unit:'Pcs',
     purchasePrice:5,sellingPrice:10,currentStock:100,minimumStock:0,
     trackSerial:false,trackExpiry:false,trackWarranty:false,status:'Active'
   });
   assert.equal(product.ok,true,JSON.stringify(product));
   const id=product.productId;
   const lot1=row('SELECT lot_id FROM stock_lots WHERE product_id=?',id).lot_id;
   db.native.prepare("INSERT INTO stock_lots (lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost,status) VALUES (?,?, 'PURCHASE','PHASE3F',300,300,7,'Active')")
     .run('PHASE3F-LOT-2',id);
   db.native.prepare('UPDATE products SET current_stock=400 WHERE product_id=?').run(id);
   const chain=[{unit:'Carton',symbol:'CT',containsNext:12,sellingPrice:2100},
     {unit:'Box',symbol:'BOX',containsNext:20,sellingPrice:180},
     {unit:'Pcs',symbol:'PCS',sellingPrice:10}];
   assert.equal((await api('PUT','/api/products/'+id+'/unit-profile',{
     expectedRevision:0,units:chain
   })).ok,true);
   const sale=await api('POST','/api/pos/sales',{
     clientRequestId:method==='Bank'?'phase3f-bank-sale-001':'phase3f-mobile-sale-001',
     customerName:'Bank Refund Buyer',customerPhone:'01000007215',
     paymentType:'Cash',paymentMethod:method,bankAccountId:bankId,discount:0,
     items:[{productId:id,name:'Phase3F Unit Cable',qty:283,unitPrice:0,
       unitQuantities:{Carton:1,Box:2,Pcs:3},unitProfileRevision:1,
       fulfillmentMode:'own'}]
   });
   assert.equal(sale.ok,true,JSON.stringify(sale));
   const invoiceId=sale.invoice.invoiceId;
   assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,117);
   assert.equal(row('SELECT current_balance FROM bank_accounts WHERE bank_account_id=?',bankId).current_balance,7490);
   const entry=row("SELECT bank_account_id,bank_account_name,credit,debit,balance FROM bank_book WHERE type='Sale' AND reference=?",invoiceId);
   assert.equal(entry.bank_account_id,bankId);
   assert.equal(entry.credit,2490);assert.equal(entry.debit,0);assert.equal(entry.balance,7490);
   assert.equal(row("SELECT COALESCE(SUM(credit),0) n FROM cash_book WHERE type='Sale' AND reference=?",invoiceId).n,0);
   const preview=await api('GET','/api/sales-management/'+invoiceId+'/reverse');
   assert.equal(preview.ok,true,JSON.stringify(preview));
   assert.equal(preview.preview.eligible,true,JSON.stringify(preview));
   assert.equal(preview.preview.refundMethod,method);
   assert.equal(preview.preview.refundBankAccountId,bankId);
   assert.equal(preview.preview.refundAmount,2490);
   // Normal returns may never secretly route arbitrary bank details to the bank book.
   const unsupported=await api('POST','/api/sales-returns',{
     invoiceId,refundMethod:method,bankAccountId:bankId,reason:'Bypass audited reversal',
     items:[{productId:id,qty:20,unitPrice:0,unitQuantities:{Box:1}}]
   });
   assert.equal(unsupported.status,409,JSON.stringify(unsupported));
   const mismatched=await api('POST','/api/sales-management/'+invoiceId+'/reverse',{reason:'short'});
   assert.equal(mismatched.ok,false);
   const reversed=await api('POST','/api/sales-management/'+invoiceId+'/reverse',{
     reason:'Customer requested complete cancellation and bank refund'
   });
   assert.equal(reversed.ok,true,JSON.stringify(reversed));
   assert.equal(reversed.totalReturnAmount,2490);
   assert.equal(row('SELECT current_balance FROM bank_accounts WHERE bank_account_id=?',bankId).current_balance,5000);
   assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,400);
   assert.equal(row('SELECT remaining_quantity FROM stock_lots WHERE lot_id=?',lot1).remaining_quantity,100);
   assert.equal(row("SELECT remaining_quantity FROM stock_lots WHERE lot_id='PHASE3F-LOT-2'").remaining_quantity,300);
   const bankHistory=rows("SELECT reference,type,debit,credit,balance,bank_account_id FROM bank_book WHERE reference IN (?,?) ORDER BY type",invoiceId,reversed.returnId);
   assert.equal(bankHistory.length,2);
   assert.equal(bankHistory.reduce((n,r)=>n+r.credit-r.debit,0),0);
   const refundEntry=bankHistory.find(r=>r.type==='Sales Return');
   assert.equal(refundEntry.debit,2490);
   assert.equal(refundEntry.balance,5000);
   assert.equal(refundEntry.bank_account_id,bankId);
   const savedReturn=row('SELECT refund_method,refund_bank_account_id FROM sales_returns WHERE return_id=?',reversed.returnId);
   assert.equal(savedReturn.refund_method,method);
   assert.equal(savedReturn.refund_bank_account_id,bankId);
   const journal=row('SELECT refund_method,refund_bank_account_id,refund_amount_cents FROM sale_reversal_logs WHERE invoice_id=?',invoiceId);
   assert.equal(journal.refund_method,method);
   assert.equal(journal.refund_bank_account_id,bankId);
   assert.equal(journal.refund_amount_cents,249000);
   assert.equal(row('SELECT status FROM sales WHERE invoice_id=?',invoiceId).status,'Reversed');
   assert.equal((await api('POST','/api/sales-management/'+invoiceId+'/reverse',{
     reason:'Do not refund the same invoice a second time'
   })).status,409);
   assert.equal(row("SELECT COUNT(*) n FROM bank_book WHERE reference=? AND type='Sales Return'",reversed.returnId).n,1);
   assert.equal(row('SELECT COUNT(*) n FROM sales_return_item_lots WHERE invoice_id=?',invoiceId).n,2);
   assert.equal(row('SELECT current_balance FROM bank_accounts WHERE bank_account_id=?',bankId).current_balance,5000);
  }finally{db.close();}
 });
}

test('unreconciled original bank balance and disabled bank account are ineligible for reversal',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));let token='';
  async function api(verb:string,path:string,body?:unknown){
   const headers:Record<string,string>={'content-type':'application/json'};
   if(token)headers.authorization='Bearer '+token;
   const response=await handleApiRequest(new Request('http://bank-deny.test'+path,{
     method:verb,headers,body:body===undefined?undefined:JSON.stringify(body)
   }),db);
   return {status:response.status,...await response.json() as any};
  }
  const row=(sql:string,...args:unknown[])=>db.native.prepare(sql).get(...args) as any;
  const admin=await api('POST','/api/setup/admin',{fullName:'Bank Drift Tester',phone:'01000007211',password:'BankDrift2026!'});
  assert.equal(admin.ok,true,JSON.stringify(admin));token=admin.token;
  await api('POST','/api/pos/cash-session/start',{openingCash:0});
  const bank=await api('POST','/api/bank/accounts',{name:'Drift Bank',accountType:'Bank',openingBalance:0});
  assert.equal(bank.ok,true,JSON.stringify(bank));
  const p=await api('POST','/api/products',{productName:'Drift Wire',category:'Electrical',unit:'Pcs',
    purchasePrice:5,sellingPrice:10,currentStock:30,minimumStock:0,
    trackSerial:false,trackExpiry:false,trackWarranty:false,status:'Active'});
  assert.equal(p.ok,true,JSON.stringify(p));
  await api('PUT','/api/products/'+p.productId+'/unit-profile',{expectedRevision:0,units:[
    {unit:'Box',symbol:'BOX',containsNext:20,sellingPrice:180},{unit:'Pcs',symbol:'PCS',sellingPrice:10}
  ]});
  const sale=await api('POST','/api/pos/sales',{
    clientRequestId:'phase3f-bank-drift-001',customerName:'Drift Buyer',customerPhone:'01000007218',
    paymentType:'Cash',paymentMethod:'Bank',bankAccountId:bank.id,discount:0,
    items:[{productId:p.productId,name:'Drift Wire',qty:20,unitPrice:0,
      unitQuantities:{Box:1},unitProfileRevision:1,fulfillmentMode:'own'}]
  });
  assert.equal(sale.ok,true,JSON.stringify(sale));const invoiceId=sale.invoice.invoiceId;
  db.native.prepare('UPDATE bank_accounts SET current_balance=current_balance+1 WHERE bank_account_id=?').run(bank.id);
  const blocked=await api('GET','/api/sales-management/'+invoiceId+'/reverse');
  assert.equal(blocked.preview.eligible,false);
  assert.match(blocked.preview.reason,/balance differs/i);
  assert.equal((await api('POST','/api/sales-management/'+invoiceId+'/reverse',{reason:'Attempt refund despite balance mismatch'})).status,409);
  assert.equal(row('SELECT status FROM sales WHERE invoice_id=?',invoiceId).status,'Completed');
  assert.equal(row('SELECT COUNT(*) n FROM sales_returns WHERE invoice_id=?',invoiceId).n,0);
  db.native.prepare("UPDATE bank_accounts SET status='Inactive' WHERE bank_account_id=?").run(bank.id);
  const inactive=await api('GET','/api/sales-management/'+invoiceId+'/reverse');
  assert.equal(inactive.preview.eligible,false);
  assert.match(inactive.preview.reason,/inactive/);
 }finally{db.close();}
});
