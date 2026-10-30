import type {SherDatabase,SqlPreparedStatement} from '../../db/types.js';
import type {AuthUser} from '../auth/types.js';
import type {PurchaseReturnInput} from './types.js';
import {quotePurchaseUnits} from './purchaseUnits.js';
import type {UnitProfile} from '../products/unitProfile.js';

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,
 headers:{'content-type':'application/json; charset=utf-8'}});
const fail=(message:string,status=400)=>json({ok:false,error:message},status);
const clean=(s:unknown)=>String(s??'').trim();
const micro=(n:number)=>BigInt(Math.round(n*10000));
type Source={
 productId:string;productName:string;quantity:number;lineTotal:number;
 lotId:string;lotRemaining:number;stock:number;
 baseQuantity:number;profileRevision:number;profileJson:string;description:string;
 priceUnit:string;enteredUnitPrice:number;unitQuantitiesJson:string;
 returned:number;allocatedMicro:number;
 trackSerial:number;trackExpiry:number
};
/** Always calculate refunds from the original *rounded invoice line*, never
 * the current product catalog cost or a user-submitted return price.
 * Allocating cumulative totals avoids rounding drift over partial returns.
 */
export function prorateOriginalPurchaseMicro(
 totalLineMicro:bigint,originalQty:number,priorQty:number,returnQty:number
):bigint{
 if(!Number.isSafeInteger(originalQty)||originalQty<=0||!Number.isSafeInteger(priorQty)||
   !Number.isSafeInteger(returnQty)||priorQty<0||returnQty<=0||
   priorQty+returnQty>originalQty||totalLineMicro<0n)
    throw Error('Return exceeds the original purchased quantity.');
 const den=BigInt(originalQty);
 const round=(qty:number)=>(BigInt(qty)*totalLineMicro+den/2n)/den;
 return round(priorQty+returnQty)-round(priorQty);
}
async function fetchSource(db:SherDatabase,purchaseId:string):Promise<{purchase:any;lines:Source[]}|null>{
 const purchase=await db.prepare(`SELECT * FROM purchases
  WHERE purchase_id=? AND COALESCE(is_deleted,0)=0`)
  .bind(purchaseId).first<Record<string,unknown>>();
 if(!purchase)return null;
 const result=await db.prepare(`
  SELECT p.product_id AS productId,p.product_name AS productName,p.quantity,
   p.line_total AS lineTotal,s.lot_id AS lotId,
   sl.remaining_quantity AS lotRemaining,pr.current_stock AS stock,
   s.base_quantity AS baseQuantity,s.profile_revision AS profileRevision,
   s.profile_json AS profileJson,s.description,
   s.price_unit AS priceUnit,s.entered_unit_price AS enteredUnitPrice,
   s.quantities_json AS unitQuantitiesJson,
   COALESCE((SELECT SUM(a.base_quantity) FROM purchase_unit_return_allocations a
    WHERE a.purchase_id=p.purchase_id AND a.product_id=p.product_id),0) AS returned,
   COALESCE((SELECT SUM(a.return_micro) FROM purchase_unit_return_allocations a
    WHERE a.purchase_id=p.purchase_id AND a.product_id=p.product_id),0) AS allocatedMicro,
   pr.track_serial AS trackSerial,pr.track_expiry AS trackExpiry
  FROM purchase_items p
  LEFT JOIN purchase_unit_snapshots s ON s.purchase_id=p.purchase_id AND s.product_id=p.product_id
  LEFT JOIN stock_lots sl ON sl.lot_id=s.lot_id
  LEFT JOIN products pr ON pr.product_id=p.product_id
  WHERE p.purchase_id=? ORDER BY p.id`).bind(purchaseId).all<Source>();
 return {purchase,lines:result.results||[]};
}
export async function getMixedPurchaseForReturn(db:SherDatabase,purchaseId:string):Promise<Response>{
 const source=await fetchSource(db,purchaseId);
 if(!source)return fail('Purchase not found.',404);
 const items=source.lines.map(line=>{
   const supported=!!line.lotId&&!line.trackSerial&&!line.trackExpiry;
   const availableQty=supported?Math.max(0,Math.min(
     Number(line.baseQuantity)-Number(line.returned),Number(line.lotRemaining),Number(line.stock))):0;
   return {productId:line.productId,productName:line.productName,
     boughtQty:line.quantity,unitPrice:line.baseQuantity?Number(line.lineTotal)/line.baseQuantity:0,
     previouslyReturnedQty:line.returned,availableQty,
     unitDescription:line.description||'',originalLineTotal:line.lineTotal,returnSupported:supported,
     unsupportedReason:line.trackSerial||line.trackExpiry
       ?'Tracked serial/expiry returns require a separate verified path'
       :line.lotId?'':'Mixed purchase cannot return a non-snapshotted line yet',
     unitSnapshot:supported?{revision:line.profileRevision,
       profile:JSON.parse(line.profileJson) as UnitProfile,
       quantities:JSON.parse(line.unitQuantitiesJson),priceUnit:line.priceUnit,
       enteredUnitPrice:line.enteredUnitPrice,
       description:line.description,sourceLotId:line.lotId}:null
   };
 });
 const returnedMicro=source.lines.reduce((n,x)=>n+BigInt(Math.round(Number(x.allocatedMicro)||0)),0n);
 return json({ok:true,purchase:{purchaseId,
   supplierId:source.purchase.supplier_id,supplierName:source.purchase.supplier_name,
   grandTotal:source.purchase.grand_total,paidAmount:source.purchase.paid_amount,
   previouslyReturnedAmount:Number(returnedMicro)/10000,
   netPurchase:Number(source.purchase.grand_total)-Number(returnedMicro)/10000,items}});
}
export async function completeMixedPurchaseReturn(
 db:SherDatabase,input:PurchaseReturnInput,user:AuthUser
):Promise<Response>{
 const purchaseId=clean(input.purchaseId);
 const requestId=clean(input.clientRequestId);
 if(!/^[0-9a-f-]{32,36}$/i.test(requestId))
   return fail('A unique clientRequestId is required for safe purchase-return posting.');
 const reason=clean(input.reason);
 if(!reason)return fail('Return reason is required.');
 if(input.refundMethod!=='Supplier Credit')
   return fail('Mixed-unit cash refunds are not enabled until Phase 4D. Use Supplier Credit.');
 const date=clean(input.date)||new Date().toISOString().slice(0,10);
 const today=new Date().toISOString().slice(0,10);
 if(date<today&&!clean(input.backdatedReason))
   return fail('Backdated return requires a reason.');
 const items=Array.isArray(input.items)?input.items:[];
 if(!items.length||items.length>100)return fail('Select products to return.');
 // Canonical request identity is independent of the current unit profile.
 const canonical=JSON.stringify({purchaseId,reason,refundMethod:input.refundMethod,
  date,items:items.map(i=>({productId:clean(i.productId),
    unitQuantities:i.unitQuantities||null})).sort((a,b)=>a.productId.localeCompare(b.productId))});
 const prior=await db.prepare('SELECT payload_json AS payload,return_id AS returnId,total_amount AS total FROM purchase_unit_return_requests WHERE request_id=?')
  .bind(requestId).first<{payload:string;returnId:string;total:number}>();
 if(prior)return prior.payload===canonical
   ?json({ok:true,returnId:prior.returnId,totalReturnAmount:prior.total,idempotent:true})
   :fail('Return request ID was already used for a different return.',409);
 const source=await fetchSource(db,purchaseId);
 if(!source)return fail('Purchase not found.',404);
 if(Number(source.purchase.discount||0)!==0)
   return fail('Discounted mixed purchase returns require discount allocation review.',409);
 if(!source.purchase.supplier_id)return fail('Supplier reference missing.',409);
 const supplier=await db.prepare('SELECT current_due AS due FROM suppliers WHERE supplier_id=? AND COALESCE(is_deleted,0)=0')
  .bind(String(source.purchase.supplier_id)).first<{due:number}>();
 if(!supplier)return fail('Supplier not found.',409);
 const balance=await db.prepare(`SELECT COALESCE(SUM(debit-credit),0) AS due FROM supplier_ledger
   WHERE supplier_id=? AND COALESCE(is_deleted,0)=0`)
   .bind(String(source.purchase.supplier_id)).first<{due:number}>();
 if(Math.abs(Number(balance?.due||0)-Number(supplier.due||0))>0.0001)
   return fail('Supplier master/ledger mismatch. Reconcile before returning.',409);
 const byId=new Map(source.lines.map(s=>[s.productId,s]));
 const seen=new Set<string>();
 const prepared:Array<{line:Source;quantity:number;amountMicro:bigint;description:string;
   map:Record<string,number>}>=[];let total=0n;
 for(let i=0;i<items.length;i++){
  const item=items[i], id=clean(item.productId);
  if(!id||seen.has(id))return fail('Duplicate or missing return product.');
  seen.add(id);
  const line=byId.get(id);
  if(!line||!line.lotId)return fail('Only snapshotted mixed-unit purchase lines can be returned.',409);
  if(Number(line.trackSerial)||Number(line.trackExpiry))
    return fail('Tracked serial/expiry return is not yet supported for mixed units.',409);
  if(!Number.isSafeInteger(Number(line.baseQuantity))||
    !Number.isSafeInteger(Number(line.returned)))
    return fail('Original quantity records require reconciliation.',409);
  if(!item.unitQuantities)return fail('Return quantity must use the frozen purchase unit profile.');
  let q;
  try{q=quotePurchaseUnits(JSON.parse(line.profileJson) as UnitProfile,line.profileRevision,
    item.unitQuantities,line.priceUnit,Number(line.enteredUnitPrice));}
  catch(e){return fail('Return quantity: '+(e instanceof Error?e.message:String(e)));}
  if(item.qty!==undefined&&Number(item.qty)!==q.baseQuantity)
    return fail('Base-unit return quantity does not match entered units.',409);
  if(item.unitPrice!==undefined||item.returnPrice!==undefined)
    return fail('Return price cannot override original purchase cost.',409);
  const qty=q.baseQuantity;
  if(qty>Number(line.lotRemaining)||qty>Number(line.stock)||
    qty+Number(line.returned)>Number(line.baseQuantity))
    return fail('Return exceeds unsold source lot, stock or original purchase quantity.',409);
  const invoiceMicro=micro(Number(line.lineTotal));
  const amountMicro=prorateOriginalPurchaseMicro(invoiceMicro,Number(line.baseQuantity),Number(line.returned),qty);
  const parsed=q.unitQuantities;
  const descriptor=q.description;
  total+=amountMicro;
  prepared.push({line,quantity:qty,amountMicro,description:descriptor,map:parsed});
 }
 if(!prepared.length||total>100000000000000n)return fail('Invalid return amount.');
 const value=Number(total)/10000;
 if(value>Number(supplier.due)+0.000001)
  return fail('Supplier credit exceeds current payable. Cash refund reconciliation is required.',409);
 // Use a separate namespace: legacy PRTN-###### numbering parses digits from IDs.
 const returnId='MPRTN-'+crypto.randomUUID();
 const batch:SqlPreparedStatement[]=[];
 batch.push(db.prepare(`INSERT INTO purchase_returns
  (return_id,return_date,purchase_id,supplier_id,supplier_name,total_return_amount,
   refund_method,reason,notes,processed_by,is_backdated,backdated_reason,created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`).bind(
    returnId,date,purchaseId,String(source.purchase.supplier_id),
    String(source.purchase.supplier_name||''),value,'Supplier Credit',reason,
    clean(input.notes),user.userId,date<today?1:0,clean(input.backdatedReason)
  ));
 batch.push(db.prepare(`INSERT INTO purchase_unit_return_requests
   (request_id,payload_json,return_id,total_amount) VALUES (?,?,?,?)`)
   .bind(requestId,canonical,returnId,value));
 for(const item of prepared){
  const s=item.line;
  batch.push(db.prepare(`INSERT INTO purchase_unit_return_allocations
    (return_id,purchase_id,product_id,lot_id,base_quantity,previous_return_quantity,
     return_micro,quantities_json,description)
    VALUES (?,?,?,?,?,?,?,?,?)`).bind(returnId,purchaseId,s.productId,s.lotId,
      item.quantity,Number(s.returned),Number(item.amountMicro),
      JSON.stringify(item.map),item.description));
  batch.push(db.prepare(`UPDATE stock_lots
    SET remaining_quantity=remaining_quantity-?,updated_at=datetime('now'),
    status=CASE WHEN remaining_quantity-?>0 THEN 'Active' ELSE 'Depleted' END
    WHERE lot_id=?`).bind(item.quantity,item.quantity,s.lotId));
  batch.push(db.prepare(`UPDATE products
    SET current_stock=current_stock-?,updated_at=datetime('now') WHERE product_id=?`)
    .bind(item.quantity,s.productId));
  batch.push(db.prepare(`INSERT INTO stock_movements
    (movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,lot_id,note,created_at)
    VALUES (?,?,'Purchase Return',0,?,(SELECT current_stock FROM products WHERE product_id=?),?,?,datetime('now'))`)
    .bind(crypto.randomUUID(),s.productId,item.quantity,s.productId,s.lotId,returnId));
  batch.push(db.prepare(`INSERT INTO purchase_return_items
    (return_id,purchase_id,product_id,product_name,return_quantity,return_price,line_total)
    VALUES (?,?,?,?,?,?,?)`).bind(returnId,purchaseId,s.productId,s.productName,item.quantity,
      Number(s.lineTotal)/Number(s.baseQuantity),Number(item.amountMicro)/10000));
 }
 batch.push(db.prepare(`UPDATE purchases SET returned_amount=COALESCE(returned_amount,0)+?,
  updated_at=datetime('now') WHERE purchase_id=?`).bind(value,purchaseId));
 batch.push(db.prepare(`UPDATE suppliers SET current_due=current_due-?,updated_at=datetime('now')
   WHERE supplier_id=?`).bind(value,String(source.purchase.supplier_id)));
 batch.push(db.prepare(`INSERT INTO supplier_ledger
  (ledger_id,date,supplier_id,supplier_name,type,reference,debit,credit,balance,notes,created_by,created_at)
  VALUES (?,?,?,?, 'Mixed Purchase Return Credit',?,0,?,
   (SELECT current_due FROM suppliers WHERE supplier_id=?),?,?,datetime('now'))`).bind(
    crypto.randomUUID(),date,String(source.purchase.supplier_id),
    String(source.purchase.supplier_name||''),returnId,value,
    String(source.purchase.supplier_id),reason,user.userId));
 batch.push(db.prepare(`INSERT INTO audit_logs (user_id,action,entity_type,entity_id,note)
  VALUES (?,'PURCHASE_RETURN','PURCHASE_RETURN',?,?)`).bind(
    user.userId,returnId,'Original-lot mixed return for '+purchaseId+' — '+reason));
 try{await db.batch(batch);}
 catch(e){
  const message=String(e);
  if(/UNIQUE|constraint|stale_purchase|original_purchase|insufficient_stock|negative|credit_exceeds|forced/i.test(message))
    return fail('Purchase return conflicted with changed inventory or duplicate request. Refresh before posting.',409);
  throw e;
 }
 return json({ok:true,returnId,totalReturnAmount:value});
}
