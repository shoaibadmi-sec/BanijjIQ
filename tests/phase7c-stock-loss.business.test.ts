import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { handleApiRequest } from '../server/core/handler.ts';

test('Phase 7C business: damaged and wasted goods consume FIFO at original cost, not selling price',async()=>{
  const db=new SqliteDatabase(':memory:');
  try {
    runMigrations(db.native,resolve('migrations'));
    let token='';
    const api=async(method:string,path:string,body?:unknown)=>{
      const res=await handleApiRequest(new Request('http://local.test'+path,{
        method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
        body:body===undefined?undefined:JSON.stringify(body)
      }),db);
      return {status:res.status,...await res.json() as Record<string,any>};
    };
    assert.equal((await api('POST','/api/products/P-LOSS/stock-loss',{clientRequestId:'loss-request-0001',reason:'DAMAGE',quantity:6})).status,401);
    const setup=await api('POST','/api/setup/admin',{fullName:'Local Loss Admin',phone:'01000009881',password:'LocalLossTestSecret2026!'});
    assert.equal(setup.status,200,JSON.stringify(setup));token=setup.token;
    db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock,selling_price) VALUES ('P-LOSS','Steel Pipe','Hardware','Pcs',8,300)").run();
    db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES ('L-OLDER','P-LOSS','PURCHASE',5,5,20),('L-NEWER','P-LOSS','PURCHASE',3,3,40)").run();
    db.native.prepare("INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after) VALUES ('STOCK-OPEN','P-LOSS','OPENING',8,0,8)").run();
    const request={clientRequestId:'loss-request-0001',reason:'DAMAGE',quantity:6,note:'Broken in transit'};
    const first=await api('POST','/api/products/P-LOSS/stock-loss',request);
    assert.equal(first.status,200,JSON.stringify(first));
    assert.equal(first.ok,true);
    assert.equal(first.replayed,false);
    assert.equal(first.quantity,6);
    assert.equal(first.costMinor,14000,'5×৳20 plus 1×৳40, cost not retail price');
    assert.equal(first.remainingStock,2);
    assert.equal((db.native.prepare("SELECT current_stock FROM products WHERE product_id='P-LOSS'").get() as any).current_stock,2);
    const lots=db.native.prepare("SELECT lot_id,remaining_quantity FROM stock_lots WHERE product_id='P-LOSS' ORDER BY id").all() as any[];
    assert.deepEqual(lots.map(x=>[x.lot_id,x.remaining_quantity]),[['L-OLDER',0],['L-NEWER',2]]);
    const entries=db.native.prepare("SELECT lot_id,quantity,unit_cost,cost_minor,movement_id FROM inventory_loss_lots ORDER BY id").all() as any[];
    assert.deepEqual(entries.map(x=>[x.lot_id,x.quantity,x.unit_cost,x.cost_minor]),[['L-OLDER',5,20,10000],['L-NEWER',1,40,4000]]);
    const movements=db.native.prepare("SELECT movement_type,quantity_out,balance_after,lot_id FROM stock_movements WHERE movement_type='DAMAGE' ORDER BY id").all() as any[];
    assert.deepEqual(movements.map(x=>[x.movement_type,x.quantity_out,x.balance_after,x.lot_id]),[['DAMAGE',5,2,'L-OLDER'],['DAMAGE',1,2,'L-NEWER']]);
    const entry=db.native.prepare("SELECT reason,quantity,cost_minor,created_by FROM inventory_losses WHERE request_id=?").get(request.clientRequestId) as any;
    assert.equal(entry.reason,'DAMAGE');assert.equal(entry.cost_minor,14000);assert.equal(entry.created_by.length>0,true);
    assert.equal((db.native.prepare('SELECT COUNT(*) AS n FROM cash_book').get() as any).n,0,'loss is not a cash payment');
    assert.equal((db.native.prepare('SELECT COUNT(*) AS n FROM expenses').get() as any).n,0,'no invented expense posting');

    const before=(db.native.prepare('SELECT total_changes() n').get() as any).n;
    const replay=await api('POST','/api/products/P-LOSS/stock-loss',request);
    assert.equal(replay.status,200,JSON.stringify(replay));
    assert.equal(replay.replayed,true);
    assert.equal(replay.costMinor,14000);
    assert.equal((db.native.prepare('SELECT total_changes() n').get() as any).n,before,'retry cannot post loss twice');
    assert.equal((await api('POST','/api/products/P-LOSS/stock-loss',{...request,reason:'WASTAGE'})).status,409);
    assert.equal((await api('POST','/api/products/OTHER/stock-loss',request)).status,409,'same ID must not transfer across products');
    assert.equal((db.native.prepare('SELECT total_changes() n').get() as any).n,before);

    const waste=await api('POST','/api/products/P-LOSS/stock-loss',{clientRequestId:'loss-request-0002',reason:'WASTAGE',quantity:1,note:'Expired packaging'});
    assert.equal(waste.status,200,JSON.stringify(waste));
    assert.equal(waste.costMinor,4000);
    assert.equal(waste.remainingStock,1);
  }finally{db.close();}
});

test('Phase 7C business: rejects overselling, unsupported reason, invalid precision, and corrupt FIFO before posting',async()=>{
  const db=new SqliteDatabase(':memory:');
  try{
    runMigrations(db.native,resolve('migrations'));
    let token='';
    const api=async(path:string,body:unknown)=>{
      const r=await handleApiRequest(new Request('https://local.test'+path,{
        method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)
      }),db);
      return {status:r.status,...await r.json() as Record<string,any>};
    };
    const setup=await api('/api/setup/admin',{fullName:'Local Loss Guard',phone:'01000009882',password:'LocalLossGuardSecret2026!'});
    token=setup.token;
    db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock) VALUES ('P-VALID','Valuable bolts','Hardware','Pcs',2),('P-TRACK','Tracked bolts','Hardware','Pcs',1)").run();
    db.native.prepare("UPDATE products SET track_serial=1 WHERE product_id='P-TRACK'").run();
    db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES ('L-VALID','P-VALID','PURCHASE',2,2,25),('L-TRACK','P-TRACK','OPENING',1,1,30)").run();
    const base={clientRequestId:'loss-request-invalid',reason:'DAMAGE',quantity:1,note:'Inspect'};
    const invalid=[
      {...base,reason:'SALE'}, {...base,quantity:0},{...base,quantity:-1},
      {...base,quantity:3},{...base,quantity:1.00001},{...base,quantity:'NaN'},
      {...base,clientRequestId:''},{...base,clientRequestId:'x'}, {...base,note:'X'.repeat(201)}
    ];
    for(const payload of invalid){
      const res=await api('/api/products/P-VALID/stock-loss',payload);
      assert.equal(res.status,400,JSON.stringify(res));
    }
    assert.equal((await api('/api/products/P-TRACK/stock-loss',base)).status,409);
    db.native.prepare("UPDATE stock_lots SET remaining_quantity=1 WHERE lot_id='L-VALID'").run();
    assert.equal((await api('/api/products/P-VALID/stock-loss',base)).status,409,'mismatched master and FIFO must fail closed');
    assert.equal((await api('/api/products/MISSING/stock-loss',base)).status,404);
    assert.equal((db.native.prepare('SELECT current_stock FROM products WHERE product_id=?').get('P-VALID') as any).current_stock,2);
    assert.equal((db.native.prepare('SELECT COUNT(*) n FROM stock_movements').get() as any).n,0);
    assert.equal((db.native.prepare('SELECT COUNT(*) n FROM inventory_losses').get() as any).n,0);
  }finally{db.close();}
});
