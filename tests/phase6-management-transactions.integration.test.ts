import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {
 createBankAccountRoute,updateBankAccountRoute,setBankAccountStatusRoute,getBankAccountsRoute,
 getBankLedgerBootstrapRoute,getBankLedgerRoute,addBankManualEntryRoute,reverseBankEntryRoute,
 getFinanceBootstrapRoute,addFinancePersonRoute,updateFinancePersonRoute,
 setFinancePersonStatusRoute,addFinanceTransactionRoute,getFinanceLedgerRoute,
 getFinanceTransactionRoute,financeBalances
} from '../server/modules/finance/service.ts';
import {
 getExpenseBootstrapRoute,getExpenseCategoriesRoute,createExpenseCategoryRoute,
 updateExpenseCategoryRoute,setExpenseCategoryStatusRoute,getExpensePayeesRoute,
 createExpensePayeeRoute,updateExpensePayeeRoute,setExpensePayeeStatusRoute,
 getExpensePayeeLedgerRoute,getExpenseDetailRoute,getExpensesRoute,addExpenseRoute
} from '../server/modules/expenses/service.ts';

const user={userId:'P6-MGMT-ADMIN',fullName:'Finance Manager',role:'admin'} as any;
const today=new Date().toISOString().slice(0,10);
const read=async(r:Response)=>({...(await r.json() as Record<string,any>),status:r.status});
function fixture(){
 const db=new SqliteDatabase(':memory:');runMigrations(db.native,resolve('migrations'));
 db.native.prepare("INSERT INTO app_users(user_id,full_name,phone,password_hash,password_salt,role,status,created_by) VALUES ('P6-MGMT-ADMIN','Finance Manager','01000008695','fixture','fixture','admin','Active','Fixture')").run();
 db.native.prepare("INSERT INTO cash_sessions(session_id,opened_by,opening_cash,status) VALUES ('P6-MGMT-CASH','Finance Manager',100,'Open')").run();
 db.native.prepare("INSERT INTO cash_book(entry_id,date,type,reference,debit,credit) VALUES ('P6-MGMT-OPEN',?,'Session Open','P6-MGMT-CASH',0,100)").run(today);
 return {db,close:()=>db.close()};
}
test('6G bank account CRUD, ledger and manual postings retain original balances and source IDs',async()=>{
 const f=fixture();try{
  assert.equal((await read(await createBankAccountRoute(f.db,{name:''}))).status,400);
  const created=await read(await createBankAccountRoute(f.db,{name:'Finance Bank',accountType:'Bank',openingBalance:100}));
  assert.equal(created.status,200,JSON.stringify(created));
  const id=created.id;
  assert.equal((await read(await createBankAccountRoute(f.db,{name:'finance bank'}))).status,400);
  const bank=await read(await getBankAccountsRoute(f.db));
  assert.equal(bank.status,200);assert.ok(JSON.stringify(bank).includes(id));
  const bootstrap=await read(await getBankLedgerBootstrapRoute(f.db));
  assert.ok(bootstrap.accounts.some((a:any)=>a.id===id));
  const interest=await read(await addBankManualEntryRoute(f.db,{bankAccountId:id,entryType:'Interest Received',amount:20},user));
  assert.equal(interest.status,200,JSON.stringify(interest));assert.equal(interest.newBalance,120);
  const ledger=await read(await getBankLedgerRoute(f.db,new URL('https://test.invalid/?bankAccountId='+id+'&to='+today)));
  assert.equal(ledger.status,200);
  assert.equal(ledger.integrity.balanced,true);
  assert.equal(ledger.entries.length,1);
  assert.equal(ledger.entries[0].type,'Interest Received');
  const e=ledger.entries[0].entryId;
  const reversed=await read(await reverseBankEntryRoute(f.db,e,'Incorrect interest payment',user));
  assert.equal(reversed.status,200,JSON.stringify(reversed));
  assert.equal((await read(await reverseBankEntryRoute(f.db,e,'Double reversal rejected',user))).status!==200,true);
  const after=await read(await getBankLedgerRoute(f.db,new URL('https://test.invalid/?bankAccountId='+id)));
  assert.equal(after.integrity.balanced,true);
  assert.equal(after.entries.length,2);
  assert.equal(after.account.currentBalance,100);
  assert.equal((await read(await updateBankAccountRoute(f.db,id,{name:'Finance Bank Renamed',accountType:'Bank'}))).status,200);
  assert.equal((await read(await setBankAccountStatusRoute(f.db,id,'Inactive'))).status,200);
  assert.equal((await read(await addBankManualEntryRoute(f.db,{bankAccountId:id,entryType:'Interest Received',amount:5},user))).status,400);
  assert.equal((await read(await setBankAccountStatusRoute(f.db,id,'Active'))).status,200);
 }finally{f.close();}
});
test('6G bank manual entry reversal rolls back entirely when marking original as reversed fails',async()=>{
 const f=fixture();try{
  const created=await read(await createBankAccountRoute(f.db,{name:'Safe Bank',openingBalance:100}));
  assert.equal(created.status,200);
  const posted=await read(await addBankManualEntryRoute(f.db,{bankAccountId:created.id,entryType:'Interest Received',amount:25},user));
  assert.equal(posted.status,200);assert.equal(posted.newBalance,125);
  const leg=f.db.native.prepare("SELECT entry_id FROM bank_book WHERE type='Interest Received'").get() as any;
  f.db.native.exec("CREATE TRIGGER p6_reverse_fail BEFORE UPDATE OF status ON bank_book WHEN NEW.status='Reversed' BEGIN SELECT RAISE(ABORT,'forced reversal status failure'); END;");
  let result:Response|undefined;
  try{result=await reverseBankEntryRoute(f.db,leg.entry_id,'Correcting bank interest posting',user);}catch{}
  assert.notEqual(result?.status,200);
  assert.equal((f.db.native.prepare('SELECT COUNT(*) n FROM bank_book').get() as any).n,1);
  assert.equal((f.db.native.prepare('SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?').get(created.id) as any).n,125);
  assert.equal((f.db.native.prepare('SELECT status s FROM bank_book WHERE entry_id=?').get(leg.entry_id) as any).s,'Active');
  f.db.native.exec('DROP TRIGGER p6_reverse_fail');
  assert.equal((await reverseBankEntryRoute(f.db,leg.entry_id,'Correcting bank interest posting',user)).status,200);
 }finally{f.close();}
});
test('6G finance person CRUD and ledger references retain immutable owner identity',async()=>{
 const f=fixture();try{
  const owner=await read(await addFinancePersonRoute(f.db,{name:'Account Owner',personType:'Owner'}));
  assert.equal(owner.status,200,JSON.stringify(owner));
  assert.equal((await read(await addFinancePersonRoute(f.db,{name:'account owner',personType:'Owner'}))).status,400);
  const lender=await read(await addFinancePersonRoute(f.db,{name:'Partner Lender',personType:'Lender'}));
  assert.equal(lender.status,200);
  const posted=await read(await addFinanceTransactionRoute(f.db,{personId:owner.id,transactionType:'Owner Investment',amount:40,paymentMethod:'Cash',clientRequestId:'P6-MGMT-CAPITAL-01'},user));
  assert.equal(posted.status,200,JSON.stringify(posted));
  assert.equal((await read(await getFinanceTransactionRoute(f.db,posted.id))).status,200);
  const ledger=await read(await getFinanceLedgerRoute(f.db,new URL('https://test.invalid/?limit=50')));
  assert.equal(ledger.status,200);
  assert.equal((await financeBalances(f.db)).ownerCapital,40);
  assert.equal((await read(await updateFinancePersonRoute(f.db,owner.id,{name:'Account Owner Updated',personType:'Owner'}))).status,200);
  const tx=f.db.native.prepare('SELECT person_id,person_name FROM finance_transactions WHERE finance_id=?').get(posted.id) as any;
  assert.equal(tx.person_id,owner.id);assert.equal(tx.person_name,'Account Owner Updated');
  assert.equal((await read(await setFinancePersonStatusRoute(f.db,owner.id,'Inactive'))).status,200);
  const blocked=await read(await addFinanceTransactionRoute(f.db,{personId:owner.id,transactionType:'Owner Withdrawal',amount:5,paymentMethod:'Cash',clientRequestId:'P6-MGMT-WITHDRAW-1'},user));
  assert.notEqual(blocked.status,200);
  const bootstrap=await read(await getFinanceBootstrapRoute(f.db));
  assert.equal(bootstrap.ownerCapital,40);
  assert.ok(bootstrap.personsAll.some((x:any)=>x.id===owner.id&&x.status==='Inactive'));
  assert.ok(bootstrap.persons.some((x:any)=>x.id===lender.id));
 }finally{f.close();}
});
test('6G expense category/payee CRUD, historical payee rename, ledger and inactive rejection',async()=>{
 const f=fixture();try{
  const cat=await read(await createExpenseCategoryRoute(f.db,{name:'Insurance'}));
  assert.equal(cat.status,200);
  assert.equal((await read(await createExpenseCategoryRoute(f.db,{name:'insurance'}))).status,400);
  assert.equal((await read(await updateExpenseCategoryRoute(f.db,cat.id,{name:'Insurance Monthly'}))).status,200);
  const payee=await read(await createExpensePayeeRoute(f.db,{name:'Landlord',phone:'01700000001'}));
  assert.equal(payee.status,200);
  assert.equal((await read(await createExpensePayeeRoute(f.db,{name:'Landlord',phone:'01700000001'}))).status,400);
  const posted=await read(await addExpenseRoute(f.db,{categoryId:cat.id,payeeId:payee.id,amount:15,paymentMethod:'Cash',clientRequestId:'P6-MGMT-EXPENSE-1'},user));
  assert.equal(posted.status,200,JSON.stringify(posted));
  const list=await read(await getExpensesRoute(f.db));assert.equal(list.expenses.length,1);
  assert.equal((await read(await getExpenseDetailRoute(f.db,posted.id))).expense.payeeId,payee.id);
  const first=await read(await getExpensePayeeLedgerRoute(f.db,payee.id,new URL('https://test.invalid/?to='+today)));
  assert.equal(first.totalPaid,15);assert.equal(first.transactionCount,1);
  assert.equal((await read(await updateExpensePayeeRoute(f.db,payee.id,{name:'Landlord Updated',phone:'01700000001'}))).status,200);
  const after=await read(await getExpensePayeesRoute(f.db));
  assert.equal(after.payees.find((p:any)=>p.id===payee.id).totalPaid,15);
  assert.equal((await read(await getExpenseDetailRoute(f.db,posted.id))).expense.payeeName,'Landlord Updated');
  assert.equal((await read(await setExpensePayeeStatusRoute(f.db,payee.id,'Inactive'))).status,200);
  assert.equal((await read(await addExpenseRoute(f.db,{categoryId:cat.id,payeeId:payee.id,amount:5,paymentMethod:'Cash',clientRequestId:'P6-MGMT-EXPENSE-2'},user))).status,400);
  assert.equal((await read(await setExpenseCategoryStatusRoute(f.db,cat.id,'Inactive'))).status,200);
  const b=await read(await getExpenseBootstrapRoute(f.db));
  assert.equal(b.categories.some((c:any)=>c.id===cat.id),false);
  assert.equal(b.payees.some((c:any)=>c.id===payee.id),false);
  assert.ok((await read(await getExpenseCategoriesRoute(f.db))).categories.some((c:any)=>c.id===cat.id));
  assert.equal((await read(await setExpenseCategoryStatusRoute(f.db,cat.id,'Active'))).status,200);
  assert.equal((await read(await setExpensePayeeStatusRoute(f.db,payee.id,'Active'))).status,200);
 }finally{f.close();}
});

