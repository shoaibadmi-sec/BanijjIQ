import test from 'node:test';
import assert from 'node:assert/strict';
import { BackendRequestError } from '../overlay/src/integration/banijjApi.ts';
import {
  toProductView, toLiveProduct, toCatalogView, classifyProductError
} from '../overlay/src/integration/products/productContracts.ts';
import {
  loadProductCatalog, loadProductLots, createProduct, editProduct
} from '../overlay/src/integration/products/productApi.ts';

const backendRow = {
  productId: 'PRD-000001', productName: 'PVC Pipe', brand: 'ABC',
  category: 'Pipe', unit: 'Pcs', barcode: '123456', purchasePrice: 0,
  sellingPrice: 120000, minimumStock: 5, currentStock: 18, sellableStock: 14,
  stockValue: 81.25, pendingTracking: 2, expiredStock: 2,
  trackSerial: 0, trackExpiry: 0, trackWarranty: 0,
  status: 'Active', updatedAt: '2026-10-29 05:00:00'
};
const catalog = rows => ({ ok: true, products: rows,
  categories: [{ id: 'c', name: 'Pipe' }], brands: [], units: [{ id: 'u', name: 'Pcs' }] });

test('D1 product maps into source HisabIQ Product without mixing stock and sellable quantities', () => {
  const mapped = toProductView(backendRow);
  assert.equal(mapped.id, 'PRD-000001');
  assert.equal(mapped.name, 'PVC Pipe');
  assert.equal(mapped.sku, '123456');
  assert.equal(mapped.stock, 18);
  assert.equal(mapped.minStock, 5);
  assert.equal(mapped.sellPrice, 120000);
  assert.equal(mapped.purchasePrice, 0, 'A zero purchase cost is valid');
  assert.equal(mapped.active, true);
  assert.equal(mapped.serialTracking, 'Off');
  const live = toLiveProduct(backendRow);
  assert.equal(live.stockValue, 81.25, 'Use server stock valuation, not stock × purchase price');
  assert.equal(live.sellableStock, 14);
  assert.equal(live.updatedAt, '2026-10-29 05:00:00');
  assert.deepEqual(live.tracking, { serial: false, expiry: false, warranty: false });
});

test('unreported tracking or stock valuation is unknown, never silently declared off or zero', () => {
  const row = { ...backendRow, stockValue: undefined, sellableStock: undefined,
    trackSerial: undefined, trackExpiry: undefined, trackWarranty: undefined };
  const live = toLiveProduct(row);
  assert.equal(live.stockValue, null);
  assert.equal(live.sellableStock, null);
  assert.deepEqual(live.tracking, { serial: null, expiry: null, warranty: null });
  assert.equal(live.product.serialTracking, undefined);
  assert.equal(toCatalogView(catalog([row])).totalStockValue, null);
});

test('empty authenticated D1 catalog stays empty with zero counters; no demo fallback', () => {
  const view = toCatalogView(catalog([]));
  assert.deepEqual(view.items, []);
  assert.equal(view.totalStockValue, 0);
  assert.equal(view.productCount, 0);
  assert.deepEqual(view.categories, [{ id: 'c', name: 'Pipe' }]);
});

test('authorized negative on-hand stock is preserved for oversold products', () => {
  const mapped = toProductView({ ...backendRow, currentStock: -2 });
  assert.equal(mapped.stock, -2, 'Negative inventory must not be silently clamped to zero');
});

test('invalid nonfinite D1 amounts are rejected rather than fabricated', () => {
  assert.throws(() => toProductView({ ...backendRow, sellingPrice: Number.NaN }), /sellingPrice/i);
  assert.throws(() => toProductView({ ...backendRow, currentStock: Infinity }), /currentStock/i);
});

test('application failures distinguish login, permission, conflict, server, and network', () => {
  assert.equal(classifyProductError(new BackendRequestError('login', 401)), 'unauthorized');
  assert.equal(classifyProductError(new BackendRequestError('denied', 403)), 'forbidden');
  assert.equal(classifyProductError(new BackendRequestError('changed', 409)), 'conflict');
  assert.equal(classifyProductError(new BackendRequestError('server', 503)), 'server-error');
  assert.equal(classifyProductError(new BackendRequestError('network', null)), 'network-error');
});

test('catalog, lots and writes use original authenticated backend transport and canonical IDs', async () => {
  const oldFetch = globalThis.fetch;
  const oldStorage = globalThis.localStorage;
  const called = [];
  const productId = 'PRD-000001';
  const responses = [
    catalog([backendRow]),
    { ok: true, lots: [{ lotId: 'LOT-1', purchaseId: 'OPENING', supplierName: null,
      purchaseDate: '2026-10-29', purchasePrice: 0, originalQuantity: 18, remainingQuantity: 11 }] },
    { ok: true, productId },
    { ok: true, productId }
  ];
  try {
    Object.defineProperty(globalThis, 'localStorage', { value: {
      getItem: key => key === 'shererp_auth_token' ? 'synthetic-token' : null,
      setItem: () => {}, removeItem: () => {}
    }, configurable: true });
    globalThis.fetch = async (path, options) => {
      called.push({ path, options });
      return new Response(JSON.stringify(responses.shift()), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    };
    assert.equal((await loadProductCatalog()).products[0].productId, productId);
    const lots = await loadProductLots(productId);
    assert.equal(lots[0].purchasePrice, 0, 'Do not replace zero lot cost with product default');
    await createProduct({ productName: 'PVC Pipe', brand: '', category: 'Pipe', unit: 'Pcs',
      barcode: '', purchasePrice: 0, sellingPrice: 120, minimumStock: 5, currentStock: 0,
      status: 'Active', trackSerial: false, trackExpiry: false, trackWarranty: false,
      warrantyPeriodValue: 0, warrantyPeriodUnit: 'Months' });
    await editProduct(productId, { productName: 'PVC Pipe B', brand: '',
      category: 'Pipe', barcode: '', purchasePrice: 0, sellingPrice: 120,
      minimumStock: 5, expectedUpdatedAt: '2026-10-29 05:00:00' });
    assert.deepEqual(called.map(x => x.path), [
      '/api/bootstrap', '/api/products/PRD-000001/lots', '/api/products', '/api/products/PRD-000001/catalog'
    ]);
    assert.deepEqual(called.map(x => x.options.method || 'GET'), ['GET', 'GET', 'POST', 'PUT']);
    for (const item of called) assert.equal(new Headers(item.options.headers).get('Authorization'), 'Bearer synthetic-token');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldStorage === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, 'localStorage', { value: oldStorage, configurable: true });
  }
});

test('connection failure does not fabricate catalog products or retry a write', async () => {
  const oldFetch = globalThis.fetch;
  const oldStorage = globalThis.localStorage;
  let calls = 0;
  try {
    Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => '', removeItem: () => {} }, configurable: true });
    globalThis.fetch = async () => { calls++; throw new Error('offline'); };
    await assert.rejects(loadProductCatalog(), e => {
      assert.equal(classifyProductError(e), 'network-error');
      return true;
    });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldStorage === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, 'localStorage', { value: oldStorage, configurable: true });
  }
});
