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
   return {...await result.json() as Record<string,unknown>,status:result.status} as any;
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
  const budget=await api('GET',
   '/api/purchases/planner/analyze?budgetAmount=60&salesWindowDays=30&targetCoverDays=30');
  safe(budget);
  const funded=budget.rows.filter((r:any)=>r.included&&r.plannedQty>0);
  assert.ok(funded.length>0,'The budget planner should propose available low-stock products');
  assert.ok(funded.reduce((sum:number,r:any)=>sum+r.plannedInvestment,0)<=60.0001,
   'The priority allocator must never exceed the fixed purchase budget');
  assert.ok(funded.every((r:any)=>Number.isInteger(r.plannedQty)&&r.plannedQty>=0));
  const saved=await api('POST','/api/purchases/planner/plans',{
   items:planItems(p1,p2,supplier,supplier),notes:'Original'});
  safe(saved);
  const id=saved.planId;
  safe(await api('PUT','/api/purchases/planner/plans/'+id,{
   items:planItems(p1,p2,supplier,second),notes:'Updated draft'}));
  const listed=await api('GET','/api/purchases/planner/plans');safe(listed);
  assert.ok(listed.plans.some((r:any)=>r.planId===id));
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
  const orderList=await api('GET','/api/purchases/planner/orders');safe(orderList);
  assert.equal(orderList.orders.filter((o:any)=>o.planId===id).length,2);
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
 await fixture(async({api,one,count,db,supplier,second})=>{
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
  const beforeOpening=await api('POST','/api/suppliers',{
   name:'4F Opening Supplier',openingBalance:25});
  assert.notEqual(beforeOpening.status,200,'Opening dues need an active cash session');
  db.native.prepare("INSERT INTO cash_sessions(session_id,opened_by,status) VALUES (?,'TEST','Open')")
   .run('CS-4F-OPENING');
  const opening=await api('POST','/api/suppliers',{
   name:'4F Opening Supplier',openingBalance:25});
  safe(opening);
  assert.equal(one('SELECT current_due AS n FROM suppliers WHERE supplier_id=?',opening.id).n,25);
  assert.equal(one('SELECT SUM(debit-credit) AS n FROM supplier_ledger WHERE supplier_id=?',opening.id).n,25);
  assert.notEqual((await api('DELETE','/api/suppliers/'+opening.id,
   {reason:'Outstanding dues must block deletion'})).status,200);
  assert.equal(one('SELECT is_deleted FROM suppliers WHERE supplier_id=?',opening.id).is_deleted,0);
 });
});

