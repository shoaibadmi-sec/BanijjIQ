import type { SherDatabase } from '../../../db/types.js';
import type {
  EvidenceSource, LiveReportPage, LiveReportQuery, LiveReportRow, ReportMetric, ReportStatus
} from './types.js';

type Invoice = {
  invoice_id:string; sale_date:string; customer_name:string; subtotal:number; discount:number;
  grand_total:number; status:string;
};
type Line = {invoice_id:string;product_id:string;quantity:number;line_total:number};
type Lot = {invoice_id:string;product_id:string;lot_id:string;quantity:number;unit_cost:number;source_type:string|null};
type ReturnHeader = {return_id:string;invoice_id:string;return_date:string;total_return_amount:number};
type ReturnLine = {return_id:string;invoice_id:string;product_id:string;return_quantity:number;line_total:number};
type ReturnLot = {return_id:string;invoice_id:string;product_id:string;lot_id:string;quantity:number};
type Expense = {expense_id:string;expense_date:string;amount:number};

const minor = (value:number):number|null => {
  if (!Number.isFinite(value)) return null;
  const cents=Math.round(value*100);
  return Number.isSafeInteger(cents)?cents:null;
};
const eq=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<0.00001;
const key=(invoice:string,product:string)=>JSON.stringify([invoice,product]);
const lotKey=(invoice:string,product:string,lot:string)=>JSON.stringify([invoice,product,lot]);
const source=(module:string,sourceId:string,date:string):EvidenceSource=>({module,sourceId,date});

/**
 * Invoice-date cohort report. Returns linked to the selected invoices are
 * accounted at their ACTUAL refund amount, never discounted a second time.
 * A return outside the cohort period prevents period-profit certification.
 * No cost is inferred from today's price or stock lot balance.
 */
