import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

test('G2-F verified outstanding legacy reclassification is atomic and exactly once',async()=>{
  const db=new SqliteDatabase(':memory:');
  try{
    runMigrations(db.native,resolve('migrations'));
    let token='';
    const api=async(path:string,body?:unknown)=>{
      const res=await handleApiRequest(new Request('https://test.local'+path,{
        method:body===undefined?'GET':'POST',
        headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
        body:body===undefined?undefined:JSON.stringify(body)
      }),db);
      return {status:res.status,...await res.json() as any};
    };
    const setup=await api('/api/setup/admin',{
      fullName:'Case Reviewer',phone:'01000009491',password:'TestOnlyStrong2026!'
    });
    assert.equal(setup.ok,true);token=setup.token;
    const insert=(sql:string)=>db.native.prepare(sql).run();
    insert("INSERT INTO customers(customer_id,customer_name,phone,current_due,status,is_deleted) VALUES ('H-C','Historical','01000009492',-10,'Active',0)");
    insert("INSERT INTO sales(invoice_id,sale_date,customer_id,customer_name,customer_phone,grand_total,paid_amount,due_amount,payment_type,payment_status,payment_method) VALUES ('H-S','2026-10-30','H-C','Historical','01000009492',50,50,0,'Cash','Paid','Cash')");
    insert("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES ('H-CASH','2026-10-30','Sale','H-S','Sale',0,50,'Cash',0)");
    insert("INSERT INTO sale_items(invoice_id,product_id,product_name,quantity,unit_price,line_total) VALUES ('H-S','P','Switch',5,10,50)");
    insert("INSERT INTO sales_returns(return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,refund_method,total_return_amount,reason) VALUES ('H-R','2026-10-30','H-S','H-C','Historical','01000009492','Store Credit',10,'Legacy due-side credit')");
    insert("INSERT INTO sales_return_items(return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total) VALUES ('H-R','H-S','P','Switch',1,10,10)");
    insert("INSERT INTO customer_ledger(ledger_id,date,customer_id,customer_name,type,reference,debit,credit,balance,notes) VALUES ('H-L','2026-10-30','H-C','Historical','Sales Return Credit','H-R',0,10,-10,'Old due offset')");
    const cases=await api('/api/pos/store-credit/reconciliation/cases');
    const item=cases.cases.find((c:any)=>c.flagCode==='LEGACY_UNJOURNALED_RETURN');
    assert.ok(item);
    const path='/api/pos/store-credit/reconciliation/cases/'+encodeURIComponent(item.caseId);
    const impact=await api(path+'/impact');
    assert.equal(impact.eligible,true,JSON.stringify(impact));
    const decision={decision:'verified-outstanding',reason:'Exact historical return credit moved out of negative receivables',
      evidenceIds:impact.sourceIds,expectedVersion:1};
    const first=await api(path+'/resolve',decision);
    assert.equal(first.status,200,JSON.stringify(first));
    assert.equal(first.creditIssuedCents,1000);
    assert.equal(first.case.status,'verified_outstanding');
    const read=(sql:string)=>db.native.prepare(sql).get() as any;
    assert.equal(read("SELECT current_due n FROM customers WHERE customer_id='H-C'").n,0);
    assert.equal(read("SELECT available_cents n FROM customer_store_credit_balance WHERE customer_id='H-C'").n,1000);
    assert.equal(read("SELECT COUNT(*) n FROM store_credit_historical_adjustments").n,1);
    assert.equal(read("SELECT COUNT(*) n FROM audit_logs WHERE action='RECONCILE_STORE_CREDIT'").n,1);
    assert.equal(read("SELECT COUNT(*) n FROM customer_ledger WHERE type='Store Credit Reclassification'").n,1);
    assert.equal(read('SELECT COUNT(*) n FROM bank_book').n,0);
    assert.equal(read('SELECT COUNT(*) n FROM cash_book').n,1);
    assert.equal((await api(path+'/resolve',decision)).status,409);
    assert.equal(read("SELECT available_cents n FROM customer_store_credit_balance WHERE customer_id='H-C'").n,1000);
    const review=await api('/api/pos/store-credit/reconciliation');
    assert.equal(review.ok,true,JSON.stringify(review));
    assert.equal(review.flagsCount,0,'source-reviewed historical cases must not remain unresolved anomalies');
    assert.equal(review.reviewRequired,false);
    assert.equal(review.issuedCents,1000);
    assert.equal(review.outstandingCents,1000);
    assert.equal(review.customerAccounts,1);
    const archived=await api(path);
    assert.equal(archived.status,200,JSON.stringify(archived));
    assert.equal(archived.case.status,'verified_outstanding');
    assert.equal(archived.case.caseId,item.caseId);
  }finally{db.close();}
});