test('4F legacy purchase CRUD: create, view, update and delete exactly reconcile FIFO stock and supplier ledger',async()=>{
 await fixture(async({api,one,count,supplier,p1})=>{
  const lines=(qty:number)=>[{productId:p1.productId,qty,unitPrice:50}];
  const before=()=>({
   due:one('SELECT current_due AS n FROM suppliers WHERE supplier_id=?',supplier.id).n,
   ledger:one('SELECT COALESCE(SUM(debit-credit),0) AS n FROM supplier_ledger WHERE supplier_id=? AND COALESCE(is_deleted,0)=0',supplier.id).n,
   stock:one('SELECT current_stock AS n FROM products WHERE product_id=?',p1.productId).n,
   lot:one("SELECT COALESCE(SUM(remaining_quantity),0) AS n FROM stock_lots WHERE product_id=? AND source_type='PURCHASE'",p1.productId).n
  });
  for(const input of [{supplierId:supplier.id,items:[]},
   {supplierId:supplier.id,items:lines(0)},
   {supplierId:supplier.id,items:[lines(1)[0],lines(1)[0]]},
   {supplierId:supplier.id,items:[{productId:p1.productId,qty:-3,unitPrice:50}]}]){
   const r=await api('POST','/api/purchases',input);
   assert.notEqual(r.status,200,JSON.stringify({input,r}));
   assert.deepEqual(before(),{due:0,ledger:0,stock:0,lot:0});
  }
  const purchase=await api('POST','/api/purchases',{supplierId:supplier.id,
   discount:0,paidAmount:0,items:lines(2)});safe(purchase);
  assert.deepEqual(before(),{due:100,ledger:100,stock:2,lot:2});
  const list=await api('GET','/api/purchases');safe(list);
  assert.ok(list.purchases.some((p:any)=>p.purchaseId===purchase.purchaseId));
  const detail=await api('GET','/api/purchases/'+purchase.purchaseId);safe(detail);
  assert.equal(detail.purchase.items[0].quantity,2);
  assert.equal((await api('PUT','/api/purchases/'+purchase.purchaseId,{items:lines(3)})).status!==200,true);
  assert.deepEqual(before(),{due:100,ledger:100,stock:2,lot:2});
  const updated=await api('PUT','/api/purchases/'+purchase.purchaseId,{
   reason:'Count correction',supplierId:supplier.id,discount:0,paidAmount:0,items:lines(3)});
  safe(updated);
  assert.deepEqual(before(),{due:150,ledger:150,stock:3,lot:3});
  const lastLedger=one('SELECT balance AS n FROM supplier_ledger WHERE supplier_id=? AND COALESCE(is_deleted,0)=0 ORDER BY created_at DESC,ROWID DESC LIMIT 1',supplier.id);
  assert.equal(lastLedger.n,150,'Stored running balance must equal due after purchase edit');
  const updatedView=await api('GET','/api/purchases/'+purchase.purchaseId);safe(updatedView);
  assert.equal(updatedView.purchase.items[0].quantity,3);
  assert.equal(one("SELECT COUNT(*) AS n FROM audit_logs WHERE action='UPDATE_PURCHASE'").n,1);
  assert.equal((await api('DELETE','/api/purchases/'+purchase.purchaseId,{})).status!==200,true);
  assert.deepEqual(before(),{due:150,ledger:150,stock:3,lot:3});
  const deleted=await api('DELETE','/api/purchases/'+purchase.purchaseId,{reason:'Entered in error'});
  safe(deleted);
  assert.deepEqual(before(),{due:0,ledger:0,stock:0,lot:0},'Deletion must reverse master, ledger and FIFO together');
  assert.equal(one("SELECT status FROM purchases WHERE purchase_id=?",purchase.purchaseId).status,'Deleted');
  assert.equal(one("SELECT COUNT(*) AS n FROM audit_logs WHERE action='DELETE_PURCHASE'").n,1);
  assert.equal((await api('GET','/api/purchases/'+purchase.purchaseId)).status!==200,true);
  assert.equal(count('purchase_return_items'),0);
 });
});

