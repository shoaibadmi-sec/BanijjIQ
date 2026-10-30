import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

// Real authenticated Hono routes + full disposable SQLite/D1-compatible schema; no mocked accounting.
async function fixture(run:(f:{
  api:(method:string,path:string,body?:unknown)=>Promise<any>;
  one:(statement:string,...args:any[])=>any;
  count:(table:string)=>number;
  db:SqliteDatabase;
  supplier:{id:string};
  second:{id:string};
  p1:{productId:string};
  p2:{productId:string};
})=>Promise<void>){
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));
  let token='';
  async function api(method:string,path:string,body?:unknown){
   const headers:Record<string,string>={'content-type':'application/json'};
   if(token)headers.authorization='Bearer '+token;
   const result=await handleApiRequest(new Request('http://purchase4f.local'+path,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body)}),db);
   return {status:result.status,...await result.json() as Record<string,unknown>} as any;
  }
  const one=(statement:string,...args:any[])=>db.native.prepare(statement).get(...args) as any;
  const count=(table:string)=>one('SELECT COUNT(*) AS n FROM '+table).n as number;
  const admin=await api('POST','/api/setup/admin',{
   fullName:'Phase4F Testing',phone:'01000009498',password:'Phase4F-Accounting-Testing!'});
  assert.equal(admin.status,200,JSON.stringify(admin));token=admin.token;
  const supplier=await api('POST','/api/suppliers',{name:'4F Bolts Supply'});
  const second=await api('POST','/api/suppliers',{name:'4F Pipes Supply'});
  assert.equal(supplier.status,200,JSON.stringify(supplier));
  assert.equal(second.status,200,JSON.stringify(second));
  async function product(name:string,cost:number,minimum:number){
   const r=await api('POST','/api/products',{
    productName:name,category:'Hardware',unit:'Pcs',barcode:'P4F-'+minimum,
    purchasePrice:cost,sellingPrice:cost*1.3,currentStock:0,minimumStock:minimum,
    status:'Active',trackSerial:false,trackExpiry:false,trackWarranty:false});
   assert.equal(r.status,200,JSON.stringify(r));return r;
  }
  const p1=await product('4F Fastener',50,10),p2=await product('4F Fitting',30,8);
  await run({api,one,count,db,supplier,second,p1,p2});
 }finally{db.close();}
}
const planItems=(a:any,b:any,s1:any,s2:any)=>[
 {productId:a.productId,plannedQty:4,included:true,supplierId:s1.id},
 {productId:b.productId,plannedQty:2,included:true,supplierId:s2.id}
];
const safe=(a:any)=>assert.equal(a.status,200,JSON.stringify(a));

