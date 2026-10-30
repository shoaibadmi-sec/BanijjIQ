import {useContext, useSyncExternalStore} from 'react';
import type {Product} from '../types/erp';
import {OriginalPosCatalogContext} from '../integration/OriginalPosCatalogProvider';
import {
  getProductImportPreviewSnapshot,
  subscribeProductImportPreview
} from '../data/productImportPreviewStore';

/** Retain the original UI hook; inside the POS API preview only return D1 catalog. */
export function usePreviewCatalog(): readonly Product[] {
  const sourceProducts=useSyncExternalStore(
    subscribeProductImportPreview,
    getProductImportPreviewSnapshot,
    getProductImportPreviewSnapshot
  ).products;
  const apiCatalog=useContext(OriginalPosCatalogContext);
  return apiCatalog ?? sourceProducts;
}
