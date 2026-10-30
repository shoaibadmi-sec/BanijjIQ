import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

const period='&from=2026-01-01&to=2026-12-31';
async function fixture(run:(f:{
  api:(method:string,path:string,body?:unknown)=>Promise<any>;
  one:(sql:string,...args:unknown[])=>any;
  many:(sql:string,...args:unknown[])=>any[];
  count:(table:string)=>number;
  db:SqliteDatabase;
})=>Promise<void>){
 const db=new SqliteDatabase(':memory:');
 try{
  const migrated=runMigrations(db.native,resolve('migrations'));
  assert.ok(migrated.applied.length>20,'test the full production migration chain');
  let token='';
  async function api(method:string,path:string,body?:unknown){
   const headers:Record<string,string>={'content-type':'application/json'};
   if(token)headers.authorization='Bearer '+token;
   const response=await handleApiRequest(new Request('http://transaction-lifecycle.local'+path,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body)
   }),db);
   return {status:response.status,...await response.json() as Record<string,any>};
  }
  const one=(sql:string,...args:unknown[])=>(db.native.prepare(sql).get(...args)) as any;
  const many=(sql:string,...args:unknown[])=>(db.native.prepare(sql).all(...args)) as any[];
  const count=(table:string)=>Number(one('SELECT COUNT(*) AS n FROM '+table).n);
  const admin=await api('POST','/api/setup/admin',
   {fullName:'Full Transaction Test',phone:'01000007971',password:'CrossModule-Local2026!'});
  assert.equal(admin.status,200,JSON.stringify(admin));token=admin.token;
  await run({api,one,many,count,db});
 }finally{db.close();}
}
const metric=(report:any,key:string)=>{
 const found=report.metrics?.find((m:any)=>m.key===key);
 assert.ok(found,'missing metric '+key+' in '+JSON.stringify(report));
 return found;
};
const ok=(res:any)=>assert.equal(res.status,200,JSON.stringify(res));

