import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { handleApiRequest } from '../server/core/handler.ts';

test('Phase 7C transaction: injected journal failure rolls back master, FIFO, event and all movement rows',async()=>{
  const db=new SqliteDatabase(':memory:');
  try{
    runMigrations(db.native,resolve('migrations'));
    let token='';
    const api=async(path:string,body:unknown)=>{
      const r=await handleApiRequest(new Request('http://local.test'+path,{
        method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)
      }),db);
      return {status:r.status,...await r.json() as Record<string,any>};
    };
    const setup=await api('/api/setup/admin',{fullName:'Transaction Test Admin',phone:'01000009901',password:'TransactionTestPassword2026!'});
    assert.equal(setup.status,200);token=setup.token;
    db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock) VALUES ('P-ATOMIC','Atomic cables','Hardware','Pcs',5)").run();
    db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES ('A-LOT','P-ATOMIC','PURCHASE',3,3,20),('B-LOT','P-ATOMIC','PURCHASE',2,2,40)").run();
    const snapshot=()=>JSON.stringify({
      products:db.native.prepare("SELECT current_stock FROM products WHERE product_id='P-ATOMIC'").all(),
      lots:db.native.prepare("SELECT lot_id,remaining_quantity FROM stock_lots WHERE product_id='P-ATOMIC' ORDER BY id").all(),
      moves:db.native.prepare("SELECT movement_id FROM stock_movements ORDER BY id").all(),
      loss:db.native.prepare("SELECT request_id FROM inventory_losses").all(),
      drawn:db.native.prepare("SELECT lot_id,quantity FROM inventory_loss_lots").all()
    });
    const before=snapshot();
    db.native.exec("CREATE TRIGGER injected_loss_failure BEFORE INSERT ON stock_movements WHEN NEW.movement_type='WASTAGE' BEGIN SELECT RAISE(ABORT,'forced-stock-loss-failure'); END;");
    const req={clientRequestId:'loss-rollback-0001',reason:'WASTAGE',quantity:4,note:'Rotted in storage'};
    const failed=await api('/api/products/P-ATOMIC/stock-loss',req);
    assert.notEqual(failed.status,200,JSON.stringify(failed));
    assert.equal(snapshot(),before,'D1 batch must reverse every mutation');
    db.native.exec('DROP TRIGGER injected_loss_failure');
    const success=await api('/api/products/P-ATOMIC/stock-loss',req);
    assert.equal(success.status,200,JSON.stringify(success));
    assert.equal(success.costMinor,10000,'3 x 20 + 1 x 40 = 100');
    assert.equal(success.remainingStock,1);
    assert.equal((db.native.prepare('SELECT COUNT(*) n FROM inventory_loss_lots').get() as any).n,2);
  } finally{db.close();}
});

test('Phase 7C authorization: Products.view users cannot post damage despite being able to see history',async()=>{
  const db=new SqliteDatabase(':memory:');
  try{
    runMigrations(db.native,resolve('migrations'));
    let token='';
    const api=async(method:string,path:string,body?:unknown,overrideToken=token)=>{
      const r=await handleApiRequest(new Request('http://local.test'+path,{
        method,headers:{'content-type':'application/json',...(overrideToken?{authorization:'Bearer '+overrideToken}:{})},
        body:body===undefined?undefined:JSON.stringify(body)
      }),db);
      return {status:r.status,...await r.json() as Record<string,any>};
    };
    const setup=await api('POST','/api/setup/admin',{fullName:'Role Loss Admin',phone:'01000009902',password:'RoleLossTestPassword2026!'});
    assert.equal(setup.status,200);token=setup.token;
    db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock) VALUES ('P-RBAC','Read-only stock','Hardware','Pcs',2)").run();
    db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES ('L-RBAC','P-RBAC','PURCHASE',2,2,25)").run();
    const role=await api('POST','/api/roles',{name:'Inventory Loss Reader',permissions:{products:{view:true,add:true,edit:false,delete:'disabled'}}});
    assert.equal(role.status,200,JSON.stringify(role));
    const created=await api('POST','/api/users',{name:'Read Only Loss',mobile:'01000009903',role:'Inventory Loss Reader',password:'ReadOnlyLossPass2026!'});
    assert.equal(created.status,200,JSON.stringify(created));
    const login=await api('POST','/api/auth/login',{phone:'01000009903',password:'ReadOnlyLossPass2026!'});
    assert.equal(login.status,200,JSON.stringify(login));
    const bearer=login.token;
    assert.equal((await api('GET','/api/products/P-RBAC/history',undefined,bearer)).status,200);
    const req={clientRequestId:'loss-rbac-000001',reason:'DAMAGE',quantity:1,note:'Restricted'};
    assert.equal((await api('POST','/api/products/P-RBAC/stock-loss',req,bearer)).status,403,'products.add must not grant stock-decrement privilege');
    assert.equal((db.native.prepare("SELECT current_stock FROM products WHERE product_id='P-RBAC'").get() as any).current_stock,2);
    assert.equal((db.native.prepare('SELECT COUNT(*) n FROM inventory_losses').get() as any).n,0);
  }finally{db.close();}
});
