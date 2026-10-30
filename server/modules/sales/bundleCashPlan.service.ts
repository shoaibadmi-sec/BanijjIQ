import type {SherDatabase} from '../../db/types.js';
import type {PosSaleInput} from './types.js';

type Product={product_id:string;product_name:string;unit:string;current_stock:number;
 product_type:string;bundle_revision:number;selling_price:number;status:string;is_deleted:number;
 track_serial:number;track_expiry:number;track_warranty:number};
type Recipe={component_id:string;quantity_per_set:number;unit_snapshot:string};
type Lot={lot_id:string;remaining_quantity:number;original_quantity:number;unit_cost:number;
 supplier_id:string;source_type:string};
export type CashLine={productId:string;name:string;qty:number;price:number;lineMinor:number;bundle:boolean};
export type RecipeSnapshot={bundleId:string;revision:number;componentId:string;perSet:number;sets:number;physicalQty:number;unit:string};
export type FifoDraw={visibleId:string;physicalId:string;lotId:string;qty:number;unitCost:number;
 supplierId:string;minor:number};
export type PhysicalUpdate={productId:string;stockBefore:number;stockAfter:number;
 lots:{lotId:string;before:number;after:number}[]};
export type CashPlan={lines:CashLine[];recipes:RecipeSnapshot[];draws:FifoDraw[];updates:PhysicalUpdate[];
 totalMinor:number;costMinor:number};
const err=(s:string):never=>{throw new Error(s);};
function ticks(v:unknown):number{
 if(typeof v!=='number'||!Number.isFinite(v))return err('Invalid FIFO quantity or acquisition cost.');
 const n=v*10000,r=Math.round(n);
 if(!Number.isSafeInteger(r)||Math.abs(r-n)>0.000001)return err('FIFO quantity/cost precision exceeds four decimals.');
 return r;
}
function whole(v:unknown):number{
 if(typeof v!=='number'||!Number.isSafeInteger(v)||v<1||v>1000000)return err('Enter positive whole base-unit quantities.');
 return v;
}

