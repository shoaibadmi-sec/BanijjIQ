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
export function caseIdOf(flag:StoreCreditReviewFlag):string{
  return ['SC1',flag.flagCode,flag.customerId,flag.referenceId]
    .map((part,i)=>i===0?part:encodeURIComponent(part)).join(':');
}
export function parseId(id:string):{flagCode:string;customerId:string;referenceId:string}|null{
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

export type StoreCreditCaseResolutionInput = {
  decision?:'verified-settled'|'verified-outstanding'|'reject';
  reason?:string;
  evidenceIds?:string[];
  expectedVersion?:number;
};

/**
 * A financial reconciliation decision is NOT permission to issue liability.
 * Verified outstanding legacy credits require a separately reviewed, atomic
 * receivable + liability compensating entry and therefore fail closed here.
 *
 * The only affirmative settlement supported in this first audited step is
 * a historical Store Credit return whose original cash sale and actual cash
 * return refund can both be proved from intact source books.
 */
export async function resolveStoreCreditCaseRoute(
  db:SherDatabase,user:AuthUser,rawId:string,input:StoreCreditCaseResolutionInput
):Promise<Response>{
  if(user.role!=='admin'||user.status!=='Active')
    return fail('Administrator permission is required.',403);
  const parsed=parseId(rawId);
  if(!parsed)return fail('Credit reconciliation case not found.',404);
  if(!input||typeof input!=='object')
    return fail('A reconciliation decision is required.');
  if(!['verified-settled','verified-outstanding','reject'].includes(String(input.decision||'')))
    return fail('Invalid reconciliation decision.');
  if(input.expectedVersion!==1)
    return fail('The reconciliation case review version is stale.',409);
  const reason=typeof input.reason==='string'?input.reason.trim():'';
  if(reason.length<12||reason.length>500)return fail('An audit reason of 12–500 characters is required.');
  const ids=input.evidenceIds;
  if(!Array.isArray(ids)||ids.length<1||ids.length>20||
    ids.some(id=>typeof id!=='string'||id.length<3||id.length>256)||
    new Set(ids).size!==ids.length)
    return fail('Provide distinct source evidence identifiers.');
  if(input.decision==='verified-outstanding')
    return fail('Creating spendable historical credit needs a separate finance-approved compensation workflow.',409);
  const flag=await findStoreCreditReviewFlag(
    db,parsed.flagCode,parsed.customerId,parsed.referenceId);
  if(!flag)return fail('Credit reconciliation case not found.',404);
  const caseId=caseIdOf(flag);
  const previous=await db.prepare(
    'SELECT status,version FROM store_credit_reconciliation_cases WHERE case_id=?'
  ).bind(caseId).first<{status:string;version:number}>();
  if(previous)return fail('This historical credit case has already been reviewed.',409);

  const requiredSource=(flag.flagCode==='LEGACY_UNJOURNALED_RETURN'
    ?'return:':flag.flagCode==='LEGACY_RECEIVABLE_CREDIT'
    ?'ledger:':flag.flagCode==='NEGATIVE_RECEIVABLE'||flag.flagCode==='NEGATIVE_LIABILITY'
    ?'customer:':flag.flagCode==='CREDIT_SALE_WITHOUT_REDEMPTION'||
      flag.flagCode==='CREDIT_SALE_HAS_CASH_RECEIPT'||flag.flagCode==='CREDIT_SALE_HAS_BANK_RECEIPT'
    ?'sale:':'journal:')+flag.referenceId;
  if(!ids.includes(requiredSource))
    return fail('The named original source document is required.',409);

  let sourceReturn:any=null,sourceSale:any=null,refund:any=null;
  if(input.decision==='verified-settled'){
    if(flag.flagCode!=='LEGACY_UNJOURNALED_RETURN')
      return fail('Only an independently refunded legacy return can be marked verified settled.',409);
    sourceReturn=await db.prepare(
      'SELECT return_id,invoice_id,customer_id,refund_method,total_return_amount FROM sales_returns WHERE return_id=?'
    ).bind(flag.referenceId).first<any>();
    if(!sourceReturn||sourceReturn.customer_id!==flag.customerId||
      sourceReturn.refund_method!=='Store Credit')
      return fail('Return source could not be independently verified.',409);
    sourceSale=await db.prepare(
      'SELECT invoice_id,customer_id,grand_total,paid_amount,due_amount,payment_method,status,is_deleted FROM sales WHERE invoice_id=?'
    ).bind(sourceReturn.invoice_id).first<any>();
    const totalCents=Math.round(Number(sourceReturn.total_return_amount)*100);
    if(!sourceSale||sourceSale.customer_id!==flag.customerId||
      sourceSale.payment_method!=='Cash'||sourceSale.status!=='Completed'||
      Number(sourceSale.is_deleted)!==0||
      Math.round(Number(sourceSale.paid_amount)*100)!==Math.round(Number(sourceSale.grand_total)*100)||
      Number(sourceSale.due_amount)!==0||
      !Number.isSafeInteger(totalCents)||totalCents<=0||
      totalCents!==flag.expectedCents)
      return fail('Paid original cash sale and return do not reconcile.',409);

    // Reviewer must name the exact refund, not merely the original cash sale.
    const refundIds=ids.filter(id=>id.startsWith('cash:'));
    if(refundIds.length!==1||!ids.includes('sale:'+sourceSale.invoice_id)||
       !ids.includes('return:'+sourceReturn.return_id))
      return fail('Original invoice, return and one actual refund are required.',409);
    refund=await db.prepare(
      "SELECT entry_id,reference,debit,credit FROM cash_book "+
      "WHERE entry_id=? AND reference=? AND type='Sales Return' AND is_deleted=0 "+
      "AND credit=0 AND CAST(ROUND(debit*100) AS INTEGER)=?"
    ).bind(refundIds[0].slice(5),sourceReturn.return_id,totalCents).first<any>();
    const proof=await db.prepare(
      "SELECT COUNT(*) n,CAST(ROUND(COALESCE(SUM(credit),0)*100) AS INTEGER) paid "+
      "FROM cash_book WHERE reference=? AND type='Sale' AND is_deleted=0 AND debit=0"
    ).bind(sourceSale.invoice_id).first<any>();
    const payout=await db.prepare(
      "SELECT COUNT(*) n,CAST(ROUND(COALESCE(SUM(debit),0)*100) AS INTEGER) cents "+
      "FROM cash_book WHERE reference=? AND type='Sales Return' AND is_deleted=0"
    ).bind(sourceReturn.return_id).first<any>();
    const alreadyJournaled=await db.prepare(
      "SELECT COUNT(*) n FROM customer_store_credit_entries "+
      "WHERE source_type='Sales Return' AND source_id=?"
    ).bind(sourceReturn.return_id).first<any>();
    if(!refund||Number(proof?.n)!==1||
      Number(proof?.paid)!==Math.round(Number(sourceSale.paid_amount)*100)||
      Number(payout?.n)!==1||Number(payout?.cents)!==totalCents||
      Number(alreadyJournaled?.n)>0)
      return fail('Verified refund and original payment evidence is incomplete.',409);
  }

  const status=input.decision==='verified-settled'?'verified_settled':'rejected';
  const snapshot=JSON.stringify({
    decision:input.decision,evidenceIds:ids,originalFlag:flag,
    originalSale:sourceSale?{invoiceId:sourceSale.invoice_id,paidAmount:sourceSale.paid_amount}:null,
    originalReturn:sourceReturn?{returnId:sourceReturn.return_id,amount:sourceReturn.total_return_amount}:null,
    verifiedRefundEntryId:refund?.entry_id||null
  });
  const insertPrefix='INSERT INTO store_credit_reconciliation_cases '+
    '(case_id,flag_code,customer_id,reference_id,status,evidence_json,review_reason,'+
    'created_by,reviewed_by,reviewed_at,version) ';
  // Recheck the financial proof inside the D1 batch, not only in earlier
  // SELECTs. A changed/deleted source must produce zero case inserts.
  const statement=input.decision==='verified-settled'
    ?db.prepare(insertPrefix+
      "SELECT ?,?,?,?,?,?,?,?,?,datetime('now'),2 FROM sales_returns sr "+
      "JOIN sales s ON s.invoice_id=sr.invoice_id "+
      "WHERE sr.return_id=? AND sr.customer_id=? AND sr.refund_method='Store Credit' "+
      "AND s.customer_id=? AND s.payment_method='Cash' AND s.is_deleted=0 "+
      "AND s.status='Completed' AND s.paid_amount=s.grand_total AND s.due_amount=0 "+
      "AND CAST(ROUND(sr.total_return_amount*100) AS INTEGER)=? "+
      "AND EXISTS (SELECT 1 FROM cash_book orig WHERE orig.reference=s.invoice_id "+
      "AND orig.type='Sale' AND orig.is_deleted=0 AND orig.debit=0 "+
      "GROUP BY orig.reference HAVING COUNT(*)=1 AND "+
      "CAST(ROUND(SUM(orig.credit)*100) AS INTEGER)=CAST(ROUND(s.paid_amount*100) AS INTEGER)) "+
      "AND EXISTS (SELECT 1 FROM cash_book cb WHERE cb.entry_id=? "+
      "AND cb.reference=sr.return_id AND cb.type='Sales Return' AND cb.is_deleted=0 "+
      "AND cb.credit=0 AND CAST(ROUND(cb.debit*100) AS INTEGER)=?) "+
      "AND (SELECT COUNT(*) FROM cash_book cb "+
      "WHERE cb.reference=sr.return_id AND cb.type='Sales Return' AND cb.is_deleted=0)=1 "+
      "AND NOT EXISTS (SELECT 1 FROM customer_store_credit_entries e "+
      "WHERE e.source_type='Sales Return' AND e.source_id=sr.return_id)"
    ).bind(caseId,flag.flagCode,flag.customerId,flag.referenceId,status,
      snapshot,reason,user.userId,user.userId,sourceReturn.return_id,
      flag.customerId,flag.customerId,flag.expectedCents,refund.entry_id,flag.expectedCents)
    :db.prepare(insertPrefix+
      "SELECT ?,?,?,?,?,?,?,?,?,datetime('now'),2 WHERE EXISTS "+
      "(SELECT 1 FROM customers WHERE customer_id=?)"
    ).bind(caseId,flag.flagCode,flag.customerId,flag.referenceId,status,
      snapshot,reason,user.userId,user.userId,flag.customerId);
  const audit=db.prepare(
    "INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) "+
    "SELECT ?,'REVIEW_STORE_CREDIT_CASE','STORE_CREDIT_CASE',?,? "+
    "FROM store_credit_reconciliation_cases WHERE case_id=? AND reviewed_by=? AND version=2"
  ).bind(user.userId,caseId,status+': '+reason+'; '+ids.join(', '),caseId,user.userId);
  try{
    const results=await db.batch([statement,audit]);
    if(Number(results[0]?.meta?.changes)!==1||Number(results[1]?.meta?.changes)!==1)
      return fail('Original source evidence changed during review.',409);
  }catch(err){
    const msg=String(err);
    if(msg.includes('UNIQUE constraint failed')||msg.includes('constraint'))
      return fail('Credit case was already reviewed or the source has changed.',409);
    throw err;
  }
  return json({ok:true,readOnly:false,creditIssuedCents:0,case:{
    ...asCase(flag,status),version:2,reviewedBy:user.userId,reason
  }});
}
