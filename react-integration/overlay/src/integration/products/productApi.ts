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
