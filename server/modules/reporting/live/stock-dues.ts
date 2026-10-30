import type { SherDatabase } from '../../../db/types.js';
import type { EvidenceSource, LiveReportPage, LiveReportQuery, LiveReportRow, ReportMetric, ReportStatus } from './types.js';

type StockProduct={product_id:string;product_name:string;current_stock:number;status:string;created_at:string};
type StockLot={lot_id:string;product_id:string;remaining_quantity:number;unit_cost:number;source_type:string};
type Party={id:string;name:string;due:number;created_at:string};
type Ledger={id:string;debit:number;credit:number;entry_count:number;ending_balance:number};
const price=(n:number):number|null=>{
  if(!Number.isFinite(n))return null;
  const minor=Math.round(n*100);
  return Number.isSafeInteger(minor)?minor:null;
};
const near=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<0.0001;
const businessToday=()=>new Intl.DateTimeFormat('en-CA',{
  timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'
}).format(new Date());
const evidence=(module:string,id:string):EvidenceSource=>({module,sourceId:id,date:null});
const makeMetric=(key:string,valueMinor:number|null,status:ReportStatus,reason:string,sources:EvidenceSource[],date:string):ReportMetric=>
  ({key,valueMinor,status,reason,asOf:date,sources});
const agingReason='Invoice aging is unavailable: original open-item allocations and settlement chronology are not proven on the current source schema.';
const snapshotReason=(to:string,now:string)=>'Current master/ledger snapshot as of '+now+
  ', not a historical balance as of '+to+'. Aging must not be inferred from ledger dates.';
const page=(q:LiveReportQuery,rows:LiveReportRow[],metrics:ReportMetric[],status:ReportStatus,reason:string,totalRows:number):LiveReportPage=>({
  ok:true,report:q.report,range:{from:q.from,to:q.to},
  page:q.page,pageSize:q.pageSize,totalRows,rows,metrics,coverage:{status,reason}
});