test('4F legacy purchase returns: reject duplicate line over-return and rollback before any stock/payable write',async()=>{
 await fixture(async({api,one,count,db,supplier,p1})=>{
  const bought=await api('POST','/api/purchases',{supplierId:supplier.id,
   items:[{productId:p1.productId,qty:3,unitPrice:50}],paidAmount:0,discount:0});safe(bought);
  const balance=()=>({
   due:one('SELECT current_due AS n FROM suppliers WHERE supplier_id=?',supplier.id).n,
   ledger:one('SELECT COALESCE(SUM(debit-credit),0) AS n FROM supplier_ledger WHERE supplier_id=? AND COALESCE(is_deleted,0)=0',supplier.id).n,
   stock:one('SELECT current_stock AS n FROM products WHERE product_id=?',p1.productId).n,
   lot:one("SELECT SUM(remaining_quantity) AS n FROM stock_lots WHERE source_type='PURCHASE' AND source_ref=?",bought.purchaseId).n,
   returns:count('purchase_returns')
  });
  assert.deepEqual(balance(),{due:150,ledger:150,stock:3,lot:3,returns:0});
  const get=await api('GET','/api/purchases/'+bought.purchaseId+'/return-data');safe(get);
  assert.equal(get.purchase.items[0].availableQty,3);
  const make=(items:any[])=>({purchaseId:bought.purchaseId,
   refundMethod:'Supplier Credit',reason:'Damaged on delivery',items});
  const two={productId:p1.productId,qty:2,unitPrice:50};
  const duplicated=await api('POST','/api/purchase-returns',make([two,{...two}]));
  assert.notEqual(duplicated.status,200,'Same product twice must not exceed its source lot');
  assert.deepEqual(balance(),{due:150,ledger:150,stock:3,lot:3,returns:0});
  const first=await api('POST','/api/purchase-returns',make([{productId:p1.productId,qty:1,unitPrice:50}]));
  safe(first);assert.equal(first.totalReturnAmount,50);
  assert.deepEqual(balance(),{due:100,ledger:100,stock:2,lot:2,returns:1});
  const history=await api('GET','/api/purchase-returns');safe(history);
  assert.ok(JSON.stringify(history).includes(first.returnId));
  const excess=await api('POST','/api/purchase-returns',make([{productId:p1.productId,qty:3,unitPrice:50}]));
  assert.notEqual(excess.status,200);
  assert.deepEqual(balance(),{due:100,ledger:100,stock:2,lot:2,returns:1});
  db.native.exec(`CREATE TRIGGER deny_return_insert BEFORE INSERT ON purchase_return_items
    BEGIN SELECT RAISE(ABORT,'synthetic-return-rollback'); END`);
  const failed=await api('POST','/api/purchase-returns',make([{productId:p1.productId,qty:1,unitPrice:50}]));
  assert.notEqual(failed.status,200);
  assert.deepEqual(balance(),{due:100,ledger:100,stock:2,lot:2,returns:1});
  db.native.exec('DROP TRIGGER deny_return_insert');
  const final=await api('POST','/api/purchase-returns',make([{productId:p1.productId,qty:2,unitPrice:50}]));
  safe(final);assert.equal(final.totalReturnAmount,100);
  assert.deepEqual(balance(),{due:0,ledger:0,stock:0,lot:0,returns:2});
  assert.notEqual((await api('PUT','/api/purchases/'+bought.purchaseId,{
   reason:'After return',items:[{productId:p1.productId,qty:4,unitPrice:50}]})).status,200);
  assert.notEqual((await api('DELETE','/api/purchases/'+bought.purchaseId,{reason:'After return'})).status,200);
  assert.equal(one("SELECT COUNT(*) AS n FROM audit_logs WHERE action='PURCHASE_RETURN'").n,2);
 });
});

test('4F money safety: forbid unposted paid purchases, paid edits and cash refunds',async()=>{
 await fixture(async({api,one,count,supplier,p1})=>{
  const state=()=>({
   due:one('SELECT current_due AS n FROM suppliers WHERE supplier_id=?',supplier.id).n,
   ledger:one('SELECT COALESCE(SUM(debit-credit),0) AS n FROM supplier_ledger WHERE supplier_id=?',supplier.id).n,
   stock:one('SELECT current_stock AS n FROM products WHERE product_id=?',p1.productId).n,
   cash:count('cash_book'),bank:count('bank_book'),invoices:count('purchases'),returns:count('purchase_returns')
  });
  const empty={due:0,ledger:0,stock:0,cash:0,bank:0,invoices:0,returns:0};
  const item={productId:p1.productId,qty:2,unitPrice:50};
  const paid=await api('POST','/api/purchases',{
   supplierId:supplier.id,paidAmount:50,paymentMethod:'Cash',discount:0,items:[item]});
  assert.notEqual(paid.status,200,
   'Cannot accept payment without posting corresponding cash/bank book in the same transaction');
  assert.deepEqual(state(),empty);
  const due=await api('POST','/api/purchases',{
   supplierId:supplier.id,paidAmount:0,discount:0,items:[item]});safe(due);
  const unchanged={due:100,ledger:100,stock:2,cash:0,bank:0,invoices:1,returns:0};
  assert.deepEqual(state(),unchanged);
  const edited=await api('PUT','/api/purchases/'+due.purchaseId,{
   reason:'Attempt to mark as paid',supplierId:supplier.id,paidAmount:50,discount:0,items:[item]});
  assert.notEqual(edited.status,200,
   'Editing money fields cannot create fictitious purchase payments');
  assert.deepEqual(state(),unchanged);
  const cashRefund=await api('POST','/api/purchase-returns',{
   purchaseId:due.purchaseId,refundMethod:'Cash',reason:'Returned for cash',
   items:[{productId:p1.productId,qty:1,unitPrice:50}]});
  assert.notEqual(cashRefund.status,200,
   'Cash refund requires a real auditable cash movement, not only a return row');
  assert.deepEqual(state(),unchanged);
 });
});

