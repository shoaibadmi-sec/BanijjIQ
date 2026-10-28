import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.js';
import { runMigrations } from '../server/db/migrate.js';
import { addLookup, listLookups, updateLookup, getProductsBootstrap } from '../server/modules/products/service.js';
import { getPosBootstrapRoute } from '../server/modules/sales/service.js';

test('Mohim unit symbols are display metadata and never alter product identity or stock', async () => {
  const db = new SqliteDatabase(':memory:');
  try {
    const applied = runMigrations(db.native, resolve('migrations'));
    assert.equal(applied.applied.length, 27);
    assert.ok(applied.applied.includes('0028_unit_symbols.sql'));
    assert.equal(runMigrations(db.native, resolve('migrations')).applied.length, 0);

    let response = await addLookup(db, 'unit', { name: 'Pieces', symbol: 'PCS' });
    assert.equal(response.status, 200);
    let added = await response.json() as { id: string; name: string; symbol: string };
    assert.equal(added.symbol, 'PCS');

    response = await addLookup(db, 'unit', { name: 'pieces', symbol: 'P' });
    assert.equal(response.status, 409, 'Duplicate unit name must not overwrite existing symbol');

    const before = db.native.prepare('SELECT unit_name, symbol FROM product_units WHERE unit_id = ?').get(added.id) as { unit_name: string; symbol: string };
    assert.deepEqual(before, { unit_name: 'Pieces', symbol: 'PCS' });

    db.native.prepare('INSERT INTO products (product_id, product_name, category, unit, purchase_price, selling_price, current_stock, minimum_stock) VALUES (?,?,?,?,?,?,?,?)')
      .run('PRD-001001', 'Pipe Connector', 'Electrical', 'Pieces', 12.25, 25.5, 14, 2);

    response = await updateLookup(db, 'unit', added.id, { name: 'Pieces', symbol: 'PC' });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { symbol: string }).symbol, 'PC');

    const stable = db.native.prepare('SELECT unit, current_stock, purchase_price, selling_price FROM products WHERE product_id = ?').get('PRD-001001');
    assert.deepEqual(stable, { unit: 'Pieces', current_stock: 14, purchase_price: 12.25, selling_price: 25.5 });

    response = await updateLookup(db, 'unit', added.id, { name: 'Pieces Renamed', symbol: 'PX' });
    assert.equal(response.status, 400);
    response = await updateLookup(db, 'unit', added.id, { name: 'Pieces', symbol: 'SYMBOL_IS_TOO_LONG' });
    assert.equal(response.status, 400);

    const lookup = await (await listLookups(db, 'unit')).json() as { items: Array<{ name: string; symbol: string }> };
    assert.equal(lookup.items[0].name, 'Pieces');
    assert.equal(lookup.items[0].symbol, 'PC');

    const bootstrap = await (await getProductsBootstrap(db)).json() as { units: Array<{ name: string; symbol: string }> };
    assert.deepEqual(bootstrap.units[0], { id: added.id, name: 'Pieces', symbol: 'PC' });

    const pos = await (await getPosBootstrapRoute(db, { userId:'test-user', fullName:'Test', phone:'', role:'admin', status:'Active' })).json() as { products: Array<{ id: string; unit: string; unitSymbol: string }> };
    assert.equal(pos.products.find(x=>x.id==='PRD-001001')?.unit, 'Pieces');
    assert.equal(pos.products.find(x=>x.id==='PRD-001001')?.unitSymbol, 'PC');

    response = await updateLookup(db, 'unit', added.id, { name: 'Pieces', symbol: '' });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { symbol: string }).symbol, '');
    assert.equal((db.native.prepare('SELECT unit FROM products WHERE product_id = ?').get('PRD-001001') as {unit:string}).unit, 'Pieces');
  } finally {
    db.close();
  }
});
