import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

test('Phase7E3B: cash-book injection, stale stock CAS and Returns.add deny a partial refund atomically',async()=>{
 const db=new SqliteDatabase(':memory:');try{
  runMigrations(db.native,resolve('migrations'));let token='';
  const api=async(method:string,path:string,body?:unknown,bearer=token)=>{
   const r=await handleApiRequest(new Request('http://local.test'+path,{method,headers:{
    'content-type':'application/json',...(bearer?{authorization:'Bearer '+bearer}:{})},
    body:body===undefined?undefined:JSON.stringify(body)}),db);
   return {status:r.status,...await r.json() as Record<string,any>};
  };
  const admin=await api('POST','/api/setup/admin',{fullName:'Partial Atomic Admin',phone:'01000007912',password:'AtomicPartReturn2026!'});
  assert.equal(admin.status,200);token=admin.token;
  assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:500})).status,200);
  db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock,status) VALUES ('PART-A','Part A','Hardware','Pcs',5,'Active')").run();
  db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES ('PART-A-LOT','PART-A','PURCHASE',5,5,10)").run();
  assert.equal((await api('POST','/api/products/bundle-recipes',{bundleId:'PART-KIT',name:'Kit',sellingPrice:40,
    components:[{productId:'PART-A',quantityPerSet:1}]})).status,200);
  const sold=await api('POST','/api/pos/bundle-sales',{clientRequestId:'partial-sale-atomic01',customerName:'Buyer',
   customerPhone:'01000007913',paymentType:'Cash',paymentMethod:'Cash',items:[{productId:'PART-KIT',qty:3,unitPrice:40}]});
  assert.equal(sold.status,200,JSON.stringify(sold));
  const path='/api/sales-returns/bundle-invoices/'+sold.invoiceId+'/sets';
  const body={clientRequestId:'partial-refund-atomic01',reason:'Returned a complete unused kit',setsToReturn:1};
  const snap=()=>JSON.stringify({
   p:db.native.prepare("SELECT current_stock FROM products WHERE product_id='PART-A'").all(),
   lot:db.native.prepare("SELECT remaining_quantity FROM stock_lots WHERE lot_id='PART-A-LOT'").all(),
   headers:db.native.prepare('SELECT return_id FROM sales_returns').all(),
   lines:db.native.prepare('SELECT id FROM sales_return_items').all(),
   money:db.native.prepare("SELECT entry_id FROM cash_book WHERE type='Sales Return'").all(),
   alloc:db.native.prepare('SELECT id FROM bundle_partial_return_allocations').all(),
   req:db.native.prepare('SELECT request_id FROM bundle_partial_return_requests').all()
  });
  const before=snap();
  db.native.exec("CREATE TRIGGER force_part_refund_fail BEFORE INSERT ON cash_book WHEN NEW.type='Sales Return' BEGIN SELECT RAISE(ABORT,'forced refund failure'); END;");
  assert.equal((await api('POST',path,body)).status,409);
  assert.equal(snap(),before,'cash journal write cannot fail after committing inventory');
  db.native.exec("DROP TRIGGER force_part_refund_fail");
  const batch=db.batch.bind(db);
  (db as any).batch=async(stmts:Parameters<typeof batch>[0])=>{
   db.native.prepare("UPDATE products SET current_stock=1 WHERE product_id='PART-A'").run();
   db.native.prepare("UPDATE stock_lots SET remaining_quantity=1 WHERE lot_id='PART-A-LOT'").run();
   return batch(stmts);
  };
  assert.equal((await api('POST',path,body)).status,409);
  assert.equal((db.native.prepare('SELECT COUNT(*) n FROM sales_returns').get() as any).n,0);
  (db as any).batch=batch;
  db.native.prepare("UPDATE products SET current_stock=2 WHERE product_id='PART-A'").run();
  db.native.prepare("UPDATE stock_lots SET remaining_quantity=2 WHERE lot_id='PART-A-LOT'").run();
  const role=await api('POST','/api/roles',{name:'Partial Return Viewer',permissions:{returns:{view:true,add:false,edit:false,delete:'disabled'}}});
  assert.equal(role.status,200,JSON.stringify(role));
  assert.equal((await api('POST','/api/users',{name:'Reader',mobile:'01000007914',role:'Partial Return Viewer',password:'ViewOnlyPart2026!'})).status,200);
  const login=await api('POST','/api/auth/login',{phone:'01000007914',password:'ViewOnlyPart2026!'});
  assert.equal(login.status,200);
  assert.equal((await api('POST',path,body,login.token)).status,403);
  const ok=await api('POST',path,body);assert.equal(ok.status,200,JSON.stringify(ok));
  assert.equal((db.native.prepare('SELECT COUNT(*) n FROM sales_returns').get() as any).n,1);
 }finally{db.close();}
});