test('6G bank ledger generic reversal must refuse one-sided cash-deposit and expense sources',async()=>{
 const f=fixture();try{
  const bank=await read(await createBankAccountRoute(f.db,{name:'Protected Contra Bank',openingBalance:100}));
  assert.equal(bank.status,200);
  const deposit=await read(await addBankManualEntryRoute(f.db,{
    bankAccountId:bank.id,entryType:'Cash Deposit',amount:20
  },user));
  assert.equal(deposit.status,200);
  const depId=(f.db.native.prepare("SELECT entry_id FROM bank_book WHERE bank_account_id=? AND type='Cash Deposit'").get(bank.id) as any).entry_id;
  assert.notEqual((await read(await reverseBankEntryRoute(f.db,depId,'Reverse from original cash transfer',user))).status,200);
  assert.equal((f.db.native.prepare("SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?").get(bank.id) as any).n,120);
  const cat=await read(await createExpenseCategoryRoute(f.db,{name:'Vehicle Charges'}));
  const exp=await read(await addExpenseRoute(f.db,{
    categoryId:cat.id,amount:10,paymentMethod:'Bank',bankAccountId:bank.id,clientRequestId:'P6-CONTRA-EXP-0001'
  },user));
  assert.equal(exp.status,200);
  const expenseEntryId=(f.db.native.prepare("SELECT entry_id FROM bank_book WHERE reference=? AND type='Expense'").get(exp.id) as any).entry_id;
  assert.notEqual((await read(await reverseBankEntryRoute(f.db,expenseEntryId,'Reverse from original expense',user))).status,200);
  assert.equal((f.db.native.prepare("SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?").get(bank.id) as any).n,110);
  assert.equal((f.db.native.prepare("SELECT COUNT(*) n FROM bank_book WHERE type='Reversal'").get() as any).n,0);
 }finally{f.close();}
});
test('6G manual bank charge cannot overdraw original bank account',async()=>{
 const f=fixture();try{
  const bank=await read(await createBankAccountRoute(f.db,{name:'Guarded Bank',openingBalance:100}));
  assert.equal(bank.status,200);
  let posted:Response|undefined;
  try{posted=await addBankManualEntryRoute(f.db,{bankAccountId:bank.id,entryType:'Bank Charge',amount:1000},user);}catch{}
  assert.notEqual(posted?.status,200);
  assert.equal((f.db.native.prepare("SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?").get(bank.id) as any).n,100);
  assert.equal((f.db.native.prepare("SELECT COUNT(*) n FROM bank_book WHERE bank_account_id=?").get(bank.id) as any).n,0);
 }finally{f.close();}
});

