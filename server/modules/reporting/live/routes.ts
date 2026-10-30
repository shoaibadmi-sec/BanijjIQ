import type { SherDatabase } from '../../../db/types.js';
import type { LiveReportQuery, LiveReportPage, LiveReportRow } from './types.js';
import { liveReportCatalog } from './catalog.js';
import { LiveReportQueryError, parseLiveReportQuery, parseLiveReportRange } from './query.js';
import { readSalesProfit } from './sales-profit.js';
import { readStockDues } from './stock-dues.js';
import { readCashExpenses } from './cash-expenses.js';

function json(data:unknown,status=200):Response {
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}});
}
function toMinor(value:unknown):number|null {
  const n=Number(value);
  if(!Number.isFinite(n) || n<0 || !Number.isSafeInteger(Math.round(n*100))) return null;
  return Math.round(n*100);
}

async function salesRows(db:SherDatabase,query:LiveReportQuery):Promise<LiveReportPage> {
  const where=`COALESCE(is_deleted,0)=0 AND status IN ('Completed','Reversed') AND sale_date BETWEEN ? AND ?
    AND (instr(lower(invoice_id),lower(?))>0 OR instr(lower(customer_name),lower(?))>0)`;
  const search=query.search,bind=[query.from,query.to,search,search] as const;
  const count=await db.prepare(`SELECT COUNT(*) AS count FROM sales WHERE ${where}`).bind(...bind).first<{count:number}>();
  const orderColumn={date:'sale_date',amount:'grand_total',name:'customer_name',reference:'invoice_id'}[query.sort];
  const offset=(query.page-1)*query.pageSize;
  const result=await db.prepare(`SELECT invoice_id,sale_date,customer_id,customer_phone,customer_name,grand_total,paid_amount,due_amount
    FROM sales WHERE ${where} ORDER BY ${orderColumn} ${query.direction.toUpperCase()},invoice_id DESC LIMIT ? OFFSET ?`)
    .bind(...bind,query.pageSize,offset).all<{invoice_id:string;sale_date:string;customer_id:string;customer_phone:string;customer_name:string;grand_total:number;paid_amount:number|null;due_amount:number|null}>();
  const rows:LiveReportRow[]=(result.results||[]).map(row=>{
    const amountMinor=toMinor(row.grand_total);
    const rawPaid=row.paid_amount===null?null:toMinor(row.paid_amount);
    const rawDue=row.due_amount===null?null:toMinor(row.due_amount);
    const splitValid=amountMinor!==null&&rawPaid!==null&&rawDue!==null&&
      Math.abs(rawPaid+rawDue-amountMinor)<=1;
    return {sourceId:row.invoice_id,sourceModule:'sales',date:row.sale_date,label:row.customer_name,
      amountMinor,paidMinor:splitValid?rawPaid:null,dueMinor:splitValid?rawDue:null,
      status:amountMinor===null?'incomplete':'needs-review',
      reason:amountMinor===null?'Invalid recorded amount.':
        splitValid?'Recorded invoice amount and payment split; returns/profit not yet reconciled.':
          'Recorded invoice amount. Paid/due split is missing or inconsistent and is withheld.'};
  });
  return {ok:true,report:query.report,range:{from:query.from,to:query.to},
    page:query.page,pageSize:query.pageSize,totalRows:Number(count?.count??0),rows,metrics:[],
    coverage:{status:rows.some(x=>x.amountMinor===null)?'incomplete':'needs-review',
      reason:'Recorded sales only. Returns, reversals, FIFO COGS and Store Credit are not yet reconciled.'}};
}
/** Source-backed Purchase Register: original invoice totals, never invented net
 * expenditure after returns/settlements or historical cash balances. */
