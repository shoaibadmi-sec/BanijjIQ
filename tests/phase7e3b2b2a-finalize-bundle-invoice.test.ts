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
  const r=await handleApiRequest(new Request('http://local.test'+path,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)}),db);
  return {status:r.status,...await r.json() as Record<string,any>};
 };
 const begin=async()=>{
  const admin=await api('POST','/api/setup/admin',{fullName:'Finalization Tester',phone:'01000007988',password:'FinalizeBundle2026!'});
  assert.equal(admin.status,200,JSON.stringify(admin));token=admin.token;
  assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:500})).status,200);
  const p=db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock,selling_price,status) VALUES (?,?,'Hardware','Pcs',?,?,'Active')");
  p.run('VF-WIRE','Wire',9,10);p.run('VF-SWITCH','Switch',4,5);
  const lot=db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES (?,?,'PURCHASE',?,?,?)");
  lot.run('VF-W1','VF-WIRE',5,5,20);lot.run('VF-W2','VF-WIRE',4,4,30);lot.run('VF-S1','VF-SWITCH',4,4,5);
  const kit=await api('POST','/api/products/bundle-recipes',{bundleId:'VF-KIT',name:'Electrical Kit',sellingPrice:120,components:[{productId:'VF-WIRE',quantityPerSet:2},{productId:'VF-SWITCH',quantityPerSet:1}]});
  assert.equal(kit.status,200,JSON.stringify(kit));
  const sale=await api('POST','/api/pos/bundle-sales',{clientRequestId:'finalization-source01',customerName:'Buyer',customerPhone:'01000007987',paymentType:'Cash',paymentMethod:'Cash',
   items:[{productId:'VF-KIT',qty:2,unitPrice:120},{productId:'VF-WIRE',qty:1,unitPrice:10}]});
  assert.equal(sale.status,200,JSON.stringify(sale));return sale.invoiceId as string;
 };
 const status=(invoice:string)=>(db.native.prepare('SELECT status FROM sales WHERE invoice_id=?').get(invoice) as any).status;
 const tally=()=>JSON.stringify({
  stock:db.native.prepare('SELECT product_id,current_stock FROM products ORDER BY product_id').all(),
  lot:db.native.prepare('SELECT lot_id,remaining_quantity FROM stock_lots ORDER BY lot_id').all(),
  cash:db.native.prepare('SELECT type,reference,debit,credit FROM cash_book ORDER BY entry_id').all(),
  count:db.native.prepare('SELECT return_id FROM sales_returns ORDER BY return_id').all()
 });
 const report=async()=>{
  const q=parseLiveReportQuery(new URL('http://local.test/api/reports/v2/rows?report=profit&from=2026-10-01&to=2026-10-31'));
  const r=await readSalesProfit(db,q);
  assert.equal(r.coverage.status,'ready',r.coverage.reason);
  return Object.fromEntries(r.metrics.map(m=>[m.key,m.valueMinor]));
 };
 return {db,api,begin,status,tally,report};
}

