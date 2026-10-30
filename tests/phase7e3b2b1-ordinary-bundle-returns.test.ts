import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';
import {readSalesProfit} from '../server/modules/reporting/live/sales-profit.ts';
import {parseLiveReportQuery} from '../server/modules/reporting/live/query.ts';

function fixture(){
 const db=new SqliteDatabase(':memory:');runMigrations(db.native,resolve('migrations'));let token='';
 const api=async(method:string,path:string,body?:unknown)=>{
  const r=await handleApiRequest(new Request('http://local.test'+path,{method,headers:{
   'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
   body:body===undefined?undefined:JSON.stringify(body)}),db);
  return {status:r.status,...await r.json() as Record<string,any>};
 };
 const start=async()=>{
  const a=await api('POST','/api/setup/admin',{fullName:'Ordinary Mixed Tester',phone:'01000006991',password:'OrdinaryBundleTest2026!'});
  assert.equal(a.status,200,JSON.stringify(a));token=a.token;
  assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:500})).status,200);
  const p=db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock,selling_price,status) VALUES (?,?,'Hardware','Pcs',?,?,'Active')");
  p.run('OR-WIRE','Wire',9,10);p.run('OR-SWITCH','Switch',4,20);
  const lot=db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES (?,?,'PURCHASE',?,?,?)");
  lot.run('OR-W1','OR-WIRE',5,5,20);lot.run('OR-W2','OR-WIRE',4,4,30);lot.run('OR-S1','OR-SWITCH',4,4,5);
  const recipe=await api('POST','/api/products/bundle-recipes',{bundleId:'OR-KIT',name:'Wire Kit',sellingPrice:120,components:[
   {productId:'OR-WIRE',quantityPerSet:2},{productId:'OR-SWITCH',quantityPerSet:1}]});
  assert.equal(recipe.status,200,JSON.stringify(recipe));
  const s=await api('POST','/api/pos/bundle-sales',{
   clientRequestId:'ordinary-mixed-sale01',customerName:'Cash Buyer',customerPhone:'01000006992',
   paymentType:'Cash',paymentMethod:'Cash',items:[
    {productId:'OR-KIT',qty:3,unitPrice:120},{productId:'OR-WIRE',qty:1,unitPrice:10}]});
  assert.equal(s.status,200,JSON.stringify(s));return s.invoiceId as string;
 };
 const count=(sql:string,...args:any[])=>db.native.prepare(sql).get(...args) as any;
 const stock=(id:string)=>count('SELECT current_stock AS n FROM products WHERE product_id=?',id).n as number;
 const lot=(id:string)=>count('SELECT remaining_quantity AS n FROM stock_lots WHERE lot_id=?',id).n as number;
 const profit=async()=>{
  const q=parseLiveReportQuery(new URL('http://local.test/api/reports/v2/rows?report=profit&from=2026-10-01&to=2026-10-31'));
  const r=await readSalesProfit(db,q);assert.equal(r.coverage.status,'ready',r.coverage.reason);
  return Object.fromEntries(r.metrics.map(m=>[m.key,m.valueMinor]));
 };
 return {db,api,start,count,stock,lot,profit};
}

test('7E3B2B1: ordinary wire refund keeps kit stock/COGS until independently returned, then all source lots and money reconcile',async()=>{
 const f=fixture();try{
  const invoice=await f.start(),path='/api/sales-returns/bundle-invoices/'+invoice+'/ordinary';
  assert.deepEqual([f.stock('OR-WIRE'),f.lot('OR-W1'),f.lot('OR-W2'),f.stock('OR-SWITCH')],[2,0,2,1]);
  const body={clientRequestId:'ordinary-refund-once01',reason:'Returned separate unused wire',productId:'OR-WIRE',qty:1};
  const result=await f.api('POST',path,body);
  assert.equal(result.status,200,JSON.stringify(result));
  assert.equal(result.refundAmount,10);assert.equal(result.costMinor,3000);
  assert.deepEqual([f.stock('OR-WIRE'),f.lot('OR-W1'),f.lot('OR-W2'),f.stock('OR-SWITCH')],[3,0,3,1]);
  assert.equal(f.count("SELECT quantity FROM bundle_partial_return_allocations WHERE return_id=? AND visible_product_id='OR-WIRE'",result.returnId).quantity,1);
  assert.equal(f.count("SELECT debit FROM cash_book WHERE type='Sales Return' AND reference=?",result.returnId).debit,10);
  const afterOrdinary=await f.profit();assert.equal(afterOrdinary.netSales,36000);assert.equal(afterOrdinary.fifoCogs,14500);
  const before=f.count('SELECT total_changes() n').n;
  const retry=await f.api('POST',path,body);
  assert.equal(retry.status,200);assert.equal(retry.replayed,true);assert.equal(retry.returnId,result.returnId);
  assert.equal(f.count('SELECT total_changes() n').n,before);
  assert.equal((await f.api('POST',path,{...body,reason:'Different refund reason'})).status,409);
  assert.equal((await f.api('POST',path,{...body,clientRequestId:'ordinary-over-refund01'})).status,409);
  const bundle=await f.api('POST','/api/sales-returns/bundle-invoices/'+invoice+'/sets',{
   clientRequestId:'ordinary-bundle-last01',reason:'All three kits returned',setsToReturn:3});
  assert.equal(bundle.status,200,JSON.stringify(bundle));
  assert.equal(bundle.refundAmount,360);assert.equal(bundle.costMinor,14500);
  assert.deepEqual([f.stock('OR-WIRE'),f.lot('OR-W1'),f.lot('OR-W2'),f.stock('OR-SWITCH'),f.stock('OR-KIT')],[9,5,4,4,0]);
  const final=await f.profit();assert.equal(final.netSales,0);assert.equal(final.fifoCogs,0);assert.equal(final.returns,37000);
  assert.equal(f.count("SELECT SUM(debit) n FROM cash_book WHERE type='Sales Return'").n,370);
  assert.equal(f.count('SELECT COUNT(*) n FROM sales_returns WHERE invoice_id=?',invoice).n,2);
 }finally{f.db.close();}
});

