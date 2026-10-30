import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

test('Phase7E3A atomic refund: failed cash-book debit, stale FIFO, and return denial never create half-complete refund',async()=>{
 const db=new SqliteDatabase(':memory:');try{
  runMigrations(db.native,resolve('migrations'));let token='';
  const api=async(method:string,path:string,body?:unknown,bearer=token)=>{
   const r=await handleApiRequest(new Request('http://local.test'+path,{method,
    headers:{'content-type':'application/json',...(bearer?{authorization:'Bearer '+bearer}:{})},
    body:body===undefined?undefined:JSON.stringify(body)}),db);
   return {status:r.status,...await r.json() as Record<string,any>};
  };
  const admin=await api('POST','/api/setup/admin',{fullName:'Refund Admin',phone:'01000007882',password:'ReturnAtomic2026!'});
  assert.equal(admin.status,200);token=admin.token;
  assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:600})).status,200);
  db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock,status) VALUES ('A-PART','Part','Hardware','Pcs',5,'Active')").run();
  db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES ('A-LOT','A-PART','PURCHASE',5,5,30)").run();
  assert.equal((await api('POST','/api/products/bundle-recipes',{bundleId:'A-KIT',name:'Atomic Return Kit',sellingPrice:100,components:[{productId:'A-PART',quantityPerSet:2}]})).status,200);
  const sale=await api('POST','/api/pos/bundle-sales',{clientRequestId:'atomic-return-sale01',customerName:'Buyer',customerPhone:'01000002241',
   paymentType:'Cash',paymentMethod:'Cash',items:[{productId:'A-KIT',qty:2,unitPrice:100}]});
  assert.equal(sale.status,200,JSON.stringify(sale));
  const invoice=sale.invoiceId,body={clientRequestId:'atomic-return-key01',reason:'Undamaged returned full kit order'};
  const snapshot=()=>JSON.stringify({
   stock:db.native.prepare("SELECT current_stock FROM products WHERE product_id='A-PART'").all(),
   lots:db.native.prepare("SELECT remaining_quantity FROM stock_lots WHERE lot_id='A-LOT'").all(),
   returns:db.native.prepare('SELECT return_id FROM sales_returns').all(),
   lines:db.native.prepare('SELECT id FROM sales_return_items').all(),
   sources:db.native.prepare('SELECT id FROM bundle_return_allocations').all(),
   requests:db.native.prepare('SELECT request_id FROM bundle_cash_return_requests').all(),
   money:db.native.prepare("SELECT entry_id,debit,credit FROM cash_book WHERE type='Sales Return'").all(),
   moves:db.native.prepare("SELECT movement_id FROM stock_movements WHERE movement_type='Sales Return'").all()
  });
  const before=snapshot();
  db.native.exec("CREATE TRIGGER fail_bundle_refund BEFORE INSERT ON cash_book WHEN NEW.type='Sales Return' BEGIN SELECT RAISE(ABORT,'injected cash refund failure'); END;");
  const failure=await api('POST','/api/sales-returns/bundle-invoices/'+invoice,body);
  assert.equal(failure.status,409,JSON.stringify(failure));
  assert.equal(snapshot(),before,'single transactional D1 refund must roll back all writes');
  db.native.exec('DROP TRIGGER fail_bundle_refund');
  const oldBatch=db.batch.bind(db);
  (db as any).batch=async(stmts:Parameters<typeof oldBatch>[0])=>{
   db.native.prepare("UPDATE stock_lots SET remaining_quantity=0 WHERE lot_id='A-LOT'").run();
   db.native.prepare("UPDATE products SET current_stock=0 WHERE product_id='A-PART'").run();
   return oldBatch(stmts);
  };
  const stale=await api('POST','/api/sales-returns/bundle-invoices/'+invoice,body);
  assert.equal(stale.status,409,JSON.stringify(stale));
  assert.equal((db.native.prepare('SELECT COUNT(*) n FROM sales_returns').get() as any).n,0);
  assert.equal((db.native.prepare('SELECT COUNT(*) n FROM bundle_cash_return_requests').get() as any).n,0);
  (db as any).batch=oldBatch;
  db.native.prepare("UPDATE stock_lots SET remaining_quantity=1 WHERE lot_id='A-LOT'").run();
  db.native.prepare("UPDATE products SET current_stock=1 WHERE product_id='A-PART'").run();
  const role=await api('POST','/api/roles',{name:'Bundle Return Viewer',permissions:{returns:{view:true,add:false,edit:false,delete:'disabled'},pos:{view:true,add:false,edit:false,delete:'disabled'}}});
  assert.equal(role.status,200,JSON.stringify(role));
  assert.equal((await api('POST','/api/users',{name:'Reader',mobile:'01000007883',role:'Bundle Return Viewer',password:'ReturnReadOnly2026!'})).status,200);
  const login=await api('POST','/api/auth/login',{phone:'01000007883',password:'ReturnReadOnly2026!'});
  assert.equal(login.status,200);
  const blocked=await api('POST','/api/sales-returns/bundle-invoices/'+invoice,body,login.token);
  assert.equal(blocked.status,403);
  assert.equal((db.native.prepare('SELECT COUNT(*) n FROM sales_returns').get() as any).n,0);
  const good=await api('POST','/api/sales-returns/bundle-invoices/'+invoice,body);
  assert.equal(good.status,200,JSON.stringify(good));
  assert.equal((db.native.prepare('SELECT COUNT(*) n FROM sales_returns').get() as any).n,1);
 }finally{db.close();}
});
