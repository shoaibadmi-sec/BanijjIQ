import type { SherDatabase } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';

export type StockCount={count_id:string;product_id:string;expected_quantity:number;counted_quantity:number;
 verified_unit_cost:number|null;note:string;status:'PENDING'|'APPROVED';
 cost_minor:number|null;created_by:string;approved_by:string|null};
type CountInput={countId?:unknown;countedQuantity?:unknown;verifiedUnitCost?:unknown;note?:unknown};

export const fail=(error:string,status=400)=>Response.json({ok:false,error},{status});
export function ticks(v:unknown):number|null{
 if(typeof v!=='number'||!Number.isFinite(v))return null;
 const n=v*10000,r=Math.round(n);
 return Number.isSafeInteger(r)&&Math.abs(n-r)<0.000001?r:null;
}
export const units=(n:number)=>n/10000;
export const costMinor=(q:number,c:number)=>(BigInt(q)*BigInt(c)+500000n)/1000000n;
export const findCount=(db:SherDatabase,productId:string,countId:string)=>
 db.prepare('SELECT * FROM stock_counts WHERE product_id=? AND count_id=?')
  .bind(productId,countId).first<StockCount>();

export async function captureStockCount(db:SherDatabase,productId:string,input:CountInput,user:AuthUser):Promise<Response>{
 const id=input?.countId,q=ticks(input?.countedQuantity),rawNote=input?.note;
 const note=typeof rawNote==='string'?rawNote.trim():'';
 const verified=input?.verifiedUnitCost===undefined?null:ticks(input.verifiedUnitCost);
 if(typeof id!=='string'||!/^[A-Za-z0-9_-]{12,100}$/.test(id)||q===null||q<0||
    note.length>200||(rawNote!==undefined&&typeof rawNote!=='string')||
    (input?.verifiedUnitCost!==undefined&&(verified===null||verified<=0)))
  return fail('Valid count ID and nonnegative four-decimal counted quantity are required.');
 const product=await db.prepare('SELECT current_stock FROM products WHERE product_id=? AND is_deleted=0')
   .bind(productId).first<{current_stock:number}>();
 if(!product)return fail('Product not found.',404);
 const expected=ticks(product.current_stock);
 if(expected===null||expected<0)return fail('Stock master is invalid. Reconcile first.',409);
 if(q>expected&&(!verified||verified<=0))
  return fail('Surplus inventory requires explicitly verified original acquisition cost.');
 try{
  await db.prepare('INSERT INTO stock_counts(count_id,product_id,expected_quantity,counted_quantity,verified_unit_cost,note,created_by) VALUES (?,?,?,?,?,?,?)')
   .bind(id,productId,units(expected),units(q),verified===null?null:units(verified),note,user.userId).run();
 }catch{return fail('Count ID already exists or capture failed.',409);}
 return Response.json({ok:true,countId:id,statusValue:'PENDING',expectedQuantity:units(expected),
  countedQuantity:units(q),variance:units(q-expected)});
}

export async function readStockCount(db:SherDatabase,productId:string,id:string):Promise<Response>{
 const c=await findCount(db,productId,id);
 if(!c)return fail('Stock count not found.',404);
 return Response.json({ok:true,count:{countId:c.count_id,productId:c.product_id,
  expectedQuantity:c.expected_quantity,countedQuantity:c.counted_quantity,
  verifiedUnitCost:c.verified_unit_cost,note:c.note,status:c.status,
  costMinor:c.cost_minor,createdBy:c.created_by,approvedBy:c.approved_by}});
}
