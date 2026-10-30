import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

const range='&from=2026-01-01&to=2026-12-31';
const ok=(result:any)=>assert.equal(result.status,200,JSON.stringify(result));
const metric=(page:any,key:string)=>{
 const result=page.metrics?.find((x:any)=>x.key===key);
 assert.ok(result,'Missing report metric '+key+' '+JSON.stringify(page));
 return result.valueMinor;
};

test('Phase 5G15: real bank/customer settlement + supplier payment + FIFO sales reconcile every source and report',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  const migrations=runMigrations(db.native,resolve('migrations'));
  assert.ok(migrations.applied.length>20,'must use the complete migration chain');
  let token='';
  async function api(method:string,path:string,body?:unknown){
   const headers:Record<string,string>={'content-type':'application/json'};
   if(token)headers.authorization='Bearer '+token;
   const response=await handleApiRequest(new Request('http://combined-accounting.local'+path,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body)
   }),db);
   return {status:response.status,...await response.json() as Record<string,any>};
  }
  const one=(query:string,...args:unknown[])=>
    db.native.prepare(query).get(...args) as any;
  const count=(table:string)=>one('SELECT COUNT(*) n FROM '+table).n as number;
  const report=async(key:string)=>{
   const r=await api('GET','/api/reports/v2/rows?report='+key+range);
   ok(r);return r;
  };
  const admin=await api('POST','/api/setup/admin',{
   fullName:'Combined Accounting Admin',phone:'01000007811',
   password:'Phase5G15-Dedicated-Local-Test!'});
  ok(admin);token=admin.token;

  const supplier=await api('POST','/api/suppliers',{
   name:'G15 Hardware Supplier',openingBalance:0
  });ok(supplier);
  const product=await api('POST','/api/products',{
   productName:'G15 Socket',category:'Hardware',unit:'Pcs',purchasePrice:20,
   sellingPrice:35,currentStock:0,minimumStock:0,status:'Active',
   trackSerial:false,trackExpiry:false,trackWarranty:false
  });ok(product);
  const pid=product.productId;
  const purchase=await api('POST','/api/purchases',{
   supplierId:supplier.id,paidAmount:0,discount:0,
   items:[{productId:pid,qty:10,unitPrice:20}]
  });ok(purchase);
  assert.equal(purchase.dueAmount,200);
  const lot=one("SELECT lot_id,remaining_quantity,unit_cost FROM stock_lots WHERE source_type='PURCHASE' AND source_ref=?",purchase.purchaseId);
  assert.deepEqual([lot.remaining_quantity,lot.unit_cost],[10,20]);
  assert.equal(one('SELECT current_due n FROM suppliers WHERE supplier_id=?',supplier.id).n,200);

  ok(await api('POST','/api/pos/cash-session/start',{openingCash:0}));
  const duePayload={
   clientRequestId:'phase5g15-due-sale-unique-1',
   customerName:'G15 Local Buyer',customerPhone:'01000007812',
   paymentType:'Due',paidAmount:0,discount:0,
   items:[{productId:pid,name:'G15 Socket',qty:4,unitPrice:35,fulfillmentMode:'own'}]
  };
  const dueSale=await api('POST','/api/pos/sales',duePayload);ok(dueSale);
  assert.equal(dueSale.invoice.dueAmount,140);
  const customer=one('SELECT customer_id,current_due FROM customers WHERE phone=?','01000007812');
  assert.equal(customer.current_due,140);
  assert.equal(one('SELECT SUM(quantity) n FROM sale_item_lots WHERE invoice_id=?',dueSale.invoice.invoiceId).n,4);

  const bankId='BANK-5G15';
  db.native.prepare("INSERT INTO bank_accounts(bank_account_id,account_name,bank_name,account_type,opening_balance,current_balance,status) VALUES (?,'G15 Bank','Local Test Bank','Bank',1000,1000,'Active')").run(bankId);
  const receive=(amount:number,method:'Cash'|'Bank',account='')=>api('POST',
   '/api/sales-management/customer-payment',
   {customerId:customer.customer_id,amount,method,bankAccountId:account,
    reference:'G15 ledger receipt'});
  ok(await receive(90,'Bank',bankId));
  assert.equal(one('SELECT current_due n FROM customers WHERE customer_id=?',customer.customer_id).n,50);
  assert.equal(one('SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?',bankId).n,1090);
  assert.equal(one("SELECT SUM(credit) n FROM bank_book WHERE type='Customer Payment' AND bank_account_id=?",bankId).n,90);

  const payment={
   supplierId:supplier.id,amount:50,method:'Bank',bankAccountId:bankId,
   clientRequestId:crypto.randomUUID(),notes:'G15 supplier bank settlement'
  };
  const stable=()=>({
   customerDue:one('SELECT current_due n FROM customers WHERE customer_id=?',customer.customer_id).n,
   supplierDue:one('SELECT current_due n FROM suppliers WHERE supplier_id=?',supplier.id).n,
   bankBalance:one('SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?',bankId).n,
   bankEntries:count('bank_book'),supplierJournals:count('supplier_settlement_entries'),
   customerJournals:count('customer_ledger'),cashReceipts:one("SELECT COALESCE(SUM(credit),0) n FROM cash_book WHERE type='Customer Payment'").n
  });
  const prior=stable();
  assert.notEqual((await receive(50.01,'Bank',bankId)).status,200,'over-collection must fail');
  assert.deepEqual(stable(),prior,'rejected customer payment cannot touch supplier, bank, ledger, or cash');

  db.native.exec("CREATE TRIGGER reject_g15_supplier_bank BEFORE INSERT ON bank_book WHEN NEW.type='Supplier Payment' BEGIN SELECT RAISE(ABORT,'G15 injection: source journal rejection'); END;");
  const aborted=await api('POST','/api/purchases/supplier-settlements',payment);
  assert.notEqual(aborted.status,200,'forced bank journal failure must reject supplier settlement');
  assert.deepEqual(stable(),prior,'aborted settlement must roll back master, ledgers, bank, and request ID');
  db.native.exec('DROP TRIGGER reject_g15_supplier_bank');
  const settled=await api('POST','/api/purchases/supplier-settlements',payment);ok(settled);
  assert.equal(settled.newDue,150);
  assert.equal(one('SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?',bankId).n,1040);
  assert.equal(one("SELECT SUM(debit) n FROM bank_book WHERE type='Supplier Payment' AND bank_account_id=?",bankId).n,50);

  ok(await receive(50,'Cash'));
  assert.equal(one('SELECT current_due n FROM customers WHERE customer_id=?',customer.customer_id).n,0);
  const cashPayload={
   clientRequestId:'phase5g15-cash-sale-unique-2',
   customerName:'G15 Guest',customerPhone:'01000007813',
   discount:0,paymentType:'Cash',paymentMethod:'Cash',
   items:[{productId:pid,name:'G15 Socket',qty:1,unitPrice:35,fulfillmentMode:'own'}]
  };
  const cashSale=await api('POST','/api/pos/sales',cashPayload);ok(cashSale);
  assert.equal(cashSale.invoice.grandTotal,35);

  assert.equal(one('SELECT current_stock n FROM products WHERE product_id=?',pid).n,5);
  assert.equal(one('SELECT remaining_quantity n FROM stock_lots WHERE lot_id=?',lot.lot_id).n,5);
  assert.equal(one('SELECT SUM(quantity) n FROM sale_item_lots WHERE lot_id=?',lot.lot_id).n,5);
  assert.equal(count('sales'),2);
  assert.equal(count('supplier_settlement_entries'),1);
  assert.equal(one('SELECT current_due n FROM suppliers WHERE supplier_id=?',supplier.id).n,150);
  assert.equal(one('SELECT COALESCE(SUM(debit-credit),0) n FROM supplier_ledger WHERE supplier_id=?',supplier.id).n,150);
  assert.equal(one('SELECT COALESCE(SUM(debit-credit),0) n FROM customer_ledger WHERE customer_id=?',customer.customer_id).n,0);
  assert.equal(one("SELECT COALESCE(SUM(credit-debit),0) n FROM bank_book WHERE bank_account_id=?",bankId).n,40);
  assert.equal(one("SELECT COALESCE(SUM(credit-debit),0) n FROM cash_book WHERE type IN ('Customer Payment','Sale')").n,85);

  const beforeReports=one('SELECT total_changes() n').n;
  const results:Record<string,any>={};
  for(const key of ['profit','stock','receivables','payables','cash','bank'])
   results[key]=await report(key);
  assert.equal(one('SELECT total_changes() n').n,beforeReports,'all reports must be read-only');
  for(const [key,expected] of [
    ['netSales',17500],['fifoCogs',10000],['grossProfit',7500],['netProfit',7500]
  ] as const)
   assert.equal(metric(results.profit,key),expected,key);
  assert.equal(results.profit.coverage.status,'ready',JSON.stringify(results.profit.coverage));
  assert.equal(metric(results.stock,'inventoryValue'),10000);
  assert.equal(metric(results.receivables,'receivablesBalance'),0);
  assert.equal(metric(results.payables,'payablesBalance'),15000);
  for(const [key,expected] of [
    ['cashReceipts',8500],['cashBookBalance',8500],
    ['bankReceipts',9000],['bankPayments',5000],
    ['bankCurrentBalance',104000],['externalNetMovement',12500]
  ] as const)
   assert.equal(metric(results.cash,key),expected,key);
  assert.equal(metric(results.bank,'bankCurrentBalance'),104000);
  assert.equal(metric(results.profit,'operatingExpenses'),0,
   'debt settlements are balance-sheet changes, never duplicated as business expenses');

  const snapshot=stable();
  const replay=await api('POST','/api/purchases/supplier-settlements',payment);ok(replay);
  assert.equal(replay.idempotent,true);
  const saleReplay=await api('POST','/api/pos/sales',cashPayload);ok(saleReplay);
  assert.equal(saleReplay.invoice.invoiceId,cashSale.invoice.invoiceId);
  const dueReplay=await api('POST','/api/pos/sales',duePayload);ok(dueReplay);
  assert.equal(dueReplay.invoice.invoiceId,dueSale.invoice.invoiceId);
  assert.notEqual((await receive(1,'Cash')).status,200);
  assert.deepEqual(stable(),snapshot,'replays and over-collection must not mutate ledger state');
  assert.equal(count('sales'),2);
  assert.equal(count('supplier_settlement_entries'),1);
 }finally{db.close();}
});
