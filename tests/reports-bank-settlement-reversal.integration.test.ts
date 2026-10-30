import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

const period='&from=2026-01-01&to=2026-12-31';
const ok=(r:any)=>assert.equal(r.status,200,JSON.stringify(r));
function minor(page:any,key:string){
 const found=page.metrics?.find((m:any)=>m.key===key);
 assert.ok(found,'missing '+key+': '+JSON.stringify(page));
 assert.notEqual(found.status,'incomplete','unreconciled '+key+': '+JSON.stringify(found));
 return found.valueMinor;
}

test('Phase 5G16: bank supplier settlement reversal restores payable without duplicating customer receipts, FIFO profit or bank master',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  assert.ok(runMigrations(db.native,resolve('migrations')).applied.length>20);
  let token='';
  const one=(sql:string,...args:unknown[])=>db.native.prepare(sql).get(...args) as any;
  const count=(table:string)=>Number(one('SELECT COUNT(*) n FROM '+table).n);
  async function api(method:string,path:string,body?:unknown){
   const response=await handleApiRequest(new Request('http://phase5g16.local'+path,{
    method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
    body:body===undefined?undefined:JSON.stringify(body)
   }),db);
   return {status:response.status,...await response.json() as Record<string,any>};
  }
  async function report(name:string){
   const result=await api('GET','/api/reports/v2/rows?report='+name+period);
   ok(result);return result;
  }
  const admin=await api('POST','/api/setup/admin',{
   fullName:'Bank Reversal Acceptance',phone:'01000008461',
   password:'G16-Bank-Reversal-Local-2026!'
  });ok(admin);token=admin.token;
  const supplier=await api('POST','/api/suppliers',{name:'G16 Supplier',openingBalance:0});ok(supplier);
  const product=await api('POST','/api/products',{
   productName:'G16 Electrical Outlet',category:'Electrical',unit:'Pcs',
   purchasePrice:20,sellingPrice:35,currentStock:0,minimumStock:0,
   status:'Active',trackSerial:false,trackExpiry:false,trackWarranty:false
  });ok(product);
  const pid=product.productId;
  const purchase=await api('POST','/api/purchases',{
   supplierId:supplier.id,discount:0,paidAmount:0,
   items:[{productId:pid,qty:10,unitPrice:20}]
  });ok(purchase);
  assert.equal(purchase.dueAmount,200);
  ok(await api('POST','/api/pos/cash-session/start',{openingCash:0}));
  const sale=await api('POST','/api/pos/sales',{
   clientRequestId:'phase5g16-due-sale-0001',customerName:'G16 Buyer',
   customerPhone:'01000008462',discount:0,paymentType:'Due',paidAmount:0,
   items:[{productId:pid,name:'G16 Electrical Outlet',qty:4,
    unitPrice:35,fulfillmentMode:'own'}]
  });ok(sale);
  assert.equal(sale.invoice.grandTotal,140);
  const customer=one('SELECT customer_id,current_due FROM customers WHERE phone=?','01000008462');
  assert.equal(customer.current_due,140);
  const bankId='BANK-5G16';
  db.native.prepare("INSERT INTO bank_accounts(bank_account_id,account_name,bank_name,account_type,opening_balance,current_balance,status) VALUES (?,'G16 Account','Local Bank','Bank',1000,1000,'Active')").run(bankId);
  const paidCustomer=await api('POST','/api/sales-management/customer-payment',{
   customerId:customer.customer_id,amount:90,method:'Bank',bankAccountId:bankId,
   reference:'G16 buyer pays original due'
  });ok(paidCustomer);
  assert.equal(paidCustomer.newDue,50);
  const settlement=await api('POST','/api/purchases/supplier-settlements',{
   supplierId:supplier.id,amount:50,method:'Bank',bankAccountId:bankId,
   clientRequestId:crypto.randomUUID(),notes:'G16 bank supplier settlement'
  });ok(settlement);
  assert.equal(settlement.newDue,150);
  const bankBalance=()=>Number(one('SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?',bankId).n);
  const supplierDue=()=>Number(one('SELECT current_due n FROM suppliers WHERE supplier_id=?',supplier.id).n);
  const supplierLedger=()=>Number(one('SELECT COALESCE(SUM(debit-credit),0) n FROM supplier_ledger WHERE supplier_id=?',supplier.id).n);
  const customerDue=()=>Number(one('SELECT current_due n FROM customers WHERE customer_id=?',customer.customer_id).n);
  const customerLedger=()=>Number(one('SELECT COALESCE(SUM(debit-credit),0) n FROM customer_ledger WHERE customer_id=?',customer.customer_id).n);
  assert.equal(bankBalance(),1040);
  assert.equal(supplierDue(),150);
  assert.equal(supplierLedger(),150);
  assert.equal(customerDue(),50);
  assert.equal(customerLedger(),50);
  assert.equal(one('SELECT current_stock n FROM products WHERE product_id=?',pid).n,6);
  assert.equal(minor(await report('profit'),'netProfit'),6000);
  assert.equal(minor(await report('bank'),'bankCurrentBalance'),104000);

  const reversed=await api('POST','/api/purchases/supplier-settlements/'+settlement.settlementId+'/reverse',{
   reason:'G16 return supplier payment to company bank'
  });ok(reversed);
  assert.equal(reversed.newDue,200);
  assert.equal(bankBalance(),1090);
  assert.equal(supplierDue(),200);
  assert.equal(supplierLedger(),200);
  assert.equal(customerDue(),50);
  assert.equal(customerLedger(),50);
  assert.equal(one('SELECT status s FROM supplier_settlement_entries WHERE settlement_id=?',settlement.settlementId).s,'Reversed');
  const original=one("SELECT debit,credit FROM bank_book WHERE reference=? AND type='Supplier Payment'",settlement.ledgerId);
  assert.deepEqual([original.debit,original.credit],[50,0]);
  const reversal=one("SELECT debit,credit,reversal_of r FROM bank_book WHERE reference=? AND type='Supplier Payment Reversal'",reversed.reversalLedgerId);
  assert.deepEqual([reversal.debit,reversal.credit,reversal.r],[0,50,settlement.ledgerId]);
  assert.equal(one("SELECT COALESCE(SUM(credit-debit),0) n FROM bank_book WHERE bank_account_id=?",bankId).n,90);
  assert.equal(count('bank_book'),3);
  assert.equal(count('cash_book'),0,'bank collections and reversals never create cash movements');
  assert.equal(one('SELECT current_stock n FROM products WHERE product_id=?',pid).n,6);
  assert.equal(one('SELECT COALESCE(SUM(remaining_quantity),0) n FROM stock_lots WHERE product_id=?',pid).n,6);

  const beforeReports=one('SELECT total_changes() n').n;
  const results:Record<string,any>={};
  for(const name of ['profit','stock','receivables','payables','cash','bank'])
   results[name]=await report(name);
  assert.equal(one('SELECT total_changes() n').n,beforeReports,'reports must never post entries');
  assert.equal(minor(results.profit,'netSales'),14000);
  assert.equal(minor(results.profit,'fifoCogs'),8000);
  assert.equal(minor(results.profit,'netProfit'),6000);
  assert.equal(minor(results.profit,'operatingExpenses'),0);
  assert.equal(minor(results.stock,'inventoryValue'),12000);
  assert.equal(minor(results.receivables,'receivablesBalance'),5000);
  assert.equal(minor(results.payables,'payablesBalance'),20000);
  assert.equal(minor(results.bank,'bankReceipts'),14000,'customer due 90 + reversal 50');
  assert.equal(minor(results.bank,'bankPayments'),5000,'preserve original supplier debit');
  assert.equal(minor(results.bank,'bankCurrentBalance'),109000);
  assert.equal(minor(results.cash,'externalNetMovement'),9000);
  assert.equal(minor(results.cash,'cashReceipts'),0);
  assert.equal(minor(results.cash,'cashPayments'),0);
  const snapshot={
   bankBalance:bankBalance(),supplierDue:supplierDue(),supplierLedger:supplierLedger(),
   customerDue:customerDue(),customerLedger:customerLedger(),book:count('bank_book'),
   supplierRows:count('supplier_ledger'),audits:count('audit_logs')
  };
  const replay=await api('POST','/api/purchases/supplier-settlements/'+settlement.settlementId+'/reverse',{
   reason:'Duplicate reversal must reject'
  });
  assert.equal(replay.status,409,JSON.stringify(replay));
  assert.deepEqual({
   bankBalance:bankBalance(),supplierDue:supplierDue(),supplierLedger:supplierLedger(),
   customerDue:customerDue(),customerLedger:customerLedger(),book:count('bank_book'),
   supplierRows:count('supplier_ledger'),audits:count('audit_logs')
  },snapshot,'reversal replay may not append financial or audit entries');
 }finally{db.close();}
});
