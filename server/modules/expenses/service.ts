import type { SherDatabase, SqlPreparedStatement } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
import type { ExpenseInput } from './types.js';
import { getLedgerPrintHeader, ledgerDateWhere, ledgerHistoryMeta, parseLedgerHistory } from '../../core/ledgerHistory.js';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type, authorization'
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function error(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function money(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 10000) / 10000;
}

function todayDate(): string { return new Date().toISOString().slice(0, 10); }
async function getOpenCashSession(db: SherDatabase) { return db.prepare(`SELECT * FROM cash_sessions WHERE status='Open' ORDER BY opened_at DESC LIMIT 1`).first<any>(); }

function expenseId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}

function dayDiff(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.max(0, Math.floor((b - a) / 86400000));
}

async function expenseBankAccount(db: SherDatabase, method: string, rawId: unknown): Promise<{ id: string; name: string }> {
  if (method !== 'Bank' && method !== 'Mobile Banking') return { id: '', name: '' };
  const id = cleanText(rawId);
  if (!id) throw new Error(method === 'Mobile Banking' ? 'Select a mobile banking account.' : 'Select a bank account.');
  const row = await db.prepare(`SELECT bank_account_id, account_name, account_type FROM bank_accounts WHERE bank_account_id=? AND status='Active' LIMIT 1`).bind(id).first<any>();
  if (!row || row.account_type !== method) throw new Error('Choose an active account matching the payment method.');
  return { id, name: cleanText(row.account_name) };
}

export async function getExpenseBootstrapRoute(db: SherDatabase): Promise<Response> {
  const [cats, payees, banks, setting, session] = await Promise.all([
    db.prepare(`SELECT category_id id,category_name name,description,status FROM expense_categories WHERE status='Active' ORDER BY category_name COLLATE NOCASE`).all<any>(),
    db.prepare(`SELECT payee_id id,payee_name name,phone,address,notes,status,0 transactionCount,0 totalPaid FROM expense_payees WHERE status='Active' ORDER BY payee_name COLLATE NOCASE`).all<any>(),
    db.prepare(`SELECT bank_account_id id,account_name name,account_type accountType FROM bank_accounts WHERE status='Active' ORDER BY account_name COLLATE NOCASE`).all<any>(),
    db.prepare(`SELECT setting_value FROM app_settings WHERE setting_key='Currency Symbol' LIMIT 1`).first<any>(),
    getOpenCashSession(db)
  ]);
  return json({ ok:true, categories:cats.results??[], payees:payees.results??[], bankAccounts:banks.results??[], paymentMethods:['Cash','Bank','Mobile Banking','Other'], currencySymbol:setting?.setting_value||'৳', activeCashSession:!!session });
}

export async function getExpenseCategoriesRoute(db: SherDatabase): Promise<Response> {
  const rows = await db.prepare(`SELECT category_id id,category_name name,description,status FROM expense_categories ORDER BY category_name COLLATE NOCASE`).all<any>();
  return json({ ok:true, categories:rows.results??[] });
}

export async function createExpenseCategoryRoute(db: SherDatabase, input: any): Promise<Response> {
  const name=cleanText(input.name), description=cleanText(input.description);
  if(!name)return error('Category name is required.');
  const dup=await db.prepare(`SELECT 1 x FROM expense_categories WHERE lower(category_name)=lower(?) LIMIT 1`).bind(name).first();
  if(dup)return error('A category with this name already exists.');
  const id=expenseId('EXC');
  await db.prepare(`INSERT INTO expense_categories(category_id,category_name,description,status) VALUES (?,?,?,'Active')`).bind(id,name,description).run();
  return json({ok:true,id});
}

export async function updateExpenseCategoryRoute(db:SherDatabase,id:string,input:any):Promise<Response>{
  const row=await db.prepare(`SELECT 1 x FROM expense_categories WHERE category_id=? LIMIT 1`).bind(id).first();if(!row)return error('Category not found.',404);
  const name=cleanText(input.name),description=cleanText(input.description);if(!name)return error('Category name is required.');
  const dup=await db.prepare(`SELECT 1 x FROM expense_categories WHERE lower(category_name)=lower(?) AND category_id<>? LIMIT 1`).bind(name,id).first();if(dup)return error('A category with this name already exists.');
  await db.prepare(`UPDATE expense_categories SET category_name=?,description=? WHERE category_id=?`).bind(name,description,id).run();
  return json({ok:true,id});
}

