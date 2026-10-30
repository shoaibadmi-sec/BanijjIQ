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
 const api=async(method:string,path:string,body?:unknown,bearer=token)=>{
  const response=await handleApiRequest(new Request('http://local.test'+path,{method,
   headers:{'content-type':'application/json',...(bearer?{authorization:'Bearer '+bearer}:{})},
   body:body===undefined?undefined:JSON.stringify(body)}),db);
  return {status:response.status,...await response.json() as Record<string,any>};
 };
 const open=async()=>{
  const admin=await api('POST','/api/setup/admin',{fullName:'Return Tester',phone:'01000007881',password:'BundleReturnTester2026!'});
  assert.equal(admin.status,200,JSON.stringify(admin));token=admin.token;
  assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:500})).status,200);
 };
 const seed=async()=>{
  const insert=db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock,purchase_price,selling_price,status) VALUES (?,?,'Hardware','Pcs',?,?,?,'Active')");
  insert.run('RET-WIRE','Wire',9,5,35);insert.run('RET-SWITCH','Switch',3,4,12);
  const lot=db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES (?,?,'PURCHASE',?,?,?)");
  lot.run('RET-W1','RET-WIRE',5,5,20);lot.run('RET-W2','RET-WIRE',4,4,30);lot.run('RET-S1','RET-SWITCH',3,3,5);
  const kit=await api('POST','/api/products/bundle-recipes',{bundleId:'RET-KIT',name:'Wire Kit',sellingPrice:120,
   components:[{productId:'RET-WIRE',quantityPerSet:2},{productId:'RET-SWITCH',quantityPerSet:1}]});
  assert.equal(kit.status,200,JSON.stringify(kit));
  const sale=await api('POST','/api/pos/bundle-sales',{clientRequestId:'bundle-return-sale01',customerName:'Cash Buyer',
   customerPhone:'01000007777',paymentType:'Cash',paymentMethod:'Cash',items:[
    {productId:'RET-KIT',qty:2,unitPrice:120},{productId:'RET-WIRE',qty:1,unitPrice:10}]});
  assert.equal(sale.status,200,JSON.stringify(sale));return sale.invoiceId as string;
 };
 const stock=(pid:string)=>(db.native.prepare('SELECT current_stock AS n FROM products WHERE product_id=?').get(pid) as any)?.n;
 const lot=(id:string)=>(db.native.prepare('SELECT remaining_quantity AS n FROM stock_lots WHERE lot_id=?').get(id) as any)?.n;
 return {db,api,open,seed,stock,lot};
}