async function purchaseRows(db:SherDatabase,query:LiveReportQuery):Promise<LiveReportPage>{
  const where="COALESCE(is_deleted,0)=0 AND status='Completed' AND purchase_date BETWEEN ? AND ? "+
    "AND (instr(lower(purchase_id),lower(?))>0 OR instr(lower(supplier_name),lower(?))>0)";
  const bind=[query.from,query.to,query.search,query.search] as const;
  const count=await db.prepare('SELECT COUNT(*) AS n FROM purchases WHERE '+where)
    .bind(...bind).first<{n:number}>();
  const order={date:'purchase_date',amount:'grand_total',name:'supplier_name',reference:'purchase_id'}[query.sort];
  const result=await db.prepare(
    'SELECT purchase_id,purchase_date,supplier_name,grand_total,paid_amount,due_amount '+
    'FROM purchases WHERE '+where+' ORDER BY '+order+' '+query.direction.toUpperCase()+
    ',purchase_id DESC LIMIT ? OFFSET ?'
  ).bind(...bind,query.pageSize,(query.page-1)*query.pageSize)
    .all<{purchase_id:string;purchase_date:string;supplier_name:string;grand_total:number;paid_amount:number|null;due_amount:number|null}>();
  const rows:LiveReportRow[]=(result.results||[]).map(x=>{
    const amount=toMinor(x.grand_total);
    const paid=x.paid_amount===null?null:toMinor(x.paid_amount);
    const due=x.due_amount===null?null:toMinor(x.due_amount);
    const split=amount!==null&&paid!==null&&due!==null&&Math.abs(paid+due-amount)<=1;
    return {sourceId:x.purchase_id,sourceModule:'purchases',date:x.purchase_date,label:x.supplier_name,
      amountMinor:amount,paidMinor:split?paid:null,dueMinor:split?due:null,
      status:amount===null?'incomplete':'needs-review',
      reason:amount===null?'Invalid recorded purchase amount.':
        split?'Recorded purchase total and payment split; returns and settlements are not netted.':
          'Original purchase total only; payment split is inconsistent and withheld.'};
  });
  return {ok:true,report:query.report,range:{from:query.from,to:query.to},
    page:query.page,pageSize:query.pageSize,totalRows:Number(count?.n??0),rows,metrics:[],
    coverage:{status:rows.some(x=>x.status==='incomplete')?'incomplete':'needs-review',
      reason:'Recorded completed purchase invoices only; returns and supplier settlements are not netted.'}};
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
      return json(query.report==='sales'?await salesRows(db,query):
        query.report==='purchase'?await purchaseRows(db,query):
        query.report==='profit'?await readSalesProfit(db,query):
        (query.report==='stock'||query.report==='receivables'||query.report==='payables')?
          await readStockDues(db,query):
        (query.report==='cash'||query.report==='bank'||query.report==='finance'||query.report==='expenses')?
          await readCashExpenses(db,query):unavailable(query));
    }
    if(path==='/api/reports/v2/summary') {
      const query=parseLiveReportQuery(url);
      const [profit,stock,receivables,payables,cash]=await Promise.all([
        readSalesProfit(db,{...query,report:'profit'}),
        readStockDues(db,{...query,report:'stock'}),
        readStockDues(db,{...query,report:'receivables'}),
        readStockDues(db,{...query,report:'payables'}),
        readCashExpenses(db,{...query,report:'cash'})
      ]);
      const coverage=[profit.coverage,stock.coverage,receivables.coverage,payables.coverage,cash.coverage];
      const status=coverage.some(x=>x.status==='incomplete')?'incomplete':
        coverage.some(x=>x.status==='unavailable')?'unavailable':
        coverage.some(x=>x.status==='needs-review')?'needs-review':'ready';
      return json({ok:true,range:profit.range,
        metrics:[...profit.metrics.filter(x=>x.key!=='operatingExpenses'),
          ...stock.metrics,...receivables.metrics,...payables.metrics,...cash.metrics],
        coverage:{status,reason:coverage.map(x=>x.reason).filter(Boolean).join(' ')}});
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
