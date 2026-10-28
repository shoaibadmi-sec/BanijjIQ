import type { SherDatabase, SqlPreparedStatement } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
import type { CustomerInput, CustomerPaymentInput } from './types.js';
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

async function hasActiveCashSession(db: SherDatabase): Promise<boolean> {
  const row = await db.prepare(`SELECT session_id FROM cash_sessions WHERE status='Open' ORDER BY opened_at DESC LIMIT 1`).first<{ session_id: string }>();
  return !!row;
}

function methodNeedsBank(method: string): boolean {
  return method === 'Bank' || method === 'Mobile Banking';
}

async function validateBankAccount(db: SherDatabase, method: string, bankAccountIdRaw?: string): Promise<string> {
  if (!methodNeedsBank(method)) return '';
  const bankAccountId = cleanText(bankAccountIdRaw);
  if (!bankAccountId) throw new Error(method === 'Mobile Banking' ? 'Mobile Banking account is required.' : 'Bank account is required.');
  const row = await db.prepare(`SELECT bank_account_id FROM bank_accounts WHERE bank_account_id=? AND status='Active' LIMIT 1`).bind(bankAccountId).first();
  if (!row) throw new Error('Bank account not found.');
  return bankAccountId;
}

function customerPublic(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(row.customer_id || ''),
    name: String(row.customer_name || ''),
    fatherName: String(row.father_name || ''),
    phone: String(row.phone || ''),
    address: String(row.address || ''),
    openingBalance: money(row.opening_balance),
    currentDue: Number(row.current_due || 0),
    notes: String(row.notes || ''),
    status: String(row.status || 'Active'),
    createdAt: String(row.created_at || '')
  };
}

export async function getCustomersPage(db: SherDatabase): Promise<Response> {
  const [custResult, bankResult, setting] = await Promise.all([
    db.prepare(`SELECT * FROM customers WHERE COALESCE(is_deleted,0)=0 ORDER BY customer_name COLLATE NOCASE`).all(),
    db.prepare(`SELECT bank_account_id AS id, account_name AS name, account_type AS accountType FROM bank_accounts WHERE status='Active' ORDER BY account_name`).all(),
    db.prepare(`SELECT setting_value FROM app_settings WHERE setting_key='Currency Symbol' LIMIT 1`).first<{setting_value:string}>()
  ]);
  return json({ ok:true, customers:(custResult.results??[]).map(r=>customerPublic(r as Record<string,unknown>)), bankAccounts:bankResult.results??[], currencySymbol:setting?.setting_value||'', activeCashSession:await hasActiveCashSession(db) });
}

export async function createCustomer(db: SherDatabase, input: CustomerInput, user: AuthUser): Promise<Response> {
  const name=cleanText(input.name),phone=cleanText(input.phone);if(!name)return error('Customer name is required.');if(!phone)return error('Phone number is required.');
  const dup=await db.prepare(`SELECT customer_id FROM customers WHERE phone=? LIMIT 1`).bind(phone).first();if(dup)return error('A customer with this phone number already exists.',409);
  const opening=Math.max(0,money(input.openingBalance));if(opening>0&&!(await hasActiveCashSession(db)))return error('No active cash session. Start your day from POS before creating a customer with opening balance.');
  const id=`CUS-${crypto.randomUUID().slice(0,8).toUpperCase()}`;const stmts:SqlPreparedStatement[]=[db.prepare(`INSERT INTO customers (customer_id,customer_name,phone,father_name,address,opening_balance,current_due,status,is_deleted,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'Active',0,?,datetime('now'),datetime('now'))`).bind(id,name,phone,cleanText(input.fatherName),cleanText(input.address),opening,opening,cleanText(input.notes))];
  if(opening>0)stmts.push(db.prepare(`INSERT INTO customer_ledger (ledger_id,date,customer_id,customer_name,type,reference,debit,credit,balance,notes,payment_method,created_by,created_at) VALUES (?,date('now'),?,?, 'Opening Balance',?,?,0,?,'','',?,datetime('now'))`).bind(`CL-${crypto.randomUUID().slice(0,10).toUpperCase()}`,id,name,id,opening,opening,user.userId));
  await db.batch(stmts);return json({ok:true,id});
}