test('actual purchase → FIFO sale → cash return → supplier settlement reconciles all journals and Phase 5 reports',async()=>{
 await fixture(async({api,one,many,count,db})=>{
  const supplier=await api('POST','/api/suppliers',{name:'Life Cycle Supply',openingBalance:0});
  ok(supplier);
  const product=await api('POST','/api/products',{
   productName:'Life Cycle Socket',category:'Electrical',unit:'Pcs',
   purchasePrice:20,sellingPrice:35,currentStock:0,minimumStock:0,
   status:'Active',trackSerial:false,trackExpiry:false,trackWarranty:false
  });
  ok(product);
  const pid=product.productId;
  const purchase=await api('POST','/api/purchases',{
   supplierId:supplier.id,discount:0,paidAmount:0,
   items:[{productId:pid,qty:10,unitPrice:20}]
  });
  ok(purchase);
  assert.equal(purchase.dueAmount,200);
  assert.equal(one('SELECT current_stock AS n FROM products WHERE product_id=?',pid).n,10);
  assert.equal(one('SELECT current_due AS n FROM suppliers WHERE supplier_id=?',supplier.id).n,200);
  const bought=one("SELECT lot_id,remaining_quantity,unit_cost FROM stock_lots WHERE source_ref=? AND source_type='PURCHASE'",purchase.purchaseId);
  assert.ok(bought,'purchase must create an original-cost lot');
  assert.deepEqual([bought.remaining_quantity,bought.unit_cost],[10,20]);

  ok(await api('POST','/api/pos/cash-session/start',{openingCash:0}));
  const salePayload={clientRequestId:'phase5-real-flow-sale-0001',
   customerName:'Life Cycle Customer',customerPhone:'01000007972',
   discount:0,paymentType:'Cash',paymentMethod:'Cash',
   items:[{productId:pid,name:'Life Cycle Socket',qty:4,unitPrice:35,fulfillmentMode:'own'}]};
  const sale=await api('POST','/api/pos/sales',salePayload);
  ok(sale);
  const invoice=sale.invoice.invoiceId;
  assert.equal(sale.invoice.grandTotal,140);
  assert.equal(one('SELECT current_stock AS n FROM products WHERE product_id=?',pid).n,6);
  assert.deepEqual(many('SELECT lot_id,quantity,unit_cost FROM sale_item_lots WHERE invoice_id=?',invoice)
   .map(x=>[x.lot_id,x.quantity,x.unit_cost]),[[bought.lot_id,4,20]]);
  assert.equal(one("SELECT COALESCE(SUM(credit),0) AS n FROM cash_book WHERE type='Sale' AND reference=?",invoice).n,140);
  assert.equal(count('customers'),0,'cash sale must not invent a due-ledger customer');

  const report=(key:string)=>api('GET','/api/reports/v2/rows?report='+key+period);
  let profit=await report('profit');ok(profit);
  assert.equal(profit.coverage.status,'ready',JSON.stringify(profit.coverage));
  assert.equal(metric(profit,'netSales').valueMinor,14000);
  assert.equal(metric(profit,'fifoCogs').valueMinor,8000);
  assert.equal(metric(profit,'grossProfit').valueMinor,6000);
  assert.equal(metric(profit,'netProfit').valueMinor,6000);

  const source=await api('GET','/api/sales-returns/'+invoice+'/data');ok(source);
  const refund=await api('POST','/api/sales-returns',{
   invoiceId:invoice,refundMethod:'Cash',reason:'Damaged product returned',
   items:[{productId:pid,qty:1,unitPrice:35}]
  });
  ok(refund);
  assert.equal(refund.totalReturnAmount,35);
  assert.equal(one('SELECT current_stock AS n FROM products WHERE product_id=?',pid).n,7);
  assert.equal(one('SELECT remaining_quantity AS n FROM stock_lots WHERE lot_id=?',bought.lot_id).n,7);
  assert.equal(one('SELECT SUM(quantity) AS n FROM sales_return_item_lots WHERE invoice_id=?',invoice).n,1);
  assert.equal(one("SELECT SUM(debit) AS n FROM cash_book WHERE type='Sales Return' AND reference=?",refund.returnId).n,35);
  profit=await report('profit');ok(profit);
  assert.equal(profit.coverage.status,'ready',JSON.stringify(profit.coverage));
  for(const [key,cents] of [['grossSales',14000],['returns',3500],
    ['netSales',10500],['fifoCogs',6000],['grossProfit',4500],['netProfit',4500]] as const)
   assert.equal(metric(profit,key).valueMinor,cents,key);
  const stock=await report('stock');ok(stock);
  assert.equal(metric(stock,'inventoryValue').valueMinor,14000,'seven physical units at original BDT20 cost');
  assert.equal(stock.rows.find((r:any)=>r.sourceId===pid)?.amountMinor,14000);
  const beforeReports=one('SELECT total_changes() AS n').n;
  for(const key of ['sales','stock','receivables','payables','profit','cash'])
   ok(await report(key));
  assert.equal(one('SELECT total_changes() AS n').n,beforeReports,'every report must be read-only');

  const settlementPayload={supplierId:supplier.id,amount:50,method:'Cash',
   clientRequestId:crypto.randomUUID(),notes:'Partial supplier pay'};
  const settled=await api('POST','/api/purchases/supplier-settlements',settlementPayload);
  ok(settled);
  assert.equal(one('SELECT current_due AS n FROM suppliers WHERE supplier_id=?',supplier.id).n,150);
  assert.equal(one('SELECT COALESCE(SUM(debit-credit),0) AS n FROM supplier_ledger WHERE supplier_id=?',supplier.id).n,150);
  const payable=await report('payables');ok(payable);
  assert.equal(metric(payable,'payablesBalance').valueMinor,15000);
  const cash=await report('cash');ok(cash);
  assert.equal(metric(cash,'cashReceipts').valueMinor,14000);
  assert.equal(metric(cash,'cashPayments').valueMinor,8500,'return 35 plus supplier settlement 50');
  assert.equal(metric(cash,'cashBookBalance').valueMinor,5500);
  profit=await report('profit');ok(profit);
  assert.equal(metric(profit,'netProfit').valueMinor,4500,'supplier payment settles debt; not profit/expense');
  assert.equal(metric(profit,'operatingExpenses').valueMinor,0);
  // Return unused purchased units after the sale and supplier settlement.
  // The original sold FIFO cost must remain frozen at its purchase value.
  const purchaseReturn=await api('POST','/api/purchase-returns',{
   purchaseId:purchase.purchaseId,refundMethod:'Supplier Credit',
   reason:'Two defective unused units',items:[{productId:pid,qty:2,unitPrice:20}]
  });
  ok(purchaseReturn);
  assert.equal(purchaseReturn.totalReturnAmount,40);
  assert.equal(one('SELECT current_due AS n FROM suppliers WHERE supplier_id=?',supplier.id).n,110);
  assert.equal(one('SELECT COALESCE(SUM(debit-credit),0) AS n FROM supplier_ledger WHERE supplier_id=?',supplier.id).n,110);
  assert.equal(one('SELECT current_stock AS n FROM products WHERE product_id=?',pid).n,5);
  assert.equal(one('SELECT remaining_quantity AS n FROM stock_lots WHERE lot_id=?',bought.lot_id).n,5);
  const payableAfterReturn=await report('payables');ok(payableAfterReturn);
  assert.equal(metric(payableAfterReturn,'payablesBalance').valueMinor,11000,
   'purchase return is supplier credit, not a sale or receipt');
  const stockAfterReturn=await report('stock');ok(stockAfterReturn);
  assert.equal(metric(stockAfterReturn,'inventoryValue').valueMinor,10000);
  profit=await report('profit');ok(profit);
  assert.equal(metric(profit,'netProfit').valueMinor,4500,'purchase credit does not alter historical sold COGS');
  assert.equal(metric((await report('cash')),'cashBookBalance').valueMinor,5500,
   'supplier credit does not manufacture a cash receipt');
  const rejectedDelete=await api('DELETE','/api/purchases/'+purchase.purchaseId,
   {reason:'Cannot delete purchase after stock returned and supplier paid'});
  assert.notEqual(rejectedDelete.status,200,'posted and partly returned purchase cannot be deleted');
  assert.equal(one('SELECT current_due AS n FROM suppliers WHERE supplier_id=?',supplier.id).n,110);
  assert.equal(one('SELECT current_stock AS n FROM products WHERE product_id=?',pid).n,5);

  const replay=await api('POST','/api/purchases/supplier-settlements',settlementPayload);ok(replay);
  assert.equal(replay.idempotent,true);
  assert.equal(one('SELECT current_due AS n FROM suppliers WHERE supplier_id=?',supplier.id).n,110);
  const saleReplay=await api('POST','/api/pos/sales',salePayload);ok(saleReplay);
  assert.equal(saleReplay.invoice.invoiceId,invoice);
  assert.equal(count('sales'),1);
  assert.equal(count('sales_returns'),1);
  assert.equal(count('supplier_settlement_entries'),1);
  assert.equal(count('purchase_returns'),1);
  assert.equal(one('SELECT current_stock AS n FROM products WHERE product_id=?',pid).n,5);
 });
});

