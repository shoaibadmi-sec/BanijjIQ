import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { handleApiRequest } from '../server/core/handler.ts';

test('Phase 7E: one shared FIFO plan combines bundle and ordinary cart demand without double-counting lots',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));
  let token='';
  const api=async(path:string,body:unknown)=>{
   const r=await handleApiRequest(new Request('http://local.test'+path,{method:'POST',
    headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
    body:JSON.stringify(body)}),db);
   return {status:r.status,...await r.json() as Record<string,any>};
  };
  assert.equal((await api('/api/products/bundle-fifo-preview',{sets:1,components:[]})).status,401);
  const admin=await api('/api/setup/admin',{fullName:'Bundle Preview Admin',phone:'01000007771',password:'OnlyLocalBundleTest2026!'});
  assert.equal(admin.status,200,JSON.stringify(admin));token=admin.token;
  const insert=db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock,purchase_price,selling_price,status) VALUES (?,?,'Hardware','Pcs',?,?,?,'Active')");
  insert.run('B-CABLE','Bundle Wire',8,500,1000);
  insert.run('B-SWITCH','Bundle Switch',2,55,500);
  const lots=db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES (?,?,'PURCHASE',?,?,?)");
  lots.run('B-L1','B-CABLE',5,5,20);
  lots.run('B-L2','B-CABLE',3,3,30);
  lots.run('B-L3','B-SWITCH',2,2,4.125);
  const before=(db.native.prepare('SELECT total_changes() n').get() as any).n;
  const request={sets:2,components:[{productId:'B-CABLE',quantityPerSet:3},{productId:'B-SWITCH',quantityPerSet:1}],
    standalone:[{productId:'B-CABLE',quantity:2}]};
  const r=await api('/api/products/bundle-fifo-preview',request);
  assert.equal(r.status,200,JSON.stringify(r));
  assert.equal(r.ok,true);
  assert.equal(r.readOnly,true);
  assert.equal(r.totalCostMinor,19825,'5×20 + 3×30 + 2×4.125 = 198.25 BDT');
  assert.deepEqual(r.products.map((p:any)=>[p.productId,p.demand,p.costMinor]),
    [['B-CABLE',8,19000],['B-SWITCH',2,825]]);
  assert.deepEqual(r.products[0].draws.map((d:any)=>[d.lotId,d.quantity,d.costMinor]),
    [['B-L1',5,10000],['B-L2',3,9000]]);
  assert.deepEqual(r.products[1].draws.map((d:any)=>[d.lotId,d.quantity,d.costMinor]),
    [['B-L3',2,825]]);
  assert.equal((db.native.prepare('SELECT total_changes() n').get() as any).n,before,'preflight makes no DB writes');
  assert.equal((db.native.prepare("SELECT current_stock FROM products WHERE product_id='B-CABLE'").get() as any).current_stock,8);
  assert.equal((db.native.prepare("SELECT SUM(remaining_quantity) n FROM stock_lots WHERE product_id='B-CABLE'").get() as any).n,8);
  const retry=await api('/api/products/bundle-fifo-preview',request);
  assert.equal(retry.status,200,JSON.stringify(retry));
  assert.equal(retry.totalCostMinor,19825);
  assert.equal((db.native.prepare('SELECT total_changes() n').get() as any).n,before);
 }finally{db.close();}
});

test('Phase 7E: fail closed on shortage, stock-master tampering, missing cost, OVERSOLD, invalid quantities and tracking',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));
  let token='';
  const api=async(body:unknown)=>{
   const r=await handleApiRequest(new Request('http://local.test/api/products/bundle-fifo-preview',{method:'POST',
    headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
    body:JSON.stringify(body)}),db);
   return {status:r.status,...await r.json() as Record<string,any>};
  };
  token=(await (await handleApiRequest(new Request('http://local.test/api/setup/admin',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({fullName:'Bundle Checker',phone:'01000007772',password:'OnlyLocalBundleGuard2026!'})
  }),db)).json() as any).token;
  db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock,status) VALUES ('B-P','Paper','Hardware','Pcs',2,'Active')").run();
  db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES ('B-PLOT','B-P','PURCHASE',2,2,20)").run();
  const base={sets:1,components:[{productId:'B-P',quantityPerSet:1}]};
  const invalid=[{...base,sets:0},{...base,sets:1.5},{...base,sets:99999999999},
   {...base,components:[]},{...base,components:[{productId:'B-P',quantityPerSet:0}]},
   {...base,components:[{productId:'B-P',quantityPerSet:1.1}]},
   {...base,components:[{productId:'B-P',quantityPerSet:1},{productId:'B-P',quantityPerSet:1}]}];
  for(const body of invalid){
   const r=await api(body);assert.equal(r.status,400,JSON.stringify({body,r}));
  }
  assert.equal((await api({...base,sets:3})).status,409,'shortage must reject full preview');
  assert.equal((await api({sets:1,components:[{productId:'MISSING',quantityPerSet:1}]})).status,404);
  db.native.prepare("UPDATE stock_lots SET remaining_quantity=1 WHERE lot_id='B-PLOT'").run();
  assert.equal((await api(base)).status,409,'master/lot mismatch must reject');
  db.native.prepare("UPDATE stock_lots SET remaining_quantity=2,unit_cost=0 WHERE lot_id='B-PLOT'").run();
  assert.equal((await api(base)).status,409,'zero source acquisition cost must reject');
  db.native.prepare("UPDATE stock_lots SET unit_cost=20,source_type='OVERSOLD' WHERE lot_id='B-PLOT'").run();
  assert.equal((await api(base)).status,409,'oversold source must reject');
  db.native.prepare("UPDATE stock_lots SET source_type='PURCHASE' WHERE lot_id='B-PLOT'").run();
  db.native.prepare("UPDATE products SET track_serial=1 WHERE product_id='B-P'").run();
  assert.equal((await api(base)).status,409,'tracked stock needs serial safe flow');
  assert.equal((db.native.prepare('SELECT COUNT(*) n FROM stock_movements').get() as any).n,0);
 }finally{db.close();}
});
