import type { SherDatabase, SqlPreparedStatement } from '../../db/types.js';
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

// Money is stored to four decimals in the existing finance books.
// Compare in exact 1/10000 units rather than using an arbitrary float tolerance.
function financeTicks(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const amount = Number(value);
  const ticks = Math.round(amount * 10000);
  return Number.isFinite(amount) && Number.isSafeInteger(ticks) &&
    Math.abs(amount * 10000 - ticks) < 0.00001 ? ticks : null;
}

/** Read-only book reconciliation; this is NOT statement/physical-cash verification. */
export async function getBankReconciliationRoute(db: SherDatabase): Promise<Response> {
  const [accountsResult, bookResult] = await Promise.all([
    db.prepare(`SELECT bank_account_id,account_name,account_type,opening_balance,current_balance
                FROM bank_accounts ORDER BY account_name COLLATE NOCASE,bank_account_id`).all<any>(),
    db.prepare(`
      SELECT bank_account_id,
        COUNT(*) AS entries,
        SUM(CASE WHEN type='Opening Balance' THEN 1 ELSE 0 END) AS opening_rows,
        SUM(COALESCE(credit,0)-COALESCE(debit,0)) AS movement,
        SUM(CASE WHEN debit IS NULL OR credit IS NULL
                  OR typeof(debit) NOT IN ('integer','real')
                  OR typeof(credit) NOT IN ('integer','real')
                  OR debit<0 OR credit<0 OR (debit>0 AND credit>0)
                 THEN 1 ELSE 0 END) AS invalid_entries
      FROM bank_book WHERE COALESCE(is_deleted,0)=0
      GROUP BY bank_account_id
    `).all<any>()
  ]);
  const accounts=accountsResult.results||[],books=bookResult.results||[];
  const accountIds=new Set(accounts.map((a:any)=>String(a.bank_account_id)));
  const orphan=books.some((b:any)=>!accountIds.has(String(b.bank_account_id)));
  const overLimit=accounts.length>2000 || books.length>2000;
  const byId=new Map(books.map((b:any)=>[String(b.bank_account_id),b]));
  const list=accounts.map((a:any)=>{
    const b=byId.get(String(a.bank_account_id)) as any;
    const opening=financeTicks(a.opening_balance),recorded=financeTicks(a.current_balance);
    const delta=financeTicks(b?.movement??0);
    const openingRows=Number(b?.opening_rows??0);
    const invalid=Number(b?.invalid_entries??0)>0;
    const expected=opening!==null&&delta!==null
      ? (openingRows>0?0:opening)+delta : null;
    let reason='Bank-book movements agree with the recorded balance; bank statement not checked.';
    if(overLimit)reason='Account safety limit exceeded; book totals require review.';
    else if(orphan)reason='Orphan bank-book posting references a missing account.';
    else if(invalid||opening===null||recorded===null||delta===null)reason='Invalid account or bank-book amount.';
    else if(openingRows>1)reason='Multiple opening balance postings require review.';
    else if(expected===null||!Number.isSafeInteger(expected)||expected!==recorded)
      reason='Recorded balance differs from opening plus bank-book movements.';
    const ready=reason.startsWith('Bank-book movements agree');
    return {
      id:String(a.bank_account_id),name:String(a.account_name),accountType:bankAccountType(a.account_type),
      openingBalance:opening===null?0:opening/10000,
      recordedBalance:recorded===null?0:recorded/10000,
      bookBalance:ready&&expected!==null?expected/10000:null,
      status:ready?'ready':'needs-review',reason
    };
  });
  const incomplete=list.filter(a=>a.status==='needs-review');
  const status=list.length>0&&incomplete.length===0?'ready':'needs-review';
  const reason=orphan?'Orphan bank-book posting references a missing account.':
    overLimit?'Bank account safety limit exceeded.':
    incomplete.length?`${incomplete.length} bank account(s) need book reconciliation.`:
    list.length?'All available internal bank books reconcile. This does not match bank statements.':
    'No bank accounts are configured.';
  return json({ok:true,asOf:new Date().toISOString(),accounts:list,coverage:{status,reason}});
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
  const accountId=cleanText(input.bankAccountId);const a=await db.prepare(`SELECT bank_account_id,account_name,status FROM bank_accounts WHERE bank_account_id=? LIMIT 1`).bind(accountId).first<any>();if(!a)return error('Bank account not found.');if(a.status==='Inactive')return error('That bank account is inactive.');
  let direction=t.direction;if(direction==='either'){direction=cleanText(input.direction) as any;if(direction!=='debit'&&direction!=='credit')return error('Choose whether this adjustment adds to or subtracts from the account.');}
  const date=cleanText(input.date)||todayDate();if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return error('Enter a valid entry date (yyyy-MM-dd).');if(date>todayDate())return error('Entry date cannot be in the future.');const isBackdated=date<todayDate(),backReason=cleanText(input.backdatedReason);if(isBackdated&&!backReason)return error('A reason is required when dating this entry in the past.');
  const description=cleanText(input.description)||t.label;
  if(t.contra==='cash'){
    // Deposit/withdrawal is a single internal transfer: never commit only the bank
    // leg when the cash-book insert fails. Both use the same transaction date.
    const debit=direction==='debit'?amount:0,credit=direction==='credit'?amount:0;
    try{
      await db.batch([
        db.prepare("INSERT INTO bank_book(entry_id,bank_account_id,bank_account_name,date,type,reference,description,debit,credit,balance,notes,status,created_by,created_at,is_backdated,backdated_days,backdated_reason,is_deleted) VALUES (?,?,?,?,?,?,?,?,?,ROUND((SELECT current_balance FROM bank_accounts WHERE bank_account_id=?)+?-?,4),?,'Active',?,datetime('now'),?,?,?,0)")
          .bind(bankId('BB'),accountId,cleanText(a.bank_account_name),date,t.key,accountId,description,debit,credit,accountId,credit,debit,cleanText(input.notes),user.fullName,isBackdated?1:0,isBackdated?dayDiff(date,todayDate()):0,backReason),
        db.prepare("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted,created_at) VALUES (?,?,?,?,?,?,?,'Cash',0,datetime('now'))")
          .bind(bankId('CB'),date,t.key,accountId,description+' — '+accountId,t.key==='Cash Deposit'?amount:0,t.key==='Cash Withdrawal'?amount:0),
        db.prepare('UPDATE bank_accounts SET current_balance=ROUND(current_balance+?-?,4) WHERE bank_account_id=?')
          .bind(credit,debit,accountId)
      ]);
    }catch{return error('Cash and bank books were not posted; please check account funds and retry.',409);}
    const balance=await db.prepare('SELECT current_balance FROM bank_accounts WHERE bank_account_id=?').bind(accountId).first<{current_balance:number}>();
    return json({ok:true,bankAccountId:accountId,newBalance:Number(balance?.current_balance||0)});
  }
  const newBalance=await addBankBookExact(db,accountId,{type:t.key,reference:cleanText(input.reference),description,debit:direction==='debit'?amount:0,credit:direction==='credit'?amount:0,date,notes:cleanText(input.notes),createdBy:user.fullName,isBackdated,backdatedDays:isBackdated?dayDiff(date,todayDate()):0,backdatedReason:backReason});
  return json({ok:true,bankAccountId:accountId,newBalance});
}