test('4I Cash: paid purchase posts invoice, full supplier debit, payment credit and cash book atomically',async()=>{
 await fixture(async({api,one,count,db,supplier,p1})=>{
  const requestId=crypto.randomUUID();
  const body={supplierId:supplier.id,paidAmount:40,paymentMethod:'Cash',
   clientRequestId:requestId,items:[{productId:p1.productId,qty:2,unitPrice:50}]};
  const snapshot=()=>({
   due:one('SELECT current_due AS n FROM suppliers WHERE supplier_id=?',supplier.id).n,
   supplierLedger:one('SELECT COALESCE(SUM(debit-credit),0) AS n FROM supplier_ledger WHERE supplier_id=?',supplier.id).n,
   stock:one('SELECT current_stock AS n FROM products WHERE product_id=?',p1.productId).n,
   invoices:count('purchases'),purchaseItems:count('purchase_items'),
   lots:count('stock_lots'),cash:count('cash_book'),bank:count('bank_book')
  });
  const initial=snapshot();
  const closed=await api('POST','/api/purchases',body);
  assert.equal(closed.status,409,'Purchase-time payment requires an open cash session');
  assert.deepEqual(snapshot(),initial,'Session rejection must not post inventory or money');
  db.native.prepare("INSERT INTO cash_sessions(session_id,opened_by,status) VALUES (?,'4I','Open')").run('CS-4I-CASH');
  const purchase=await api('POST','/api/purchases',body);
  safe(purchase);
  assert.equal(purchase.grandTotal,100);
  assert.equal(purchase.dueAmount,60);
  const row=one('SELECT paid_amount AS paid,due_amount AS due,payment_status AS status, payment_request_id AS requestId FROM purchases WHERE purchase_id=?',purchase.purchaseId);
  assert.deepEqual(row,{paid:40,due:60,status:'Partial',requestId});
  assert.deepEqual(snapshot(),{...initial,due:60,supplierLedger:60,stock:2,invoices:1,purchaseItems:1,lots:1,cash:1});
  const entries=db.native.prepare('SELECT ledger_id AS id,type,reference,debit,credit,balance FROM supplier_ledger WHERE supplier_id=? ORDER BY rowid').all(supplier.id) as any[];
  assert.deepEqual(entries.map(x=>[x.type,x.debit,x.credit,x.balance]),[
   ['Purchase',100,0,100],['Purchase Payment',0,40,60]]);
  assert.equal(entries[0].reference,purchase.purchaseId);
  assert.equal(entries[1].reference,purchase.purchaseId);
  assert.deepEqual(one('SELECT type,debit,credit,reference FROM cash_book'),
   {type:'Supplier Payment',debit:40,credit:0,reference:entries[1].id});
  const beforeReplay=snapshot();
  const replay=await api('POST','/api/purchases',body);
  safe(replay);
  assert.equal(replay.idempotent,true);
  assert.equal(replay.purchaseId,purchase.purchaseId);
  assert.deepEqual(snapshot(),beforeReplay,'Retry cannot double-charge or duplicate stock');
  const changed=await api('POST','/api/purchases',{...body,paidAmount:41});
  assert.equal(changed.status,409);
  assert.deepEqual(snapshot(),beforeReplay);
  assert.notEqual((await api('DELETE','/api/purchases/'+purchase.purchaseId,{reason:'Trying to delete a paid purchase'})).status,200);
  assert.notEqual((await api('PUT','/api/purchases/'+purchase.purchaseId,{...body,reason:'Trying to edit a paid purchase'})).status,200);
  assert.deepEqual(snapshot(),beforeReplay);
 });
});

