import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';
import {readSalesProfit} from '../server/modules/reporting/live/sales-profit.ts';
import {parseLiveReportQuery} from '../server/modules/reporting/live/query.ts';

function fixture(){
 const db=new SqliteDatabase(':memory:');runMigrations(db.native,resolve('migrations'));
 let token='';
 const api=async(method:string,path:string,body?:unknown)=>{
  const r=await handleApiRequest(new Request('http://local.test'+path,{method,
   headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
   body:body===undefined?undefined:JSON.stringify(body)}),db);
  return {status:r.status,...await r.json() as Record<string,any>};
 };
 const start=async()=>{
  const r=await api('POST','/api/setup/admin',{fullName:'Bundle Posting Admin',phone:'01000006661',password:'BundlePostingTest2026!'});
  assert.equal(r.status,200,JSON.stringify(r));token=r.token;
  const cash=await api('POST','/api/pos/cash-session/start',{openingCash:0});
  assert.equal(cash.status,200,JSON.stringify(cash));
 };
 const stock=(id:string)=>(db.native.prepare('SELECT current_stock FROM products WHERE product_id=?').get(id) as any).current_stock as number;
 return {db,api,start,stock};
}

test('Phase 7E2 business: saved bundle appears on one cash invoice line; mixed-cart physical FIFO and original-source COGS',async()=>{
 const {db,api,start,stock}=fixture();
 try{
  await start();
  const product=db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock,purchase_price,selling_price,status) VALUES (?,?,'Hardware','Pcs',?,?,?,'Active')");
  product.run('WIRE-1','Wire',9,150,800);product.run('SWITCH-1','Switch',3,100,700);
  const lot=db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES (?,?,'PURCHASE',?,?,?)");
  lot.run('W-LOT1','WIRE-1',5,5,20);lot.run('W-LOT2','WIRE-1',4,4,30);lot.run('S-LOT','SWITCH-1',3,3,5);
  const recipe=await api('POST','/api/products/bundle-recipes',{bundleId:'KIT-1',name:'Electrical Repair Kit',sellingPrice:120,
   components:[{productId:'WIRE-1',quantityPerSet:2},{productId:'SWITCH-1',quantityPerSet:1}]});
  assert.equal(recipe.status,200,JSON.stringify(recipe));assert.equal(recipe.revision,1);
  const sale={clientRequestId:'bundlecash-request-001',customerName:'Cash Buyer',customerPhone:'01000002221',
   paymentType:'Cash',paymentMethod:'Cash',items:[
    {productId:'KIT-1',qty:2,unitPrice:120},{productId:'WIRE-1',qty:1,unitPrice:10}]};
  const posted=await api('POST','/api/pos/bundle-sales',sale);
  assert.equal(posted.status,200,JSON.stringify(posted));assert.equal(posted.ok,true);
  assert.equal(posted.replayed,false);assert.equal(posted.grandTotal,250);
  assert.equal(posted.costMinor,11000,'5×৳20 + 2×৳5, all sourced once');
  assert.equal(stock('WIRE-1'),4);assert.equal(stock('SWITCH-1'),1);
  assert.equal(stock('KIT-1'),0,'bundle has no physical stock balance');
  const visible=db.native.prepare('SELECT product_id,quantity,unit_price,line_total FROM sale_items WHERE invoice_id=? ORDER BY id').all(posted.invoiceId) as any[];
  assert.deepEqual(visible.map(x=>[x.product_id,x.quantity,x.unit_price,x.line_total]),[['KIT-1',2,120,240],['WIRE-1',1,10,10]]);
  const recipeLines=db.native.prepare('SELECT bundle_id,revision,component_id,quantity_per_set,sets_sold,component_quantity FROM sale_bundle_components WHERE invoice_id=? ORDER BY component_id').all(posted.invoiceId) as any[];
  assert.deepEqual(recipeLines.map(x=>[x.bundle_id,x.revision,x.component_id,x.quantity_per_set,x.sets_sold,x.component_quantity]),
   [['KIT-1',1,'SWITCH-1',1,2,2],['KIT-1',1,'WIRE-1',2,2,4]]);
  const source=db.native.prepare('SELECT visible_product_id,component_id,lot_id,quantity,cost_minor FROM bundle_sale_allocations WHERE invoice_id=? ORDER BY id').all(posted.invoiceId) as any[];
  assert.deepEqual(source.map(x=>[x.visible_product_id,x.component_id,x.lot_id,x.quantity,x.cost_minor]),
   [['KIT-1','WIRE-1','W-LOT1',4,8000],['WIRE-1','WIRE-1','W-LOT1',1,2000],['KIT-1','SWITCH-1','S-LOT',2,1000]]);
  const profit=db.native.prepare('SELECT product_id,SUM(quantity*unit_cost) c FROM sale_item_lots WHERE invoice_id=? GROUP BY product_id ORDER BY product_id').all(posted.invoiceId) as any[];
  assert.deepEqual(profit.map(x=>[x.product_id,x.c]),[['KIT-1',90],['WIRE-1',20]]);
  const report=await readSalesProfit(db,parseLiveReportQuery(new URL('http://local.test/api/reports/v2/rows?report=profit&from=2026-10-01&to=2026-10-31')));
  assert.equal(report.coverage.status,'ready',report.coverage.reason);
  for(const [key,expected] of Object.entries({grossSales:25000,netSales:25000,fifoCogs:11000,grossProfit:14000,netProfit:14000})){
    const row=report.metrics.find(x=>x.key===key);
    assert.equal(row?.valueMinor,expected,key+': '+(row?.reason||''));
  }

  assert.equal((db.native.prepare("SELECT COUNT(*) n FROM cash_book WHERE reference=? AND type='Sale'").get(posted.invoiceId) as any).n,1);
  assert.equal((db.native.prepare("SELECT credit FROM cash_book WHERE reference=? AND type='Sale'").get(posted.invoiceId) as any).credit,250);
  assert.equal((db.native.prepare('SELECT COUNT(*) n FROM customer_ledger').get() as any).n,0);
  assert.equal((db.native.prepare('SELECT COUNT(*) n FROM vendor_sourcing').get() as any).n,0);
  const before=(db.native.prepare('SELECT total_changes() n').get() as any).n;
  const replay=await api('POST','/api/pos/bundle-sales',sale);
  assert.equal(replay.status,200,JSON.stringify(replay));assert.equal(replay.replayed,true);
  assert.equal(replay.invoiceId,posted.invoiceId);
  assert.equal((db.native.prepare('SELECT total_changes() n').get() as any).n,before);
  assert.equal((await api('POST','/api/pos/bundle-sales',{...sale,customerName:'Another Person'})).status,409);
  assert.equal((db.native.prepare('SELECT total_changes() n').get() as any).n,before);
 }finally{db.close();}
});

