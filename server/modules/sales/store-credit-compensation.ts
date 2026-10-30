import type {SherDatabase} from '../../db/types.js';
import type {AuthUser} from '../auth/types.js';
import {parseId,caseIdOf} from './store-credit-cases.js';
import {findStoreCreditReviewFlag} from './store-credit-reconciliation.js';
import {getStoreCreditOutstandingImpactRoute} from './store-credit-outstanding-impact.js';

function json(value:unknown,status=200):Response{
  return new Response(JSON.stringify(value),{
    status,headers:{'content-type':'application/json; charset=utf-8'}
  });
}
function fail(message:string,status=409):Response{
  return json({ok:false,error:message},status);
}

export async function commitVerifiedOutstandingCredit(
  db:SherDatabase,user:AuthUser,rawId:string,
  reason:string,evidenceIds:string[],expectedVersion:number
):Promise<Response>{
  if(user.role!=='admin'||user.status!=='Active')return fail('Administrator only.',403);
  if(expectedVersion!==1)return fail('Review version conflict.');
  const parsed=parseId(rawId);
  if(!parsed)return fail('Credit case not found.',404);
  const flag=await findStoreCreditReviewFlag(
    db,parsed.flagCode,parsed.customerId,parsed.referenceId);
  if(!flag)return fail('Credit case not found.',404);
  const caseId=caseIdOf(flag);
  const prior=await db.prepare(
    'SELECT case_id FROM store_credit_reconciliation_cases WHERE case_id=?'
  ).bind(caseId).first<any>();
  if(prior)return fail('Historical case is already reviewed.');
  const previewResponse=await getStoreCreditOutstandingImpactRoute(db,user,rawId);
  if(previewResponse.status!==200)return previewResponse;
  const preview=await previewResponse.json() as any;
  if(!preview.eligible||preview.caseId!==caseId)
    return fail('Original financial evidence does not reconcile: '+
      (preview.blockingReasons||[]).join(', '));
  if(evidenceIds.length!==4||preview.sourceIds.length!==4||
    !preview.sourceIds.every((id:string)=>evidenceIds.includes(id)))
    return fail('Evidence identifiers must match all original source records.');

  const amount=Number(preview.impact?.liabilityDeltaCents);
  if(!Number.isSafeInteger(amount)||amount<=0||
    preview.impact?.receivableDeltaCents!==amount||
    preview.impact?.cashDeltaCents!==0||preview.impact?.bankDeltaCents!==0)
    return fail('Invalid receivable and liability impact.');
  const oldLedgerId=evidenceIds.find(x=>x.startsWith('ledger:'))?.slice(7)||'';
  const returnId=evidenceIds.find(x=>x.startsWith('return:'))?.slice(7)||'';
  if(returnId!==flag.referenceId||!oldLedgerId)return fail('Missing original ledger source.');

  const amountMoney=amount/100;
  const customerId=flag.customerId;
  const newLedgerId='CL-'+crypto.randomUUID();
  const note='Reclassified original due-side Store Credit; case '+caseId+
    '; previous ledger '+oldLedgerId+'; '+reason;
  const evidence=JSON.stringify({
    decision:'verified-outstanding',evidenceIds,originalFlag:flag,impact:preview.impact
  });
  const statements=[
    // Zero-row inserts/updates are made fatal by the last audit trigger
    // in migration 0044, so *all* accounting changes roll back together.
    db.prepare(
      "INSERT INTO store_credit_reconciliation_cases "+
      "(case_id,flag_code,customer_id,reference_id,status,evidence_json,"+
      "review_reason,created_by,reviewed_by,reviewed_at,version) "+
      "SELECT ?,?,?,?,'verified_outstanding',?,?,?,?,datetime('now'),2 "+
      "FROM customers c WHERE c.customer_id=? "+
      "AND CAST(ROUND(c.current_due*100) AS INTEGER)=-?"
    ).bind(caseId,flag.flagCode,customerId,flag.referenceId,evidence,
      reason,user.userId,user.userId,customerId,amount),
    db.prepare(
      "UPDATE customers SET current_due=current_due+?,updated_at=datetime('now') "+
      "WHERE customer_id=? AND CAST(ROUND(current_due*100) AS INTEGER)=-?"
    ).bind(amountMoney,customerId,amount),
    db.prepare(
      "INSERT INTO customer_ledger "+
      "(ledger_id,date,customer_id,customer_name,type,reference,debit,credit,balance,notes) "+
      "SELECT ?,date('now'),c.customer_id,c.customer_name,'Store Credit Reclassification',"+
      "?,?,0,c.current_due,? FROM customers c WHERE c.customer_id=? "+
      "AND CAST(ROUND(c.current_due*100) AS INTEGER)=0"
    ).bind(newLedgerId,caseId,amountMoney,note,customerId),
    db.prepare(
      "INSERT INTO store_credit_historical_adjustments "+
      "(case_id,customer_id,return_id,old_ledger_id,delta_cents,balance_after_cents,created_by) "+
      "VALUES (?,?,?,?,?,?,?)"
    ).bind(caseId,customerId,returnId,oldLedgerId,amount,amount,user.userId),
    db.prepare(
      "INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) "+
      "VALUES (?,'RECONCILE_STORE_CREDIT','STORE_CREDIT_CASE',?,?)"
    ).bind(user.userId,caseId,note)
  ];
  try{
    const results=await db.batch(statements);
    if(results.some((result,i)=>Number(result.meta?.changes)!==1))
      return fail('One or more source-linked accounting statements were not applied.');
  }catch(err){
    const message=String(err);
    if(/constraint|CONFLICT|UNIQUE|reconciliation|ledger/i.test(message))
      return fail('Historical credit reconciliation failed source or concurrency checks.');
    throw err;
  }
  return json({ok:true,creditIssuedCents:amount,case:{
    ...flag,caseId,status:'verified_outstanding',version:2,
    reviewedBy:user.userId,reason
  }});
}