test('4I Bank: insufficient funds and journal failure leave zero partial records; retry posts once',async()=>{
 await fixture(async({api,one,count,db,supplier,p1})=>{
  db.native.prepare("INSERT INTO cash_sessions(session_id,opened_by,status) VALUES (?,'4I','Open')").run('CS-4I-BANK');
  db.native.prepare(`INSERT INTO bank_accounts
   (bank_account_id,account_name,bank_name,opening_balance,current_balance,status,account_type)
   VALUES ('BANK-4I','4I Current','4I Test',200,200,'Active','Bank')`).run();
  const payload={supplierId:supplier.id,clientRequestId:crypto.randomUUID(),
   paidAmount:70,paymentMethod:'Bank',bankAccountId:'BANK-4I',
   items:[{productId:p1.productId,qty:3,unitPrice:100}]};
  const snapshot=()=>({
   due:one('SELECT current_due AS n FROM suppliers WHERE supplier_id=?',supplier.id).n,
   ledger:one('SELECT COALESCE(SUM(debit-credit),0) AS n FROM supplier_ledger WHERE supplier_id=?',supplier.id).n,
   stock:one('SELECT current_stock AS n FROM products WHERE product_id=?',p1.productId).n,
   bankBalance:one('SELECT current_balance AS n FROM bank_accounts WHERE bank_account_id=?','BANK-4I').n,
   purchases:count('purchases'),items:count('purchase_items'),lots:count('stock_lots'),
   bankBook:count('bank_book'),cashBook:count('cash_book'),audits:count('audit_logs')
  });
  const before=snapshot();
  for(const x of [
    {...payload,paidAmount:301,clientRequestId:crypto.randomUUID()},
    {...payload,paidAmount:201,clientRequestId:crypto.randomUUID()},
    {...payload,paidAmount:70.00001,clientRequestId:crypto.randomUUID()},
    {...payload,paymentMethod:'Card',clientRequestId:crypto.randomUUID()},
    {...payload,clientRequestId:'missing'},
    {...payload,bankAccountId:'INVALID',clientRequestId:crypto.randomUUID()}
  ]){
   const response=await api('POST','/api/purchases',x);
   assert.notEqual(response.status,200,JSON.stringify({x,response}));
   assert.deepEqual(snapshot(),before,'Invalid paid purchase cannot affect finance or stock');
  }
  db.native.exec(`CREATE TRIGGER reject_purchase_money_4i BEFORE INSERT ON bank_book
   WHEN NEW.type='Supplier Payment' BEGIN SELECT RAISE(ABORT,'4i-injected-bank-failure'); END;`);
  const failed=await api('POST','/api/purchases',payload);
  assert.notEqual(failed.status,200,'A failed bank journal must block the entire purchase');
  assert.deepEqual(snapshot(),before,'Bank-book failure must roll back stock, invoice, due and bank balances');
  db.native.exec('DROP TRIGGER reject_purchase_money_4i');
  const purchase=await api('POST','/api/purchases',payload);
  safe(purchase);
  assert.deepEqual(snapshot(),{...before,due:230,ledger:230,stock:3,bankBalance:130,
   purchases:1,items:1,lots:1,bankBook:1,cashBook:0,audits:before.audits+1});
  const payment=one("SELECT ledger_id AS id,credit,bank_account_id AS bankAccountId FROM supplier_ledger WHERE type='Purchase Payment'");
  assert.equal(payment.credit,70);
  assert.equal(payment.bankAccountId,'BANK-4I');
  assert.deepEqual(one('SELECT bank_account_id AS bankId,type,reference,debit,credit,balance FROM bank_book'),
   {bankId:'BANK-4I',type:'Supplier Payment',reference:payment.id,debit:70,credit:0,balance:130});
  const stable=snapshot();
  const [oneReplay,twoReplay]=await Promise.all([
   api('POST','/api/purchases',payload),api('POST','/api/purchases',payload)]);
  safe(oneReplay);safe(twoReplay);
  assert.equal(oneReplay.purchaseId,purchase.purchaseId);
  assert.equal(twoReplay.purchaseId,purchase.purchaseId);
  assert.deepEqual(snapshot(),stable,'Concurrent retries cannot double-post invoices or cash movements');
 });
});