test('forced posting error rolls back the entire invoice before reports can see it',async()=>{
 await fixture(async({api,one,count,db})=>{
  const product=await api('POST','/api/products',{
   productName:'Atomic One',category:'Hardware',unit:'Pcs',
   purchasePrice:8,sellingPrice:15,currentStock:2,minimumStock:0,
   status:'Active',trackSerial:false,trackExpiry:false,trackWarranty:false});
  ok(product);
  ok(await api('POST','/api/pos/cash-session/start',{openingCash:0}));
  const pid=product.productId;
  const snapshot=()=>({
   sales:count('sales'),items:count('sale_items'),cash:count('cash_book'),
   stock:one('SELECT current_stock AS n FROM products WHERE product_id=?',pid).n,
   lot:one('SELECT SUM(remaining_quantity) AS n FROM stock_lots WHERE product_id=?',pid).n
  });
  const before=snapshot();
  db.native.exec("CREATE TRIGGER phase5_fail_sale BEFORE INSERT ON sale_items BEGIN SELECT RAISE(ABORT,'phase5-forced-rollback'); END;");
  const payload={clientRequestId:'phase5-rollback-transaction-001',
   customerName:'No Invoice',customerPhone:'01000007973',discount:0,
   paymentType:'Cash',paymentMethod:'Cash',
   items:[{productId:pid,name:'Atomic One',qty:1,unitPrice:15,fulfillmentMode:'own'}]};
  const failed=await api('POST','/api/pos/sales',payload);
  assert.notEqual(failed.status,200,JSON.stringify(failed));
  assert.deepEqual(snapshot(),before,'failed posting must not change sale, cash or FIFO stock');
  assert.equal(one('SELECT COUNT(*) AS n FROM pos_sale_requests WHERE request_id=?',payload.clientRequestId).n,0);
  db.native.exec('DROP TRIGGER phase5_fail_sale');
  const retry=await api('POST','/api/pos/sales',payload);ok(retry);
  assert.equal(count('sales'),1,'failed idempotency key remains retriable after rollback');
  assert.equal(one('SELECT current_stock AS n FROM products WHERE product_id=?',pid).n,1);
  const report=await api('GET','/api/reports/v2/rows?report=profit'+period);ok(report);
  assert.equal(metric(report,'netSales').valueMinor,1500);
  assert.equal(metric(report,'fifoCogs').valueMinor,800);
  assert.equal(metric(report,'grossProfit').valueMinor,700);
 });
});