test('6G simultaneous manual-bank reversal requests post exactly one compensating leg',async()=>{
 const f=fixture();try{
  const bank=await read(await createBankAccountRoute(f.db,{name:'Concurrent Bank',openingBalance:100}));
  assert.equal(bank.status,200);
  const posted=await read(await addBankManualEntryRoute(f.db,{
    bankAccountId:bank.id,entryType:'Interest Received',amount:25
  },user));assert.equal(posted.status,200);
  const {entry_id:entryId}=f.db.native.prepare("SELECT entry_id FROM bank_book WHERE bank_account_id=? AND type='Interest Received'").get(bank.id) as any;
  const results=await Promise.all([
    reverseBankEntryRoute(f.db,entryId,'First branch reversal request',user),
    reverseBankEntryRoute(f.db,entryId,'Second branch reversal request',user)
  ]);
  assert.equal(results.filter(r=>r.status===200).length,1);
  const all=f.db.native.prepare('SELECT * FROM bank_book WHERE bank_account_id=?').all(bank.id) as any[];
  assert.equal(all.filter(r=>r.reversal_of===entryId).length,1);
  assert.equal((f.db.native.prepare('SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?').get(bank.id) as any).n,100);
 }finally{f.close();}
});
test('6G bank manual reversal refuses to spend a previously received credit twice',async()=>{
 const f=fixture();try{
  const bank=await read(await createBankAccountRoute(f.db,{name:'Spent Credit Bank',openingBalance:0}));
  assert.equal(bank.status,200);
  const posted=await read(await addBankManualEntryRoute(f.db,{
    bankAccountId:bank.id,entryType:'Interest Received',amount:25
  },user));assert.equal(posted.status,200);
  const {entry_id:entryId}=f.db.native.prepare("SELECT entry_id FROM bank_book WHERE bank_account_id=? AND type='Interest Received'").get(bank.id) as any;
  const charge=await read(await addBankManualEntryRoute(f.db,{bankAccountId:bank.id,entryType:'Bank Charge',amount:20},user));
  assert.equal(charge.status,200);
  const rejected=await read(await reverseBankEntryRoute(f.db,entryId,'Cannot reverse funds after spending',user));
  assert.equal(rejected.status,409);
  assert.equal((f.db.native.prepare('SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?').get(bank.id) as any).n,5);
  assert.equal((f.db.native.prepare("SELECT COUNT(*) n FROM bank_book WHERE reversal_of=?").get(entryId) as any).n,0);
 }finally{f.close();}
});
