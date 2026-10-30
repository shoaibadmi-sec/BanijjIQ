import {
  BackendRequestError, request, createBasicProduct, updateProductCatalog,
  type BasicProductInput, type ProductCatalogEdit
} from '../banijjApi';
import type { ProductCatalogResponse } from './productContracts';
import type { StockLot, StockMovement as HisabStockMovement, StockMovementType } from '../../types/erp';

export interface LiveLot {
  lotId: string;
  purchaseId: string | null;
  supplierName: string | null;
  purchaseDate: string;
  purchasePrice: number;
  originalQuantity: number;
  remainingQuantity: number;
}

/** All operational catalog data must come from the authenticated D1 bootstrap. */
export async function loadProductCatalog(): Promise<ProductCatalogResponse> {
  const data = await request<ProductCatalogResponse>('/api/bootstrap');
  if (!data || !Array.isArray(data.products) || !Array.isArray(data.categories) ||
      !Array.isArray(data.brands) || !Array.isArray(data.units)) {
    throw new BackendRequestError('Invalid server product catalog. Please refresh.', 502);
  }
  return data;
}
export async function loadProductLots(productId: string): Promise<LiveLot[]> {
  if (!productId) throw new Error('Product ID is required');
  const data = await request<{ok:true;lots:LiveLot[]}>('/api/products/' +
    encodeURIComponent(productId) + '/lots');
  if (!data || !Array.isArray(data.lots)) throw new BackendRequestError('Invalid server lot list.', 502);
  return data.lots;
}
export const createProduct = (input: BasicProductInput) => createBasicProduct(input);
export const editProduct = (productId: string, input: ProductCatalogEdit) =>
  updateProductCatalog(productId, input);

export interface StockMovement {
  movementId: string;date:string;type:string;quantityIn:number;quantityOut:number;
  balanceAfter:number;note:string;lotId:string|null;
}
export async function loadProductHistory(productId:string):Promise<StockMovement[]> {
  if(!productId)throw new Error('Product ID is required');
  const result=await request<{ok:true;items:StockMovement[]}>(
    '/api/products/'+encodeURIComponent(productId)+'/history');
  if(!Array.isArray(result.items))throw new BackendRequestError('Invalid movement history.',502);
  return result.items;
}
export async function adjustProductStock(productId:string,delta:number,note:string):Promise<{ok:true}> {
  if(!productId)throw new Error('Product ID is required');
  if(!Number.isFinite(delta)||delta===0||Math.abs(Math.round(delta*10000)-delta*10000)>0.00001)
    throw new Error('Adjustment must be a finite non-zero number, up to four decimals.');
  const reason=note.trim();
  if(!reason)throw new Error('Adjustment reason is required.');
  return request<{ok:true}>('/api/products/'+encodeURIComponent(productId)+'/adjust-stock',{
    method:'POST',body:JSON.stringify({delta,note:reason})
  });
}
export async function changeProductStatus(productId:string,status:'Active'|'Inactive'):Promise<{ok:true}> {
  if(!productId)throw new Error('Product ID is required');
  if(status!=='Active'&&status!=='Inactive')throw new Error('Invalid status');
  return request<{ok:true}>('/api/products/'+encodeURIComponent(productId)+'/status',{
    method:'PUT',body:JSON.stringify({status})
  });
}

