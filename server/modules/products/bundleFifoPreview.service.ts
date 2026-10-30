import type { SherDatabase } from '../../db/types.js';

type Line={productId?:unknown;quantityPerSet?:unknown;quantity?:unknown};
type Input={sets?:unknown;components?:unknown;standalone?:unknown};
type Product={product_id:string;current_stock:number;status:string;is_deleted:number;
  track_serial:number;track_expiry:number;track_warranty:number};
type Lot={lot_id:string;source_type:string;original_quantity:number;remaining_quantity:number;unit_cost:number};

const bad=(message:string,status=400)=>Response.json({ok:false,error:message},{status});
function units4(value:unknown):number|null{
  if(typeof value!=='number'||!Number.isFinite(value))return null;
  const scaled=value*10000,rounded=Math.round(scaled);
  return Number.isSafeInteger(rounded)&&Math.abs(scaled-rounded)<0.000001?rounded:null;
}
function whole(value:unknown):number|null{
  return typeof value==='number'&&Number.isSafeInteger(value)&&value>0&&value<=1000000?value:null;
}

/** Read-only inventory quote: does NOT reserve FIFO lots or authorize bundle checkout. */
export async function previewBundleFifo(db:SherDatabase,input:Input):Promise<Response>{
  const sets=whole(input?.sets);
  const components=input?.components,ordinary=input?.standalone??[];
  if(sets===null||!Array.isArray(components)||components.length<1||components.length>30||
    !Array.isArray(ordinary)||ordinary.length>100)return bad('Enter 1–30 distinct components, positive whole sets and valid cart lines.');
  const demands=new Map<string,number>();
  const componentIds=new Set<string>();
  const add=(line:Line, multiplier:number, isComponent:boolean):boolean=>{
    if(!line||typeof line!=='object'||typeof line.productId!=='string'||
      !/^[A-Za-z0-9_-]{1,100}$/.test(line.productId))return false;
    const id=line.productId,q=whole(isComponent?line.quantityPerSet:line.quantity);
    if(q===null||(isComponent&&componentIds.has(id)))return false;
    if(isComponent)componentIds.add(id);
    const demand=q*multiplier,combined=(demands.get(id)??0)+demand;
    if(!Number.isSafeInteger(demand)||!Number.isSafeInteger(combined)||combined>100000000)return false;
    demands.set(id,combined);
    return true;
  };
  for(const line of components)if(!add(line,sets,true))return bad('Bundle components must be distinct Standard products with valid whole base-unit quantities.');
  for(const line of ordinary)if(!add(line,1,false))return bad('Ordinary cart quantities are invalid.');
  if(demands.size>100)return bad('Too many physical products for FIFO preflight.');

  const products:unknown[]=[];
  let grandTotal=0n;
  for(const [id,demand] of demands){
    const product=await db.prepare('SELECT product_id,current_stock,status,is_deleted,track_serial,track_expiry,track_warranty FROM products WHERE product_id=?')
      .bind(id).first<Product>();
    if(!product||product.is_deleted||product.status!=='Active')return bad('Physical component is missing or inactive: '+id,404);
    if(product.track_serial||product.track_expiry||product.track_warranty)return bad('Tracked component requires serial/expiry/warranty-safe allocation: '+id,409);
    const stock=units4(product.current_stock);
    if(stock===null||stock<0)return bad('Invalid product stock master: '+id,409);
    const lots=(await db.prepare('SELECT lot_id,source_type,original_quantity,remaining_quantity,unit_cost FROM stock_lots WHERE product_id=? ORDER BY created_at ASC,id ASC LIMIT 10001')
      .bind(id).all<Lot>()).results??[];
    if(lots.length>10000)return bad('Too many FIFO source lots: '+id,409);
    let physical=0;
    const good:{lot:Lot;remain:number;cost:number}[]=[];
    for(const lot of lots){
      const remaining=units4(lot.remaining_quantity),original=units4(lot.original_quantity),cost=units4(lot.unit_cost);
      if(remaining===null||original===null||cost===null||remaining<0||original<0||remaining>original||cost<0||
        lot.source_type==='OVERSOLD'||!Number.isSafeInteger(physical+remaining))
        return bad('Inconsistent FIFO source lot for component: '+id,409);
      physical+=remaining;
      if(remaining>0){
        if(cost===0)return bad('Missing original acquisition cost for component: '+id,409);
        good.push({lot,remain:remaining,cost});
      }
    }
    if(physical!==stock)return bad('Product and lot source quantities disagree: '+id,409);
    const need=demand*10000;
    if(!Number.isSafeInteger(need)||need>stock)return bad('Insufficient physical FIFO stock for component: '+id,409);
    let remaining=need,costTotal=0n;
    const draws:{lotId:string;quantity:number;unitCost:number;costMinor:number}[]=[];
    for(const source of good){
      if(remaining===0)break;
      const take=Math.min(remaining,source.remain);
      const poisha=(BigInt(take)*BigInt(source.cost)+500000n)/1000000n;
      costTotal+=poisha;
      if(costTotal>BigInt(Number.MAX_SAFE_INTEGER))return bad('Component FIFO value exceeds safe integer poisha.');
      draws.push({lotId:source.lot.lot_id,quantity:take/10000,unitCost:source.cost/10000,costMinor:Number(poisha)});
      remaining-=take;
    }
    if(remaining!==0)return bad('FIFO source shortage for component: '+id,409);
    grandTotal+=costTotal;
    if(grandTotal>BigInt(Number.MAX_SAFE_INTEGER))return bad('Combined FIFO value exceeds safe integer poisha.');
    products.push({productId:id,demand,available:stock/10000,costMinor:Number(costTotal),draws});
  }
  return Response.json({ok:true,readOnly:true,canPostSale:false,
    source:'current-physical-fifo-lots',totalCostMinor:Number(grandTotal),products});
}