export async function updateCustomer(db: SherDatabase, id: string, input: CustomerInput): Promise<Response> {
  const name=cleanText(input.name);if(!name)return error('Customer name is required.');const row=await db.prepare(`SELECT customer_id FROM customers WHERE customer_id=? AND COALESCE(is_deleted,0)=0`).bind(id).first();if(!row)return error('Customer not found.',404);
  await db.prepare(`UPDATE customers SET customer_name=?,father_name=?,phone=?,address=?,notes=?,updated_at=datetime('now') WHERE customer_id=?`).bind(name,cleanText(input.fatherName),cleanText(input.phone),cleanText(input.address),cleanText(input.notes),id).run();
  await db.prepare(`UPDATE customer_ledger SET customer_name=? WHERE customer_id=?`).bind(name,id).run();return json({ok:true,id});
}

export async function getCustomerDetail(db: SherDatabase, id: string, url: URL): Promise<Response> {
  const c=await db.prepare(`SELECT * FROM customers WHERE customer_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(id).first<Record<string,unknown>>();
  if(!c)return error('Customer not found.',404);
  const history=parseLedgerHistory(url);
  const dateWhere=ledgerDateWhere('date',history);
  const rangeSql=`customer_id=? AND COALESCE(is_deleted,0)=0 AND ${dateWhere.sql}`;
  const [rowsResult,rangeAgg,openingRow,printHeader]=await Promise.all([
    db.prepare(`
      WITH ordered AS (
        SELECT ledger_id AS ledgerId,date,customer_id AS customerId,customer_name AS customerName,type,reference,debit,credit,
               SUM(COALESCE(debit,0)-COALESCE(credit,0)) OVER (ORDER BY date ASC,created_at ASC,ledger_id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance,
               notes,payment_method AS paymentMethod,bank_account_id AS bankAccountId,created_at AS createdAt
        FROM customer_ledger
        WHERE customer_id=? AND COALESCE(is_deleted,0)=0
      )
      SELECT * FROM ordered
      WHERE date<=? AND (?='' OR date>=?)
      ORDER BY date DESC,createdAt DESC,ledgerId DESC
      LIMIT ?
    `).bind(id,history.to,history.from,history.from,history.limit).all<any>(),
    db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(debit),0) AS debit,COALESCE(SUM(credit),0) AS credit FROM customer_ledger WHERE ${rangeSql}`)
      .bind(id,...dateWhere.values).first<any>(),
    history.from
      ? db.prepare(`SELECT COALESCE(SUM(debit-credit),0) AS balance FROM customer_ledger WHERE customer_id=? AND COALESCE(is_deleted,0)=0 AND date<?`).bind(id,history.from).first<any>()
      : Promise.resolve({balance:0}),
    getLedgerPrintHeader(db)
  ]);
  const ledger=(rowsResult.results||[]).map((r:any)=>({...r,debit:Number(r.debit||0),credit:Number(r.credit||0),balance:Number(r.balance||0)}));
  const matchingCount=Number(rangeAgg?.count||0),rangeOpeningBalance=Number(openingRow?.balance||0);
  const rangeDebit=Number(rangeAgg?.debit||0),rangeCredit=Number(rangeAgg?.credit||0),rangeClosingBalance=rangeOpeningBalance+rangeDebit-rangeCredit;
  const earliest=ledger.length?ledger[ledger.length-1]:null,latest=ledger.length?ledger[0]:null;
  const displayedOpeningBalance=earliest?Number(earliest.balance||0)-Number(earliest.debit||0)+Number(earliest.credit||0):rangeOpeningBalance;
  const displayedClosingBalance=latest?Number(latest.balance||0):rangeOpeningBalance;
  const totalDebit=ledger.reduce((sum:number,row:any)=>sum+Number(row.debit||0),0),totalCredit=ledger.reduce((sum:number,row:any)=>sum+Number(row.credit||0),0);
  return json({ok:true,detail:{
    customer:customerPublic(c),ledger,
    history:ledgerHistoryMeta(history,matchingCount,ledger.length),
    summary:{rangeOpeningBalance,rangeClosingBalance,displayedOpeningBalance,displayedClosingBalance,totalDebit,totalCredit},
    printHeader
  }});
}

async function recomputeCustomerLedgerBalances(db: SherDatabase, id: string): Promise<number> {
  const rows=await db.prepare(`SELECT ledger_id AS ledgerId,debit,credit FROM customer_ledger WHERE customer_id=? AND COALESCE(is_deleted,0)=0 ORDER BY date ASC,created_at ASC,ledger_id ASC`).bind(id).all();let balance=0;const stmts:SqlPreparedStatement[]=[];for(const r of (rows.results??[]) as any[]){balance=Math.round((balance+money(r.debit)-money(r.credit))*10000)/10000;stmts.push(db.prepare(`UPDATE customer_ledger SET balance=? WHERE ledger_id=?`).bind(balance,r.ledgerId));}stmts.push(db.prepare(`UPDATE customers SET current_due=?,updated_at=datetime('now') WHERE customer_id=?`).bind(balance,id));await db.batch(stmts);return balance;
}

