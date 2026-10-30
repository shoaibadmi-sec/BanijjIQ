import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { handleApiRequest } from '../server/core/handler.ts';

test('7H1 original Stock history reads real source rows across products, enforces Products.view, and never writes',async()=>{
  const db=new SqliteDatabase(':memory:');
  try{
    runMigrations(db.native,resolve('migrations'));
    const api=async(method:string,path:string,body?:unknown,token='')=>{
      const response=await handleApiRequest(new Request('http://local.test'+path,{
        method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
        body:body===undefined?undefined:JSON.stringify(body)
      }),db);
      return {status:response.status,...await response.json() as Record<string,any>};
    };
    const path='/api/products/inventory-history';
    assert.equal((await api('GET',path)).status,401);
    const admin=await api('POST','/api/setup/admin',{
      fullName:'History Admin',phone:'01000009101',password:'LocalTestOnly2026!'
    });
    assert.equal(admin.status,200,JSON.stringify(admin));
    const token=admin.token as string;
    db.native.prepare("INSERT INTO products (product_id,product_name,category,unit,current_stock,minimum_stock) VALUES ('HX-P1','Cable','Hardware','Pcs',3,1),('HX-P2','Pipe','Hardware','Pcs',8,2)").run();
    db.native.prepare("INSERT INTO stock_movements (movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,created_at) VALUES ('HX-M1','HX-P1','STOCK_IN_ADJUSTMENT',3,0,3,'Counted','2026-10-30 10:00:00'),('HX-M2','HX-P2','STOCK_OUT_ADJUSTMENT',0,2,8,'Damaged','2026-10-30 11:00:00')").run();
    const role=await api('POST','/api/roles',{name:'HistoryReportsOnly',permissions:{reports:{view:true}}},token);
    assert.equal(role.status,200,JSON.stringify(role));
    const staff=await api('POST','/api/users',{name:'History Reports Only',mobile:'01000009102',
      role:'HistoryReportsOnly',password:'LocalTestOnly2026!'},token);
    assert.equal(staff.status,200,JSON.stringify(staff));
    const login=await api('POST','/api/auth/login',{phone:'01000009102',password:'LocalTestOnly2026!'});
    assert.equal(login.status,200,JSON.stringify(login));
    const before=(db.native.prepare('SELECT total_changes() as n').get() as {n:number}).n;
    assert.equal((await api('GET',path,undefined,login.token)).status,403);
    const result=await api('GET',path,undefined,token);
    assert.equal(result.status,200,JSON.stringify(result));
    assert.deepEqual(result.items.map((m:{movementId:string})=>m.movementId),['HX-M2','HX-M1']);
    assert.equal(result.items[0].productId,'HX-P2');
    assert.equal(result.items[0].quantityOut,2);
    assert.equal(result.items[1].productId,'HX-P1');
    assert.equal(result.items[1].balanceAfter,3);
    assert.equal((db.native.prepare('SELECT total_changes() as n').get() as {n:number}).n,before,'read-only inventory audit');
  }finally{db.close();}
});