/** GET-only current stock snapshots; no historical stock reconstruction from the requested date. */
async function stock(db:SherDatabase,q:LiveReportQuery):Promise<LiveReportPage>{
  const now=businessToday();
  const [productsR,lotsR]=await Promise.all([
    db.prepare("SELECT product_id,product_name,current_stock,status,created_at FROM products WHERE is_deleted=0 ORDER BY product_id LIMIT 5001")
      .all<StockProduct>(),
    db.prepare("SELECT lot_id,product_id,remaining_quantity,unit_cost,source_type FROM stock_lots ORDER BY product_id,lot_id LIMIT 10001")
      .all<StockLot>()
  ]);
  const products=productsR.results||[],lots=lotsR.results||[];
  const failures:string[]=[];
  const complete=products.length<=5000&&lots.length<=10000;
  if(!complete)failures.push('Stock snapshot exceeds the bounded 5,000-product or 10,000-lot reconciliation limit.');
  const productIds=new Set(products.map(p=>p.product_id));
  const byProduct=new Map<string,StockLot[]>();
  for(const lot of lots){
    if(!productIds.has(lot.product_id)) {
      failures.push('Orphan stock lot '+lot.lot_id+' does not belong to an active catalogue record.');
      continue;
    }
    const values=byProduct.get(lot.product_id)||[];
    values.push(lot);byProduct.set(lot.product_id,values);
  }
  let sum=0;
  const sources:EvidenceSource[]=[];
  const entries=products.map(p=>{
    const owns=byProduct.get(p.product_id)||[];
    const quantity=owns.reduce((n,l)=>n+Number(l.remaining_quantity),0);
    let total=0;
    const problems:string[]=[];
    const current=Number(p.current_stock);
    if(!near(current,quantity))problems.push('Master quantity differs from FIFO lot quantity.');
    if(current<0||quantity<0)problems.push('Negative physical stock must not be valued as a positive asset.');
    for(const lot of owns){
      const units=Number(lot.remaining_quantity),cost=Number(lot.unit_cost);
      if(!Number.isFinite(units)||!Number.isFinite(cost)||units<0||cost<0)
        problems.push('Invalid or negative lot quantity/cost.');
      if(units>0&&cost===0)problems.push('Remaining stock has no original acquisition cost.');
      if(lot.source_type==='OVERSOLD'&&units!==0)
        problems.push('Oversold lot requires stock reconciliation.');
      const value=price(units*cost);
      if(value===null)problems.push('FIFO extended cost is not safely representable.');
      else total+=value;
      if(units>0&&sources.length<20)sources.push(evidence('stock_lots',lot.lot_id));
    }
    const valid=problems.length===0&&Number.isSafeInteger(total);
    if(!valid)failures.push('Product '+p.product_id+': '+problems.join(' '));
    else sum+=total;
    const amountMinor=valid?total:null;
    const row:LiveReportRow={sourceId:p.product_id,sourceModule:'products',date:now,label:p.product_name,
      amountMinor,status:valid?'needs-review':'incomplete',
      reason:valid?'Current FIFO lot snapshot only; stock status: '+p.status+'.':problems.join(' ')};
    return row;
  });
  const filtered=entries.filter(r=>r.sourceId.toLowerCase().includes(q.search.toLowerCase())||
    r.label.toLowerCase().includes(q.search.toLowerCase()));
  const sorts={
    date:(x:LiveReportRow)=>x.date,
    name:(x:LiveReportRow)=>x.label,
    amount:(x:LiveReportRow)=>x.amountMinor??Number.NEGATIVE_INFINITY,
    reference:(x:LiveReportRow)=>x.sourceId
  };
  filtered.sort((a,b)=>{
    const first=sorts[q.sort](a),second=sorts[q.sort](b);
    const cmp=typeof first==='number'&&typeof second==='number'?first-second:String(first).localeCompare(String(second));
    return (q.direction==='asc'?1:-1)*Math.sign(cmp)||a.sourceId.localeCompare(b.sourceId);
  });
  const status:ReportStatus=failures.length?'incomplete':'needs-review';
  const reason=snapshotReason(q.to,now)+(q.search?' Search-filtered rows do not certify whole-shop inventory value.':'')+
    (failures.length?' '+failures.slice(0,5).join(' '):'');
  const metrics=[
    makeMetric('inventoryValue',failures.length||q.search?null:sum,
      failures.length?'incomplete':q.search?'unavailable':status,reason,sources,now),
    makeMetric('stockMismatchCount',null,'unavailable','Quantity mismatch count is diagnostic, not a monetary value.',[],now)
  ];
  return page(q,filtered.slice((q.page-1)*q.pageSize,q.page*q.pageSize),
    metrics,status,reason,filtered.length);
}