export async function reverseBankEntryRoute(db:SherDatabase,entryId:string,reasonRaw:string,user:AuthUser):Promise<Response>{
  if(!(await getOpenCashSession(db)))return error('Start the cash session before reversing a bank entry.');
  const reason=cleanText(reasonRaw);
  if(reason.length<8)return error('Explain the reversal (at least eight characters).');
  const e=await db.prepare("SELECT * FROM bank_book WHERE entry_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1")
    .bind(entryId).first<any>();
  if(!e)return error('Entry not found.',404);
  const manual=BANK_MANUAL_TYPES.find(t=>t.key===cleanText(e.type)&&t.contra===null);
  if(!manual)return error('Reverse this entry from its original transaction, not one bank leg.',409);
  if(cleanText(e.status)==='Reversed'||cleanText(e.reversal_of))
    return error('Entry was already reversed.',409);
  if(await db.prepare('SELECT 1 x FROM bank_book WHERE reversal_of=? LIMIT 1').bind(entryId).first())
    return error('A reversal already exists for this entry.',409);
  const debit=Number(e.debit||0),credit=Number(e.credit||0);
  if(!debit&&!credit)return error('This entry has no amount to reverse.');
  const account=await db.prepare('SELECT account_name,current_balance,status FROM bank_accounts WHERE bank_account_id=? LIMIT 1')
    .bind(e.bank_account_id).first<any>();
  if(!account||account.status!=='Active')return error('Original bank account is unavailable.',409);
  const next=Math.round((Number(account.current_balance)+debit-credit)*10000)/10000;
  if(next<0)return error('Funds have already been spent; cannot reverse this bank receipt.',409);
  try{
    await db.batch([
      db.prepare("INSERT INTO bank_book(entry_id,bank_account_id,bank_account_name,date,type,reference,description,debit,credit,balance,notes,status,reversal_of,created_by,created_at,is_backdated,backdated_days,backdated_reason,is_deleted) VALUES(?,?,?,?,?,?,?,?,?,?,?,'Active',?,?,datetime('now'),0,0,'',0)")
        .bind(bankId('BB'),e.bank_account_id,account.account_name,todayDate(),'Reversal',entryId,
          'Reversal of '+entryId+' — '+reason,credit,debit,next,reason,entryId,user.fullName),
      db.prepare('UPDATE bank_accounts SET current_balance=ROUND(current_balance+?-?,4) WHERE bank_account_id=? AND status=\'Active\'')
        .bind(debit,credit,e.bank_account_id),
      db.prepare("UPDATE bank_book SET status='Reversed' WHERE entry_id=? AND status='Active' AND COALESCE(is_deleted,0)=0")
        .bind(entryId),
      db.prepare("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) VALUES (?,'BANK_REVERSE','BANK_BOOK',?,?)")
        .bind(user.userId,entryId,reason)
    ]);
  }catch{return error('Bank reversal was not committed; original ledger, funds or audit changed.',409);}
  return json({ok:true,entryId});
}


