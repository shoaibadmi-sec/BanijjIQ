import type { SherDatabase,SqlPreparedStatement } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
import type { BankAccountInput, BankManualInput, BankTransferInput, FinancePersonInput, FinanceInput, FinanceTxType } from './types.js';
import { getLedgerPrintHeader, ledgerDateWhere, ledgerHistoryMeta, parseLedgerHistory } from '../../core/ledgerHistory.js';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };
function json(data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status, headers: jsonHeaders }); }
function error(message: string, status = 400): Response { return json({ ok: false, error: message }, status); }
function cleanText(value: unknown): string { return String(value ?? '').trim(); }
function money(value: unknown): number { const n = Number(value ?? 0); if (!Number.isFinite(n) || n < 0) return 0; return Math.round(n * 10000) / 10000; }
function todayDate(): string { return new Date().toISOString().slice(0, 10); }
function dayDiff(from: string, to: string): number { const a = new Date(`${from}T00:00:00Z`).getTime(); const b = new Date(`${to}T00:00:00Z`).getTime(); return Math.max(0, Math.floor((b-a)/86400000)); }
async function getOpenCashSession(db: SherDatabase) { return db.prepare(`SELECT * FROM cash_sessions WHERE status='Open' ORDER BY opened_at DESC LIMIT 1`).first<any>(); }
async function nextId(db: SherDatabase, table: string, idColumn: string, prefix: string): Promise<string> { const row = await db.prepare(`SELECT ${idColumn} AS id FROM ${table} WHERE ${idColumn} LIKE ? ORDER BY ${idColumn} DESC LIMIT 1`).bind(`${prefix}-%`).first<{ id: string }>(); const last = row?.id ? Number(row.id.replace(`${prefix}-`, '')) : 0; return `${prefix}-${String(last + 1).padStart(6, '0')}`; }
function dbNumber(value: unknown): number { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; }
function dbBool(value: unknown): boolean { return Number(value ?? 0) !== 0; }

type BankManualType = { key: string; label: string; direction: 'debit' | 'credit' | 'either'; contra: 'cash' | null };

const BANK_MANUAL_TYPES: BankManualType[] = [
  { key: 'Bank Charge', label: 'Bank Charge / Fee', direction: 'debit', contra: null },
  { key: 'Interest Received', label: 'Interest Received', direction: 'credit', contra: null },
  { key: 'Cheque Bounced (Received)', label: 'Cheque Bounced — we received', direction: 'debit', contra: null },
  { key: 'Cheque Bounced (Issued)', label: 'Cheque Bounced — we issued', direction: 'credit', contra: null },
  { key: 'Cash Deposit', label: 'Cash Deposited into Bank', direction: 'credit', contra: 'cash' },
  { key: 'Cash Withdrawal', label: 'Cash Withdrawn from Bank', direction: 'debit', contra: 'cash' },
  { key: 'Bank Adjustment', label: 'Other Adjustment', direction: 'either', contra: null }
];

function bankId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}

function bankAccountType(value: unknown): 'Bank' | 'Mobile Banking' {
  return cleanText(value) === 'Mobile Banking' ? 'Mobile Banking' : 'Bank';
}

async function bankCurrency(db: SherDatabase): Promise<string> {
  const row = await db.prepare(`SELECT setting_value value FROM app_settings WHERE setting_key='Currency Symbol' LIMIT 1`).first<{ value: string }>();
  return String(row?.value || '৳');
}

export async function getBankAccountsRoute(db: SherDatabase): Promise<Response> {
  const rows = await db.prepare(`
    SELECT bank_account_id,account_name,account_type,bank_name,account_number,opening_balance,current_balance,notes,status,created_at
    FROM bank_accounts ORDER BY account_name COLLATE NOCASE
  `).all<any>();
  return json({
    ok: true,
    bankAccounts: (rows.results || []).map((a: any) => ({
      id: String(a.bank_account_id), name: String(a.account_name), accountType: bankAccountType(a.account_type),
      bankName: String(a.bank_name || ''), accountNumber: String(a.account_number || ''),
      openingBalance: Number(a.opening_balance || 0), currentBalance: Number(a.current_balance || 0),
      notes: String(a.notes || ''), status: String(a.status || 'Active'), createdAt: String(a.created_at || '')
    })),
    currencySymbol: await bankCurrency(db)
  });
}

export async function createBankAccountRoute(db: SherDatabase, input: BankAccountInput): Promise<Response> {
  const name = cleanText(input.name);
  if (!name) return error('Account name is required.');
  const dup = await db.prepare(`SELECT 1 x FROM bank_accounts WHERE lower(account_name)=lower(?) LIMIT 1`).bind(name).first();
  if (dup) return error('A bank account with this name already exists.');
  const opening = money(input.openingBalance);
  if (opening > 0 && !(await getOpenCashSession(db))) return error('No active cash session. Start your day from POS before creating an account with an opening balance.');
  const id = bankId('BNK');
  await db.prepare(`
    INSERT INTO bank_accounts(bank_account_id,account_name,bank_name,account_number,opening_balance,current_balance,notes,status,account_type,created_at)
    VALUES (?,?,?,?,?,?,?,'Active',?,datetime('now'))
  `).bind(id,name,cleanText(input.bankName),cleanText(input.accountNumber),opening,opening,cleanText(input.notes),bankAccountType(input.accountType)).run();
  return json({ ok: true, id });
}

export async function updateBankAccountRoute(db: SherDatabase, id: string, input: BankAccountInput): Promise<Response> {
  const row = await db.prepare(`SELECT bank_account_id FROM bank_accounts WHERE bank_account_id=? LIMIT 1`).bind(id).first();
  if (!row) return error('Bank account not found.',404);
  const name = cleanText(input.name);
  if (!name) return error('Account name is required.');
  const dup = await db.prepare(`SELECT 1 x FROM bank_accounts WHERE lower(account_name)=lower(?) AND bank_account_id<>? LIMIT 1`).bind(name,id).first();
  if (dup) return error('A bank account with this name already exists.');
  await db.prepare(`UPDATE bank_accounts SET account_name=?,bank_name=?,account_number=?,notes=?,account_type=? WHERE bank_account_id=?`)
    .bind(name,cleanText(input.bankName),cleanText(input.accountNumber),cleanText(input.notes),bankAccountType(input.accountType),id).run();
  return json({ok:true,id});
}

