import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

test('G2-F reviewed settlement requires real matched refund evidence, commits once, and never issues liability',async()=>{
  const db=new SqliteDatabase(':memory:');
  try{
    runMigrations(db.native,resolve('migrations'));
    let token='';
    const api=async(method:string,path:string,body?:unknown)=>{
      const response=await handleApiRequest(new Request('http://credit-resolution.test'+path,{
        method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
        body:body===undefined?undefined:JSON.stringify(body)
      }),db);
      return {status:response.status,...await response.json() as any};
    };
    const setup=await api('POST','/api/setup/admin',{
      fullName:'Case Resolution Admin',phone:'01000008934',password:'CaseResolution2026Strong!'
    });
    assert.equal(setup.ok,true,JSON.stringify(setup));token=setup.token;
    const get=(sql:string,...args:unknown[])=>db.native.prepare(sql).get(...args) as any;
    db.native.prepare(
      "INSERT INTO customers(customer_id,customer_name,phone,current_due,status,is_deleted) "+
      "VALUES ('SETTLE-CUS','Settlement Customer','01000008935',0,'Active',0)"
    ).run();
    db.native.prepare(
      "INSERT INTO sales(invoice_id,sale_date,customer_id,customer_name,customer_phone,"+
      "grand_total,paid_amount,due_amount,payment_type,payment_status,payment_method) "+
      "VALUES ('SETTLE-SALE','2026-10-30','SETTLE-CUS','Settlement Customer','01000008935',"+
      "100,100,0,'Cash','Paid','Cash')"
    ).run();
    db.native.prepare(
      "INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) "+
      "VALUES ('SETTLE-CASH','2026-10-30','Sale','SETTLE-SALE','Original sale',0,100,'Cash',0)"
    ).run();
    db.native.prepare(
      "INSERT INTO sale_items(invoice_id,product_id,product_name,quantity,unit_price,line_total) "+
      "VALUES ('SETTLE-SALE','SETTLE-PROD','Cable',10,10,100)"
    ).run();
    db.native.prepare(
      "INSERT INTO sales_returns(return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,"+
      "refund_method,total_return_amount,reason) "+
      "VALUES ('SETTLE-RETURN','2026-10-30','SETTLE-SALE','SETTLE-CUS','Settlement Customer','01000008935',"+
      "'Store Credit',10,'Historical credit that was refunded')"
    ).run();
    db.native.prepare(
      "INSERT INTO sales_return_items(return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total) "+
      "VALUES ('SETTLE-RETURN','SETTLE-SALE','SETTLE-PROD','Cable',1,10,10)"
    ).run();
    const list=await api('GET','/api/pos/store-credit/reconciliation/cases');
    assert.equal(list.ok,true,JSON.stringify(list));
    const candidate=list.cases.find((x:any)=>x.flagCode==='LEGACY_UNJOURNALED_RETURN');
    assert.ok(candidate,JSON.stringify(list));
    const path='/api/pos/store-credit/reconciliation/cases/'+encodeURIComponent(candidate.caseId)+'/resolve';
    const evidenceIds=['sale:SETTLE-SALE','return:SETTLE-RETURN','cash:SETTLE-REFUND'];
    const payload={decision:'verified-settled',reason:'Verified historical cash refund against original return',evidenceIds,expectedVersion:1};
    const before={
      journal:get('SELECT COUNT(*) n FROM customer_store_credit_entries').n,
      cash:get('SELECT COUNT(*) n FROM cash_book').n,
      due:get("SELECT current_due FROM customers WHERE customer_id='SETTLE-CUS'").current_due,
      cases:get('SELECT COUNT(*) n FROM store_credit_reconciliation_cases').n
    };
    const unauthenticated=await handleApiRequest(new Request('http://credit-resolution.test'+path,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)
    }),db);
    assert.equal(unauthenticated.status,401);
    assert.equal((await api('POST',path,{...payload,evidenceIds:[]})).status,400);
    assert.equal((await api('POST',path,{...payload,expectedVersion:0})).status,409);
    assert.equal((await api('POST',path,{...payload,decision:'verified-outstanding'})).status,409);
    assert.equal((await api('POST',path,payload)).status,409,
      'claim of cash refund without an actual matching cash-book entry must fail closed');
    assert.equal(get('SELECT COUNT(*) n FROM store_credit_reconciliation_cases').n,before.cases);
    assert.equal(get('SELECT COUNT(*) n FROM customer_store_credit_entries').n,before.journal);
    db.native.prepare(
      "INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) "+
      "VALUES ('SETTLE-REFUND','2026-10-30','Sales Return','SETTLE-RETURN','Paid original return',10,0,'Cash',0)"
    ).run();
    assert.equal((await api('POST',path,{...payload,evidenceIds:['sale:SETTLE-SALE','return:SETTLE-RETURN','cash:SETTLE-CASH']})).status,409,
      'cash sale receipt cannot impersonate a return refund');
    db.native.prepare(
      "INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) "+
      "VALUES ('SETTLE-REFUND-2','2026-10-30','Sales Return','SETTLE-RETURN','Duplicate payout',10,0,'Cash',0)"
    ).run();
    assert.equal((await api('POST',path,payload)).status,409,
      'double cash refund against one return cannot be marked reconciled');
    db.native.prepare("DELETE FROM cash_book WHERE entry_id='SETTLE-REFUND-2'").run();
    // A failed audit insert must roll back the reconciliation decision itself.
    // Retrying the same reviewed source after removing the injected fault
    // must remain possible; no liability or receivable is silently adjusted.
    db.native.exec(
      "CREATE TRIGGER block_credit_case_audit BEFORE INSERT ON audit_logs "+
      "WHEN NEW.action='REVIEW_STORE_CREDIT_CASE' BEGIN "+
      "SELECT RAISE(ABORT,'INJECTED_CREDIT_CASE_AUDIT_FAILURE'); END;"
    );
    const auditFailure=await api('POST',path,payload);
    assert.equal(auditFailure.status,500,JSON.stringify(auditFailure));
    assert.equal(get('SELECT COUNT(*) n FROM store_credit_reconciliation_cases').n,before.cases,
      'failed audit must not leave a reviewed case without its audit event');
    assert.equal(get("SELECT COUNT(*) n FROM audit_logs WHERE action='REVIEW_STORE_CREDIT_CASE'").n,0);
    assert.equal(get('SELECT COUNT(*) n FROM customer_store_credit_entries').n,before.journal);
    assert.equal(get("SELECT current_due FROM customers WHERE customer_id='SETTLE-CUS'").current_due,before.due);
    db.native.exec('DROP TRIGGER block_credit_case_audit');
    const good=await api('POST',path,payload);
    assert.equal(good.ok,true,JSON.stringify(good));
    assert.equal(good.case.status,'verified_settled');
    assert.equal(good.case.version,2);
    const persisted=get('SELECT * FROM store_credit_reconciliation_cases WHERE case_id=?',candidate.caseId);
    assert.equal(persisted.status,'verified_settled');
    assert.equal(persisted.reviewed_by,setup.user?.userId||persisted.reviewed_by);
    assert.deepEqual(JSON.parse(persisted.evidence_json).evidenceIds,evidenceIds);
    assert.equal(get('SELECT COUNT(*) n FROM audit_logs WHERE action=?','REVIEW_STORE_CREDIT_CASE').n,1);
    const detail=await api('GET','/api/pos/store-credit/reconciliation/cases/'+encodeURIComponent(candidate.caseId));
    assert.equal(detail.case.status,'verified_settled');
    assert.equal((await api('POST',path,payload)).status,409);
    assert.equal((await api('POST',path,{...payload,expectedVersion:2})).status,409);
    assert.equal(get('SELECT COUNT(*) n FROM audit_logs WHERE action=?','REVIEW_STORE_CREDIT_CASE').n,1);
    assert.equal(get('SELECT COUNT(*) n FROM store_credit_reconciliation_cases').n,1);
    assert.throws(()=>db.native.prepare(
      "UPDATE store_credit_reconciliation_cases SET review_reason='rewritten' WHERE case_id=?"
    ).run(candidate.caseId),/STORE_CREDIT_CASE_IMMUTABLE/);
    assert.throws(()=>db.native.prepare(
      "DELETE FROM store_credit_reconciliation_cases WHERE case_id=?"
    ).run(candidate.caseId),/STORE_CREDIT_CASE_IMMUTABLE/);
    assert.equal(get('SELECT COUNT(*) n FROM customer_store_credit_entries').n,before.journal);
    assert.equal(get("SELECT current_due FROM customers WHERE customer_id='SETTLE-CUS'").current_due,before.due);
    assert.equal(get('SELECT COUNT(*) n FROM cash_book').n,before.cash+1);
  }finally{db.close();}
});
