import type { SherDatabase } from '../../db/types.js';

type Product = { product_id:string; product_name:string; current_stock:number };
type Lot = { remaining_quantity:number };
type Movement = {
  id:number; movement_id:string; created_at:string; movement_type:string;
  quantity_in:number; quantity_out:number; balance_after:number;
  lot_id:string|null; note:string|null;
};
type Issue =
  'MISSING_MOVEMENTS'|'MOVEMENT_LIMIT'|'LOT_LIMIT'|'INVALID_MASTER_QUANTITY'|
  'INVALID_LOT_QUANTITY'|'INVALID_MOVEMENT_QUANTITY'|'INVALID_MOVEMENT_BALANCE'|
  'NEGATIVE_STOCK'|'MASTER_LOT_MISMATCH'|'MASTER_MOVEMENT_MISMATCH'|'LATEST_BALANCE_MISMATCH';

function ticks(value: unknown): number|null {
  if (typeof value!=='number' || !Number.isFinite(value)) return null;
  const scaled=value*10000, rounded=Math.round(scaled);
  return Number.isSafeInteger(rounded) && Math.abs(scaled-rounded)<0.000001 ? rounded : null;
}
function quantity(value: number|null):number|null {
  return value===null?null:value/10000;
}

/**
 * A read-only quantity ledger over existing stock sources. No inferred movement
 * records, historical valuation, or per-lot running balance reconstruction.
 */
export async function readStockLedger(db:SherDatabase,productId:string,page=1,pageSize:50|100=50) {
  const product=await db.prepare(
    'SELECT product_id,product_name,current_stock FROM products WHERE product_id=? AND is_deleted=0'
  ).bind(productId).first<Product>();
  if (!product) return null;

  const [lotRows,movementRows]=await Promise.all([
    db.prepare('SELECT remaining_quantity FROM stock_lots WHERE product_id=? ORDER BY id LIMIT 10001')
      .bind(productId).all<Lot>(),
    db.prepare('SELECT id,movement_id,created_at,movement_type,quantity_in,quantity_out,balance_after,lot_id,note FROM stock_movements WHERE product_id=? ORDER BY id DESC LIMIT 10001')
      .bind(productId).all<Movement>()
  ]);
  const issues=new Set<Issue>();
  const lots=lotRows.results||[],movements=movementRows.results||[];
  if(lots.length>10000)issues.add('LOT_LIMIT');
  if(movements.length>10000)issues.add('MOVEMENT_LIMIT');
  if(!movements.length)issues.add('MISSING_MOVEMENTS');

  const master=ticks(product.current_stock);
  if(master===null)issues.add('INVALID_MASTER_QUANTITY');
  if(master!==null&&master<0)issues.add('NEGATIVE_STOCK');

  let lotTotal=0,lotValid=true;
  for(const lot of lots) {
    const q=ticks(lot.remaining_quantity);
    if(q===null || q<0 || !Number.isSafeInteger(lotTotal+q)) {
      lotValid=false;issues.add('INVALID_LOT_QUANTITY');
    } else lotTotal+=q;
  }
  const lotStock=lotValid&&lots.length<=10000?lotTotal:null;

  let movementTotal=0,movementValid=true;
  for(const m of movements) {
    const input=ticks(m.quantity_in),output=ticks(m.quantity_out);
    if(input===null || output===null || input<0 || output<0 ||
       !Number.isSafeInteger(movementTotal+input-output)) {
      movementValid=false;issues.add('INVALID_MOVEMENT_QUANTITY');
    } else movementTotal+=input-output;
    const balance=ticks(m.balance_after);
    if(balance===null)issues.add('INVALID_MOVEMENT_BALANCE');
    if(balance!==null&&balance<0)issues.add('NEGATIVE_STOCK');
  }
  const recordedNet=movementValid&&movements.length<=10000?movementTotal:null;
  if(master!==null&&lotStock!==null&&master!==lotStock)issues.add('MASTER_LOT_MISMATCH');
  if(master!==null&&recordedNet!==null&&master!==recordedNet)issues.add('MASTER_MOVEMENT_MISMATCH');
  // A multi-lot POS sale has several same-final-balance rows. Only the latest
  // recorded balance is comparable with the current master snapshot.
  if(master!==null&&movements.length) {
    const latest=ticks(movements[0].balance_after);
    if(latest!==null&&latest!==master)issues.add('LATEST_BALANCE_MISMATCH');
  }

  const offset=(page-1)*pageSize;
  const totalRows=movements.length<=10000?movements.length:
    Number((await db.prepare('SELECT COUNT(*) AS n FROM stock_movements WHERE product_id=?')
      .bind(productId).first<{n:number}>())?.n??movements.length);
  const visible=offset+pageSize<=10000?
    movements.slice(offset,offset+pageSize):
    (await db.prepare('SELECT id,movement_id,created_at,movement_type,quantity_in,quantity_out,balance_after,lot_id,note FROM stock_movements WHERE product_id=? ORDER BY id DESC LIMIT ? OFFSET ?')
      .bind(productId,pageSize,offset).all<Movement>()).results||[];

  return {
    ok:true as const,productId:product.product_id,productName:product.product_name,
    page,pageSize,totalRows,
    integrity:{
      status:issues.size?'needs-review' as const:'ready' as const,
      issues:[...issues], masterStock:quantity(master),
      lotStock:quantity(lotStock),recordedNet:quantity(recordedNet)
    },
    items:visible.map(m=>({
      movementId:m.movement_id,date:m.created_at,type:m.movement_type,
      quantityIn:m.quantity_in,quantityOut:m.quantity_out,
      balanceAfter:m.balance_after,lotId:m.lot_id,note:m.note??''
    }))
  };
}