function bankTransferTicks(value: unknown): number | null {
  const amount = Number(value);
  const ticks = Math.round(amount * 10000);
  return value !== null && value !== undefined && Number.isFinite(amount) &&
    Number.isSafeInteger(ticks) && ticks > 0 &&
    Math.abs(amount * 10000 - ticks) < 0.00001 ? ticks : null;
}
function bankRequestId(raw: unknown): string {
  const id = cleanText(raw);
  return /^[A-Za-z0-9._:-]{8,120}$/.test(id) ? id : '';
}
async function lookupBankRequest(db: SherDatabase, requestId: string) {
  return db.prepare('SELECT transfer_id,request_fingerprint FROM bank_transfers WHERE client_request_id=? LIMIT 1')
    .bind(requestId).first<{transfer_id:string;request_fingerprint:string}>();
}
export async function transferBankRoute(db:SherDatabase,input:BankTransferInput,user:AuthUser):Promise<Response>{
  const fromId=cleanText(input.fromAccountId),toId=cleanText(input.toAccountId),requestId=bankRequestId(input.clientRequestId);
  if(!requestId)return error('A valid clientRequestId is required for safe transfer retries.');
  if(!fromId||!toId||fromId===toId)return error('Choose two different bank accounts.');
  const ticks=bankTransferTicks(input.amount);
  if(ticks===null)return error('Enter a positive amount with at most four decimal places.');
  const amount=ticks/10000,notes=cleanText(input.notes),fingerprint=JSON.stringify([fromId,toId,ticks,notes]);
  const existing=await lookupBankRequest(db,requestId);
  if(existing)return existing.request_fingerprint===fingerprint?
    json({ok:true,id:existing.transfer_id,replayed:true}):
    error('Client request ID was already used for different transfer details.',409);
  if(!(await getOpenCashSession(db)))return error('No active cash session. Start your day from POS before recording a bank transfer.');
  const [from,to]=await Promise.all([
    db.prepare('SELECT bank_account_id,account_name,status FROM bank_accounts WHERE bank_account_id=? LIMIT 1').bind(fromId).first<any>(),
    db.prepare('SELECT bank_account_id,account_name,status FROM bank_accounts WHERE bank_account_id=? LIMIT 1').bind(toId).first<any>()
  ]);
  if(!from||!to||from.status!=='Active'||to.status!=='Active')
    return error('Both transfer accounts must exist and be active.');
  const transferId=bankId('BTR'),date=todayDate();
  // DB trigger checks the current source balance within this same atomic D1 batch,
  // not a stale preflight balance. The unique request key prevents double posting.
  try {
    await db.batch([
      db.prepare('INSERT INTO bank_transfers(transfer_id,transfer_date,from_account_id,from_account_name,to_account_id,to_account_name,amount,notes,created_by,created_at,client_request_id,request_fingerprint) VALUES (?,?,?,?,?,?,?,?,?,datetime(\'now\'),?,?)')
        .bind(transferId,date,fromId,String(from.account_name),toId,String(to.account_name),amount,notes,user.fullName,requestId,fingerprint),
      db.prepare('INSERT INTO bank_book(entry_id,bank_account_id,bank_account_name,date,type,reference,description,debit,credit,balance,status,created_by,is_deleted) VALUES (?,?,?,?,\'Transfer Out\',?,?,?,0,ROUND((SELECT current_balance FROM bank_accounts WHERE bank_account_id=?)-?,4),\'Active\',?,0)')
        .bind(bankId('BB'),fromId,String(from.account_name),date,transferId,'Transfer to '+String(to.account_name),amount,fromId,amount,user.fullName),
      db.prepare('INSERT INTO bank_book(entry_id,bank_account_id,bank_account_name,date,type,reference,description,debit,credit,balance,status,created_by,is_deleted) VALUES (?,?,?,?,\'Transfer In\',?,?,0,?,ROUND((SELECT current_balance FROM bank_accounts WHERE bank_account_id=?)+?,4),\'Active\',?,0)')
        .bind(bankId('BB'),toId,String(to.account_name),date,transferId,'Transfer from '+String(from.account_name),amount,toId,amount,user.fullName),
      db.prepare('UPDATE bank_accounts SET current_balance=ROUND(current_balance-?,4) WHERE bank_account_id=?')
        .bind(amount,fromId),
      db.prepare('UPDATE bank_accounts SET current_balance=ROUND(current_balance+?,4) WHERE bank_account_id=?')
        .bind(amount,toId)
    ]);
  } catch {
    const retry=await lookupBankRequest(db,requestId);
    if(retry)return retry.request_fingerprint===fingerprint?
      json({ok:true,id:retry.transfer_id,replayed:true}):
      error('Client request ID was already used for different transfer details.',409);
    return error('Transfer not posted: account balance changed or one ledger entry failed.',409);
  }
  return json({ok:true,id:transferId,replayed:false});
}

