import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { handleApiRequest } from '../server/core/handler.ts';

test('Products Tasks 3–4: transactional D1 semantics and genuine Mohim actions', async t => {
  const db = new SqliteDatabase(':memory:');
  try {
    runMigrations(db.native, resolve('migrations'));
    let token = '';
    const sql = (query: string, ...params: unknown[]) => db.native.prepare(query).get(...params) as any;
    const list = (query: string, ...params: unknown[]) => db.native.prepare(query).all(...params) as any[];
    const count = (table: string) => Number(sql('SELECT COUNT(*) AS n FROM ' + table).n);
    async function api(method: string, path: string, body?: unknown, bearer = token) {
      const headers: Record<string, string> = {'content-type':'application/json'};
      if (bearer) headers.authorization = 'Bearer ' + bearer;
      const response = await handleApiRequest(new Request('http://local.test' + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body)
      }), db);
      const payload = await response.json() as Record<string, any>;
      return {status: response.status, ...payload};
    }
    const base = (name: string, overrides: Record<string, unknown> = {}) => ({
      productName:name, brand:'Hybrid Brand', category:'Hardware', unit:'Pcs',
      barcode:'BAR-' + name.replace(/\W/g, '-'), purchasePrice:20,
      sellingPrice:30, currentStock:5, minimumStock:1,
      trackSerial:false, trackExpiry:false, trackWarranty:false, status:'Active',
      ...overrides
    });
    await t.test('authenticated product owner', async () => {
      const res = await api('POST','/api/setup/admin',{
        fullName:'Isolated Products Admin',phone:'01000005544',password:'Synthetic-Only-Secret-2026!'
      });
      assert.equal(res.ok,true,JSON.stringify(res));
      token = res.token;
    });
    let productId = '';
    await t.test('create adds one product, opening lot, stock movement and lookup references', async () => {
      const res = await api('POST','/api/products',base('Hybrid Cable'));
      assert.equal(res.status,200,JSON.stringify(res));
      productId = res.productId;
      assert.equal(Number(sql('SELECT current_stock AS n FROM products WHERE product_id=?',productId).n),5);
      assert.equal(list('SELECT * FROM stock_lots WHERE product_id=?',productId).length,1);
      assert.equal(list('SELECT * FROM stock_movements WHERE product_id=?',productId).length,1);
      assert.equal(Number(sql('SELECT unit_cost AS n FROM stock_lots WHERE product_id=?',productId).n),20);
    });
    await t.test('duplicate name/barcode do not write any products, lots, movements or lookup rows', async () => {
      const before = ['products','stock_lots','stock_movements','product_categories','product_brands','product_units'].map(count);
      assert.equal((await api('POST','/api/products',base('Hybrid Cable',{barcode:'DIFFERENT'}))).status,400);
      assert.equal((await api('POST','/api/products',base('Duplicate Barcode',{barcode:'BAR-Hybrid-Cable'}))).status,400);
      assert.deepEqual(['products','stock_lots','stock_movements','product_categories','product_brands','product_units'].map(count),before);
    });
    await t.test('malformed numeric stock and prices cannot be silently rounded/clamped into a write', async () => {
      const before = count('products');
      for (const [name, extra] of [
        ['Negative-Stock',{currentStock:-2}],
        ['Negative-Price',{sellingPrice:-10}],
        ['Invalid-Minimum',{minimumStock:-1}],
        ['Too-Large',{currentStock:Number.MAX_VALUE}],
        ['Not-A-Number',{purchasePrice:'not-a-number'}],
      ] as [string,Record<string,unknown>][]) {
        const result=await api('POST','/api/products',base(name,extra));
        assert.equal(result.status,400,JSON.stringify({name,result}));
      }
      assert.equal(count('products'),before);
    });
    await t.test('invalid expiry and duplicate existing serial never persist partial product, lot, tracking or lookup rows', async () => {
      const prior=await api('POST','/api/products',base('Tracked Source',{
        trackSerial:true,currentStock:1,openingTracking:{serialNumbers:['EXISTING-TRACK-1']}
      }));
      assert.equal(prior.status,200,JSON.stringify(prior));
      const tracked = await api('POST','/api/products',base('Broken Tracking',{
        category:'DO-NOT-CREATE',brand:'DO-NOT-CREATE',
        trackSerial:true,currentStock:1,openingTracking:{serialNumbers:['EXISTING-TRACK-1']}
      }));
      assert.equal(tracked.status,400,JSON.stringify(tracked));
      const invalid = await api('POST','/api/products',base('Invalid Expiry',{
        category:'DO-NOT-CREATE',brand:'DO-NOT-CREATE',
        trackExpiry:true,currentStock:2,
        openingTracking:{expiryBatches:[{quantity:2,expiryDate:'not-a-date'}]}
      }));
      assert.equal(invalid.status,400,JSON.stringify(invalid));
      assert.equal(list('SELECT * FROM products WHERE product_name IN (?,?)','Broken Tracking','Invalid Expiry').length,0);
      assert.equal(list('SELECT * FROM product_categories WHERE category_name=?','DO-NOT-CREATE').length,0);
      assert.equal(list('SELECT * FROM stock_lots WHERE product_id NOT IN (SELECT product_id FROM products)').length,0);
      assert.equal(list('SELECT * FROM product_serials WHERE product_id NOT IN (SELECT product_id FROM products)').length,0);
    });
    await t.test('catalog concurrent revision winner and stale loser never change stock or lots', async () => {
      const old=sql('SELECT updated_at AS version FROM products WHERE product_id=?',productId).version;
      const payload={expectedUpdatedAt:old, productName:'Hybrid Cable Updated',brand:'Hybrid Brand',
        category:'Hardware',barcode:'BAR-Hybrid-Cable',purchasePrice:21,
        sellingPrice:35,minimumStock:2,currentStock:9999};
      const [first,second] = await Promise.all([
        api('PUT','/api/products/'+productId+'/catalog',payload),
        api('PUT','/api/products/'+productId+'/catalog',payload)
      ]);
      assert.deepEqual([first.status,second.status].sort(),[200,409]);
      assert.equal(sql('SELECT current_stock AS stock FROM products WHERE product_id=?',productId).stock,5);
      assert.equal(sql('SELECT remaining_quantity AS n FROM stock_lots WHERE product_id=?',productId).n,5);
      assert.equal(list('SELECT * FROM stock_movements WHERE product_id=?',productId).length,1);
      assert.equal((await api('PUT','/api/products/DOES-NOT-EXIST/catalog',payload)).status,404);
    });
    await t.test('adjust stock +3 and -2 conserves lot and master quantities and writes auditable movements', async () => {
      const more=await api('POST','/api/products/'+productId+'/adjust-stock',{delta:3,note:'Counted delivery'});
      assert.equal(more.status,200,JSON.stringify(more));
      assert.equal(sql('SELECT current_stock n FROM products WHERE product_id=?',productId).n,8);
      let lots=list('SELECT remaining_quantity n FROM stock_lots WHERE product_id=?',productId);
      assert.equal(lots.reduce((a,r)=>a+r.n,0),8);
      const less=await api('POST','/api/products/'+productId+'/adjust-stock',{delta:-2,note:'Damaged items'});
      assert.equal(less.status,200,JSON.stringify(less));
      assert.equal(sql('SELECT current_stock n FROM products WHERE product_id=?',productId).n,6);
      lots=list('SELECT remaining_quantity n FROM stock_lots WHERE product_id=?',productId);
      assert.equal(lots.reduce((a,r)=>a+r.n,0),6);
      assert.equal(list('SELECT * FROM stock_movements WHERE product_id=?',productId).length,3);
    });
    await t.test('invalid, oversized, overdraw and tracked stock-out leave product, lots, movements untouched', async () => {
      const snapshot=()=>JSON.stringify({
        master:sql('SELECT current_stock n FROM products WHERE product_id=?',productId).n,
        lots:list('SELECT lot_id,remaining_quantity FROM stock_lots WHERE product_id=? ORDER BY lot_id',productId),
        movements:list('SELECT movement_id FROM stock_movements WHERE product_id=? ORDER BY movement_id',productId)
      });
      const before=snapshot();
      for(const delta of [-99,0,1e20,'not-a-number',null]) {
        const res=await api('POST','/api/products/'+productId+'/adjust-stock',{delta,note:'invalid'});
        assert.equal(res.status,400,JSON.stringify({delta,res}));
        assert.equal(snapshot(),before,'invalid delta must not write anything');
      }
      assert.equal((await api('POST','/api/products/NO-ID/adjust-stock',{delta:1,note:'missing'})).status,404);
      const trackedRow=sql('SELECT product_id FROM products WHERE product_name=?','Tracked Source');
      const trackedBefore=sql('SELECT current_stock n FROM products WHERE product_id=?',trackedRow.product_id).n;
      const denied=await api('POST','/api/products/'+trackedRow.product_id+'/adjust-stock',{delta:-1,note:'not allowed'});
      assert.equal(denied.status,400,JSON.stringify(denied));
      assert.equal(sql('SELECT current_stock n FROM products WHERE product_id=?',trackedRow.product_id).n,trackedBefore);
    });
    await t.test('status rejects missing products and writes status for existing products only',async()=>{
      assert.equal((await api('PUT','/api/products/MISSING/status',{status:'Inactive'})).status,404);
      assert.equal((await api('PUT','/api/products/'+productId+'/status',{status:'Inactive'})).status,200);
      assert.equal(sql('SELECT status FROM products WHERE product_id=?',productId).status,'Inactive');
    });
    await t.test('read-only Products role can read stock history but cannot adjust or change status',async()=>{
      const role=await api('POST','/api/roles',{
        name:'Hybrid Products Reader', permissions:{products:{view:true,add:false,edit:false,delete:'disabled'}}
      });
      assert.equal(role.status,200,JSON.stringify(role));
      const created=await api('POST','/api/users',{
        name:'Synthetic Read Only',mobile:'01000005545',role:'Hybrid Products Reader',password:'ReadOnly-Test-2026!'
      });
      assert.equal(created.status,200,JSON.stringify(created));
      const login=await api('POST','/api/auth/login',{
        phone:'01000005545',password:'ReadOnly-Test-2026!'
      });
      assert.equal(login.status,200,JSON.stringify(login));
      const bearer=login.token;
      assert.equal((await api('GET','/api/products/'+productId+'/history',undefined,bearer)).status,200);
      const stock=sql('SELECT current_stock n FROM products WHERE product_id=?',productId).n;
      const movements=count('stock_movements');
      assert.equal((await api('POST','/api/products/'+productId+'/adjust-stock',
        {delta:5,note:'forbidden'},bearer)).status,403);
      assert.equal((await api('PUT','/api/products/'+productId+'/status',
        {status:'Active'},bearer)).status,403);
      assert.equal(sql('SELECT current_stock n FROM products WHERE product_id=?',productId).n,stock);
      assert.equal(count('stock_movements'),movements);
    });
    await t.test('real stock history uses stored source movement IDs and lot quantities',async()=>{
      const expected=list('SELECT movement_id,quantity_in,quantity_out FROM stock_movements WHERE product_id=? ORDER BY created_at DESC,id DESC',productId);
      const res=await api('GET','/api/products/'+productId+'/history');
      assert.equal(res.status,200,JSON.stringify(res));
      assert.deepEqual(res.items.map((i:any)=>i.movementId),expected.map(x=>x.movement_id));
      assert.equal(res.items.length,3);
      const lots=await api('GET','/api/products/'+productId+'/lots');
      assert.equal(lots.status,200);
      assert.equal(lots.lots.reduce((n:number,l:any)=>n+l.remainingQuantity,0),6);
      assert.ok(lots.lots.every((l:any)=>Number.isFinite(l.purchasePrice)));
    });
    await t.test('a real POS sale updates the same FIFO lots and history without synthetic IDs',async()=>{
      assert.equal((await api('PUT','/api/products/'+productId+'/status',{status:'Active'})).status,200);
      const opened=await api('POST','/api/pos/cash-session/start',{openingCash:100});
      assert.equal(opened.status,200,JSON.stringify(opened));
      const posted=await api('POST','/api/pos/sales',{
        clientRequestId:'hybrid-products-sale-00001',
        customerName:'Hybrid Test Buyer',customerPhone:'01000006666',
        discount:0,paymentType:'Cash',paidAmount:0,paymentMethod:'Cash',
        items:[{productId,name:'Hybrid Cable Updated',qty:1,unitPrice:35,fulfillmentMode:'own'}]
      });
      assert.equal(posted.status,200,JSON.stringify(posted));
      assert.equal(sql('SELECT current_stock n FROM products WHERE product_id=?',productId).n,5);
      const history=await api('GET','/api/products/'+productId+'/history');
      assert.equal(history.status,200);
      const persisted=list('SELECT movement_id FROM stock_movements WHERE product_id=? ORDER BY created_at DESC,id DESC',productId);
      assert.deepEqual(history.items.map((x:any)=>x.movementId),persisted.map(x=>x.movement_id));
      const lots=await api('GET','/api/products/'+productId+'/lots');
      assert.equal(lots.lots.reduce((sum:number,x:any)=>sum+x.remainingQuantity,0),5);
    });
  } finally { db.close(); }
});