/** Plans visible invoice rows and one FIFO draw per physical product, including mixed cart demand. */
export async function planBundleCashSale(db:SherDatabase,input:PosSaleInput):Promise<CashPlan>{
 if(!Array.isArray(input?.items)||input.items.length<1||input.items.length>50)return err('Cart must contain 1–50 items.');
 const lines:CashLine[]=[],recipes:RecipeSnapshot[]=[];
 const demand=new Map<string,{parent:string;qty:number}[]>();
 const seen=new Set<string>();
 let totalMinor=0,hasBundle=false;
 for(const item of input.items){
  const id=item.productId,qty=whole(item.qty),price=item.unitPrice;
  if(typeof id!=='string'||!id||seen.has(id)||typeof price!=='number'||!Number.isFinite(price)||
     price<0||Math.abs(price*100-Math.round(price*100))>0.000001)return err('Invalid or repeated cart item / selling price.');
  seen.add(id);
  const product=await db.prepare('SELECT product_id,product_name,unit,current_stock,product_type,bundle_revision,selling_price,status,is_deleted,track_serial,track_expiry,track_warranty FROM products WHERE product_id=?')
    .bind(id).first<Product>();
  if(!product||product.is_deleted||product.status==='Inactive')return err('Cart item is missing or inactive: '+id);
  if(product.track_serial||product.track_expiry||product.track_warranty)return err('Tracked/warranty items are not available for guarded bundle cash posting.');
  if(item.fulfillmentMode==='vendor'||item.fulfillmentMode==='negative'||item.vendorId||
     item.unitQuantities!==undefined||item.unitProfileRevision!==undefined||item.serialNumbers?.length)
    return err('Vendor, negative stock, tracking and mixed units need separate posting support.');
  if(product.product_type==='Bundle'&&Math.round(price*100)!==Math.round(product.selling_price*100))
    return err('Bundle price changed. Refresh the saved recipe.');
  const money=Math.round(price*100)*qty;
  if(!Number.isSafeInteger(money)||!Number.isSafeInteger(totalMinor+money)||totalMinor+money>1e11)
    return err('Sale amount exceeds safe poisha range.');
  totalMinor+=money;const bundle=product.product_type==='Bundle';hasBundle ||=bundle;
  lines.push({productId:id,name:product.product_name,qty,price,lineMinor:money,bundle});
  if(bundle){
   if(product.bundle_revision<1)return err('Virtual bundle has no saved recipe.');
   const result=await db.prepare('SELECT component_id,quantity_per_set,unit_snapshot FROM bundle_components WHERE bundle_id=? AND revision=? ORDER BY id')
    .bind(id,product.bundle_revision).all<Recipe>();
   const rows=result.results??[];
   if(rows.length<1||rows.length>30)return err('Bundle recipe is missing or unsupported.');
   for(const row of rows){
    const perSet=whole(row.quantity_per_set);
    const physicalQty=qty*perSet;
    if(!Number.isSafeInteger(physicalQty)||physicalQty>100000000)return err('Component demand exceeds safe quantity.');
    recipes.push({bundleId:id,revision:product.bundle_revision,componentId:row.component_id,
      perSet,sets:qty,physicalQty,unit:row.unit_snapshot});
    const prior=demand.get(row.component_id)??[];
    prior.push({parent:id,qty:physicalQty});demand.set(row.component_id,prior);
   }
  }else if(product.product_type==='Standard'){
   const prior=demand.get(id)??[];prior.push({parent:id,qty});demand.set(id,prior);
  }else return err('Unknown product type.');
 }
 if(!hasBundle)return err('Use ordinary POS for carts without a virtual bundle.');
 const draws:FifoDraw[]=[],updates:PhysicalUpdate[]=[];
 let totalCost=0n;
 for(const [pid,contributions] of demand){
  const p=await db.prepare('SELECT product_id,current_stock,product_type,status,is_deleted,track_serial,track_expiry,track_warranty FROM products WHERE product_id=?')
   .bind(pid).first<Product>();
  if(!p||p.product_type!=='Standard'||p.is_deleted||p.status==='Inactive'||
     p.track_serial||p.track_expiry||p.track_warranty)return err('Physical component unavailable or tracked: '+pid);
  const oldStock=ticks(p.current_stock);if(oldStock<0)return err('Negative physical master stock: '+pid);
  const lots=(await db.prepare('SELECT lot_id,remaining_quantity,original_quantity,unit_cost,supplier_id,source_type FROM stock_lots WHERE product_id=? ORDER BY created_at ASC,id ASC LIMIT 10001')
   .bind(pid).all<Lot>()).results??[];
  if(lots.length>10000)return err('Too many FIFO source lots: '+pid);
  let source=0;
  const available:{lot:Lot;before:number;cost:number;remaining:number}[]=[];
  for(const lot of lots){
   const left=ticks(lot.remaining_quantity),orig=ticks(lot.original_quantity),cost=ticks(lot.unit_cost);
   if(left<0||orig<0||left>orig||cost<0||lot.source_type==='OVERSOLD'||
      !Number.isSafeInteger(source+left))return err('Corrupt physical FIFO source: '+pid);
   source+=left;
   if(left>0){if(cost<=0)return err('Original acquisition cost missing: '+pid);
    available.push({lot,before:left,remaining:left,cost});}
  }
  if(source!==oldStock)return err('FIFO/master stock discrepancy: '+pid);
  const demandTicks=contributions.reduce((n,x)=>n+x.qty*10000,0);
  if(!Number.isSafeInteger(demandTicks)||demandTicks>oldStock)return err('Insufficient physical source FIFO stock: '+pid);
  for(const contribution of contributions){
   let need=contribution.qty*10000;
   for(const sourceLot of available){
    if(need===0)break;
    if(sourceLot.remaining===0)continue;
    const take=Math.min(need,sourceLot.remaining),minor=(BigInt(take)*BigInt(sourceLot.cost)+500000n)/1000000n;
    totalCost+=minor;
    if(totalCost>BigInt(Number.MAX_SAFE_INTEGER))return err('Unsafe component acquisition value.');
    draws.push({visibleId:contribution.parent,physicalId:pid,lotId:sourceLot.lot.lot_id,
      qty:take/10000,unitCost:sourceLot.cost/10000,supplierId:sourceLot.lot.supplier_id||'',minor:Number(minor)});
    sourceLot.remaining-=take;need-=take;
   }
   if(need!==0)return err('FIFO source exhaustion: '+pid);
  }
  updates.push({productId:pid,stockBefore:oldStock/10000,stockAfter:(oldStock-demandTicks)/10000,
   lots:available.filter(x=>x.before!==x.remaining).map(x=>({lotId:x.lot.lot_id,before:x.before/10000,after:x.remaining/10000}))});
 }
 return {lines,recipes,draws,updates,totalMinor,costMinor:Number(totalCost)};
}
