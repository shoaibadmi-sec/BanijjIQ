import type {SherDatabase} from '../../db/types.js';
import type {AuthUser} from '../auth/types.js';
import {
  readStoreCreditReviewFlagPage,findStoreCreditReviewFlag,
  type StoreCreditReviewFlag
} from './store-credit-reconciliation.js';

function json(data:unknown,status=200):Response{
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}});
}
function fail(message:string,status=400){return json({ok:false,error:message},status);}
function caseIdOf(flag:StoreCreditReviewFlag):string{
  return ['SC1',flag.flagCode,flag.customerId,flag.referenceId]
    .map((part,i)=>i===0?part:encodeURIComponent(part)).join(':');
}
function parseId(id:string):{flagCode:string;customerId:string;referenceId:string}|null{
  if(id.length>512)return null;
  const parts=id.split(':');
  if(parts.length!==4||parts[0]!=='SC1')return null;
  try{
    const [flagCode,customerId,referenceId]=parts.slice(1).map(decodeURIComponent);
    if(!flagCode||!customerId||!referenceId)return null;
    return {flagCode,customerId,referenceId};
  }catch{return null;}
}
function asCase(flag:StoreCreditReviewFlag,status='unverified'){
  return {...flag,caseId:caseIdOf(flag),status};
}
function parsePageNumber(raw:string|null,fallback:number,min:number,max:number):number|null{
  if(raw===null)return fallback;
  if(!/^(0|[1-9][0-9]*)$/.test(raw))return null;
  const n=Number(raw);
  return Number.isSafeInteger(n)&&n>=min&&n<=max?n:null;
}

/** Discover historical anomalies without creating credit, debt or case resolutions. */
export async function getStoreCreditCasesRoute(
  db:SherDatabase,user:AuthUser,url:URL
):Promise<Response>{
  if(user.role!=='admin')return fail('Administrator permission is required.',403);
  const limit=parsePageNumber(url.searchParams.get('limit'),50,1,100);
  const offset=parsePageNumber(url.searchParams.get('offset'),0,0,1000000);
  if(limit===null||offset===null)return fail('Invalid case page limit or offset.');
  const page=await readStoreCreditReviewFlagPage(db,limit,offset);
  const flags=page.flags;
  const ids=flags.map(caseIdOf);
  const stored:Record<string,string>={};
  // Avoid exposing a resolved result as unverified if a reviewer has already
  // created a case record. The action that modifies status is NOT part of F2.
  for(const id of ids){
    const r=await db.prepare(
      'SELECT status FROM store_credit_reconciliation_cases WHERE case_id=?'
    ).bind(id).first<{status:string}>();
    if(r)stored[id]=r.status;
  }
  return json({ok:true,readOnly:true,limit,offset,total:page.total,
    cases:flags.map(f=>asCase(f,stored[caseIdOf(f)]||'unverified'))});
}

export async function getStoreCreditCaseDetailRoute(
  db:SherDatabase,user:AuthUser,rawId:string
):Promise<Response>{
  if(user.role!=='admin')return fail('Administrator permission is required.',403);
  const parsed=parseId(rawId);
  if(!parsed)return fail('Credit reconciliation case not found.',404);
  const flag=await findStoreCreditReviewFlag(
    db,parsed.flagCode,parsed.customerId,parsed.referenceId);
  if(!flag)return fail('Credit reconciliation case not found.',404);
  const persisted=await db.prepare(
    'SELECT status FROM store_credit_reconciliation_cases WHERE case_id=?'
  ).bind(caseIdOf(flag)).first<{status:string}>();
  const customer=await db.prepare(
    'SELECT customer_id,customer_name,phone,current_due,status,is_deleted FROM customers WHERE customer_id=?'
  ).bind(flag.customerId).first<any>();
  // A flag can refer to a return, an invoice, an individual legacy ledger
  // entry, or a customer balance. Never guess a source by amount alone.
  const legacyLedger=flag.flagCode==='LEGACY_RECEIVABLE_CREDIT'
    ?await db.prepare(
      "SELECT reference FROM customer_ledger WHERE customer_id=? AND type='Sales Return Credit' AND ledger_id=? LIMIT 1"
    ).bind(flag.customerId,flag.referenceId).first<{reference:string}>():null;
  const returnRef=legacyLedger?.reference||flag.referenceId;
  const returned=await db.prepare(
    'SELECT return_id,invoice_id,customer_id,refund_method,total_return_amount,reason,return_date FROM sales_returns WHERE return_id=?'
  ).bind(returnRef).first<any>();
  const invoiceId=String(returned?.invoice_id||flag.referenceId);
  const sale=await db.prepare(
    'SELECT invoice_id,customer_id,customer_name,customer_phone,grand_total,paid_amount,due_amount,payment_method,payment_type,status FROM sales WHERE invoice_id=?'
  ).bind(invoiceId).first<any>();
  const [cash,bank,ledger,journal]=await Promise.all([
    sale?db.prepare(
      'SELECT entry_id,reference,debit,credit,payment_method FROM cash_book WHERE reference=? ORDER BY entry_id LIMIT 20'
    ).bind(sale.invoice_id).all<any>():Promise.resolve({results:[] as any[]}),
    sale?db.prepare(
      'SELECT * FROM bank_book WHERE reference=? ORDER BY entry_id LIMIT 20'
    ).bind(sale.invoice_id).all<any>():Promise.resolve({results:[] as any[]}),
    db.prepare(
      'SELECT ledger_id,type,reference,debit,credit,balance FROM customer_ledger WHERE customer_id=? AND (reference=? OR type=?) ORDER BY ledger_id LIMIT 20'
    ).bind(flag.customerId,returnRef,'Sales Return Credit').all<any>(),
    db.prepare(
      'SELECT entry_id,entry_type,source_id,delta_cents,balance_after_cents FROM customer_store_credit_entries WHERE customer_id=? ORDER BY created_at DESC,entry_id DESC LIMIT 20'
    ).bind(flag.customerId).all<any>()
  ]);
  return json({ok:true,readOnly:true,case:asCase(flag,persisted?.status||'unverified'),
    evidence:{
      customer:customer?{customerId:customer.customer_id,customerName:customer.customer_name,
        phone:customer.phone,status:customer.status}:null,
      customerDue:Number(customer?.current_due||0),
      sale:sale?{invoiceId:sale.invoice_id,customerId:sale.customer_id,
        grandTotal:Number(sale.grand_total),paidAmount:Number(sale.paid_amount),
        dueAmount:Number(sale.due_amount),paymentMethod:sale.payment_method,status:sale.status}:null,
      return:returned?{returnId:returned.return_id,invoiceId:returned.invoice_id,
        refundMethod:returned.refund_method,totalReturnAmount:Number(returned.total_return_amount),
        reason:returned.reason}:null,
      cashBook:cash.results||[],bankBook:bank.results||[],
      customerLedger:ledger.results||[],liabilityJournal:journal.results||[]
    }});
}
