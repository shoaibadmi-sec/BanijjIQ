import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';
import {prorateOriginalPurchaseMicro} from '../server/modules/purchases/mixedReturn.service.ts';

const id=()=>crypto.randomUUID();
test('Phase 4C original-cost cumulative refund is exact after repeated partial returns',()=>{
 const micro=10001n,original=3;
 let returned=0,total=0n;
 for(let i=0;i<3;i++){
  const x=prorateOriginalPurchaseMicro(micro,original,returned,1);
  total+=x;returned++;
 }
 assert.equal(total,micro);
 assert.deepEqual([prorateOriginalPurchaseMicro(micro,3,0,1),
  prorateOriginalPurchaseMicro(micro,3,1,1),
  prorateOriginalPurchaseMicro(micro,3,2,1)],[3334n,3333n,3334n]);
 assert.throws(()=>prorateOriginalPurchaseMicro(micro,3,3,1));
 assert.throws(()=>prorateOriginalPurchaseMicro(micro,3,0,-1));
});
test('Phase 4C complete mixed original-lot stock, supplier-credit and concurrency through isolated API',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));
  let token='';
  async function api(method:string,path:string,body?:unknown,auth=token){
   const headers:Record<string,string>={'content-type':'application/json'};
   if(auth)headers.authorization='Bearer '+auth;
   const response=await handleApiRequest(new Request('http://phase4c.local'+path,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body)}),db);
   return {status:response.status,...await response.json() as Record<string,any>};
  }
  const admin=await api('POST','/api/setup/admin',{
   fullName:'Mixed Return Tester',phone:'01000009371',password:'Phase4C-Synthetic-Password!'});
  assert.equal(admin.status,200,JSON.stringify(admin));token=admin.token;
  const supplier=await api('POST','/api/suppliers',{name:'Phase4C Supplier',openingBalance:0});
  assert.equal(supplier.status,200,JSON.stringify(supplier));
  const product=await api('POST','/api/products',{
    productName:'Phase4C Pipe',category:'Hardware',unit:'Pcs',barcode:'P4C-PIPE-001',
    currentStock:0,purchasePrice:10,sellingPrice:20,minimumStock:0,
    status:'Active',trackSerial:false,trackExpiry:false,trackWarranty:false});
  assert.equal(product.status,200,JSON.stringify(product));const pid=product.productId;
  const units=[{unit:'Carton',symbol:'CT',containsNext:12,sellingPrice:2400},
   {unit:'Box',symbol:'BX',containsNext:20,sellingPrice:200},
   {unit:'Pcs',symbol:'PCS',sellingPrice:20}];
  const p=await api('PUT','/api/products/'+pid+'/unit-profile',{expectedRevision:0,units});
  assert.equal(p.status,200,JSON.stringify(p));
  const bought=await api('POST','/api/purchases',{supplierId:supplier.id,
   paidAmount:0,discount:0,items:[{productId:pid,unitProfileRevision:1,
    unitQuantities:{Carton:1,Box:2,Pcs:3},priceUnit:'Carton',unitPrice:2400}]});
  assert.equal(bought.status,200,JSON.stringify(bought));
  const sourceId=bought.purchaseId;
  const sql=(query:string,...args:unknown[])=>(db.native.prepare(query).get(...args)) as any;
  const state=()=>({
   stock:sql('SELECT current_stock AS n FROM products WHERE product_id=?',pid).n,
   lot:sql("SELECT remaining_quantity AS n FROM stock_lots WHERE source_ref=? AND source_type='PURCHASE'",sourceId).n,
   due:sql('SELECT current_due AS n FROM suppliers WHERE supplier_id=?',supplier.id).n,
   returns:sql('SELECT COUNT(*) AS n FROM purchase_returns').n,
   allocations:sql('SELECT COUNT(*) AS n FROM purchase_unit_return_allocations').n
  });
  assert.deepEqual(state(),{stock:283,lot:283,due:2830,returns:0,allocations:0});
  const preview=await api('GET','/api/purchases/'+sourceId+'/return-data');
  assert.equal(preview.status,200,JSON.stringify(preview));
  assert.equal(preview.purchase.items[0].unitSnapshot.profile.units[0].factor,240);
  assert.equal(preview.purchase.items[0].availableQty,283);
  const make=(requestId:string,unitQuantities:Record<string,number>)=>({
   purchaseId:sourceId,refundMethod:'Supplier Credit',reason:'Quality inspection',
   clientRequestId:requestId,items:[{productId:pid,unitQuantities}]});
  const firstId=id(),firstPayload=make(firstId,{Box:1,Pcs:2});
  for(const bad of [
   {...firstPayload,clientRequestId:''},
   {...firstPayload,refundMethod:'Cash'},
   {...firstPayload,items:[{productId:pid,unitQuantities:{Box:1},returnPrice:0.01}]},
   {...firstPayload,items:[{productId:pid,unitQuantities:{Unknown:1}}]},
   {...firstPayload,items:[{productId:pid,unitQuantities:{Carton:2}}]}
  ]){
   const result=await api('POST','/api/purchase-returns',bad);
   assert.notEqual(result.status,200,JSON.stringify({bad,result}));
   assert.deepEqual(state(),{stock:283,lot:283,due:2830,returns:0,allocations:0});
  }
  const first=await api('POST','/api/purchase-returns',firstPayload);
  assert.equal(first.status,200,JSON.stringify(first));
  assert.equal(first.totalReturnAmount,220);
  assert.deepEqual(state(),{stock:261,lot:261,due:2610,returns:1,allocations:1});
  assert.equal(sql('SELECT balance AS n FROM supplier_ledger WHERE reference=?',first.returnId).n,2610);
  assert.equal(sql('SELECT return_micro AS n FROM purchase_unit_return_allocations WHERE return_id=?',first.returnId).n,2200000);
  const replay=await api('POST','/api/purchase-returns',firstPayload);
  assert.equal(replay.status,200,JSON.stringify(replay));
  assert.equal(replay.returnId,first.returnId);
  assert.equal(replay.idempotent,true);
  assert.deepEqual(state(),{stock:261,lot:261,due:2610,returns:1,allocations:1});
  const changedRequest=await api('POST','/api/purchase-returns',make(firstId,{Box:1}));
  assert.equal(changedRequest.status,409);
  const snapshotBefore=state();
  db.native.exec(`CREATE TRIGGER fail_4c_atomic BEFORE INSERT ON purchase_unit_return_allocations
   BEGIN SELECT RAISE(ABORT,'forced-atomic-test'); END;`);
  const rolled=await api('POST','/api/purchase-returns',make(id(),{Pcs:1}));
  assert.equal(rolled.status,409,JSON.stringify(rolled));
  assert.deepEqual(state(),snapshotBefore,'return header and all stock changes must roll back');
  db.native.exec('DROP TRIGGER fail_4c_atomic');
  // Original cost and conversion must not change after the product unit profile changes.
  const changed=await api('PUT','/api/products/'+pid+'/unit-profile',{expectedRevision:1,
   units:units.map(u=>u.unit==='Carton'?{...u,containsNext:10}:u)});
  assert.equal(changed.status,200,JSON.stringify(changed));
  const afterChange=await api('GET','/api/purchases/'+sourceId+'/return-data');
  assert.equal(afterChange.purchase.items[0].unitSnapshot.profile.units[0].factor,240);
  assert.equal(afterChange.purchase.items[0].availableQty,261);
  const [race1,race2]=await Promise.all([
   api('POST','/api/purchase-returns',make(id(),{Carton:1})),
   api('POST','/api/purchase-returns',make(id(),{Carton:1}))
  ]);
  const accepted=[race1,race2].filter(x=>x.status===200);
  const rejected=[race1,race2].filter(x=>x.status!==200);
  assert.equal(accepted.length,1,JSON.stringify({race1,race2}));
  assert.equal(rejected.length,1,JSON.stringify({race1,race2}));
  assert.equal(accepted[0].totalReturnAmount,2400);
  assert.deepEqual(state(),{stock:21,lot:21,due:210,returns:2,allocations:2});
  const final=await api('POST','/api/purchase-returns',make(id(),{Box:1,Pcs:1}));
  assert.equal(final.status,200,JSON.stringify(final));
  assert.equal(final.totalReturnAmount,210);
  assert.deepEqual(state(),{stock:0,lot:0,due:0,returns:3,allocations:3});
  assert.equal(sql('SELECT COALESCE(SUM(return_micro),0) AS n FROM purchase_unit_return_allocations').n,28300000);
  assert.equal(sql('SELECT COALESCE(SUM(credit),0) AS n FROM supplier_ledger WHERE type=?',
    'Mixed Purchase Return Credit').n,2830);
  assert.equal(sql('SELECT returned_amount AS n FROM purchases WHERE purchase_id=?',sourceId).n,2830);
  const beyond=await api('POST','/api/purchase-returns',make(id(),{Pcs:1}));
  assert.equal(beyond.status,409,JSON.stringify(beyond));
  assert.deepEqual(state(),{stock:0,lot:0,due:0,returns:3,allocations:3});
 }finally{db.close();}
});