test('Phase7E3B2B2A: finalizing fully-refunded bundle invoice is cash/stock neutral, append-only and report-certified',async()=>{
 const f=fixture();try{
  const invoice=await f.begin();
  const returnAll=await f.api('POST','/api/sales-returns/bundle-invoices/'+invoice,{
   clientRequestId:'finalize-full-refund01',reason:'Everything returned unopened'});
  assert.equal(returnAll.status,200,JSON.stringify(returnAll));
  assert.equal(returnAll.refundAmount,250);
  const path='/api/sales-management/bundle-invoices/'+invoice+'/finalize-reversal';
  const body={clientRequestId:'finalize-final-key01',reason:'Entire invoice refunded and returned'};
  const before=f.tally();
  const direct=()=>f.db.native.prepare("UPDATE sales SET status='Reversed' WHERE invoice_id=?").run(invoice);
  assert.throws(direct,/BUNDLE|REVERSAL|CONFLICT|LIFECYCLE/i);
  const result=await f.api('POST',path,body);
  assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.ok,true);
  assert.equal(result.replayed,false);assert.equal(result.invoiceId,invoice);
  assert.equal(f.status(invoice),'Reversed');assert.equal(f.tally(),before,'finalization must never create cash, stock or another return');
  const row=f.db.native.prepare('SELECT invoice_id,request_id,reason FROM bundle_invoice_finalizations WHERE invoice_id=?').get(invoice) as any;
  assert.deepEqual([row.invoice_id,row.request_id,row.reason],[invoice,body.clientRequestId,body.reason]);
  const p=await f.report();assert.equal(p.netSales,0);assert.equal(p.fifoCogs,0);assert.equal(p.returns,25000);
  const changes=(f.db.native.prepare('SELECT total_changes() n').get() as any).n;
  const replay=await f.api('POST',path,body);
  assert.equal(replay.status,200);assert.equal(replay.replayed,true);
  assert.equal((f.db.native.prepare('SELECT total_changes() n').get() as any).n,changes);
  assert.equal((await f.api('POST',path,{...body,reason:'Changed reason after finalization'})).status,409);
  assert.equal((await f.api('POST',path,{...body,clientRequestId:'finalize-different01'})).status,409);
  assert.equal((await f.api('DELETE','/api/sales-management/'+invoice,{reason:'Bypass after reversal'})).status,409);
  assert.equal(f.tally(),before);
 }finally{f.db.close();}
});

test('Phase7E3B2B2A: cannot reverse invoice with a partially returned ordinary line, nor use arbitrary override payload',async()=>{
 const f=fixture();try{
  const invoice=await f.begin(),path='/api/sales-management/bundle-invoices/'+invoice+'/finalize-reversal';
  const body={clientRequestId:'finalize-blocked01',reason:'Attempt too early'};
  assert.equal((await f.api('POST',path,body)).status,409);
  const returnedKit=await f.api('POST','/api/sales-returns/bundle-invoices/'+invoice+'/sets',{
   clientRequestId:'finalize-kit-part01',reason:'Both whole kits returned',setsToReturn:2});
  assert.equal(returnedKit.status,200,JSON.stringify(returnedKit));
  assert.equal((await f.api('POST',path,body)).status,409,'ordinary line still outstanding');
  const ordinary=await f.api('POST','/api/sales-returns/bundle-invoices/'+invoice+'/ordinary',{
   clientRequestId:'finalize-wire-part01',reason:'Separate wire returned',productId:'VF-WIRE',qty:1});
  assert.equal(ordinary.status,200,JSON.stringify(ordinary));
  const before=f.tally();
  assert.equal((await f.api('POST',path,{...body,paidAmount:0})).status,400);
  const yes=await f.api('POST',path,body);
  assert.equal(yes.status,200,JSON.stringify(yes));
  assert.equal(f.status(invoice),'Reversed');assert.equal(f.tally(),before);
  const profit=await f.report();assert.equal(profit.netSales,0);assert.equal(profit.fifoCogs,0);
 }finally{f.db.close();}
});

test('Phase7E3B2B2A: finalization status rollback on injected failure leaves invoice Completed and no marker',async()=>{
 const f=fixture();try{
  const invoice=await f.begin();
  assert.equal((await f.api('POST','/api/sales-returns/bundle-invoices/'+invoice,{
   clientRequestId:'finalize-atomic-refund01',reason:'Full refund before finalization'})).status,200);
  const path='/api/sales-management/bundle-invoices/'+invoice+'/finalize-reversal';
  f.db.native.exec("CREATE TRIGGER force_reversal_fail BEFORE UPDATE OF status ON sales WHEN NEW.status='Reversed' BEGIN SELECT RAISE(ABORT,'forced failure'); END;");
  const result=await f.api('POST',path,{clientRequestId:'finalize-atomic-key01',reason:'Valid full refund and restock'});
  assert.equal(result.status,409,JSON.stringify(result));
  assert.equal(f.status(invoice),'Completed');
  assert.equal((f.db.native.prepare('SELECT COUNT(*) n FROM bundle_invoice_finalizations').get() as any).n,0);
  f.db.native.exec('DROP TRIGGER force_reversal_fail');
  const good=await f.api('POST',path,{clientRequestId:'finalize-atomic-key01',reason:'Valid full refund and restock'});
  assert.equal(good.status,200,JSON.stringify(good));
 }finally{f.db.close();}
});