export async function reverseBankTransferRoute(db:SherDatabase,transferId:string,reasonRaw:string,user:AuthUser):Promise<Response>{
  const reason=cleanText(reasonRaw);
  if(reason.length<8)return error('Enter a reversal reason (at least eight characters).');
  const t=await db.prepare('SELECT * FROM bank_transfers WHERE transfer_id=? LIMIT 1').bind(transferId).first<any>();
  if(!t)return error('Transfer not found.',404);
  if(cleanText(t.reversed_at))return error('Transfer has already been reversed.',409);
  if(!(await getOpenCashSession(db)))return error('Start a cash session before reversing a transfer.');
  const amount=Number(t.amount);
  if(bankTransferTicks(amount)===null)return error('Transfer amount cannot be reconciled.',409);
  const fromId=String(t.from_account_id),toId=String(t.to_account_id),date=todayDate();
  try {
    await db.batch([
      db.prepare('UPDATE bank_transfers SET reversed_at=datetime(\'now\'),reversed_by=?,reversal_reason=? WHERE transfer_id=? AND reversed_at=\'\'')
        .bind(user.fullName,reason,transferId),
      db.prepare('INSERT INTO bank_book(entry_id,bank_account_id,bank_account_name,date,type,reference,description,debit,credit,balance,status,created_by,is_deleted) VALUES (?,?,?,?,\'Transfer Reversal In\',?,?,0,?,ROUND((SELECT current_balance FROM bank_accounts WHERE bank_account_id=?)+?,4),\'Active\',?,0)')
        .bind(bankId('BB'),fromId,String(t.from_account_name),date,transferId,'Reversal of '+transferId+' — '+reason,amount,fromId,amount,user.fullName),
      db.prepare('INSERT INTO bank_book(entry_id,bank_account_id,bank_account_name,date,type,reference,description,debit,credit,balance,status,created_by,is_deleted) VALUES (?,?,?,?,\'Transfer Reversal Out\',?,?,?,0,ROUND((SELECT current_balance FROM bank_accounts WHERE bank_account_id=?)-?,4),\'Active\',?,0)')
        .bind(bankId('BB'),toId,String(t.to_account_name),date,transferId,'Reversal of '+transferId+' — '+reason,amount,toId,amount,user.fullName),
      db.prepare('UPDATE bank_accounts SET current_balance=ROUND(current_balance+?,4) WHERE bank_account_id=?').bind(amount,fromId),
      db.prepare('UPDATE bank_accounts SET current_balance=ROUND(current_balance-?,4) WHERE bank_account_id=?').bind(amount,toId),
      db.prepare('INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) VALUES (?,?,?,?,?)')
        .bind(user.userId,'BANK_TRANSFER_REVERSE','BANK_TRANSFER',transferId,reason)
    ]);
  } catch {
    return error('Transfer reversal not posted: funds or ledger state changed.',409);
  }
  return json({ok:true,id:transferId,reversed:true});
}