export async function readSalesProfit(db:SherDatabase,q:LiveReportQuery):Promise<LiveReportPage> {
  const where="s.is_deleted=0 AND s.status IN ('Completed','Reversed') "+
    "AND s.sale_date BETWEEN ? AND ? AND (instr(lower(s.invoice_id),lower(?))>0 "+
    "OR instr(lower(s.customer_name),lower(?))>0)";
  const params=[q.from,q.to,q.search,q.search] as const;
  const count=await db.prepare("SELECT COUNT(*) n FROM sales s WHERE "+where)
    .bind(...params).first<{n:number}>();
  const totalRows=Number(count?.n??0);
  const sample=await db.prepare(
    "SELECT s.invoice_id,s.sale_date,s.customer_name,s.subtotal,s.discount,s.grand_total,s.status "+
    "FROM sales s WHERE "+where+" ORDER BY s.sale_date DESC,s.invoice_id DESC LIMIT 5001"
  ).bind(...params).all<Invoice>();
  const invoices=sample.results||[];
  const byId=new Map(invoices.map(x=>[x.invoice_id,x]));
  const reasons=new Set<string>();
  if(q.search.trim())reasons.add('Search-filtered invoice profit cannot allocate whole-shop operating expenses to one customer; remove the search filter for period profit.');
  if(totalRows>5000)reasons.add('More than 5,000 invoices: split the date range before trusting aggregate profit.');

  const [linesR,lotsR,returnsR,returnLinesR,returnLotsR,expensesR,reversalsR,vendorR]=await Promise.all([
    db.prepare("SELECT i.invoice_id,i.product_id,i.quantity,i.line_total FROM sale_items i JOIN sales s ON s.invoice_id=i.invoice_id WHERE "+where)
      .bind(...params).all<Line>(),
    db.prepare("SELECT l.invoice_id,l.product_id,l.lot_id,l.quantity,l.unit_cost,sl.source_type "+
      "FROM sale_item_lots l JOIN sales s ON s.invoice_id=l.invoice_id LEFT JOIN stock_lots sl ON sl.lot_id=l.lot_id WHERE "+where)
      .bind(...params).all<Lot>(),
    db.prepare("SELECT r.return_id,r.invoice_id,r.return_date,r.total_return_amount FROM sales_returns r "+
      "JOIN sales s ON s.invoice_id=r.invoice_id WHERE "+where)
      .bind(...params).all<ReturnHeader>(),
    db.prepare("SELECT i.return_id,i.invoice_id,i.product_id,i.return_quantity,i.line_total "+
      "FROM sales_return_items i JOIN sales s ON s.invoice_id=i.invoice_id WHERE "+where)
      .bind(...params).all<ReturnLine>(),
    db.prepare("SELECT l.return_id,l.invoice_id,l.product_id,l.lot_id,l.quantity FROM sales_return_item_lots l "+
      "JOIN sales s ON s.invoice_id=l.invoice_id WHERE "+where)
      .bind(...params).all<ReturnLot>(),
    db.prepare("SELECT expense_id,expense_date,amount FROM expenses "+
      "WHERE is_deleted=0 AND status NOT IN ('Cancelled','Deleted') AND expense_date BETWEEN ? AND ?")
      .bind(q.from,q.to).all<Expense>(),
    db.prepare("SELECT r.invoice_id FROM sale_reversal_logs r JOIN sales s ON s.invoice_id=r.invoice_id WHERE "+where)
      .bind(...params).all<{invoice_id:string}>(),
    db.prepare("SELECT v.invoice_id FROM vendor_sourcing v JOIN sales s ON s.invoice_id=v.invoice_id WHERE "+where)
      .bind(...params).all<{invoice_id:string}>()
  ]);

  const lines=(linesR.results||[]).filter(x=>byId.has(x.invoice_id));
  const lots=(lotsR.results||[]).filter(x=>byId.has(x.invoice_id));
  const returns=(returnsR.results||[]).filter(x=>byId.has(x.invoice_id));
  const returnedLines=(returnLinesR.results||[]).filter(x=>byId.has(x.invoice_id));
  const returnedLots=(returnLotsR.results||[]).filter(x=>byId.has(x.invoice_id));
  const expenseRows=expensesR.results||[];
  const originalReversals=new Set((reversalsR.results||[]).map(x=>x.invoice_id));
  const vendorInvoices=new Set((vendorR.results||[]).map(x=>x.invoice_id));
  let gross=0,discounts=0,refund=0,cogs=0,expenses=0;
  const soldQty=new Map<string,number>(),soldLineAmounts=new Map<string,number>();
  const lotQty=new Map<string,number>(),lotCosts=new Map<string,number>();
  const returnedQty=new Map<string,number>(),restoredQty=new Map<string,number>();
  const actualRefunds=new Map<string,number>(),lineRefunds=new Map<string,number>();

  for(const inv of invoices){
    const invAmount=minor(Number(inv.grand_total)),sub=minor(Number(inv.subtotal)),
      discount=minor(Number(inv.discount));
    if(invAmount===null||sub===null||discount===null||
      invAmount<0||sub<0||discount<0||sub-discount!==invAmount)
      reasons.add('Invoice subtotal, discount or recorded total does not reconcile.');
    else {gross+=invAmount;discounts+=discount;}
    if(inv.status==='Reversed'&&!originalReversals.has(inv.invoice_id))
      reasons.add('A reversed invoice has no immutable reversal log.');
    if(vendorInvoices.has(inv.invoice_id))
      reasons.add('Vendor-sourced quantities have no certified FIFO cost basis.');
  }
  for(const line of lines){
    const k=key(line.invoice_id,line.product_id);
    if(!Number.isFinite(Number(line.quantity))||Number(line.quantity)<=0||minor(Number(line.line_total))===null)
      reasons.add('Invalid sale item quantity or price.');
    soldQty.set(k,(soldQty.get(k)||0)+Number(line.quantity));
    soldLineAmounts.set(line.invoice_id,(soldLineAmounts.get(line.invoice_id)||0)+(minor(Number(line.line_total))??0));
  }
  for(const inv of invoices){
    if(!lines.some(x=>x.invoice_id===inv.invoice_id))
      reasons.add('Invoice lacks immutable sale item lines.');
    if(soldLineAmounts.get(inv.invoice_id)!==minor(Number(inv.subtotal)))
      reasons.add('Sale item totals do not reconcile to invoice subtotal.');
  }
  const soldLotKeys=new Map<string,Lot>();
  for(const lot of lots){
    const k=key(lot.invoice_id,lot.product_id),lk=lotKey(lot.invoice_id,lot.product_id,lot.lot_id);
    const quantity=Number(lot.quantity),price=Number(lot.unit_cost);
    if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(price)||price<=0||
      lot.source_type===null||lot.source_type==='OVERSOLD')
      reasons.add('Missing, zero or non-FIFO historical lot cost.');
    soldLotKeys.set(lk,lot);
    lotQty.set(k,(lotQty.get(k)||0)+quantity);
    lotCosts.set(lk,price);
    const cost=minor(quantity*price);
    if(cost===null)reasons.add('Invalid historical FIFO extended cost.');
    else cogs+=cost;
  }
  for(const [k,qty] of soldQty){
    if(!eq(qty,lotQty.get(k)||0))reasons.add('Sale quantity is not fully backed by FIFO lot allocations.');
  }

  for(const item of returns){
    const amount=minor(Number(item.total_return_amount));
    if(amount===null||amount<0)reasons.add('Invalid recorded return amount.');
    else {
      refund+=amount;
      actualRefunds.set(item.return_id,amount);
    }
    if(item.return_date<q.from||item.return_date>q.to)
      reasons.add('A linked return was posted outside the selected period; period profit cannot be certified.');
  }
  for(const item of returnedLines){
    const k=key(item.invoice_id,item.product_id),value=minor(Number(item.line_total));
    if(value===null||value<0||Number(item.return_quantity)<=0)
      reasons.add('Invalid refund line or returned quantity.');
    returnedQty.set(k,(returnedQty.get(k)||0)+Number(item.return_quantity));
    lineRefunds.set(item.return_id,(lineRefunds.get(item.return_id)||0)+(value??0));
  }
  for(const item of returns){
    if(actualRefunds.get(item.return_id)!==(lineRefunds.get(item.return_id)||0))
      reasons.add('Return header does not match actual refund lines.');
  }
  for(const item of returnedLots){
    const lk=lotKey(item.invoice_id,item.product_id,item.lot_id),
      k=key(item.invoice_id,item.product_id),qty=Number(item.quantity);
    const price=lotCosts.get(lk);
    if(price===undefined||!Number.isFinite(qty)||qty<=0)
      reasons.add('Return lot allocation lacks the original sold FIFO lot.');
    else {
      const reduction=minor(price*qty);
      if(reduction===null) reasons.add('Invalid original-cost reversal amount.');
      else cogs-=reduction;
    }
    restoredQty.set(k,(restoredQty.get(k)||0)+qty);
    const prior=lotQty.get(k)||0;
    if(qty>prior)reasons.add('Return lot reversal exceeds originally allocated quantity.');
  }
  for(const [k,qty] of returnedQty){
    if(!eq(qty,restoredQty.get(k)||0))
      reasons.add('Missing immutable return lot allocation; cannot infer original FIFO cost.');
    if(qty>(soldQty.get(k)||0))reasons.add('Return quantity exceeds original sale quantity.');
  }
  // Return lots with no matching line must never silently reduce COGS.
  for(const k of restoredQty.keys())if(!returnedQty.has(k))
    reasons.add('Restored lot has no matching recorded return line.');

  for(const exp of expenseRows){
    const amount=minor(Number(exp.amount));
    if(amount===null||amount<0)reasons.add('Invalid recorded operating expense.');
    else expenses+=amount;
  }
  const net=gross-refund;
  if(net<0)reasons.add('Refunds exceed recorded invoice totals.');
  if(cogs<0)reasons.add('Original-cost reversals exceed recorded FIFO cost.');
  const verified=reasons.size===0;
  const status:ReportStatus=verified?'ready':'incomplete';
  const explanation=verified
    ?'Invoice-date cohort, actual posted refunds and immutable FIFO lot reversals reconcile; operating expenses use the selected date window.'
    :[...reasons].join(' ');
  const sources:EvidenceSource[]=invoices.slice(0,20).map(x=>source('sales',x.invoice_id,x.sale_date));
  const expenseSources:EvidenceSource[]=expenseRows.slice(0,20).map(x=>source('expenses',x.expense_id,x.expense_date));
  const metrics:ReportMetric[]=[];
  const add=(key:string,value:number|null,metricStatus:ReportStatus,
    reason:string,linked:EvidenceSource[])=>{
    metrics.push({key,valueMinor:value,status:metricStatus,reason,asOf:q.to,sources:linked});
  };
  // Even when cost is incomplete, a validated sale's source amounts are
  // visible. They must never be represented as reconciled profit.
  add('grossSales',gross,verified?'ready':'needs-review','Recorded net-of-discount invoice totals; not cash receipts.',sources);
  add('discounts',discounts,verified?'ready':'needs-review','Invoice-level discounts, already included in grossSales.',sources);
  add('returns',refund,verified?'ready':'needs-review','Actual return refund amounts; no second discount factor.',sources);
  add('netSales',net,verified?'ready':'needs-review','Invoice cohort totals less linked recorded refunds.',sources);
  add('fifoCogs',verified?cogs:null,status,explanation,sources);
  add('grossProfit',verified?net-cogs:null,status,explanation,sources);
  add('operatingExpenses',expenses,verified?'ready':'needs-review','Active recorded expenses dated within the selected period.',expenseSources);
  add('netProfit',verified?net-cogs-expenses:null,status,explanation,[...sources,...expenseSources]);
  const totalsByInvoice=new Map(invoices.map(inv=>[inv.invoice_id,minor(Number(inv.grand_total))??0]));
  for(const item of returns)
    totalsByInvoice.set(item.invoice_id,(totalsByInvoice.get(item.invoice_id)||0)-
      (actualRefunds.get(item.return_id)||0));
  const sortField={
    date:(x:Invoice)=>x.sale_date,amount:(x:Invoice)=>totalsByInvoice.get(x.invoice_id)||0,
    name:(x:Invoice)=>x.customer_name,reference:(x:Invoice)=>x.invoice_id
  }[q.sort];
  invoices.sort((a,b)=>{
    const lhs=sortField(a),rhs=sortField(b),dir=q.direction==='asc'?1:-1;
    const cmp=typeof lhs==='number'&&typeof rhs==='number'?lhs-rhs:String(lhs).localeCompare(String(rhs));
    return cmp!==0?dir*Math.sign(cmp):b.invoice_id.localeCompare(a.invoice_id);
  });
  const rows:LiveReportRow[]=invoices.slice((q.page-1)*q.pageSize,q.page*q.pageSize)
    .map(x=>({sourceId:x.invoice_id,sourceModule:'sales',date:x.sale_date,
      label:x.customer_name,amountMinor:totalsByInvoice.get(x.invoice_id)??null,
      status,reason:verified?'Net of actual refunds for this invoice cohort.':explanation}));
  return {
    ok:true,report:q.report,range:{from:q.from,to:q.to},page:q.page,pageSize:q.pageSize,
    totalRows,rows,metrics,coverage:{status,reason:explanation}
  };
}
