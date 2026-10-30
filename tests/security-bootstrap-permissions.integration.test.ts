import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { handleApiRequest } from '../server/core/handler.ts';

test('product bootstrap enforces least privilege without breaking POS', async (t) => {
  const db = new SqliteDatabase(':memory:');
  try {
    runMigrations(db.native, resolve('migrations'));
    const api = async (method: string, path: string, token = '', body?: unknown) => {
      const response = await handleApiRequest(new Request('http://isolated.invalid' + path, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      }), db);
      return { ...await response.json() as Record<string, any>, status: response.status };
    };
    const setup = await api('POST', '/api/setup/admin', '', {
      fullName: 'Bootstrap Test Admin', phone: '01000002601', password: 'Local-Admin-Test-Secret!',
    });
    assert.equal(setup.status, 200, JSON.stringify(setup));
    const adminToken = setup.token as string;
    const supplier = await api('POST', '/api/suppliers', adminToken, {
      name: 'Synthetic Sensitive Supplier', phone: '01000002620', openingBalance: 37,
    });
    assert.equal(supplier.status, 200, JSON.stringify(supplier));
    const bank = await api('POST', '/api/bank/accounts', adminToken, {
      name: 'Synthetic Company Bank', accountType: 'Bank', openingBalance: 0,
    });
    assert.equal(bank.status, 200, JSON.stringify(bank));
    const product = await api('POST', '/api/products', adminToken, {
      productName: 'Sensitive Test Cable', brand: '', category: 'Electrical', unit: 'Pcs',
      barcode: 'BOOTSTRAP-SEC-001', purchasePrice: 43, sellingPrice: 77,
      currentStock: 5, minimumStock: 1, trackSerial: false, trackExpiry: false,
      trackWarranty: false, status: 'Active',
    });
    assert.equal(product.status, 200, JSON.stringify(product));
    db.native.prepare('UPDATE products SET preferred_supplier_id = ? WHERE product_id = ?')
      .run(supplier.id, product.productId);
    const makeStaff = async (suffix: string, permissions: Record<string, unknown>) => {
      const roleName = 'BootSecurity' + suffix;
      const role = await api('POST', '/api/roles', adminToken, { name: roleName, permissions });
      assert.equal(role.status, 200, JSON.stringify(role));
      const phone = '010000026' + suffix.padStart(2, '0');
      const created = await api('POST', '/api/users', adminToken, {
        name: 'Bootstrap Staff ' + suffix, mobile: phone, role: roleName,
        password: 'Local-Staff-Test-Secret!',
      });
      assert.equal(created.status, 200, JSON.stringify(created));
      const login = await api('POST', '/api/auth/login', '', { phone, password: 'Local-Staff-Test-Secret!' });
      assert.equal(login.status, 200, JSON.stringify(login));
      return login.token as string;
    };
    const blocked = await makeStaff('01', { reports: { view: true } });
    const posOnly = await makeStaff('02', { pos: { view: true } });
    const productsOnly = await makeStaff('03', { products: { view: true } });
    const supplierReader = await makeStaff('04', { products: { view: true }, suppliers: { view: true } });
    const bankReader = await makeStaff('05', { products: { view: true }, bank: { view: true } });
    const purchaser = await makeStaff('06', { products: { view: true }, purchase: { view: true } });
    const editor = await makeStaff('07', { products: { view: true, edit: true } });
    const costReader = await makeStaff('08', { products: { view: true }, posCost: { view: true } });

    await t.test('anonymous and users without products.view are denied', async () => {
      assert.equal((await api('GET', '/api/bootstrap')).status, 401);
      assert.equal((await api('GET', '/api/bootstrap', blocked)).status, 403);
      assert.equal((await api('GET', '/api/bootstrap', posOnly)).status, 403);
      const posData = await api('GET', '/api/pos/bootstrap', posOnly);
      assert.equal(posData.status, 200, JSON.stringify(posData));
      assert.ok(posData.products.some((p: any) => p.productName === 'Sensitive Test Cable'));
      assert.equal('purchasePrice' in posData.products.find((p: any) => p.productName === 'Sensitive Test Cable'), false);
    });

    await t.test('products.view alone receives catalog but no cost, supplier or bank data', async () => {
      const result = await api('GET', '/api/bootstrap', productsOnly);
      assert.equal(result.status, 200, JSON.stringify(result));
      const item = result.products.find((p: any) => p.productId === product.productId);
      assert.ok(item);
      assert.equal(item.sellingPrice, 77);
      assert.equal(item.currentStock, 5);
      for (const field of ['purchasePrice', 'stockValue', 'preferredSupplierId', 'preferredSupplierName']) {
        assert.equal(Object.hasOwn(item, field), false, field + ' must not be disclosed');
      }
      assert.deepEqual(result.suppliers, []);
      assert.deepEqual(result.bankAccounts, []);
    });

    await t.test('supplier and bank disclosure require their respective access', async () => {
      const supplierData = await api('GET', '/api/bootstrap', supplierReader);
      assert.equal(supplierData.status, 200);
      assert.ok(supplierData.suppliers.some((s: any) => s.id === supplier.id && s.currentDue === 37));
      assert.deepEqual(supplierData.bankAccounts, []);
      const supplierItem = supplierData.products.find((p: any) => p.productId === product.productId);
      assert.equal(supplierItem.preferredSupplierId, supplier.id);
      assert.equal(Object.hasOwn(supplierItem, 'purchasePrice'), false);
      const bankData = await api('GET', '/api/bootstrap', bankReader);
      assert.equal(bankData.status, 200);
      assert.ok(bankData.bankAccounts.some((b: any) => b.id === bank.id));
      assert.deepEqual(bankData.suppliers, []);
      assert.equal(Object.hasOwn(bankData.products.find((p: any) => p.productId === product.productId), 'preferredSupplierName'), false);
    });

    await t.test('purchase or product-edit authority can see cost, without unrelated data', async () => {
      for (const token of [purchaser, editor, costReader]) {
        const result = await api('GET', '/api/bootstrap', token);
        assert.equal(result.status, 200);
        const item = result.products.find((p: any) => p.productId === product.productId);
        assert.equal(item.purchasePrice, 43);
        assert.equal(item.stockValue, 215);
      }
      const editResult = await api('GET', '/api/bootstrap', editor);
      assert.deepEqual(editResult.suppliers, []);
      assert.deepEqual(editResult.bankAccounts, []);
      const explicitCost = await api('GET', '/api/bootstrap', costReader);
      assert.deepEqual(explicitCost.suppliers, []);
      assert.deepEqual(explicitCost.bankAccounts, []);
      const purchaseResult = await api('GET', '/api/bootstrap', purchaser);
      assert.ok(purchaseResult.suppliers.some((s: any) => s.id === supplier.id));
      assert.ok(purchaseResult.bankAccounts.some((b: any) => b.id === bank.id));
    });

    await t.test('administrator retains full existing bootstrap contract', async () => {
      const result = await api('GET', '/api/bootstrap', adminToken);
      assert.equal(result.status, 200);
      const item = result.products.find((p: any) => p.productId === product.productId);
      assert.equal(item.purchasePrice, 43);
      assert.equal(item.stockValue, 215);
      assert.equal(item.preferredSupplierId, supplier.id);
      assert.ok(result.suppliers.some((s: any) => s.id === supplier.id));
      assert.ok(result.bankAccounts.some((b: any) => b.id === bank.id));
    });
  } finally {
    db.close();
  }
});