export async function getBankTransfersRoute(db:SherDatabase):Promise<Response>{
  const r=await db.prepare('SELECT * FROM bank_transfers ORDER BY transfer_date DESC,created_at DESC,transfer_id DESC LIMIT 1000').all<any>();
  return json({ok:true,transfers:(r.results||[]).map((t:any)=>({
    transferId:String(t.transfer_id),date:String(t.transfer_date),
    fromAccountId:String(t.from_account_id),fromAccountName:String(t.from_account_name),
    toAccountId:String(t.to_account_id),toAccountName:String(t.to_account_name),
    amount:Number(t.amount||0),notes:String(t.notes||''),createdBy:String(t.created_by||''),
    createdAt:String(t.created_at||''),clientRequestId:String(t.client_request_id||''),
    reversedAt:String(t.reversed_at||''),reversalReason:String(t.reversal_reason||'')
  }))});
}

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
  const exists=await db.prepare(`SELECT person_id,person_type FROM finance_persons WHERE person_id=? LIMIT 1`).bind(id).first<{person_id:string;person_type:string}>();
  if(!exists)return error('Person not found.',404);
  const dup=await db.prepare(`SELECT 1 x FROM finance_persons WHERE lower(person_name)=lower(?) AND person_id<>? LIMIT 1`).bind(name,id).first();
  if(dup)return error('A person with this name already exists.');
  // Past finance rows keep their original displayed name and immutable person ID.
  // The DB trigger also closes the race between this preflight and the UPDATE.
  if(exists.person_type!==type){
    const historical=await db.prepare('SELECT 1 x FROM finance_transactions WHERE person_id=? LIMIT 1').bind(id).first();
    if(historical)return error('Cannot change Owner/Lender classification after a finance transaction exists.',409);
  }
  try{
    await db.prepare(`UPDATE finance_persons SET person_name=?,person_type=?,phone=?,notes=? WHERE person_id=?`)
      .bind(name,type,cleanText(input.phone),cleanText(input.notes),id).run();
  }catch{return error('Finance person classification changed or name is already taken.',409);}
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
// Reversal plans are only prepared if the original source money posting is unambiguous.
// The caller always executes the result in the SAME D1 batch as the finance header and audit.
async function financeReversalPlan(db:SherDatabase,tx:any):Promise<SqlPreparedStatement[]|Response>{
  const type=financeType(cleanText(tx.transaction_type));
  const ticks=bankTransferTicks(tx.amount);
  if(!type||ticks===null)return error('Original financing amount needs reconciliation.',409);
  const id=cleanText(tx.finance_id);
  const [cashR,bankR]=await Promise.all([
    db.prepare("SELECT * FROM cash_book WHERE reference=? AND COALESCE(is_deleted,0)=0").bind(id).all<any>(),
    db.prepare("SELECT * FROM bank_book WHERE reference=? AND COALESCE(is_deleted,0)=0").bind(id).all<any>()
  ]);
  const cash=cashR.results||[],bank=bankR.results||[];
  const source=tx.payment_method==='Cash'?cash:bank;
  if(source.length!==1||(tx.payment_method==='Cash'?bank.length!==0:cash.length!==0))
    return error('Original finance source posting is missing or duplicated.',409);
  const leg=source[0],amount=ticks/10000;
  const debit=type.direction==='out'?amount:0,credit=type.direction==='in'?amount:0;
  if(cleanText(leg.date)!==cleanText(tx.date)||cleanText(leg.type)!==type.key||
     Math.abs(Number(leg.debit)-debit)>0.0000001||Math.abs(Number(leg.credit)-credit)>0.0000001)
    return error('Original finance source amount does not match.',409);
  if(tx.payment_method!=='Cash'&&
     (cleanText(leg.bank_account_id)!==cleanText(tx.bank_account_id)||cleanText(leg.status)!=='Active'))
    return error('Original finance bank source does not match.',409);
  if(tx.payment_method==='Cash'&&cleanText(leg.payment_method)!=='Cash')
    return error('Original finance cash source does not match.',409);
  if(tx.payment_method==='Cash')
    return [db.prepare("UPDATE cash_book SET is_deleted=1 WHERE entry_id=? AND is_deleted=0").bind(leg.entry_id)];
  return [
    db.prepare("UPDATE bank_book SET is_deleted=1,status='Reversed',notes=CASE WHEN notes='' THEN 'Finance entry reversed' ELSE notes||' — Finance entry reversed' END WHERE entry_id=? AND is_deleted=0").bind(leg.entry_id),
    db.prepare("UPDATE bank_accounts SET current_balance=ROUND(current_balance-?,4) WHERE bank_account_id=?")
      .bind(credit-debit,leg.bank_account_id)
  ];
}
function financeSourcePostStatements(db:SherDatabase,id:string,type:FinanceTxType,method:string,bank:any,
  amount:number,personName:string,date:string,user:AuthUser):SqlPreparedStatement[]{
  const debit=type.direction==='out'?amount:0,credit=type.direction==='in'?amount:0,
    desc=type.label+' — '+personName;
  if(method==='Cash')return [
    db.prepare("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted,created_at) VALUES(?,?,?,?,?,?,?,'Cash',0,datetime('now'))")
      .bind(bankId('CB'),date,type.key,id,desc,debit,credit)
  ];
  const accountId=cleanText(bank.bank_account_id);
  return [
    db.prepare("INSERT INTO bank_book(entry_id,bank_account_id,bank_account_name,date,type,reference,description,debit,credit,balance,status,created_by,is_deleted) VALUES(?,?,?,?,?,?,?,?,?,ROUND((SELECT current_balance FROM bank_accounts WHERE bank_account_id=?)+?,4),'Active',?,0)")
      .bind(bankId('BB'),accountId,cleanText(bank.account_name),date,type.key,id,desc,debit,credit,accountId,credit-debit,user.fullName),
    db.prepare("UPDATE bank_accounts SET current_balance=ROUND(current_balance+?,4) WHERE bank_account_id=? AND status='Active'")
      .bind(credit-debit,accountId)
  ];
}