test('4F planner: draft edit, inactive supplier approval hold, approve/reject/delete preserve all accounting',async()=>{
 await fixture(async({api,one,count,supplier,second,p1,p2})=>{
  for(const bad of [{items:[]},{items:[{productId:p1.productId,plannedQty:0,supplierId:supplier.id}]}]){
   const r=await api('POST','/api/purchases/planner/plans',bad);
   assert.notEqual(r.status,200,JSON.stringify(r));
  }
  assert.equal(count('purchase_plans'),0);
  assert.equal((await api('GET','/api/purchases/planner/plans/UNKNOWN')).status,404);
  assert.equal((await api('GET','/api/purchases/planner/orders/UNKNOWN')).status,404);
  assert.equal((await api('GET','/api/purchases/planner/orders/UNKNOWN/convert-data')).status,404);
  const saved=await api('POST','/api/purchases/planner/plans',{
   items:planItems(p1,p2,supplier,supplier),notes:'Original'});
  safe(saved);
  const id=saved.planId;
  safe(await api('PUT','/api/purchases/planner/plans/'+id,{
   items:planItems(p1,p2,supplier,second),notes:'Updated draft'}));
  const draft=await api('GET','/api/purchases/planner/plans/'+id);safe(draft);
  assert.equal(draft.plan.status,'Draft');assert.equal(draft.plan.notes,'Updated draft');
  assert.deepEqual(new Set(draft.items.map((i:any)=>i.supplierId)),new Set([supplier.id,second.id]));
  assert.notEqual((await api('POST','/api/purchases/planner/plans/'+id+'/reject',{})).status,200);
  const active=await api('PUT','/api/suppliers/'+second.id+'/status',{status:'Inactive'});safe(active);
  const blocked=await api('POST','/api/purchases/planner/plans/'+id+'/approve',{});
  assert.notEqual(blocked.status,200,'Cannot approve purchase order for inactive supplier');
  assert.equal(count('purchase_plan_orders'),0,'Invalid approval writes zero orders');
  assert.equal(one('SELECT status FROM purchase_plans WHERE plan_id=?',id).status,'Draft');
  safe(await api('PUT','/api/suppliers/'+second.id+'/status',{status:'Active'}));
  const approved=await api('POST','/api/purchases/planner/plans/'+id+'/approve',{});safe(approved);
  assert.equal(approved.orders.length,2);
  assert.equal(count('purchase_plan_orders'),2);
  assert.equal((await api('POST','/api/purchases/planner/plans/'+id+'/approve',{})).status!==200,true);
  assert.notEqual((await api('PUT','/api/purchases/planner/plans/'+id,{
   items:planItems(p1,p2,supplier,second)})).status,200);
  assert.notEqual((await api('DELETE','/api/purchases/planner/plans/'+id,{reason:'Not without rejection'})).status,200);
  const order=await api('GET','/api/purchases/planner/orders/'+approved.orders[0].orderId);
  safe(order);assert.equal(order.order.items.length,1);
  const rejection=await api('POST','/api/purchases/planner/plans/'+id+'/reject',{reason:'No longer required'});
  safe(rejection);
  assert.equal(one('SELECT status FROM purchase_plans WHERE plan_id=?',id).status,'Rejected');
  assert.equal(one('SELECT COUNT(*) AS n FROM purchase_plan_orders WHERE status=\'Cancelled\'').n,2);
  assert.notEqual((await api('GET','/api/purchases/planner/orders/'+approved.orders[0].orderId+'/convert-data')).status,200);
  assert.equal(count('purchases'),0);assert.equal(count('stock_lots'),0);
  assert.equal(one('SELECT COALESCE(SUM(current_due),0) AS n FROM suppliers').n,0);
  safe(await api('DELETE','/api/purchases/planner/plans/'+id,{reason:'Cancelled planned orders'}));
  assert.equal(count('purchase_plans'),0);assert.equal(count('purchase_plan_orders'),0);
  assert.equal(count('purchase_plan_order_items'),0);assert.equal(count('purchase_plan_items'),0);
  for(const action of ['CREATE_PURCHASE_PLAN','UPDATE_PURCHASE_PLAN','APPROVE_PURCHASE_PLAN',
   'REJECT_PURCHASE_PLAN','DELETE_PURCHASE_PLAN']){
   assert.equal(one('SELECT COUNT(*) AS n FROM audit_logs WHERE action=?',action).n,1,action);
  }
 });
});

test('4F planner: failure in second order item rolls back full approval and can be retried',async()=>{
 await fixture(async({api,one,count,db,supplier,second,p1,p2})=>{
  const saved=await api('POST','/api/purchases/planner/plans',{
   items:planItems(p1,p2,supplier,second)});safe(saved);
  db.native.exec(`CREATE TRIGGER deny_order_line BEFORE INSERT ON purchase_plan_order_items
   WHEN NEW.product_id='${p2.productId}'
   BEGIN SELECT RAISE(ABORT,'synthetic-order-rollback'); END`);
  const result=await api('POST','/api/purchases/planner/plans/'+saved.planId+'/approve',{});
  assert.notEqual(result.status,200,JSON.stringify(result));
  assert.equal(count('purchase_plan_orders'),0);
  assert.equal(count('purchase_plan_order_items'),0);
  assert.equal(one('SELECT status FROM purchase_plans WHERE plan_id=?',saved.planId).status,'Draft');
  assert.equal(one("SELECT COUNT(*) AS n FROM audit_logs WHERE action='APPROVE_PURCHASE_PLAN'").n,0);
  db.native.exec('DROP TRIGGER deny_order_line');
  const retried=await api('POST','/api/purchases/planner/plans/'+saved.planId+'/approve',{});
  safe(retried);assert.equal(retried.orders.length,2);
 });
});

