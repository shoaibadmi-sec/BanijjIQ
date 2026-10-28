import assert from 'node:assert/strict';
import {test} from 'node:test';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.js';
import {runMigrations} from '../server/db/migrate.js';
import {createBundle,getBundle,listBundles,updateBundle,deactivateBundle} from '../server/modules/products/bundles.service.js';
import {getProductsBootstrap,updateProduct,adjustStockByDelta,deleteProduct} from '../server/modules/products/service.js';
import {getProductUnitConfig} from '../server/modules/products/units.service.js';
import {getPosBootstrapRoute,completeSaleRoute} from '../server/modules/sales/service.js';

const user={userId:'USR-1',fullName:'Test Admin',phone:'',role:'admin',status:'Active'};
function dbFixture() {
  const db=new SqliteDatabase(':memory:');
  const result=runMigrations(db.native,resolve('migrations'));
  assert.equal(result.applied.length,30);
  db.native.prepare('INSERT INTO app_users (user_id,full_name,phone,password_hash,password_salt) VALUES (?,?,?,?,?)')
    .run(user.userId,user.fullName,'01700001111','hash','salt');
  const p=db.native.prepare('INSERT INTO products (product_id,product_name,category,unit,current_stock,purchase_price,selling_price,status) VALUES (?,?,?,?,?,?,?,?)');
  p.run('P-1','Pipe','Plumbing','Pcs',30,100,150,'Active');
  p.run('P-2','Elbow','Plumbing','Pcs',15,5,10,'Active');
  p.run('P-3','Motor','Plumbing','Pcs',4,2000,3000,'Active');
  const lot=db.native.prepare("INSERT INTO stock_lots (lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost) VALUES (?,?,'PURCHASE','PO-TEST',?,?,?)");
  lot.run('LOT-P1','P-1',30,30,100);
  lot.run('LOT-P2','P-2',15,15,5);
  lot.run('LOT-P3','P-3',4,4,2000);
  db.native.prepare("INSERT INTO cash_sessions (session_id,opened_by,status,opening_cash) VALUES (?,?, 'Open',0)").run('CS-1',user.userId);
  return db;
}
const newBundle={
  productName:'Tubewell Set',brand:'',category:'Plumbing',barcode:'TBW-1',sellingPrice:15000,
  components:[{productId:'P-1',quantityPerSet:5},{productId:'P-2',quantityPerSet:10},{productId:'P-3',quantityPerSet:1}]
};

test('virtual bundle creation stores a versioned recipe, leaves all physical stock untouched, and displays informational availability',async()=>{
  const db=dbFixture();
  try{
    const before=db.native.prepare("SELECT product_id,current_stock FROM products WHERE product_type='Standard' ORDER BY product_id").all();
    const response=await createBundle(db,newBundle,user);
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    const id=(await response.json() as any).productId;
    const details=await (await getBundle(db,id)).json() as any;
    assert.equal(details.bundle.availableSets,1,'10 elbows allows only 1 complete set');
    assert.equal(details.bundle.sellingPrice,15000);
    assert.equal(details.bundle.stockUnit,'Set');
    assert.equal(details.bundle.revision,1);
    assert.equal(details.bundle.components.length,3);
    assert.deepEqual(db.native.prepare("SELECT product_id,current_stock FROM products WHERE product_type='Standard' ORDER BY product_id").all(),before);
    const ownStock=(db.native.prepare('SELECT current_stock FROM products WHERE product_id=?').get(id) as any).current_stock;
    assert.equal(ownStock,0,'virtual bundle has no independent stock');
    assert.equal((db.native.prepare('SELECT count(*) AS n FROM stock_lots WHERE product_id=?').get(id) as any).n,0);
    const products=await (await getProductsBootstrap(db)).json() as any;
    const bundle=products.products.find((p:any)=>p.productId===id);
    assert.equal(bundle.productType,'Bundle');
    assert.equal(bundle.availableSets,1);
    assert.equal(bundle.stockValue,0);
    const pos=await (await getPosBootstrapRoute(db,user)).json() as any;
    assert.equal(pos.products.some((p:any)=>p.id===id),true,'ready bundle is sold as one kit, with component stock deducted');
    const sale=await completeSaleRoute(db,{
      customerName:'Test Customer',customerPhone:'01700002222',paymentType:'Cash',items:[{productId:id,name:'Tubewell Set',qty:1,unitPrice:15000}]
    },user);
    assert.equal(sale.status,200,'bundle sale must deduct physical components while preserving one invoice line');
    assert.equal((db.native.prepare('SELECT count(*) AS n FROM sales').get() as any).n,1);
    assert.deepEqual(['P-1','P-2','P-3'].map(id=>(db.native.prepare('SELECT current_stock AS n FROM products WHERE product_id=?').get(id) as any).n),[25,5,3]);
    assert.equal((db.native.prepare('SELECT current_stock AS n FROM products WHERE product_id=?').get(id) as any).n,0);
    assert.equal((db.native.prepare('SELECT count(*) AS n FROM sale_items').get() as any).n,1);
    assert.equal((await updateProduct(db,id,{productName:'Changed',category:'Plumbing',unit:'Set'})).status,400);
    assert.equal((await adjustStockByDelta(db,id,12,'bad')).status,400);
    assert.equal((await getProductUnitConfig(db,id)).status,404);
    assert.equal((await deleteProduct(db,id)).status,400);
    const all=await (await listBundles(db)).json() as any;
    assert.equal(all.bundles.length,1);
  }finally{db.close();}
});