test('4I business: reject a due purchase when supplier master and ledger disagree',async()=>{
 await fixture(async({api,db,one,count,supplier,p1})=>{
  const first=await api('POST','/api/purchases',{supplierId:supplier.id,paidAmount:0,
   items:[{productId:p1.productId,qty:2,unitPrice:50}]});
  safe(first);
  db.native.prepare('UPDATE suppliers SET current_due=? WHERE supplier_id=?').run(95,supplier.id);
  const snapshot=()=>({
   master:one('SELECT current_due AS n FROM suppliers WHERE supplier_id=?',supplier.id).n,
   ledger:one('SELECT SUM(debit-credit) AS n FROM supplier_ledger WHERE supplier_id=?',supplier.id).n,
   stock:one('SELECT current_stock AS n FROM products WHERE product_id=?',p1.productId).n,
   invoices:count('purchases'),lines:count('purchase_items'),lots:count('stock_lots'),
   movements:count('stock_movements'),audit:count('audit_logs')
  });
  const before=snapshot();
  assert.equal(before.master,95);assert.equal(before.ledger,100);
  const invalid=await api('POST','/api/purchases',{supplierId:supplier.id,paidAmount:0,
   items:[{productId:p1.productId,qty:1,unitPrice:50}]});
  assert.equal(invalid.status,409,'Unreconciled supplier cannot receive another purchase invoice');
  assert.deepEqual(snapshot(),before,'Rejected purchase must not change any journal or stock');
 });
});

test('4I functions: invalid discounts must not silently change purchase invoice totals',async()=>{
 await fixture(async({api,one,count,supplier,p1})=>{
  const snapshot=()=>({
   due:one('SELECT current_due AS n FROM suppliers WHERE supplier_id=?',supplier.id).n,
   ledger:count('supplier_ledger'),
   stock:one('SELECT current_stock AS n FROM products WHERE product_id=?',p1.productId).n,
   purchases:count('purchases'),lots:count('stock_lots'),audit:count('audit_logs')
  });
  const before=snapshot();
  const base={supplierId:supplier.id,paidAmount:0,items:[{productId:p1.productId,qty:2,unitPrice:50}]};
  for(const discount of [-1,0.00001,101,'10',null]){
   const result=await api('POST','/api/purchases',{...base,discount});
   assert.equal(result.status,400,'Invalid discount '+String(discount)+' cannot post');
   assert.deepEqual(snapshot(),before,'Invalid discount cannot alter inventory or money');
  }
  const valid=await api('POST','/api/purchases',{...base,discount:10});
  safe(valid);
  assert.equal(valid.grandTotal,90);
  assert.equal(valid.dueAmount,90);
  assert.equal(one('SELECT discount AS n FROM purchases WHERE purchase_id=?',valid.purchaseId).n,10);
  assert.equal(one('SELECT current_due AS n FROM suppliers WHERE supplier_id=?',supplier.id).n,90);
 });
});