/** Translate verified D1 movement kinds into the *original* StockHistoryView row contract. */
function toHisabStockMovement(value:unknown):HisabStockMovement {
  if(!value||typeof value!=='object')throw new BackendRequestError('Invalid stock movement source.',502);
  const row=value as Record<string,unknown>;
  const source=typeof row.type==='string'?row.type.toUpperCase():'';
  const type:StockMovementType|null=
    source.includes('RETURN')?'Return':
    source.includes('PURCHASE')?'Purchase':
    source.includes('SALE')?'Sale':
    source.includes('OPENING')?'Opening':
    /ADJUST|STOCKTAKE|DAMAGE|WASTAGE|LOSS/.test(source)?'Adjustment':
    null;
  const validQty=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&
    Math.abs(v*10000-Math.round(v*10000))<0.00001;
  if(!type||typeof row.movementId!=='string'||!row.movementId||
      typeof row.productId!=='string'||!row.productId||
      typeof row.date!=='string'||!/^\d{4}-\d{2}-\d{2}/.test(row.date)||
      !validQty(row.quantityIn)||!validQty(row.quantityOut)||
      !(typeof row.balanceAfter==='number'&&validQty(Math.abs(row.balanceAfter)))||
      (row.quantityIn as number)>0&&(row.quantityOut as number)>0)
    throw new BackendRequestError('Unreconciled stock movement source. No history shown.',502);
  return {
    id:row.movementId, productId:row.productId,date:row.date.slice(0,10),
    type,quantity:Math.round(((row.quantityIn as number)-(row.quantityOut as number))*10000)/10000,
    balance:row.balanceAfter as number,
    reference:typeof row.lotId==='string'&&row.lotId?row.lotId:undefined,
    note:typeof row.note==='string'?row.note:''
  };
}
export async function loadInventoryHistory():Promise<HisabStockMovement[]> {
  const result=await request<{ok:true;items:unknown[]}>('/api/products/inventory-history');
  if(!result||result.ok!==true||!Array.isArray(result.items))
    throw new BackendRequestError('Invalid inventory history response.',502);
  return result.items.map(toHisabStockMovement);
}

/** Strictly map D1 lots to the pinned original HisabIQ StockLotsView contract. */
function toHisabStockLot(value:unknown):StockLot {
  if(!value||typeof value!=='object')throw new BackendRequestError('Invalid D1 stock lot.',502);
  const row=value as Record<string,unknown>;
  const origin=typeof row.sourceType==='string'?row.sourceType.toUpperCase():'';
  const source:StockLot['source']|null=
    origin==='OPENING'?'Opening':
    origin==='PURCHASE'?'Purchase':
    origin==='RETURN'||origin.includes('RETURN')?'Return':
    origin==='OPENING_ADJUSTMENT'||origin.includes('ADJUSTMENT')?'Adjustment':null;
  const qty=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&
    Number.isSafeInteger(Math.round(v*10000))&&Math.abs(v*10000-Math.round(v*10000))<0.00001;
  const day=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}/.test(v);
  const serials=row.serials;
  if(!source||typeof row.lotId!=='string'||!row.lotId||
    typeof row.productId!=='string'||!row.productId||!day(row.receivedAt)||
    !qty(row.originalQuantity)||!qty(row.remainingQuantity)||!qty(row.unitCost)||
    Math.round((row.remainingQuantity as number)*10000)>Math.round((row.originalQuantity as number)*10000)||
    !Array.isArray(serials)||!serials.every(s=>typeof s==='string'&&s.trim().length>0)||
    (row.expiryDate!==null&&!day(row.expiryDate))||
    (row.batchNumber!==null&&typeof row.batchNumber!=='string')||
    (row.sourceRef!==null&&typeof row.sourceRef!=='string'))
    throw new BackendRequestError('Unreconciled stock lot source. No lot data shown.',502);
  return {
    id:row.lotId,productId:row.productId,label:source,
    receivedAt:row.receivedAt.slice(0,10),quantity:row.originalQuantity as number,
    available:row.remainingQuantity as number,unitCost:row.unitCost as number,source,
    reference:row.sourceRef||undefined,
    batchNumber:row.batchNumber||undefined,expiryDate:row.expiryDate||undefined,
    serials:serials.length?serials:undefined
  } as StockLot;
}
export async function loadInventoryLots():Promise<StockLot[]>{
  const result=await request<{ok:true;lots:unknown[]}>('/api/products/inventory-lots');
  if(!result||result.ok!==true||!Array.isArray(result.lots))
    throw new BackendRequestError('Invalid inventory lots response.',502);
  return result.lots.map(toHisabStockLot);
}
