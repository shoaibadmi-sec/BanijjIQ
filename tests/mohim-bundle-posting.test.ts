import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.js';
import { runMigrations } from '../server/db/migrate.js';
import { createBundle, updateBundle } from '../server/modules/products/bundles.service.js';
import {
  completeSaleRoute, completeSalesReturnRoute, deleteSaleRoute, getInvoiceRoute,
  getSaleReturnDataRoute, getPosBootstrapRoute, getSaleUpdateDataRoute, updateSaleRoute
} from '../server/modules/sales/service.js';
import { completeSalesReturnBatchRoute } from '../server/modules/sales/batchReturns.service.js';
import { getProfitReportRoute,getDashboardRoute } from '../server/modules/reporting/service.js';

const user={userId:'USR-BUNDLE',fullName:'Bundle Tester',phone:'',role:'admin',status:'Active'};
const config={productName:'Tubewell Set',brand:'',category:'Plumbing',barcode:'B-001',sellingPrice:15000,
 components:[{productId:'P-1',quantityPerSet:5},{productId:'P-2',quantityPerSet:10},{productId:'P-3',quantityPerSet:1}]};
const today=new Date().toISOString().slice(0,10);
function setup(){
  const db=new SqliteDatabase(':memory:');
  const m=runMigrations(db.native,resolve('migrations'));
  assert.equal(m.applied.length,30);
  db.native.prepare('INSERT INTO app_users (user_id,full_name,phone,password_hash,password_salt) VALUES (?,?,?,?,?)')
    .run(user.userId,user.fullName,'01700000199','hash','salt');
  db.native.prepare("INSERT INTO cash_sessions (session_id,opened_by,status,opening_cash) VALUES (?,?, 'Open',0)")
    .run('CS-B',user.userId);
  const ins=db.native.prepare(`INSERT INTO products
    (product_id,product_name,category,unit,purchase_price,selling_price,current_stock,status)
    VALUES (?,?,?,?,?,?,?,'Active')`);
  ins.run('P-1','Pipe','Plumbing','Pcs',50,100,30);
  ins.run('P-2','Elbow','Plumbing','Pcs',5,10,15);
  ins.run('P-3','Motor','Plumbing','Pcs',2000,3000,4);
  const lot=db.native.prepare(`INSERT INTO stock_lots
    (lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost,status)
    VALUES (?,?,'PURCHASE','PO-X',?,?,?,'Active')`);
  lot.run('LOT-PIPE','P-1',30,30,50);
  lot.run('LOT-ELBOW','P-2',15,15,5);
  lot.run('LOT-MOTOR','P-3',4,4,2000);
  return db;
}
async function bundle(db:SqliteDatabase){
  const res=await createBundle(db,config,user);
  assert.equal(res.status,200,JSON.stringify(await res.clone().json()));
  return (await res.json() as any).productId as string;
}
async function sale(db:SqliteDatabase,items:Array<{productId:string;name:string;qty:number;unitPrice:number}>,opts:Record<string,unknown>={}){
 return completeSaleRoute(db,{
   customerName:'Test Buyer',customerPhone:'01700001111',paymentType:'Cash',paymentMethod:'Cash',
   items,...opts
 } as any,user);
}
const stock=(db:SqliteDatabase,pid:string)=>Number((db.native.prepare('SELECT current_stock AS stock FROM products WHERE product_id=?').get(pid) as any).stock);
const lotBalance=(db:SqliteDatabase,id:string)=>Number((db.native.prepare('SELECT remaining_quantity AS n FROM stock_lots WHERE lot_id=?').get(id) as any).n);
const count=(db:SqliteDatabase,table:string)=>Number((db.native.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as any).n);