test('Phase7E3A: full cash return restores each original component lot once, compensates receipt, reconciles profit, and replays without extra writes',async()=>{
 const x=fixture();try{
  await x.open();const invoice=await x.seed();
  assert.equal(x.stock('RET-WIRE'),4);assert.equal(x.stock('RET-SWITCH'),1);
  const original=(x.db.native.prepare("SELECT SUM(credit) n FROM cash_book WHERE reference=? AND type='Sale'").get(invoice) as any).n;
  assert.equal(original,250);
  const body={clientRequestId:'bundle-return-unique01',reason:'Customer returned all unopened sets'};
  const returned=await x.api('POST','/api/sales-returns/bundle-invoices/'+invoice,body);
  assert.equal(returned.status,200,JSON.stringify(returned));
  assert.equal(returned.ok,true);assert.equal(returned.replayed,false);
  assert.equal(returned.refundAmount,250);assert.equal(returned.costMinor,11000);
  assert.equal(x.stock('RET-WIRE'),9);assert.equal(x.stock('RET-SWITCH'),3);
  assert.deepEqual(['RET-W1','RET-W2','RET-S1'].map(x.lot),[5,4,3]);
  assert.equal(x.stock('RET-KIT'),0,'virtual bundle remains without physical stock');
  const refund=(x.db.native.prepare("SELECT debit,credit FROM cash_book WHERE reference=? AND type='Sales Return'").get(returned.returnId) as any);
  assert.deepEqual([refund.debit,refund.credit],[250,0]);
  const lines=x.db.native.prepare('SELECT product_id,return_quantity,line_total FROM sales_return_items WHERE return_id=? ORDER BY id').all(returned.returnId) as any[];
  assert.deepEqual(lines.map(x=>[x.product_id,x.return_quantity,x.line_total]),[['RET-KIT',2,240],['RET-WIRE',1,10]]);
  const actual=x.db.native.prepare('SELECT visible_product_id,component_id,lot_id,quantity,cost_minor FROM bundle_return_allocations WHERE return_id=? ORDER BY id').all(returned.returnId) as any[];
  assert.deepEqual(actual.map(x=>[x.visible_product_id,x.component_id,x.lot_id,x.quantity,x.cost_minor]),
   [['RET-KIT','RET-WIRE','RET-W1',4,8000],['RET-WIRE','RET-WIRE','RET-W1',1,2000],['RET-KIT','RET-SWITCH','RET-S1',2,1000]]);
  const sourceMove=x.db.native.prepare("SELECT product_id,quantity_in,balance_after FROM stock_movements WHERE note LIKE 'BUNDLE RETURN:%' ORDER BY id").all() as any[];
  assert.deepEqual(sourceMove.map(x=>[x.product_id,x.quantity_in,x.balance_after]),
   [['RET-WIRE',4,8],['RET-WIRE',1,9],['RET-SWITCH',2,3]]);
  const query=parseLiveReportQuery(new URL('http://local.test/api/reports/v2/rows?report=profit&from=2026-10-01&to=2026-10-31'));
  const report=await readSalesProfit(x.db,query);
  assert.equal(report.coverage.status,'ready',report.coverage.reason);
  for(const [k,v] of Object.entries({returns:25000,netSales:0,fifoCogs:0,grossProfit:0,netProfit:0}))
   assert.equal(report.metrics.find(m=>m.key===k)?.valueMinor,v,k);
  const before=(x.db.native.prepare('SELECT total_changes() n').get() as any).n;
  const replay=await x.api('POST','/api/sales-returns/bundle-invoices/'+invoice,body);
  assert.equal(replay.status,200,JSON.stringify(replay));
  assert.equal(replay.replayed,true);assert.equal(replay.returnId,returned.returnId);
  assert.equal((x.db.native.prepare('SELECT total_changes() n').get() as any).n,before);
  assert.equal((await x.api('POST','/api/sales-returns/bundle-invoices/'+invoice,{...body,reason:'Different reason'})).status,409);
  assert.equal((await x.api('POST','/api/sales-returns/bundle-invoices/'+invoice,{...body,clientRequestId:'different-return-key'})).status,409);
  assert.equal((x.db.native.prepare('SELECT COUNT(*) n FROM sales_returns WHERE invoice_id=?').get(invoice) as any).n,1);
 }finally{x.db.close();}
});

test('Phase7E3A: full-only cash return refuses unapproved quantities, refund methods, missing session and legacy routes without side effects',async()=>{
 const x=fixture();try{
  await x.open();const invoice=await x.seed();
  const base={clientRequestId:'bundle-return-guards01',reason:'Customer returned full order'};
  const before=(x.db.native.prepare('SELECT total_changes() n').get() as any).n;
  const bad=[
   {...base,items:[{productId:'RET-KIT',qty:1}]},
   {...base,refundMethod:'Bank'},
   {...base,refundAmount:120},
   {...base,reason:''}
  ];
  for(const body of bad){
   const result=await x.api('POST','/api/sales-returns/bundle-invoices/'+invoice,body);
   assert.equal(result.status>=400,true,JSON.stringify({body,result}));
  }
  assert.equal((x.db.native.prepare('SELECT total_changes() n').get() as any).n,before);
  const legacy=await x.api('POST','/api/sales-returns',{invoiceId:invoice,refundMethod:'Cash',items:[{productId:'RET-KIT',qty:2}]});
  assert.equal(legacy.status,409);
  const oldDelete=await x.api('DELETE','/api/sales-management/'+invoice,{reason:'Unsafe return shortcut'});
  assert.equal(oldDelete.status,409);
  assert.equal((x.db.native.prepare('SELECT total_changes() n').get() as any).n,before);
  const session=x.db.native.prepare("SELECT session_id FROM cash_sessions WHERE status='Open'").get() as any;
  x.db.native.prepare("UPDATE cash_sessions SET status='Closed' WHERE session_id=?").run(session.session_id);
  assert.equal((await x.api('POST','/api/sales-returns/bundle-invoices/'+invoice,base)).status,400);
  assert.equal(x.stock('RET-WIRE'),4);
 }finally{x.db.close();}
});
