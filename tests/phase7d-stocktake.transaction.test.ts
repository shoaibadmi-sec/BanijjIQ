import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { handleApiRequest } from '../server/core/handler.ts';

function fixture(){
 const db=new SqliteDatabase(':memory:');runMigrations(db.native,resolve('migrations'));
 let token='';
 const api=async(method:string,path:string,body?:unknown,auth?:string)=>{
  const r=await handleApiRequest(new Request('http://test.local'+path,{
   method,headers:{'content-type':'application/json',...((auth??token)?{authorization:'Bearer '+(auth??token)}:{})},
   body:body===undefined?undefined:JSON.stringify(body)
  }),db);
  return {status:r.status,...await r.json() as Record<string,any>};
 };
 const login=async()=>{
  const r=await api('POST','/api/setup/admin',{
   fullName:'Physical Count Owner',phone:'01000008654',password:'CountOwnerSecret-2026!'
  });
  assert.equal(r.status,200,JSON.stringify(r));token=r.token;
 };
 return {db,api,login};
}

test('transaction: stale count after another sale cannot post; unchanged master and count state after refusal',async()=>{
 const {db,api,login}=fixture();try{
  await login();
  db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock) VALUES ('T-STALE','Staple','Hardware','Pcs',5)").run();
  db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES ('T-STALE-L','T-STALE','PURCHASE',5,5,50)").run();
  assert.equal((await api('POST','/api/products/T-STALE/stock-counts',{countId:'count-stale-0001',countedQuantity:4})).status,200);
  db.native.prepare("UPDATE products SET current_stock=4 WHERE product_id='T-STALE'").run();
  db.native.prepare("UPDATE stock_lots SET remaining_quantity=4 WHERE lot_id='T-STALE-L'").run();
  const before=(db.native.prepare('SELECT total_changes() n').get() as any).n;
  const stale=await api('POST','/api/products/T-STALE/stock-counts/count-stale-0001/approve',{});
  assert.equal(stale.status,409,JSON.stringify(stale));
  assert.equal((db.native.prepare("SELECT status FROM stock_counts WHERE count_id='count-stale-0001'").get() as any).status,'PENDING');
  assert.equal((db.native.prepare('SELECT total_changes() n').get() as any).n,before);
  assert.equal((db.native.prepare('SELECT COUNT(*) n FROM stock_count_lots').get() as any).n,0);
 }finally{db.close();}
});

test('transaction: SQL failure on second FIFO movement rolls back approval, lot depletion and captured count',async()=>{
 const {db,api,login}=fixture();try{
  await login();
  db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock) VALUES ('T-ROLL','Cables','Hardware','Pcs',5)").run();
  db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES ('T-ROLL-L1','T-ROLL','PURCHASE',3,3,20),('T-ROLL-L2','T-ROLL','PURCHASE',2,2,40)").run();
  assert.equal((await api('POST','/api/products/T-ROLL/stock-counts',{countId:'count-rollback-01',countedQuantity:1})).status,200);
  const snapshot=()=>JSON.stringify({
   stock:db.native.prepare("SELECT current_stock FROM products WHERE product_id='T-ROLL'").all(),
   lots:db.native.prepare("SELECT lot_id,remaining_quantity FROM stock_lots WHERE product_id='T-ROLL' ORDER BY id").all(),
   counts:db.native.prepare("SELECT status,approved_by,cost_minor FROM stock_counts WHERE count_id='count-rollback-01'").all(),
   movements:db.native.prepare("SELECT movement_id FROM stock_movements WHERE product_id='T-ROLL'").all(),
   allocations:db.native.prepare("SELECT lot_id FROM stock_count_lots WHERE count_id='count-rollback-01'").all()
  });
  const before=snapshot();
  db.native.exec("CREATE TRIGGER count_move_abort BEFORE INSERT ON stock_movements WHEN NEW.product_id='T-ROLL' AND NEW.lot_id='T-ROLL-L2' BEGIN SELECT RAISE(ABORT,'forced-second-stocktake-movement'); END;");
  const fail=await api('POST','/api/products/T-ROLL/stock-counts/count-rollback-01/approve',{});
  assert.equal(fail.status,409,JSON.stringify(fail));
  assert.equal(snapshot(),before,'D1 batch must roll back prior successful draws and count approval');
  db.native.exec('DROP TRIGGER count_move_abort');
  const success=await api('POST','/api/products/T-ROLL/stock-counts/count-rollback-01/approve',{});
  assert.equal(success.status,200,JSON.stringify(success));
  assert.equal(success.costMinor,10000,'3×20 + 1×40');
  assert.equal(success.remainingStock,1);
  const changes=(db.native.prepare('SELECT total_changes() n').get() as any).n;
  const results=await Promise.all([
   api('POST','/api/products/T-ROLL/stock-counts/count-rollback-01/approve',{}),
   api('POST','/api/products/T-ROLL/stock-counts/count-rollback-01/approve',{})
  ]);
  assert.equal(results[0].status,200);assert.equal(results[1].status,200);
  assert.equal(results[0].replayed,true);assert.equal(results[1].replayed,true);
  assert.equal((db.native.prepare('SELECT total_changes() n').get() as any).n,changes);
 }finally{db.close();}
});

test('authorization: product creator without edit may count but not approve; viewer may only read',async()=>{
 const {db,api,login}=fixture();try{
  await login();
  db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock) VALUES ('T-RBAC','Read only','Hardware','Pcs',1)").run();
  db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES ('T-RBAC-L','T-RBAC','PURCHASE',1,1,25)").run();
  const role=await api('POST','/api/roles',{name:'Stock Counter',permissions:{products:{view:true,add:true,edit:false,delete:'disabled'}}});
  assert.equal(role.status,200,JSON.stringify(role));
  const created=await api('POST','/api/users',{name:'Stock Count Worker',mobile:'01000008655',role:'Stock Counter',password:'CountWorker-2026!'});
  assert.equal(created.status,200,JSON.stringify(created));
  const loginRes=await api('POST','/api/auth/login',{phone:'01000008655',password:'CountWorker-2026!'});
  assert.equal(loginRes.status,200,JSON.stringify(loginRes));
  const token=loginRes.token;
  const createdCount=await api('POST','/api/products/T-RBAC/stock-counts',{countId:'count-rbac-00001',countedQuantity:0},token);
  assert.equal(createdCount.status,200,JSON.stringify(createdCount));
  assert.equal((await api('GET','/api/products/T-RBAC/stock-counts/count-rbac-00001',undefined,token)).status,200);
  assert.equal((await api('POST','/api/products/T-RBAC/stock-counts/count-rbac-00001/approve',{},token)).status,403);
  assert.equal((db.native.prepare("SELECT status FROM stock_counts WHERE count_id='count-rbac-00001'").get() as any).status,'PENDING');
 }finally{db.close();}
});
