import type { SherDatabase } from '../../../db/types.js';
import type {EvidenceSource,LiveReportPage,LiveReportQuery,LiveReportRow,ReportMetric,ReportStatus} from './types.js';

type Book={entry_id:string;date:string;type:string;reference:string;description:string;
 debit:number;credit:number;bank_account_id?:string};
type BankAccount={bank_account_id:string;opening_balance:number;current_balance:number;status:string};
type Transfer={transfer_id:string;transfer_date:string;from_account_id:string;to_account_id:string;amount:number};
type Expense={expense_id:string;expense_date:string;category_name:string;description:string;
 amount:number;payment_method:string;bank_account_id:string};
type Finance={finance_id:string;date:string;transaction_type:string;person_name:string;
 amount:number;payment_method:string;bank_account_id:string};
type RowInfo={row:LiveReportRow;sortAmount:number};
const minor=(value:number):number|null=>Number.isFinite(value)&&Number.isSafeInteger(Math.round(value*100))
  ?Math.round(value*100):null;
const today=():string=>{
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const part=(key:string)=>parts.find(x=>x.type===key)?.value??'';
 return part('year')+'-'+part('month')+'-'+part('day');
};
const source=(module:string,sourceId:string,date:string|null):EvidenceSource=>({module,sourceId,date});
const metric=(key:string,valueMinor:number|null,status:ReportStatus,reason:string,asOf:string,sources:EvidenceSource[]):ReportMetric=>
  ({key,valueMinor,status,reason,asOf,sources});
const txKey=(type:string,date:string,reference:string)=>JSON.stringify([type,date,reference]);
const valid=(n:number)=>Number.isFinite(n)&&n>=0&&minor(n)!==null;
const match=(left:number,right:number)=>minor(left)===minor(right);
const snapshotText='Bank balances and cash-book balance are current ledger snapshots, not physical cash counts or historical closing balances.';

function sortPage(q:LiveReportQuery,items:RowInfo[]):{rows:LiveReportRow[];totalRows:number}{
 const filtered=items.filter(x=>(x.row.sourceId+' '+x.row.label+' '+x.row.sourceModule).toLowerCase().includes(q.search.toLowerCase()));
 const field=(x:RowInfo):number|string=>q.sort==='date'?x.row.date:
   q.sort==='name'?x.row.label:q.sort==='amount'?x.sortAmount:x.row.sourceId;
 filtered.sort((a,b)=>{
   const x=field(a),y=field(b),diff=typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y));
   return (q.direction==='asc'?1:-1)*Math.sign(diff)||a.row.sourceId.localeCompare(b.row.sourceId);
 });
 return {totalRows:filtered.length,rows:filtered.slice((q.page-1)*q.pageSize,q.page*q.pageSize).map(x=>x.row)};
}

/**
 * Records are read-only and bounded. A bank's current balance is certifiable
 * only if opening balance plus every non-deleted bank movement reconciles.
 * Cash sessions have an operational float, NOT a cash-book receipt.
 */
