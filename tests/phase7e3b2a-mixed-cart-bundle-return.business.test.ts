import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';
import {readSalesProfit} from '../server/modules/reporting/live/sales-profit.ts';
import {parseLiveReportQuery} from '../server/modules/reporting/live/query.ts';

function fixture() {
 const db=new SqliteDatabase(':memory:');
 runMigrations(db.native,resolve('migrations'));
 let token='';
 const api=async(method:string,path:string,body?:unknown)=>{
  const r=await handleApiRequest(new Request('http://local.test'+path,{method,
   headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
   body:body===undefined?undefined:JSON.stringify(body)}),db);
  return {status:r.status,...await r.json() as Record<string,any>};
 };
 const setup=async(twoBundles=false)=>{
  const admin=await api('POST','/api/setup/admin',{fullName:'Mixed Cart Tester',phone:'01000007951',password:'MixedCartTest2026!'});
  assert.equal(admin.status,200,JSON.stringify(admin));token=admin.token;
  assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:500})).status,200);
  const product=db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock,selling_price,status) VALUES (?,?,'Hardware','Pcs',?,?,'Active')");
  product.run('MX-WIRE','Wire',9,10);product.run('MX-SWITCH','Switch',4,20);
  const lots=db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES (?,?,'PURCHASE',?,?,?)");
  lots.run('MX-W1','MX-WIRE',5,5,20);lots.run('MX-W2','MX-WIRE',4,4,30);lots.run('MX-S1','MX-SWITCH',4,4,5);
  const recipe=await api('POST','/api/products/bundle-recipes',{bundleId:'MX-KIT',name:'Electrical Kit',sellingPrice:120,
   components:[{productId:'MX-WIRE',quantityPerSet:2},{productId:'MX-SWITCH',quantityPerSet:1}]});
  assert.equal(recipe.status,200,JSON.stringify(recipe));
  if(twoBundles){
   const other=await api('POST','/api/products/bundle-recipes',{bundleId:'MX-KIT2',name:'Switch Kit',sellingPrice:60,
    components:[{productId:'MX-SWITCH',quantityPerSet:1}]});
   assert.equal(other.status,200,JSON.stringify(other));
  }
  const items=twoBundles?
   [{productId:'MX-KIT',qty:1,unitPrice:120},{productId:'MX-KIT2',qty:1,unitPrice:60}]:
   [{productId:'MX-KIT',qty:3,unitPrice:120},{productId:'MX-WIRE',qty:1,unitPrice:10}];
  const sale=await api('POST','/api/pos/bundle-sales',{
   clientRequestId:'mixed-cart-source01',customerName:'Cash Customer',customerPhone:'01000007952',
   paymentType:'Cash',paymentMethod:'Cash',items});
  assert.equal(sale.status,200,JSON.stringify(sale));return sale.invoiceId as string;
 };
 const current=(pid:string)=>(db.native.prepare('SELECT current_stock AS n FROM products WHERE product_id=?').get(pid) as any).n as number;
 const lot=(lotId:string)=>(db.native.prepare('SELECT remaining_quantity AS n FROM stock_lots WHERE lot_id=?').get(lotId) as any).n as number;
 const profit=async()=>{
  const q=parseLiveReportQuery(new URL('http://local.test/api/reports/v2/rows?report=profit&from=2026-10-01&to=2026-10-31'));
  const report=await readSalesProfit(db,q);
  assert.equal(report.coverage.status,'ready',report.coverage.reason);
  return Object.fromEntries(report.metrics.map(x=>[x.key,x.valueMinor]));
 };
 return {db,api,setup,current,lot,profit};
}