test('4I accounting: multiple purchases reconcile supplier, bank, cash and FIFO by hand',async()=>{
 await fixture(async({api,db,one,supplier,p1})=>{
  db.native.prepare("INSERT INTO cash_sessions(session_id,opened_by,status) VALUES (?,'4I','Open')")
   .run('CS-4I-ACCOUNT');
  db.native.prepare(`INSERT INTO bank_accounts
   (bank_account_id,account_name,bank_name,opening_balance,current_balance,status,account_type)
   VALUES ('BANK-4I-ACCOUNT','Current','4I Bank',500,500,'Active','Bank')`).run();
  const due=await api('POST','/api/purchases',{supplierId:supplier.id,paidAmount:0,
   items:[{productId:p1.productId,qty:2,unitPrice:50}]});safe(due);
  const cash=await api('POST','/api/purchases',{supplierId:supplier.id,paidAmount:40,
   clientRequestId:crypto.randomUUID(),paymentMethod:'Cash',discount:10,
   items:[{productId:p1.productId,qty:1,unitPrice:80}]});safe(cash);
  const bank=await api('POST','/api/purchases',{supplierId:supplier.id,paidAmount:90,
   clientRequestId:crypto.randomUUID(),paymentMethod:'Bank',bankAccountId:'BANK-4I-ACCOUNT',
   items:[{productId:p1.productId,qty:3,unitPrice:40}]});safe(bank);
  assert.deepEqual([due.grandTotal,cash.grandTotal,bank.grandTotal],[100,70,120]);
  assert.deepEqual([due.dueAmount,cash.dueAmount,bank.dueAmount],[100,30,30]);
  const ledger=db.native.prepare('SELECT type,debit,credit,balance FROM supplier_ledger WHERE supplier_id=? ORDER BY rowid')
   .all(supplier.id) as Array<{type:string;debit:number;credit:number;balance:number}>;
  assert.deepEqual(ledger.map(x=>[x.type,x.debit,x.credit,x.balance]),[
   ['Purchase',100,0,100],['Purchase',70,0,170],['Purchase Payment',0,40,130],
   ['Purchase',120,0,250],['Purchase Payment',0,90,160]
  ]);
  assert.equal(one('SELECT current_due AS n FROM suppliers WHERE supplier_id=?',supplier.id).n,160);
  assert.equal(one('SELECT SUM(debit-credit) AS n FROM supplier_ledger WHERE supplier_id=?',supplier.id).n,160);
  assert.equal(one('SELECT current_stock AS n FROM products WHERE product_id=?',p1.productId).n,6);
  assert.deepEqual(db.native.prepare("SELECT original_quantity AS n,unit_cost AS cost FROM stock_lots WHERE product_id=? AND source_type='PURCHASE' ORDER BY rowid").all(p1.productId),
   [{n:2,cost:50},{n:1,cost:80},{n:3,cost:40}]);
  assert.equal(one('SELECT SUM(debit-credit) AS n FROM cash_book').n,40);
  assert.equal(one('SELECT current_balance AS n FROM bank_accounts WHERE bank_account_id=?','BANK-4I-ACCOUNT').n,410);
  assert.equal(one('SELECT SUM(debit-credit) AS n FROM bank_book WHERE bank_account_id=?','BANK-4I-ACCOUNT').n,90);
  assert.deepEqual(db.native.prepare('SELECT paid_amount AS paid,due_amount AS due,payment_status AS status FROM purchases ORDER BY rowid').all(),
   [{paid:0,due:100,status:'Due'},{paid:40,due:30,status:'Partial'},{paid:90,due:30,status:'Partial'}]);
 });
});

test('4F historical paid purchase cannot be deleted without reversing its posted supplier payment',async()=>{
 await fixture(async({api,one,count,db,supplier,p1})=>{
  const p=await api('POST','/api/purchases',{supplierId:supplier.id,paidAmount:0,discount:0,
   items:[{productId:p1.productId,qty:2,unitPrice:50}]});safe(p);
  db.native.prepare("INSERT INTO cash_sessions(session_id,opened_by,status) VALUES (?,'TEST','Open')")
   .run('CS-4F-PAID-HISTORY');
  const payment=await api('POST','/api/purchases/supplier-settlements',{
   supplierId:supplier.id,amount:100,method:'Cash',clientRequestId:crypto.randomUUID()});
  safe(payment);
  // Simulate an imported historical invoice whose original paid amount is recorded.
  db.native.prepare("UPDATE purchases SET paid_amount=100,due_amount=0,payment_status='Paid' WHERE purchase_id=?")
   .run(p.purchaseId);
  const snapshot=()=>({
   invoice:one('SELECT status,paid_amount AS paid FROM purchases WHERE purchase_id=?',p.purchaseId),
   stock:one('SELECT current_stock AS n FROM products WHERE product_id=?',p1.productId).n,
   lot:one("SELECT SUM(remaining_quantity) AS n FROM stock_lots WHERE source_ref=? AND source_type='PURCHASE'",p.purchaseId).n,
   due:one('SELECT current_due AS n FROM suppliers WHERE supplier_id=?',supplier.id).n,
   journal:count('supplier_settlement_entries'),cash:count('cash_book')
  });
  const before=snapshot();
  assert.equal(before.invoice.paid,100);assert.equal(before.due,0);assert.equal(before.cash,1);
  const attempt=await api('DELETE','/api/purchases/'+p.purchaseId,{
   reason:'A paid purchase must use audited reversal'});
  assert.notEqual(attempt.status,200,'Do not erase paid inventory while retaining cash outflow');
  assert.deepEqual(snapshot(),before,'Refused deletion must not alter cash, FIFO or supplier records');
 });
});

