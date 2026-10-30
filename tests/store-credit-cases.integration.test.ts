import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';
import {getStoreCreditCasesRoute,getStoreCreditCaseDetailRoute} from '../server/modules/sales/store-credit-cases.ts';

test('G2-F admin-only legacy-credit cases expose source evidence without changing any balance',async()=>{
  const db=new SqliteDatabase(':memory:');
  try{
    runMigrations(db.native,resolve('migrations'));
    let token='';
    async function api(method:string,path:string,body?:unknown){
      const response=await handleApiRequest(new Request('http://credit-cases.test'+path,{
        method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
        body:body===undefined?undefined:JSON.stringify(body)
      }),db);
      return {status:response.status,...await response.json() as any};
    }
    const setup=await api('POST','/api/setup/admin',{
      fullName:'Case Review Admin',phone:'01000009884',password:'CaseReview2026Strong!'
    });
    assert.equal(setup.ok,true,JSON.stringify(setup)); token=setup.token;
    const empty=await api('GET','/api/pos/store-credit/reconciliation/cases?limit=2&offset=0');
    assert.equal(empty.ok,true,JSON.stringify(empty));
    assert.equal(empty.readOnly,true);
    assert.equal(empty.total,0);
    assert.deepEqual(empty.cases,[]);
    const row=(sql:string,...args:unknown[])=>db.native.prepare(sql).get(...args) as any;
    db.native.prepare(
      "INSERT INTO customers(customer_id,customer_name,phone,current_due,status,is_deleted) "+
      "VALUES ('CASE-CUS','Historical Customer','01000009885',-5,'Active',0)"
    ).run();
    db.native.prepare(
      "INSERT INTO sales(invoice_id,sale_date,customer_id,customer_name,customer_phone,"+
      "grand_total,paid_amount,due_amount,payment_type,payment_status,payment_method) "+
      "VALUES ('CASE-SALE','2026-10-30','CASE-CUS','Historical Customer','01000009885',"+
      "50,50,0,'Cash','Paid','Cash')"
    ).run();
    db.native.prepare(
      "INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) "+
      "VALUES ('CASE-CASH','2026-10-30','Sale','CASE-SALE','Original payment',0,50,'Cash',0)"
    ).run();
    db.native.prepare(
      "INSERT INTO sale_items(invoice_id,product_id,product_name,quantity,unit_price,line_total) "+
      "VALUES ('CASE-SALE','CASE-PROD','Cable',5,10,50)"
    ).run();
    db.native.prepare(
      "INSERT INTO sales_returns(return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,"+
      "refund_method,total_return_amount,reason) "+
      "VALUES ('CASE-RETURN','2026-10-30','CASE-SALE','CASE-CUS','Historical Customer','01000009885',"+
      "'Store Credit',5,'Old refund treated as due')"
    ).run();
    db.native.prepare(
      "INSERT INTO sales_return_items(return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total) "+
      "VALUES ('CASE-RETURN','CASE-SALE','CASE-PROD','Cable',1,5,5)"
    ).run();
    db.native.prepare(
      "INSERT INTO customer_ledger(ledger_id,date,customer_id,customer_name,type,reference,debit,credit,balance,notes) "+
      "VALUES ('CASE-LEDGER','2026-10-30','CASE-CUS','Historical Customer','Sales Return Credit',"+
      "'CASE-RETURN',0,5,-5,'Legacy misclassified credit')"
    ).run();
    const before={
      due:row("SELECT current_due FROM customers WHERE customer_id='CASE-CUS'").current_due,
      journal:row('SELECT COUNT(*) n FROM customer_store_credit_entries').n,
      cash:row('SELECT COUNT(*) n FROM cash_book').n,
      ledger:row('SELECT COUNT(*) n FROM customer_ledger').n,
      reviewCases:row('SELECT COUNT(*) n FROM store_credit_reconciliation_cases').n,
      audit:row('SELECT COUNT(*) n FROM audit_logs').n
    };
    const page=await api('GET','/api/pos/store-credit/reconciliation/cases?limit=2&offset=0');
    assert.equal(page.ok,true,JSON.stringify(page));
    assert.equal(page.readOnly,true);
    assert.equal(page.total,3,JSON.stringify(page));
    assert.equal(page.cases.length,2);
    assert.equal(page.limit,2);
    assert.equal(page.offset,0);
    const next=await api('GET','/api/pos/store-credit/reconciliation/cases?limit=2&offset=2');
    assert.equal(next.ok,true,JSON.stringify(next));
    assert.equal(next.cases.length,1);
    assert.deepEqual(new Set([...page.cases,...next.cases].map((c:any)=>c.flagCode)),
      new Set(['LEGACY_UNJOURNALED_RETURN','NEGATIVE_RECEIVABLE','LEGACY_RECEIVABLE_CREDIT']));
    const all=[...page.cases,...next.cases];
    assert.equal(new Set(all.map((c:any)=>c.caseId)).size,3);
    assert.ok(all.every((c:any)=>c.status==='unverified' && c.customerId==='CASE-CUS'));
    const legacy=all.find((c:any)=>c.flagCode==='LEGACY_UNJOURNALED_RETURN');
    assert.equal(legacy.referenceId,'CASE-RETURN');
    assert.equal(legacy.expectedCents,500);
    const detail=await api('GET','/api/pos/store-credit/reconciliation/cases/'+encodeURIComponent(legacy.caseId));
    assert.equal(detail.ok,true,JSON.stringify(detail));
    assert.equal(detail.case.caseId,legacy.caseId);
    assert.equal(detail.case.status,'unverified');
    assert.equal(detail.evidence.sale.invoiceId,'CASE-SALE');
    assert.equal(detail.evidence.sale.grandTotal,50);
    assert.equal(detail.evidence.return.returnId,'CASE-RETURN');
    assert.equal(detail.evidence.return.refundMethod,'Store Credit');
    assert.equal(detail.evidence.cashBook.length,1);
    assert.equal(detail.evidence.cashBook[0].reference,'CASE-SALE');
    assert.equal(detail.evidence.customerDue,-5);
    assert.equal(detail.evidence.customerLedger.length,1);
    // A logged-in non-admin must not enumerate historical financial anomalies
    // or inspect a discovered case ID. Both handlers must reject before
    // querying source documents or returning reconciliation evidence.
    const operator={
      userId:'case-operator',fullName:'Case Operator',phone:'01000009886',
      role:'operator',status:'Active'
    } as const;
    const forbiddenList=await getStoreCreditCasesRoute(
      db,operator,new URL('http://credit-cases.test/api/pos/store-credit/reconciliation/cases?limit=2')
    );
    const forbiddenDetail=await getStoreCreditCaseDetailRoute(db,operator,legacy.caseId);
    assert.equal(forbiddenList.status,403);
    assert.equal(forbiddenDetail.status,403);
    const forbiddenListBody=await forbiddenList.json() as any;
    const forbiddenDetailBody=await forbiddenDetail.json() as any;
    assert.equal(forbiddenListBody.cases,undefined);
    assert.equal(forbiddenDetailBody.evidence,undefined);
    // Neither the case index nor source-level evidence may be exposed to an
    // unauthenticated caller, even when a valid case ID has been discovered.
    const adminToken=token;
    token='';
    const anonymousCaseList=await api('GET','/api/pos/store-credit/reconciliation/cases?limit=2');
    const anonymousCaseDetail=await api('GET',
      '/api/pos/store-credit/reconciliation/cases/'+encodeURIComponent(legacy.caseId));
    assert.equal(anonymousCaseList.status,401,JSON.stringify(anonymousCaseList));
    assert.equal(anonymousCaseDetail.status,401,JSON.stringify(anonymousCaseDetail));
    assert.equal(anonymousCaseList.cases,undefined);
    assert.equal(anonymousCaseDetail.evidence,undefined);
    token=adminToken;
    assert.equal((await api('GET','/api/pos/store-credit/reconciliation/cases/invalid')).status,404);
    assert.equal((await api('GET','/api/pos/store-credit/reconciliation/cases?limit=0')).status,400);
    assert.equal((await api('GET','/api/pos/store-credit/reconciliation/cases?limit=101')).status,400);
    assert.equal((await api('POST','/api/pos/store-credit/reconciliation/cases/'+encodeURIComponent(legacy.caseId),{})).status,404);
    assert.equal(row("SELECT current_due FROM customers WHERE customer_id='CASE-CUS'").current_due,before.due);
    assert.equal(row('SELECT COUNT(*) n FROM customer_store_credit_entries').n,before.journal);
    assert.equal(row('SELECT COUNT(*) n FROM cash_book').n,before.cash);
    assert.equal(row('SELECT COUNT(*) n FROM customer_ledger').n,before.ledger);
    assert.equal(row('SELECT COUNT(*) n FROM store_credit_reconciliation_cases').n,before.reviewCases,
      'GET-only case discovery must never auto-create a reconciliation decision');
    assert.equal(row('SELECT COUNT(*) n FROM audit_logs').n,before.audit,
      'GET-only evidence inspection must not create an audit or settlement event');
    // Two historical ledger offsets may point at the same original return.
    // They are distinct accounting anomalies and MUST have distinct case IDs.
    db.native.prepare(
      "INSERT INTO customer_ledger(ledger_id,date,customer_id,customer_name,type,reference,debit,credit,balance,notes) "+
      "VALUES ('CASE-LEDGER-2','2026-10-30','CASE-CUS','Historical Customer','Sales Return Credit',"+
      "'CASE-RETURN',0,1,-6,'Second mistaken credit offset')"
    ).run();
    const duplicates=await api('GET','/api/pos/store-credit/reconciliation/cases?limit=10');
    assert.equal(duplicates.total,4,JSON.stringify(duplicates));
    assert.equal(new Set(duplicates.cases.map((c:any)=>c.caseId)).size,4,
      'different legacy ledger entry IDs must have unique review case IDs');
    const secondary=duplicates.cases.find((c:any)=>c.flagCode==='LEGACY_RECEIVABLE_CREDIT'
      && c.referenceId==='CASE-LEDGER-2');
    assert.ok(secondary,JSON.stringify(duplicates.cases));
    const duplicateEvidence=await api('GET',
      '/api/pos/store-credit/reconciliation/cases/'+encodeURIComponent(secondary.caseId));
    assert.equal(duplicateEvidence.ok,true,JSON.stringify(duplicateEvidence));
    assert.equal(duplicateEvidence.evidence.return.returnId,'CASE-RETURN');
    // Pagination and repeat reads must preserve immutable case identities.
    // A reviewer must not lose or duplicate a historical ledger anomaly
    // when navigating between pages of the same unchanged source data.
    const repeatedFirst=await api('GET','/api/pos/store-credit/reconciliation/cases?limit=2&offset=0');
    const repeatedSecond=await api('GET','/api/pos/store-credit/reconciliation/cases?limit=2&offset=2');
    assert.equal(repeatedFirst.ok,true,JSON.stringify(repeatedFirst));
    assert.equal(repeatedSecond.ok,true,JSON.stringify(repeatedSecond));
    assert.equal(repeatedFirst.total,4);
    assert.equal(repeatedSecond.total,4);
    const pagedIds=[...repeatedFirst.cases,...repeatedSecond.cases].map((c:any)=>c.caseId);
    assert.equal(new Set(pagedIds).size,4);
    assert.deepEqual(new Set(pagedIds),new Set(duplicates.cases.map((c:any)=>c.caseId)));
    assert.equal(row('SELECT COUNT(*) n FROM store_credit_reconciliation_cases').n,before.reviewCases);
    assert.equal(row('SELECT COUNT(*) n FROM audit_logs').n,before.audit);
  }finally{db.close();}
});
