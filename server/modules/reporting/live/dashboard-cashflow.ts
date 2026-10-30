import type { SherDatabase } from '../../../db/types.js';
import { parseLiveReportRange, LiveReportQueryError } from './query.js';
import { readCashExpenses } from './cash-expenses.js';
import type { LiveReportQuery } from './types.js';

type BookEntry={date:string;type:string;debit:number;credit:number};
type ChartPoint={month:string;inMinor:number|null;outMinor:number|null;status:'needs-review'|'incomplete';reason:string};
const internal=new Set(['Opening Balance','Transfer In','Transfer Out','Cash Deposit','Cash Withdrawal']);
const minor=(value:number)=>Number.isFinite(value)&&value>=0&&Number.isSafeInteger(Math.round(value*100))&&
  Math.abs(value*100-Math.round(value*100))<0.000001?Math.round(value*100):null;
function dhakaToday(){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const get=(name:string)=>parts.find(x=>x.type===name)?.value??'';
 return get('year')+'-'+get('month')+'-'+get('day');
}

/**
 * Reuse the authoritative source-ledger reconciliation before exposing any
 * cash-flow chart amount. Count external money movements once, in integer
 * poisha; internal bank/cash transfers and cash-session float are not revenue.
 */
export async function readDashboardCashflow(db:SherDatabase,url:URL){
 if([...url.searchParams.keys()].some(k=>k!=='to'))throw new LiveReportQueryError('Only the to date is supported.');
 const to=url.searchParams.get('to')??dhakaToday();
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
 if(!match)throw new LiveReportQueryError('Enter a valid YYYY-MM-DD date.');
 const first=new Date(Date.UTC(Number(match[1]),Number(match[2])-6,1));
 const from=first.toISOString().slice(0,10);
 const parsed=new URL('https://report.local/?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to));
 const range=parseLiveReportRange(parsed);
 const months=Array.from({length:6},(_,i)=>{
   const date=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+i,1));
   return date.toISOString().slice(0,7);
 });
 const query:LiveReportQuery={...range,report:'cash',page:1,pageSize:50,search:'',
   sort:'date',direction:'desc'};
 const check=await readCashExpenses(db,query);
 const fallback=(reason:string)=>({ok:true,range,points:months.map(month=>({
   month,inMinor:null,outMinor:null,status:'incomplete' as const,reason
 }))});
 if(check.coverage.status==='incomplete'||check.coverage.status==='unavailable')
   return fallback(check.coverage.reason||'Money-book source reconciliation is incomplete.');
 const [cashR,bankR]=await Promise.all([
   db.prepare("SELECT date,type,debit,credit FROM cash_book WHERE is_deleted=0 AND date BETWEEN ? AND ? ORDER BY date,entry_id LIMIT 10001")
     .bind(range.from,range.to).all<BookEntry>(),
   db.prepare("SELECT date,type,debit,credit FROM bank_book WHERE is_deleted=0 AND date BETWEEN ? AND ? ORDER BY date,entry_id LIMIT 10001")
     .bind(range.from,range.to).all<BookEntry>()
 ]);
 const cash=cashR.results||[],bank=bankR.results||[];
 if(cash.length>10000||bank.length>10000)
   return fallback('Money-book source exceeds bounded chart limit.');
 const buckets=new Map(months.map(month=>[month,{month,inMinor:0,outMinor:0,
   status:'needs-review' as const,reason:'External posted money movements; transfers and opening balances excluded.'}]));
 for(const entry of [...cash,...bank]){
   if(internal.has(entry.type))continue;
   const incoming=minor(Number(entry.credit)),outgoing=minor(Number(entry.debit));
   if(incoming===null||outgoing===null||(incoming>0&&outgoing>0))
     return fallback('Invalid source money-book posting; chart cannot be certified.');
   const bucket=buckets.get(entry.date.slice(0,7));
   if(!bucket)return fallback('Money-book date falls outside the requested chart months.');
   bucket.inMinor+=incoming;bucket.outMinor+=outgoing;
   if(!Number.isSafeInteger(bucket.inMinor)||!Number.isSafeInteger(bucket.outMinor))
     return fallback('Monthly money-book total exceeds safe integer poisha range.');
 }
 return {ok:true,range,points:months.map(month=>buckets.get(month) as ChartPoint)};
}