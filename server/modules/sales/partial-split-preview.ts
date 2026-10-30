import type {SherDatabase} from '../../db/types.js';
import {getSplitSaleReversalPreviewRoute} from './split-reversal.js';
import {allocatePartialSplitRefund} from './partial-split-refunds.js';

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json; charset=utf-8'}
});

/** Read-only, source-reconciled quote. Not a posting endpoint. */
export async function getPartialSplitRefundPreviewRoute(
  db:SherDatabase,invoiceId:string,url:URL
):Promise<Response>{
  const keys=[...url.searchParams.keys()];
  const productId=url.searchParams.get('productId')||'';
  const quantityText=url.searchParams.get('quantity')||'';
  if(keys.length!==2||keys.some(key=>!['productId','quantity'].includes(key))||
    !productId||productId.trim()!==productId||!/^[1-9]\d*$/.test(quantityText))
    return json({ok:false,error:'Select an original product and a positive whole quantity.'},400);
  const quantity=Number(quantityText);
  if(!Number.isSafeInteger(quantity))
    return json({ok:false,error:'Return quantity is outside the supported range.'},400);
  const matched=await db.prepare(
    'SELECT quantity,unit_price,line_total FROM sale_items WHERE invoice_id=? AND product_id=?'
  ).bind(invoiceId,productId).all<any>();
  const lines=matched.results||[];
  if(lines.length!==1||quantity>Number(lines[0]?.quantity))
    return json({ok:false,error:'Return quantity exceeds the original sold item.'},400);
  const original=await (await getSplitSaleReversalPreviewRoute(db,invoiceId)).json() as any;
  if(!original.ok||!original.preview?.eligible)
    return json({ok:false,error:original.preview?.reason||'Original source books cannot be verified.'},409);
  const price=Number(lines[0].unit_price)*100;
  const amountCents=Math.round(price)*quantity;
  if(!Number.isSafeInteger(Math.round(price))||Math.abs(price-Math.round(price))>0.00001||
    !Number.isSafeInteger(amountCents)||amountCents<=0||
    amountCents>original.preview.totalCents)
    return json({ok:false,error:'Original unit price does not reconcile to integer poisha.'},409);
  const sources=original.preview.allocations as {sourceKey:string;amountCents:number}[];
  const allocations=allocatePartialSplitRefund(sources,[],amountCents);
  return json({ok:true,preview:{
    invoiceId,productId,quantity,amountCents,allocations,
    postingEnabled:false
  }});
}
