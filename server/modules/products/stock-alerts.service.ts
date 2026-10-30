import type { SherDatabase } from '../../db/types.js';

type Product = {
  productId:string; productName:string; currentStock:number; minimumStock:number; trackExpiry:number;
};
type Lot = {lotId:string; productId:string; originalQuantity:number; remainingQuantity:number; trackingRequiredQuantity?:number; trackingStatus?:string};
type Batch = {expiryBatchId:string; lotId:string; productId:string; expiryDate:string; remainingQuantity:number};
type AlertKind = 'needs-review'|'out-of-stock'|'low-stock'|'expired'|'expiring';
type Alert = {
  kind:AlertKind; productId:string; productName:string; currentStock:number; minimumStock:number;
  sourceStatus:'ready'|'needs-review'; reason?:string; shortfallToMinimum?:number;
  expiryDate?:string; expiryBatchId?:string; lotId?:string; quantity?:number;
};
const DAY_MS=86400000;
const MAX_TICKS=Number.MAX_SAFE_INTEGER;
function ticks(raw:unknown):number|null {
  if(typeof raw!=='number' || !Number.isFinite(raw) || raw<0) return null;
  const scaled=raw*10000;
  if(scaled>MAX_TICKS || Math.abs(scaled-Math.round(scaled))>1e-7) return null;
  return Math.round(scaled);
}
function dateUtc(text:string):number|null {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const time=Date.parse(text+'T00:00:00.000Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,10)===text?time:null;
}
function positiveInteger(value:string|null,min:number,max:number):number|null {
  if(value===null)return null;
  if(!/^\d+$/.test(value))return null;
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>=min&&n<=max?n:null;
}
function response(data:unknown,status=200):Response {
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}});
}
export function evaluateStockAlerts(products:Product[],lots:Lot[],batches:Batch[],asOf:string,days:number):Alert[] {
  const reference=dateUtc(asOf);
  if(reference===null || !Number.isSafeInteger(days) || days<0 || days>90) throw new Error('Invalid alert date or days');
  const lotMap=new Map<string,Lot[]>();
  const lotById=new Map<string,Lot>();
  for(const lot of lots){
    if(!lotMap.has(lot.productId))lotMap.set(lot.productId,[]);
    lotMap.get(lot.productId)!.push(lot);
    lotById.set(lot.lotId,lot);
  }
  const batchMap=new Map<string,Batch[]>();
  for(const batch of batches){
    if(!batchMap.has(batch.productId))batchMap.set(batch.productId,[]);
    batchMap.get(batch.productId)!.push(batch);
  }
  const alerts:Alert[]=[];
  for(const product of products){
    const base={productId:product.productId,productName:product.productName,currentStock:product.currentStock,minimumStock:product.minimumStock};
    const current=ticks(product.currentStock);
    const minimum=ticks(product.minimumStock);
    const sourceLots=lotMap.get(product.productId)||[];
    let reason='';
    if(current===null || minimum===null) reason='Invalid stock or minimum stock quantity';
    let lotTotal=0;
    for(const lot of sourceLots){
      const original=ticks(lot.originalQuantity), remaining=ticks(lot.remainingQuantity);
      if(original===null || remaining===null || remaining>original) reason='Invalid source FIFO lot quantity';
      else if(lotTotal>MAX_TICKS-remaining) reason='Source FIFO lot quantity overflow';
      else lotTotal+=remaining;
    }
    if(!reason && lotTotal!==current) reason='Product stock differs from source FIFO lots';
    const productBatches=batchMap.get(product.productId)||[];
    const batchTotalByLot=new Map<string,number>();
    for(const batch of productBatches){
      const remaining=ticks(batch.remainingQuantity);
      const source=lotById.get(batch.lotId);
      if(!source||source.productId!==product.productId||remaining===null||dateUtc(batch.expiryDate)===null) {
        reason='Invalid or unlinked expiry batch source';continue;
      }
      const before=batchTotalByLot.get(batch.lotId)||0;
      if(before>MAX_TICKS-remaining)reason='Expiry batch quantity overflow';
      else batchTotalByLot.set(batch.lotId,before+remaining);
    }
    for(const [lotId,batchTotal] of batchTotalByLot){
      const remaining=ticks(lotById.get(lotId)!.remainingQuantity);
      if(remaining===null||batchTotal>remaining)reason='Expiry batch exceeds its source FIFO lot';
    }
    if(product.trackExpiry){
      for(const lot of sourceLots){
        const remaining=ticks(lot.remainingQuantity);
        const pending=ticks(lot.trackingRequiredQuantity ?? 0);
        const assigned=batchTotalByLot.get(lot.lotId)||0;
        if(remaining===null || pending===null || pending>remaining || assigned>remaining || assigned+pending!==remaining){
          reason='Expiry tracking does not reconcile with the remaining FIFO lot';
        }else if(pending>0 || lot.trackingStatus==='Pending'){
          reason='Expiry tracking pending for source FIFO lot';
        }
      }
    }
    if(reason){
      alerts.push({...base,kind:'needs-review',sourceStatus:'needs-review',reason});
      continue; // Never issue authoritative shortage or expiry advice from contradictory source records.
    }
    if(current===0)alerts.push({...base,kind:'out-of-stock',sourceStatus:'ready',shortfallToMinimum:Math.max(0,(minimum!-current!)/10000)});
    else if(current!<=minimum!)alerts.push({...base,kind:'low-stock',sourceStatus:'ready',shortfallToMinimum:(minimum!-current!)/10000});
    if(product.trackExpiry){
      for(const batch of productBatches){
        const qty=ticks(batch.remainingQuantity)!;
        if(qty===0)continue;
        const offset=(dateUtc(batch.expiryDate)!-reference)/DAY_MS;
        if(offset<0 || offset<=days){
          alerts.push({...base,kind:offset<0?'expired':'expiring',sourceStatus:'ready',
            expiryBatchId:batch.expiryBatchId,lotId:batch.lotId,expiryDate:batch.expiryDate,quantity:qty/10000});
        }
      }
    }
  }
  const priority:Record<AlertKind,number>={'needs-review':0,'out-of-stock':1,'expired':2,'low-stock':3,'expiring':4};
  alerts.sort((a,b)=>priority[a.kind]-priority[b.kind] || a.productName.localeCompare(b.productName) || a.productId.localeCompare(b.productId) || (a.expiryDate||'').localeCompare(b.expiryDate||'') || (a.expiryBatchId||'').localeCompare(b.expiryBatchId||''));
  return alerts;
}
export async function getStockAlertsRoute(db:SherDatabase,request:Request):Promise<Response> {
  const query=new URL(request.url).searchParams;
  const asOf=query.get('asOf')??new Date().toISOString().slice(0,10);
  const days=query.has('days')?positiveInteger(query.get('days'),0,90):30;
  const page=query.has('page')?positiveInteger(query.get('page'),1,1000000):1;
  const pageSize=query.has('pageSize')?positiveInteger(query.get('pageSize'),50,100):50;
  if(dateUtc(asOf)===null || days===null || page===null || pageSize===null || ![50,100].includes(pageSize)){
    return response({ok:false,error:'Invalid asOf date, days (0-90), page, or pageSize (50/100)'},400);
  }
  const [pr,lr,br]=await Promise.all([
    db.prepare(`SELECT product_id AS productId,product_name AS productName,current_stock AS currentStock,
      minimum_stock AS minimumStock,track_expiry AS trackExpiry FROM products
      WHERE COALESCE(is_deleted,0)=0 AND status!='Inactive'`).all<Product>(),
    db.prepare(`SELECT lot_id AS lotId,product_id AS productId,original_quantity AS originalQuantity,
      remaining_quantity AS remainingQuantity, tracking_required_quantity AS trackingRequiredQuantity,
      tracking_status AS trackingStatus FROM stock_lots`).all<Lot>(),
    db.prepare(`SELECT expiry_batch_id AS expiryBatchId,lot_id AS lotId,product_id AS productId,
      expiry_date AS expiryDate,remaining_quantity AS remainingQuantity FROM stock_expiry_batches`).all<Batch>()
  ]);
  const productSet=new Set(pr.results.map(p=>p.productId));
  const alerts=evaluateStockAlerts(pr.results,lr.results.filter(l=>productSet.has(l.productId)),br.results.filter(b=>productSet.has(b.productId)),asOf,days);
  const counts={outOfStock:0,lowStock:0,expired:0,expiring:0,needsReview:0};
  const keys:Record<AlertKind,keyof typeof counts>={'out-of-stock':'outOfStock','low-stock':'lowStock',expired:'expired',expiring:'expiring','needs-review':'needsReview'};
  for(const alert of alerts)counts[keys[alert.kind]]++;
  return response({ok:true,asOf,horizonDays:days,page,pageSize,totalAlerts:alerts.length,counts,
    coverage:{status:counts.needsReview?'needs-review':'ready',reason:counts.needsReview?'One or more products have unreconciled source inventory':'Source FIFO lots reconciled'},
    alerts:alerts.slice((page-1)*pageSize,page*pageSize)});
}