test('independent concurrent sales cannot consume the same last lot or overstate net sales',async()=>{
 await fixture(async({api,one,db})=>{
  const product=await api('POST','/api/products',{
   productName:'Race Protected',category:'Hardware',unit:'Pcs',
   purchasePrice:12,sellingPrice:30,currentStock:1,minimumStock:0,
   status:'Active',trackSerial:false,trackExpiry:false,trackWarranty:false});
  ok(product);const pid=product.productId;
  ok(await api('POST','/api/pos/cash-session/start',{openingCash:0}));
  const sell=(suffix:string)=>api('POST','/api/pos/sales',{
   clientRequestId:'phase5-race-'+suffix+'-independent',
   customerName:'Race '+suffix,customerPhone:'0100000797'+(suffix==='A'?'4':'5'),
   discount:0,paymentType:'Cash',paymentMethod:'Cash',
   items:[{productId:pid,name:'Race Protected',qty:1,unitPrice:30,fulfillmentMode:'own'}]
  });
  const both=await Promise.all([sell('A'),sell('B')]);
  assert.equal(both.filter(x=>x.status===200).length,1,JSON.stringify(both));
  assert.equal(both.filter(x=>x.status!==200).length,1,JSON.stringify(both));
  assert.equal(one('SELECT current_stock AS n FROM products WHERE product_id=?',pid).n,0);
  assert.equal(one('SELECT SUM(remaining_quantity) AS n FROM stock_lots WHERE product_id=?',pid).n,0);
  assert.equal(one('SELECT COUNT(*) AS n FROM sale_item_lots WHERE product_id=?',pid).n,1);
  const report=await api('GET','/api/reports/v2/rows?report=profit'+period);ok(report);
  assert.equal(report.totalRows,1);
  assert.equal(metric(report,'netSales').valueMinor,3000);
  assert.equal(metric(report,'fifoCogs').valueMinor,1200);
  assert.equal(metric(report,'netProfit').valueMinor,1800);
  const stock=await api('GET','/api/reports/v2/rows?report=stock'+period);ok(stock);
  assert.equal(metric(stock,'inventoryValue').valueMinor,0);
 });
});
