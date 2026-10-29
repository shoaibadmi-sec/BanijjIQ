import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

test('mixed-unit return uses immutable original prices and restores each FIFO lot only once',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));
  let token='';
  async function api(method:string,path:string,body?:unknown){
    const headers:Record<string,string>={'content-type':'application/json'};
    if(token)headers.authorization='Bearer '+token;
    const response=await handleApiRequest(new Request('http://unit-return.test'+path,{
      method,headers,body:body===undefined?undefined:JSON.stringify(body)
    }),db);
    return {status:response.status,...(await response.json() as any)};
  }
  const row=(sql:string,...params:unknown[])=>db.native.prepare(sql).get(...params) as any;
  const list=(sql:string,...params:unknown[])=>db.native.prepare(sql).all(...params) as any[];
  const user=await api('POST','/api/setup/admin',{
    fullName:'Return Unit Tester',phone:'01000009188',password:'ReturnUnits2026!'
  });
  assert.equal(user.ok,true,JSON.stringify(user));token=user.token;
  const p=await api('POST','/api/products',{
    productName:'Multi Unit Return Wire',category:'Electric',unit:'Pcs',purchasePrice:5,
    sellingPrice:10,currentStock:100,minimumStock:0,trackSerial:false,trackExpiry:false,
    trackWarranty:false,status:'Active'
  });
  assert.equal(p.ok,true,JSON.stringify(p));const id=p.productId;
  const opening=row('SELECT lot_id FROM stock_lots WHERE product_id=?',id).lot_id;
  db.native.prepare("INSERT INTO stock_lots (lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost,status) VALUES (?,?,'PURCHASE','LATER',300,300,7,'Active')").run('RETURN-LOT-LATER',id);
  db.native.prepare('UPDATE products SET current_stock=400 WHERE product_id=?').run(id);
  const chain=[
    {unit:'Carton',symbol:'CT',containsNext:12,sellingPrice:2100},
    {unit:'Box',symbol:'BOX',containsNext:20,sellingPrice:180},
    {unit:'Pcs',symbol:'PCS',sellingPrice:10}
  ];
  assert.equal((await api('PUT','/api/products/'+id+'/unit-profile',{expectedRevision:0,units:chain})).ok,true);
  assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:0})).ok,true);
  const sale=await api('POST','/api/pos/sales',{
    clientRequestId:'unit-return-test-sale-2026',customerName:'Return Buyer',customerPhone:'01000009189',
    discount:0,paymentType:'Cash',paymentMethod:'Cash',
    items:[{productId:id,name:'Multi Unit Return Wire',qty:283,unitPrice:0,
      unitQuantities:{Carton:1,Box:2,Pcs:3},unitProfileRevision:1,fulfillmentMode:'own'}]
  });
  assert.equal(sale.ok,true,JSON.stringify(sale));
  const inv=sale.invoice.invoiceId;
  assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,117);
  const original=await api('GET','/api/sales-returns/'+inv+'/data');
  assert.equal(original.ok,true,JSON.stringify(original));
  const m=original.sale.items[0].mixedUnit;
  assert.deepEqual(m.originalQuantities,{Carton:1,Box:2,Pcs:3});
  assert.deepEqual(m.availableQuantities,{Carton:1,Box:2,Pcs:3});
  assert.equal(m.profile.units[1].sellingPrice,180);
  // Change current catalog price; refunds must still use the frozen original sale price.
  assert.equal((await api('PUT','/api/products/'+id+'/unit-profile',{
    expectedRevision:1,units:chain.map(u=>u.unit==='Box'?{...u,sellingPrice:299}:u)
  })).ok,true);
  const ret=(quantities:Record<string,number>,qty:number)=>({
    invoiceId:inv,refundMethod:'Cash',reason:'Customer product return',
    items:[{productId:id,qty,unitPrice:0,unitQuantities:quantities}]
  });
  const bad=await api('POST','/api/sales-returns',ret({Box:3},60));
  assert.equal(bad.ok,false);
  const raw=await api('POST','/api/sales-returns',{
    invoiceId:inv,refundMethod:'Cash',reason:'Unsafe request',items:[{productId:id,qty:1,unitPrice:10}]
  });
  assert.equal(raw.ok,false);
  assert.equal(row('SELECT count(*) n FROM sales_returns').n,0);
  const first=await api('POST','/api/sales-returns',ret({Box:1,Pcs:1},21));
  assert.equal(first.ok,true,JSON.stringify(first));
  assert.equal(first.totalReturnAmount,190);
  assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,138);
  assert.equal(row('SELECT remaining_quantity FROM stock_lots WHERE lot_id=?','RETURN-LOT-LATER').remaining_quantity,138);
  assert.deepEqual((await api('GET','/api/sales-returns/'+inv+'/data')).sale.items[0].mixedUnit.availableQuantities,
    {Carton:1,Box:1,Pcs:2});
  // Two independent returns of the same carton: only one can own the original unit.
  const attempts=await Promise.all([
    api('POST','/api/sales-returns',ret({Carton:1},240)),
    api('POST','/api/sales-returns',ret({Carton:1},240))
  ]);
  assert.equal(attempts.filter(x=>x.ok).length,1,JSON.stringify(attempts));
  assert.equal(attempts.filter(x=>!x.ok).length,1);
  assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,378);
  assert.equal(row('SELECT remaining_quantity FROM stock_lots WHERE lot_id=?','RETURN-LOT-LATER').remaining_quantity,300);
  assert.equal(row('SELECT remaining_quantity FROM stock_lots WHERE lot_id=?',opening).remaining_quantity,78);
  const final=await api('POST','/api/sales-returns',ret({Box:1,Pcs:2},22));
  assert.equal(final.ok,true,JSON.stringify(final));
  assert.equal(final.totalReturnAmount,200);
  assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,400);
  assert.equal(row('SELECT remaining_quantity FROM stock_lots WHERE lot_id=?',opening).remaining_quantity,100);
  assert.equal(row('SELECT remaining_quantity FROM stock_lots WHERE lot_id=?','RETURN-LOT-LATER').remaining_quantity,300);
  const allReturns=list('SELECT line_total_cents,base_quantity FROM sales_return_item_units WHERE invoice_id=?',inv);
  assert.equal(allReturns.length,3);
  assert.equal(allReturns.reduce((s,r)=>s+Number(r.line_total_cents),0),249000);
  assert.equal(allReturns.reduce((s,r)=>s+Number(r.base_quantity),0),283);
  const allocations=list('SELECT lot_id,SUM(quantity) q FROM sales_return_item_lots WHERE invoice_id=? GROUP BY lot_id',inv);
  assert.deepEqual(allocations.map(x=>[x.lot_id,x.q]).sort(),[[opening,100],['RETURN-LOT-LATER',183]].sort());
  assert.equal(row("SELECT SUM(debit) amount FROM cash_book WHERE type='Sales Return'").amount,2490);
  const repeat=await api('POST','/api/sales-returns',ret({Pcs:1},1));
  assert.equal(repeat.ok,false);
  assert.equal(row('SELECT count(*) n FROM sales_returns').n,3);
  assert.equal((await api('PUT','/api/sales-management/'+inv,{
    reason:'Cannot revise original unit chain',items:[{productId:id,qty:283,unitPrice:10}]
  })).status,409);
 }finally{db.close();}
});
