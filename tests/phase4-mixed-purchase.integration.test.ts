import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';
import {buildUnitProfile} from '../server/modules/products/unitProfile.ts';
import {quotePurchaseUnits} from '../server/modules/purchases/purchaseUnits.ts';

test('4B unit quote: 2–4 chains, selected price unit and unsafe quantities',()=>{
 const profile=buildUnitProfile({units:[
  {unit:'Carton',symbol:'CT',containsNext:12},{unit:'Box',symbol:'BX',containsNext:20},
  {unit:'Pcs',symbol:'PCS'}]},'Pcs',10);
 const q=quotePurchaseUnits(profile,1,{Carton:1,Box:2,Pcs:3},'Carton',2400);
 assert.equal(q.baseQuantity,283);assert.equal(q.lineTotal,2830);
 assert.equal(q.baseUnitCost,10);assert.equal(q.description,'1 CT 2 BX 3 PCS');
 assert.equal(quotePurchaseUnits(profile,1,{Box:2},'Box',180).lineTotal,360);
 const four=buildUnitProfile({units:[
  {unit:'Pallet',symbol:'PL',containsNext:10},{unit:'Carton',symbol:'CT',containsNext:12},
  {unit:'Box',symbol:'BX',containsNext:20},{unit:'Pcs',symbol:'PCS'}]},'Pcs',10);
 assert.equal(quotePurchaseUnits(four,1,{Pallet:1,Pcs:5},'Pallet',24000).baseQuantity,2405);
 for(const m of [{Carton:-1},{Carton:1.5},{Carton:0},{Unknown:1},{Carton:Infinity}])
  assert.throws(()=>quotePurchaseUnits(profile,1,m as Record<string,number>,'Carton',2400));
 assert.throws(()=>quotePurchaseUnits(profile,1,{Carton:1},'Missing',2400));
 assert.throws(()=>quotePurchaseUnits(profile,0,{Carton:1},'Carton',2400));
 assert.throws(()=>quotePurchaseUnits(profile,1,{Carton:1},'Carton',NaN));
});
test('4B isolated full-migration accounting and revision guard',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));
  let bearer='';
  async function api(method:string,path:string,body?:unknown,auth=bearer){
   const headers:Record<string,string>={'content-type':'application/json'};
   if(auth)headers.authorization='Bearer '+auth;
   const r=await handleApiRequest(new Request('http://isolated.test'+path,{method,headers,
    body:body===undefined?undefined:JSON.stringify(body)}),db);
   return {status:r.status,...await r.json() as Record<string,any>};
  }
  assert.equal((await api('GET','/api/purchases/unit-profile/missing',undefined,'')).status,401);
  const admin=await api('POST','/api/setup/admin',{
   fullName:'4B Synthetic Admin',phone:'01000007890',password:'Phase4BSynthetic!'
  });
  assert.equal(admin.status,200,JSON.stringify(admin));bearer=admin.token;
  const supplier=await api('POST','/api/suppliers',{name:'4B Test Wholesaler',openingBalance:0});
  assert.equal(supplier.status,200,JSON.stringify(supplier));
  const prod=await api('POST','/api/products',{
   productName:'4B Profile Cable',category:'Electrical',unit:'Pcs',
   barcode:'4B-PROFILE-CABLE',purchasePrice:10,sellingPrice:20,currentStock:0,
   minimumStock:0,status:'Active',trackSerial:false,trackExpiry:false,trackWarranty:false
  });
  assert.equal(prod.status,200,JSON.stringify(prod));
  const id=prod.productId;
  const units=[{unit:'Carton',symbol:'CT',containsNext:12,sellingPrice:2400},
   {unit:'Box',symbol:'BX',containsNext:20,sellingPrice:200},
   {unit:'Pcs',symbol:'PCS',sellingPrice:20}];
  const created=await api('PUT','/api/products/'+id+'/unit-profile',{expectedRevision:0,units});
  assert.equal(created.status,200,JSON.stringify(created));
  const fetched=await api('GET','/api/purchases/unit-profile/'+id);
  assert.equal(fetched.status,200);
  assert.equal(fetched.revision,1);
  assert.deepEqual(fetched.profile.units.map((x:any)=>x.factor),[240,20,1]);
  const item={productId:id,unitProfileRevision:1,unitQuantities:{Carton:1,Box:2,Pcs:3},
    priceUnit:'Carton',unitPrice:2400};
  const payload={supplierId:supplier.id,paidAmount:0,discount:0,items:[item]};
  const sql=(q:string,...args:unknown[])=>db.native.prepare(q).get(...args) as any;
  const snapshot=()=>({
   stock:sql('SELECT current_stock n FROM products WHERE product_id=?',id).n,
   purchases:sql('SELECT COUNT(*) n FROM purchases').n,
   lots:sql("SELECT COUNT(*) n FROM stock_lots WHERE source_type='PURCHASE'").n,
   payable:sql('SELECT current_due n FROM suppliers WHERE supplier_id=?',supplier.id).n
  });
  const zero=snapshot();
  for(const changes of [
   {unitProfileRevision:0},{unitProfileRevision:3},{unitQuantities:{Carton:0}},
   {unitQuantities:{Carton:1.1}},{unitQuantities:{Bad:1}},
   {priceUnit:'Missing'}, {qty:284}, {unitPrice:-2}
  ]){
   const bad=await api('POST','/api/purchases',{...payload,items:[{...item,...changes}]});
   assert.notEqual(bad.status,200,JSON.stringify({changes,bad}));
   assert.deepEqual(snapshot(),zero,'rejected purchase must preserve stock, due and FIFO');
  }
  const posted=await api('POST','/api/purchases',payload);
  assert.equal(posted.status,200,JSON.stringify(posted));
  assert.equal(posted.grandTotal,2830);
  const line=sql('SELECT quantity,purchase_price,line_total FROM purchase_items WHERE purchase_id=?',posted.purchaseId);
  assert.deepEqual([line.quantity,line.purchase_price,line.line_total],[283,10,2830]);
  const lot=sql('SELECT lot_id,remaining_quantity,unit_cost FROM stock_lots WHERE source_ref=?',posted.purchaseId);
  assert.equal(lot.remaining_quantity,283);assert.equal(lot.unit_cost,10);
  const snap=sql('SELECT * FROM purchase_unit_snapshots WHERE purchase_id=?',posted.purchaseId);
  assert.equal(snap.profile_revision,1);assert.equal(snap.lot_id,lot.lot_id);
  assert.equal(snap.description,'1 CT 2 BX 3 PCS');
  assert.deepEqual(JSON.parse(snap.quantities_json),{Carton:1,Box:2,Pcs:3});
  assert.equal(snapshot().payable,2830);
  const ledger=sql('SELECT debit,balance FROM supplier_ledger WHERE reference=?',posted.purchaseId);
  assert.deepEqual([ledger.debit,ledger.balance],[2830,2830]);
  const history=await api('GET','/api/purchases/'+posted.purchaseId);
  assert.equal(history.status,200,JSON.stringify(history));
  assert.equal(history.purchase.items[0].unitSnapshot.description,'1 CT 2 BX 3 PCS');
  assert.equal(history.purchase.items[0].unitSnapshot.lotId,lot.lot_id);
  const list=await api('GET','/api/purchases');
  assert.equal(list.status,200);
  assert.equal(list.purchases[0].items[0].unitDescription,'1 CT 2 BX 3 PCS');
  const blockedEdit=await api('PUT','/api/purchases/'+posted.purchaseId,{
   ...payload,reason:'Unsafe modification'});
  assert.equal(blockedEdit.status,409);
  const blockedDelete=await api('DELETE','/api/purchases/'+posted.purchaseId,{reason:'Unsafe delete'});
  assert.equal(blockedDelete.status,409);
  const blockedReturn=await api('POST','/api/purchase-returns',{
   purchaseId:posted.purchaseId,refundMethod:'Supplier Credit',reason:'Unsafe return',
   items:[{productId:id,qty:1,unitPrice:10}]
  });
  assert.equal(blockedReturn.status,400,'Mixed return requires an idempotency request ID');
  assert.deepEqual(snapshot(),{stock:283,purchases:1,lots:1,payable:2830});
  const updated=await api('PUT','/api/products/'+id+'/unit-profile',{
   expectedRevision:1,units:units.map(u=>u.unit==='Carton'?{...u,containsNext:10}:u)});
  assert.equal(updated.status,200,JSON.stringify(updated));
  const stale=await api('POST','/api/purchases',payload);
  assert.equal(stale.status,409,JSON.stringify(stale));
  assert.equal(snapshot().purchases,1);
  assert.equal(sql('SELECT profile_revision n FROM purchase_unit_snapshots').n,1,
   'original denomination never rewrites after product revision');
  db.native.exec(`CREATE TRIGGER reject_phase4b_snapshot BEFORE INSERT ON purchase_unit_snapshots
    BEGIN SELECT RAISE(ABORT,'synthetic-snapshot-write-failure'); END;`);
  const beforeFailure=snapshot();
  const failed=await api('POST','/api/purchases',{...payload,items:[{
   ...item,unitProfileRevision:2,unitQuantities:{Box:1},priceUnit:'Box',unitPrice:200
  }]});
  assert.notEqual(failed.status,200,JSON.stringify(failed));
  assert.deepEqual(snapshot(),beforeFailure,'failed snapshot must roll back purchase, stock and supplier due');
 }finally{db.close();}
});
