import type {SherDatabase} from '../../db/types.js';
import type {AuthUser} from '../auth/types.js';
import {caseIdOf,parseId} from './store-credit-cases.js';
import {findStoreCreditReviewFlag} from './store-credit-reconciliation.js';

function json(value:unknown,status=200):Response{
  return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8'}});
}
function fail(error:string,status=400){return json({ok:false,error},status);}

function exactCents(value:unknown):number|null{
  const amount=Number(value);
  if(!Number.isFinite(amount))return null;
  const cents=amount*100;
  if(!Number.isSafeInteger(Math.round(cents))||Math.abs(cents-Math.round(cents))>0.000001)return null;
  return Math.round(cents);
}

/**
 * Financial eligibility preview ONLY: no created case, liability, receivable,
 * cash, bank or audit mutation. The preview is not a permit to make a posting;
 * every source invariant must be rechecked in the later atomic posting batch.
 *
 * An ambiguous historical case remains blocked until a human accountant can
 * establish its original sale, return, receivable credit and payment provenance.
 */
export async function getStoreCreditOutstandingImpactRoute(
  db:SherDatabase,user:AuthUser,rawId:string
):Promise<Response>{
  if(user.role!=='admin'||user.status!=='Active')
    return fail('Administrator permission is required.',403);
  const parsed=parseId(rawId);
  if(!parsed)return fail('Credit reconciliation case not found.',404);
  const flag=await findStoreCreditReviewFlag(
    db,parsed.flagCode,parsed.customerId,parsed.referenceId);
  if(!flag)return fail('Credit reconciliation case not found.',404);
  const caseId=caseIdOf(flag);
  const reasons:string[]=[];
  const block=(condition:boolean,reason:string)=>{if(condition)reasons.push(reason);};
  if(flag.flagCode!=='LEGACY_UNJOURNALED_RETURN'){
    return json({ok:true,readOnly:true,caseId,eligible:false,
      decision:'verified-outstanding',blockingReasons:['NOT_LEGACY_RETURN'],
      impact:null,sourceIds:[]});
  }
  const [returned,customer,reviewed]=await Promise.all([
    db.prepare("SELECT return_id,invoice_id,customer_id,customer_phone,refund_method,total_return_amount "+
      "FROM sales_returns WHERE return_id=?").bind(flag.referenceId).first<any>(),
    db.prepare("SELECT customer_id,phone,status,is_deleted,current_due "+
      "FROM customers WHERE customer_id=?").bind(flag.customerId).first<any>(),
    db.prepare("SELECT status FROM store_credit_reconciliation_cases WHERE case_id=?")
      .bind(caseId).first<any>()
  ]);
  if(!returned)return fail('Original return was not found.',409);
  const sale=await db.prepare("SELECT invoice_id,customer_id,customer_phone,grand_total,paid_amount,"+
    "due_amount,payment_type,payment_method,status,is_deleted FROM sales WHERE invoice_id=?"
  ).bind(returned.invoice_id).first<any>();
  const amount=exactCents(returned.total_return_amount);
  const due=exactCents(customer?.current_due);
  const paid=exactCents(sale?.paid_amount);
  const grand=exactCents(sale?.grand_total);
  block(!!reviewed,'CASE_ALREADY_REVIEWED');
  block(!customer||customer.status!=='Active'||Number(customer.is_deleted)!==0||
    !customer.phone||customer.phone!==returned.customer_phone,'CUSTOMER_INACTIVE_OR_IDENTITY_MISMATCH');
  block(!returned.customer_id||returned.customer_id!==flag.customerId||
    returned.refund_method!=='Store Credit','RETURN_SOURCE_MISMATCH');
  block(amount===null||amount<=0||amount!==flag.expectedCents,'INVALID_RETURN_AMOUNT');
  block(!sale||sale.customer_id!==flag.customerId||
    sale.customer_phone!==customer?.phone||sale.payment_method!=='Cash'||
    sale.payment_type!=='Cash'||sale.status!=='Completed'||Number(sale.is_deleted)!==0||
    grand===null||grand<=0||paid!==grand||Number(sale.due_amount)!==0||
    (amount!==null&&grand!==null&&amount>grand),'SALE_NOT_VERIFIED_PAID_CASH');
  block(amount===null||due===null||due!==-amount,
    'RECEIVABLE_NOT_EXACT_NEGATIVE_OFFSET');

  const [cashReceipts,cashReturn,bankReturn,legacyOffsets,otherReturns,
    journal,returnTotals,returnItemsMissing]=await Promise.all([
    db.prepare("SELECT entry_id,credit,debit FROM cash_book "+
      "WHERE reference=? AND type='Sale' AND is_deleted=0"
    ).bind(returned.invoice_id).all<any>(),
    db.prepare("SELECT entry_id FROM cash_book WHERE reference=? AND is_deleted=0"
    ).bind(returned.return_id).all<any>(),
    db.prepare("SELECT entry_id FROM bank_book WHERE reference=? AND is_deleted=0"
    ).bind(returned.return_id).all<any>(),
    db.prepare("SELECT ledger_id,reference,debit,credit,balance FROM customer_ledger "+
      "WHERE customer_id=? AND type='Sales Return Credit'"
    ).bind(flag.customerId).all<any>(),
    db.prepare("SELECT return_id FROM sales_returns WHERE invoice_id=?"
    ).bind(returned.invoice_id).all<any>(),
    db.prepare("SELECT entry_id FROM customer_store_credit_entries WHERE customer_id=? LIMIT 2"
    ).bind(flag.customerId).all<any>(),
    db.prepare("SELECT COUNT(*) n, COALESCE(SUM(line_total),0) total FROM sales_return_items "+
      "WHERE return_id=?"
    ).bind(returned.return_id).first<any>(),
    db.prepare("SELECT COUNT(*) n FROM sales_return_items ri "+
      "WHERE ri.return_id=? AND (ri.return_quantity<=0 OR ri.line_total<=0 "+
      "OR NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.invoice_id=? "+
      "AND si.product_id=ri.product_id AND si.quantity>=ri.return_quantity))"
    ).bind(returned.return_id,returned.invoice_id).first<any>()
  ]);
  const receipt=(cashReceipts.results||[])[0];
  block((cashReceipts.results||[]).length!==1||
    exactCents(receipt?.credit)!==paid||exactCents(receipt?.debit)!==0,
    'SALE_CASH_EVIDENCE_MISMATCH');
  block((cashReturn.results||[]).length>0||(bankReturn.results||[]).length>0,
    'RETURN_ALREADY_REFUNDED');
  const ledger=(legacyOffsets.results||[])[0];
  block((legacyOffsets.results||[]).length!==1||
    ledger?.reference!==returned.return_id||exactCents(ledger?.debit)!==0||
    exactCents(ledger?.credit)!==amount||exactCents(ledger?.balance)!==due,
    'LEGACY_OFFSET_NOT_UNIQUE');
  block((otherReturns.results||[]).length!==1,
    'OTHER_RETURNS_REQUIRE_SEPARATE_REVIEW');
  block((journal.results||[]).length>0,'CURRENT_ACCOUNT_ALREADY_CREDITED');
  block(Number(returnTotals?.n)<1||exactCents(returnTotals?.total)!==amount||
    Number(returnItemsMissing?.n)>0,'RETURN_ITEMS_MISMATCH');

  const impact=amount===null?null:{
    receivableDeltaCents:amount,liabilityDeltaCents:amount,
    cashDeltaCents:0,bankDeltaCents:0
  };
  const sourceIds=(sale&&receipt&&ledger)?[
    'sale:'+sale.invoice_id,'return:'+returned.return_id,
    'ledger:'+ledger.ledger_id,'cash:'+receipt.entry_id
  ]:[];
  return json({ok:true,readOnly:true,decision:'verified-outstanding',caseId,
    eligible:reasons.length===0,blockingReasons:reasons,impact,sourceIds});
}
