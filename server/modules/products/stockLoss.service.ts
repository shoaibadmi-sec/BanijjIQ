import type { SherDatabase } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
type StockLossInput={clientRequestId?:unknown;reason?:unknown;quantity?:unknown;note?:unknown};
type Product={product_id:string;current_stock:number;track_serial:number;track_expiry:number};
type Lot={lot_id:string;original_quantity:number;remaining_quantity:number;unit_cost:number;source_type:string};
type Saved={request_id:string;product_id:string;reason:string;quantity:number;note:string;cost_minor:number};
const json=(data:unknown,status=200)=>Response.json(data,{status});
const fail=(error:string,status=400)=>json({ok:false,error},status);
function ticks(value:unknown):number|null{
  if(typeof value!=='number'||!Number.isFinite(value))return null;
  const t=value*10000,r=Math.round(t);
  return Number.isSafeInteger(r)&&Math.abs(t-r)<0.000001?r:null;
}
const quantity=(n:number)=>n/10000;

/** An immutable costed stock loss, committed with all its FIFO draws in one D1 batch. */
export async function postStockLoss(db:SherDatabase,productId:string,input:StockLossInput,user:AuthUser):Promise<Response>{
  const requestId=input?.clientRequestId,reason=input?.reason,rawNote=input?.note;
  const note=typeof rawNote==='string'?rawNote.trim():'',amount=ticks(input?.quantity);
  if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{12,100}$/.test(requestId)||
      (reason!=='DAMAGE'&&reason!=='WASTAGE')||amount===null||amount<=0||
      (rawNote!==undefined&&typeof rawNote!=='string')||note.length>200)
    return fail('A valid request ID, DAMAGE/WASTAGE reason and positive four-decimal quantity are required.');
  const matches=(row:Saved)=>row.product_id===productId&&row.reason===reason&&ticks(row.quantity)===amount&&row.note===note;
  const original=await db.prepare('SELECT request_id,product_id,reason,quantity,note,cost_minor FROM inventory_losses WHERE request_id=?')
    .bind(requestId).first<Saved>();
  const replay=(row:Saved)=>json({ok:true,replayed:true,requestId,quantity:row.quantity,costMinor:row.cost_minor});
  if(original)return matches(original)?replay(original):fail('Request ID already used for another stock loss.',409);
  const product=await db.prepare('SELECT product_id,current_stock,track_serial,track_expiry FROM products WHERE product_id=? AND is_deleted=0')
    .bind(productId).first<Product>();
  if(!product)return fail('Product not found.',404);
  if(product.track_serial||product.track_expiry)return fail('Tracked products require a serial/expiry-safe loss workflow.',409);
  const previous=ticks(product.current_stock);
  if(previous===null||previous<0)return fail('Stock master is invalid. Reconcile first.',409);
  if(amount>previous)return fail('Insufficient available stock for loss.');
  const lots=(await db.prepare('SELECT lot_id,original_quantity,remaining_quantity,unit_cost,source_type FROM stock_lots WHERE product_id=? ORDER BY created_at ASC,id ASC')
    .bind(productId).all<Lot>()).results||[];
  let physical=0;
  const available:{lot:Lot;remaining:number;cost:number}[]=[];
  for(const lot of lots){
    const remaining=ticks(lot.remaining_quantity),originalQuantity=ticks(lot.original_quantity),cost=ticks(lot.unit_cost);
    if(remaining===null||originalQuantity===null||cost===null||remaining<0||originalQuantity<0||
       remaining>originalQuantity||cost<0||lot.source_type==='OVERSOLD'||!Number.isSafeInteger(physical+remaining))
      return fail('FIFO lot sources are inconsistent. Reconcile first.',409);
    physical+=remaining;
    if(remaining>0){
      if(cost===0)return fail('Original FIFO acquisition cost is missing. Reconcile first.',409);
      available.push({lot,remaining,cost});
    }
  }
  if(physical!==previous)return fail('Stock lot/master balances do not match. Reconcile first.',409);
  let toTake=amount,total=0n;
  const draws:{lot:Lot;old:number;next:number;qty:number;minor:number;movementId:string}[]=[];
  for(const a of available){
    if(toTake===0)break;
    const take=Math.min(toTake,a.remaining);
    const minor=(BigInt(take)*BigInt(a.cost)+500000n)/1000000n;
    total+=minor;
    if(total>BigInt(Number.MAX_SAFE_INTEGER))return fail('Loss acquisition cost exceeds safe monetary range.');
    draws.push({lot:a.lot,old:a.remaining,next:a.remaining-take,qty:quantity(take),
      minor:Number(minor),movementId:crypto.randomUUID()});
    toTake-=take;
  }
  if(toTake!==0)return fail('Insufficient available FIFO lot stock.',409);
  const newStock=quantity(previous-amount);
  const statements=[
    db.prepare('INSERT INTO inventory_losses(request_id,product_id,reason,quantity,note,cost_minor,created_by) VALUES (?,?,?,?,?,?,?)')
      .bind(requestId,productId,reason,quantity(amount),note,Number(total),user.userId),
    db.prepare("UPDATE products SET current_stock=CASE WHEN current_stock=? AND is_deleted=0 THEN ? ELSE json_extract('STALE_STOCK_SNAPSHOT','$') END,updated_at=datetime('now') WHERE product_id=?")
      .bind(quantity(previous),newStock,productId)
  ];
  for(const a of draws){
    statements.push(db.prepare("UPDATE stock_lots SET remaining_quantity=CASE WHEN remaining_quantity=? THEN ? ELSE json_extract('STALE_FIFO_LOT','$') END,updated_at=datetime('now'),status=CASE WHEN ?=0 THEN 'Depleted' ELSE 'Active' END WHERE lot_id=? AND product_id=?")
      .bind(quantity(a.old),quantity(a.next),quantity(a.next),a.lot.lot_id,productId));
    statements.push(db.prepare('INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id) VALUES (?,?,?,0,?,?,?,?)')
      .bind(a.movementId,productId,reason,a.qty,newStock,'Stock loss '+requestId+': '+note,a.lot.lot_id));
    statements.push(db.prepare('INSERT INTO inventory_loss_lots(request_id,lot_id,movement_id,quantity,unit_cost,cost_minor) VALUES (?,?,?,?,?,?)')
      .bind(requestId,a.lot.lot_id,a.movementId,a.qty,a.lot.unit_cost,a.minor));
  }
  try{await db.batch(statements);}
  catch{
    const committed=await db.prepare('SELECT request_id,product_id,reason,quantity,note,cost_minor FROM inventory_losses WHERE request_id=?')
      .bind(requestId).first<Saved>();
    if(committed)return matches(committed)?replay(committed):fail('Request ID already used for another loss.',409);
    return fail('Stock changed or posting failed; no stock loss was saved.',409);
  }
  return json({ok:true,replayed:false,requestId,quantity:quantity(amount),
    costMinor:Number(total),remainingStock:newStock});
}