export async function setExpenseCategoryStatusRoute(db:SherDatabase,id:string,statusRaw:string):Promise<Response>{
  const status=statusRaw==='Active'?'Active':'Inactive';const r=await db.prepare(`UPDATE expense_categories SET status=? WHERE category_id=?`).bind(status,id).run();
  if(!r.meta.changes)return error('Category not found.',404);return json({ok:true,id,status});
}

export async function getExpensePayeesRoute(db:SherDatabase):Promise<Response>{
  const rows=await db.prepare(`SELECT p.payee_id id,p.payee_name name,p.phone,p.address,p.notes,p.status,
    SUM(CASE WHEN e.status='Active' AND COALESCE(e.is_deleted,0)=0 THEN 1 ELSE 0 END) transactionCount,
    COALESCE(SUM(CASE WHEN e.status='Active' AND COALESCE(e.is_deleted,0)=0 THEN e.amount ELSE 0 END),0) totalPaid
    FROM expense_payees p LEFT JOIN expenses e ON e.ledger_id=p.payee_id
    GROUP BY p.payee_id,p.payee_name,p.phone,p.address,p.notes,p.status ORDER BY p.payee_name COLLATE NOCASE`).all<any>();
  return json({ok:true,payees:(rows.results??[]).map((r:any)=>({...r,transactionCount:Number(r.transactionCount||0),totalPaid:Number(r.totalPaid||0)}))});
}

export async function createExpensePayeeRoute(db:SherDatabase,input:any):Promise<Response>{
  const name=cleanText(input.name),phone=cleanText(input.phone),address=cleanText(input.address),notes=cleanText(input.notes);if(!name)return error('Payee name is required.');
  const dup=await db.prepare(`SELECT payee_id FROM expense_payees WHERE lower(payee_name)=lower(?) AND COALESCE(phone,'')=COALESCE(?, '') LIMIT 1`).bind(name,phone).first<any>();
  if(dup)return error('A payee with the same name and phone already exists.');
  const id=expenseId('PAY');await db.prepare(`INSERT INTO expense_payees(payee_id,payee_name,phone,address,notes,status) VALUES (?,?,?,?,?,'Active')`).bind(id,name,phone,address,notes).run();return json({ok:true,id});
}

export async function updateExpensePayeeRoute(db:SherDatabase,id:string,input:any):Promise<Response>{
  const old=await db.prepare(`SELECT payee_id FROM expense_payees WHERE payee_id=? LIMIT 1`).bind(id).first<any>();if(!old)return error('Payee not found.',404);
  const name=cleanText(input.name),phone=cleanText(input.phone),address=cleanText(input.address),notes=cleanText(input.notes);if(!name)return error('Payee name is required.');
  const dup=await db.prepare(`SELECT payee_id FROM expense_payees WHERE lower(payee_name)=lower(?) AND COALESCE(phone,'')=COALESCE(?, '') AND payee_id<>? LIMIT 1`).bind(name,phone,id).first<any>();if(dup)return error('A payee with the same name and phone already exists.');
  await db.batch([db.prepare(`UPDATE expense_payees SET payee_name=?,phone=?,address=?,notes=?,updated_at=datetime('now') WHERE payee_id=?`).bind(name,phone,address,notes,id),db.prepare(`UPDATE expenses SET ledger_name=? WHERE ledger_id=?`).bind(name,id)]);return json({ok:true,id});
}

export async function setExpensePayeeStatusRoute(db:SherDatabase,id:string,statusRaw:string):Promise<Response>{
  const status=statusRaw==='Active'?'Active':'Inactive';const r=await db.prepare(`UPDATE expense_payees SET status=?,updated_at=datetime('now') WHERE payee_id=?`).bind(status,id).run();if(!r.meta.changes)return error('Payee not found.',404);return json({ok:true,id,status});
}