test('7E3B2B1: ordinary return after some kit sets remain refunded correctly, legacy endpoints and fake quantity/price are denied',async()=>{
 const f=fixture();try{
  const invoice=await f.start();
  const kits=await f.api('POST','/api/sales-returns/bundle-invoices/'+invoice+'/sets',{
   clientRequestId:'kit-refund-before-wire01',reason:'One complete kit returned',setsToReturn:1});
  assert.equal(kits.status,200,JSON.stringify(kits));
  const url='/api/sales-returns/bundle-invoices/'+invoice+'/ordinary';
  const body={clientRequestId:'ordinary-after-kit01',reason:'Returned standalone original wire',productId:'OR-WIRE',qty:1};
  const before=f.count('SELECT total_changes() n').n;
  for(const invalid of [
   {...body,qty:0},{...body,qty:0.5},{...body,qty:2},{...body,productId:'OR-KIT'},
   {...body,refundMethod:'Bank'},{...body,unitPrice:0},{...body,reason:'bad'}
  ])assert.ok((await f.api('POST',url,invalid)).status>=400,JSON.stringify(invalid));
  assert.equal(f.count('SELECT total_changes() n').n,before);
  const returned=await f.api('POST',url,body);assert.equal(returned.status,200,JSON.stringify(returned));
  const p=await f.profit();assert.equal(p.netSales,24000);assert.equal(p.fifoCogs,10000);
  const legacy=await f.api('POST','/api/sales-returns',{
   invoiceId:invoice,refundMethod:'Cash',items:[{productId:'OR-WIRE',qty:1,unitPrice:10}]});
  assert.equal(legacy.status,409);
  const full=await f.api('POST','/api/sales-returns/bundle-invoices/'+invoice,{
   clientRequestId:'ordinary-no-full-after01',reason:'Cannot bypass existing partial returns'});
  assert.equal(full.status,409);
 }finally{f.db.close();}
});

test('7E3B2B1: failed cash refund rolls back ordinary source lot and ledger entirely',async()=>{
 const f=fixture();try{
  const invoice=await f.start(),url='/api/sales-returns/bundle-invoices/'+invoice+'/ordinary';
  const body={clientRequestId:'ordinary-rollback01',reason:'Customer returned standalone wire',productId:'OR-WIRE',qty:1};
  f.db.native.exec("CREATE TRIGGER fail_ordinary_cash BEFORE INSERT ON cash_book WHEN NEW.type='Sales Return' BEGIN SELECT RAISE(ABORT,'forced cash failure'); END;");
  const failure=await f.api('POST',url,body);assert.equal(failure.status,409,JSON.stringify(failure));
  assert.equal(f.stock('OR-WIRE'),2);assert.equal(f.lot('OR-W2'),2);
  assert.equal(f.count('SELECT COUNT(*) n FROM sales_returns').n,0);
  assert.equal(f.count('SELECT COUNT(*) n FROM bundle_ordinary_return_requests').n,0);
  assert.equal(f.count('SELECT COUNT(*) n FROM bundle_partial_return_allocations').n,0);
  f.db.native.exec('DROP TRIGGER fail_ordinary_cash');
  const success=await f.api('POST',url,body);assert.equal(success.status,200,JSON.stringify(success));
 }finally{f.db.close();}
});