test('Phase7E3B2A: partial whole-set refunds only restore bundle lots, not shared-product standalone FIFO, and profit retains standalone revenue/COGS',async()=>{
 const f=fixture();try{
  const invoice=await f.setup();
  assert.deepEqual([f.current('MX-WIRE'),f.current('MX-SWITCH'),f.lot('MX-W1'),f.lot('MX-W2'),f.lot('MX-S1')],[2,1,0,2,1]);
  const source=f.db.native.prepare("SELECT visible_product_id,lot_id,quantity FROM bundle_sale_allocations WHERE invoice_id=? AND component_id='MX-WIRE' ORDER BY id").all(invoice) as any[];
  assert.deepEqual(source.map(x=>[x.visible_product_id,x.lot_id,x.quantity]),[
   ['MX-KIT','MX-W1',5],['MX-KIT','MX-W2',1],['MX-WIRE','MX-W2',1]]);
  const initial=await f.profit();
  assert.equal(initial.grossSales,37000);assert.equal(initial.fifoCogs,17500);assert.equal(initial.netSales,37000);
  const path='/api/sales-returns/bundle-invoices/'+invoice+'/sets';
  const one={clientRequestId:'mixrefund-onceset01',reason:'Customer returned a complete kit',setsToReturn:1};
  const first=await f.api('POST',path,one);
  assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.refundAmount,120);assert.equal(first.costMinor,4500);
  assert.deepEqual([f.current('MX-WIRE'),f.current('MX-SWITCH'),f.lot('MX-W1'),f.lot('MX-W2'),f.lot('MX-S1')],[4,2,2,2,2]);
  const afterOne=await f.profit();assert.equal(afterOne.netSales,25000);assert.equal(afterOne.fifoCogs,13000);
  const remaining={clientRequestId:'mixrefund-twosets01',reason:'Customer returned two remaining complete kits',setsToReturn:2};
  const second=await f.api('POST',path,remaining);
  assert.equal(second.status,200,JSON.stringify(second));assert.equal(second.refundAmount,240);assert.equal(second.costMinor,10000);
  assert.deepEqual([f.current('MX-WIRE'),f.current('MX-SWITCH'),f.lot('MX-W1'),f.lot('MX-W2'),f.lot('MX-S1')],[8,4,5,3,4]);
  assert.equal(f.current('MX-KIT'),0);
  const final=await f.profit();
  assert.equal(final.grossSales,37000);assert.equal(final.returns,36000);assert.equal(final.netSales,1000);
  assert.equal(final.fifoCogs,3000,'one standalone wire W2 cost must remain as the only unsold inventory depletion');
  const ordinary=f.db.native.prepare("SELECT product_id,quantity,line_total FROM sale_items WHERE invoice_id=? AND product_id='MX-WIRE'").get(invoice) as any;
  assert.deepEqual([ordinary.product_id,ordinary.quantity,ordinary.line_total],['MX-WIRE',1,10]);
  assert.equal((f.db.native.prepare("SELECT COUNT(*) n FROM sales_return_items WHERE invoice_id=? AND product_id='MX-WIRE'").get(invoice) as any).n,0);
  const prior=(f.db.native.prepare('SELECT total_changes() n').get() as any).n;
  const replay=await f.api('POST',path,remaining);assert.equal(replay.status,200);assert.equal(replay.replayed,true);
  assert.equal((f.db.native.prepare('SELECT total_changes() n').get() as any).n,prior);
  const again=await f.api('POST',path,{...remaining,clientRequestId:'mixrefund-oversale01'});
  assert.equal(again.status,409);
  assert.equal((f.db.native.prepare("SELECT SUM(debit) n FROM cash_book WHERE type='Sales Return'").get() as any).n,360);
 }finally{f.db.close();}
});

test('Phase7E3B2A: reject two-bundle invoices and attempts to refund an ordinary line through the guarded bundle endpoint, without stock or cash writes',async()=>{
 const f=fixture();try{
  const invoice=await f.setup(true),path='/api/sales-returns/bundle-invoices/'+invoice+'/sets';
  const before=(f.db.native.prepare('SELECT total_changes() n').get() as any).n;
  const result=await f.api('POST',path,{clientRequestId:'mixrefund-multikit01',reason:'One kit returned unopened',setsToReturn:1});
  assert.equal(result.status,409,JSON.stringify(result));
  assert.equal((f.db.native.prepare('SELECT total_changes() n').get() as any).n,before);
  assert.equal((f.db.native.prepare('SELECT COUNT(*) n FROM sales_returns').get() as any).n,0);
 }finally{f.db.close();}
 const x=fixture();try{
  const invoice=await x.setup(),path='/api/sales-returns/bundle-invoices/'+invoice+'/sets';
  const invalid=await x.api('POST',path,{clientRequestId:'mixrefund-ordinary01',reason:'Attempt to return wire separately',setsToReturn:1,
   items:[{productId:'MX-WIRE',qty:1}],refundAmount:130});
  assert.equal(invalid.status,400,JSON.stringify(invalid));
  const legacy=await x.api('POST','/api/sales-returns',{invoiceId:invoice,refundMethod:'Cash',reason:'Bypass bundle route',items:[{productId:'MX-WIRE',qty:1,unitPrice:10}]});
  assert.equal(legacy.status,409);
  assert.equal(x.current('MX-WIRE'),2);
  assert.equal((x.db.native.prepare('SELECT COUNT(*) n FROM sales_returns').get() as any).n,0);
 }finally{x.db.close();}
});
