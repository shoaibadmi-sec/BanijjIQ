import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { handleApiRequest } from '../server/core/handler.ts';

test('7H2 stock lots collection is real D1, tracked, read-only, and purchase-cost permission guarded',async()=>{
  const db=new SqliteDatabase(':memory:');
  try {
    runMigrations(db.native,resolve('migrations'));
    const api=async(method:string,path:string,body?:unknown,token='')=>{
      const res=await handleApiRequest(new Request('http://local.test'+path,{
        method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
        body:body===undefined?undefined:JSON.stringify(body)
      }),db);
      return {status:res.status,...await res.json() as Record<string,any>};
    };
    const url='/api/products/inventory-lots';
    assert.equal((await api('GET',url)).status,401);
    const admin=await api('POST','/api/setup/admin',{fullName:'Lot Admin',phone:'01000009201',password:'LocalTestOnly2026!'});
    assert.equal(admin.status,200,JSON.stringify(admin));
    const token=admin.token as string;
    db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock,minimum_stock,track_expiry,track_serial) VALUES ('LOT-P1','Wire','Electrical','Pcs',4,1,1,0),('LOT-P2','Pipe','Plumbing','Pcs',3,1,0,0)").run();
    db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost,created_at) VALUES ('LOT-A','LOT-P1','PURCHASE','PUR-0001',6,4,25.5,'2026-10-30 10:00:00'),('LOT-B','LOT-P2','OPENING','OPENING',3,3,10,'2026-10-29 09:00:00')").run();
    db.native.prepare("INSERT INTO stock_expiry_batches(expiry_batch_id,lot_id,product_id,batch_no,expiry_date,original_quantity,remaining_quantity) VALUES ('EXP-A','LOT-A','LOT-P1','B-01','2027-05-15',6,4)").run();
    const r=await api('POST','/api/roles',{name:'LotsViewNoCost',permissions:{products:{view:true}}},token);
    assert.equal(r.status,200,JSON.stringify(r));
    const staff=await api('POST','/api/users',{name:'View Only',mobile:'01000009202',role:'LotsViewNoCost',password:'LocalTestOnly2026!'},token);
    assert.equal(staff.status,200,JSON.stringify(staff));
    const login=await api('POST','/api/auth/login',{phone:'01000009202',password:'LocalTestOnly2026!'});
    assert.equal(login.status,200,JSON.stringify(login));
    const before=(db.native.prepare('SELECT total_changes() as n').get() as {n:number}).n;
    assert.equal((await api('GET',url,undefined,login.token)).status,403,'cost-restricted users cannot read unit costs');
    const reply=await api('GET',url,undefined,token);
    assert.equal(reply.status,200,JSON.stringify(reply));
    assert.deepEqual(reply.lots.map((row:{lotId:string})=>row.lotId),['LOT-A','LOT-B']);
    assert.equal(reply.lots[0].productId,'LOT-P1');
    assert.equal(reply.lots[0].originalQuantity,6);
    assert.equal(reply.lots[0].remainingQuantity,4);
    assert.equal(reply.lots[0].unitCost,25.5);
    assert.equal(reply.lots[0].batchNumber,'B-01');
    assert.equal(reply.lots[0].expiryDate,'2027-05-15');
    assert.equal(reply.lots[0].sourceRef,'PUR-0001');
    assert.equal(reply.lots[1].expiryDate,null);
    assert.equal((db.native.prepare('SELECT total_changes() as n').get() as {n:number}).n,before,'stock lots requests never write');
  }finally{db.close();}
});

test('7H2 contradictory source expiry or pending assignment cannot display as healthy stock',async()=>{
  const db=new SqliteDatabase(':memory:');
  try {
    runMigrations(db.native,resolve('migrations'));
    const api=async(method:string,path:string,body?:unknown,token='')=>{
      const res=await handleApiRequest(new Request('http://local.test'+path,{
        method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
        body:body===undefined?undefined:JSON.stringify(body)
      }),db);
      return {status:res.status,...await res.json() as Record<string,any>};
    };
    const admin=await api('POST','/api/setup/admin',{fullName:'Lot Audit',phone:'01000009203',password:'LocalTestOnly2026!'});
    assert.equal(admin.status,200,JSON.stringify(admin));
    db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock,minimum_stock,track_expiry) VALUES ('LOT-ERR-P','Faulty Tracking','Hardware','Pcs',3,1,1)").run();
    db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost,tracking_required_quantity) VALUES ('LOT-ERR','LOT-ERR-P','PURCHASE',3,3,12,3)").run();
    const url='/api/products/inventory-lots';
    const result=await api('GET',url,undefined,admin.token);
    assert.equal(result.status,409,'unassigned tracked expiry must fail closed');
    assert.equal(result.lots,undefined);
    db.native.prepare("UPDATE stock_lots SET tracking_required_quantity=0 WHERE lot_id='LOT-ERR'").run();
    db.native.prepare("INSERT INTO stock_expiry_batches(expiry_batch_id,lot_id,product_id,batch_no,expiry_date,original_quantity,remaining_quantity) VALUES ('EX-ERR','LOT-ERR','LOT-ERR-P','B-1','2027-05-15',3,2)").run();
    assert.equal((await api('GET',url,undefined,admin.token)).status,409,'partial assigned expiry cannot appear as complete expiry');
  }finally{db.close();}
});
