import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

test('Phase 7E2 transaction: injected cash receipt failure and stale FIFO CAS roll back every physical source, snapshot and invoice',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));let token='';
  const api=async(method:string,path:string,body?:unknown)=>{
   const r=await handleApiRequest(new Request('http://local.test'+path,{method,
    headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
    body:body===undefined?undefined:JSON.stringify(body)}),db);
   return {status:r.status,...await r.json() as Record<string,any>};
  };
  const admin=await api('POST','/api/setup/admin',{fullName:'Atomic Bundle Admin',phone:'01000006662',password:'BundleAtomicTest2026!'});
  assert.equal(admin.status,200);token=admin.token;
  assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:0})).status,200);
  db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock) VALUES ('B-CORE','Core','Hardware','Pcs',2)").run();
  db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES ('B-CORE-LOT','B-CORE','PURCHASE',2,2,50)").run();
  const recipe={bundleId:'B-ATOMIC',name:'Atomic Kit',sellingPrice:130,components:[{productId:'B-CORE',quantityPerSet:1}]};
  assert.equal((await api('POST','/api/products/bundle-recipes',recipe)).status,200);
  const sale={clientRequestId:'bundleatomic-request1',customerName:'Customer X',customerPhone:'01000002222',paymentType:'Cash',paymentMethod:'Cash',
   items:[{productId:'B-ATOMIC',qty:2,unitPrice:130}]};
  const snapshot=()=>JSON.stringify({
   product:db.native.prepare("SELECT current_stock FROM products WHERE product_id='B-CORE'").all(),
   lots:db.native.prepare("SELECT remaining_quantity FROM stock_lots WHERE product_id='B-CORE'").all(),
   invoices:db.native.prepare('SELECT invoice_id FROM sales').all(),
   items:db.native.prepare('SELECT id FROM sale_items').all(),
   receipts:db.native.prepare("SELECT entry_id FROM cash_book WHERE type='Sale'").all(),
   allocation:db.native.prepare('SELECT id FROM bundle_sale_allocations').all(),
   recipes:db.native.prepare('SELECT id FROM sale_bundle_components').all(),
   requests:db.native.prepare('SELECT request_id FROM pos_sale_requests').all(),
   movement:db.native.prepare('SELECT movement_id FROM stock_movements').all()
  });
  const before=snapshot();
  db.native.exec("CREATE TRIGGER bundle_cash_failure BEFORE INSERT ON cash_book WHEN NEW.type='Sale' BEGIN SELECT RAISE(ABORT,'forced bundle cash failure'); END;");
  const failed=await api('POST','/api/pos/bundle-sales',sale);
  assert.equal(failed.status,409,JSON.stringify(failed));
  assert.equal(snapshot(),before,'cash receipt failure cannot leave a paid bundle invoice or consumed lots');
  db.native.exec('DROP TRIGGER bundle_cash_failure');
  const oldBatch=db.batch.bind(db);
  (db as any).batch=async(stmts:Parameters<typeof oldBatch>[0])=>{
   db.native.prepare("UPDATE stock_lots SET remaining_quantity=1 WHERE lot_id='B-CORE-LOT'").run();
   db.native.prepare("UPDATE products SET current_stock=1 WHERE product_id='B-CORE'").run();
   return oldBatch(stmts);
  };
  const stale=await api('POST','/api/pos/bundle-sales',sale);
  assert.equal(stale.status,409,JSON.stringify(stale));
  assert.equal((db.native.prepare('SELECT COUNT(*) n FROM sales').get() as any).n,0);
  assert.equal((db.native.prepare('SELECT COUNT(*) n FROM pos_sale_requests').get() as any).n,0);
  (db as any).batch=oldBatch;
  db.native.prepare("UPDATE stock_lots SET remaining_quantity=2 WHERE lot_id='B-CORE-LOT'").run();
  db.native.prepare("UPDATE products SET current_stock=2 WHERE product_id='B-CORE'").run();
  const success=await api('POST','/api/pos/bundle-sales',sale);
  assert.equal(success.status,200,JSON.stringify(success));
  assert.equal((db.native.prepare('SELECT COUNT(*) n FROM sales').get() as any).n,1);
 }finally{db.close();}
});

test('Phase 7E2 authorization and source protection: no cash session, insufficient stock, tracked components and read-only roles refuse posting',async()=>{
 const db=new SqliteDatabase(':memory:');try{
  runMigrations(db.native,resolve('migrations'));let token='';
  const api=async(method:string,path:string,body?:unknown,bearer=token)=>{
   const r=await handleApiRequest(new Request('http://local.test'+path,{method,headers:{
    'content-type':'application/json',...(bearer?{authorization:'Bearer '+bearer}:{})},body:body===undefined?undefined:JSON.stringify(body)}),db);
   return {status:r.status,...await r.json() as Record<string,any>};
  };
  token=(await api('POST','/api/setup/admin',{fullName:'Guarded Bundle Admin',phone:'01000006663',password:'BundleGuardTest2026!'})).token;
  db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock) VALUES ('B-GUARD','Guard Part','Hardware','Pcs',2)").run();
  db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES ('B-GLOT','B-GUARD','PURCHASE',2,2,10)").run();
  assert.equal((await api('POST','/api/products/bundle-recipes',{bundleId:'B-GKIT',name:'Guard Kit',sellingPrice:50,components:[{productId:'B-GUARD',quantityPerSet:1}]})).status,200);
  const sale={clientRequestId:'bundleguard-request1',customerName:'Guard Buyer',customerPhone:'01000002223',paymentType:'Cash',paymentMethod:'Cash',items:[{productId:'B-GKIT',qty:1,unitPrice:50}]};
  assert.equal((await api('POST','/api/pos/bundle-sales',sale)).status,400,'no active cash session');
  assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:0})).status,200);
  const role=await api('POST','/api/roles',{name:'Bundle POS Viewer',permissions:{pos:{view:true,add:false,edit:false,delete:'disabled'},products:{view:true,add:false,edit:false,delete:'disabled'}}});
  assert.equal(role.status,200,JSON.stringify(role));
  const worker=await api('POST','/api/users',{name:'Read Only Seller',mobile:'01000006664',role:'Bundle POS Viewer',password:'BundlePOSViewer2026!'});
  assert.equal(worker.status,200,JSON.stringify(worker));
  const login=await api('POST','/api/auth/login',{phone:'01000006664',password:'BundlePOSViewer2026!'});
  assert.equal(login.status,200);
  assert.equal((await api('POST','/api/pos/bundle-sales',sale,login.token)).status,403);
  assert.equal((await api('POST','/api/products/bundle-recipes',{bundleId:'B-OTHER',name:'Illegal',sellingPrice:60,components:[{productId:'B-GUARD',quantityPerSet:1}]},login.token)).status,403);
  assert.equal((await api('POST','/api/pos/bundle-sales',{...sale,items:[{...sale.items[0],qty:3}]})).status,409);
  db.native.prepare("UPDATE products SET track_serial=1 WHERE product_id='B-GUARD'").run();
  assert.equal((await api('POST','/api/pos/bundle-sales',sale)).status,409);
  assert.equal((db.native.prepare('SELECT COUNT(*) n FROM sales').get() as any).n,0);
 }finally{db.close();}
});