test('Phase 7E2 business: ordinary POS cannot consume fictitious bundle inventory; disabled returns and reversals fail closed',async()=>{
 const {db,api,start}=fixture();try{
  await start();
  db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock) VALUES ('B-PART','Part','Hardware','Pcs',2)").run();
  db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES ('B-LOT','B-PART','PURCHASE',2,2,10)").run();
  assert.equal((await api('POST','/api/products/bundle-recipes',{bundleId:'B-KIT',name:'Kit',sellingPrice:30,components:[{productId:'B-PART',quantityPerSet:1}]})).status,200);
  const items=[{productId:'B-KIT',name:'Kit',qty:1,unitPrice:30}];
  const cash={clientRequestId:'bundle-cash-guard01',customerName:'A',customerPhone:'01000002229',paymentType:'Cash',paymentMethod:'Cash',items};
  assert.equal((await api('POST','/api/pos/sales',cash)).status,409,'normal POS may not sell virtual bundle');
  const good=await api('POST','/api/pos/bundle-sales',cash);assert.equal(good.status,200,JSON.stringify(good));
  const beforeReturn=(db.native.prepare('SELECT total_changes() n').get() as any).n;
  assert.equal((await api('POST','/api/sales-returns',{invoiceId:good.invoiceId,items:[{productId:'B-KIT',quantity:1}]})).status>=400,true);
  assert.equal((db.native.prepare('SELECT total_changes() n').get() as any).n,beforeReturn,'rejected bundle return must leave zero writes');
  const after=(db.native.prepare('SELECT total_changes() n').get() as any).n;
  const bad=await api('DELETE','/api/sales-management/'+good.invoiceId,{reason:'legacy delete bypass'});
  assert.equal(bad.status>=400,true);
  assert.equal((db.native.prepare('SELECT total_changes() n').get() as any).n,after);
  assert.equal((db.native.prepare('SELECT is_deleted FROM sales WHERE invoice_id=?').get(good.invoiceId) as any).is_deleted,0);
 }finally{db.close();}
});
