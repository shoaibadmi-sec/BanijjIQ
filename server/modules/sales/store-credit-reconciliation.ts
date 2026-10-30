import type { SherDatabase } from '../../db/types.js';

export type StoreCreditReviewFlag = {
  flagCode: string;
  customerId: string;
  referenceId: string;
  expectedCents: number;
  recordedCents: number;
};

/**
 * Read-only historical Store Credit reconciliation. Keep SQL as independent
 * SELECTs: Cloudflare D1/Wrangler rejects a compound UNION ALL view here even
 * when SQLite's native integration runner accepts that same migration.
 *
 * Each query is bounded at 101 sample rows; an independent exact count keeps
 * the summary honest even when more than 100 flags exist.
 */
export const REVIEW_FLAG_CODES = [
  'LEGACY_UNJOURNALED_RETURN','LEGACY_RECEIVABLE_CREDIT','NEGATIVE_RECEIVABLE',
  'ISSUE_SOURCE_MISMATCH','REDEMPTION_SOURCE_MISMATCH',
  'CREDIT_SALE_WITHOUT_REDEMPTION','CREDIT_SALE_HAS_CASH_RECEIPT',
  'CREDIT_SALE_HAS_BANK_RECEIPT','NEGATIVE_LIABILITY'
] as const;

const SELECTS = [
  `SELECT 'LEGACY_UNJOURNALED_RETURN' flag_code,
      COALESCE(NULLIF(l.customer_id,''),s.customer_id,'') customer_id,
      l.return_id reference_id,l.amount_cents expected_cents,0 recorded_cents
    FROM store_credit_legacy_unreconciled l
    LEFT JOIN sales s ON s.invoice_id=l.invoice_id`,
  `SELECT 'LEGACY_RECEIVABLE_CREDIT' flag_code,cl.customer_id,
      cl.ledger_id reference_id,CAST(ROUND(cl.credit*100) AS INTEGER) expected_cents,
      0 recorded_cents
    FROM customer_ledger cl WHERE cl.type='Sales Return Credit'`,
  `SELECT 'NEGATIVE_RECEIVABLE' flag_code,c.customer_id,
      c.customer_id reference_id,0 expected_cents,
      CAST(ROUND(c.current_due*100) AS INTEGER) recorded_cents
    FROM customers c WHERE c.current_due<0`,
  `SELECT 'ISSUE_SOURCE_MISMATCH' flag_code,e.customer_id,
      e.source_id reference_id,
      CAST(ROUND(COALESCE(sr.total_return_amount,0)*100) AS INTEGER) expected_cents,
      e.delta_cents recorded_cents
    FROM customer_store_credit_entries e
    LEFT JOIN sales_returns sr ON sr.return_id=e.source_id
    LEFT JOIN sales s ON s.invoice_id=sr.invoice_id
    WHERE e.entry_type='ISSUE' AND
      (e.source_type<>'Sales Return' OR sr.return_id IS NULL
       OR sr.customer_id<>e.customer_id OR sr.refund_method<>'Store Credit'
       OR CAST(ROUND(sr.total_return_amount*100) AS INTEGER)<>e.delta_cents
       OR s.invoice_id IS NULL OR s.customer_id<>e.customer_id)`,
  `SELECT 'REDEMPTION_SOURCE_MISMATCH' flag_code,e.customer_id,
      e.source_id reference_id,
      -CAST(ROUND(COALESCE(s.grand_total,0)*100) AS INTEGER) expected_cents,
      e.delta_cents recorded_cents
    FROM customer_store_credit_entries e
    LEFT JOIN sales s ON s.invoice_id=e.source_id
    WHERE e.entry_type='REDEEM' AND
      (e.source_type<>'Sale' OR s.invoice_id IS NULL
       OR s.customer_id<>e.customer_id OR s.payment_method<>'Store Credit'
       OR CAST(ROUND(s.grand_total*100) AS INTEGER)<>-e.delta_cents
       OR s.is_deleted<>0 OR s.status<>'Completed')`,
  `SELECT 'CREDIT_SALE_WITHOUT_REDEMPTION' flag_code,s.customer_id,
      s.invoice_id reference_id,-CAST(ROUND(s.grand_total*100) AS INTEGER) expected_cents,
      0 recorded_cents
    FROM sales s WHERE s.payment_method='Store Credit'
      AND NOT EXISTS (
        SELECT 1 FROM customer_store_credit_entries e
        WHERE e.entry_type='REDEEM' AND e.source_type='Sale'
          AND e.source_id=s.invoice_id AND e.customer_id=s.customer_id
          AND e.delta_cents=-CAST(ROUND(s.grand_total*100) AS INTEGER))`,
  `SELECT 'CREDIT_SALE_HAS_CASH_RECEIPT' flag_code,s.customer_id,
      s.invoice_id reference_id,0 expected_cents,
      CAST(ROUND(COALESCE(SUM(cb.credit-cb.debit),0)*100) AS INTEGER) recorded_cents
    FROM sales s JOIN cash_book cb ON cb.reference=s.invoice_id
    WHERE s.payment_method='Store Credit' AND cb.is_deleted=0
    GROUP BY s.invoice_id`,
  `SELECT 'CREDIT_SALE_HAS_BANK_RECEIPT' flag_code,s.customer_id,
      s.invoice_id reference_id,0 expected_cents,
      CAST(ROUND(COALESCE(SUM(bb.credit-bb.debit),0)*100) AS INTEGER) recorded_cents
    FROM sales s JOIN bank_book bb ON bb.reference=s.invoice_id
    WHERE s.payment_method='Store Credit' AND bb.is_deleted=0
    GROUP BY s.invoice_id`,
  `SELECT 'NEGATIVE_LIABILITY' flag_code,e.customer_id,
      e.customer_id reference_id,0 expected_cents,
      SUM(e.delta_cents) recorded_cents
    FROM customer_store_credit_entries e
    GROUP BY e.customer_id HAVING SUM(e.delta_cents)<0`
] as const;

