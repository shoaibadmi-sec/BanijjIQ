import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { handleApiRequest } from '../server/core/handler.ts';

test('Phase 4A: live supplier search / purchase payable and ledger reconciliation', async t => {
  const db = new SqliteDatabase(':memory:');
  try {
    runMigrations(db.native, resolve('migrations'));
    let token = '';
    async function api(method: string, path: string, body?: unknown, auth = token) {
      const headers: Record<string,string> = {'content-type':'application/json'};
      if(auth) headers.authorization = 'Bearer '+auth;
      const response=await handleApiRequest(new Request('http://isolated.test'+path, {
        method, headers, body: body===undefined ? undefined : JSON.stringify(body)
      }),db);
      return {status:response.status,...await response.json() as Record<string,any>};
    }
    await t.test('anonymous users cannot query supplier balances',async()=>{
      const res=await api('GET','/api/purchases/supplier-search?q=shop',undefined,'');
      assert.equal(res.status,401,JSON.stringify(res));
    });
    const admin=await api('POST','/api/setup/admin',{
      fullName:'Phase4 Test Admin',phone:'01000007771',password:'Phase4-Synthetic-Secret!'
    });
    assert.equal(admin.status,200,JSON.stringify(admin)); token=admin.token;
    const supplier=await api('POST','/api/suppliers',{name:'Khan Hardware',phone:'01700000001',openingBalance:0});
    assert.equal(supplier.status,200,JSON.stringify(supplier));
    const other=await api('POST','/api/suppliers',{name:'Different Wholesaler',openingBalance:0});
    assert.equal(other.status,200,JSON.stringify(other));
    await t.test('name, ID and phone lookup return genuine active master balances',async()=>{
      for(const q of ['khAn','01700000001',supplier.id]){
        const res=await api('GET','/api/purchases/supplier-search?q='+encodeURIComponent(q));
        assert.equal(res.status,200,JSON.stringify(res));
        assert.deepEqual(res.suppliers.map((x:any)=>x.id),[supplier.id]);
        assert.equal(res.suppliers[0].currentDue,0);
        assert.equal(res.suppliers[0].needsReconciliation,false);
      }
      const tooLong=await api('GET','/api/purchases/supplier-search?q='+('x'.repeat(81)));
      assert.equal(tooLong.status,400);
    });
    const product=await api('POST','/api/products',{
      productName:'Phase4 Test Bolt',brand:'',category:'Hardware',unit:'Pcs',
      barcode:'PHASE4-BOLT-1',purchasePrice:20,sellingPrice:30,minimumStock:0,
      currentStock:0,status:'Active',trackSerial:false,trackExpiry:false,trackWarranty:false
    });
    assert.equal(product.status,200,JSON.stringify(product));
    const purchase=await api('POST','/api/purchases',{
      supplierId:supplier.id,items:[{productId:product.productId,qty:3,unitPrice:20}],
      discount:0,paidAmount:0,notes:'Phase 4A test purchase'
    });
    assert.equal(purchase.status,200,JSON.stringify(purchase));
    assert.equal(purchase.dueAmount,60);
    await t.test('purchase payable equals supplier master, ledger and FIFO lot',async()=>{
      const result=await api('GET','/api/purchases/supplier-search?q=Khan');
      assert.equal(result.status,200,JSON.stringify(result));
      assert.equal(result.suppliers[0].currentDue,60);
      assert.equal(result.suppliers[0].ledgerDue,60);
      assert.equal(result.suppliers[0].needsReconciliation,false);
      assert.equal(db.native.prepare('SELECT current_due FROM suppliers WHERE supplier_id=?').get(supplier.id)?.current_due,60);
      const ledger=db.native.prepare('SELECT debit,credit,balance FROM supplier_ledger WHERE reference=?').get(purchase.purchaseId) as any;
      assert.deepEqual([ledger.debit,ledger.credit,ledger.balance],[60,0,60]);
      const lot=db.native.prepare("SELECT original_quantity,remaining_quantity,unit_cost FROM stock_lots WHERE source_ref=? AND source_type='PURCHASE'").get(purchase.purchaseId) as any;
      assert.deepEqual([lot.original_quantity,lot.remaining_quantity,lot.unit_cost],[3,3,20]);
      assert.equal(db.native.prepare('SELECT current_stock FROM products WHERE product_id=?').get(product.productId)?.current_stock,3);
    });
    await t.test('read-only search makes no financial changes and does not include inactive suppliers',async()=>{
      const counts=()=>['suppliers','supplier_ledger','stock_lots','purchase_items'].map(x=>
        Number((db.native.prepare('SELECT COUNT(*) n FROM '+x).get() as any).n));
      const before=counts();
      await api('PUT','/api/suppliers/'+other.id+'/status',{status:'Inactive'});
      const afterStatus=counts();
      for(let i=0;i<3;i++) {
        const x=await api('GET','/api/purchases/supplier-search?q=');
        assert.equal(x.status,200);
        assert.equal(x.suppliers.length,1);
      }
      assert.deepEqual(counts(),afterStatus);
      assert.deepEqual(before,afterStatus);
    });
  } finally {db.close();}
});
