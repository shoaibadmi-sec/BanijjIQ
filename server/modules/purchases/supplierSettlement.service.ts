import type {SherDatabase,SqlPreparedStatement} from '../../db/types.js';
import type {AuthUser} from '../auth/types.js';

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{'content-type':'application/json; charset=utf-8'}});
const error=(message:string,status=400)=>json({ok:false,error:message},status);
const clean=(v:unknown)=>String(v??'').trim();
const round4=(n:number)=>Math.round(n*10000)/10000;
export type SettleInput={clientRequestId?:string;amount?:number;method?:string;
 bankAccountId?:string;notes?:string;date?:string;backdatedReason?:string};
type Supplier={supplier_name:string;current_due:number;status:string};
type Settlement={settlement_id:string;request_id:string;payload_json:string;
 supplier_id:string;supplier_name:string;ledger_id:string;amount:number;method:string;
 bank_account_id:string;due_before:number;due_after:number;date:string;status:string;
 reversal_ledger_id:string};
async function currentBalance(db:SherDatabase,supplierId:string){
 const r=await db.prepare(`SELECT COALESCE(SUM(debit-credit),0) as due
 FROM supplier_ledger WHERE supplier_id=? AND COALESCE(is_deleted,0)=0`)
 .bind(supplierId).first<{due:number}>();
 return Number(r?.due||0);
}
function receipt(s:Settlement,idempotent=false){
 return json({ok:true,settlementId:s.settlement_id,ledgerId:s.ledger_id,
  amount:Number(s.amount),newDue:Number(s.due_after),method:s.method,
  bankAccountId:s.bank_account_id,idempotent});
}
const dateOk=(x:string)=>/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x+'T00:00:00Z'))&&
 new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
