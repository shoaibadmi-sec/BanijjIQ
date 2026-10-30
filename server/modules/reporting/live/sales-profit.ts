import type { SherDatabase } from '../../../db/types.js';
import { readCashExpenses } from './cash-expenses.js';
import type {
  EvidenceSource, LiveReportPage, LiveReportQuery, LiveReportRow, ReportMetric, ReportStatus
} from './types.js';

type Invoice = {
  invoice_id:string; sale_date:string; customer_name:string; subtotal:number; discount:number;
  grand_total:number; status:string;
};
type Line = {invoice_id:string;product_id:string;quantity:number;line_total:number;product_type?:string};
type Lot = {invoice_id:string;product_id:string;lot_id:string;quantity:number;unit_cost:number;source_type:string|null;lot_product_id:string|null};
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
    db.prepare("SELECT i.invoice_id,i.product_id,i.quantity,i.line_total,COALESCE(p.product_type,'Standard') AS product_type FROM sale_items i JOIN sales s ON s.invoice_id=i.invoice_id LEFT JOIN products p ON p.product_id=i.product_id WHERE "+where)
      .bind(...params).all<Line>(),
    db.prepare("SELECT l.invoice_id,l.product_id,l.lot_id,l.quantity,l.unit_cost,sl.source_type,sl.product_id AS lot_product_id "+
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
  // A virtual bundle is one visible sale item but consumes immutable physical components.
  // Certification requires every source allocation to reconcile to the saved sale-time recipe,
  // physical FIFO lot and stock movement; never infer kit cost from catalog defaults.
  type BundleRecipe={invoice_id:string;bundle_id:string;revision:number;component_id:string;
    quantity_per_set:number;sets_sold:number;component_quantity:number};
  type BundleSource={invoice_id:string;visible_product_id:string;component_id:string;
    lot_id:string;quantity:number;unit_cost:number;cost_minor:number;
    movement_product_id:string|null;movement_quantity:number|null};
  const [bundlesR,sourceR]=await Promise.all([
    db.prepare("SELECT b.invoice_id,b.bundle_id,b.revision,b.component_id,b.quantity_per_set,b.sets_sold,b.component_quantity FROM sale_bundle_components b JOIN sales s ON s.invoice_id=b.invoice_id WHERE "+where)
      .bind(...params).all<BundleRecipe>(),
    db.prepare("SELECT a.invoice_id,a.visible_product_id,a.component_id,a.lot_id,a.quantity,a.unit_cost,a.cost_minor,sm.product_id AS movement_product_id,sm.quantity_out AS movement_quantity FROM bundle_sale_allocations a JOIN sales s ON s.invoice_id=a.invoice_id LEFT JOIN stock_movements sm ON sm.movement_id=a.movement_id WHERE "+where)
      .bind(...params).all<BundleSource>()
  ]);
  const bundleRows=(bundlesR.results||[]).filter(x=>byId.has(x.invoice_id));
  const physicalRows=(sourceR.results||[]).filter(x=>byId.has(x.invoice_id));
  const bundleParents=new Set(lines.filter(x=>x.product_type==='Bundle').map(x=>key(x.invoice_id,x.product_id)));
  const visibleLines=new Map(lines.map(x=>[key(x.invoice_id,x.product_id),x]));
  const soldSources=new Map(lots.map(x=>[lotKey(x.invoice_id,x.product_id,x.lot_id),x]));
  const recipeByComponent=new Map(bundleRows.map(x=>[JSON.stringify([x.invoice_id,x.bundle_id,x.component_id]),x]));
  const recordedPhysical=new Map<string,number>();
  const sourceByLot=new Map<string,BundleSource>();
  for(const a of physicalRows){
    const parent=key(a.invoice_id,a.visible_product_id),lk=lotKey(a.invoice_id,a.visible_product_id,a.lot_id);
    const saleLot=soldSources.get(lk);
    if(sourceByLot.has(lk)||!saleLot||
      !eq(Number(saleLot.quantity),Number(a.quantity))||!eq(Number(saleLot.unit_cost),Number(a.unit_cost))||
      minor(Number(a.quantity)*Number(a.unit_cost))!==Number(a.cost_minor)||
      a.movement_product_id!==a.component_id||!eq(Number(a.movement_quantity),Number(a.quantity))||
      saleLot.lot_product_id!==a.component_id)
      reasons.add('Bundle source FIFO allocation does not match original physical lot and movement.');
    sourceByLot.set(lk,a);
    if(bundleParents.has(parent)){
      const rk=JSON.stringify([a.invoice_id,a.visible_product_id,a.component_id]);
      if(!recipeByComponent.has(rk))reasons.add('Bundle physical draw has no saved sale-time recipe component.');
      recordedPhysical.set(rk,(recordedPhysical.get(rk)||0)+Number(a.quantity));
    }else if(a.visible_product_id!==a.component_id)
      reasons.add('Standalone sale lot has unexpected bundle component provenance.');
  }
  for(const line of lines.filter(x=>x.product_type==='Bundle')){
    const recipes=bundleRows.filter(x=>x.invoice_id===line.invoice_id&&x.bundle_id===line.product_id);
    if(recipes.length<1)reasons.add('Bundle invoice has no immutable component recipe snapshot.');
    for(const recipe of recipes){
      const rk=JSON.stringify([recipe.invoice_id,recipe.bundle_id,recipe.component_id]);
      if(recipe.revision<1||recipe.quantity_per_set<=0||recipe.sets_sold!==Number(line.quantity)||
         !eq(recipe.quantity_per_set*recipe.sets_sold,recipe.component_quantity)||
         !eq(recordedPhysical.get(rk)||0,recipe.component_quantity))
        reasons.add('Bundle invoice physical FIFO quantity does not reconcile to its original recipe.');
    }
  }
  for(const recipe of bundleRows)
    if(!bundleParents.has(key(recipe.invoice_id,recipe.bundle_id))||
      !visibleLines.has(key(recipe.invoice_id,recipe.bundle_id)))
      reasons.add('Orphan bundle recipe has no corresponding visible invoice line.');

  let gross=0,discounts=0,refund=0,cogs=0,expenses=0;
  const soldQty=new Map<string,number>(),soldLineAmounts=new Map<string,number>();
  const lotQty=new Map<string,number>(),lotCosts=new Map<string,number>();
  const returnedQty=new Map<string,number>(),restoredQty=new Map<string,number>();
  const restoredPerLot=new Map<string,number>();
  const returnedByDocument=new Map<string,number>(),restoredByDocument=new Map<string,number>();
  const actualRefunds=new Map<string,number>(),lineRefunds=new Map<string,number>();
  const returnInvoices=new Map(returns.map(x=>[x.return_id,x.invoice_id]));

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
    if(lot.lot_product_id!==lot.product_id && !bundleParents.has(k))
      reasons.add('FIFO lot product does not match recorded sold product.');
    if(bundleParents.has(k)&&!sourceByLot.has(lk))
      reasons.add('Bundle visible line lacks original physical component FIFO provenance.');
    soldLotKeys.set(lk,lot);
    lotQty.set(k,(lotQty.get(k)||0)+quantity);
    lotCosts.set(lk,price);
    const cost=minor(quantity*price);
    if(cost===null)reasons.add('Invalid historical FIFO extended cost.');
    else cogs+=cost;
  }
  for(const [k,qty] of soldQty){
    if(!bundleParents.has(k)&&!eq(qty,lotQty.get(k)||0))
      reasons.add('Sale quantity is not fully backed by FIFO lot allocations.');
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
    if(returnInvoices.get(item.return_id)!==item.invoice_id)
      reasons.add('Return item invoice does not match its refund header invoice.');
    const k=key(item.invoice_id,item.product_id),value=minor(Number(item.line_total));
    if(value===null||value<0||Number(item.return_quantity)<=0)
      reasons.add('Invalid refund line or returned quantity.');
    returnedQty.set(k,(returnedQty.get(k)||0)+Number(item.return_quantity));
    const doc=key(item.return_id,k);
    returnedByDocument.set(doc,(returnedByDocument.get(doc)||0)+Number(item.return_quantity));
    lineRefunds.set(item.return_id,(lineRefunds.get(item.return_id)||0)+(value??0));
  }
  for(const item of returns){
    if(actualRefunds.get(item.return_id)!==(lineRefunds.get(item.return_id)||0))
      reasons.add('Return header does not match actual refund lines.');
  }
  for(const item of returnedLots){
    if(returnInvoices.get(item.return_id)!==item.invoice_id)
      reasons.add('Return lot invoice does not match its refund header invoice.');
    const lk=lotKey(item.invoice_id,item.product_id,item.lot_id),
      k=key(item.invoice_id,item.product_id),qty=Number(item.quantity);
    const price=lotCosts.get(lk);
    const cumulative=(restoredPerLot.get(lk)||0)+qty;
    restoredPerLot.set(lk,cumulative);
    if(cumulative>Number(soldLotKeys.get(lk)?.quantity??0))
      reasons.add('Returned FIFO lot quantity exceeds original sold lot allocation.');
    if(price===undefined||!Number.isFinite(qty)||qty<=0)
      reasons.add('Return lot allocation lacks the original sold FIFO lot.');
    else {
      const reduction=minor(price*qty);
      if(reduction===null) reasons.add('Invalid original-cost reversal amount.');
      else cogs-=reduction;
    }
    restoredQty.set(k,(restoredQty.get(k)||0)+qty);
    const doc=key(item.return_id,k);
    restoredByDocument.set(doc,(restoredByDocument.get(doc)||0)+qty);
    const prior=lotQty.get(k)||0;
    if(qty>prior)reasons.add('Return lot reversal exceeds originally allocated quantity.');
  }
  // Bundle invoices sell *sets* but restore physical component pieces. Never
  // compare set count directly with summed original lot quantities. Instead,
  // audit each compensating source allocation against its original immutable
  // sale draw, physical stock movement and matching return-lot entry.
  type ReturnedBundleSource={
    return_id:string;invoice_id:string;visible_product_id:string;component_id:string;
    lot_id:string;quantity:number;unit_cost:number;cost_minor:number;
    source_allocation_id:number;original_id:number|null;original_visible:string|null;
    original_component:string|null;original_lot:string|null;original_quantity:number|null;
    original_cost_minor:number|null;movement_product:string|null;movement_qty:number|null
  };
  const returnedSourceRows=await db.prepare(
    "SELECT a.return_id,a.invoice_id,a.visible_product_id,a.component_id,a.lot_id,a.quantity,a.unit_cost,a.cost_minor,"+
    "a.source_allocation_id,original.id AS original_id,original.visible_product_id AS original_visible,"+
    "original.component_id AS original_component,original.lot_id AS original_lot,"+
    "original.quantity AS original_quantity,original.cost_minor AS original_cost_minor,"+
    "m.product_id AS movement_product,m.quantity_in AS movement_qty "+
    "FROM bundle_return_allocations a JOIN sales s ON s.invoice_id=a.invoice_id "+
    "LEFT JOIN bundle_sale_allocations original ON original.id=a.source_allocation_id "+
    "LEFT JOIN stock_movements m ON m.movement_id=a.movement_id WHERE "+where
  ).bind(...params).all<ReturnedBundleSource>();
  const returnedSources=returnedSourceRows.results||[];
  const allocationDocTotals=new Map<string,number>();
  const allocationCountByReturn=new Map<string,number>();
  const seenSources=new Set<number>();
  for(const r of returnedSources){
    const soldKey=lotKey(r.invoice_id,r.visible_product_id,r.lot_id);
    const invoiceBundle=bundleRows.some(x=>x.invoice_id===r.invoice_id);
    if(!invoiceBundle||returnInvoices.get(r.return_id)!==r.invoice_id||
       !r.original_id||seenSources.has(r.source_allocation_id)||
       r.original_visible!==r.visible_product_id||
       r.original_component!==r.component_id||r.original_lot!==r.lot_id||
       !eq(Number(r.original_quantity),Number(r.quantity))||
       r.original_cost_minor!==r.cost_minor||
       !eq(Number(soldLotKeys.get(soldKey)?.unit_cost),Number(r.unit_cost))||
       r.movement_product!==r.component_id||
       !eq(Number(r.movement_qty),Number(r.quantity))||
       minor(Number(r.unit_cost)*Number(r.quantity))!==r.cost_minor)
      reasons.add('Cash bundle return does not match immutable original FIFO allocation and physical restoration.');
    seenSources.add(r.source_allocation_id);
    const doc=JSON.stringify([r.return_id,r.invoice_id,r.visible_product_id,r.lot_id]);
    allocationDocTotals.set(doc,(allocationDocTotals.get(doc)||0)+Number(r.quantity));
    allocationCountByReturn.set(r.return_id,(allocationCountByReturn.get(r.return_id)||0)+1);
  }
  const expectedLotReturns=new Map<string,number>();
  for(const lot of returnedLots){
    if(!bundleRows.some(x=>x.invoice_id===lot.invoice_id))continue;
    const doc=JSON.stringify([lot.return_id,lot.invoice_id,lot.product_id,lot.lot_id]);
    expectedLotReturns.set(doc,(expectedLotReturns.get(doc)||0)+Number(lot.quantity));
  }
  for(const [doc,qty] of expectedLotReturns)
    if(!eq(qty,allocationDocTotals.get(doc)||0))
      reasons.add('Full bundle return source lot is missing its immutable physical provenance.');
  for(const [doc,qty] of allocationDocTotals)
    if(!eq(qty,expectedLotReturns.get(doc)||0))
      reasons.add('Physical bundle restoration has no matching return lot audit entry.');
  for(const r of returns){
    if(!bundleRows.some(x=>x.invoice_id===r.invoice_id))continue;
    const expected=physicalRows.filter(x=>x.invoice_id===r.invoice_id).length;
    if(!expected||allocationCountByReturn.get(r.return_id)!==expected)
      reasons.add('Cash bundle refund must restore every originally consumed FIFO source.');
  }
  for(const [k,qty] of returnedQty){
    if(bundleParents.has(k)){
      if(!eq(qty,soldQty.get(k)||0)||!(restoredQty.get(k)||0))
        reasons.add('Cash bundle refund must return complete visible sets and all physical components.');
    }else if(!eq(qty,restoredQty.get(k)||0))
      reasons.add('Missing immutable return lot allocation; cannot infer original FIFO cost.');
    if(qty>(soldQty.get(k)||0))reasons.add('Return quantity exceeds original sale quantity.');
  }
  for(const [doc,qty] of returnedByDocument){
    const originalLineKey=JSON.parse(doc)[1] as string;
    if(!bundleParents.has(originalLineKey)&&!eq(qty,restoredByDocument.get(doc)||0))
      reasons.add('Each return must match its original FIFO lot allocation.');
  }
  for(const doc of restoredByDocument.keys())if(!returnedByDocument.has(doc))
    reasons.add('Return lot allocation has no matching return document line.');
  // Return lots with no matching line must never silently reduce COGS.
  for(const k of restoredQty.keys())if(!returnedQty.has(k))
    reasons.add('Restored lot has no matching recorded return line.');

  for(const exp of expenseRows){
    const amount=minor(Number(exp.amount));
    if(amount===null||amount<0)reasons.add('Invalid recorded operating expense.');
    else expenses+=amount;
  }
  // Finance-v2 independently validates each expense against active cash/bank
  // posting references; a standalone expense header is not proof of net profit.
  const expensePosting=await readCashExpenses(db,{...q,report:'expenses'});
  const expenseMetric=expensePosting.metrics.find(x=>x.key==='operatingExpenses');
  const expensesProven=expensePosting.coverage.status!=='incomplete' &&
    expenseMetric?.valueMinor===expenses && !q.search;
  if(!expensesProven)reasons.add('Expense posting does not reconcile with its cash/bank money-book source.');
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
  // Do not show a sampled period total as if it covered all posted invoices.
  // Source-specific invoice rows below remain individually verifiable.
  const completeCohort=totalRows<=5000;
  const cohortStatus:ReportStatus=completeCohort?(verified?'ready':'needs-review'):'incomplete';
  const cohortReason=(reason:string)=>completeCohort?reason:explanation;
  add('grossSales',completeCohort?gross:null,cohortStatus,cohortReason('Recorded net-of-discount invoice totals; not cash receipts.'),sources);
  add('discounts',completeCohort?discounts:null,cohortStatus,cohortReason('Invoice-level discounts, already included in grossSales.'),sources);
  add('returns',completeCohort?refund:null,cohortStatus,cohortReason('Actual return refund amounts; no second discount factor.'),sources);
  add('netSales',completeCohort?net:null,cohortStatus,cohortReason('Invoice cohort totals less linked recorded refunds.'),sources);
  add('fifoCogs',verified?cogs:null,status,explanation,sources);
  add('grossProfit',verified?net-cogs:null,status,explanation,sources);
  add('operatingExpenses',expensesProven?expenses:null,expensesProven?'ready':'incomplete',
    expensesProven?'Active expenses independently reconciled to posted cash/bank source IDs.':explanation,expenseSources);
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