test('4F authorization: every purchase and supplier financial route denies anonymous access',async()=>{
 await fixture(async({db,one,count})=>{
  const endpoints:Array<[string,string]>=[
   ['GET','/api/purchases/supplier-search?q=hardware'],
   ['GET','/api/purchases'],['POST','/api/purchases'],
   ['GET','/api/purchases/PUR-UNKNOWN'],['PUT','/api/purchases/PUR-UNKNOWN'],
   ['DELETE','/api/purchases/PUR-UNKNOWN'],
   ['GET','/api/purchases/PUR-UNKNOWN/return-data'],
   ['GET','/api/purchase-returns'],['POST','/api/purchase-returns'],
   ['GET','/api/purchases/unit-profile/PRD-UNKNOWN'],
   ['GET','/api/purchases/planner/analyze'],
   ['GET','/api/purchases/planner/plans'],['POST','/api/purchases/planner/plans'],
   ['GET','/api/purchases/planner/plans/PPL-UNKNOWN'],
   ['PUT','/api/purchases/planner/plans/PPL-UNKNOWN'],
   ['DELETE','/api/purchases/planner/plans/PPL-UNKNOWN'],
   ['POST','/api/purchases/planner/plans/PPL-UNKNOWN/approve'],
   ['POST','/api/purchases/planner/plans/PPL-UNKNOWN/reject'],
   ['GET','/api/purchases/planner/orders'],
   ['GET','/api/purchases/planner/orders/SPO-UNKNOWN'],
   ['GET','/api/purchases/planner/orders/SPO-UNKNOWN/convert-data'],
   ['POST','/api/purchases/supplier-settlements'],
   ['GET','/api/purchases/supplier-settlements/supplier/SUP-UNKNOWN'],
   ['POST','/api/purchases/supplier-settlements/SET-UNKNOWN/reverse'],
   ['GET','/api/suppliers'],['POST','/api/suppliers'],
   ['GET','/api/suppliers/SUP-UNKNOWN'],['PUT','/api/suppliers/SUP-UNKNOWN'],
   ['DELETE','/api/suppliers/SUP-UNKNOWN'],
   ['PUT','/api/suppliers/SUP-UNKNOWN/status'],
   ['POST','/api/suppliers/SUP-UNKNOWN/payments'],
   ['GET','/api/supplier-payments/PAY-UNKNOWN'],
   ['PUT','/api/supplier-payments/PAY-UNKNOWN'],
   ['DELETE','/api/supplier-payments/PAY-UNKNOWN']
  ];
  const before=[count('purchases'),count('purchase_returns'),count('purchase_plans'),
   count('supplier_ledger'),count('supplier_settlement_entries'),count('cash_book'),
   count('bank_book')];
  for(const [method,path] of endpoints){
   const request=new Request('http://phase4-auth.local'+path,{
    method,headers:{'content-type':'application/json'},
    body:method==='GET'?undefined:'{}'
   });
   const response=await handleApiRequest(request,db);
   assert.equal(response.status,401,method+' '+path+' must require login');
  }
  assert.deepEqual([count('purchases'),count('purchase_returns'),count('purchase_plans'),
   count('supplier_ledger'),count('supplier_settlement_entries'),count('cash_book'),
   count('bank_book')],before,'Rejected requests must leave every financial journal untouched');
 });
});