/** Master dues and per-party ledger transactions are reconciled by immutable party ID, never name. */
async function dues(db:SherDatabase,q:LiveReportQuery):Promise<LiveReportPage>{
  const now=businessToday(),customer=q.report==='receivables';
  const partyTable=customer?'customers':'suppliers';
  const ledgerTable=customer?'customer_ledger':'supplier_ledger';
  const partyId=customer?'customer_id':'supplier_id';
  const partyName=customer?'customer_name':'supplier_name';
  // Names and balances are taken from the master; debit/credit prove their consistency.
  const [partyR,ledgerR]=await Promise.all([
    db.prepare('SELECT '+partyId+' id,'+partyName+' name,current_due due,created_at FROM '+partyTable+
      ' WHERE is_deleted=0 ORDER BY '+partyId+' LIMIT 5001').all<Party>(),
    db.prepare('SELECT id,COALESCE(SUM(debit),0) debit,COALESCE(SUM(credit),0) credit,COUNT(*) entry_count,'+
      ' MAX(CASE WHEN position=1 THEN balance END) ending_balance FROM ('+
      ' SELECT '+partyId+' id,debit,credit,balance,'+
      ' ROW_NUMBER() OVER (PARTITION BY '+partyId+' ORDER BY date DESC,created_at DESC,ledger_id DESC) position'+
      ' FROM '+ledgerTable+' WHERE is_deleted=0'+
      ') GROUP BY id ORDER BY id LIMIT 5001').all<Ledger>()
  ]);
  const parties=partyR.results||[],ledgers=ledgerR.results||[];
  const ledgerMap=new Map(ledgers.map(x=>[x.id,x]));
  const ids=new Set(parties.map(x=>x.id)), failures:string[]=[];
  if(parties.length>5000||ledgers.length>5000)
    failures.push('Party/ledger limit exceeded; a narrower report is required.');
  for(const rec of ledgers)if(!ids.has(rec.id))
    failures.push('Orphan ledger for party ID '+rec.id+'.');
  let sum=0;
  const sources:EvidenceSource[]=[];
  const rows:LiveReportRow[]=parties.map(p=>{
    const master=price(Number(p.due)),ledger=ledgerMap.get(p.id);
    const calculated=ledger?price(Number(ledger.debit)-Number(ledger.credit)):null;
    const warnings:string[]=[];
    if(master===null||master<0)warnings.push('Invalid or negative master balance.');
    if(!ledger&&master!==0)warnings.push('Non-zero master balance has no supporting ledger.');
    if(ledger&&calculated!==master)warnings.push('Master balance differs from ledger debit minus credit.');
    if(ledger&&calculated===null)warnings.push('Invalid ledger monetary values.');
    if(ledger&&price(Number(ledger.ending_balance))!==master)
      warnings.push('Final running balance differs from master balance.');
    const valid=warnings.length===0;
    if(!valid)failures.push('Party '+p.id+': '+warnings.join(' '));
    else sum+=master??0;
    if(sources.length<20)sources.push(evidence(partyTable,p.id));
    return {sourceId:p.id,sourceModule:partyTable,date:now,label:p.name,
      amountMinor:valid?master:null,status:valid?'needs-review':'incomplete',
      reason:valid?'Current master balance reconciles to ledger by party ID; invoice-level aging is unavailable.':warnings.join(' ')};
  });
  const subset=rows.filter(row=>row.sourceId.toLowerCase().includes(q.search.toLowerCase())
    ||row.label.toLowerCase().includes(q.search.toLowerCase()));
  const getters={
    date:(row:LiveReportRow)=>row.date,name:(row:LiveReportRow)=>row.label,
    reference:(row:LiveReportRow)=>row.sourceId,
    amount:(row:LiveReportRow)=>row.amountMinor??Number.NEGATIVE_INFINITY
  };
  subset.sort((a,b)=>{
    const av=getters[q.sort](a),bv=getters[q.sort](b);
    const cmp=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv));
    return (q.direction==='asc'?1:-1)*Math.sign(cmp)||a.sourceId.localeCompare(b.sourceId);
  });
  const status:ReportStatus=failures.length?'incomplete':'needs-review';
  const reason=snapshotReason(q.to,now)+' '+agingReason+
    (failures.length?' '+failures.slice(0,5).join(' '):'');
  // A search-filtered total is not the same thing as whole-business receivables.
  const total=failures.length||q.search?null:sum;
  const balanceKey=customer?'receivablesBalance':'payablesBalance';
  const metrics=[makeMetric(balanceKey,total,failures.length?'incomplete':'needs-review',reason,sources,now)];
  for(const bucket of ['aging0to30','aging31to60','aging61to90','agingOver90'])
    metrics.push(makeMetric(bucket,null,'unavailable',agingReason,[],now));
  return page(q,subset.slice((q.page-1)*q.pageSize,q.page*q.pageSize),
    metrics,status,reason,subset.length);
}

export async function readStockDues(db:SherDatabase,q:LiveReportQuery):Promise<LiveReportPage>{
  if(q.report==='stock')return stock(db,q);
  if(q.report==='receivables'||q.report==='payables')return dues(db,q);
  throw new Error('Unsupported stock/dues reporting category.');
}