async function writeCustomerPaymentMoney(db: SherDatabase, ledgerId: string, name: string, amount: number, method: string, bankId: string, date: string): Promise<void> {
  if(method==='Cash')await db.prepare(`INSERT INTO cash_book (entry_id,date,type,reference,description,debit,credit,payment_method,created_at) VALUES (?,?,'Customer Payment',?,?,0,?,'Cash',datetime('now'))`).bind(crypto.randomUUID(),date,ledgerId,`Due payment from ${name}`,amount).run();
  else if(methodNeedsBank(method)){await db.prepare(`INSERT INTO bank_book (entry_id,bank_account_id,date,type,reference,description,debit,credit,created_at) VALUES (?,?,?,'Customer Payment',?,?,0,?,datetime('now'))`).bind(crypto.randomUUID(),bankId,date,ledgerId,`Due payment from ${name}`,amount).run();await db.prepare(`UPDATE bank_accounts SET current_balance=current_balance+? WHERE bank_account_id=?`).bind(amount,bankId).run();}
}

async function reverseCustomerPaymentMoney(db: SherDatabase, ledgerId: string): Promise<void> {
  const banks=await db.prepare(`SELECT bank_account_id,credit FROM bank_book WHERE reference=? AND COALESCE(is_deleted,0)=0`).bind(ledgerId).all();const stmts:SqlPreparedStatement[]=[db.prepare(`UPDATE cash_book SET is_deleted=1 WHERE reference=? AND COALESCE(is_deleted,0)=0`).bind(ledgerId),db.prepare(`UPDATE bank_book SET is_deleted=1 WHERE reference=? AND COALESCE(is_deleted,0)=0`).bind(ledgerId)];for(const b of (banks.results??[]) as any[])stmts.push(db.prepare(`UPDATE bank_accounts SET current_balance=current_balance-? WHERE bank_account_id=?`).bind(money(b.credit),String(b.bank_account_id)));await db.batch(stmts);
}

