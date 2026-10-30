import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { readStockDues } from '../server/modules/reporting/live/stock-dues.ts';
import { parseLiveReportQuery } from '../server/modules/reporting/live/query.ts';

const query=()=>parseLiveReportQuery(new URL(
  'https://test.local/api/reports/v2/rows?report=stock&from=2026-10-01&to=2026-10-30'
));
const fixture=()=>{
  const db=new SqliteDatabase(':memory:');
  runMigrations(db.native,resolve('migrations'));
  return db;
};
async function value(db:SqliteDatabase){
  const report=await readStockDues(db,query());
  return {report,metric:report.metrics.find(x=>x.key==='inventoryValue')};
}
function product(db:SqliteDatabase,id:string,stock:number){
  db.native.prepare('INSERT INTO products(product_id,product_name,category,unit,current_stock,selling_price) VALUES (?,?,?,?,?,?)')
    .run(id,id,'Hardware','Pcs',stock,999);
}
function lot(db:SqliteDatabase,id:string,productId:string,original:number,remaining:number,cost:number){
  db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES (?,?, 'PURCHASE',?,?,?)")
    .run(id,productId,original,remaining,cost);
}

test('business: a five-decimal stock quantity cannot be certified as a four-decimal FIFO asset',async()=>{
  const db=fixture();
  try {
    product(db,'P-EXTRA-DP',1.00001);
    lot(db,'L-EXTRA-DP','P-EXTRA-DP',2,1.00001,20);
    const {report,metric}=await value(db);
    assert.equal(report.coverage.status,'incomplete');
    assert.equal(report.rows[0].amountMinor,null);
    assert.equal(metric?.valueMinor,null);
    assert.match(report.rows[0].reason,/precision|decimal|quantity/i);
  } finally {db.close();}
});

test('business: a surviving FIFO lot exceeding its original quantity cannot be valued',async()=>{
  const db=fixture();
  try {
    product(db,'P-IMPOSSIBLE',4);
    lot(db,'L-IMPOSSIBLE','P-IMPOSSIBLE',3,4,20);
    const {report,metric}=await value(db);
    assert.equal(report.coverage.status,'incomplete');
    assert.equal(report.rows[0].amountMinor,null);
    assert.equal(metric?.valueMinor,null);
    assert.match(report.rows[0].reason,/original|exceed|quantity/i);
  } finally {db.close();}
});

test('business: over-precise acquisition cost is not silently rounded into FIFO asset value',async()=>{
  const db=fixture();
  try {
    product(db,'P-COST-DP',2);
    lot(db,'L-COST-DP','P-COST-DP',2,2,25.00001);
    const {report,metric}=await value(db);
    assert.equal(report.coverage.status,'incomplete');
    assert.equal(report.rows[0].amountMinor,null);
    assert.equal(metric?.valueMinor,null);
    assert.match(report.rows[0].reason,/precision|decimal|cost/i);
  } finally {db.close();}
});

test('business: entire shop inventory value fails closed when sum overflows safe integer poisha',async()=>{
  const db=fixture();
  try {
    for(const id of ['P-BIG-A','P-BIG-B']){
      product(db,id,1_000_000_000);
      lot(db,'L-'+id,id,1_000_000_000,1_000_000_000,60_000);
    }
    const {report,metric}=await value(db);
    assert.equal(report.totalRows,2);
    assert.equal(report.rows[0].amountMinor,6_000_000_000_000_000);
    assert.equal(report.rows[1].amountMinor,6_000_000_000_000_000);
    assert.equal(report.coverage.status,'incomplete');
    assert.equal(metric?.valueMinor,null,'the combined amount is larger than Number.MAX_SAFE_INTEGER');
    assert.match(report.coverage.reason,/overflow|safe|represent/i);
  } finally {db.close();}
});

test('business: valid mixed-cost lots still value surviving units at purchase cost without a write',async()=>{
  const db=fixture();
  try {
    product(db,'P-FIFO',5);
    lot(db,'L-FIRST','P-FIFO',4,2,70);
    lot(db,'L-SECOND','P-FIFO',6,3,90);
    const before=(db.native.prepare('SELECT total_changes() AS n').get() as {n:number}).n;
    const {report,metric}=await value(db);
    assert.equal(report.rows[0].amountMinor,41_000);
    assert.equal(metric?.valueMinor,41_000);
    assert.deepEqual(metric?.sources.map(x=>x.sourceId),['L-FIRST','L-SECOND']);
    assert.equal(report.coverage.status,'needs-review','a current FIFO snapshot is not an audited historical asset');
    assert.equal((db.native.prepare('SELECT total_changes() AS n').get() as {n:number}).n,before);
  } finally {db.close();}
});
