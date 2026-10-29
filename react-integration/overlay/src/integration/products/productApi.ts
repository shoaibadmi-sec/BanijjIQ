import {
  BackendRequestError, request, createBasicProduct, updateProductCatalog,
  type BasicProductInput, type ProductCatalogEdit
} from '../banijjApi';
import type { ProductCatalogResponse } from './productContracts';

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
