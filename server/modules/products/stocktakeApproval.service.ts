import type { SherDatabase } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
import { findCount,fail,ticks,units,costMinor } from './stocktake.service.js';

type Product={current_stock:number;track_serial:number;track_expiry:number};
type Lot={lot_id:string;source_type:string;original_quantity:number;remaining_quantity:number;unit_cost:number};
type Draw={lotId:string;old:number;take:number;cost:number;moveId:string};

export async function approveStockCount(db:SherDatabase,productId:string,id:string,user:AuthUser):Promise<Response>{
 const count=await findCount(db,productId,id);
 if(!count)return fail('Stock count not found.',404);
 const replay=(v:{cost_minor:number|null;counted_quantity:number})=>Response.json({
  ok:true,countId:id,statusValue:'APPROVED',replayed:true,costMinor:v.cost_minor,remainingStock:v.counted_quantity
 });
 if(count.status==='APPROVED')return replay(count);
 const expected=ticks(count.expected_quantity),counted=ticks(count.counted_quantity);
 const verified=count.verified_unit_cost===null?null:ticks(count.verified_unit_cost);
 if(expected===null||counted===null||expected<0||counted<0)return fail('Invalid count quantities.',409);
 const product=await db.prepare('SELECT current_stock,track_serial,track_expiry FROM products WHERE product_id=? AND is_deleted=0')
  .bind(productId).first<Product>();
 if(!product)return fail('Product not found.',404);
 if(product.track_serial||product.track_expiry)return fail('Tracked stock needs serial/expiry-safe count workflow.',409);
 if(ticks(product.current_stock)!==expected)return fail('Stock changed after count capture. Capture again.',409);
 const delta=counted-expected;
 if(delta>0&&(verified===null||verified<=0))return fail('Surplus requires verified original acquisition cost.',409);
 const lots=(await db.prepare('SELECT lot_id,source_type,original_quantity,remaining_quantity,unit_cost FROM stock_lots WHERE product_id=? ORDER BY created_at ASC,id ASC LIMIT 10001')
  .bind(productId).all<Lot>()).results||[];
 if(lots.length>10000)return fail('FIFO source reconciliation limit exceeded.',409);
 let sum=0;
 const usable:{lotId:string;remaining:number;cost:number}[]=[];
 for(const lot of lots){
  const remaining=ticks(lot.remaining_quantity),original=ticks(lot.original_quantity),cost=ticks(lot.unit_cost);
  if(remaining===null||original===null||cost===null||remaining<0||original<0||remaining>original||cost<0||
     lot.source_type==='OVERSOLD'||!Number.isSafeInteger(sum+remaining))
   return fail('FIFO source lot is inconsistent. Reconcile before approving.',409);
  sum+=remaining;
  if(remaining>0){
   if(cost===0)return fail('Original FIFO lot cost is missing.',409);
   usable.push({lotId:lot.lot_id,remaining,cost});
  }
 }
 if(sum!==expected)return fail('Master and FIFO lot quantities disagree.',409);
 let toTake=-delta,total=0n;
 const draws:Draw[]=[];
 if(delta<0){
  for(const l of usable){
   if(toTake===0)break;
   const take=Math.min(toTake,l.remaining);
   total+=costMinor(take,l.cost);
   if(total>BigInt(Number.MAX_SAFE_INTEGER))return fail('Variance value exceeds safe poisha.');
   draws.push({lotId:l.lotId,old:l.remaining,take,cost:l.cost,moveId:crypto.randomUUID()});
   toTake-=take;
  }
  if(toTake!==0)return fail('Insufficient FIFO lot stock.',409);
 }else if(delta>0&&verified!==null){
  total=costMinor(delta,verified);
  if(total>BigInt(Number.MAX_SAFE_INTEGER))return fail('Variance value exceeds safe poisha.');
 }
 const statements=[
  db.prepare("UPDATE stock_counts SET status=CASE WHEN status='PENDING' THEN 'APPROVED' ELSE json_extract('STALE_COUNT','$') END,approved_by=?,approved_at=datetime('now'),cost_minor=? WHERE product_id=? AND count_id=?")
   .bind(user.userId,Number(total),productId,id)
 ];
 // CAS even on a no-variance count: verify live product and FIFO sum inside the same D1 batch.
 statements.push(db.prepare("UPDATE products SET current_stock=CASE WHEN current_stock=? AND is_deleted=0 AND ABS(COALESCE((SELECT SUM(remaining_quantity) FROM stock_lots WHERE product_id=?),0)-?)<0.00000001 THEN ? ELSE json_extract('STALE_STOCK','$') END,updated_at=CASE WHEN ?=0 THEN updated_at ELSE datetime('now') END WHERE product_id=?")
  .bind(units(expected),productId,units(expected),units(counted),delta,productId));
 for(const d of draws){
  const q=units(d.take),c=units(d.cost);
  statements.push(db.prepare("UPDATE stock_lots SET remaining_quantity=CASE WHEN remaining_quantity=? THEN ? ELSE json_extract('STALE_LOT','$') END,updated_at=datetime('now') WHERE lot_id=? AND product_id=?")
   .bind(units(d.old),units(d.old-d.take),d.lotId,productId));
  statements.push(db.prepare('INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id) VALUES (?,?,?,0,?,?,?,?)')
   .bind(d.moveId,productId,'STOCKTAKE_OUT',q,units(counted),'Physical count '+id,d.lotId));
  statements.push(db.prepare('INSERT INTO stock_count_lots(count_id,lot_id,movement_id,quantity,unit_cost,cost_minor) VALUES (?,?,?,?,?,?)')
   .bind(id,d.lotId,d.moveId,q,c,Number(costMinor(d.take,d.cost))));
 }
 if(delta>0&&verified!==null){
  const lotId=crypto.randomUUID(),moveId=crypto.randomUUID(),q=units(delta),c=units(verified);
  statements.push(db.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost) VALUES (?,?,'OPENING_ADJUSTMENT',?,?,?,?)")
   .bind(lotId,productId,'STOCKTAKE:'+id,q,q,c));
  statements.push(db.prepare('INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id) VALUES (?,?,?, ?,0,?,?,?)')
   .bind(moveId,productId,'STOCKTAKE_IN',q,units(counted),'Physical count '+id,lotId));
  statements.push(db.prepare('INSERT INTO stock_count_lots(count_id,lot_id,movement_id,quantity,unit_cost,cost_minor) VALUES (?,?,?,?,?,?)')
   .bind(id,lotId,moveId,q,c,Number(total)));
 }
 try{await db.batch(statements);}
 catch{
  const latest=await findCount(db,productId,id);
  if(latest?.status==='APPROVED')return replay(latest);
  return fail('Stock changed or a journal write failed; count stays pending.',409);
 }
 return Response.json({ok:true,countId:id,statusValue:'APPROVED',replayed:false,
  costMinor:Number(total),remainingStock:units(counted)});
}
