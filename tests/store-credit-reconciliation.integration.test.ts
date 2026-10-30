import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';
import {getStoreCreditReconciliationRoute} from '../server/modules/sales/service.ts';

test('G2-E read-only reconciliation highlights legacy credits, negative A/R and mismatched credit-paid sales',async()=>{
  const db=new SqliteDatabase(':memory:');
  try{
    runMigrations(db.native,resolve('migrations'));
    let token='';
    const api=async(method:string,path:string,body?:unknown)=>{
      const response=await handleApiRequest(new Request('http://credit-review.test'+path,{
        method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
        body:body===undefined?undefined:JSON.stringify(body)
      }),db);
      return {status:response.status,...await response.json() as any};
    };
    const setup=await api('POST','/api/setup/admin',{
      fullName:'Credit Reconciliation Auditor',phone:'01000009891',password:'CreditAuditG2E2026!'
    });
    assert.equal(setup.ok,true,JSON.stringify(setup));token=setup.token;
    const clean=await api('GET','/api/pos/store-credit/reconciliation');
    assert.equal(clean.ok,true,JSON.stringify(clean));
    assert.equal(clean.readOnly,true);
    assert.equal(clean.flagsCount,0);
    assert.equal(clean.outstandingCents,0);
    assert.equal(clean.reviewRequired,false);
    const denied=await getStoreCreditReconciliationRoute(db,{
      userId:'unprivileged',fullName:'Operator',phone:'01000009892',role:'operator',status:'Active'
    });
    assert.equal(denied.status,403);
    const get=(sql:string,...args:unknown[])=>db.native.prepare(sql).get(...args) as any;
    db.native.prepare(
      "INSERT INTO customers (customer_id,customer_name,phone,current_due,status,is_deleted) "+
      "VALUES ('REVIEW-CUS','Review Customer','01000009893',0,'Active',0)"
    ).run();
    db.native.prepare(
      "INSERT INTO sales (invoice_id,sale_date,customer_id,customer_name,customer_phone,"+
      "grand_total,paid_amount,due_amount,payment_type,payment_status,payment_method) "+
      "VALUES ('REVIEW-SALE','2026-10-30','REVIEW-CUS','Review Customer','01000009893',100,100,0,'Cash','Paid','Cash')"
    ).run();
    db.native.prepare(
      "INSERT INTO cash_book (entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) "+
      "VALUES ('REVIEW-CASH','2026-10-30','Sale','REVIEW-SALE','Paid cash sale',0,100,'Cash',0)"
    ).run();
    db.native.prepare(
      "INSERT INTO sale_items (invoice_id,product_id,product_name,quantity,unit_price,line_total) "+
      "VALUES ('REVIEW-SALE','REVIEW-PROD','Review Product',10,10,100)"
    ).run();
    db.native.prepare(
      "INSERT INTO sales_returns (return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,"+
      "refund_method,total_return_amount,reason) "+
      "VALUES ('REVIEW-RETURN','2026-10-30','REVIEW-SALE','REVIEW-CUS','Review Customer','01000009893',"+
      "'Store Credit',10,'Approved non-cash credit')"
    ).run();
    db.native.prepare(
      "INSERT INTO sales_return_items (return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total) "+
      "VALUES ('REVIEW-RETURN','REVIEW-SALE','REVIEW-PROD','Review Product',1,10,10)"
    ).run();
    db.native.prepare(
      "INSERT INTO customer_store_credit_entries "+
      "(entry_id,customer_id,entry_type,source_type,source_id,delta_cents,balance_after_cents,created_by) "+
      "VALUES ('REVIEW-ISSUE','REVIEW-CUS','ISSUE','Sales Return','REVIEW-RETURN',1000,1000,'auditor')"
    ).run();
    const issued=await api('GET','/api/pos/store-credit/reconciliation');
    assert.equal(issued.flagsCount,0,JSON.stringify(issued.flags));
    assert.equal(issued.issuedCents,1000);
    assert.equal(issued.redeemedCents,0);
    assert.equal(issued.outstandingCents,1000);
    assert.equal(issued.customerAccounts,1);
    db.native.prepare(
      "INSERT INTO sales_returns (return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,"+
      "refund_method,total_return_amount,reason) "+
      "VALUES ('OLD-CREDIT','2026-10-30','REVIEW-SALE','REVIEW-CUS','Review Customer','01000009893',"+
      "'Store Credit',5,'Historical negative A/R')"
    ).run();
    db.native.prepare(
      "UPDATE customers SET current_due=-5 WHERE customer_id='REVIEW-CUS'"
    ).run();
    db.native.prepare(
      "INSERT INTO customer_ledger (ledger_id,date,customer_id,customer_name,type,reference,debit,credit,balance,notes) "+
      "VALUES ('OLD-RECEIVABLE','2026-10-30','REVIEW-CUS','Review Customer',"+
      "'Sales Return Credit','OLD-CREDIT',0,5,-5,'Legacy receivable offset')"
    ).run();
    const flagged=await api('GET','/api/pos/store-credit/reconciliation');
    assert.equal(flagged.readOnly,true);
    assert.equal(flagged.reviewRequired,true);
    assert.equal(flagged.outstandingCents,1000);
    assert.equal(flagged.flagsCount,3,JSON.stringify(flagged.flags));
    assert.deepEqual(new Set(flagged.flags.map((x:any)=>x.flagCode)),
      new Set(['LEGACY_UNJOURNALED_RETURN','LEGACY_RECEIVABLE_CREDIT','NEGATIVE_RECEIVABLE']));
    assert.equal(get('SELECT COUNT(*) n FROM customer_store_credit_entries').n,1);
    assert.equal(get('SELECT current_due FROM customers WHERE customer_id=?','REVIEW-CUS').current_due,-5);
    // Even when a credit-paid sale is inconsistent, the report only exposes
    // flags: it must never auto-create the missing redemption or cash payout.
    db.native.prepare(
      "INSERT INTO sales (invoice_id,sale_date,customer_id,customer_name,customer_phone,"+
      "grand_total,paid_amount,due_amount,payment_type,payment_status,payment_method) "+
      "VALUES ('BROKEN-CREDIT-SALE','2026-10-30','REVIEW-CUS','Review Customer','01000009893',"+
      "10,10,0,'Cash','Paid','Store Credit')"
    ).run();
    const missing=await api('GET','/api/pos/store-credit/reconciliation');
    assert.equal(missing.flagsCount,4);
    assert.ok(missing.flags.some((x:any)=>x.flagCode==='CREDIT_SALE_WITHOUT_REDEMPTION'));
    assert.equal(get('SELECT COUNT(*) n FROM customer_store_credit_entries').n,1);
    assert.equal(get('SELECT COUNT(*) n FROM cash_book').n,1);
    assert.equal(get('SELECT COUNT(*) n FROM bank_book').n,0);
    // A Store Credit checkout must never manufacture a cash receipt. A
    // historical erroneous receipt is evidence for manual reconciliation,
    // not permission to adjust liability or customer receivables automatically.
    db.native.prepare(
      "INSERT INTO cash_book (entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) "+
      "VALUES ('BROKEN-CREDIT-CASH','2026-10-30','Sale','BROKEN-CREDIT-SALE',"+
      "'Incorrect cash receipt for Store Credit',0,10,'Cash',0)"
    ).run();
    const falseCash=await api('GET','/api/pos/store-credit/reconciliation');
    assert.equal(falseCash.readOnly,true);
    assert.equal(falseCash.reviewRequired,true);
    assert.equal(falseCash.flagsCount,5,JSON.stringify(falseCash.flags));
    const receiptFlag=falseCash.flags.find((x:any)=>x.flagCode==='CREDIT_SALE_HAS_CASH_RECEIPT');
    assert.equal(receiptFlag?.referenceId,'BROKEN-CREDIT-SALE');
    assert.equal(receiptFlag?.recordedCents,1000);
    assert.equal(get('SELECT COUNT(*) n FROM customer_store_credit_entries').n,1);
    assert.equal(get('SELECT current_due FROM customers WHERE customer_id=?','REVIEW-CUS').current_due,-5);
    assert.equal(get('SELECT COUNT(*) n FROM cash_book').n,2);
  }finally{db.close();}
});
