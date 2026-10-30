import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

test('4E approved plan converts exactly once to matching FIFO purchase and supplier due',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));
  let token='';
  async function api(method:string,path:string,body?:unknown){
   const headers:Record<string,string>={'content-type':'application/json'};
   if(token)headers.authorization='Bearer '+token;
   const response=await handleApiRequest(new Request('http://local.4e'+path,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body)}),db);
   return {status:response.status,...await response.json() as Record<string,any>};
  }
  const admin=await api('POST','/api/setup/admin',{fullName:'Order Tester',
   phone:'01000009450',password:'Phase4E-Testing-Password!'});
  assert.equal(admin.status,200,JSON.stringify(admin));token=admin.token;
  const supplier=await api('POST','/api/suppliers',{name:'4E Hardware Wholesale'});
  assert.equal(supplier.status,200,JSON.stringify(supplier));
  const second=await api('POST','/api/suppliers',{name:'4E Other Wholesale'});
  assert.equal(second.status,200,JSON.stringify(second));
  const prod=await api('POST','/api/products',{productName:'4E Anchor Bolt',category:'Hardware',
   unit:'Pcs',barcode:'4E-BOLT',purchasePrice:50,sellingPrice:75,currentStock:0,
   minimumStock:8,status:'Active',trackSerial:false,trackExpiry:false,trackWarranty:false});
  assert.equal(prod.status,200,JSON.stringify(prod));
  const prod2=await api('POST','/api/products',{productName:'4E Cement Fitting',category:'Hardware',
   unit:'Pcs',barcode:'4E-FIT',purchasePrice:30,sellingPrice:40,currentStock:0,
   minimumStock:5,status:'Active',trackSerial:false,trackExpiry:false,trackWarranty:false});
  assert.equal(prod2.status,200,JSON.stringify(prod2));
  const analyze=await api('GET','/api/purchases/planner/analyze');
  assert.equal(analyze.status,200,JSON.stringify(analyze));
  assert.ok(analyze.rows.some((r:any)=>r.productId===prod.productId));
  const plansBefore=await api('GET','/api/purchases/planner/plans');
  assert.equal(plansBefore.status,200);
  const save=await api('POST','/api/purchases/planner/plans',{notes:'4E safe conversion',
   items:[{productId:prod.productId,supplierId:supplier.id,plannedQty:4,included:true},
    {productId:prod2.productId,supplierId:supplier.id,plannedQty:2,included:true}]});
  assert.equal(save.status,200,JSON.stringify(save));
  const planId=save.planId;
  const draft=await api('GET','/api/purchases/planner/plans/'+planId);
  assert.equal(draft.status,200);assert.equal(draft.plan.status,'Draft');
  assert.equal(draft.items.length,2);
  const approve=await api('POST','/api/purchases/planner/plans/'+planId+'/approve',{});
  assert.equal(approve.status,200,JSON.stringify(approve));
  const orderId=approve.orders[0].orderId;
  const sql=(q:string,...args:unknown[])=>(db.native.prepare(q).get(...args)) as any;
  assert.equal((await api('POST','/api/purchases/planner/plans/'+planId+'/approve',{})).status!==200,true);
  const approvedOrder=await api('GET','/api/purchases/planner/orders/'+orderId);
  assert.equal(approvedOrder.status,200);assert.equal(approvedOrder.order.status,'Open');
  const data=await api('GET','/api/purchases/planner/orders/'+orderId+'/convert-data');
  assert.equal(data.status,200,JSON.stringify(data));
  assert.equal(data.purchase.purchasePlanOrderId,orderId);
  const due=()=>sql('SELECT current_due n FROM suppliers WHERE supplier_id=?',supplier.id).n;
  const count=()=>sql('SELECT COUNT(*) n FROM purchases').n;
  assert.equal(count(),0);assert.equal(due(),0);
  const payload={supplierId:supplier.id,purchasePlanOrderId:orderId,discount:0,paidAmount:0,
   items:data.purchase.items.map((i:any)=>({productId:i.productId,qty:i.quantity,unitPrice:i.unitPrice}))};
  for(const bad of [
   {...payload,supplierId:second.id},
   {...payload,items:[payload.items[0]]},
   {...payload,items:[{...payload.items[0],qty:payload.items[0].qty+1},payload.items[1]]},
   {...payload,items:[{...payload.items[0],qty:payload.items[0].qty+1},payload.items[1],{productId:prod.productId,qty:1,unitPrice:50}]},
   {...payload,purchasePlanOrderId:'SPO-DOES-NOT-EXIST'}
  ]){
   const response=await api('POST','/api/purchases',bad);
   assert.notEqual(response.status,200,JSON.stringify({bad,response}));
   assert.equal(count(),0);assert.equal(due(),0);
  }
  const [one,two]=await Promise.all([api('POST','/api/purchases',payload),api('POST','/api/purchases',payload)]);
  assert.equal([one,two].filter(x=>x.status===200).length,1,JSON.stringify({one,two}));
  const accepted=[one,two].find(x=>x.status===200)!;
  assert.equal(accepted.grandTotal,260);
  assert.equal(count(),1);assert.equal(due(),260);
  assert.equal(sql('SELECT COALESCE(SUM(debit-credit),0) n FROM supplier_ledger WHERE supplier_id=?',supplier.id).n,260);
  assert.equal(sql("SELECT status s FROM purchase_plan_orders WHERE order_id=?",orderId).s,'Converted');
  assert.equal(sql('SELECT converted_purchase_id p FROM purchase_plan_orders WHERE order_id=?',orderId).p,accepted.purchaseId);
  assert.equal(sql('SELECT status s FROM purchase_plans WHERE plan_id=?',planId).s,'Converted');
  assert.equal(sql('SELECT SUM(quantity) n FROM purchase_items WHERE purchase_id=?',accepted.purchaseId).n,6);
  assert.equal(sql("SELECT SUM(remaining_quantity) n FROM stock_lots WHERE source_type='PURCHASE' AND source_ref=?",accepted.purchaseId).n,6);
  assert.equal(sql('SELECT current_stock n FROM products WHERE product_id=?',prod.productId).n,4);
  assert.equal((await api('GET','/api/purchases/planner/orders/'+orderId+'/convert-data')).status!==200,true);
  assert.equal((await api('PUT','/api/purchases/'+accepted.purchaseId,{...payload,reason:'Mutate source'})).status!==200,true);
  assert.equal((await api('DELETE','/api/purchases/'+accepted.purchaseId,{reason:'Unsafe deletion'})).status!==200,true);
  assert.equal((await api('POST','/api/purchases',payload)).status!==200,true);
  assert.equal(count(),1);assert.equal(due(),260);
 }finally{db.close();}
});
