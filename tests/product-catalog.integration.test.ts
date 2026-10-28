import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { updateProductCatalog } from '../server/modules/products/catalog.service.ts';

const db = new SqliteDatabase(':memory:');
db.native.exec([
  'CREATE TABLE products (',
  ' product_id TEXT PRIMARY KEY, product_name TEXT, brand TEXT, category TEXT,',
  ' barcode TEXT, purchase_price REAL, selling_price REAL, minimum_stock REAL,',
  ' current_stock REAL, unit TEXT, status TEXT, is_deleted INTEGER, updated_at TEXT',
  ');',
  'CREATE TABLE product_brands (brand_id TEXT PRIMARY KEY, brand_name TEXT, status TEXT);',
  'CREATE TABLE product_categories (category_id TEXT PRIMARY KEY, category_name TEXT, status TEXT);',
  'CREATE TABLE stock_lots (lot_id TEXT PRIMARY KEY, product_id TEXT, remaining_quantity REAL);',
  'CREATE TABLE stock_movements (movement_id TEXT PRIMARY KEY, product_id TEXT, movement_type TEXT);',
  "INSERT INTO products VALUES ('P1','Cable','Generic','Electrical','B1',100,120,5,42,'Pcs','Active',0,'2026-10-28 10:00:00'),",
  " ('P2','Pipe','Generic','Hardware','B2',50,60,3,9,'Pcs','Active',0,'2026-10-28 10:00:00');",
  "INSERT INTO stock_lots VALUES ('LOT1','P1',42);",
  "INSERT INTO stock_movements VALUES ('MOV1','P1','OPENING');"
].join('\n'));

const payload = {
  expectedUpdatedAt:'2026-10-28 10:00:00',
  productName:'Cable Updated',brand:'New Brand',category:'Electrical',barcode:'B1',
  purchasePrice:110,sellingPrice:135,minimumStock:6
};

test('catalog update changes metadata but never stock, unit, lots, or movements', async () => {
  const before = db.native.prepare('SELECT unit,current_stock FROM products WHERE product_id=?').get('P1') as {unit:string;current_stock:number};
  const response = await updateProductCatalog(db, 'P1', payload);
  assert.equal(response.status,200,await response.text());
  const row = db.native.prepare('SELECT * FROM products WHERE product_id=?').get('P1') as Record<string,any>;
  assert.equal(row.product_name, 'Cable Updated');
  assert.equal(row.selling_price,135);
  assert.equal(row.current_stock,before.current_stock);
  assert.equal(row.unit,before.unit);
  assert.equal((db.native.prepare('SELECT remaining_quantity FROM stock_lots WHERE lot_id=?').get('LOT1') as any).remaining_quantity,42);
  assert.equal((db.native.prepare('SELECT COUNT(*) AS n FROM stock_movements').get() as any).n,1);
  assert.notEqual(row.updated_at,payload.expectedUpdatedAt);
});
test('stale product version cannot overwrite someone else',async()=>{
  const result=await updateProductCatalog(db,'P1',payload);
  assert.equal(result.status,409);
  assert.equal((db.native.prepare('SELECT selling_price FROM products WHERE product_id=?').get('P1') as any).selling_price,135);
});
test('reject duplicate product names and negative amounts',async()=>{
  const version=(db.native.prepare('SELECT updated_at FROM products WHERE product_id=?').get('P1') as any).updated_at;
  assert.equal((await updateProductCatalog(db,'P1',{...payload,expectedUpdatedAt:version,productName:'Pipe'})).status,400);
  assert.equal((await updateProductCatalog(db,'P1',{...payload,expectedUpdatedAt:version,sellingPrice:-1})).status,400);
  assert.equal((await updateProductCatalog(db,'P1',{...payload,expectedUpdatedAt:version,purchasePrice:undefined})).status,400);
});
test('catalog API ignores unsupported stock-adjustment fields',async()=>{
  const version=(db.native.prepare('SELECT updated_at FROM products WHERE product_id=?').get('P1') as any).updated_at;
  const res=await updateProductCatalog(db,'P1',{...payload,expectedUpdatedAt:version,currentStock:200} as any);
  assert.equal(res.status,200);
  assert.equal((db.native.prepare('SELECT current_stock FROM products WHERE product_id=?').get('P1') as any).current_stock,42);
});
test('teardown',()=>db.close());