async function resolveExpensePayee(db:SherDatabase,rawId:unknown,allowInactiveId=''):Promise<{id:string;name:string}>{
  const id=cleanText(rawId);if(!id)return {id:'',name:''};const row=await db.prepare(`SELECT payee_id,payee_name,status FROM expense_payees WHERE payee_id=? LIMIT 1`).bind(id).first<any>();if(!row)throw new Error('Payee not found.');if(row.status!=='Active'&&id!==allowInactiveId)throw new Error('This payee is inactive.');return {id:String(row.payee_id),name:String(row.payee_name)};
}

export async function getExpensePayeeLedgerRoute(db:SherDatabase,id:string,url:URL):Promise<Response>{
  const payee=await db.prepare(`SELECT payee_id AS id,payee_name AS name,phone,address,notes,status,created_at AS createdAt FROM expense_payees WHERE payee_id=? LIMIT 1`).bind(id).first<any>();
  if(!payee)return error('Payee not found.',404);
  const history=parseLedgerHistory(url);
  const dateWhere=ledgerDateWhere('expense_date',history);
  const [rowsResult,rangeAgg,allAgg,printHeader]=await Promise.all([
    db.prepare(`
      WITH ordered AS (
        SELECT expense_id AS expenseId,expense_date AS date,created_at AS createdAt,category_name AS category,description,payment_method AS paymentMethod,amount,status,
               CASE WHEN status='Active' THEN amount ELSE 0 END AS netAmount,
               SUM(CASE WHEN status='Active' THEN amount ELSE 0 END) OVER (ORDER BY expense_date ASC,created_at ASC,expense_id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS runningPaid
        FROM expenses WHERE ledger_id=? AND COALESCE(is_deleted,0)=0
      )
      SELECT * FROM ordered WHERE date<=? AND (?='' OR date>=?) ORDER BY date DESC,createdAt DESC,expenseId DESC LIMIT ?
    `).bind(id,history.to,history.from,history.from,history.limit).all<any>(),
    db.prepare(`SELECT COUNT(*) count,COALESCE(SUM(CASE WHEN status='Active' THEN amount ELSE 0 END),0) paid FROM expenses WHERE ledger_id=? AND COALESCE(is_deleted,0)=0 AND ${dateWhere.sql}`).bind(id,...dateWhere.values).first<any>(),
    db.prepare(`SELECT COUNT(CASE WHEN status='Active' THEN 1 END) activeCount,COALESCE(SUM(CASE WHEN status='Active' THEN amount ELSE 0 END),0) paid FROM expenses WHERE ledger_id=? AND COALESCE(is_deleted,0)=0`).bind(id).first<any>(),
    getLedgerPrintHeader(db)
  ]);
  const ledger=(rowsResult.results||[]).map((r:any)=>({expenseId:String(r.expenseId),date:String(r.date||'').slice(0,10),createdAt:String(r.createdAt||''),category:String(r.category||''),description:String(r.description||''),paymentMethod:String(r.paymentMethod||''),amount:Number(r.amount||0),netAmount:Number(r.netAmount||0),runningPaid:Number(r.runningPaid||0),status:String(r.status||'Active')}));
  const cumulativePaid=Number(allAgg?.paid||0),transactionCount=Number(allAgg?.activeCount||0),periodPaid=ledger.reduce((n:number,r:any)=>n+Number(r.netAmount||0),0),matchingCount=Number(rangeAgg?.count||0);
  return json({ok:true,payee:{...payee,transactionCount,totalPaid:cumulativePaid},ledger,totalPaid:cumulativePaid,transactionCount,periodPaid,cumulativePaid,history:ledgerHistoryMeta(history,matchingCount,ledger.length),printHeader});
}

function mapExpenseRow(r:any){return {expenseId:String(r.expense_id),date:String(r.expense_date),categoryId:String(r.category_id),category:String(r.category_name),payeeId:String(r.ledger_id||''),payeeName:String(r.ledger_name||''),amount:Number(r.amount||0),paymentMethod:String(r.payment_method||''),bankAccountId:String(r.bank_account_id||''),bankAccountName:String(r.bank_account_name||''),description:String(r.description||''),referenceNo:String(r.reference_no||''),notes:String(r.notes||''),status:String(r.status||'Active'),isBackdated:!!r.is_backdated,backdatedDays:Number(r.backdated_days||0),backdatedReason:String(r.backdated_reason||''),createdBy:String(r.created_by||''),createdAt:String(r.created_at||'')};}

