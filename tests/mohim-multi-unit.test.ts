import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.js';
import { runMigrations } from '../server/db/migrate.js';
import { normalizeUnitChain, breakdownToBase, getProductUnitConfig, saveProductUnitConfig, validateSaleUnitBreakdown } from '../server/modules/products/units.service.js';
import { completeSaleRoute, getInvoiceRoute, getPosBootstrapRoute } from '../server/modules/sales/service.js';

const input = [{unit:'Carton',count:12,smallerUnit:'Box'},{unit:'Box',count:20,smallerUnit:'Pcs'}];

test('unit chain converts 1 CT 2 BOX 3 PCS to 283 PCS, never to another stock balance', () => {
  const rules = normalizeUnitChain('Pcs',input);
  assert.deepEqual(rules.map(x=>[x.unit,x.factor]),[['Carton',240],['Box',20]]);
  assert.equal(breakdownToBase('Pcs',rules,[{unit:'Carton',count:1},{unit:'Box',count:2},{unit:'Pcs',count:3}]),283);
  assert.equal(breakdownToBase('Gira',normalizeUnitChain('Gira',[{unit:'Gauge',count:16,smallerUnit:'Gira'}]),[{unit:'Gauge',count:3},{unit:'Gira',count:10}]),58);
  for(const bad of [
    [{unit:'Box',count:20,smallerUnit:'Different'}],
    [{unit:'Box',count:1,smallerUnit:'Pcs'}],
    [{unit:'Box',count:20,smallerUnit:'Pcs'},{unit:'Box',count:10,smallerUnit:'Pcs'}],
    [{unit:'Pcs',count:20,smallerUnit:'Pcs'}],
  ]) assert.throws(()=>normalizeUnitChain('Pcs',bad));
  assert.throws(()=>breakdownToBase('Pcs',rules,[{unit:'Box',count:2},{unit:'Box',count:3}]));
  assert.throws(()=>breakdownToBase('Pcs',rules,[{unit:'Box',count:2.5}]));
  assert.throws(()=>breakdownToBase('Pcs',rules,[{unit:'Unknown',count:1}]));
});

test('D1-compatible unit rules and actual POS posting keep canonical stock and persist mixed-unit snapshot', async () => {
  const db = new SqliteDatabase(':memory:');
  const user = {userId:'usr-1',fullName:'Tester',phone:'',role:'Admin',status:'Active'};
  try {
    const migration = runMigrations(db.native,resolve('migrations'));
    assert.equal(migration.applied.length,29);
    assert.ok(migration.applied.includes('0028_product_unit_conversions.sql'));

    db.native.prepare('INSERT INTO app_users (user_id,full_name,phone,password_hash,password_salt) VALUES (?,?,?,?,?)')
      .run(user.userId,'Tester','01700000000','test-hash','test-salt');

    db.native.prepare('INSERT INTO products (product_id,product_name,category,unit,purchase_price,selling_price,current_stock,minimum_stock) VALUES (?,?,?,?,?,?,?,?)')
      .run('PRD-TST','Carton Test','Electrical','Pcs',10,25,300,10);
    db.native.prepare("INSERT INTO stock_lots (lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost) VALUES (?,?,?,?,?,?,?)")
      .run('LOT-TST','PRD-TST','OPENING','',300,300,10);
    db.native.prepare("INSERT INTO cash_sessions (session_id,opened_by,status,opening_cash) VALUES (?,?,?,?)").run('CSS-TST',user.userId,'Open',0);

    let response = await saveProductUnitConfig(db,'PRD-TST',{relations:input});
    assert.equal(response.status,200);
    response = await getProductUnitConfig(db,'PRD-TST');
    assert.deepEqual((await response.json() as any).relations.map((x:any)=>x.factor),[240,20]);

    const good=[{unit:'Carton',count:1},{unit:'Box',count:2},{unit:'Pcs',count:3}];
    assert.deepEqual(await validateSaleUnitBreakdown(db,'PRD-TST','Pcs',good,283),good);
    await assert.rejects(()=>validateSaleUnitBreakdown(db,'PRD-TST','Pcs',good,282));
    assert.equal((await saveProductUnitConfig(db,'PRD-TST',{relations:[{unit:'Box',count:1,smallerUnit:'Pcs'}]})).status,400);
    const bootstrap=await (await getPosBootstrapRoute(db,user)).json() as any;
    assert.deepEqual(bootstrap.products.find((p:any)=>p.id==='PRD-TST').conversions.map((p:any)=>p.factor),[240,20]);

    const sale=await completeSaleRoute(db,{
      customerName:'Walk-in Test',customerPhone:'01700000000',paymentType:'Cash',paymentMethod:'Cash',
      items:[{productId:'PRD-TST',name:'Carton Test',qty:283,unitPrice:25,unitBreakdown:good}]
    },user);
    assert.equal(sale.status,200,JSON.stringify(await sale.clone().json()));
    const invoice=(await sale.json() as any).invoice.invoiceId;
    assert.equal((db.native.prepare('SELECT current_stock AS n FROM products WHERE product_id=?').get('PRD-TST') as any).n,17);
    assert.deepEqual(JSON.parse((db.native.prepare('SELECT unit_breakdown_json AS j FROM sale_items WHERE invoice_id=?').get(invoice) as any).j),good);
    const historic = await (await getInvoiceRoute(db,invoice)).json() as any;
    assert.deepEqual(historic.invoice.items[0].unitBreakdown,good);
    const invalid=await completeSaleRoute(db,{
      customerName:'Walk-in Test',customerPhone:'01700000000',paymentType:'Cash',paymentMethod:'Cash',
      items:[{productId:'PRD-TST',name:'Carton Test',qty:10,unitPrice:25,unitBreakdown:[{unit:'Box',count:2}]}]
    },user);
    assert.equal(invalid.status,400);
    assert.equal((db.native.prepare('SELECT count(*) AS n FROM sales').get() as any).n,1);
    assert.equal((db.native.prepare('SELECT current_stock AS n FROM products WHERE product_id=?').get('PRD-TST') as any).n,17);
  } finally { db.close(); }
});