test('whole bundle sale produces one invoice line, component FIFO, oversold provenance and independent revenue',async()=>{
  const db=setup();
  try{
    const id=await bundle(db);
    const bootstrap=await (await getPosBootstrapRoute(db,user)).json() as any;
    const listed=bootstrap.products.find((x:any)=>x.id===id);
    assert.equal(listed.productType,'Bundle');
    assert.equal(listed.stock,1);
    assert.equal(listed.unit,'Set');
    const response=await sale(db,[{productId:id,name:'Tubewell Set',qty:2,unitPrice:15000}]);
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    const invoice=(await response.json() as any).invoice.invoiceId;
    assert.equal(count(db,'sales'),1);
    const items=db.native.prepare('SELECT product_id,quantity,unit_price,line_total,sold_product_type FROM sale_items').all() as any[];
    assert.deepEqual(items,[{product_id:id,quantity:2,unit_price:15000,line_total:30000,sold_product_type:'Bundle'}]);
    assert.equal(stock(db,id),0);
    assert.deepEqual([stock(db,'P-1'),stock(db,'P-2'),stock(db,'P-3')],[20,-5,2]);
    assert.deepEqual([lotBalance(db,'LOT-PIPE'),lotBalance(db,'LOT-ELBOW'),lotBalance(db,'LOT-MOTOR')],[20,0,2]);
    const oversold=db.native.prepare("SELECT remaining_quantity,original_quantity FROM stock_lots WHERE product_id='P-2' AND source_type='OVERSOLD'").get() as any;
    assert.deepEqual(oversold,{remaining_quantity:-5,original_quantity:0});
    const components=db.native.prepare('SELECT component_id,revision,quantity_per_set,component_quantity FROM sale_bundle_components ORDER BY id').all() as any[];
    assert.deepEqual(components.map(x=>[x.component_id,x.revision,x.quantity_per_set,x.component_quantity]),
      [['P-1',1,5,10],['P-2',1,10,20],['P-3',1,1,2]]);
    const costs=db.native.prepare('SELECT product_id,quantity,unit_cost,source_sale_product_id FROM sale_item_lots ORDER BY id').all() as any[];
    assert.equal(costs.reduce((sum,x)=>sum+x.quantity*x.unit_cost,0),10*50+20*5+2*2000);
    assert.ok(costs.every(x=>x.source_sale_product_id===id));
    assert.equal((await (await getInvoiceRoute(db,invoice)).json() as any).invoice.items[0].soldProductType,'Bundle');
    const retData=(await (await getSaleReturnDataRoute(db,invoice)).json() as any).sale;
    assert.equal(retData.items.find((x:any)=>x.productId===id).availableQty,2);
    assert.deepEqual(db.native.pragma('foreign_key_check'),[]);
  }finally{db.close();}
});

test('standalone product and bundle share one virtual FIFO balance with no double-consumption',async()=>{
  const db=setup();
  try{
    const id=await bundle(db);
    const r=await sale(db,[
      {productId:'P-1',name:'Pipe',qty:25,unitPrice:100},
      {productId:id,name:'Tubewell Set',qty:1,unitPrice:15000}
    ]);
    assert.equal(r.status,200,JSON.stringify(await r.clone().json()));
    assert.equal(stock(db,'P-1'),0);
    assert.equal(lotBalance(db,'LOT-PIPE'),0);
    const rows=db.native.prepare("SELECT quantity,source_sale_product_id FROM sale_item_lots WHERE product_id='P-1' ORDER BY id").all() as any[];
    assert.deepEqual(rows,[{quantity:25,source_sale_product_id:'P-1'}, {quantity:5,source_sale_product_id:id}]);
    assert.equal(count(db,'sale_items'),2,'bundle remains one item plus standalone Pipe');
    // Ordinary return may not steal the bundle's component lots.
    const inv=(await r.json() as any).invoice.invoiceId;
    const returned=await completeSalesReturnRoute(db,{invoiceId:inv,refundMethod:'Cash',reason:'Unwanted pipe',
      items:[{productId:'P-1',qty:5,unitPrice:100}]},user);
    assert.equal(returned.status,200,JSON.stringify(await returned.clone().json()));
    assert.equal(lotBalance(db,'LOT-PIPE'),5);
    assert.equal(stock(db,'P-1'),5);
    assert.equal((db.native.prepare("SELECT SUM(quantity) AS n FROM sale_return_bundle_lots").get() as any).n,null);
  }finally{db.close();}
});