export async function setBankAccountStatusRoute(db: SherDatabase, id: string, rawStatus: string): Promise<Response> {
  const status = rawStatus === 'Active' ? 'Active' : 'Inactive';
  const r = await db.prepare(`UPDATE bank_accounts SET status=? WHERE bank_account_id=?`).bind(status,id).run();
  if (!r.meta.changes) return error('Bank account not found.',404);
  return json({ok:true,id,status});
}

export async function getBankLedgerBootstrapRoute(db: SherDatabase): Promise<Response> {
  const rows = await db.prepare(`SELECT bank_account_id,account_name,bank_name,current_balance,account_type FROM bank_accounts WHERE status<>'Inactive' ORDER BY account_name COLLATE NOCASE`).all<any>();
  const today=todayDate();
  return json({ok:true,accounts:(rows.results||[]).map((a:any)=>({id:String(a.bank_account_id),name:String(a.account_name),bankName:String(a.bank_name||''),currentBalance:Number(a.current_balance||0),type:bankAccountType(a.account_type)})),entryTypes:BANK_MANUAL_TYPES,currencySymbol:await bankCurrency(db),defaultFrom:'',defaultTo:today,activeCashSession:!!(await getOpenCashSession(db))});
}

export async function getBankLedgerRoute(db: SherDatabase, url: URL): Promise<Response> {
  const accountId=cleanText(url.searchParams.get('bankAccountId'));
  if(!accountId)return error('Choose a bank account.');
  const account=await db.prepare(`SELECT * FROM bank_accounts WHERE bank_account_id=? LIMIT 1`).bind(accountId).first<any>();
  if(!account)return error('Bank account not found.',404);
  const history=parseLedgerHistory(url);
  const hasOpeningRow=!!(await db.prepare(`SELECT 1 x FROM bank_book WHERE bank_account_id=? AND COALESCE(is_deleted,0)=0 AND type='Opening Balance' LIMIT 1`).bind(accountId).first());
  const baseOpening=hasOpeningRow?0:Number(account.opening_balance||0);
  const dateWhere=ledgerDateWhere('date',history);
  const [rowsResult,rangeAgg,beforeAgg,allAgg,printHeader]=await Promise.all([
    db.prepare(`
      WITH ordered AS (
        SELECT entry_id AS entryId,date,type,reference,description,debit,credit,
               (? + SUM(COALESCE(credit,0)-COALESCE(debit,0)) OVER (ORDER BY date ASC,created_at ASC,entry_id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)) AS balance,
               notes,created_by AS createdBy,created_at AS createdAt,status,reversal_of AS reversalOf,is_backdated AS isBackdated,backdated_days AS backdatedDays,backdated_reason AS backdatedReason
        FROM bank_book WHERE bank_account_id=? AND COALESCE(is_deleted,0)=0
      )
      SELECT * FROM ordered WHERE date<=? AND (?='' OR date>=?) ORDER BY date DESC,createdAt DESC,entryId DESC LIMIT ?
    `).bind(baseOpening,accountId,history.to,history.from,history.from,history.limit).all<any>(),
    db.prepare(`SELECT COUNT(*) count,COALESCE(SUM(debit),0) debit,COALESCE(SUM(credit),0) credit FROM bank_book WHERE bank_account_id=? AND COALESCE(is_deleted,0)=0 AND ${dateWhere.sql}`).bind(accountId,...dateWhere.values).first<any>(),
    history.from ? db.prepare(`SELECT COALESCE(SUM(credit-debit),0) delta FROM bank_book WHERE bank_account_id=? AND COALESCE(is_deleted,0)=0 AND date<?`).bind(accountId,history.from).first<any>() : Promise.resolve({delta:0}),
    db.prepare(`SELECT COALESCE(SUM(credit-debit),0) delta FROM bank_book WHERE bank_account_id=? AND COALESCE(is_deleted,0)=0`).bind(accountId).first<any>(),
    getLedgerPrintHeader(db)
  ]);
  const entries=(rowsResult.results||[]).map((r:any)=>({entryId:String(r.entryId),date:String(r.date||'').slice(0,10),type:String(r.type||''),reference:String(r.reference||''),description:String(r.description||''),debit:Number(r.debit||0),credit:Number(r.credit||0),balance:Number(r.balance||0),notes:String(r.notes||''),createdBy:String(r.createdBy||''),createdAt:String(r.createdAt||''),status:String(r.status||'Active'),reversalOf:String(r.reversalOf||''),isBackdated:!!r.isBackdated,backdatedDays:Number(r.backdatedDays||0),backdatedReason:String(r.backdatedReason||'')}));
  const matchingCount=Number(rangeAgg?.count||0),rangeOpeningBalance=baseOpening+Number(beforeAgg?.delta||0),rangeClosingBalance=rangeOpeningBalance+Number(rangeAgg?.credit||0)-Number(rangeAgg?.debit||0);
  const earliest=entries.length?entries[entries.length-1]:null,latest=entries.length?entries[0]:null;
  const displayedOpeningBalance=earliest?Number(earliest.balance)-Number(earliest.credit)+Number(earliest.debit):rangeOpeningBalance;
  const displayedClosingBalance=latest?Number(latest.balance):rangeOpeningBalance;
  const totalDebit=entries.reduce((n:number,r:any)=>n+Number(r.debit||0),0),totalCredit=entries.reduce((n:number,r:any)=>n+Number(r.credit||0),0);
  const currentBalance=Number(account.current_balance||0),computedBalance=baseOpening+Number(allAgg?.delta||0),drift=computedBalance-currentBalance;
  const summary={rangeOpeningBalance,rangeClosingBalance,displayedOpeningBalance,displayedClosingBalance,totalDebit,totalCredit};
  return json({ok:true,account:{id:String(account.bank_account_id),name:String(account.account_name),bankName:String(account.bank_name||''),accountNumber:String(account.account_number||''),openingBalance:Number(account.opening_balance||0),currentBalance},range:{from:history.from,to:history.to},openingBalance:displayedOpeningBalance,closingBalance:displayedClosingBalance,totalDebit,totalCredit,entries,entryCount:entries.length,history:ledgerHistoryMeta(history,matchingCount,entries.length),summary,printHeader,integrity:{computedBalance,storedBalance:currentBalance,drift,balanced:Math.abs(drift)<0.005,hasOpeningRow}});
}

