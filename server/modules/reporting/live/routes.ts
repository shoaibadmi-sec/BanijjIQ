import type { SherDatabase } from '../../../db/types.js';
import type { LiveReportQuery, LiveReportPage, LiveReportRow } from './types.js';
import { liveReportCatalog } from './catalog.js';
import { LiveReportQueryError, parseLiveReportQuery, parseLiveReportRange } from './query.js';

function json(data:unknown,status=200):Response {
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}});
}
function toMinor(value:unknown):number|null {
  const n=Number(value);
  if(!Number.isFinite(n) || n<0 || !Number.isSafeInteger(Math.round(n*100))) return null;
  return Math.round(n*100);
}

async function salesRows(db:SherDatabase,query:LiveReportQuery):Promise<LiveReportPage> {
  const where=`COALESCE(is_deleted,0)=0 AND status<>'Deleted' AND sale_date BETWEEN ? AND ?
    AND (instr(lower(invoice_id),lower(?))>0 OR instr(lower(customer_name),lower(?))>0)`;
  const search=query.search,bind=[query.from,query.to,search,search] as const;
  const count=await db.prepare(`SELECT COUNT(*) AS count FROM sales WHERE ${where}`).bind(...bind).first<{count:number}>();
  const orderColumn={date:'sale_date',amount:'grand_total',name:'customer_name',reference:'invoice_id'}[query.sort];
  const offset=(query.page-1)*query.pageSize;
  const result=await db.prepare(`SELECT invoice_id,sale_date,customer_name,grand_total
    FROM sales WHERE ${where} ORDER BY ${orderColumn} ${query.direction.toUpperCase()},invoice_id DESC LIMIT ? OFFSET ?`)
    .bind(...bind,query.pageSize,offset).all<{invoice_id:string;sale_date:string;customer_name:string;grand_total:number}>();
  const rows:LiveReportRow[]=(result.results||[]).map(row=>{
    const amountMinor=toMinor(row.grand_total);
    return {sourceId:row.invoice_id,sourceModule:'sales',date:row.sale_date,label:row.customer_name,
      amountMinor,status:amountMinor===null?'incomplete':'needs-review',
      reason:amountMinor===null?'Invalid recorded amount.':'Recorded invoice amount, not reconciled net sales or profit.'};
  });
  return {ok:true,report:query.report,range:{from:query.from,to:query.to},
    page:query.page,pageSize:query.pageSize,totalRows:Number(count?.count??0),rows,metrics:[],
    coverage:{status:rows.some(x=>x.amountMinor===null)?'incomplete':'needs-review',
      reason:'Recorded sales only. Returns, reversals, FIFO COGS and Store Credit are not yet reconciled.'}};
}
function unavailable(query:LiveReportQuery):LiveReportPage {
  const item=liveReportCatalog.find(x=>x.id===query.report);
  return {ok:true,report:query.report,range:{from:query.from,to:query.to},
    page:query.page,pageSize:query.pageSize,totalRows:0,rows:[],metrics:[],
    coverage:{status:'unavailable',reason:item?.reason??'Report not yet available.'}};
}

/** All routes are GET-only, authenticated and reports.view gated by the main handler. */
export async function handleLiveReportsRoute(db:SherDatabase,request:Request,path:string):Promise<Response|null> {
  if(!path.startsWith('/api/reports/v2/')) return null;
  if(request.method!=='GET') return null;
  const url=new URL(request.url);
  try {
    if(path==='/api/reports/v2/catalog')
      return json({ok:true,mainTabs:[{id:'overview',en:'Dashboard',bn:'ড্যাশবোর্ড'},
        {id:'library',en:'Report Library',bn:'রিপোর্ট লাইব্রেরি'}],reports:liveReportCatalog});
    if(path==='/api/reports/v2/rows') {
      const query=parseLiveReportQuery(url);
      return json(query.report==='sales'?await salesRows(db,query):unavailable(query));
    }
    if(path==='/api/reports/v2/summary') {
      const query=parseLiveReportQuery(url);
      return json({ok:true,range:{from:query.from,to:query.to},metrics:[],coverage:{
        status:'unavailable',reason:'Verified dashboard aggregates are not yet available.'}});
    }
    if(path==='/api/reports/v2/audit') {
      const range=parseLiveReportRange(url);
      return json({ok:true,range,sections:[],readiness:'unavailable',
        reason:'Internal business audit is not ready; no estimated report was generated.'});
    }
    return json({ok:false,error:'Report API route not found.'},404);
  } catch(err) {
    if(err instanceof LiveReportQueryError) return json({ok:false,error:err.message},400);
    throw err;
  }
}