export async function addFinanceTransactionRoute(db:SherDatabase,input:FinanceInput,user:AuthUser):Promise<Response>{
  // A stable client request ID is required: retries must never create two investments or loans.
  const key=bankRequestId(input.clientRequestId);
  if(!key)return error('A valid clientRequestId is required for finance posting.');
  const type=financeType(cleanText(input.transactionType));
  if(!type)return error('Choose a valid transaction type.');
  const amountTicks=bankTransferTicks(input.amount);
  if(amountTicks===null)return error('Enter a positive amount with at most four decimal places.');
  const amount=amountTicks/10000;
  const personId=cleanText(input.personId),person=await resolveFinancePerson(db,personId);
  if(!person)return error('Choose an existing owner or lender.');
  if(cleanText(person.status)!=='Active')return error('Finance person is inactive.');
  if(type.account!==(person.person_type==='Lender'?'loan':'capital'))
    return error('Owner transactions must use an Owner; loan transactions must use a Lender.');
  const method=cleanText(input.paymentMethod);
  if(!FINANCE_PAYMENT_METHODS.includes(method))return error('Choose a valid payment method.');
  let bank:any;
  try{bank=await resolveFinanceBank(db,method,cleanText(input.bankAccountId));}
  catch(e){return error(e instanceof Error?e.message:'Bank account error.');}
  if(method!=='Cash'&&(bank.status!=='Active'||bank.account_type!==method))
    return error('Choose an active account matching the selected payment method.');
  const dv=validateFinanceDate(input);if(dv instanceof Response)return dv;
  const personName=cleanText(person.person_name),accountId=cleanText(bank.bank_account_id),
    reference=cleanText(input.referenceNo),notes=cleanText(input.notes);
  const fingerprint=JSON.stringify([type.key,personId,method,accountId,amountTicks,dv.date,reference,notes,dv.reason]);
  const findRequest=()=>db.prepare("SELECT finance_id,request_fingerprint FROM finance_transactions WHERE client_request_id=? LIMIT 1")
    .bind(key).first<{finance_id:string;request_fingerprint:string}>();
  const already=await findRequest();
  if(already)return already.request_fingerprint===fingerprint?
    json({ok:true,id:already.finance_id,replayed:true}):
    error('Client request ID was already used for a different finance transaction.',409);
  if(!(await getOpenCashSession(db)))return error('Start the POS Cash Session before posting a finance transaction.');
  const id=await nextId(db,'finance_transactions','finance_id','FIN');
  const debit=type.direction==='out'?amount:0,credit=type.direction==='in'?amount:0,delta=credit-debit;
  const description=type.label+' — '+personName;
  const statements=[
    db.prepare("INSERT INTO finance_transactions(finance_id,date,transaction_type,person_id,person_name,payment_method,bank_account_id,bank_account_name,amount,reference_no,notes,created_by,created_at,is_backdated,backdated_days,backdated_reason,is_deleted,client_request_id,request_fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),?,?,?,0,?,?)")
      .bind(id,dv.date,type.key,personId,personName,method,accountId,cleanText(bank.account_name),amount,reference,notes,user.fullName,dv.isBackdated?1:0,dv.backdatedDays,dv.reason,key,fingerprint)
  ];
  if(method==='Cash'){
    statements.push(db.prepare("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted,created_at) VALUES(?,?,?,?,?,?,?,'Cash',0,datetime('now'))")
      .bind(bankId('CB'),dv.date,type.key,id,description,debit,credit));
  }else{
    statements.push(
      db.prepare("INSERT INTO bank_book(entry_id,bank_account_id,bank_account_name,date,type,reference,description,debit,credit,balance,status,created_by,is_deleted) VALUES(?,?,?,?,?,?,?,?,?,ROUND((SELECT current_balance FROM bank_accounts WHERE bank_account_id=?)+?,4),'Active',?,0)")
        .bind(bankId('BB'),accountId,cleanText(bank.account_name),dv.date,type.key,id,description,debit,credit,accountId,delta,user.fullName),
      db.prepare("UPDATE bank_accounts SET current_balance=ROUND(current_balance+?,4) WHERE bank_account_id=? AND status='Active'")
        .bind(delta,accountId)
    );
  }
  try{await db.batch(statements);}
  catch{
    const retried=await findRequest();
    if(retried)return retried.request_fingerprint===fingerprint?
      json({ok:true,id:retried.finance_id,replayed:true}):
      error('Client request ID was already used for a different finance transaction.',409);
    return error('Finance posting was not committed; bank/cash book failed or account changed.',409);
  }
  const balances=await financeBalances(db);
  return json({ok:true,id,replayed:false,...balances});
}