export async function createSupplierSettlement(db:SherDatabase,supplierId:string,
 input:SettleInput,user:AuthUser,requireClientId=true):Promise<Response>{
 const clientRequestId=clean(input.clientRequestId)||(requireClientId?'':crypto.randomUUID());
 if(!/^[0-9a-f-]{32,36}$/i.test(clientRequestId))
  return error('A valid unique payment request ID is required.');
 const amount=input.amount;
 if(typeof amount!=='number'||!Number.isFinite(amount)||amount<=0||amount>1000000000||
    Math.abs(amount*10000-Math.round(amount*10000))>0.000001)
  return error('Enter a positive payment with up to four decimals.');
 const method=clean(input.method)||'Cash';
 if(!['Cash','Bank','Mobile Banking'].includes(method))return error('Invalid supplier payment method.');
 const bankId=method==='Cash'?'':clean(input.bankAccountId);
 if(method!=='Cash'&&!bankId)return error('Select an active bank/mobile account.');
 const date=clean(input.date)||new Date().toISOString().slice(0,10);
 const today=new Date().toISOString().slice(0,10);
 if(!dateOk(date)||date>today)return error('Invalid or future payment date.');
 if(date<today&&!clean(input.backdatedReason))return error('Backdated payment reason is required.');
 const notes=clean(input.notes);
 const canonical=JSON.stringify({supplierId,amount,method,bankId,date,notes,backdatedReason:clean(input.backdatedReason)});
 const lookup=()=>db.prepare('SELECT * FROM supplier_settlement_entries WHERE request_id=?')
  .bind(clientRequestId).first<Settlement>();
 const prior=await lookup();
 if(prior)return prior.payload_json===canonical?receipt(prior,true)
  :error('The payment request ID was already used for different details.',409);
 const session=await db.prepare(`SELECT session_id FROM cash_sessions WHERE status='Open'
  ORDER BY opened_at DESC LIMIT 1`).first();
 if(!session)return error('Open a cash session before paying suppliers.',409);
 const supplier=await db.prepare(`SELECT supplier_name,current_due,status
  FROM suppliers WHERE supplier_id=? AND is_deleted=0`)
  .bind(supplierId).first<Supplier>();
 if(!supplier||supplier.status!=='Active')return error('Active supplier not found.',404);
 const due=Number(supplier.current_due);
 if(!Number.isFinite(due)||due<0||Math.abs(due-await currentBalance(db,supplierId))>0.0001)
  return error('Supplier master/ledger mismatch. Reconcile before payment.',409);
 if(amount>due+0.000001)return error('Supplier payment exceeds payable balance.',409);
 let bankName='',bankBalance=0;
 if(method!=='Cash'){
  const bank=await db.prepare(`SELECT account_name,current_balance
    FROM bank_accounts WHERE bank_account_id=? AND status='Active'`)
    .bind(bankId).first<{account_name:string;current_balance:number}>();
  if(!bank)return error('Active payment account not found.',409);
  bankBalance=Number(bank.current_balance);
  if(bankBalance<amount)return error('Insufficient bank/mobile account balance.',409);
  bankName=bank.account_name;
 }
 const ledgerId=crypto.randomUUID(),settlementId='SST-'+crypto.randomUUID();
 const newDue=round4(due-amount);
 const batch:SqlPreparedStatement[]=[
  db.prepare(`INSERT INTO supplier_settlement_entries
   (settlement_id,request_id,payload_json,supplier_id,supplier_name,
    ledger_id,amount,method,bank_account_id,due_before,due_after,date,created_by)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
   .bind(settlementId,clientRequestId,canonical,supplierId,supplier.supplier_name,
    ledgerId,amount,method,bankId,due,newDue,date,user.userId),
  db.prepare(`UPDATE suppliers SET current_due=current_due-?,updated_at=datetime('now')
    WHERE supplier_id=?`).bind(amount,supplierId),
  db.prepare(`INSERT INTO supplier_ledger
   (ledger_id,date,supplier_id,supplier_name,type,reference,debit,credit,balance,notes,
    payment_method,bank_account_id,is_backdated,backdated_days,backdated_reason,created_by,created_at)
   VALUES (?,?,?,?, 'Payment', ?,0,?,
    (SELECT current_due FROM suppliers WHERE supplier_id=?), ?,?,?,?,?,?,?,datetime('now'))`)
   .bind(ledgerId,date,supplierId,supplier.supplier_name,settlementId,amount,
    supplierId,notes,method,bankId,date<today?1:0,date<today?1:0,
    clean(input.backdatedReason),user.userId)
 ];
 if(method==='Cash'){
  batch.push(db.prepare(`INSERT INTO cash_book
   (entry_id,date,type,reference,description,debit,credit,payment_method,created_at)
   VALUES (?,?,'Supplier Payment',?,?,?,0,'Cash',datetime('now'))`)
   .bind(crypto.randomUUID(),date,ledgerId,'Supplier payment to '+supplier.supplier_name,amount));
 }else{
  batch.push(db.prepare(`UPDATE bank_accounts SET current_balance=current_balance-?
   WHERE bank_account_id=?`).bind(amount,bankId));
  batch.push(db.prepare(`INSERT INTO bank_book
   (entry_id,bank_account_id,date,type,reference,description,debit,credit,
    bank_account_name,balance,created_by,created_at)
   VALUES (?,?,?,'Supplier Payment',?,?,?,0,?,
    (SELECT current_balance FROM bank_accounts WHERE bank_account_id=?),?,datetime('now'))`)
   .bind(crypto.randomUUID(),bankId,date,ledgerId,
    'Supplier payment to '+supplier.supplier_name,amount,bankName,bankId,user.userId));
 }
 batch.push(db.prepare(`INSERT INTO audit_logs
   (user_id,action,entity_type,entity_id,note)
   VALUES (?,'SUPPLIER_SETTLEMENT','SUPPLIER_LEDGER',?,?)`)
   .bind(user.userId,ledgerId,'Settled '+amount+' '+method+' request '+clientRequestId));
 try{await db.batch(batch);}
 catch(e){
  const existing=await lookup();
  if(existing)return existing.payload_json===canonical?receipt(existing,true)
   :error('Payment request ID reused with changed details.',409);
  if(/constraint|insufficient|inactive|negative|changed|unreconciled|UNIQUE/i.test(String(e)))
   return error('Supplier balance or bank account changed. Refresh and retry safely.',409);
  throw e;
 }
 return json({ok:true,settlementId,ledgerId,amount,newDue,method,bankAccountId:bankId});
}
export async function listSupplierSettlements(db:SherDatabase,supplierId:string):Promise<Response>{
 const supplier=await db.prepare(`SELECT supplier_id AS id,supplier_name AS name,current_due AS currentDue
 FROM suppliers WHERE supplier_id=? AND is_deleted=0`).bind(supplierId).first();
 if(!supplier)return error('Supplier not found.',404);
 const bankAccounts=await db.prepare(`SELECT bank_account_id AS id,account_name AS name,
  account_type AS type,current_balance AS currentBalance FROM bank_accounts
  WHERE status='Active' ORDER BY account_name`).all();
 const rows=await db.prepare(`SELECT settlement_id AS settlementId,request_id AS requestId,
  ledger_id AS ledgerId,amount,method,bank_account_id AS bankAccountId,date,status,
  reversal_ledger_id AS reversalLedgerId,created_at AS createdAt
 FROM supplier_settlement_entries WHERE supplier_id=?
 ORDER BY created_at DESC,settlement_id DESC LIMIT 100`).bind(supplierId).all();
 const ledgerDue=await currentBalance(db,supplierId);
 const session=await db.prepare("SELECT session_id FROM cash_sessions WHERE status='Open' LIMIT 1").first();
 return json({ok:true,supplier,ledgerDue,activeSession:!!session,
   needsReconciliation:Math.abs(Number((supplier as any).currentDue)-ledgerDue)>0.0001,
   bankAccounts:bankAccounts.results||[],settlements:rows.results||[]});
}
export async function reverseSupplierSettlement(db:SherDatabase,settlementId:string,
 reasonRaw:string,user:AuthUser):Promise<Response>{
 const reason=clean(reasonRaw);
 if(reason.length<4)return error('Enter a clear reversal reason (at least 4 characters).');
 const original=await db.prepare('SELECT * FROM supplier_settlement_entries WHERE settlement_id=?')
 .bind(settlementId).first<Settlement>();
 if(!original)return error('Supplier settlement not found.',404);
 if(original.status!=='Posted')return error('Supplier settlement was already reversed.',409);
 const amount=Number(original.amount);
 const supplier=await db.prepare(`SELECT current_due FROM suppliers
 WHERE supplier_id=? AND is_deleted=0`).bind(original.supplier_id)
 .first<{current_due:number}>();
 if(!supplier)return error('Original supplier unavailable.',409);
 if(Math.abs(Number(supplier.current_due)-await currentBalance(db,original.supplier_id))>0.0001)
  return error('Supplier ledger out of balance. Reconcile before reversal.',409);
 // If a source bank/cash movement has been altered manually, do not silently reverse it.
 const sourceTable=original.method==='Cash'?'cash_book':'bank_book';
 const movement=await db.prepare(`SELECT entry_id,debit,credit${original.method==='Cash'?'':',bank_account_id'} FROM ${sourceTable}
  WHERE reference=? AND COALESCE(is_deleted,0)=0`).bind(original.ledger_id).all();
 const source=movement.results[0] as {debit:number;credit:number;bank_account_id?:string}|undefined;
 if(movement.results.length!==1||Math.abs(Number(source?.debit)-amount)>0.0001||
   Number(source?.credit)!==0||
   (original.method!=='Cash'&&source?.bank_account_id!==original.bank_account_id))
  return error('Original financial movement no longer matches. Reconcile before reversal.',409);
 const ledger=await db.prepare(`SELECT credit FROM supplier_ledger
  WHERE ledger_id=? AND is_deleted=0`).bind(original.ledger_id).first<{credit:number}>();
 if(!ledger||Math.abs(Number(ledger.credit)-amount)>0.0001)
  return error('Original payment ledger was modified. Reconciliation required.',409);
 const reversalLedgerId=crypto.randomUUID(),today=new Date().toISOString().slice(0,10);
 const due=round4(Number(supplier.current_due)+amount);
 const batch:SqlPreparedStatement[]=[
  db.prepare(`UPDATE supplier_settlement_entries SET status='Reversed',
   reversed_at=datetime('now'),reversal_reason=?,reversed_by=?,reversal_ledger_id=?
   WHERE settlement_id=?`).bind(reason,user.userId,reversalLedgerId,settlementId),
  db.prepare(`UPDATE suppliers SET current_due=current_due+?,updated_at=datetime('now')
   WHERE supplier_id=?`).bind(amount,original.supplier_id),
  db.prepare(`INSERT INTO supplier_ledger
   (ledger_id,date,supplier_id,supplier_name,type,reference,debit,credit,balance,notes,
    payment_method,bank_account_id,created_by,created_at)
   VALUES (?,?,?,?,'Payment Reversal',?,?,0,
    (SELECT current_due FROM suppliers WHERE supplier_id=?),?,?,?,?,datetime('now'))`)
   .bind(reversalLedgerId,today,original.supplier_id,original.supplier_name,settlementId,
    amount,original.supplier_id,reason,original.method,original.bank_account_id,user.userId)
 ];
 if(original.method==='Cash'){
  batch.push(db.prepare(`INSERT INTO cash_book
   (entry_id,date,type,reference,description,debit,credit,payment_method,created_at)
   VALUES (?,?,'Supplier Payment Reversal',?, ?,0,?,'Cash',datetime('now'))`)
   .bind(crypto.randomUUID(),today,reversalLedgerId,
    'Reversed supplier payment '+settlementId,amount));
 }else{
  batch.push(db.prepare(`UPDATE bank_accounts SET current_balance=current_balance+?
    WHERE bank_account_id=?`).bind(amount,original.bank_account_id));
  batch.push(db.prepare(`INSERT INTO bank_book
   (entry_id,bank_account_id,date,type,reference,description,debit,credit,
    bank_account_name,balance,created_by,reversal_of,created_at)
   VALUES (?,?,?,'Supplier Payment Reversal',?, ?,0,?,
    (SELECT account_name FROM bank_accounts WHERE bank_account_id=?),
    (SELECT current_balance FROM bank_accounts WHERE bank_account_id=?),?,?,datetime('now'))`)
   .bind(crypto.randomUUID(),original.bank_account_id,today,reversalLedgerId,
    'Reversed supplier payment '+settlementId,amount,original.bank_account_id,
    original.bank_account_id,user.userId,original.ledger_id));
 }
 batch.push(db.prepare(`INSERT INTO audit_logs
  (user_id,action,entity_type,entity_id,note) VALUES
  (?,'REVERSE_SUPPLIER_SETTLEMENT','SUPPLIER_LEDGER',?,?)`)
  .bind(user.userId,reversalLedgerId,reason));
 try{await db.batch(batch);}
 catch(e){if(/constraint|negative|changed|reversed/i.test(String(e)))
   return error('Settlement reversal conflicted with newer records. Refresh first.',409);
  throw e;}
 return json({ok:true,settlementId,originalLedgerId:original.ledger_id,
  reversalLedgerId,newDue:due,amount});
}