test('bundle returns only integral sets and restores exact lots including oversold negative inventory once',async()=>{
  const db=setup();
  try{
    const id=await bundle(db),response=await sale(db,[{productId:id,name:'Tubewell Set',qty:2,unitPrice:15000}]);
    assert.equal(response.status,200);
    const invoice=(await response.json() as any).invoice.invoiceId;
    const invalid=await completeSalesReturnRoute(db,{invoiceId:invoice,refundMethod:'Cash',reason:'wrong quantity',
      items:[{productId:id,qty:0.5,unitPrice:15000}]},user);
    assert.equal(invalid.status,400);
    assert.equal(count(db,'sales_returns'),0);
    for(let n=1;n<=2;n++){
      const returned=await completeSalesReturnRoute(db,{invoiceId:invoice,refundMethod:'Cash',reason:'Unwanted set',
        items:[{productId:id,qty:1,unitPrice:15000}]},user);
      assert.equal(returned.status,200,JSON.stringify(await returned.clone().json()));
    }
    assert.deepEqual([stock(db,'P-1'),stock(db,'P-2'),stock(db,'P-3')],[30,15,4]);
    assert.deepEqual([lotBalance(db,'LOT-PIPE'),lotBalance(db,'LOT-ELBOW'),lotBalance(db,'LOT-MOTOR')],[30,15,4]);
    assert.equal(Number((db.native.prepare("SELECT remaining_quantity AS n FROM stock_lots WHERE source_type='OVERSOLD'").get() as any).n),0);
    const summary=db.native.prepare('SELECT COUNT(*) AS returns, SUM(total_return_amount) AS total FROM sales_returns').get() as any;
    assert.equal(summary.returns,2);
    assert.equal(summary.total,30000);
    const rows=db.native.prepare('SELECT return_quantity,sold_product_type FROM sales_return_items').all() as any[];
    assert.ok(rows.every(x=>x.return_quantity===1&&x.sold_product_type==='Bundle'));
    const duplicate=await completeSalesReturnRoute(db,{invoiceId:invoice,refundMethod:'Cash',reason:'Third attempt',
      items:[{productId:id,qty:1,unitPrice:15000}]},user);
    assert.equal(duplicate.status,400);
    assert.equal(count(db,'sales_returns'),2);
    assert.deepEqual(db.native.pragma('foreign_key_check'),[]);
  }finally{db.close();}
});

test('cash refund is source-paid limited; store credit posts customer ledger without partial writes',async()=>{
  const db=setup();
  try{
    const id=await bundle(db);
    const response=await sale(db,[{productId:id,name:'Tubewell Set',qty:1,unitPrice:15000}],{paymentType:'Due'});
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    const invoice=(await response.json() as any).invoice.invoiceId;
    assert.equal((await completeSalesReturnRoute(db,{invoiceId:invoice,refundMethod:'Cash',reason:'Refund',
      items:[{productId:id,qty:1,unitPrice:15000}]},user)).status,400);
    assert.equal(count(db,'sales_returns'),0);
    const returned=await completeSalesReturnRoute(db,{invoiceId:invoice,refundMethod:'Store Credit',reason:'Refund',
      items:[{productId:id,qty:1,unitPrice:15000}]},user);
    assert.equal(returned.status,200,JSON.stringify(await returned.clone().json()));
    assert.equal(stock(db,'P-2'),15);
    const customer=db.native.prepare("SELECT current_due AS due FROM customers WHERE phone='01700001111'").get() as any;
    assert.equal(customer.due,0);
    assert.equal((db.native.prepare("SELECT COUNT(*) AS n FROM customer_ledger WHERE type='Sales Return Credit'").get() as any).n,1);
  }finally{db.close();}
});

test('sale delete reverses physical FIFO and payment once; post-return delete and edits are rejected',async()=>{
  const db=setup();
  try{
    const id=await bundle(db);
    const response=await sale(db,[{productId:id,name:'Tubewell Set',qty:2,unitPrice:15000}]);
    assert.equal(response.status,200);
    const invoice=(await response.json() as any).invoice.invoiceId;
    const edit=await updateSaleRoute(db,invoice,{reason:'Attempted edit'},user);
    assert.equal(edit.status,400);
    assert.equal((await getSaleUpdateDataRoute(db,invoice)).status,400);
    const deleted=await deleteSaleRoute(db,invoice,'Corrected invoice',user);
    assert.equal(deleted.status,200,JSON.stringify(await deleted.clone().json()));
    assert.deepEqual([stock(db,'P-1'),stock(db,'P-2'),stock(db,'P-3')],[30,15,4]);
    assert.equal((db.native.prepare("SELECT COUNT(*) AS n FROM cash_book WHERE reference=? AND is_deleted=1").get(invoice) as any).n,1);
    assert.equal((db.native.prepare("SELECT is_deleted AS n FROM sales WHERE invoice_id=?").get(invoice) as any).n,1);
    assert.equal((await deleteSaleRoute(db,invoice,'Again',user)).status,404);
    assert.deepEqual(db.native.pragma('foreign_key_check'),[]);
    const second=await sale(db,[{productId:id,name:'Tubewell Set',qty:1,unitPrice:15000}]);
    const secondId=(await second.json() as any).invoice.invoiceId;
    const refund=await completeSalesReturnRoute(db,{invoiceId:secondId,refundMethod:'Cash',reason:'Returned',
      items:[{productId:id,qty:1,unitPrice:15000}]},user);
    assert.equal(refund.status,200);
    assert.equal((await deleteSaleRoute(db,secondId,'Not safe',user)).status,400);
  }finally{db.close();}
});

