import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

test('4D: atomic supplier cash/bank settlement, exact due, retries, reversals and rollback',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));
  let token='';
  async function api(method:string,path:string,body?:unknown,auth=token){
   const headers:Record<string,string>={'content-type':'application/json'};
   if(auth)headers.authorization='Bearer '+auth;
   const response=await handleApiRequest(new Request('http://phase4d.test'+path,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body)}),db);
   return {status:response.status,...await response.json() as Record<string,any>};
  }
  const admin=await api('POST','/api/setup/admin',
   {fullName:'Phase4D Test Admin',phone:'01000009571',password:'Phase4DSynthetic-123!'});
  assert.equal(admin.status,200,JSON.stringify(admin));token=admin.token;
  const supplier=await api('POST','/api/suppliers',{name:'Phase4D Wholesaler',openingBalance:0});
  assert.equal(supplier.status,200,JSON.stringify(supplier));
  const product=await api('POST','/api/products',{productName:'4D Switch',category:'Electric',
   unit:'Pcs',barcode:'P4D-TEST',purchasePrice:100,sellingPrice:150,currentStock:0,
   minimumStock:0,status:'Active',trackSerial:false,trackExpiry:false,trackWarranty:false});
  assert.equal(product.status,200,JSON.stringify(product));
  const purchase=await api('POST','/api/purchases',{supplierId:supplier.id,
   items:[{productId:product.productId,qty:10,unitPrice:100}],discount:0,paidAmount:0});
  assert.equal(purchase.status,200,JSON.stringify(purchase));
  const pay=(amount:number,method:'Cash'|'Bank'|'Mobile Banking'='Cash',
    clientRequestId=crypto.randomUUID(),bankAccountId='')=>({
    supplierId:supplier.id,amount,method,clientRequestId,bankAccountId,notes:'4D verified test'
   });
  const sql=(q:string,...args:unknown[])=>(db.native.prepare(q).get(...args)) as any;
  const state=()=>({
   due:sql('SELECT current_due n FROM suppliers WHERE supplier_id=?',supplier.id).n,
   ledger:sql('SELECT COALESCE(SUM(debit-credit),0) n FROM supplier_ledger WHERE supplier_id=?',supplier.id).n,
   journals:sql('SELECT COUNT(*) n FROM supplier_settlement_entries').n,
   bank:sql('SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?','BANK-4D')?.n??0,
   cash:sql("SELECT COALESCE(SUM(debit-credit),0) n FROM cash_book WHERE type LIKE 'Supplier Payment%'").n
  });
  assert.equal((await api('POST','/api/purchases/supplier-settlements',pay(200))).status,409);
  db.native.prepare("INSERT INTO cash_sessions(session_id,opened_by,status) VALUES (?,'TEST','Open')").run('CS-4D');
  db.native.prepare(`INSERT INTO bank_accounts (bank_account_id,account_name,bank_name,current_balance,opening_balance,status)
   VALUES ('BANK-4D','Test Bank','Synthetic Bank',500,500,'Active')`).run();
  assert.deepEqual(state(),{due:1000,ledger:1000,journals:0,bank:500,cash:0});
  for(const item of [pay(-1),pay(1001),pay(0),pay(NaN),pay(501,'Bank',crypto.randomUUID(),'BANK-4D'),
    pay(50,'Bank'),pay(10,'Unknown' as any)]){
   const res=await api('POST','/api/purchases/supplier-settlements',item);
   assert.notEqual(res.status,200,JSON.stringify({item,res}));
   assert.deepEqual(state(),{due:1000,ledger:1000,journals:0,bank:500,cash:0});
  }
  const cashPayload=pay(200);
  const cash=await api('POST','/api/purchases/supplier-settlements',cashPayload);
  assert.equal(cash.status,200,JSON.stringify(cash));
  assert.deepEqual(state(),{due:800,ledger:800,journals:1,bank:500,cash:200});
  assert.equal(sql('SELECT balance n FROM supplier_ledger WHERE ledger_id=?',cash.ledgerId).n,800);
  assert.equal(sql('SELECT debit n FROM cash_book WHERE reference=?',cash.ledgerId).n,200);
  const replay=await api('POST','/api/purchases/supplier-settlements',cashPayload);
  assert.equal(replay.status,200,JSON.stringify(replay));
  assert.equal(replay.idempotent,true);assert.equal(replay.ledgerId,cash.ledgerId);
  const changed=await api('POST','/api/purchases/supplier-settlements',{...cashPayload,amount:201});
  assert.equal(changed.status,409);
  assert.deepEqual(state(),{due:800,ledger:800,journals:1,bank:500,cash:200});
  // A separate original linked bank account is debited once.
  const bank=await api('POST','/api/purchases/supplier-settlements',
   pay(300,'Bank',crypto.randomUUID(),'BANK-4D'));
  assert.equal(bank.status,200,JSON.stringify(bank));
  assert.deepEqual(state(),{due:500,ledger:500,journals:2,bank:200,cash:200});
  const bankRow=sql('SELECT bank_account_id AS id,debit,balance FROM bank_book WHERE reference=?',bank.ledgerId);
  assert.deepEqual([bankRow.id,bankRow.debit,bankRow.balance],['BANK-4D',300,200]);
  const list=await api('GET','/api/purchases/supplier-settlements/supplier/'+supplier.id);
  assert.equal(list.status,200,JSON.stringify(list));
  assert.equal(list.bankAccounts[0].id,'BANK-4D');
  assert.equal(list.supplier.currentDue,500);assert.equal(list.needsReconciliation,false);
  assert.equal(list.settlements.length,2);
  const oldEdit=await api('PUT','/api/supplier-payments/'+bank.ledgerId,
   {amount:1,method:'Cash'});
  assert.equal(oldEdit.status,409,JSON.stringify(oldEdit));
  const oldDelete=await api('DELETE','/api/supplier-payments/'+bank.ledgerId,
   {reason:'Wrong amount'});
  assert.equal(oldDelete.status,409);
  // Inject a money-entry failure: no supplier/ledger/journal changes are allowed.
  db.native.exec(`CREATE TRIGGER reject_4d_cash BEFORE INSERT ON cash_book
    WHEN NEW.type='Supplier Payment' BEGIN SELECT RAISE(ABORT,'synthetic-cash-rollback'); END;`);
  const before=state();
  const rolled=await api('POST','/api/purchases/supplier-settlements',pay(10));
  assert.notEqual(rolled.status,200,JSON.stringify(rolled));
  assert.deepEqual(state(),before,'money-book failure must rollback every payment write');
  db.native.exec('DROP TRIGGER reject_4d_cash');
  // Two simultaneous withdrawals cannot exceed due.
  const race=await Promise.all([api('POST','/api/purchases/supplier-settlements',pay(400)),
    api('POST','/api/purchases/supplier-settlements',pay(400))]);
  assert.equal(race.filter(x=>x.status===200).length,1,JSON.stringify(race));
  assert.equal(race.filter(x=>x.status!==200).length,1,JSON.stringify(race));
  assert.deepEqual(state(),{due:100,ledger:100,journals:3,bank:200,cash:600});
  const reverse=await api('POST',
   '/api/purchases/supplier-settlements/'+bank.settlementId+'/reverse',
   {reason:'Wrong bank account selected'});
  assert.equal(reverse.status,200,JSON.stringify(reverse));
  assert.deepEqual(state(),{due:400,ledger:400,journals:3,bank:500,cash:600});
  const reversalRow=sql('SELECT credit,reversal_of AS reverseOf FROM bank_book WHERE reference=?',reverse.reversalLedgerId);
  assert.deepEqual([reversalRow.credit,reversalRow.reverseOf],[300,bank.ledgerId]);
  assert.equal(sql('SELECT status s FROM supplier_settlement_entries WHERE settlement_id=?',bank.settlementId).s,'Reversed');
  assert.equal((await api('POST','/api/purchases/supplier-settlements/'+bank.settlementId+'/reverse',
    {reason:'Again must fail'})).status,409);
  assert.equal((await api('POST','/api/purchases/supplier-settlements/'+cash.settlementId+'/reverse',
    {reason:'Wrong cash payment'})).status,200);
  assert.deepEqual(state(),{due:600,ledger:600,journals:3,bank:500,cash:400});
  const legacy=await api('POST','/api/suppliers/'+supplier.id+'/payments',
   {amount:100,method:'Cash',notes:'Legacy entry must also be atomic'});
  assert.equal(legacy.status,200,JSON.stringify(legacy));
  assert.deepEqual(state(),{due:500,ledger:500,journals:4,bank:500,cash:500});
  assert.equal(sql("SELECT COUNT(*) n FROM audit_logs WHERE action='SUPPLIER_SETTLEMENT'").n,4);
  assert.equal(sql("SELECT COUNT(*) n FROM audit_logs WHERE action='REVERSE_SUPPLIER_SETTLEMENT'").n,2);
 }finally{db.close();}
});
