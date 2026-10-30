import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

const period='&from=2026-01-01&to=2026-12-31';
const ok=(r:any)=>assert.equal(r.status,200,JSON.stringify(r));
function valueMinor(report:any,key:string){
 const metric=report.metrics?.find((m:any)=>m.key===key);
 assert.ok(metric,'Missing '+key+' in '+JSON.stringify(report));
 assert.ok(metric.valueMinor!==null,'Unverified metric '+key+': '+JSON.stringify(metric));
 return metric.valueMinor;
}

test('5G17: paid bank purchase → cash sale → sales return → bank purchase refund reversal preserves FIFO, money and reports',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  assert.ok(runMigrations(db.native,resolve('migrations')).applied.length>20);
  let token='';
  const one=(sql:string,...args:unknown[])=>db.native.prepare(sql).get(...args) as any;
  const many=(sql:string,...args:unknown[])=>db.native.prepare(sql).all(...args) as any[];
  const count=(table:string)=>Number(one('SELECT COUNT(*) n FROM '+table).n);
  async function api(method:string,path:string,body?:unknown){
   const response=await handleApiRequest(new Request('http://phase5g17.local'+path,{
    method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
    body:body===undefined?undefined:JSON.stringify(body)
   }),db);
   return {status:response.status,...await response.json() as Record<string,any>};
  }
  const report=async(name:string)=>{
   const r=await api('GET','/api/reports/v2/rows?report='+name+period);ok(r);return r;
  };
  const setup=await api('POST','/api/setup/admin',{
   fullName:'Dual Return Acceptance',phone:'01000008301',
   password:'G17-Bank-Cash-Return-Local-2026!'
  });ok(setup);token=setup.token;
  const supplier=await api('POST','/api/suppliers',{name:'G17 Components',openingBalance:0});ok(supplier);
  const product=await api('POST','/api/products',{
   productName:'G17 Circuit Switch',category:'Hardware',unit:'Pcs',
   purchasePrice:20,sellingPrice:35,currentStock:0,minimumStock:0,
   status:'Active',trackSerial:false,trackExpiry:false,trackWarranty:false
  });ok(product);
  const pid=product.productId;
  ok(await api('POST','/api/pos/cash-session/start',{openingCash:0}));
  const bankId='BANK-5G17';
  db.native.prepare("INSERT INTO bank_accounts(bank_account_id,account_name,bank_name,account_type,opening_balance,current_balance,status) VALUES (?,'G17 Bank','Test Bank','Bank',500,500,'Active')").run(bankId);
  const purchasePayload={
   supplierId:supplier.id,paymentMethod:'Bank',bankAccountId:bankId,paidAmount:200,
   clientRequestId:crypto.randomUUID(),discount:0,
   items:[{productId:pid,qty:10,unitPrice:20}]
  };
  const purchase=await api('POST','/api/purchases',purchasePayload);ok(purchase);
  assert.equal(purchase.grandTotal,200);
  assert.equal(purchase.dueAmount,0);
  const lot=one("SELECT lot_id,original_quantity,remaining_quantity,unit_cost FROM stock_lots WHERE source_type='PURCHASE' AND source_ref=?",purchase.purchaseId);
  assert.deepEqual([lot.original_quantity,lot.remaining_quantity,lot.unit_cost],[10,10,20]);
  const bank=()=>Number(one('SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?',bankId).n);
  const stock=()=>Number(one('SELECT current_stock n FROM products WHERE product_id=?',pid).n);
  const lotLeft=()=>Number(one('SELECT remaining_quantity n FROM stock_lots WHERE lot_id=?',lot.lot_id).n);
  const supplierDue=()=>Number(one('SELECT current_due n FROM suppliers WHERE supplier_id=?',supplier.id).n);
  const ledgerDue=()=>Number(one('SELECT COALESCE(SUM(debit-credit),0) n FROM supplier_ledger WHERE supplier_id=?',supplier.id).n);
  assert.equal(bank(),300);
  assert.equal(supplierDue(),0);
  assert.equal(ledgerDue(),0);
  assert.equal(stock(),10);

  const sale=await api('POST','/api/pos/sales',{
   clientRequestId:crypto.randomUUID(),customerName:'G17 Cash Guest',
   customerPhone:'01000008302',paymentType:'Cash',paymentMethod:'Cash',
   discount:0,items:[{productId:pid,name:'G17 Circuit Switch',qty:4,
    unitPrice:35,fulfillmentMode:'own'}]
  });ok(sale);
  const invoice=sale.invoice.invoiceId;
  assert.equal(sale.invoice.grandTotal,140);
  assert.equal(stock(),6);
  assert.deepEqual(many('SELECT quantity,unit_cost FROM sale_item_lots WHERE invoice_id=?',invoice)
    .map(x=>[x.quantity,x.unit_cost]),[[4,20]]);
  const salesReturn=await api('POST','/api/sales-returns',{
   invoiceId:invoice,refundMethod:'Cash',reason:'One faulty switch returned',
   items:[{productId:pid,qty:1,unitPrice:35}]
  });ok(salesReturn);
  assert.equal(salesReturn.totalReturnAmount,35);
  assert.equal(stock(),7);
  assert.equal(lotLeft(),7);
  assert.equal(bank(),300,'Cash sale and cash refund never change bank account');
  assert.equal(one("SELECT SUM(credit-debit) n FROM cash_book WHERE type IN ('Sale','Sales Return')").n,105);

  const payload={purchaseId:purchase.purchaseId,refundMethod:'Bank',bankAccountId:bankId,
   clientRequestId:crypto.randomUUID(),reason:'Two supplier-defective unsold pieces',
   items:[{productId:pid,qty:2,unitPrice:20}]};
  const refund=await api('POST','/api/purchase-returns',payload);ok(refund);
  assert.equal(refund.totalReturnAmount,40);
  assert.equal(refund.returnId.length>0,true);
  assert.equal(bank(),340);
  assert.equal(stock(),5);
  assert.equal(lotLeft(),5);
  assert.equal(supplierDue(),0,'Paid supplier refund must not create supplier debt');
  assert.equal(ledgerDue(),0);
  assert.equal(one('SELECT returned_amount n FROM purchases WHERE purchase_id=?',purchase.purchaseId).n,40);

  const reversalPayload={clientRequestId:crypto.randomUUID(),
   reason:'Supplier restored original two unsold pieces'};
  const reversePath='/api/purchase-returns/'+refund.returnId+'/reverse';
  const reverse=await api('POST',reversePath,reversalPayload);ok(reverse);
  assert.equal(bank(),300,'Reversing bank refund must return received funds exactly once');
  assert.equal(stock(),7);
  assert.equal(lotLeft(),7);
  assert.equal(supplierDue(),0);
  assert.equal(ledgerDue(),0);
  assert.equal(one('SELECT returned_amount n FROM purchases WHERE purchase_id=?',purchase.purchaseId).n,0);
  assert.equal(one('SELECT refund_status s FROM purchase_returns WHERE return_id=?',refund.returnId).s,'Reversed');
  const refundMoney=one("SELECT entry_id,credit,debit FROM bank_book WHERE reference=? AND type='Supplier Refund'",refund.returnId);
  assert.deepEqual([refundMoney.credit,refundMoney.debit],[40,0]);
  const reversalMoney=one("SELECT debit,credit,reversal_of sourceId FROM bank_book WHERE reference=? AND type='Supplier Refund Reversal'",refund.returnId);
  assert.deepEqual([reversalMoney.debit,reversalMoney.credit,reversalMoney.sourceId],[40,0,refundMoney.entry_id]);
  assert.equal(count('bank_book'),3,'One purchase debit, one refund credit, one compensating reversal debit');
  assert.equal(count('sales'),1);
  assert.equal(count('sales_returns'),1);
  assert.equal(count('purchase_returns'),1);
  assert.equal(one('SELECT SUM(quantity) n FROM sales_return_item_lots WHERE invoice_id=?',invoice).n,1);
  assert.equal(one("SELECT SUM(quantity_in) n FROM stock_movements WHERE movement_type='Purchase Return Reversal' AND note=?",refund.returnId).n,2);

  const beforeReports=one('SELECT total_changes() n').n;
  const r:Record<string,any>={};
  for(const key of ['profit','stock','payables','receivables','cash','bank'])r[key]=await report(key);
  assert.equal(one('SELECT total_changes() n').n,beforeReports,'Reporting must not mutate posting state');
  assert.equal(r.profit.coverage.status,'ready',JSON.stringify(r.profit.coverage));
  for(const [key,amount] of [['netSales',10500],['fifoCogs',6000],
    ['grossProfit',4500],['netProfit',4500],['operatingExpenses',0]] as const)
   assert.equal(valueMinor(r.profit,key),amount,key);
  assert.equal(valueMinor(r.stock,'inventoryValue'),14000);
  assert.equal(valueMinor(r.payables,'payablesBalance'),0);
  assert.equal(valueMinor(r.receivables,'receivablesBalance'),0);
  for(const [key,amount] of [['cashReceipts',14000],['cashPayments',3500],
    ['cashBookBalance',10500],['bankReceipts',4000],
    ['bankPayments',24000],['bankCurrentBalance',30000],
    ['externalNetMovement',-9500]] as const)
   assert.equal(valueMinor(r.cash,key),amount,key);

  const snapshot=()=>({
   bank:bank(),supplier:supplierDue(),ledger:ledgerDue(),stock:stock(),lot:lotLeft(),
   bankBook:count('bank_book'),cashBook:count('cash_book'),
   returned:one('SELECT returned_amount n FROM purchases WHERE purchase_id=?',purchase.purchaseId).n,
   audit:count('audit_logs'),stockMoves:count('stock_movements')
  });
  const baseline=snapshot();
  const repeated=await api('POST',reversePath,reversalPayload);ok(repeated);
  assert.equal(repeated.idempotent,true);
  assert.equal((await api('POST',reversePath,{...reversalPayload,clientRequestId:crypto.randomUUID()})).status,409);
  assert.deepEqual(snapshot(),baseline,'Replays and conflicting reversal IDs must leave every book unchanged');
 }finally{db.close();}
});
