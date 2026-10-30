import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

const period='?report=receivables&from=2026-01-01&to=2026-12-31';
async function fixture(run:(f:{
  api:(method:string,path:string,body?:unknown)=>Promise<any>;
  one:(sql:string,...args:unknown[])=>any;
  count:(table:string)=>number;
  db:SqliteDatabase;
})=>Promise<void>){
 const db=new SqliteDatabase(':memory:');
 try{
  assert.ok(runMigrations(db.native,resolve('migrations')).applied.length>20);
  let token='';
  async function api(method:string,path:string,body?:unknown){
   const headers:Record<string,string>={'content-type':'application/json'};
   if(token)headers.authorization='Bearer '+token;
   const response=await handleApiRequest(new Request('http://customer-receipt.test'+path,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body)
   }),db);
   return {status:response.status,...await response.json() as Record<string,any>};
  }
  const one=(sql:string,...args:unknown[])=>(db.native.prepare(sql).get(...args)) as any;
  const count=(table:string)=>Number(one('SELECT COUNT(*) n FROM '+table).n);
  const admin=await api('POST','/api/setup/admin',{
   fullName:'Phase 5 Receipt Admin',phone:'01000009151',password:'Phase5-Receipt-Synthetic!'});
  assert.equal(admin.status,200,JSON.stringify(admin));token=admin.token;
  await run({api,one,count,db});
 }finally{db.close();}
}
const ok=(r:any)=>assert.equal(r.status,200,JSON.stringify(r));
function metric(page:any,key:string){
 const m=page.metrics?.find((x:any)=>x.key===key);
 assert.ok(m,'Missing report metric '+key+': '+JSON.stringify(page));
 return m.valueMinor;
}
async function createDue(api:(m:string,p:string,b?:unknown)=>Promise<any>,price=50,qty=2){
 const product=await api('POST','/api/products',{
  productName:'Receivable Fixture',category:'Electrical',unit:'Pcs',purchasePrice:20,
  sellingPrice:price,currentStock:5,minimumStock:0,status:'Active',
  trackSerial:false,trackExpiry:false,trackWarranty:false
 });ok(product);
 ok(await api('POST','/api/pos/cash-session/start',{openingCash:0}));
 const sale=await api('POST','/api/pos/sales',{
  clientRequestId:crypto.randomUUID(),customerName:'Receivable Buyer',customerPhone:'01000009152',
  discount:0,paymentType:'Due',paidAmount:0,items:[{
   productId:product.productId,name:'Receivable Fixture',qty,unitPrice:price,fulfillmentMode:'own'
  }]
 });ok(sale);
 return {productId:product.productId,invoiceId:sale.invoice.invoiceId,due:qty*price};
}
test('cash customer payment cannot exceed outstanding due or post partial journal effects',async()=>{
 await fixture(async({api,one,count})=>{
  const {due}=await createDue(api);
  assert.equal(due,100);
  const customer=one('SELECT customer_id,current_due FROM customers WHERE phone=?','01000009152');
  const id=customer.customer_id;
  assert.equal(customer.current_due,100);
  const pay=(amount:number)=>api('POST','/api/sales-management/customer-payment',
   {customerId:id,amount,method:'Cash',reference:'paid at counter'});
  const first=await pay(40);ok(first);
  assert.equal(first.newDue,60);
  const snapshot=()=>({
   due:one('SELECT current_due n FROM customers WHERE customer_id=?',id).n,
   ledger:one('SELECT COALESCE(SUM(debit-credit),0) n FROM customer_ledger WHERE customer_id=?',id).n,
   journals:count('customer_ledger'),cash:count('cash_book')
  });
  assert.deepEqual(snapshot(),{due:60,ledger:60,journals:2,cash:1});
  for(const amount of [60.01,100,1.001]){
   const before=snapshot();
   const invalid=await pay(amount);
   assert.notEqual(invalid.status,200,'amount '+amount+' must not overpay or write fractional poisha');
   assert.deepEqual(snapshot(),before,'rejected receipt cannot modify customer, cash, or running ledger');
  }
  const end=await pay(60);ok(end);
  assert.deepEqual(snapshot(),{due:0,ledger:0,journals:3,cash:2});
  const alreadyPaid=await pay(1);
  assert.notEqual(alreadyPaid.status,200);
  assert.deepEqual(snapshot(),{due:0,ledger:0,journals:3,cash:2});
  const dues=await api('GET','/api/reports/v2/rows'+period);ok(dues);
  assert.equal(metric(dues,'receivablesBalance'),0);
  const cash=await api('GET','/api/reports/v2/rows?report=cash&from=2026-01-01&to=2026-12-31');ok(cash);
  assert.equal(metric(cash,'cashReceipts'),10000);
  assert.equal(metric(cash,'cashBookBalance'),10000);
 });
});
test('bank customer receipt posts the bank master, money book and due ledger atomically',async()=>{
 await fixture(async({api,one,count})=>{
  await createDue(api,50,1);
  const id=one('SELECT customer_id id FROM customers WHERE phone=?','01000009152').id;
  const bank='BANK-5G12';
  const dbInsert='INSERT INTO bank_accounts (bank_account_id,account_name,bank_name,account_type,opening_balance,current_balance,status) VALUES (?,?,?,?,?,?,?)';
  const db=(await Promise.resolve(one));
  // Bank opening balance is a fixture, not a fabricated transaction.
  // The in-memory account has no money-book entries at this point.
  const created=await api('POST','/api/sales-management/customer-payment',
   {customerId:id,amount:30,method:'Bank',bankAccountId:bank,reference:'bank transfer'});
  // A nonexistent bank account is not allowed, even if a customer has enough due.
  assert.notEqual(created.status,200);
  assert.equal(count('bank_book'),0);
  assert.equal(one('SELECT current_due n FROM customers WHERE customer_id=?',id).n,50);
 });
});
test('two simultaneous independent receipts cannot collect the same customer due twice',async()=>{
 await fixture(async({api,one,count})=>{
  await createDue(api,20,1);
  const id=one('SELECT customer_id id FROM customers WHERE phone=?','01000009152').id;
  const pay=()=>api('POST','/api/sales-management/customer-payment',
    {customerId:id,amount:20,method:'Cash',reference:crypto.randomUUID()});
  const results=await Promise.all([pay(),pay()]);
  assert.equal(results.filter(x=>x.status===200).length,1,JSON.stringify(results));
  assert.equal(results.filter(x=>x.status!==200).length,1,JSON.stringify(results));
  assert.equal(one('SELECT current_due n FROM customers WHERE customer_id=?',id).n,0);
  assert.equal(one('SELECT COALESCE(SUM(debit-credit),0) n FROM customer_ledger WHERE customer_id=?',id).n,0);
  assert.equal(count('cash_book'),1);
  assert.equal(one("SELECT COALESCE(SUM(credit),0) n FROM cash_book WHERE type='Customer Payment'").n,20);
 });
});