test('historical recipe stays immutable when bundle is edited after first sale',async()=>{
  const db=setup();
  try{
    const id=await bundle(db);
    const original=await sale(db,[{productId:id,name:'Tubewell Set',qty:1,unitPrice:15000}]);
    assert.equal(original.status,200);
    const invoice=(await original.json() as any).invoice.invoiceId;
    const update=await updateBundle(db,id,{...config,expectedRevision:1,
      components:[{productId:'P-1',quantityPerSet:7},{productId:'P-2',quantityPerSet:2},{productId:'P-3',quantityPerSet:1}]},user);
    assert.equal(update.status,200,JSON.stringify(await update.clone().json()));
    assert.equal((await update.json() as any).revision,2);
    const historic=db.native.prepare('SELECT revision,quantity_per_set FROM sale_bundle_components WHERE invoice_id=? AND component_id=?').get(invoice,'P-2') as any;
    assert.deepEqual(historic,{revision:1,quantity_per_set:10});
    const returned=await completeSalesReturnRoute(db,{invoiceId:invoice,refundMethod:'Cash',reason:'Old recipe return',
      items:[{productId:id,qty:1,unitPrice:15000}]},user);
    assert.equal(returned.status,200,JSON.stringify(await returned.clone().json()));
    assert.equal(stock(db,'P-2'),15,'return restores original recipe, not edited one');
  }finally{db.close();}
});

test('customer batch return rejects any bundle invoice with no partial postings',async()=>{
  const db=setup();
  try{
    const id=await bundle(db);
    const a=await sale(db,[{productId:id,name:'Tubewell Set',qty:1,unitPrice:15000}],{paymentType:'Due'});
    const b=await sale(db,[{productId:id,name:'Tubewell Set',qty:1,unitPrice:15000}],{paymentType:'Due'});
    const ai=(await a.json() as any).invoice.invoiceId,bi=(await b.json() as any).invoice.invoiceId;
    const customer=(db.native.prepare("SELECT customer_id FROM customers WHERE phone='01700001111'").get() as any).customer_id;
    const result=await completeSalesReturnBatchRoute(db,{customerId:customer,reason:'Batch',refundMethod:'Store Credit',
      invoices:[
        {invoiceId:ai,items:[{productId:id,qty:1,unitPrice:15000}]},
        {invoiceId:bi,items:[{productId:id,qty:1,unitPrice:15000}]}
      ]},user);
    assert.equal(result.status,400);
    assert.equal(count(db,'sales_returns'),0);
    assert.equal(count(db,'sale_return_bundle_lots'),0);
  }finally{db.close();}
});