async function addBankBookExact(db:SherDatabase,accountId:string,fields:{type:string;reference?:string;description?:string;debit?:number;credit?:number;date?:string;notes?:string;createdBy?:string;reversalOf?:string;isBackdated?:boolean;backdatedDays?:number;backdatedReason?:string}):Promise<number>{
  const a=await db.prepare(`SELECT account_name,current_balance FROM bank_accounts WHERE bank_account_id=? LIMIT 1`).bind(accountId).first<any>();if(!a)throw new Error('Bank account not found.');
  const debit=Number(fields.debit||0),credit=Number(fields.credit||0),next=Math.round((Number(a.current_balance||0)+credit-debit)*10000)/10000,id=bankId('BB');
  await db.batch([
    db.prepare(`INSERT INTO bank_book(entry_id,bank_account_id,bank_account_name,date,type,reference,description,debit,credit,balance,notes,status,reversal_of,created_by,created_at,is_backdated,backdated_days,backdated_reason,is_deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,'Active',?,?,datetime('now'),?,?,?,0)`).bind(id,accountId,String(a.account_name||''),fields.date||todayDate(),fields.type,cleanText(fields.reference),cleanText(fields.description),debit,credit,next,cleanText(fields.notes),cleanText(fields.reversalOf),cleanText(fields.createdBy),fields.isBackdated?1:0,Number(fields.backdatedDays||0),cleanText(fields.backdatedReason)),
    db.prepare(`UPDATE bank_accounts SET current_balance=? WHERE bank_account_id=?`).bind(next,accountId)
  ]);
  return next;
}

export async function addBankManualEntryRoute(db:SherDatabase,input:BankManualInput,user:AuthUser):Promise<Response>{
  if(!(await getOpenCashSession(db)))return error('No active cash session. Start your day from POS before recording a bank entry.');
  const t=BANK_MANUAL_TYPES.find(x=>x.key===cleanText(input.entryType));if(!t)return error('Choose a valid entry type.');const amount=money(input.amount);if(amount<=0)return error('Enter a valid amount greater than zero.');
  const accountId=cleanText(input.bankAccountId);const a=await db.prepare(`SELECT bank_account_id,status FROM bank_accounts WHERE bank_account_id=? LIMIT 1`).bind(accountId).first<any>();if(!a)return error('Bank account not found.');if(a.status==='Inactive')return error('That bank account is inactive.');
  let direction=t.direction;if(direction==='either'){direction=cleanText(input.direction) as any;if(direction!=='debit'&&direction!=='credit')return error('Choose whether this adjustment adds to or subtracts from the account.');}
  const date=cleanText(input.date)||todayDate();if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return error('Enter a valid entry date (yyyy-MM-dd).');if(date>todayDate())return error('Entry date cannot be in the future.');const isBackdated=date<todayDate(),backReason=cleanText(input.backdatedReason);if(isBackdated&&!backReason)return error('A reason is required when dating this entry in the past.');
  const description=cleanText(input.description)||t.label;const newBalance=await addBankBookExact(db,accountId,{type:t.key,reference:cleanText(input.reference),description,debit:direction==='debit'?amount:0,credit:direction==='credit'?amount:0,date,notes:cleanText(input.notes),createdBy:user.fullName,isBackdated,backdatedDays:isBackdated?dayDiff(date,todayDate()):0,backdatedReason:backReason});
  if(t.contra==='cash')await db.prepare(`INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted,created_at) VALUES (?,?,?,?,?,?,?,'Cash',0,datetime('now'))`).bind(bankId('CB'),todayDate(),t.key,accountId,`${description} — ${accountId}`,t.key==='Cash Deposit'?amount:0,t.key==='Cash Withdrawal'?amount:0).run();
  return json({ok:true,bankAccountId:accountId,newBalance});
}

