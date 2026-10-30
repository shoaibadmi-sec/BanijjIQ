import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { handleApiRequest } from '../server/core/handler.ts';

function fixture(){
  const db=new SqliteDatabase(':memory:');
  runMigrations(db.native,resolve('migrations'));
  let token='';
  const api=async(method:string,path:string,body?:unknown)=>{
    const r=await handleApiRequest(new Request('http://test.local'+path,{
      method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
      body:body===undefined?undefined:JSON.stringify(body)
    }),db);
    return {status:r.status,...await r.json() as Record<string,any>};
  };
  const login=async()=>{
    const r=await api('POST','/api/setup/admin',{
      fullName:'Stock Count Admin',phone:'01000008544',password:'Isolated-Count-2026!'
    });
    assert.equal(r.status,200,JSON.stringify(r));token=r.token;
  };
  return {db,api,login};
}

test('business: submitted count only records an audit draft; approval consumes original FIFO lots at purchase cost',async()=>{
  const {db,api,login}=fixture();
  try{
    await login();
    db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock,selling_price) VALUES ('SC-A','Copper wire','Hardware','Pcs',8,1000)").run();
    db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES ('SC-L1','SC-A','PURCHASE',5,5,20),('SC-L2','SC-A','PURCHASE',3,3,40)").run();
    db.native.prepare("INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,balance_after) VALUES ('SC-OPEN','SC-A','OPENING',8,8)").run();
    const before=(db.native.prepare('SELECT total_changes() n').get() as any).n;
    const create=await api('POST','/api/products/SC-A/stock-counts',{
      countId:'stockcount-000001',countedQuantity:2,note:'Physical shelf count'
    });
    assert.equal(create.status,200,JSON.stringify(create));
    assert.equal(create.statusValue,'PENDING');assert.equal(create.expectedQuantity,8);
    assert.equal(create.variance,-6);
    assert.equal((db.native.prepare("SELECT current_stock FROM products WHERE product_id='SC-A'").get() as any).current_stock,8);
    assert.deepEqual((db.native.prepare("SELECT remaining_quantity FROM stock_lots WHERE product_id='SC-A' ORDER BY id").all() as any[]).map(x=>x.remaining_quantity),[5,3]);
    assert.equal((db.native.prepare("SELECT COUNT(*) n FROM stock_movements WHERE product_id='SC-A'").get() as any).n,1);
    assert.equal((db.native.prepare('SELECT total_changes() n').get() as any).n,before+1,'draft creates only one count record');
    const approved=await api('POST','/api/products/SC-A/stock-counts/stockcount-000001/approve',{});
    assert.equal(approved.status,200,JSON.stringify(approved));
    assert.equal(approved.statusValue,'APPROVED');assert.equal(approved.replayed,false);
    assert.equal(approved.costMinor,14000,'5 × 20 plus 1 × 40 at source FIFO cost');
    assert.equal(approved.remainingStock,2);
    assert.deepEqual((db.native.prepare("SELECT remaining_quantity FROM stock_lots WHERE product_id='SC-A' ORDER BY id").all() as any[]).map(x=>x.remaining_quantity),[0,2]);
    const lines=db.native.prepare("SELECT lot_id,quantity,unit_cost,cost_minor FROM stock_count_lots ORDER BY id").all() as any[];
    assert.deepEqual(lines.map(x=>[x.lot_id,x.quantity,x.unit_cost,x.cost_minor]),[['SC-L1',5,20,10000],['SC-L2',1,40,4000]]);
    const moves=db.native.prepare("SELECT lot_id,quantity_out,balance_after FROM stock_movements WHERE movement_type='STOCKTAKE_OUT' ORDER BY id").all() as any[];
    assert.deepEqual(moves.map(x=>[x.lot_id,x.quantity_out,x.balance_after]),[['SC-L1',5,2],['SC-L2',1,2]]);
    const get=await api('GET','/api/products/SC-A/stock-counts/stockcount-000001');
    assert.equal(get.status,200);assert.equal(get.count.status,'APPROVED');assert.equal(get.count.countedQuantity,2);
    assert.equal(get.count.costMinor,14000);
    assert.equal((db.native.prepare('SELECT COUNT(*) n FROM cash_book').get() as any).n,0);
    assert.equal((db.native.prepare('SELECT COUNT(*) n FROM expenses').get() as any).n,0);
    const writes=(db.native.prepare('SELECT total_changes() n').get() as any).n;
    const replay=await api('POST','/api/products/SC-A/stock-counts/stockcount-000001/approve',{});
    assert.equal(replay.status,200,JSON.stringify(replay));
    assert.equal(replay.replayed,true);assert.equal((db.native.prepare('SELECT total_changes() n').get() as any).n,writes);
  }finally{db.close();}
});

