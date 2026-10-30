import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

test('Store Credit is redeemed once as a non-cash full sale; no cash, bank or A/R postings',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));let token='';
  async function api(method:string,path:string,body?:unknown){
   const headers:Record<string,string>={'content-type':'application/json'};
   if(token)headers.authorization='Bearer '+token;
   const response=await handleApiRequest(new Request('http://credit-redemption.test'+path,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body)}),db);
   return {status:response.status,...await response.json() as any};
  }
  const row=(sql:string,...args:unknown[])=>db.native.prepare(sql).get(...args) as any;
  const setup=await api('POST','/api/setup/admin',{
   fullName:'Credit Redeem Tester',phone:'01000009701',password:'CreditRedeemG2C2026!'
  });
  assert.equal(setup.ok,true,JSON.stringify(setup));token=setup.token;
  assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:0})).ok,true);
  db.native.prepare(
   "INSERT INTO customers (customer_id,customer_name,phone,current_due,status,is_deleted) "+
   "VALUES ('CR-CUSTOMER','Credit Redeemer','01000009702',0,'Active',0)"
  ).run();
  const product=await api('POST','/api/products',{
   productName:'Credit Test Cable',category:'Electrical',unit:'Pcs',purchasePrice:5,
   sellingPrice:10,currentStock:40,minimumStock:0,status:'Active'
  });
  assert.equal(product.ok,true,JSON.stringify(product));const id=product.productId;
  const original=await api('POST','/api/pos/sales',{
   clientRequestId:'credit-source-sale-0001',customerId:'CR-CUSTOMER',
   customerName:'Credit Redeemer',customerPhone:'01000009702',
   paymentType:'Cash',paymentMethod:'Cash',items:[{productId:id,qty:3,unitPrice:10}]
  });
  assert.equal(original.ok,true,JSON.stringify(original));
  const sourceId=original.invoice.invoiceId;
  const credited=await api('POST','/api/sales-returns',{
   invoiceId:sourceId,refundMethod:'Store Credit',reason:'Customer prefers future purchases',
   items:[{productId:id,qty:3,unitPrice:10}]
  });
  assert.equal(credited.ok,true,JSON.stringify(credited));
  assert.equal(row("SELECT available_cents FROM customer_store_credit_balance WHERE customer_id='CR-CUSTOMER'").available_cents,3000);
  const books={
   cash:row('SELECT COUNT(*) n FROM cash_book').n,
   bank:row('SELECT COUNT(*) n FROM bank_book').n,
   due:row("SELECT current_due FROM customers WHERE customer_id='CR-CUSTOMER'").current_due,
   ledger:row("SELECT COUNT(*) n FROM customer_ledger WHERE customer_id='CR-CUSTOMER'").n
  };
  const invalid=await api('POST','/api/pos/sales',{
   clientRequestId:'credit-overdraw-0001',customerId:'CR-CUSTOMER',
   customerName:'Credit Redeemer',customerPhone:'01000009702',
   paymentType:'Cash',paymentMethod:'Store Credit',
   items:[{productId:id,qty:4,unitPrice:10}]
  });
  assert.equal(invalid.status,409,JSON.stringify(invalid));
  assert.equal(row('SELECT COUNT(*) n FROM customer_store_credit_entries').n,1);
  const saleInput={
   clientRequestId:'credit-real-redemption-0001',customerId:'CR-CUSTOMER',
   customerName:'Credit Redeemer',customerPhone:'01000009702',
   paymentType:'Cash',paymentMethod:'Store Credit',bankAccountId:'',
   items:[{productId:id,qty:2,unitPrice:10}]
  };
  // A failure in the final sale audit must undo the credit spend, invoice,
  // FIFO stock consumption and request-key reservation as one transaction.
  // Retrying the identical request key must then succeed exactly once.
  const beforeAuditFailure={
   sales:row('SELECT COUNT(*) n FROM sales').n,
   stock:row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,
   journal:row('SELECT COUNT(*) n FROM customer_store_credit_entries').n,
   audits:row("SELECT COUNT(*) n FROM audit_logs WHERE action='CREATE_SALE'").n
  };
  db.native.exec(
   "CREATE TRIGGER reject_credit_sale_audit BEFORE INSERT ON audit_logs "+
   "WHEN NEW.action='CREATE_SALE' AND EXISTS ("+
   "SELECT 1 FROM sales s WHERE s.invoice_id=NEW.entity_id AND s.payment_method='Store Credit') "+
   "BEGIN SELECT RAISE(ABORT,'SIMULATED_CREDIT_SALE_AUDIT_FAILURE'); END"
  );
  const rolledBack=await api('POST','/api/pos/sales',saleInput);
  assert.equal(rolledBack.status,500,JSON.stringify(rolledBack));
  assert.match(String(rolledBack.error),/SIMULATED_CREDIT_SALE_AUDIT_FAILURE/);
  assert.equal(row('SELECT COUNT(*) n FROM sales').n,beforeAuditFailure.sales);
  assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,beforeAuditFailure.stock);
  assert.equal(row('SELECT COUNT(*) n FROM customer_store_credit_entries').n,beforeAuditFailure.journal);
  assert.equal(row("SELECT COUNT(*) n FROM audit_logs WHERE action='CREATE_SALE'").n,beforeAuditFailure.audits);
  assert.equal(row("SELECT available_cents FROM customer_store_credit_balance WHERE customer_id='CR-CUSTOMER'").available_cents,3000);
  assert.equal(row('SELECT COUNT(*) n FROM cash_book').n,books.cash);
  assert.equal(row('SELECT COUNT(*) n FROM bank_book').n,books.bank);
  assert.equal(row("SELECT current_due FROM customers WHERE customer_id='CR-CUSTOMER'").current_due,books.due);
  assert.equal(row("SELECT COUNT(*) n FROM customer_ledger WHERE customer_id='CR-CUSTOMER'").n,books.ledger);
  db.native.exec('DROP TRIGGER reject_credit_sale_audit');

  const spent=await api('POST','/api/pos/sales',saleInput);
  assert.equal(spent.ok,true,JSON.stringify(spent));
  assert.equal(spent.invoice.paymentMethod,'Store Credit');
  const saleId=spent.invoice.invoiceId;
  assert.equal(row('SELECT paid_amount FROM sales WHERE invoice_id=?',saleId).paid_amount,20);
  assert.equal(row('SELECT due_amount FROM sales WHERE invoice_id=?',saleId).due_amount,0);
  assert.equal(row("SELECT available_cents FROM customer_store_credit_balance WHERE customer_id='CR-CUSTOMER'").available_cents,1000);
  const redemption=row("SELECT delta_cents,balance_after_cents,source_id FROM customer_store_credit_entries WHERE entry_type='REDEEM'");
  assert.equal(redemption.delta_cents,-2000);
  assert.equal(redemption.balance_after_cents,1000);
  assert.equal(redemption.source_id,saleId);
  assert.equal(row('SELECT COUNT(*) n FROM cash_book').n,books.cash);
  assert.equal(row('SELECT COUNT(*) n FROM bank_book').n,books.bank);
  assert.equal(row("SELECT current_due FROM customers WHERE customer_id='CR-CUSTOMER'").current_due,books.due);
  assert.equal(row("SELECT COUNT(*) n FROM customer_ledger WHERE customer_id='CR-CUSTOMER'").n,books.ledger);
  const retry=await api('POST','/api/pos/sales',saleInput);
  assert.equal(retry.ok,true,JSON.stringify(retry));
  assert.equal(retry.invoice.invoiceId,saleId);
  assert.equal(row("SELECT COUNT(*) n FROM customer_store_credit_entries WHERE entry_type='REDEEM'").n,1);
  // A successful idempotent retry may only replay the exact original sale.
  // Reusing the same key with a smaller cart must not return the old invoice
  // as if the new amount was paid, or consume another liability entry.
  const conflictingReplay=await api('POST','/api/pos/sales',{
   ...saleInput,items:[{productId:id,qty:1,unitPrice:10}]
  });
  assert.equal(conflictingReplay.status,409,JSON.stringify(conflictingReplay));
  assert.match(String(conflictingReplay.error),/already used for different sale details/);
  // A request key is also bound to its original tender. Switching a
  // successful credit checkout to Cash on replay must not manufacture a
  // cash receipt or return an invoice with the wrong settlement method.
  const changedTenderReplay=await api('POST','/api/pos/sales',{
   ...saleInput,paymentMethod:'Cash'
  });
  assert.equal(changedTenderReplay.status,409,JSON.stringify(changedTenderReplay));
  assert.match(String(changedTenderReplay.error),/already used for different sale details/);
  assert.equal(row('SELECT COUNT(*) n FROM sales').n,beforeAuditFailure.sales+1);
  assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,beforeAuditFailure.stock-2);
  assert.equal(row("SELECT COUNT(*) n FROM customer_store_credit_entries WHERE entry_type='REDEEM'").n,1);
  assert.equal(row("SELECT available_cents FROM customer_store_credit_balance WHERE customer_id='CR-CUSTOMER'").available_cents,1000);
  assert.equal(row('SELECT COUNT(*) n FROM cash_book').n,books.cash);
  assert.equal(row('SELECT COUNT(*) n FROM bank_book').n,books.bank);
  const excessive=await api('POST','/api/pos/sales',{...saleInput,clientRequestId:'credit-overdraw-0002'});
  assert.equal(excessive.status,409,JSON.stringify(excessive));
  const mismatch=await api('POST','/api/pos/sales',{...saleInput,
   clientRequestId:'credit-wrong-phone-0001',customerPhone:'01000009703',items:[{productId:id,qty:1,unitPrice:10}]});
  assert.equal(mismatch.status,409,JSON.stringify(mismatch));
  const part=await api('POST','/api/pos/sales',{...saleInput,clientRequestId:'credit-partial-00001',
   paymentType:'Partial',paidAmount:5,items:[{productId:id,qty:1,unitPrice:10}]});
  assert.equal(part.status,409,JSON.stringify(part));
  const edited=await api('PUT','/api/sales-management/'+saleId,
   {reason:'No unaudited edit of credit-paid sale',items:[]});
  assert.equal(edited.status,409,JSON.stringify(edited));
  const deleted=await api('DELETE','/api/sales-management/'+saleId,
   {reason:'No unaudited delete of credit-paid sale'});
  assert.equal(deleted.status,409,JSON.stringify(deleted));
  const noRequestKey=await api('POST','/api/pos/sales',{
   ...saleInput,clientRequestId:'',items:[{productId:id,qty:1,unitPrice:10}]
  });
  assert.equal(noRequestKey.status,409,JSON.stringify(noRequestKey));
  const creditDue=await api('POST','/api/pos/sales',{
   ...saleInput,clientRequestId:'credit-due-denial-0001',paymentType:'Due',
   items:[{productId:id,qty:1,unitPrice:10}]
  });
  assert.equal(creditDue.status,409,JSON.stringify(creditDue));
  const cashRefund=await api('POST','/api/sales-returns',{
   invoiceId:saleId,refundMethod:'Cash',reason:'No cash refund for store credit tender',
   items:[{productId:id,qty:1,unitPrice:10}]
  });
  assert.equal(cashRefund.status,409,JSON.stringify(cashRefund));
  assert.equal(row('SELECT COUNT(*) n FROM sales_returns WHERE invoice_id=?',saleId).n,0);
  assert.equal(row('SELECT COUNT(*) n FROM cash_book').n,books.cash);
  assert.equal(row("SELECT available_cents FROM customer_store_credit_balance WHERE customer_id='CR-CUSTOMER'").available_cents,1000);
  assert.equal(row('SELECT COUNT(*) n FROM audit_logs WHERE action=\'CREATE_SALE\' AND entity_id=?',saleId).n,1);
  // A historical negative receivable must never be interpreted as Store Credit.
  // Even with a valid positive liability balance, both the read-only account
  // and checkout must fail closed until the legacy due is reconciled.
  db.native.prepare("UPDATE customers SET current_due=-5 WHERE customer_id='CR-CUSTOMER'").run();
  const legacyAccount=await api('GET','/api/pos/store-credit/CR-CUSTOMER');
  assert.equal(legacyAccount.ok,true,JSON.stringify(legacyAccount));
  assert.equal(legacyAccount.due,-5);
  assert.equal(legacyAccount.availableCents,1000);
  assert.equal(legacyAccount.blocked,true);
  const stockBeforeLegacyAttempt=row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock;
  const journalBeforeLegacyAttempt=row('SELECT COUNT(*) n FROM customer_store_credit_entries').n;
  const receivablesBeforeLegacyAttempt=row("SELECT COUNT(*) n FROM customer_ledger WHERE customer_id='CR-CUSTOMER'").n;
  const legacyAttempt=await api('POST','/api/pos/sales',{
   ...saleInput,clientRequestId:'credit-negative-due-denial-0001',
   items:[{productId:id,qty:1,unitPrice:10}]
  });
  assert.equal(legacyAttempt.status,409,JSON.stringify(legacyAttempt));
  assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,stockBeforeLegacyAttempt);
  assert.equal(row("SELECT COUNT(*) n FROM customer_store_credit_entries WHERE entry_type='REDEEM'").n,1);
  assert.equal(row('SELECT COUNT(*) n FROM cash_book').n,books.cash);
  assert.equal(row('SELECT COUNT(*) n FROM bank_book').n,books.bank);
  assert.equal(row("SELECT current_due FROM customers WHERE customer_id='CR-CUSTOMER'").current_due,-5);
  assert.equal(row('SELECT COUNT(*) n FROM customer_store_credit_entries').n,journalBeforeLegacyAttempt);
  assert.equal(row("SELECT COUNT(*) n FROM customer_ledger WHERE customer_id='CR-CUSTOMER'").n,receivablesBeforeLegacyAttempt);
  assert.equal(row("SELECT COUNT(*) n FROM pos_sale_requests WHERE request_id='credit-negative-due-denial-0001'").n,0);
  db.native.prepare("UPDATE customers SET current_due=0 WHERE customer_id='CR-CUSTOMER'").run();
  const reconciledAccount=await api('GET','/api/pos/store-credit/CR-CUSTOMER');
  assert.equal(reconciledAccount.blocked,false);
  assert.equal(reconciledAccount.availableCents,1000);
  // An unjournaled historical Store Credit return must not become spendable
  // just because this customer also has a valid newer liability balance.
  // The read-only legacy view must expose it for explicit reconciliation,
  // while checkout must reject it without reserving the request key.
  // This synthetic legacy record is removed only from this in-memory fixture.
  db.native.prepare(
   "INSERT INTO sales_returns "+
   "(return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,refund_method,total_return_amount,reason) "+
   "VALUES ('LEGACY-UNJOURNALED-1','2026-10-29',?,'CR-CUSTOMER','Credit Redeemer','01000009702','Store Credit',10,'Historical credit awaiting reconciliation')"
  ).run(sourceId);
  assert.equal(row("SELECT COUNT(*) n FROM store_credit_legacy_unreconciled WHERE return_id='LEGACY-UNJOURNALED-1'").n,1);
  const legacyCreditAccount=await api('GET','/api/pos/store-credit/CR-CUSTOMER');
  assert.equal(legacyCreditAccount.ok,true,JSON.stringify(legacyCreditAccount));
  assert.equal(legacyCreditAccount.availableCents,1000);
  assert.equal(legacyCreditAccount.blocked,true);
  const beforeUnreconciled={
   sales:row('SELECT COUNT(*) n FROM sales').n,
   stock:row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,
   journal:row('SELECT COUNT(*) n FROM customer_store_credit_entries').n,
   cash:row('SELECT COUNT(*) n FROM cash_book').n,
   bank:row('SELECT COUNT(*) n FROM bank_book').n,
   due:row("SELECT current_due FROM customers WHERE customer_id='CR-CUSTOMER'").current_due,
   receivableEntries:row("SELECT COUNT(*) n FROM customer_ledger WHERE customer_id='CR-CUSTOMER'").n
  };
  const unreconciledAttempt=await api('POST','/api/pos/sales',{
   ...saleInput,clientRequestId:'credit-legacy-return-denial-0001',
   items:[{productId:id,qty:1,unitPrice:10}]
  });
  assert.equal(unreconciledAttempt.status,409,JSON.stringify(unreconciledAttempt));
  assert.equal(row('SELECT COUNT(*) n FROM sales').n,beforeUnreconciled.sales);
  assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,beforeUnreconciled.stock);
  assert.equal(row('SELECT COUNT(*) n FROM customer_store_credit_entries').n,beforeUnreconciled.journal);
  assert.equal(row('SELECT COUNT(*) n FROM cash_book').n,beforeUnreconciled.cash);
  assert.equal(row('SELECT COUNT(*) n FROM bank_book').n,beforeUnreconciled.bank);
  assert.equal(row("SELECT current_due FROM customers WHERE customer_id='CR-CUSTOMER'").current_due,beforeUnreconciled.due);
  assert.equal(row("SELECT COUNT(*) n FROM customer_ledger WHERE customer_id='CR-CUSTOMER'").n,beforeUnreconciled.receivableEntries);
  assert.equal(row("SELECT COUNT(*) n FROM pos_sale_requests WHERE request_id='credit-legacy-return-denial-0001'").n,0);
  db.native.prepare("DELETE FROM sales_returns WHERE return_id='LEGACY-UNJOURNALED-1'").run();
  assert.equal((await api('GET','/api/pos/store-credit/CR-CUSTOMER')).blocked,false);

  // A disabled customer must not spend a valid positive liability.
  // Reuse one contender's request key to prove a failed checkout does not
  // reserve the key before the customer is reactivated.
  const beforeDisabled={
   sales:row('SELECT COUNT(*) n FROM sales').n,
   stock:row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,
   journal:row('SELECT COUNT(*) n FROM customer_store_credit_entries').n,
   cash:row('SELECT COUNT(*) n FROM cash_book').n,
   bank:row('SELECT COUNT(*) n FROM bank_book').n
  };
  db.native.prepare("UPDATE customers SET status='Inactive' WHERE customer_id='CR-CUSTOMER'").run();
  const disabledAttempt=await api('POST','/api/pos/sales',{
   ...saleInput,clientRequestId:'credit-race-checkout-0001',
   items:[{productId:id,qty:1,unitPrice:10}]
  });
  assert.equal(disabledAttempt.status,409,JSON.stringify(disabledAttempt));
  assert.equal(row('SELECT COUNT(*) n FROM sales').n,beforeDisabled.sales);
  assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',id).current_stock,beforeDisabled.stock);
  assert.equal(row('SELECT COUNT(*) n FROM customer_store_credit_entries').n,beforeDisabled.journal);
  assert.equal(row("SELECT available_cents FROM customer_store_credit_balance WHERE customer_id='CR-CUSTOMER'").available_cents,1000);
  assert.equal(row('SELECT COUNT(*) n FROM cash_book').n,beforeDisabled.cash);
  assert.equal(row('SELECT COUNT(*) n FROM bank_book').n,beforeDisabled.bank);
  assert.equal(row("SELECT COUNT(*) n FROM pos_sale_requests WHERE request_id='credit-race-checkout-0001'").n,0);
  db.native.prepare("UPDATE customers SET status='Active' WHERE customer_id='CR-CUSTOMER'").run();
  // Two concurrent one-item checkouts cannot each spend the same last ৳10.
  const contenders=await Promise.all([
   api('POST','/api/pos/sales',{...saleInput,clientRequestId:'credit-race-checkout-0001',
     items:[{productId:id,qty:1,unitPrice:10}]}),
   api('POST','/api/pos/sales',{...saleInput,clientRequestId:'credit-race-checkout-0002',
     items:[{productId:id,qty:1,unitPrice:10}]})
  ]);
  assert.equal(contenders.filter(x=>x.ok===true).length,1,JSON.stringify(contenders));
  assert.equal(contenders.filter(x=>x.status===409).length,1,JSON.stringify(contenders));
  assert.equal(row("SELECT available_cents FROM customer_store_credit_balance WHERE customer_id='CR-CUSTOMER'").available_cents,0);
  assert.equal(row("SELECT COUNT(*) n FROM customer_store_credit_entries WHERE entry_type='REDEEM'").n,2);
  assert.equal(row('SELECT COUNT(*) n FROM cash_book').n,books.cash);
  assert.equal(row('SELECT COUNT(*) n FROM bank_book').n,books.bank);
  // No manual ledger edit/replay can steal the last credit.
  assert.throws(()=>db.native.prepare(
   "INSERT INTO customer_store_credit_entries "+
   "(entry_id,customer_id,entry_type,source_type,source_id,delta_cents,balance_after_cents,created_by) "+
   "VALUES ('FAKE-REDEEM','CR-CUSTOMER','REDEEM','Sale',?,-2000,-1000,'forged')"
  ).run(saleId),/CHECK constraint failed|STORE_CREDIT_LEDGER_CONFLICT/);
 }finally{db.close();}
});