export async function reverseBankEntryRoute(db:SherDatabase,entryId:string,reasonRaw:string,user:AuthUser):Promise<Response>{
  if(!(await getOpenCashSession(db)))return error('No active cash session. Start your day from POS before reversing a bank entry.');const reason=cleanText(reasonRaw);if(!reason)return error('Enter a reason for reversing this entry.');
  const e=await db.prepare(`SELECT * FROM bank_book WHERE entry_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(entryId).first<any>();if(!e)return error('Entry not found.',404);if(String(e.status||'Active')==='Reversed')return error('This entry has already been reversed.');if(cleanText(e.reversal_of))return error('This entry is itself a reversal and cannot be reversed again.');const exists=await db.prepare(`SELECT 1 x FROM bank_book WHERE reversal_of=? LIMIT 1`).bind(entryId).first();if(exists)return error('A reversal already exists for this entry.');
  const debit=Number(e.debit||0),credit=Number(e.credit||0);if(!debit&&!credit)return error('This entry has no amount to reverse.');
  await addBankBookExact(db,String(e.bank_account_id),{type:'Reversal',reference:entryId,description:`Reversal of ${entryId} — ${reason}`,debit:credit,credit:debit,notes:reason,createdBy:user.fullName,reversalOf:entryId});
  await db.prepare(`UPDATE bank_book SET status='Reversed' WHERE entry_id=?`).bind(entryId).run();return json({ok:true,entryId});
}

export async function transferBankRoute(db:SherDatabase,input:BankTransferInput,user:AuthUser):Promise<Response>{
  if(!(await getOpenCashSession(db)))return error('No active cash session. Start your day from POS before recording a bank transfer.');const fromId=cleanText(input.fromAccountId),toId=cleanText(input.toAccountId);if(!fromId||!toId)return error('Choose both a from and to account.');if(fromId===toId)return error('Choose two different bank accounts.');const amount=money(input.amount);if(amount<=0)return error('Enter a valid transfer amount.');
  const [from,to]=await Promise.all([db.prepare(`SELECT * FROM bank_accounts WHERE bank_account_id=? LIMIT 1`).bind(fromId).first<any>(),db.prepare(`SELECT * FROM bank_accounts WHERE bank_account_id=? LIMIT 1`).bind(toId).first<any>()]);if(!from)return error('From account not found.');if(!to)return error('To account not found.');const transferId=bankId('BTR'),date=todayDate(),fromNext=Math.round((Number(from.current_balance||0)-amount)*10000)/10000,toNext=Math.round((Number(to.current_balance||0)+amount)*10000)/10000;
  await db.batch([
    db.prepare(`INSERT INTO bank_transfers(transfer_id,transfer_date,from_account_id,from_account_name,to_account_id,to_account_name,amount,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`).bind(transferId,date,fromId,String(from.account_name),toId,String(to.account_name),amount,cleanText(input.notes),user.fullName),
    db.prepare(`INSERT INTO bank_book(entry_id,bank_account_id,bank_account_name,date,type,reference,description,debit,credit,balance,status,created_by,is_deleted) VALUES (?,?,?,?, 'Transfer Out',?,?,?,0,?,'Active',?,0)`).bind(bankId('BB'),fromId,String(from.account_name),date,transferId,`Transfer to ${String(to.account_name)}`,amount,fromNext,user.fullName),
    db.prepare(`INSERT INTO bank_book(entry_id,bank_account_id,bank_account_name,date,type,reference,description,debit,credit,balance,status,created_by,is_deleted) VALUES (?,?,?,?, 'Transfer In',?,?,0,?,?,'Active',?,0)`).bind(bankId('BB'),toId,String(to.account_name),date,transferId,`Transfer from ${String(from.account_name)}`,amount,toNext,user.fullName),
    db.prepare(`UPDATE bank_accounts SET current_balance=? WHERE bank_account_id=?`).bind(fromNext,fromId),
    db.prepare(`UPDATE bank_accounts SET current_balance=? WHERE bank_account_id=?`).bind(toNext,toId)
  ]);return json({ok:true,id:transferId});
}

export async function getBankTransfersRoute(db:SherDatabase):Promise<Response>{const r=await db.prepare(`SELECT * FROM bank_transfers ORDER BY transfer_date DESC,created_at DESC`).all<any>();return json({ok:true,transfers:(r.results||[]).map((t:any)=>({transferId:String(t.transfer_id),date:String(t.transfer_date),fromAccountId:String(t.from_account_id),fromAccountName:String(t.from_account_name),toAccountId:String(t.to_account_id),toAccountName:String(t.to_account_name),amount:Number(t.amount||0),notes:String(t.notes||''),createdBy:String(t.created_by||''),createdAt:String(t.created_at||'')}))});}




// -----------------------------------------------------------------------------
// Business Finance / Finance Ledger
// Ported from FinanceModule.gs + finance.html + financeLedger.html
// -----------------------------------------------------------------------------

const FINANCE_TRANSACTION_TYPES: FinanceTxType[] = [
  { key: 'Owner Investment', label: 'Owner Investment', account: 'capital', direction: 'in' },
  { key: 'Owner Withdrawal', label: 'Owner Withdrawal', account: 'capital', direction: 'out' },
  { key: 'Loan Received', label: 'Loan Received', account: 'loan', direction: 'in' },
  { key: 'Loan Repayment', label: 'Loan Repayment', account: 'loan', direction: 'out' },
  { key: 'Opening Owner Capital', label: 'Opening Owner Capital', account: 'capital', direction: 'in' },
  { key: 'Opening Loan', label: 'Opening Loan', account: 'loan', direction: 'in' }
];
const FINANCE_PAYMENT_METHODS = ['Cash', 'Bank', 'Mobile Banking'];
export function financeType(key: string): FinanceTxType | undefined { return FINANCE_TRANSACTION_TYPES.find(t => t.key === key); }

export async function financeBalances(db: SherDatabase): Promise<{ ownerCapital: number; outstandingLoan: number }> {
  const r=await db.prepare(`
    SELECT
      COALESCE(SUM(CASE
        WHEN transaction_type IN ('Owner Investment','Opening Owner Capital') THEN amount
        WHEN transaction_type='Owner Withdrawal' THEN -amount ELSE 0 END),0) ownerCapital,
      COALESCE(SUM(CASE
        WHEN transaction_type IN ('Loan Received','Opening Loan') THEN amount
        WHEN transaction_type='Loan Repayment' THEN -amount ELSE 0 END),0) outstandingLoan
    FROM finance_transactions WHERE COALESCE(is_deleted,0)=0
  `).first<any>();
  return {ownerCapital:Math.round(Number(r?.ownerCapital||0)*10000)/10000,outstandingLoan:Math.round(Number(r?.outstandingLoan||0)*10000)/10000};
}

export async function getFinanceBootstrapRoute(db: SherDatabase): Promise<Response> {
  const [peopleR, bankR, balances, settingsR, session] = await Promise.all([
    db.prepare(`SELECT person_id,person_name,person_type,phone,notes,status FROM finance_persons ORDER BY person_type,person_name COLLATE NOCASE`).all<any>(),
    db.prepare(`SELECT bank_account_id,account_name,account_type,current_balance,status FROM bank_accounts ORDER BY account_name COLLATE NOCASE`).all<any>(),
    financeBalances(db),
    db.prepare(`SELECT setting_value FROM app_settings WHERE setting_key='Currency Symbol' LIMIT 1`).first<{setting_value:string}>(),
    getOpenCashSession(db)
  ]);
  const all = (peopleR.results || []).map((p:any)=>({id:cleanText(p.person_id),name:cleanText(p.person_name),type:cleanText(p.person_type)==='Lender'?'Lender':'Owner',phone:cleanText(p.phone),notes:cleanText(p.notes),status:cleanText(p.status)==='Inactive'?'Inactive':'Active'}));
  const bankAccounts=(bankR.results||[]).filter((a:any)=>cleanText(a.status)!=='Inactive').map((a:any)=>({id:cleanText(a.bank_account_id),name:cleanText(a.account_name),type:cleanText(a.account_type)==='Mobile Banking'?'Mobile Banking':'Bank',currentBalance:dbNumber(a.current_balance)}));
  return json({ok:true,transactionTypes:FINANCE_TRANSACTION_TYPES.map(t=>({key:t.key,label:t.label,direction:t.direction,account:t.account})),paymentMethods:FINANCE_PAYMENT_METHODS,bankAccounts,persons:all.filter((p:any)=>p.status==='Active'),personsAll:all,...balances,currencySymbol:settingsR?.setting_value||'৳',today:todayDate(),activeCashSession:!!session});
}

export async function addFinancePersonRoute(db:SherDatabase,input:FinancePersonInput):Promise<Response>{
  const name=cleanText(input.name); if(!name)return error('Person name is required.');
  const type=input.personType==='Lender'?'Lender':input.personType==='Owner'?'Owner':''; if(!type)return error('Choose Owner or Lender.');
  const dup=await db.prepare(`SELECT 1 x FROM finance_persons WHERE lower(person_name)=lower(?) LIMIT 1`).bind(name).first(); if(dup)return error('A person with this name already exists.');
  const id=await nextId(db,'finance_persons','person_id','FPER');
  await db.prepare(`INSERT INTO finance_persons(person_id,person_name,person_type,phone,notes,status,created_at) VALUES(?,?,?,?,?,'Active',datetime('now'))`).bind(id,name,type,cleanText(input.phone),cleanText(input.notes)).run();
  return json({ok:true,id});
}
export async function setFinancePersonStatusRoute(db:SherDatabase,id:string,status:string):Promise<Response>{
  const value=status==='Active'?'Active':'Inactive'; const r=await db.prepare(`UPDATE finance_persons SET status=? WHERE person_id=?`).bind(value,id).run();
  if(!r.meta.changes)return error('Person not found.',404); return json({ok:true,id,status:value});
}
export async function updateFinancePersonRoute(db:SherDatabase,id:string,input:FinancePersonInput):Promise<Response>{
  const name=cleanText(input.name); if(!name)return error('Person name is required.');
  const type=input.personType==='Lender'?'Lender':input.personType==='Owner'?'Owner':''; if(!type)return error('Choose Owner or Lender.');
  const exists=await db.prepare(`SELECT person_id FROM finance_persons WHERE person_id=? LIMIT 1`).bind(id).first<any>();
  if(!exists)return error('Person not found.',404);
  const dup=await db.prepare(`SELECT 1 x FROM finance_persons WHERE lower(person_name)=lower(?) AND person_id<>? LIMIT 1`).bind(name,id).first();
  if(dup)return error('A person with this name already exists.');
  await db.batch([
    db.prepare(`UPDATE finance_persons SET person_name=?,person_type=?,phone=?,notes=? WHERE person_id=?`).bind(name,type,cleanText(input.phone),cleanText(input.notes),id),
    db.prepare(`UPDATE finance_transactions SET person_name=? WHERE person_id=?`).bind(name,id)
  ]);
  return json({ok:true,id,name,personType:type,notes:cleanText(input.notes)});
}

async function resolveFinancePerson(db:SherDatabase,id:string):Promise<any>{
  return db.prepare(`SELECT person_id,person_name,person_type,status FROM finance_persons WHERE person_id=? LIMIT 1`).bind(id).first<any>();
}
async function resolveFinanceBank(db:SherDatabase,method:string,id:string):Promise<any>{
  if(method==='Cash')return {bank_account_id:'',account_name:''};
  if(!id)throw new Error(method==='Mobile Banking'?'Choose the mobile banking account.':'Choose the bank account.');
  const row=await db.prepare(`SELECT bank_account_id,account_name,status,account_type FROM bank_accounts WHERE bank_account_id=? LIMIT 1`).bind(id).first<any>();
  if(!row)throw new Error('Bank account not found.');
  return row;
}
function validateFinanceDate(input:FinanceInput):{date:string;isBackdated:boolean;backdatedDays:number;reason:string}|Response{
  const date=cleanText(input.date)||todayDate(); if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return error('Enter a valid date.');
  if(date>todayDate())return error('Transaction date cannot be in the future.');
  const isBackdated=date<todayDate(), reason=cleanText(input.backdatedReason); if(isBackdated&&!reason)return error('A reason is required when dating a finance entry in the past.');
  return {date,isBackdated,backdatedDays:isBackdated?dayDiff(date,todayDate()):0,reason};
}
async function postFinanceMoney(db:SherDatabase,financeId:string,type:FinanceTxType,method:string,bank:any,amount:number,personName:string,date:string,user:AuthUser,back?:{isBackdated:boolean;backdatedDays:number;reason:string}):Promise<void>{
  const description=`${type.label}${personName?` — ${personName}`:''}`;
  if(method==='Cash'){
    await db.prepare(`INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted,created_at) VALUES(?,?,?,?,?,?,?,?,0,datetime('now'))`)
      .bind(bankId('CB'),date,type.key,financeId,description,type.direction==='out'?amount:0,type.direction==='in'?amount:0,'Cash').run();
  }else{
    await addBankBookExact(db,cleanText(bank.bank_account_id),{type:type.key,reference:financeId,description,debit:type.direction==='out'?amount:0,credit:type.direction==='in'?amount:0,date,createdBy:user.fullName,isBackdated:!!back?.isBackdated,backdatedDays:back?.backdatedDays||0,backdatedReason:back?.reason||''});
  }
}
async function financeReversalStatements(db:SherDatabase,financeId:string,
 user:AuthUser,reason:string,source:any):Promise<SqlPreparedStatement[]>{
 const [cash,bank]=await Promise.all([
   db.prepare("SELECT entry_id,type,payment_method,debit,credit FROM cash_book WHERE reference=? AND COALESCE(is_deleted,0)=0")
     .bind(financeId).all<any>(),
   db.prepare("SELECT entry_id,type,bank_account_id,debit,credit FROM bank_book WHERE reference=? AND COALESCE(is_deleted,0)=0")
     .bind(financeId).all<any>()
 ]);
 const original=[...(cash.results||[]),...(bank.results||[])];
 const sourceType=financeType(cleanText(source.transaction_type)),sourceAmount=money(source.amount);
 const cashSource=cleanText(source.payment_method)==='Cash',entry=original[0];
 if(!sourceType||sourceAmount<=0||original.length!==1||
   (cashSource?cash.results.length!==1:bank.results.length!==1)||
   cleanText(entry.type)!==sourceType.key||
   Number(entry.debit)!==(sourceType.direction==='out'?sourceAmount:0)||
   Number(entry.credit)!==(sourceType.direction==='in'?sourceAmount:0)||
   (cashSource?cleanText(entry.payment_method)!=='Cash':
     cleanText(entry.bank_account_id)!==cleanText(source.bank_account_id)))
   throw new Error('Finance original money posting is missing or unreconciled.');
 const batch:SqlPreparedStatement[]=[];
 for(const entry of cash.results||[])
   batch.push(db.prepare("UPDATE cash_book SET is_deleted=1 WHERE entry_id=? AND COALESCE(is_deleted,0)=0")
     .bind(entry.entry_id));
 for(const entry of bank.results||[]){
   const account=await db.prepare('SELECT bank_account_id FROM bank_accounts WHERE bank_account_id=?')
     .bind(entry.bank_account_id).first();
   if(!account)throw new Error('Finance source bank account is missing.');
   batch.push(db.prepare("UPDATE bank_accounts SET current_balance=ROUND(current_balance-?,4) WHERE bank_account_id=?")
     .bind(Number(entry.credit)-Number(entry.debit),entry.bank_account_id));
   batch.push(db.prepare("UPDATE bank_book SET is_deleted=1,status='Reversed',notes=CASE WHEN notes='' THEN ? ELSE notes||' — '||? END WHERE entry_id=? AND COALESCE(is_deleted,0)=0")
     .bind(reason,reason,entry.entry_id));
 }
 batch.push(db.prepare("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) VALUES(?,?,?,?,?)")
   .bind(user.userId,'FINANCE_REVERSE','FINANCE',financeId,reason));
 return batch;
}

function financePostingStatements(db:SherDatabase,financeId:string,type:FinanceTxType,
 method:string,bank:any,amount:number,personName:string,date:string,user:AuthUser,
 back:{isBackdated:boolean;backdatedDays:number;reason:string}):SqlPreparedStatement[]{
 const description=`${type.label}${personName?` — ${personName}`:''}`;
 const debit=type.direction==='out'?amount:0,credit=type.direction==='in'?amount:0;
 if(method==='Cash')return [db.prepare("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted,created_at) VALUES(?,?,?,?,?,?,?,?,0,datetime('now'))")
   .bind(bankId('CB'),date,type.key,financeId,description,debit,credit,'Cash')];
 const accountId=cleanText(bank.bank_account_id);
 return [
   db.prepare("UPDATE bank_accounts SET current_balance=ROUND(current_balance+?,4) WHERE bank_account_id=?")
     .bind(credit-debit,accountId),
   db.prepare("INSERT INTO bank_book(entry_id,bank_account_id,bank_account_name,date,type,reference,description,debit,credit,balance,notes,status,reversal_of,created_by,created_at,is_backdated,backdated_days,backdated_reason,is_deleted) VALUES (?,?,?,?,?,?,?,?,?,(SELECT current_balance FROM bank_accounts WHERE bank_account_id=?),'','Active','',?,datetime('now'),?,?,?,0)")
     .bind(bankId('BB'),accountId,cleanText(bank.account_name),date,type.key,
       financeId,description,debit,credit,accountId,user.fullName,back.isBackdated?1:0,
       back.backdatedDays,back.reason)
 ];
}

export async function addFinanceTransactionRoute(db:SherDatabase,input:FinanceInput,user:AuthUser):Promise<Response>{
  if(!(await getOpenCashSession(db)))return error('Start the POS Cash Session before posting a finance transaction.');
  const type=financeType(cleanText(input.transactionType)); if(!type)return error('Choose a valid transaction type.');
  const amount=money(input.amount); if(!(amount>0))return error('Enter a valid amount.');
  const personId=cleanText(input.personId); if(!personId)return error('Choose the owner or lender.'); const person=await resolveFinancePerson(db,personId); if(!person)return error('Person not found.');
  const method=FINANCE_PAYMENT_METHODS.includes(cleanText(input.paymentMethod))?cleanText(input.paymentMethod):''; if(!method)return error('Choose a valid payment method.');
  let bank:any; try{bank=await resolveFinanceBank(db,method,cleanText(input.bankAccountId));}catch(e){return error(e instanceof Error?e.message:'Bank account error.');}
  const dv=validateFinanceDate(input); if(dv instanceof Response)return dv;
  const id=await nextId(db,'finance_transactions','finance_id','FIN');
  await db.prepare(`INSERT INTO finance_transactions(finance_id,date,transaction_type,person_id,person_name,payment_method,bank_account_id,bank_account_name,amount,reference_no,notes,created_by,created_at,is_backdated,backdated_days,backdated_reason,is_deleted) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),?,?,?,0)`)
    .bind(id,dv.date,type.key,personId,cleanText(person.person_name),method,cleanText(bank.bank_account_id),cleanText(bank.account_name),amount,cleanText(input.referenceNo),cleanText(input.notes),user.fullName,dv.isBackdated?1:0,dv.backdatedDays,dv.reason).run();
  await postFinanceMoney(db,id,type,method,bank,amount,cleanText(person.person_name),dv.date,user,dv);
  const balances=await financeBalances(db); return json({ok:true,id,...balances});
}

export async function getFinanceLedgerRoute(db:SherDatabase,url:URL):Promise<Response>{
  const history=parseLedgerHistory(url,{from:'dateFrom',to:'dateTo'});
  const typeF=cleanText(url.searchParams.get('transactionType')),personF=cleanText(url.searchParams.get('personId')),q=cleanText(url.searchParams.get('query')).toLowerCase();
  const filterParts=[`date<=?`,`(?='' OR date>=?)`];
  const filterValues:any[]=[history.to,history.from,history.from];
  if(typeF){filterParts.push(`transaction_type=?`);filterValues.push(typeF);}
  if(personF){filterParts.push(`person_id=?`);filterValues.push(personF);}
  if(q){filterParts.push(`LOWER(COALESCE(finance_id,'')||' '||COALESCE(person_name,'')||' '||COALESCE(reference_no,'')||' '||COALESCE(notes,'')||' '||COALESCE(transaction_type,'')) LIKE ?`);filterValues.push(`%${q}%`);}
  const filterSql=filterParts.join(' AND ');
  const [rowsResult,countRow,rangeAgg,beforeAgg,balances,setting,printHeader]=await Promise.all([
    db.prepare(`
      WITH shaped AS (
        SELECT *,
          CASE WHEN transaction_type IN ('Owner Investment','Opening Owner Capital') THEN amount WHEN transaction_type='Owner Withdrawal' THEN -amount ELSE 0 END AS capital_delta,
          CASE WHEN transaction_type IN ('Loan Received','Opening Loan') THEN amount WHEN transaction_type='Loan Repayment' THEN -amount ELSE 0 END AS loan_delta,
          CASE WHEN transaction_type IN ('Owner Investment','Owner Withdrawal','Opening Owner Capital') THEN 'capital' WHEN transaction_type IN ('Loan Received','Loan Repayment','Opening Loan') THEN 'loan' ELSE '' END AS account_kind,
          CASE WHEN transaction_type IN ('Owner Withdrawal','Loan Repayment') THEN amount ELSE 0 END AS debit_value,
          CASE WHEN transaction_type IN ('Owner Investment','Opening Owner Capital','Loan Received','Opening Loan') THEN amount ELSE 0 END AS credit_value
        FROM finance_transactions WHERE COALESCE(is_deleted,0)=0
      ), ordered AS (
        SELECT *,
          SUM(capital_delta) OVER (ORDER BY date ASC,finance_id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS capital_balance,
          SUM(loan_delta) OVER (ORDER BY date ASC,finance_id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS loan_balance
        FROM shaped
      )
      SELECT * FROM ordered WHERE ${filterSql} ORDER BY date DESC,finance_id DESC LIMIT ?
    `).bind(...filterValues,history.limit).all<any>(),
    db.prepare(`SELECT COUNT(*) count FROM finance_transactions WHERE COALESCE(is_deleted,0)=0 AND ${filterSql}`).bind(...filterValues).first<any>(),
    db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN transaction_type IN ('Owner Investment','Opening Owner Capital') THEN amount WHEN transaction_type='Owner Withdrawal' THEN -amount ELSE 0 END),0) capitalDelta,
        COALESCE(SUM(CASE WHEN transaction_type IN ('Loan Received','Opening Loan') THEN amount WHEN transaction_type='Loan Repayment' THEN -amount ELSE 0 END),0) loanDelta
      FROM finance_transactions WHERE COALESCE(is_deleted,0)=0 AND ${filterSql}
    `).bind(...filterValues).first<any>(),
    history.from ? db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN transaction_type IN ('Owner Investment','Opening Owner Capital') THEN amount WHEN transaction_type='Owner Withdrawal' THEN -amount ELSE 0 END),0) capital,
        COALESCE(SUM(CASE WHEN transaction_type IN ('Loan Received','Opening Loan') THEN amount WHEN transaction_type='Loan Repayment' THEN -amount ELSE 0 END),0) loan
      FROM finance_transactions WHERE COALESCE(is_deleted,0)=0 AND date<?
    `).bind(history.from).first<any>() : Promise.resolve({capital:0,loan:0}),
    financeBalances(db),
    db.prepare(`SELECT setting_value FROM app_settings WHERE setting_key='Currency Symbol' LIMIT 1`).first<{setting_value:string}>(),
    getLedgerPrintHeader(db)
  ]);
  const rows=(rowsResult.results||[]).map((f:any)=>{
    const t=financeType(cleanText(f.transaction_type));const amount=dbNumber(f.amount),account=t?.account||'';
    return {financeId:cleanText(f.finance_id),date:cleanText(f.date).slice(0,10),transactionType:cleanText(f.transaction_type),transactionTypeLabel:t?.label||cleanText(f.transaction_type),account,personId:cleanText(f.person_id),person:cleanText(f.person_name),paymentMethod:cleanText(f.payment_method)||'Cash',bankAccountId:cleanText(f.bank_account_id),bankAccountName:cleanText(f.bank_account_name),amount,debit:dbNumber(f.debit_value),credit:dbNumber(f.credit_value),balance:Math.round(dbNumber(account==='capital'?f.capital_balance:f.loan_balance)*10000)/10000,referenceNo:cleanText(f.reference_no),notes:cleanText(f.notes),createdBy:cleanText(f.created_by),createdAt:cleanText(f.created_at),isBackdated:dbBool(f.is_backdated),backdatedDays:dbNumber(f.backdated_days),backdatedReason:cleanText(f.backdated_reason)};
  });
  const summaryFor=(account:'capital'|'loan',rangeOpening:number,rangeDelta:number)=>{
    const subset=rows.filter((r:any)=>r.account===account),earliest=subset.length?subset[subset.length-1]:null,latest=subset.length?subset[0]:null;
    return{openingBalance:earliest?Number(earliest.balance)-Number(earliest.credit)+Number(earliest.debit):rangeOpening,closingBalance:latest?Number(latest.balance):rangeOpening,totalDebit:subset.reduce((n:number,r:any)=>n+Number(r.debit||0),0),totalCredit:subset.reduce((n:number,r:any)=>n+Number(r.credit||0),0),rangeClosingBalance:rangeOpening+rangeDelta};
  };
  const capitalOpening=Number(beforeAgg?.capital||0),loanOpening=Number(beforeAgg?.loan||0);
  const capitalSummary=summaryFor('capital',capitalOpening,Number(rangeAgg?.capitalDelta||0));
  const loanSummary=summaryFor('loan',loanOpening,Number(rangeAgg?.loanDelta||0));
  return json({ok:true,rows,ownerCapital:balances.ownerCapital,outstandingLoan:balances.outstandingLoan,transactionTypes:FINANCE_TRANSACTION_TYPES.map(t=>({key:t.key,label:t.label,direction:t.direction,account:t.account})),currencySymbol:setting?.setting_value||'৳',history:ledgerHistoryMeta(history,Number(countRow?.count||0),rows.length),capitalSummary,loanSummary,printHeader});
}

export async function getFinanceTransactionRoute(db:SherDatabase,id:string):Promise<Response>{
  const f=await db.prepare(`SELECT * FROM finance_transactions WHERE finance_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(id).first<any>(); if(!f)return error('Transaction not found.',404);
  return json({ok:true,transaction:{financeId:id,date:cleanText(f.date).slice(0,10),transactionType:cleanText(f.transaction_type),personId:cleanText(f.person_id),paymentMethod:cleanText(f.payment_method),bankAccountId:cleanText(f.bank_account_id),amount:dbNumber(f.amount),referenceNo:cleanText(f.reference_no),notes:cleanText(f.notes),backdatedReason:cleanText(f.backdated_reason)}});
}
export async function updateFinanceTransactionRoute(db:SherDatabase,id:string,input:FinanceInput,user:AuthUser):Promise<Response>{
  if(!(await getOpenCashSession(db)))return error('Start the POS Cash Session before editing a finance transaction.');
  const old=await db.prepare(`SELECT * FROM finance_transactions WHERE finance_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(id).first<any>(); if(!old)return error('Transaction not found.',404);
  const type=financeType(cleanText(input.transactionType)); if(!type)return error('Choose a valid transaction type.'); const amount=money(input.amount); if(!(amount>0))return error('Enter a valid amount.');
  const personId=cleanText(input.personId); const person=await resolveFinancePerson(db,personId); if(!person)return error('Person not found.'); const method=FINANCE_PAYMENT_METHODS.includes(cleanText(input.paymentMethod))?cleanText(input.paymentMethod):''; if(!method)return error('Choose a valid payment method.');
  let bank:any;try{bank=await resolveFinanceBank(db,method,cleanText(input.bankAccountId));}catch(e){return error(e instanceof Error?e.message:'Bank account error.');} const dv=validateFinanceDate(input);if(dv instanceof Response)return dv;
  const reverse=await financeReversalStatements(db,id,user,'Finance entry edited',old);
  await db.batch([
    ...reverse,
    db.prepare(`UPDATE finance_transactions SET date=?,transaction_type=?,person_id=?,person_name=?,payment_method=?,bank_account_id=?,bank_account_name=?,amount=?,reference_no=?,notes=?,is_backdated=?,backdated_days=?,backdated_reason=? WHERE finance_id=? AND COALESCE(is_deleted,0)=0`)
      .bind(dv.date,type.key,personId,cleanText(person.person_name),method,
        cleanText(bank.bank_account_id),cleanText(bank.account_name),amount,
        cleanText(input.referenceNo),cleanText(input.notes),dv.isBackdated?1:0,
        dv.backdatedDays,dv.reason,id),
    ...financePostingStatements(db,id,type,method,bank,amount,
      cleanText(person.person_name),dv.date,user,dv)
  ]);
  const balances=await financeBalances(db);return json({ok:true,financeId:id,...balances});
}
export async function deleteFinanceTransactionRoute(db:SherDatabase,id:string,reason:string,user:AuthUser):Promise<Response>{
  if(!(await getOpenCashSession(db)))return error('Start the POS Cash Session before deleting a finance transaction.'); if(!reason)return error('Enter a reason for deleting this transaction.');
  const row=await db.prepare(`SELECT * FROM finance_transactions WHERE finance_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(id).first();if(!row)return error('Transaction not found.',404);
  const reverse=await financeReversalStatements(db,id,user,reason,row);
  await db.batch([
    ...reverse,
    db.prepare(`UPDATE finance_transactions SET is_deleted=1,delete_reason=?,deleted_by=?,deleted_at=datetime('now') WHERE finance_id=? AND COALESCE(is_deleted,0)=0`)
      .bind(reason,user.fullName,id)
  ]);
  const balances=await financeBalances(db);return json({ok:true,financeId:id,...balances});
}