test('business: surplus requires explicit acquisition cost and creates a source-linked positive lot',async()=>{
  const {db,api,login}=fixture();try{
    await login();
    db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock,selling_price,purchase_price) VALUES ('SC-B','Screws','Hardware','Pcs',0,900,15)").run();
    const missing=await api('POST','/api/products/SC-B/stock-counts',{
      countId:'stockcount-000002',countedQuantity:3
    });
    assert.equal(missing.status,400,JSON.stringify(missing));
    const captured=await api('POST','/api/products/SC-B/stock-counts',{
      countId:'stockcount-000002',countedQuantity:3,verifiedUnitCost:25,note:'Three extra bolts'
    });
    assert.equal(captured.status,200,JSON.stringify(captured));
    assert.equal((db.native.prepare("SELECT current_stock FROM products WHERE product_id='SC-B'").get() as any).current_stock,0);
    const approved=await api('POST','/api/products/SC-B/stock-counts/stockcount-000002/approve',{});
    assert.equal(approved.status,200,JSON.stringify(approved));
    assert.equal(approved.costMinor,7500,'25×3 acquisition cost, not retail and not default purchase price');
    assert.equal(approved.remainingStock,3);
    const lot=db.native.prepare("SELECT source_type,source_ref,original_quantity,remaining_quantity,unit_cost FROM stock_lots WHERE product_id='SC-B'").get() as any;
    assert.equal(lot.source_type,'OPENING_ADJUSTMENT');
    assert.equal(lot.source_ref,'STOCKTAKE:stockcount-000002');
    assert.equal(lot.unit_cost,25);assert.equal(lot.remaining_quantity,3);
    const lines=db.native.prepare("SELECT quantity,cost_minor FROM stock_count_lots WHERE count_id='stockcount-000002'").all() as any[];
    assert.deepEqual(lines.map(x=>[x.quantity,x.cost_minor]),[[3,7500]]);
  }finally{db.close();}
});

test('business: exact count approves without a fabricated stock movement, rejects invalid quantities and missing products',async()=>{
  const {db,api,login}=fixture();try{
    await login();
    db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock) VALUES ('SC-C','Bolts','Hardware','Pcs',2)").run();
    db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES ('SC-LC','SC-C','PURCHASE',2,2,20)").run();
    for(const bad of [-1,1.00001,'not-a-number',null]){
      const r=await api('POST','/api/products/SC-C/stock-counts',{countId:'stockcount-bad-001',countedQuantity:bad});
      assert.equal(r.status,400,JSON.stringify({bad,r}));
    }
    const absent=await api('POST','/api/products/MISSING/stock-counts',{countId:'stockcount-other-01',countedQuantity:2});
    assert.equal(absent.status,404);
    assert.equal((await api('POST','/api/products/SC-C/stock-counts',{countId:'stockcount-000003',countedQuantity:2})).status,200);
    const approval=await api('POST','/api/products/SC-C/stock-counts/stockcount-000003/approve',{});
    assert.equal(approval.status,200,JSON.stringify(approval));
    assert.equal(approval.costMinor,0);assert.equal(approval.remainingStock,2);
    assert.equal((db.native.prepare("SELECT COUNT(*) n FROM stock_movements WHERE product_id='SC-C'").get() as any).n,0);
    assert.equal((db.native.prepare("SELECT COUNT(*) n FROM stock_count_lots WHERE count_id='stockcount-000003'").get() as any).n,0);
  }finally{db.close();}
});
