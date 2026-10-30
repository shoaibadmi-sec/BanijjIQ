import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { handleApiRequest } from '../server/core/handler.ts';

test('Phase 7A route: authenticated, bounded, read-only source-backed stock ledger',async()=>{
  const db=new SqliteDatabase(':memory:');
  try {
    runMigrations(db.native,resolve('migrations'));
    let token='';
    const api=async(method:string,path:string,body?:unknown)=>{
      const response=await handleApiRequest(new Request('https://local.test'+path,{
        method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
        body:body===undefined?undefined:JSON.stringify(body)
      }),db);
      return {status:response.status,...await response.json() as Record<string,any>};
    };
    assert.equal((await api('GET','/api/products/P7-API/stock-ledger')).status,401);
    const setup=await api('POST','/api/setup/admin',{
      fullName:'Inventory Test Admin',phone:'01000009777',password:'TestSecretForLocalOnly2026'
    });
    assert.equal(setup.status,200,JSON.stringify(setup));
    token=setup.token;
    db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock) VALUES ('P7-API','Bolts','Hardware','Pcs',4)").run();
    db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES ('L7-API','P7-API','OPENING',4,4,20)").run();
    db.native.prepare("INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,lot_id) VALUES ('MOV7','P7-API','OPENING',4,0,4,'L7-API')").run();
    const before=(db.native.prepare('SELECT total_changes() n').get() as {n:number}).n;
    const good=await api('GET','/api/products/P7-API/stock-ledger?page=1&pageSize=50');
    assert.equal(good.status,200,JSON.stringify(good));
    assert.equal(good.ok,true);
    assert.equal(good.integrity.status,'ready');
    assert.equal(good.items[0].movementId,'MOV7');
    assert.equal(good.items[0].lotId,'L7-API');
    assert.equal(good.pageSize,50);
    assert.equal((await api('GET','/api/products/P7-API/stock-ledger?page=0')).status,400);
    assert.equal((await api('GET','/api/products/P7-API/stock-ledger?pageSize=101')).status,400);
    assert.equal((await api('GET','/api/products/P7-API/stock-ledger?page=2.5')).status,400);
    assert.equal((await api('GET','/api/products/NOT-FOUND/stock-ledger')).status,404);
    assert.equal((await api('POST','/api/products/P7-API/stock-ledger',{})).status,404);
    assert.equal((db.native.prepare('SELECT total_changes() n').get() as {n:number}).n,before);
  } finally {db.close();}
});