export async function readCashExpenses(db:SherDatabase,q:LiveReportQuery):Promise<LiveReportPage>{
 const now=today(),problems=new Set<string>();
 const [cashR,bankR,accountsR,transfersR,expensesR,financeR]=await Promise.all([
   db.prepare("SELECT entry_id,date,type,reference,description,debit,credit FROM cash_book WHERE is_deleted=0 ORDER BY date,entry_id LIMIT 10001").all<Book>(),
   db.prepare("SELECT entry_id,bank_account_id,date,type,reference,description,debit,credit FROM bank_book WHERE is_deleted=0 ORDER BY date,entry_id LIMIT 10001").all<Book>(),
   db.prepare("SELECT bank_account_id,opening_balance,current_balance,status FROM bank_accounts ORDER BY bank_account_id LIMIT 2001").all<BankAccount>(),
   db.prepare("SELECT transfer_id,transfer_date,from_account_id,to_account_id,amount FROM bank_transfers ORDER BY transfer_date,transfer_id LIMIT 5001").all<Transfer>(),
   db.prepare("SELECT expense_id,expense_date,category_name,description,amount,payment_method,bank_account_id FROM expenses WHERE is_deleted=0 AND status NOT IN ('Cancelled','Deleted') ORDER BY expense_date,expense_id LIMIT 10001").all<Expense>(),
   db.prepare("SELECT finance_id,date,transaction_type,person_name,amount,payment_method,bank_account_id FROM finance_transactions WHERE is_deleted=0 ORDER BY date,finance_id LIMIT 10001").all<Finance>()
 ]);
 const cash=cashR.results||[],bank=bankR.results||[],accounts=accountsR.results||[],
   transfers=transfersR.results||[],expenses=expensesR.results||[],finance=financeR.results||[];
 if(cash.length>10000||bank.length>10000||expenses.length>10000||finance.length>10000||
   accounts.length>2000||transfers.length>5000)problems.add('Reporting row safety limit reached. Split or archive source records before certifying totals.');
 const accountIds=new Set(accounts.map(x=>x.bank_account_id));
 const bankByAccount=new Map<string,Book[]>();
 for(const b of bank){
   if(!accountIds.has(b.bank_account_id??''))problems.add('Bank-book entry '+b.entry_id+' references a missing bank account.');
   const list=bankByAccount.get(b.bank_account_id??'')||[];
   list.push(b);bankByAccount.set(b.bank_account_id??'',list);
 }
 const invalidBook=(x:Book)=>!valid(Number(x.debit))||!valid(Number(x.credit))||
   (Number(x.debit)>0&&Number(x.credit)>0);
 for(const row of [...cash,...bank])if(invalidBook(row))problems.add('Invalid credit/debit posting '+row.entry_id+'.');
 let bankTotal=0;
 for(const acct of accounts){
   const entries=bankByAccount.get(acct.bank_account_id)||[];
   const hasOpeningRow=entries.some(x=>x.type==='Opening Balance');
   const opening=hasOpeningRow?0:Number(acct.opening_balance);
   const net=entries.reduce((n,r)=>n+Number(r.credit)-Number(r.debit),0);
   if(!valid(Number(acct.opening_balance))||!Number.isFinite(Number(acct.current_balance))||
     !match(opening+net,Number(acct.current_balance)))
      problems.add('Bank '+acct.bank_account_id+' current balance differs from the opening balance plus bank ledger.');
   if(minor(Number(acct.current_balance))===null)
      problems.add('Invalid bank current balance for '+acct.bank_account_id+'.');
   bankTotal+=Number(acct.current_balance);
 }
 // Only one monetary side per transfer: a debit from the source account and
 // a credit to the destination. A transfer never creates business income.
 let internalVolume=0;
 const transferIds=new Set(transfers.map(x=>x.transfer_id));
 for(const t of transfers){
   const entries=bank.filter(x=>x.reference===t.transfer_id&&(x.type==='Transfer Out'||x.type==='Transfer In'));
   if(!valid(Number(t.amount))||Number(t.amount)<=0||entries.length!==2||
     !entries.some(x=>x.type==='Transfer Out'&&x.bank_account_id===t.from_account_id&&
       x.date===t.transfer_date&&match(Number(x.debit),Number(t.amount))&&Number(x.credit)===0)||
     !entries.some(x=>x.type==='Transfer In'&&x.bank_account_id===t.to_account_id&&
       x.date===t.transfer_date&&match(Number(x.credit),Number(t.amount))&&Number(x.debit)===0))
      problems.add('Unbalanced or missing internal bank transfer '+t.transfer_id+'.');
   else if(t.transfer_date>=q.from&&t.transfer_date<=q.to)internalVolume+=Number(t.amount);
 }
 for(const b of bank)if((b.type==='Transfer Out'||b.type==='Transfer In')&&!transferIds.has(b.reference))
   problems.add('Bank transfer leg '+b.entry_id+' has no transfer source header.');
 // Cash deposits/withdrawals are internally matched between CASH and BANK;
 // a posted cash deposit is not a second customer payment.
 const cashContrary=new Map<string,{amount:number;count:number}>();
 const bankContrary=new Map<string,{amount:number;count:number}>();
 for(const c of cash){
   if(c.type!=='Cash Deposit'&&c.type!=='Cash Withdrawal')continue;
   const k=txKey(c.type,c.date,c.reference),v=cashContrary.get(k)||{amount:0,count:0};
   v.amount+=c.type==='Cash Deposit'?Number(c.debit):Number(c.credit);
   v.count++;cashContrary.set(k,v);
   if((c.type==='Cash Deposit'&&Number(c.credit)!==0)||
      (c.type==='Cash Withdrawal'&&Number(c.debit)!==0))
      problems.add('Wrong cash side for internal bank/cash movement '+c.entry_id+'.');
 }
 for(const b of bank){
   if(b.type!=='Cash Deposit'&&b.type!=='Cash Withdrawal')continue;
   if(b.bank_account_id!==b.reference)problems.add('Internal bank/cash movement references the wrong bank account.');
   const k=txKey(b.type,b.date,b.reference),v=bankContrary.get(k)||{amount:0,count:0};
   v.amount+=b.type==='Cash Deposit'?Number(b.credit):Number(b.debit);
   v.count++;bankContrary.set(k,v);
   if((b.type==='Cash Deposit'&&Number(b.debit)!==0)||
     (b.type==='Cash Withdrawal'&&Number(b.credit)!==0))
       problems.add('Wrong bank side for internal bank/cash movement '+b.entry_id+'.');
 }
 for(const [k,value] of cashContrary){
   const counterpart=bankContrary.get(k);
   if(!counterpart||!match(value.amount,counterpart.amount))
     problems.add('Missing or unmatched internal cash/bank movement '+k+'.');
   else {const [type,date]=JSON.parse(k) as string[];
     if(date>=q.from&&date<=q.to)internalVolume+=value.amount;}
 }
 for(const k of bankContrary.keys())if(!cashContrary.has(k))
   problems.add('Bank deposit/withdrawal lacks matching cash-book entry '+k+'.');

 const books=[...cash.map(x=>({...x,sourceModule:'cash_book'})),
   ...bank.map(x=>({...x,sourceModule:'bank_book'}))];
 const periodBooks=books.filter(x=>x.date>=q.from&&x.date<=q.to);
 let cashReceipts=0,cashPayments=0,bankReceipts=0,bankPayments=0,externalNet=0;
 for(const x of periodBooks){
   if(x.type==='Opening Balance')continue;
   const cin=Number(x.credit),cout=Number(x.debit);
   if(x.sourceModule==='cash_book'){cashReceipts+=cin;cashPayments+=cout;}
   else {bankReceipts+=cin;bankPayments+=cout;}
   externalNet+=cin-cout;
 }
 // For the book-only balance, cash session opening floats are excluded.
 const cashLedgerBalance=cash.reduce((n,x)=>n+Number(x.credit)-Number(x.debit),0);
 const matchingExpenses=expenses.filter(x=>x.expense_date>=q.from&&x.expense_date<=q.to);
 const matchingFinance=finance.filter(x=>x.date>=q.from&&x.date<=q.to);
 const expenseChecks=new Map<string,string>();
 let expenseTotal=0,ownerCapital=0;
 for(const exp of matchingExpenses){
   const amount=Number(exp.amount),linked=books.filter(x=>x.reference===exp.expense_id&&
     (x.type==='Expense'||x.type==='Expense Update'||x.type==='Expense Deleted'));
   const payment=exp.payment_method==='Cash'?'cash_book':
     ['Bank','Mobile Banking'].includes(exp.payment_method)?'bank_book':'';
   const netOut=linked.reduce((n,x)=>n+Number(x.debit)-Number(x.credit),0);
   const warnings:string[]=[];
   if(!valid(amount))warnings.push('Invalid operating expense amount.');
   if(!payment)warnings.push('Expense payment method has no verified cash/bank posting.');
   if(!linked.length||!match(netOut,amount)||linked.some(x=>x.sourceModule!==payment))
     warnings.push('Expense amount does not match linked money-book posting.');
   if(payment==='bank_book'&&linked.some(x=>x.bank_account_id!==exp.bank_account_id))
     warnings.push('Expense uses an inconsistent bank account.');
   if(warnings.length) {
     const reason='Expense '+exp.expense_id+': '+warnings.join(' ');
     problems.add(reason);expenseChecks.set(exp.expense_id,reason);
   }else expenseTotal+=amount;
 }
 const financed=new Map<string,string>();
 const positiveTypes=new Set(['Owner Investment','Loan Received','Opening Owner Capital','Opening Loan']);
 const negativeTypes=new Set(['Owner Withdrawal','Loan Repayment']);
 for(const f of matchingFinance){
   const direction=positiveTypes.has(f.transaction_type)?1:negativeTypes.has(f.transaction_type)?-1:0;
   const amount=Number(f.amount);
   const payment=f.payment_method==='Cash'?'cash_book':
     ['Bank','Mobile Banking'].includes(f.payment_method)?'bank_book':'';
   const linked=books.filter(x=>x.reference===f.finance_id&&x.type===f.transaction_type);
   const netIn=linked.reduce((n,x)=>n+Number(x.credit)-Number(x.debit),0);
   const warnings:string[]=[];
   if(!direction||!valid(amount))warnings.push('Invalid or unsupported financing transaction.');
   if(!payment||linked.length!==1||!match(netIn,amount*direction)||
     linked.some(x=>x.sourceModule!==payment))
     warnings.push('Financing cash/bank posting does not reconcile to its source transaction.');
   if(payment==='bank_book'&&linked.some(x=>x.bank_account_id!==f.bank_account_id))
     warnings.push('Financing bank account does not reconcile.');
   if(warnings.length){
     const reason='Finance '+f.finance_id+': '+warnings.join(' ');
     problems.add(reason);financed.set(f.finance_id,reason);
   }else if(f.transaction_type==='Owner Investment'||f.transaction_type==='Opening Owner Capital')
     ownerCapital+=amount;
 }
 const inPeriod=(date:string)=>date>=q.from&&date<=q.to;
 const formatBook=(x:Book&{sourceModule:string}):RowInfo=>({
   row:{sourceId:x.entry_id,sourceModule:x.sourceModule,date:x.date,
     label:(x.type||'Money movement')+' · '+(x.description||x.reference||x.bank_account_id||''),
     amountMinor:minor(Number(x.credit)-Number(x.debit)),status:invalidBook(x)?'incomplete':'needs-review',
     reason:invalidBook(x)?'Invalid posted debit/credit amounts.':
       'Posted money movement. Cash/bank transfers and financing are not sales revenue.'},
   sortAmount:Number(x.credit)-Number(x.debit)
 });
 const formatExpense=(e:Expense):RowInfo=>{
   const failure=expenseChecks.get(e.expense_id);
   return {row:{sourceId:e.expense_id,sourceModule:'expenses',date:e.expense_date,
     label:e.category_name+(e.description?' · '+e.description:''),
     amountMinor:failure?null:minor(Number(e.amount)),status:failure?'incomplete':'needs-review',
     reason:failure??'Active recorded operating expense, reconciled to its cash/bank posting.'},
     sortAmount:Number(e.amount)};
 };
 const formatFinance=(f:Finance):RowInfo=>{
   const failure=financed.get(f.finance_id);
   const dir=negativeTypes.has(f.transaction_type)?-1:1;
   return {row:{sourceId:f.finance_id,sourceModule:'finance_transactions',date:f.date,
     label:f.transaction_type+' · '+f.person_name,amountMinor:failure?null:minor(Number(f.amount)*dir),
     status:failure?'incomplete':'needs-review',
     reason:failure??'Financing, NOT sale revenue or operating expense.'},
     sortAmount:Number(f.amount)*dir};
 };
 const rowEntries=q.report==='expenses'?matchingExpenses.map(formatExpense):
   q.report==='finance'?matchingFinance.map(formatFinance):
   q.report==='bank'?periodBooks.filter(x=>x.sourceModule==='bank_book').map(formatBook):
   periodBooks.map(formatBook);
 const {totalRows,rows}=sortPage(q,rowEntries);
 const err=problems.size>0,filtered=!!q.search;
 const coverageStatus:ReportStatus=err?'incomplete':'needs-review';
 const note=err?[...problems].slice(0,8).join(' '):'All available source movements agree.';
 const reason=snapshotText+' '+note+
   (filtered?' Search-filtered rows do not certify whole-business totals.':'');
 const allSources:EvidenceSource[]=[
   ...periodBooks.slice(0,10).map(x=>source(x.sourceModule,x.entry_id,x.date)),
   ...matchingExpenses.slice(0,5).map(x=>source('expenses',x.expense_id,x.expense_date)),
   ...matchingFinance.slice(0,5).map(x=>source('finance_transactions',x.finance_id,x.date))
 ];
 const make=(key:string,value:number,asOf:string,baseStatus:ReportStatus=coverageStatus,
    comment=reason):ReportMetric=>metric(key,err||filtered?null:minor(value),
     err?'incomplete':filtered?'unavailable':baseStatus,comment,asOf,allSources);
 const metrics=[
   make('cashReceipts',cashReceipts,q.to),make('cashPayments',cashPayments,q.to),
   make('bankReceipts',bankReceipts,q.to),make('bankPayments',bankPayments,q.to),
   make('internalTransferVolume',internalVolume,q.to),
   make('externalNetMovement',externalNet,q.to),
   make('cashBookBalance',cashLedgerBalance,now,'needs-review'),
   make('bankCurrentBalance',bankTotal,now,'needs-review'),
   make('ownerCapitalIn',ownerCapital,q.to),
   make('operatingExpenses',expenseTotal,q.to,'ready')
 ];
 return {ok:true,report:q.report,range:{from:q.from,to:q.to},page:q.page,
   pageSize:q.pageSize,totalRows,rows,metrics,coverage:{status:coverageStatus,reason}};
}
