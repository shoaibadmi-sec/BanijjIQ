import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { readStockLedger } from '../server/modules/products/stockLedger.service.ts';

function fixture() {
  const db = new SqliteDatabase(':memory:');
  runMigrations(db.native, resolve('migrations'));
  return db;
}
function seed(db: SqliteDatabase) {
  db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock) VALUES ('P7A','Cable','Electrical','Pcs',8)").run();
  db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost) VALUES ('L-OPEN','P7A','OPENING','',5,0,25),('L-BUY','P7A','PURCHASE','PO-1',10,8,35)").run();
  const insert = db.native.prepare("INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,lot_id,note,created_at) VALUES (?,'P7A',?,?,?,?,?,?,'2026-10-30 10:00:00')");
  insert.run('M-OPEN','OPENING',5,0,5,'L-OPEN','Opening stock');
  insert.run('M-BUY','Purchase',10,0,15,'L-BUY','PO-1');
  // POS posts one row per lot, each with the final invoice-level master balance.
  insert.run('M-SALE-1','Sale',0,5,8,'L-OPEN','INV-1');
  insert.run('M-SALE-2','Sale',0,2,8,'L-BUY','INV-1');
}
test('business: multi-lot FIFO sale uses total net quantity, not per-lot running balance',async()=>{
  const db=fixture();
  try {
    seed(db);
    const before=(db.native.prepare('SELECT total_changes() n').get() as {n:number}).n;
    const result=await readStockLedger(db,'P7A',1,50);
    assert.ok(result);
    assert.equal(result.integrity.status,'ready',result.integrity.issues.join(','));
    assert.equal(result.integrity.masterStock,8);
    assert.equal(result.integrity.lotStock,8);
    assert.equal(result.integrity.recordedNet,8);
    assert.equal(result.totalRows,4);
    assert.deepEqual(result.items.map(x=>x.movementId),['M-SALE-2','M-SALE-1','M-BUY','M-OPEN']);
    assert.deepEqual(result.items.map(x=>x.lotId),['L-BUY','L-OPEN','L-BUY','L-OPEN']);
    assert.equal(result.items[0].quantityOut,2);
    assert.equal((db.native.prepare('SELECT total_changes() n').get() as {n:number}).n,before);
  } finally {db.close();}
});
test('business: master, FIFO lots, and immutable movement total are independently checked',async()=>{
  const db=fixture();
  try {
    seed(db);
    db.native.prepare("UPDATE products SET current_stock=9 WHERE product_id='P7A'").run();
    let result=await readStockLedger(db,'P7A',1,50);
    assert.ok(result);
    assert.equal(result.integrity.status,'needs-review');
    assert.ok(result.integrity.issues.includes('MASTER_LOT_MISMATCH'));
    assert.ok(result.integrity.issues.includes('MASTER_MOVEMENT_MISMATCH'));
    assert.ok(result.integrity.issues.includes('LATEST_BALANCE_MISMATCH'));
    db.native.prepare("UPDATE products SET current_stock=8 WHERE product_id='P7A'").run();
    db.native.prepare("UPDATE stock_lots SET remaining_quantity=3 WHERE lot_id='L-BUY'").run();
    result=await readStockLedger(db,'P7A',1,50);
    assert.ok(result);
    assert.ok(result.integrity.issues.includes('MASTER_LOT_MISMATCH'));
    assert.equal(result.integrity.recordedNet,8);
  } finally {db.close();}
});
test('business: missing evidence and invalid source quantities must fail closed',async()=>{
  const db=fixture();
  try {
    db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock) VALUES ('EMPTY','Legacy','Hardware','Pcs',0)").run();
    const empty=await readStockLedger(db,'EMPTY',1,50);
    assert.ok(empty);
    assert.equal(empty.integrity.status,'needs-review');
    assert.ok(empty.integrity.issues.includes('MISSING_MOVEMENTS'));
    assert.equal(await readStockLedger(db,'MISSING',1,50),null);
    seed(db);
    db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost) VALUES ('L-NEG','P7A','OVERSOLD','INV-OVERSOLD',0,-1,25)").run();
    db.native.prepare("UPDATE stock_movements SET quantity_in=-2 WHERE movement_id='M-BUY'").run();
    const bad=await readStockLedger(db,'P7A',1,50);
    assert.ok(bad);
    assert.equal(bad.integrity.status,'needs-review');
    assert.ok(bad.integrity.issues.includes('INVALID_LOT_QUANTITY'));
    assert.ok(bad.integrity.issues.includes('INVALID_MOVEMENT_QUANTITY'));
  } finally {db.close();}
});
test('business: page 1/2 and pageSize 100 are stable despite duplicate timestamps',async()=>{
  const db=fixture();
  try {
    seed(db);
    const insert=db.native.prepare("INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,created_at) VALUES (?,'P7A','Correction',0,0,8,'2026-10-30 10:00:00')");
    for(let i=0;i<111;i++)insert.run('M-EXTRA-'+String(i).padStart(3,'0'));
    const p1=await readStockLedger(db,'P7A',1,50);
    const p2=await readStockLedger(db,'P7A',2,50);
    const p100=await readStockLedger(db,'P7A',1,100);
    assert.ok(p1&&p2&&p100);
    assert.equal(p1.totalRows,115);
    assert.equal(p1.items.length,50);
    assert.equal(p2.items.length,50);
    assert.equal(p100.items.length,100);
    assert.equal(new Set([...p1.items,...p2.items].map(x=>x.movementId)).size,100);
    assert.equal(p1.items[0].movementId,'M-EXTRA-110');
    assert.equal(p1.integrity.status,'ready');
  } finally {db.close();}
});