export async function getExpensesRoute(db:SherDatabase):Promise<Response>{
  const rows=await db.prepare(`SELECT * FROM expenses WHERE COALESCE(is_deleted,0)=0 ORDER BY expense_date DESC,created_at DESC`).all<any>();return json({ok:true,expenses:(rows.results??[]).map(mapExpenseRow)});
}

export async function getExpenseDetailRoute(db:SherDatabase,id:string):Promise<Response>{const r=await db.prepare(`SELECT * FROM expenses WHERE expense_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(id).first<any>();if(!r)return error('Expense not found.',404);return json({ok:true,expense:mapExpenseRow(r)});}

function expenseAmount(raw:unknown):number|null {
  const n=Number(raw),ticks=Math.round(n*10000);
  return raw==null||raw===''||!Number.isFinite(n)||!Number.isSafeInteger(ticks)||ticks<=0||
    Math.abs(n*10000-ticks)>0.00001 ? null : ticks/10000;
}
function expenseMoneySteps(db:SherDatabase,id:string,date:string,category:string,description:string,
  amount:number,method:string,bank:{id:string;name:string},type='Expense'):SqlPreparedStatement[]{
  const desc=category+(description?' — '+description:'');
  if(method==='Cash')return [db.prepare("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES (?,?,?,?,?,?,0,'Cash',0)")
    .bind(expenseId('CB'),date,type,id,desc,amount)];
  if(method==='Bank'||method==='Mobile Banking')return [
    db.prepare("INSERT INTO bank_book(entry_id,bank_account_id,date,type,reference,description,debit,credit,is_deleted) VALUES (?,?,?,?,?,?,?,0,0)")
      .bind(expenseId('BB'),bank.id,date,type,id,desc,amount),
    db.prepare('UPDATE bank_accounts SET current_balance=ROUND(current_balance-?,4) WHERE bank_account_id=? AND status=\'Active\'')
      .bind(amount,bank.id)
  ];
  return [];
}
function expenseDeltaSteps(db:SherDatabase,id:string,delta:number,method:'Cash'|'Bank',
  bankId=''):SqlPreparedStatement[]{
  if(!delta)return [];
  if(method==='Cash')return [db.prepare("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES (?,?,'Expense Update',?,?,?,?,'Cash',0)")
    .bind(expenseId('CB'),todayDate(),id,'Expense correction '+id,delta>0?delta:0,delta<0?-delta:0)];
  return [
    db.prepare("INSERT INTO bank_book(entry_id,bank_account_id,date,type,reference,description,debit,credit,is_deleted) VALUES (?,?,?,'Expense Update',?,?,?,?,0)")
      .bind(expenseId('BB'),bankId,todayDate(),id,'Expense correction '+id,delta>0?delta:0,delta<0?-delta:0),
    db.prepare("UPDATE bank_accounts SET current_balance=ROUND(current_balance-?,4) WHERE bank_account_id=?")
      .bind(delta,bankId)
  ];
}

export async function addExpenseRoute(db:SherDatabase,input:ExpenseInput,user:AuthUser):Promise<Response>{
  if(!(await getOpenCashSession(db)))return error('No active cash session. Start your day from POS before recording an expense.');
  const amount=expenseAmount(input.amount);
  if(amount===null)return error('Enter a valid positive expense amount (up to four decimals).');
  const categoryId=cleanText(input.categoryId);
  if(!categoryId)return error('Choose an expense category.');
  const cat=await db.prepare("SELECT category_name,status FROM expense_categories WHERE category_id=? LIMIT 1").bind(categoryId).first<any>();
  if(!cat||cat.status!=='Active')return error('Choose an active expense category.');
  const method=cleanText(input.paymentMethod);
  if(!['Cash','Bank','Mobile Banking','Other'].includes(method))return error('Choose a valid payment method.');
  let bank:{id:string;name:string};
  try{bank=await expenseBankAccount(db,method,input.bankAccountId);}catch(e){return error(e instanceof Error?e.message:'Invalid bank account.');}
  const date=cleanText(input.date)||todayDate(),reason=cleanText(input.backdatedReason);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))return error('Enter a valid expense date.');
  const isBackdated=date<todayDate();if(isBackdated&&!reason)return error('A reason is required when dating an expense in the past.');
  let payee:{id:string;name:string};
  try{payee=await resolveExpensePayee(db,input.payeeId);}catch(e){return error(e instanceof Error?e.message:'Invalid payee.');}
  const description=cleanText(input.description),referenceNo=cleanText(input.referenceNo),
    notes=cleanText(input.notes),days=isBackdated?dayDiff(date,todayDate()):0;
  const key=cleanText(input.clientRequestId);
  if(key&&!/^[A-Za-z0-9._:-]{8,120}$/.test(key))return error('Invalid client request ID.');
  const fingerprint=JSON.stringify([date,categoryId,payee.id,Math.round(amount*10000),method,bank.id,description,referenceNo,notes,reason]);
  const find=()=>db.prepare('SELECT expense_id,request_fingerprint,status FROM expenses WHERE client_request_id=? LIMIT 1')
    .bind(key).first<{expense_id:string;request_fingerprint:string;status:string}>();
  if(key){
    const existing=await find();
    if(existing)return existing.request_fingerprint===fingerprint&&existing.status==='Active'?
      json({ok:true,id:existing.expense_id,replayed:true}):
      error('Client request ID was already used for another expense.',409);
  }
  const id=expenseId('EXP');
  try{await db.batch([
    db.prepare("INSERT INTO expenses(expense_id,expense_date,category_id,category_name,ledger_id,ledger_name,amount,payment_method,description,reference_no,notes,status,created_by,bank_account_id,bank_account_name,is_backdated,backdated_days,backdated_reason,client_request_id,request_fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,'Active',?,?,?,?,?,?,?,?)")
      .bind(id,date,categoryId,cat.category_name,payee.id,payee.name,amount,method,description,referenceNo,notes,user.fullName,bank.id,bank.name,isBackdated?1:0,days,reason,key,fingerprint),
    ...expenseMoneySteps(db,id,date,cat.category_name,description,amount,method,bank)
  ]);}catch{
    const existing=key?await find():null;
    if(existing)return existing.request_fingerprint===fingerprint&&existing.status==='Active'?
      json({ok:true,id:existing.expense_id,replayed:true}):
      error('Client request ID was already used for another expense.',409);
    return error('Expense and money posting were not committed.',409);
  }
  return json({ok:true,id,replayed:false});
}

export async function updateExpenseRoute(db:SherDatabase,id:string,input:ExpenseInput):Promise<Response>{
  if(!(await getOpenCashSession(db)))return error('Start the cash session before editing an expense.');
  const old=await db.prepare("SELECT * FROM expenses WHERE expense_id=? AND COALESCE(is_deleted,0)=0 AND status='Active' LIMIT 1").bind(id).first<any>();
  if(!old)return error('Active expense not found.',404);
  const amount=expenseAmount(input.amount);if(amount===null)return error('Enter a valid expense amount.');
  const categoryId=cleanText(input.categoryId);
  const cat=await db.prepare("SELECT category_name,status FROM expense_categories WHERE category_id=? LIMIT 1").bind(categoryId).first<any>();
  if(!cat||cat.status!=='Active')return error('Choose an active expense category.');
  const method=cleanText(input.paymentMethod);
  if(!['Cash','Bank','Mobile Banking','Other'].includes(method))return error('Choose a valid payment method.');
  let bank:{id:string;name:string};
  try{bank=await expenseBankAccount(db,method,input.bankAccountId);}catch(e){return error(e instanceof Error?e.message:'Invalid bank account.');}
  let payee:{id:string;name:string};
  try{payee=await resolveExpensePayee(db,input.payeeId,String(old.ledger_id||''));}
  catch(e){return error(e instanceof Error?e.message:'Invalid payee.');}
  const date=cleanText(input.date)||String(old.expense_date),reason=cleanText(input.backdatedReason);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))return error('Enter a valid expense date.');
  const backdated=date<todayDate();
  if(backdated&&!reason)return error('A reason is required for backdating.');
  const oldCash=old.payment_method==='Cash'?Number(old.amount):0,
    newCash=method==='Cash'?amount:0,
    oldBankId=['Bank','Mobile Banking'].includes(old.payment_method)?String(old.bank_account_id||''):'',
    newBankId=['Bank','Mobile Banking'].includes(method)?bank.id:'';
  const statements:SqlPreparedStatement[]=[
    db.prepare("UPDATE expenses SET expense_date=?,category_id=?,category_name=?,ledger_id=?,ledger_name=?,amount=?,payment_method=?,description=?,reference_no=?,notes=?,bank_account_id=?,bank_account_name=?,is_backdated=?,backdated_days=?,backdated_reason=?,request_fingerprint='edited' WHERE expense_id=? AND status='Active'")
      .bind(date,categoryId,cat.category_name,payee.id,payee.name,amount,method,cleanText(input.description),cleanText(input.referenceNo),cleanText(input.notes),
        bank.id,bank.name,backdated?1:0,backdated?dayDiff(date,todayDate()):0,reason,id),
    ...expenseDeltaSteps(db,id,newCash-oldCash,'Cash')
  ];
  if(oldBankId===newBankId){
    if(newBankId)statements.push(...expenseDeltaSteps(db,id,amount-Number(old.amount),'Bank',newBankId));
  }else{
    if(oldBankId)statements.push(...expenseDeltaSteps(db,id,-Number(old.amount),'Bank',oldBankId));
    if(newBankId)statements.push(...expenseDeltaSteps(db,id,amount,'Bank',newBankId));
  }
  try{await db.batch(statements);}catch{return error('Expense correction was not committed.',409);}
  return json({ok:true,id});
}

export async function cancelExpenseRoute(db:SherDatabase,id:string,reasonRaw:string,user:AuthUser):Promise<Response>{
  if(!(await getOpenCashSession(db)))return error('Start the cash session before cancelling an expense.');
  const reason=cleanText(reasonRaw);
  if(reason.length<8)return error('Enter an explanation for cancellation (at least eight characters).');
  const old=await db.prepare("SELECT * FROM expenses WHERE expense_id=? AND COALESCE(is_deleted,0)=0 AND status='Active' LIMIT 1").bind(id).first<any>();
  if(!old)return error('Active expense not found.',404);
  const amount=Number(old.amount),statements:SqlPreparedStatement[]=[
    db.prepare("UPDATE expenses SET status='Cancelled',is_deleted=1,deleted_by=?,deleted_at=datetime('now'),delete_reason=? WHERE expense_id=? AND status='Active' AND COALESCE(is_deleted,0)=0")
      .bind(user.fullName,reason,id)
  ];
  if(old.payment_method==='Cash'){
    statements.push(db.prepare("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES (?,?,'Expense Deleted',?,'Reversal for cancelled expense',0,?,'Cash',0)")
      .bind(expenseId('CB'),todayDate(),id,amount));
  }else if(['Bank','Mobile Banking'].includes(old.payment_method)&&old.bank_account_id){
    statements.push(db.prepare("INSERT INTO bank_book(entry_id,bank_account_id,date,type,reference,description,debit,credit,is_deleted) VALUES (?,?,?,'Expense Deleted',?,'Reversal for cancelled expense',0,?,0)")
      .bind(expenseId('BB'),old.bank_account_id,todayDate(),id,amount));
    statements.push(db.prepare('UPDATE bank_accounts SET current_balance=ROUND(current_balance+?,4) WHERE bank_account_id=?')
      .bind(amount,old.bank_account_id));
  }
  statements.push(db.prepare("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) VALUES (?,'DELETE_EXPENSE','EXPENSE',?,?)")
    .bind(user.userId,id,reason));
  try{await db.batch(statements);}catch{return error('Expense cancellation was not committed.',409);}
  return json({ok:true,id});
}