test('4F planner: partially converted plan cannot be rejected/deleted, both supplier payables reconcile',async()=>{
 await fixture(async({api,one,count,supplier,second,p1,p2})=>{
  const saved=await api('POST','/api/purchases/planner/plans',{
   items:planItems(p1,p2,supplier,second)});safe(saved);
  const approved=await api('POST','/api/purchases/planner/plans/'+saved.planId+'/approve',{});safe(approved);
  for(const [index,order] of approved.orders.entries()){
   const converted=await api('GET','/api/purchases/planner/orders/'+order.orderId+'/convert-data');
   safe(converted);
   const r=await api('POST','/api/purchases',{supplierId:order.supplierId,
    purchasePlanOrderId:order.orderId,discount:0,paidAmount:0,
    items:converted.purchase.items.map((item:any)=>({
     productId:item.productId,qty:item.quantity,unitPrice:item.unitPrice}))});
   safe(r);
   assert.equal(one('SELECT status FROM purchase_plans WHERE plan_id=?',saved.planId).status,
    index===0?'Partially Converted':'Converted');
   assert.notEqual((await api('POST','/api/purchases/planner/plans/'+saved.planId+'/reject',
    {reason:'Already purchased'})).status,200);
   assert.notEqual((await api('DELETE','/api/purchases/planner/plans/'+saved.planId,
    {reason:'Already purchased'})).status,200);
   assert.notEqual((await api('POST','/api/purchases',{supplierId:order.supplierId,
    purchasePlanOrderId:order.orderId,discount:0,paidAmount:0,
    items:converted.purchase.items.map((item:any)=>({
     productId:item.productId,qty:item.quantity,unitPrice:item.unitPrice}))})).status,200);
  }
  assert.equal(count('purchases'),2);
  for(const s of [supplier,second]){
   const due=one('SELECT current_due AS n FROM suppliers WHERE supplier_id=?',s.id).n;
   const ledger=one('SELECT COALESCE(SUM(debit-credit),0) AS n FROM supplier_ledger WHERE supplier_id=?',s.id).n;
   assert.equal(due,ledger);
  }
  assert.equal(one('SELECT SUM(remaining_quantity) AS n FROM stock_lots WHERE source_type=\'PURCHASE\'').n,6);
  assert.equal(one('SELECT COUNT(*) AS n FROM audit_logs WHERE action=\'CREATE_PURCHASE\'').n,2);
 });
});

test('4F supplier CRUD: invalid status and duplicate names must not modify master or payable',async()=>{
 await fixture(async({api,one,count,supplier,second})=>{
  const search=await api('GET','/api/suppliers');safe(search);
  assert.ok(search.suppliers.some((s:any)=>s.id===supplier.id));
  assert.equal((await api('POST','/api/suppliers',{name:'  '})).status!==200,true);
  assert.equal((await api('POST','/api/suppliers',{name:'4f bolts supply'})).status,409);
  const wrongStatus=await api('PUT','/api/suppliers/'+supplier.id+'/status',{status:'BAN'});
  assert.notEqual(wrongStatus.status,200,'Unknown status must not silently deactivate supplier');
  assert.equal(one('SELECT status FROM suppliers WHERE supplier_id=?',supplier.id).status,'Active');
  assert.equal((await api('PUT','/api/suppliers/'+supplier.id,{name:'4F Pipes Supply'})).status,409);
  safe(await api('PUT','/api/suppliers/'+supplier.id,{
   name:'4F Fasteners Wholesale',phone:'01700000990',address:'Dhaka',notes:'Synthetic'}));
  const detail=await api('GET','/api/suppliers/'+supplier.id);safe(detail);
  assert.equal(detail.supplier.name,'4F Fasteners Wholesale');
  assert.notEqual((await api('DELETE','/api/suppliers/'+second.id,{})).status,200);
  safe(await api('DELETE','/api/suppliers/'+second.id,{reason:'Unneeded supplier'}));
  assert.equal((await api('GET','/api/suppliers/'+second.id)).status,404);
  assert.equal(one('SELECT is_deleted FROM suppliers WHERE supplier_id=?',second.id).is_deleted,1);
  assert.equal(one("SELECT COUNT(*) AS n FROM audit_logs WHERE action='DELETE_SUPPLIER'").n,1);
  assert.equal(count('purchases'),0);assert.equal(count('supplier_settlement_entries'),0);
 });
});