export async function receiveCustomerPayment(db: SherDatabase, id: string, input: CustomerPaymentInput, user: AuthUser): Promise<Response> {
  if(!(await hasActiveCashSession(db)))return error('No active cash session. Start your day from POS before recording customer payments.');const amount=money(input.amount);if(amount<=0)return error('Enter a valid payment amount.');const c=await db.prepare(`SELECT customer_name,current_due FROM customers WHERE customer_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(id).first<any>();if(!c)return error('Customer not found.',404);
  const date=cleanText(input.date)||new Date().toISOString().slice(0,10),today=new Date().toISOString().slice(0,10),back=cleanText(input.backdatedReason);if(date<today&&!back)return error('A reason is required when dating a payment in the past.');const method=cleanText(input.method)||'Cash';let bank='';try{bank=await validateBankAccount(db,method,input.bankAccountId);}catch(e){return error(e instanceof Error?e.message:'Invalid payment method.');}
  const newDue=Math.round((Number(c.current_due||0)-amount)*10000)/10000,ledgerId=`CL-${crypto.randomUUID().slice(0,10).toUpperCase()}`;await db.prepare(`INSERT INTO customer_ledger (ledger_id,date,customer_id,customer_name,type,reference,debit,credit,balance,notes,payment_method,bank_account_id,is_backdated,backdated_days,backdated_reason,created_by,created_at) VALUES (?,?,?,?, 'Payment','PAYMENT',0,?,?,?,?,?,?,?,?,?,datetime('now'))`).bind(ledgerId,date,id,c.customer_name,amount,newDue,cleanText(input.notes),method,bank,date<today?1:0,date<today?1:0,back,user.userId).run();await db.prepare(`UPDATE customers SET current_due=?,updated_at=datetime('now') WHERE customer_id=?`).bind(newDue,id).run();await writeCustomerPaymentMoney(db,ledgerId,c.customer_name,amount,method,bank,date);return json({ok:true,newDue});
}

export async function getCustomerPayment(db: SherDatabase, ledgerId: string): Promise<Response> {
  const r=await db.prepare(`SELECT ledger_id AS ledgerId,customer_id AS customerId,customer_name AS customerName,date,credit AS amount,payment_method AS method,bank_account_id AS bankAccountId,notes,type FROM customer_ledger WHERE ledger_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(ledgerId).first<any>();if(!r)return error('Payment not found.',404);if(r.type!=='Payment')return error('Only payment rows can be edited here.');delete r.type;return json({ok:true,payment:r});
}

export async function updateCustomerPayment(db: SherDatabase, ledgerId: string, input: CustomerPaymentInput, user: AuthUser): Promise<Response> {
  if(!(await hasActiveCashSession(db)))return error('No active cash session. Start your day from POS before editing customer payments.');const r=await db.prepare(`SELECT * FROM customer_ledger WHERE ledger_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(ledgerId).first<any>();if(!r)return error('Payment not found.',404);if(r.type!=='Payment')return error('Only payment rows can be edited.');const amount=money(input.amount);if(amount<=0)return error('Enter a valid payment amount.');const method=cleanText(input.method)||r.payment_method||'Cash';let bank='';try{bank=await validateBankAccount(db,method,input.bankAccountId);}catch(e){return error(e instanceof Error?e.message:'Invalid payment method.');}const date=cleanText(input.date)||r.date;await reverseCustomerPaymentMoney(db,ledgerId);await db.prepare(`UPDATE customer_ledger SET date=?,credit=?,payment_method=?,bank_account_id=?,notes=? WHERE ledger_id=?`).bind(date,amount,method,bank,cleanText(input.notes),ledgerId).run();const due=await recomputeCustomerLedgerBalances(db,r.customer_id);await writeCustomerPaymentMoney(db,ledgerId,r.customer_name,amount,method,bank,date);await db.prepare(`INSERT INTO audit_logs (user_id,action,entity_type,entity_id,note) VALUES (?,'UPDATE_CUSTOMER_PAYMENT','CUSTOMER_LEDGER',?,'Payment edited')`).bind(user.userId,ledgerId).run();return json({ok:true,newDue:due});
}

export async function deleteCustomerPayment(db: SherDatabase, ledgerId: string, reasonRaw: string, user: AuthUser): Promise<Response> {
  const reason=cleanText(reasonRaw);if(!reason)return error('Enter a reason for deleting this payment.');if(!(await hasActiveCashSession(db)))return error('No active cash session. Start your day from POS before deleting customer payments.');const r=await db.prepare(`SELECT * FROM customer_ledger WHERE ledger_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(ledgerId).first<any>();if(!r)return error('Payment not found.',404);if(r.type!=='Payment')return error('Only payment rows can be deleted here.');await reverseCustomerPaymentMoney(db,ledgerId);await db.prepare(`UPDATE customer_ledger SET is_deleted=1,delete_reason=?,deleted_by=?,deleted_at=datetime('now') WHERE ledger_id=?`).bind(reason,user.userId,ledgerId).run();await recomputeCustomerLedgerBalances(db,r.customer_id);return json({ok:true});
}

export async function deleteCustomer(db: SherDatabase, id: string, confirmKeyRaw: string, reasonRaw: string, user: AuthUser): Promise<Response> {
  const c=await db.prepare(`SELECT * FROM customers WHERE customer_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(id).first<any>();if(!c)return error('Customer not found.',404);const due=Number(c.current_due||0);if(Math.abs(due)>0.009)return error(due>0?`This customer still owes ${due}. Settle the due before deleting.`:`This customer holds a store credit of ${Math.abs(due)}. Clear it before deleting.`);const setting=await db.prepare(`SELECT setting_value FROM app_settings WHERE setting_key='Delete Confirmation Key' LIMIT 1`).first<any>();if(!setting?.setting_value)return error('No delete confirmation key is set.');if(cleanText(confirmKeyRaw)!==String(setting.setting_value))return error('Incorrect confirmation key.');await db.batch([db.prepare(`UPDATE customers SET is_deleted=1,delete_reason=?,deleted_by=?,deleted_at=datetime('now'),updated_at=datetime('now') WHERE customer_id=?`).bind(cleanText(reasonRaw)||'Customer deleted via Customers page',user.userId,id),db.prepare(`INSERT INTO audit_logs (user_id,action,entity_type,entity_id,note) VALUES (?,'DELETE_CUSTOMER','CUSTOMER',?,?)`).bind(user.userId,id,cleanText(reasonRaw)||'Customer deleted via Customers page')]);return json({ok:true});
}