test('bundle FIFO COGS is attributed to the visible kit, and exact returned-lot COGS reverses in profit reports',async()=>{
  const db=setup();
  try{
    const id=await bundle(db);
    const response=await sale(db,[{productId:id,name:'Tubewell Set',qty:2,unitPrice:15000}]);
    assert.equal(response.status,200);
    const invoice=(await response.json() as any).invoice.invoiceId;
    async function report(){
      const value=await getProfitReportRoute(db,new URL('https://test.local/api/reports/profit?from='+today+'&to='+today));
      assert.equal(value.status,200);
      return await value.json() as any;
    }
    let result=await report();
    assert.equal(result.totals.netRevenue,30000);
    assert.equal(result.totals.cogs,4600);
    assert.equal(result.totals.grossProfit,25400);
    assert.equal(result.byProduct.length,1,'no phantom negative-cost component-only product rows');
    assert.equal(result.byProduct[0].productId,id);
    assert.equal(result.byProduct[0].cost,4600);
    assert.equal(result.byProduct[0].profit,25400);
    const returned=await completeSalesReturnRoute(db,{invoiceId:invoice,refundMethod:'Cash',reason:'One set returned',
      items:[{productId:id,qty:1,unitPrice:15000}]},user);
    assert.equal(returned.status,200);
    result=await report();
    assert.equal(result.totals.netRevenue,15000);
    assert.equal(result.totals.cogs,2300);
    assert.equal(result.totals.grossProfit,12700);
    assert.equal(result.byProduct[0].cost,2300);
    assert.equal(result.byProduct[0].profit,12700);
    const dashboard=await (await getDashboardRoute(db,user)).json() as any;
    assert.equal(dashboard.todayCogs,2300);
    assert.equal(dashboard.todayGrossProfit,12700);
  }finally{db.close();}
});

test('mixed standalone-and-bundle sales keep independent parent-level profit buckets',async()=>{
 const db=setup();
 try{
  const id=await bundle(db);
  const response=await sale(db,[
    {productId:'P-1',name:'Pipe',qty:25,unitPrice:100},
    {productId:id,name:'Tubewell Set',qty:1,unitPrice:15000}
  ]);
  assert.equal(response.status,200);
  const rr=await getProfitReportRoute(db,new URL('https://test.local/api/reports/profit?from='+today+'&to='+today));
  const result=await rr.json() as any;
  const byProduct=new Map(result.byProduct.map((p:any)=>[p.productId,p]));
  assert.equal(result.totals.cogs,3550);
  assert.equal((byProduct.get('P-1') as any).cost,1250);
  assert.equal((byProduct.get(id) as any).cost,2300);
  assert.equal(result.totals.netRevenue,17500);
  assert.equal(result.totals.grossProfit,13950);
  assert.equal(result.byProduct.length,2);
 }finally{db.close();}
});


test('stale FIFO snapshot aborts entire sale if another cashier changes a lot before atomic posting',async()=>{
 const db=setup();
 try{
  const id=await bundle(db),original=db.batch.bind(db);
  let injected=false;
  (db as any).batch=async(statements:any[])=>{
   if(!injected){
    injected=true;
    db.native.prepare("UPDATE stock_lots SET remaining_quantity=29 WHERE lot_id='LOT-PIPE'").run();
   }
   return original(statements);
  };
  await assert.rejects(()=>sale(db,[{productId:id,name:'Tubewell Set',qty:1,unitPrice:15000}]),
    /NOT NULL|constraint|failed/i);
  assert.equal(count(db,'sales'),0,'all invoice and product mutations must roll back');
  assert.equal(count(db,'sale_item_lots'),0);
  assert.equal(stock(db,'P-1'),30);
  assert.equal(lotBalance(db,'LOT-PIPE'),29,'only the simulated competing mutation remains');
 }finally{db.close();}
});

test('stale FIFO snapshot aborts an entire bundle return if a lot changes after planning',async()=>{
 const db=setup();
 try{
  const id=await bundle(db),posted=await sale(db,[{productId:id,name:'Tubewell Set',qty:1,unitPrice:15000}]);
  assert.equal(posted.status,200);
  const invoice=(await posted.json() as any).invoice.invoiceId;
  const original=db.batch.bind(db);
  let injected=false;
  (db as any).batch=async(statements:any[])=>{
   if(!injected){
    injected=true;
    db.native.prepare("UPDATE stock_lots SET remaining_quantity=24 WHERE lot_id='LOT-PIPE'").run();
   }
   return original(statements);
  };
  await assert.rejects(()=>completeSalesReturnRoute(db,{invoiceId:invoice,refundMethod:'Cash',reason:'Return kit',
    items:[{productId:id,qty:1,unitPrice:15000}]},user),/NOT NULL|constraint|failed/i);
  assert.equal(count(db,'sales_returns'),0,'return header and refunded money must roll back');
  assert.equal(count(db,'sale_return_bundle_lots'),0);
  assert.equal(stock(db,'P-1'),25);
  assert.equal(lotBalance(db,'LOT-PIPE'),24);
 }finally{db.close();}
});
