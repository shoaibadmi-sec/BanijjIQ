import {loadProductCatalog} from './products/productApi';
import {toCatalogView, type ProductCatalogResponse} from './products/productContracts';
import type {Product} from '../types/erp';

export async function loadOriginalPosCatalog(
  load: () => Promise<ProductCatalogResponse> = loadProductCatalog
): Promise<readonly Product[]> {
  return toCatalogView(await load()).items.map(({product}) => product);
}