/** Person balances are only shown if every active financing record matches one source-book posting. */
export async function getFinancePersonLedgerRoute(db:SherDatabase,personId:string,url:URL):Promise<Response>{
  const person=await resolveFinancePerson(db,personId);
  if(!person)return error('Finance person not found.',404);
  const sizeRaw=url.searchParams.get('pageSize')||'50';
  if(sizeRaw!=='50'&&sizeRaw!=='100')return error('Choose 50 or 100 rows per page.');
  const pageRaw=url.searchParams.get('page')||'1',page=Number(pageRaw),pageSize=Number(sizeRaw);
  if(!/^[1-9]\d*$/.test(pageRaw)||!Number.isSafeInteger(page))return error('Choose a valid page number.');
  const from=cleanText(url.searchParams.get('dateFrom')),to=cleanText(url.searchParams.get('dateTo'));
  if((from&&!/^\d{4}-\d{2}-\d{2}$/.test(from))||(to&&!/^\d{4}-\d{2}-\d{2}$/.test(to))||(from&&to&&from>to))
    return error('Enter a valid date range.');
  const entries=await db.prepare("SELECT t.*,\n (SELECT COUNT(*) FROM cash_book c WHERE c.reference=t.finance_id AND COALESCE(c.is_deleted,0)=0) cash_count,\n (SELECT COUNT(*) FROM cash_book c WHERE c.reference=t.finance_id AND COALESCE(c.is_deleted,0)=0\n   AND c.date=t.date AND c.type=t.transaction_type AND c.payment_method='Cash'\n   AND ABS(c.credit-(CASE WHEN t.transaction_type IN ('Owner Investment','Opening Owner Capital','Loan Received','Opening Loan') THEN t.amount ELSE 0 END))<0.0000001\n   AND ABS(c.debit-(CASE WHEN t.transaction_type IN ('Owner Withdrawal','Loan Repayment') THEN t.amount ELSE 0 END))<0.0000001) cash_match,\n (SELECT COUNT(*) FROM bank_book b WHERE b.reference=t.finance_id AND COALESCE(b.is_deleted,0)=0) bank_count,\n (SELECT COUNT(*) FROM bank_book b WHERE b.reference=t.finance_id AND COALESCE(b.is_deleted,0)=0\n   AND b.status='Active' AND b.date=t.date AND b.type=t.transaction_type AND b.bank_account_id=t.bank_account_id\n   AND ABS(b.credit-(CASE WHEN t.transaction_type IN ('Owner Investment','Opening Owner Capital','Loan Received','Opening Loan') THEN t.amount ELSE 0 END))<0.0000001\n   AND ABS(b.debit-(CASE WHEN t.transaction_type IN ('Owner Withdrawal','Loan Repayment') THEN t.amount ELSE 0 END))<0.0000001) bank_match\n FROM finance_transactions t WHERE t.person_id=? AND COALESCE(t.is_deleted,0)=0\n ORDER BY t.date ASC,t.finance_id ASC").bind(personId).all<any>();
  const ticks=(value:unknown):number|null=>{
    const v=Number(value),t=Math.round(v*10000);
    return Number.isFinite(v)&&Number.isSafeInteger(t)&&t>0&&Math.abs(v*10000-t)<0.00001?t:null;
  };
  let running=0,unmatched=0;
  const ledger=(entries.results||[]).map((tx:any)=>{
    const type=financeType(cleanText(tx.transaction_type));
    const validKind=type?.account===(person.person_type==='Lender'?'loan':'capital');
    const value=ticks(tx.amount);
    const cash=tx.payment_method==='Cash',bank=tx.payment_method==='Bank'||tx.payment_method==='Mobile Banking';
    const exact=cash?(Number(tx.cash_count)===1&&Number(tx.cash_match)===1&&Number(tx.bank_count)===0):
      bank?(Number(tx.bank_count)===1&&Number(tx.bank_match)===1&&Number(tx.cash_count)===0):false;
    const matched=Boolean(type&&validKind&&value!==null&&exact);
    if(!matched)unmatched++;
    const signed=(type?.direction==='in'?1:-1)*(value||0);
    running+=signed;
    return {
      financeId:cleanText(tx.finance_id),personId,date:cleanText(tx.date),
      transactionType:cleanText(tx.transaction_type),paymentMethod:cleanText(tx.payment_method),
      amount:dbNumber(tx.amount),debit:type?.direction==='out'?dbNumber(tx.amount):0,
      credit:type?.direction==='in'?dbNumber(tx.amount):0,sourceStatus:matched?'matched':'needs-review',
      referenceNo:cleanText(tx.reference_no),notes:cleanText(tx.notes),
      createdBy:cleanText(tx.created_by),createdAt:cleanText(tx.created_at),
      isBackdated:dbBool(tx.is_backdated),backdatedReason:cleanText(tx.backdated_reason),
      balanceTicks:running
    };
  });
  const ready=unmatched===0;
  const range=ledger.filter(x=>(!from||x.date>=from)&&(!to||x.date<=to));
  const prior=ledger.filter(x=>from&&x.date<from);
  const through=ledger.filter(x=>!to||x.date<=to);
  const openingTicks=prior.length?prior[prior.length-1].balanceTicks:0;
  const closingTicks=through.length?through[through.length-1].balanceTicks:0;
  const rows=[...range].reverse().slice((page-1)*pageSize,page*pageSize).map(({balanceTicks,...row})=>({
    ...row,balance:ready?balanceTicks/10000:null
  }));
  return json({
    ok:true,person:{id:cleanText(person.person_id),name:cleanText(person.person_name),type:cleanText(person.person_type),status:cleanText(person.status)},
    balance:ready?running/10000:null,openingBalance:ready?openingTicks/10000:null,
    closingBalance:ready?closingTicks/10000:null,rows,
    totalRows:range.length,totalPages:Math.ceil(range.length/pageSize),page,pageSize,
    dateFrom:from,dateTo:to,
    coverage:{status:ready?'ready':'needs-review',
      reason:ready?'Every finance entry has one matching active cash or bank posting.':
        unmatched+' finance entries have missing, duplicated or mismatched source postings.'}
  });
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
  const old=await db.prepare("SELECT * FROM finance_transactions WHERE finance_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1")
    .bind(id).first<any>();
  if(!old)return error('Transaction not found.',404);
  const type=financeType(cleanText(input.transactionType)),ticks=bankTransferTicks(input.amount);
  if(!type||ticks===null)return error('Choose a valid transaction and positive amount.');
  const personId=cleanText(input.personId),person=await resolveFinancePerson(db,personId);
  if(!person||person.status!=='Active')return error('Choose an active owner or lender.');
  if(type.account!==(person.person_type==='Lender'?'loan':'capital'))
    return error('Owner transactions require an Owner and loan transactions a Lender.');
  const method=cleanText(input.paymentMethod);
  if(!FINANCE_PAYMENT_METHODS.includes(method))return error('Choose a valid payment method.');
  let bank:any;
  try{bank=await resolveFinanceBank(db,method,cleanText(input.bankAccountId));}
  catch(e){return error(e instanceof Error?e.message:'Bank account error.');}
  if(method!=='Cash'&&(bank.status!=='Active'||bank.account_type!==method))
    return error('Choose an active bank/mobile account of the selected type.');
  const date=validateFinanceDate(input);if(date instanceof Response)return date;
  const reversal=await financeReversalPlan(db,old);
  if(reversal instanceof Response)return reversal;
  const amount=ticks/10000,name=cleanText(person.person_name);
  const auditNote='Changed '+cleanText(old.transaction_type)+' '+old.amount+
    ' to '+type.key+' '+amount+'; original bank/cash entry reversed';
  const statements:SqlPreparedStatement[]=[
    ...reversal,
    db.prepare("UPDATE finance_transactions SET date=?,transaction_type=?,person_id=?,person_name=?,payment_method=?,bank_account_id=?,bank_account_name=?,amount=?,reference_no=?,notes=?,is_backdated=?,backdated_days=?,backdated_reason=?,request_fingerprint='edited' WHERE finance_id=? AND is_deleted=0")
      .bind(date.date,type.key,personId,name,method,cleanText(bank.bank_account_id),cleanText(bank.account_name),
        amount,cleanText(input.referenceNo),cleanText(input.notes),date.isBackdated?1:0,date.backdatedDays,date.reason,id),
    ...financeSourcePostStatements(db,id,type,method,bank,amount,name,date.date,user),
    db.prepare("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) VALUES(?,'FINANCE_REVERSE','FINANCE',?,?)")
      .bind(user.userId,id,auditNote)
  ];
  try{await db.batch(statements);}
  catch{return error('Finance update not committed: original source, funds or audit changed.',409);}
  const balances=await financeBalances(db);return json({ok:true,financeId:id,...balances});
}
export async function deleteFinanceTransactionRoute(db:SherDatabase,id:string,reasonRaw:string,user:AuthUser):Promise<Response>{
  if(!(await getOpenCashSession(db)))return error('Start the POS Cash Session before deleting a finance transaction.');
  const reason=cleanText(reasonRaw);
  if(reason.length<8)return error('Enter a reason for cancelling this financing (at least 8 characters).');
  const row=await db.prepare("SELECT * FROM finance_transactions WHERE finance_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1")
    .bind(id).first<any>();
  if(!row)return error('Transaction not found.',404);
  const reversal=await financeReversalPlan(db,row);
  if(reversal instanceof Response)return reversal;
  try{
    await db.batch([
      ...reversal,
      db.prepare("UPDATE finance_transactions SET is_deleted=1,delete_reason=?,deleted_by=?,deleted_at=datetime('now') WHERE finance_id=? AND is_deleted=0")
        .bind(reason,user.fullName,id),
      db.prepare("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) VALUES(?,'FINANCE_REVERSE','FINANCE',?,?)")
        .bind(user.userId,id,reason)
    ]);
  }catch{return error('Finance reversal not committed: original funds or audit changed.',409);}
  const balances=await financeBalances(db);return json({ok:true,financeId:id,...balances});
}