function reviewRow(row:any):StoreCreditReviewFlag {
  return {
    flagCode:String(row.flag_code||''),customerId:String(row.customer_id||''),
    referenceId:String(row.reference_id||''),expectedCents:Number(row.expected_cents||0),
    recordedCents:Number(row.recorded_cents||0)
  };
}
const caseQueries=REVIEW_FLAG_CODES.map((flagCode,i)=>({flagCode,sql:SELECTS[i]}))
  .sort((a,b)=>a.flagCode.localeCompare(b.flagCode));

/** Complete, bounded paging without combining SQLite views into a D1-unsafe UNION. */
export async function readStoreCreditReviewFlagPage(db:SherDatabase,limit:number,offset:number):
  Promise<{total:number; flags:StoreCreditReviewFlag[]}>{
  const counts=await Promise.all(caseQueries.map(async q=>{
    const r=await db.prepare('SELECT COUNT(*) n FROM ('+q.sql+')').first<{n:number}>();
    return Number(r?.n||0);
  }));
  const total=counts.reduce((a,b)=>a+b,0);
  const flags:StoreCreditReviewFlag[]=[];
  let skip=offset;
  for(let i=0;i<caseQueries.length && flags.length<limit;i++){
    if(skip>=counts[i]){skip-=counts[i];continue;}
    const sql=caseQueries[i].sql;
    const results=await db.prepare(
      'SELECT * FROM ('+sql+') AS case_review ORDER BY customer_id,reference_id,expected_cents,recorded_cents LIMIT ? OFFSET ?'
    ).bind(limit-flags.length,skip).all<any>();
    flags.push(...(results.results||[]).map(reviewRow));
    skip=0;
  }
  return {total,flags};
}
export async function findStoreCreditReviewFlag(db:SherDatabase,flagCode:string,customerId:string,referenceId:string):
  Promise<StoreCreditReviewFlag|null>{
  const q=caseQueries.find(x=>x.flagCode===flagCode);
  if(!q)return null;
  const row=await db.prepare('SELECT * FROM ('+q.sql+
    ') AS case_review WHERE customer_id=? AND reference_id=? LIMIT 1'
  ).bind(customerId,referenceId).first<any>();
  return row?reviewRow(row):null;
}

export async function readStoreCreditReviewFlags(db: SherDatabase):
  Promise<{flagsCount:number; flagsTruncated:boolean; flags:StoreCreditReviewFlag[]}>{
  const groups=await Promise.all(SELECTS.map(async(sql)=>{
    const [count,rows]=await Promise.all([
      db.prepare('SELECT COUNT(*) n FROM ('+sql+')').first<{n:number}>(),
      db.prepare('SELECT * FROM ('+sql+') AS review_sample ORDER BY review_sample.customer_id,review_sample.reference_id LIMIT 101').all<any>()
    ]);
    return {count:Number(count?.n||0),rows:rows.results||[]};
  }));
  const flagsCount=groups.reduce((total,g)=>total+g.count,0);
  const flags=groups.flatMap(g=>g.rows).map((r:any):StoreCreditReviewFlag=>({
    flagCode:String(r.flag_code||''),customerId:String(r.customer_id||''),
    referenceId:String(r.reference_id||''),
    expectedCents:Number(r.expected_cents||0),
    recordedCents:Number(r.recorded_cents||0)
  })).sort((a,b)=>a.flagCode.localeCompare(b.flagCode)||
    a.customerId.localeCompare(b.customerId)||
    a.referenceId.localeCompare(b.referenceId)).slice(0,100);
  return {flagsCount,flagsTruncated:flagsCount>100,flags};
}
