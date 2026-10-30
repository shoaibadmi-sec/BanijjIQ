import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

test('6G purchase → supplier settlement → POS due → customer bank collection reconciles every source',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));
  let token='';
  const api=async(method:string,path:string,body?:unknown)=>{
   const headers:Record<string,string>={'content-type':'application/json'};
   if(token)headers.authorization='Bearer '+token;
   const r=await handleApiRequest(new Request('https://phase6-acceptance.test'+path,{
     method,headers,body:body===undefined?undefined:JSON.stringify(body)
   }),db);
   return {status:r.status,...await r.json() as Record<string,any>};
  };
  const one=(sql:string,...args:unknown[])=>db.native.prepare(sql).get(...args) as any;
  const admin=await api('POST','/api/setup/admin',{
   fullName:'Integrated Cashier',phone:'01000009781',password:'Isolated-CrossModule-2026!'
  });
  assert.equal(admin.status,200,JSON.stringify(admin));token=admin.token;
  const start=await api('POST','/api/pos/cash-session/start',{openingCash:100,clientRequestId:'P6G-INT-OPEN-0001'});
  assert.equal(start.status,200,JSON.stringify(start));
  db.native.prepare("INSERT INTO bank_accounts(bank_account_id,account_name,account_type,opening_balance,current_balance,status) VALUES ('P6-INT-BANK','Shop Operating Bank','Bank',500,500,'Active')").run();
  const supplier=await api('POST','/api/suppliers',{name:'Integrated Supplier'});
  const product=await api('POST','/api/products',{
   productName:'Integrated Switch',category:'Electrical',unit:'Pcs',barcode:'P6-INT-SWITCH',
   purchasePrice:10,sellingPrice:20,currentStock:0,minimumStock:0,
   trackSerial:false,trackExpiry:false,trackWarranty:false,status:'Active'
  });
  assert.equal(supplier.status,200);assert.equal(product.status,200);
  const purchase=await api('POST','/api/purchases',{supplierId:supplier.id,
   items:[{productId:product.productId,qty:6,unitPrice:10}],paidAmount:0,discount:0
  });
  assert.equal(purchase.status,200,JSON.stringify(purchase));
  assert.equal(purchase.dueAmount,60);
  const paidSupplier=await api('POST','/api/purchases/supplier-settlements',{
   supplierId:supplier.id,amount:20,method:'Bank',bankAccountId:'P6-INT-BANK',
   clientRequestId:crypto.randomUUID()
  });
  assert.equal(paidSupplier.status,200,JSON.stringify(paidSupplier));
  assert.equal(one('SELECT current_due n FROM suppliers WHERE supplier_id=?',supplier.id).n,40);
  const sale=await api('POST','/api/pos/sales',{
   clientRequestId:'P6G-CROSS-SALE-0001',customerName:'Integration Buyer',customerPhone:'01000009782',
   paymentType:'Partial',paidAmount:10,paymentMethod:'Cash',discount:0,
   items:[{productId:product.productId,name:'Integrated Switch',qty:2,unitPrice:20,fulfillmentMode:'own'}]
  });
  assert.equal(sale.status,200,JSON.stringify(sale));
  assert.equal(sale.invoice.grandTotal,40);
  assert.equal(sale.invoice.dueAmount,30);
  const customer=one('SELECT customer_id,current_due FROM customers WHERE phone=?','01000009782');
  assert.equal(customer.current_due,30);
  const before=one('SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?','P6-INT-BANK').n;
  assert.equal(before,480);
  const collection=await api('POST','/api/sales-management/customer-payment',{
   customerId:customer.customer_id,amount:15,method:'Bank',bankAccountId:'P6-INT-BANK',
   clientRequestId:'P6G-CUSTOMER-PAY-0001'
  });
  assert.equal(collection.status,200,JSON.stringify(collection));
  assert.equal(collection.newDue,15);
  assert.equal(one('SELECT current_due n FROM customers WHERE customer_id=?',customer.customer_id).n,15);
  assert.equal(one("SELECT COALESCE(SUM(debit-credit),0) n FROM customer_ledger WHERE customer_id=?",customer.customer_id).n,15);
  assert.equal(one('SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?','P6-INT-BANK').n,495,
    'customer bank receipt must increase the same bank account that received the money');
  const reconciliation=await api('GET','/api/bank/reconciliation');
  assert.equal(reconciliation.status,200);
  assert.equal(reconciliation.coverage.status,'ready',JSON.stringify(reconciliation));
  assert.equal(reconciliation.accounts.find((x:any)=>x.id==='P6-INT-BANK').bookBalance,495);
  const today=new Date().toISOString().slice(0,10);
  const day=await api('GET','/api/daybook?dateFrom='+today+'&dateTo='+today+'&page=1&pageSize=50');
  assert.equal(day.status,200,JSON.stringify(day));
  const modules=new Set(day.rows.map((x:any)=>x.module));
  for(const expected of ['Purchase','Supplier Payment','Sales','Customer Payment'])
   assert.ok(modules.has(expected),'Daybook must include '+expected);
  assert.equal(day.totals.bankIn,15);
  assert.equal(day.totals.bankOut,20);
  assert.equal(day.totals.cashIn,10);
  assert.equal(day.totals.netBank,-5);
  assert.equal(one('SELECT current_stock n FROM products WHERE product_id=?',product.productId).n,4);
 }finally{db.close();}
});

test('6G customer due overpayment rejects without negative due, fictitious cash or extra ledger',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));
  const user={userId:'P6-OVERPAY',fullName:'Overpayment Tester',role:'admin'} as any;
  const {receiveCustomerPaymentRoute}=await import('../server/modules/sales/service.ts');
  db.native.prepare("INSERT INTO cash_sessions(session_id,opened_by,status) VALUES ('P6-OVERPAY-SESSION','Test','Open')").run();
  db.native.prepare("INSERT INTO customers(customer_id,customer_name,phone,current_due,is_deleted) VALUES ('P6-OVERPAY-CUSTOMER','Test Customer','01000009783',20,0)").run();
  const before=oneCount();
  function oneCount(){
   return ['customer_ledger','cash_book','bank_book','audit_logs'].map(t=>
    (db.native.prepare('SELECT COUNT(*) n FROM '+t).get() as any).n);
  }
  const res=await receiveCustomerPaymentRoute(db,{customerId:'P6-OVERPAY-CUSTOMER',amount:21,method:'Cash'},user);
  assert.equal(res.status,409,'customer payments must never create a negative receivable');
  assert.equal((db.native.prepare("SELECT current_due n FROM customers WHERE customer_id='P6-OVERPAY-CUSTOMER'").get() as any).n,20);
  assert.deepEqual(oneCount(),before,'rejected payment must post no money or audit');
 }finally{db.close();}
});