test('reject duplicate, nested, inactive, tracked, zero, fractional and repeated recipe components',async()=>{
  const db=dbFixture();
  try{
    const invalid=[
      {...newBundle,components:[]},
      {...newBundle,components:[{productId:'P-1',quantityPerSet:0}]},
      {...newBundle,components:[{productId:'P-1',quantityPerSet:1.5}]},
      {...newBundle,components:[{productId:'P-1',quantityPerSet:1},{productId:'P-1',quantityPerSet:2}]},
      {...newBundle,components:[{productId:'MISSING',quantityPerSet:1}]},
    ];
    for(const payload of invalid)assert.equal((await createBundle(db,payload,user)).status,400);
    db.native.prepare("UPDATE products SET status='Inactive' WHERE product_id='P-1'").run();
    assert.equal((await createBundle(db,newBundle,user)).status,400);
    db.native.prepare("UPDATE products SET status='Active',track_serial=1 WHERE product_id='P-1'").run();
    assert.equal((await createBundle(db,newBundle,user)).status,400);
    db.native.prepare("UPDATE products SET track_serial=0 WHERE product_id='P-1'").run();
    const valid=await (await createBundle(db,newBundle,user)).json() as any;
    assert.equal((await createBundle(db,newBundle,user)).status,409);
    assert.equal((await createBundle(db,{...newBundle,productName:'Inner Set',barcode:'INNER',components:[{productId:valid.productId,quantityPerSet:1}]},user)).status,400);
    assert.equal((await deleteProduct(db,'P-1')).status,400,'cannot delete an active recipe component');
  }finally{db.close();}
});

test('bundle recipe edits before first sale keep revision; after sale retain historical revision and reject stale writes',async()=>{
 const db=dbFixture();
 try{
   const created=await (await createBundle(db,newBundle,user)).json() as any;
   const id=created.productId;
   const next={...newBundle,expectedRevision:1,components:[{productId:'P-1',quantityPerSet:4},{productId:'P-3',quantityPerSet:1}]};
   const changed=await (await updateBundle(db,id,next,user)).json() as any;
   assert.equal(changed.revision,1);
   assert.equal((db.native.prepare('SELECT COUNT(*) n FROM bundle_components WHERE bundle_id=?').get(id) as any).n,2);
   db.native.prepare("INSERT INTO sale_items (invoice_id,product_id,product_name,quantity,unit_price,line_total,sold_product_type) VALUES (?,?,?,?,?,?, 'Bundle')")
     .run('INV-HIST',id,'Tubewell Set',1,15000,15000);
   const updated=await (await updateBundle(db,id,{...next,expectedRevision:1,components:[{productId:'P-1',quantityPerSet:8},{productId:'P-3',quantityPerSet:2}]},user)).json() as any;
   assert.equal(updated.revision,2);
   const previous=db.native.prepare('SELECT component_id,quantity_per_set FROM bundle_components WHERE bundle_id=? AND revision=1 ORDER BY component_id').all(id);
   assert.deepEqual(previous,[{component_id:'P-1',quantity_per_set:4},{component_id:'P-3',quantity_per_set:1}]);
   assert.equal((await updateBundle(db,id,{...next,expectedRevision:1},user)).status,409);
   const current=await (await getBundle(db,id)).json() as any;
   assert.equal(current.bundle.revision,2);
   assert.deepEqual(current.bundle.components.map((c:any)=>c.quantityPerSet),[8,2]);
   assert.equal((await deactivateBundle(db,id,user)).status,200);
   assert.equal((await getBundle(db,id)).status,200,'deactivation retains historical recipe');
   assert.equal((db.native.prepare('SELECT count(*) AS n FROM sale_items WHERE product_id=?').get(id) as any).n,1);
 }finally{db.close();}
});
