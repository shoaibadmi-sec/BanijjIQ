import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

test('full mixed-unit invoice reversal is atomic, audited, FIFO-correct and cannot be duplicated',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));let token='';
  async function api(method:string,path:string,body?:unknown){
   const headers:Record<string,string>={'content-type':'application/json'};
   if(token)headers.authorization='Bearer '+token;
   const response=await handleApiRequest(new Request('http://reverse.test'+path,{
     method,headers,body:body===undefined?undefined:JSON.stringify(body)}),db);
   return {status:response.status,...await response.json() as any};
  }
  const row=(query:string,...params:unknown[])=>db.native.prepare(query).get(...params) as any;
  const rows=(query:string,...params:unknown[])=>db.native.prepare(query).all(...params) as any[];
  const setup=await api('POST','/api/setup/admin',{fullName:'Reversal Accountant',
    phone:'01000008155',password:'ReversalTesting2026!'});
  assert.equal(setup.ok,true,JSON.stringify(setup));token=setup.token;
  const product=await api('POST','/api/products',{productName:'Reversal Carton Cable',
    category:'Electrical',unit:'Pcs',purchasePrice:5,sellingPrice:10,currentStock:100,
    minimumStock:0,trackSerial:false,trackExpiry:false,trackWarranty:false,status:'Active'});
  assert.equal(product.ok,true,JSON.stringify(product));
  const id=product.productId;
  const opening=row('SELECT lot_id FROM stock_lots WHERE product_id=?',id).lot_id;
  db.native.prepare(
    "INSERT INTO stock_lots (lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost,status) VALUES (?,?,'PURCHASE','REVERSAL',300,300,7,'Active')"
  ).run('REVERSAL-LOT-2',id);
  db.native.prepare('UPDATE products SET current_stock=400 WHERE product_id=?').run(id);
  const chain=[{unit:'Carton',symbol:'CT',containsNext:12,sellingPrice:2100},
    {unit:'Box',symbol:'BOX',containsNext:20,sellingPrice:180},
    {unit:'Pcs',symbol:'PCS',sellingPrice:10}];
  assert.equal((await api('PUT','/api/products/'+id+'/unit-profile',
    {expectedRevision:0,units:chain})).ok,true);
  assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:0})).ok,true);
  const sale=await api('POST','/api/pos/sales',{
    clientRequestId:'unit-reverse-sale-2026-0001',customerName:'Original Buyer',customerPhone:'01000008156',
    paymentType:'Cash',paymentMethod:'Cash',discount:0,
    items:[{productId:id,name:'Reversal Carton Cable',qty:283,unitPrice:0,
      unitQuantities:{Carton:1,Box:2,Pcs:3},unitProfileRevision:1,fulfillmentMode:'own'}]});
  assert.equal(sale.ok,true,JSON.stringify(sale));
  const inv=sale.invoice.invoiceId;
  assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,117);
  const prior=await api('GET','/api/sales-management/'+inv+'/reverse');
  assert.equal(prior.ok,true,JSON.stringify(prior));
  assert.equal(prior.preview.eligible,true,JSON.stringify(prior));
  assert.equal(prior.preview.refundAmount,2490);
  assert.deepEqual(prior.preview.items[0].unitQuantities,{Carton:1,Box:2,Pcs:3});
  const bad=await api('POST','/api/sales-management/'+inv+'/reverse',{reason:'short'});
  assert.equal(bad.ok,false);
  assert.equal(row('SELECT count(*) n FROM sales_returns').n,0);
  const result=await api('POST','/api/sales-management/'+inv+'/reverse',{
    reason:'Customer requested full invoice cancellation'});
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.totalReturnAmount,2490);
  assert.equal(row('SELECT status FROM sales WHERE invoice_id=?',inv).status,'Reversed');
  assert.equal(row('SELECT is_deleted FROM sales WHERE invoice_id=?',inv).is_deleted,0);
  assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,400);
  assert.equal(row('SELECT remaining_quantity FROM stock_lots WHERE lot_id=?',opening).remaining_quantity,100);
  assert.equal(row('SELECT remaining_quantity FROM stock_lots WHERE lot_id=?','REVERSAL-LOT-2').remaining_quantity,300);
  assert.equal(row('SELECT SUM(credit)-SUM(debit) net FROM cash_book WHERE is_deleted=0 AND type IN (\'Sale\',\'Sales Return\')').net,0);
  assert.equal(row('SELECT count(*) n FROM sales_returns WHERE invoice_id=?',inv).n,1);
  assert.equal(row('SELECT count(*) n FROM sale_reversal_logs WHERE invoice_id=?',inv).n,1);
  assert.equal(row('SELECT refund_amount_cents FROM sale_reversal_logs WHERE invoice_id=?',inv).refund_amount_cents,249000);
  assert.equal(row('SELECT count(*) n FROM sales_return_item_units WHERE invoice_id=?',inv).n,1);
  const saved=(await api('GET','/api/pos/invoices/'+inv)).invoice;
  assert.equal(saved.items[0].unitDescription,'1 CT 2 BOX 3 PCS');
  assert.equal(saved.items[0].unitSnapshot.profile.units[1].sellingPrice,180);
  assert.equal(row("SELECT count(*) n FROM audit_logs WHERE action='REVERSE_MIXED_SALE' AND entity_id=?",inv).n,1);
  const after={cash:row("SELECT count(*) n FROM cash_book WHERE type='Sales Return'").n,
    stock:row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,
    logs:row('SELECT count(*) n FROM sale_reversal_logs').n};
  const retry=await api('POST','/api/sales-management/'+inv+'/reverse',{
    reason:'Customer requested full invoice cancellation'});
  assert.equal(retry.status,409);
  assert.equal((await api('GET','/api/sales-management/'+inv+'/reverse')).preview.eligible,false);
  assert.equal((await api('POST','/api/sales-returns',{
    invoiceId:inv,refundMethod:'Cash',reason:'Second attempt',
    items:[{productId:id,qty:1,unitPrice:10,unitQuantities:{Pcs:1}}]
  })).status,409);
  assert.equal((await api('PUT','/api/sales-management/'+inv,{
    reason:'Attempt to alter reversed invoice',items:[] })).status,409);
  assert.equal(row("SELECT count(*) n FROM cash_book WHERE type='Sales Return'").n,after.cash);
  assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,after.stock);
  assert.equal(row('SELECT count(*) n FROM sale_reversal_logs').n,after.logs);
  assert.deepEqual(rows('SELECT lot_id,SUM(quantity) q FROM sales_return_item_lots WHERE invoice_id=? GROUP BY lot_id',inv)
    .map(x=>[x.lot_id,x.q]).sort(),[[opening,100],['REVERSAL-LOT-2',183]].sort());

  // A previously partly returned invoice must NOT be fully reversed again.
  const second=await api('POST','/api/pos/sales',{
    clientRequestId:'unit-reverse-sale-2026-0002',customerName:'Second Buyer',customerPhone:'01000008157',
    paymentType:'Cash',paymentMethod:'Cash',discount:0,
    items:[{productId:id,name:'Reversal Carton Cable',qty:20,unitPrice:0,
      unitQuantities:{Box:1},unitProfileRevision:1,fulfillmentMode:'own'}]});
  assert.equal(second.ok,true,JSON.stringify(second));
  const nextId=second.invoice.invoiceId;
  const partial=await api('POST','/api/sales-returns',{
    invoiceId:nextId,refundMethod:'Cash',reason:'One piece defective',
    items:[{productId:id,qty:20,unitPrice:0,unitQuantities:{Box:1}}]});
  assert.equal(partial.ok,true,JSON.stringify(partial));
  const notEligible=await api('GET','/api/sales-management/'+nextId+'/reverse');
  assert.equal(notEligible.preview.eligible,false);
  assert.match(notEligible.preview.reason,/partial return/i);
  assert.equal((await api('POST','/api/sales-management/'+nextId+'/reverse',
    {reason:'Cannot reverse after prior return'})).status,409);
  assert.equal(row('SELECT status FROM sales WHERE invoice_id=?',nextId).status,'Completed');
 }finally{db.close();}
});
