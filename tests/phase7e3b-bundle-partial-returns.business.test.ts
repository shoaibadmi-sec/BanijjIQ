import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';
import {readSalesProfit} from '../server/modules/reporting/live/sales-profit.ts';
import {parseLiveReportQuery} from '../server/modules/reporting/live/query.ts';

function fixture(){
 const db=new SqliteDatabase(':memory:');
 runMigrations(db.native,resolve('migrations'));let token='';
 const api=async(method:string,path:string,body?:unknown,bearer=token)=>{
  const r=await handleApiRequest(new Request('http://local.test'+path,{method,headers:{
   'content-type':'application/json',...(bearer?{authorization:'Bearer '+bearer}:{})},
   body:body===undefined?undefined:JSON.stringify(body)}),db);
  return {status:r.status,...await r.json() as Record<string,any>};
 };
 const setup=async()=>{
  const admin=await api('POST','/api/setup/admin',{fullName:'Partial Bundle Admin',phone:'01000007911',password:'PartialBundle2026!'});
  assert.equal(admin.status,200,JSON.stringify(admin));token=admin.token;
  assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:500})).status,200);
  const p=db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock,selling_price,status) VALUES (?,?,'Hardware','Pcs',?,?,'Active')");
  p.run('PR-WIRE','Copper wire',8,20);p.run('PR-SWITCH','Switch',4,5);
  const lot=db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES (?,?,'PURCHASE',?,?,?)");
  lot.run('PR-W1','PR-WIRE',5,5,20);lot.run('PR-W2','PR-WIRE',3,3,30);lot.run('PR-S1','PR-SWITCH',4,4,5);
  const create=await api('POST','/api/products/bundle-recipes',{bundleId:'PR-KIT',name:'3-piece wire kit',sellingPrice:120,
   components:[{productId:'PR-WIRE',quantityPerSet:2},{productId:'PR-SWITCH',quantityPerSet:1}]});
  assert.equal(create.status,200,JSON.stringify(create));
  const sale=await api('POST','/api/pos/bundle-sales',{
   clientRequestId:'partial-bundle-sale001',customerName:'Whole Set Buyer',customerPhone:'01000009991',
   paymentType:'Cash',paymentMethod:'Cash',items:[{productId:'PR-KIT',qty:3,unitPrice:120}]});
  assert.equal(sale.status,200,JSON.stringify(sale));
  return sale.invoiceId as string;
 };
 const stock=(id:string)=>(db.native.prepare('SELECT current_stock AS n FROM products WHERE product_id=?').get(id) as any)?.n;
 const lot=(id:string)=>(db.native.prepare('SELECT remaining_quantity AS n FROM stock_lots WHERE lot_id=?').get(id) as any)?.n;
 const profit=async()=>{
  const q=parseLiveReportQuery(new URL('http://local.test/api/reports/v2/rows?report=profit&from=2026-10-01&to=2026-10-31'));
  const r=await readSalesProfit(db,q);
  assert.equal(r.coverage.status,'ready',r.coverage.reason);
  return Object.fromEntries(r.metrics.map(m=>[m.key,m.valueMinor]));
 };
 return {db,api,setup,stock,lot,profit};
}
test('Phase7E3B: three independent one-set refunds restore exact original FIFO lots and original-cost profit, ending at zero',async()=>{
 const x=fixture();try{
  const invoice=await x.setup();
  assert.deepEqual([x.stock('PR-WIRE'),x.stock('PR-SWITCH'),x.lot('PR-W1'),x.lot('PR-W2'),x.lot('PR-S1')],[2,1,0,2,1]);
  const before=await x.profit();assert.equal(before.fifoCogs,14500);assert.equal(before.netSales,36000);
  const path='/api/sales-returns/bundle-invoices/'+invoice+'/sets';
  for(const [i,expected] of [
   {stock:[4,2,2,2,2],cogs:10000,net:24000,price:4500},
   {stock:[6,3,4,2,3],cogs:5500,net:12000,price:4500},
   {stock:[8,4,5,3,4],cogs:0,net:0,price:5500}
  ].entries()){
   const body={clientRequestId:'partial-return-key00'+(i+1),reason:'Customer returned one complete sealed kit',setsToReturn:1};
   const r=await x.api('POST',path,body);
   assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.replayed,false);
   assert.equal(r.refundAmount,120);assert.equal(r.costMinor,expected.price);
   assert.deepEqual([x.stock('PR-WIRE'),x.stock('PR-SWITCH'),x.lot('PR-W1'),x.lot('PR-W2'),x.lot('PR-S1')],expected.stock);
   const refund=x.db.native.prepare("SELECT debit,credit FROM cash_book WHERE type='Sales Return' AND reference=?").get(r.returnId) as any;
   assert.deepEqual([refund.debit,refund.credit],[120,0]);
   const original=(x.db.native.prepare("SELECT SUM(quantity) n FROM bundle_partial_return_allocations WHERE return_id=?").get(r.returnId) as any).n;
   assert.equal(original,3,'restore two wire pieces and one switch from original FIFO sources');
   const p=await x.profit();assert.equal(p.fifoCogs,expected.cogs);assert.equal(p.netSales,expected.net);
   const beforeReplay=(x.db.native.prepare('SELECT total_changes() n').get() as any).n;
   const replay=await x.api('POST',path,body);
   assert.equal(replay.status,200);assert.equal(replay.replayed,true);assert.equal(replay.returnId,r.returnId);
   assert.equal((x.db.native.prepare('SELECT total_changes() n').get() as any).n,beforeReplay);
   assert.equal((await x.api('POST',path,{...body,reason:'Altered original return reason'})).status,409);
  }
  const tooMany=await x.api('POST',path,{clientRequestId:'partial-return-extra01',reason:'Another sealed kit',setsToReturn:1});
  assert.equal(tooMany.status,409,'no more sets remain to restore');
  assert.equal((x.db.native.prepare("SELECT COUNT(*) n FROM sales_returns WHERE invoice_id=?").get(invoice) as any).n,3);
  assert.equal((x.db.native.prepare("SELECT SUM(debit) n FROM cash_book WHERE type='Sales Return'").get() as any).n,360);
  assert.equal(x.stock('PR-KIT'),0,'never create virtual kit stock');
 }finally{x.db.close();}
});
test('Phase7E3B: partial set endpoint blocks fractions, unsupported refunds, direct full-refund fallback and duplicate source allocations',async()=>{
 const x=fixture();try{
  const invoice=await x.setup();const path='/api/sales-returns/bundle-invoices/'+invoice+'/sets';
  const body={clientRequestId:'partial-return-valid01',reason:'Sealed kit returned to counter',setsToReturn:1};
  const baseline=(x.db.native.prepare('SELECT total_changes() n').get() as any).n;
  for(const invalid of [
   {...body,setsToReturn:0},{...body,setsToReturn:0.5},{...body,setsToReturn:4},
   {...body,refundMethod:'Bank'},{...body,refundAmount:1},{...body,reason:'Bad'}
  ]){
   const result=await x.api('POST',path,invalid);
   assert.equal(result.status>=400,true,JSON.stringify({invalid,result}));
  }
  assert.equal((x.db.native.prepare('SELECT total_changes() n').get() as any).n,baseline);
  const okay=await x.api('POST',path,body);assert.equal(okay.status,200,JSON.stringify(okay));
  assert.equal((await x.api('POST','/api/sales-returns/bundle-invoices/'+invoice,{clientRequestId:'full-return-after-partial',reason:'Cannot bypass partial return'})).status,409);
  assert.equal((await x.api('POST','/api/sales-returns',{invoiceId:invoice,refundMethod:'Cash',items:[{productId:'PR-KIT',qty:1}]})).status,409);
  const oldAfter=(x.db.native.prepare('SELECT COUNT(*) n FROM sales_returns').get() as any).n;
  const first=(x.db.native.prepare('SELECT source_allocation_id,quantity FROM bundle_partial_return_allocations WHERE return_id=? ORDER BY id LIMIT 1').get(okay.returnId) as any);
  assert.throws(()=>x.db.native.prepare('INSERT INTO bundle_partial_return_allocations(return_id,invoice_id,visible_product_id,component_id,lot_id,source_allocation_id,movement_id,quantity,unit_cost,cost_minor) VALUES (?,?,?,?,?,?,?,?,?,?)')
   .run('INJECTED',invoice,'PR-KIT','PR-WIRE','PR-W1',first.source_allocation_id,'INJECTED',99,20,198000),/BUNDLE|FOREIGN|CHECK|CONFLICT|constraint/i);
  assert.equal((x.db.native.prepare('SELECT COUNT(*) n FROM sales_returns').get() as any).n,oldAfter);
 }finally{x.db.close();}
});
