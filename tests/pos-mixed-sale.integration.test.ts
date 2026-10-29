import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

test('mixed-unit POS posts base-unit FIFO and freezes historical unit prices atomically',async()=>{
 const db=new SqliteDatabase(':memory:');
 try {
  runMigrations(db.native,resolve('migrations'));
  let token='';
  async function api(method:string,path:string,body?:unknown){
   const headers:Record<string,string>={'content-type':'application/json'};
   if(token)headers.authorization='Bearer '+token;
   const response=await handleApiRequest(new Request('http://local.test'+path,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body)}),db);
   return {status:response.status,...(await response.json() as any)};
  }
  const row=(sql:string,...args:unknown[])=>db.native.prepare(sql).get(...args) as any;
  const all=(sql:string,...args:unknown[])=>db.native.prepare(sql).all(...args) as any[];
  const setup=await api('POST','/api/setup/admin',{
   fullName:'Unit Sale Test',phone:'01000009777',password:'UnitSaleTesting2026!'
  });
  assert.equal(setup.ok,true,JSON.stringify(setup));token=setup.token;
  const created=await api('POST','/api/products',{
   productName:'Test multicarton cable',category:'Electrical',unit:'Pcs',purchasePrice:5,
   sellingPrice:10,currentStock:100,minimumStock:1,status:'Active',
   trackSerial:false,trackExpiry:false,trackWarranty:false
  });
  assert.equal(created.ok,true,JSON.stringify(created));
  const id=created.productId;
  db.native.prepare("INSERT INTO stock_lots (lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost,status) VALUES (?,?,'PURCHASE','LATER',300,300,7,'Active')")
   .run('MIXED-LOT-2',id);
  db.native.prepare('UPDATE products SET current_stock=400 WHERE product_id=?').run(id);
  const chain=[
   {unit:'Carton',symbol:'CT',containsNext:12,sellingPrice:2100},
   {unit:'Box',symbol:'BOX',containsNext:20,sellingPrice:180},
   {unit:'Pcs',symbol:'PCS',sellingPrice:10}
  ];
  const profile=await api('PUT','/api/products/'+id+'/unit-profile',{expectedRevision:0,units:chain});
  assert.equal(profile.ok,true,JSON.stringify(profile));
  assert.equal(profile.revision,1);
  const live=await api('GET','/api/pos/bootstrap');
  assert.equal(live.products.find((p:any)=>p.id===id).unitProfilePreview.postingEnabled,true);
  assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:0})).ok,true);
  const payload={
   clientRequestId:'mixed-real-sale-request-0001',customerName:'Mixed Buyer',customerPhone:'01000009999',
   discount:0,paymentType:'Cash',paymentMethod:'Cash',
   items:[{productId:id,name:'Test multicarton cable',
     qty:283,unitPrice:0,unitQuantities:{Carton:1,Box:2,Pcs:3},unitProfileRevision:1,
     fulfillmentMode:'own'}]
  };
  const sale=await api('POST','/api/pos/sales',payload);
  assert.equal(sale.ok,true,JSON.stringify(sale));
  const invoiceId=sale.invoice.invoiceId;
  assert.equal(sale.invoice.subtotal,2490);
  assert.equal(sale.invoice.grandTotal,2490);
  assert.equal(sale.invoice.items[0].quantity,283);
  assert.equal(sale.invoice.items[0].lineTotal,2490);
  assert.equal(sale.invoice.items[0].unitDescription,'1 CT 2 BOX 3 PCS');
  assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,117);
  assert.deepEqual(all('SELECT lot_id,quantity,unit_cost FROM sale_item_lots WHERE invoice_id=? ORDER BY id',invoiceId)
   .map(x=>[x.lot_id==='MIXED-LOT-2'?'later':'opening',x.quantity,x.unit_cost]),
   [['opening',100,5],['later',183,7]]);
  assert.equal(row("SELECT SUM(credit) credit FROM cash_book WHERE type='Sale' AND reference=?",invoiceId).credit,2490);
  assert.equal(row('SELECT quantity,line_total FROM sale_items WHERE invoice_id=?',invoiceId).quantity,283);
  const frozen=row('SELECT profile_revision,quantities_json,description,base_quantity,line_total_cents FROM sale_item_unit_snapshots WHERE invoice_id=?',invoiceId);
  assert.equal(frozen.profile_revision,1);
  assert.deepEqual(JSON.parse(frozen.quantities_json),{Carton:1,Box:2,Pcs:3});
  assert.equal(frozen.base_quantity,283);
  assert.equal(frozen.line_total_cents,249000);
  const receipt=await api('GET','/api/pos/invoices/'+invoiceId);
  assert.equal(receipt.ok,true);
  assert.equal(receipt.invoice.items[0].unitDescription,'1 CT 2 BOX 3 PCS');
  assert.equal(receipt.invoice.items[0].unitSnapshot.profile.units[1].sellingPrice,180);
  const replay=await api('POST','/api/pos/sales',payload);
  assert.equal(replay.ok,true,JSON.stringify(replay));
  assert.equal(replay.invoice.invoiceId,invoiceId);
  assert.equal(row('SELECT count(*) n FROM sale_item_unit_snapshots').n,1);
  assert.equal(row('SELECT count(*) n FROM sales').n,1);
  const before={sales:row('SELECT count(*) n FROM sales').n,stock:row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,
    cash:row("SELECT count(*) n FROM cash_book WHERE type='Sale'").n};
  const changed=await api('PUT','/api/products/'+id+'/unit-profile',{
   expectedRevision:1,units:chain.map(x=>x.unit==='Box'?{...x,sellingPrice:200}:x)
  });
  assert.equal(changed.revision,2);
  const stale=await api('POST','/api/pos/sales',{...payload,clientRequestId:'mixed-stale-profile-request-2'});
  assert.equal(stale.status,409);
  assert.equal((await api('GET','/api/pos/invoices/'+invoiceId)).invoice.items[0].unitSnapshot.profile.units[1].sellingPrice,180);
  const badQty=await api('POST','/api/pos/sales',{...payload,clientRequestId:'mixed-invalid-base-request-3',
   items:[{...payload.items[0],qty:282,unitProfileRevision:2}]});
  assert.equal(badQty.ok,false);
  assert.equal((await api('PUT','/api/sales-management/'+invoiceId,{reason:'edit',items:payload.items})).status,409);
  assert.equal((await api('POST','/api/sales-returns',{
   invoiceId,refundMethod:'Cash',reason:'unit safety gate',items:[{productId:id,qty:1,unitPrice:10}]
  })).status,409);
  assert.equal(row('SELECT count(*) n FROM sales').n,before.sales);
  assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,before.stock);
  assert.equal(row("SELECT count(*) n FROM cash_book WHERE type='Sale'").n,before.cash);
  assert.equal(row('SELECT count(*) n FROM sales_returns').n,0);
 } finally {db.close();}
});
