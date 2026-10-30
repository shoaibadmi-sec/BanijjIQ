import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

const ok=(x:any)=>assert.equal(x.status,200,JSON.stringify(x));
const period='&from=2026-01-01&to=2026-12-31';
const value=(page:any,key:string)=>{
 const m=page.metrics?.find((item:any)=>item.key===key);
 assert.ok(m,'Missing metric '+key+': '+JSON.stringify(page));
 return m.valueMinor;
};

test('5G20: finance bank→cash edit and delete are atomic across source, journals, bank balance, audit and reports',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  assert.ok(runMigrations(db.native,resolve('migrations')).applied.length>20);
  let token='';
  const one=(sql:string,...args:unknown[])=>db.native.prepare(sql).get(...args) as any;
  const many=(sql:string,...args:unknown[])=>db.native.prepare(sql).all(...args) as any[];
  async function api(method:string,path:string,body?:unknown){
   const response=await handleApiRequest(new Request('http://phase5g20.local'+path,{
    method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
    body:body===undefined?undefined:JSON.stringify(body)
   }),db);
   return {status:response.status,...await response.json() as Record<string,any>};
  }
  async function report(key:string){
   const page=await api('GET','/api/reports/v2/rows?report='+key+period);ok(page);return page;
  }
  const setup=await api('POST','/api/setup/admin',{fullName:'G20 Finance Audit',
   phone:'01000008731',password:'G20-Finance-Atomic-Local-2026!'});ok(setup);
  token=setup.token;
  ok(await api('POST','/api/pos/cash-session/start',{openingCash:0}));
  const bank=await api('POST','/api/bank/accounts',{name:'G20 Bank',
   accountType:'Bank',bankName:'Local Test',openingBalance:300});ok(bank);
  const owner=await api('POST','/api/finance/persons',{name:'G20 Owner',personType:'Owner'});ok(owner);
  const lender=await api('POST','/api/finance/persons',{name:'G20 Lender',personType:'Lender'});ok(lender);
  const loan=await api('POST','/api/finance/transactions',{
   personId:lender.id,transactionType:'Loan Received',paymentMethod:'Bank',
   bankAccountId:bank.id,amount:120,notes:'G20 loan original'
  });ok(loan);
  const id=loan.id;
  const balance=()=>Number(one('SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?',bank.id).n);
  assert.equal(balance(),420);
  const snapshot=()=>({
   bank:balance(),
   source:one('SELECT transaction_type,person_id,payment_method,bank_account_id,amount,is_deleted FROM finance_transactions WHERE finance_id=?',id),
   cash:many('SELECT entry_id,type,reference,debit,credit,is_deleted FROM cash_book WHERE reference=? ORDER BY rowid',id),
   bankBook:many('SELECT entry_id,type,reference,bank_account_id,debit,credit,is_deleted,status FROM bank_book WHERE reference=? ORDER BY rowid',id),
   audit:one("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='FINANCE' AND entity_id=?",id).n
  });
  const original=snapshot();
  assert.deepEqual(original.source,{
   transaction_type:'Loan Received',person_id:lender.id,
   payment_method:'Bank',bank_account_id:bank.id,amount:120,is_deleted:0
  });
  assert.equal(original.bankBook.length,1);
  const switchToCash={personId:owner.id,transactionType:'Owner Investment',
   paymentMethod:'Cash',amount:80,notes:'G20 reclassified to owner capital'};
  const path='/api/finance/transactions/'+id;
  // Source integrity must be checked before reversing a posted Finance journal.
  // A wrong original amount must never be silently converted into a new posting.
  db.native.prepare("UPDATE bank_book SET credit=110 WHERE reference=? AND COALESCE(is_deleted,0)=0").run(id);
  const tampered=snapshot();
  const refusedTampered=await api('PUT',path,switchToCash);
  assert.notEqual(refusedTampered.status,200,'Finance edit must reject a journal that differs from the original source amount');
  assert.deepEqual(snapshot(),tampered,'Rejected source mismatch cannot touch the master, journal, bank, cash or audit');
  db.native.prepare("UPDATE bank_book SET credit=120 WHERE reference=? AND COALESCE(is_deleted,0)=0").run(id);
  assert.deepEqual(snapshot(),original,'After restoring the source, original values must be unchanged');
  db.native.exec(`CREATE TRIGGER g20_reject_source_change BEFORE UPDATE ON finance_transactions
   BEGIN SELECT RAISE(ABORT,'g20-source-failure'); END;`);
  const failedEdit=await api('PUT',path,switchToCash);
  assert.notEqual(failedEdit.status,200,'Injected Finance header failure must be surfaced');
  assert.deepEqual(snapshot(),original,'A rejected edit cannot alter any original money/source/audit');
  db.native.exec('DROP TRIGGER g20_reject_source_change');

  const edited=await api('PUT',path,switchToCash);ok(edited);
  assert.equal(balance(),300);
  assert.deepEqual(snapshot().source,{
   transaction_type:'Owner Investment',person_id:owner.id,
   payment_method:'Cash',bank_account_id:'',amount:80,is_deleted:0
  });
  const afterEdit=snapshot();
  assert.equal(afterEdit.bankBook.length,1,'Immutable old bank posting retained for audit');
  assert.equal(afterEdit.bankBook[0].is_deleted,1);
  assert.equal(afterEdit.cash.length,1);
  assert.deepEqual([afterEdit.cash[0].type,afterEdit.cash[0].credit,
   afterEdit.cash[0].debit,afterEdit.cash[0].is_deleted],['Owner Investment',80,0,0]);
  const editedBeforeReports=one('SELECT total_changes() n').n;
  const cashPage=await report('cash'),bankPage=await report('bank'),financePage=await report('finance');
  assert.equal(one('SELECT total_changes() n').n,editedBeforeReports);
  assert.equal(value(cashPage,'cashReceipts'),8000);
  assert.equal(value(bankPage,'bankReceipts'),0);
  assert.equal(value(bankPage,'bankCurrentBalance'),30000);
  assert.equal(value(financePage,'ownerCapitalIn'),8000);
  assert.deepEqual(financePage.rows.map((row:any)=>row.sourceId),[id]);

  db.native.exec(`CREATE TRIGGER g20_reject_new_bank_book BEFORE INSERT ON bank_book
    WHEN NEW.type='Loan Received' BEGIN SELECT RAISE(ABORT,'g20-bank-journal-failure'); END;`);
  const failedReclassification=await api('PUT',path,{
   personId:lender.id,transactionType:'Loan Received',
   paymentMethod:'Bank',bankAccountId:bank.id,amount:60
  });
  assert.notEqual(failedReclassification.status,200);
  assert.deepEqual(snapshot(),afterEdit,'A failed replacement bank journal cannot discard the live cash source');
  db.native.exec('DROP TRIGGER g20_reject_new_bank_book');

  db.native.exec(`CREATE TRIGGER g20_reject_delete BEFORE UPDATE OF is_deleted ON finance_transactions
   WHEN NEW.is_deleted=1 BEGIN SELECT RAISE(ABORT,'g20-delete-failure'); END;`);
  const deleteBody={reason:'G20 approved incorrect finance transaction cancellation'};
  const failedDelete=await api('DELETE',path,deleteBody);
  assert.notEqual(failedDelete.status,200);
  assert.deepEqual(snapshot(),afterEdit,'A rejected deletion must preserve cash ledger, source, bank, and audit');
  db.native.exec('DROP TRIGGER g20_reject_delete');

  const deleted=await api('DELETE',path,deleteBody);ok(deleted);
  const final=snapshot();
  assert.equal(final.bank,300);
  assert.equal(final.source.is_deleted,1);
  assert.equal(final.cash.length,1,'Soft-deleted original remains auditable');
  assert.equal(final.cash[0].is_deleted,1);
  assert.equal(final.bankBook[0].is_deleted,1);
  assert.equal(final.audit,afterEdit.audit+1);
  const before=one('SELECT total_changes() n').n;
  const [afterCash,afterBank,afterFinance]=await Promise.all([
   report('cash'),report('bank'),report('finance')
  ]);
  assert.equal(one('SELECT total_changes() n').n,before,'Read-only financial reports');
  assert.equal(value(afterCash,'cashReceipts'),0);
  assert.equal(value(afterBank,'bankReceipts'),0);
  assert.equal(value(afterBank,'bankCurrentBalance'),30000);
  assert.equal(value(afterFinance,'ownerCapitalIn'),0);
  assert.equal(afterFinance.totalRows,0);
  const rejectedRepeat=await api('DELETE',path,deleteBody);
  assert.notEqual(rejectedRepeat.status,200);
  assert.deepEqual(snapshot(),final,'Repeated deletion cannot repost or write audit');
 }finally{db.close();}
});
