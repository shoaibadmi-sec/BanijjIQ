import { BackendRequestError, type BackendProduct } from '../banijjApi';
import type { Product } from '../../types/erp';

export interface Lookup { id: string; name: string; symbol?: string }
export interface ProductCatalogResponse {
  ok: true;
  products: BackendProduct[];
  categories: Lookup[];
  brands: Lookup[];
  units: Lookup[];
}
export interface LiveProductView {
  product: Product;
  updatedAt: string;
  /** D1-computed inventory value; null means unavailable, never an estimate. */
  stockValue: number | null;
  /** Sellable stock is separate from on-hand stock when tracking/expiry is active. */
  sellableStock: number | null;
  pendingTracking: number | null;
  expiredStock: number | null;
  tracking: { serial: boolean | null; expiry: boolean | null; warranty: boolean | null };
}
export interface ProductCatalogView {
  items: LiveProductView[];
  categories: Lookup[];
  brands: Lookup[];
  units: Lookup[];
  productCount: number;
  totalStockValue: number | null;
}
export type ProductFailureState =
  | 'unauthorized' | 'forbidden' | 'conflict' | 'not-found'
  | 'server-error' | 'network-error' | 'invalid-request' | 'unexpected-error';

function requiredAmount(row: BackendProduct, key: 'currentStock' | 'minimumStock' | 'sellingPrice' | 'purchasePrice'): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || (key !== 'currentStock' && value < 0)) {
    throw new Error('Invalid D1 product ' + key + ' for ' + String(row.productId));
  }
  return value;
}
function optionalAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function flag(value: unknown): boolean | null {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  return null;
}

export function toProductView(row: BackendProduct): Product {
  if (!row || !row.productId || !row.productName) throw new Error('Invalid D1 product identity');
  if (row.productType && row.productType !== 'Standard') {
    throw new Error('Unsupported product type: ' + row.productType);
  }
  const serial = flag(row.trackSerial);
  return {
    id: row.productId,
    kind: 'Stock',
    name: row.productName,
    sku: row.barcode ?? '',
    category: row.category ?? '',
    brand: row.brand ?? '',
    unit: row.unit ?? '',
    stock: requiredAmount(row, 'currentStock'),
    minStock: requiredAmount(row, 'minimumStock'),
    sellPrice: requiredAmount(row, 'sellingPrice'),
    purchasePrice: requiredAmount(row, 'purchasePrice'),
    active: row.status === 'Active',
    ...(serial === null ? {} : { serialTracking: serial ? 'Required' as const : 'Off' as const })
  };
}

/** Product metadata is not mixed into the demo-oriented source Product type. */
export function toLiveProduct(row: BackendProduct): LiveProductView {
  return {
    product: toProductView(row),
    updatedAt: row.updatedAt,
    stockValue: optionalAmount(row.stockValue),
    sellableStock: optionalAmount(row.sellableStock),
    pendingTracking: optionalAmount(row.pendingTracking),
    expiredStock: optionalAmount(row.expiredStock),
    tracking: {
      serial: flag(row.trackSerial),
      expiry: flag(row.trackExpiry),
      warranty: flag(row.trackWarranty)
    }
  };
}

export function toCatalogView(response: ProductCatalogResponse): ProductCatalogView {
  if (!Array.isArray(response.products) || !Array.isArray(response.categories) ||
      !Array.isArray(response.brands) || !Array.isArray(response.units)) {
    throw new Error('Invalid D1 product catalog response');
  }
  const items = response.products.map(toLiveProduct);
  const totalStockValue = items.every(p => p.stockValue !== null)
    ? items.reduce((sum, p) => sum + (p.stockValue ?? 0), 0) : null;
  return {
    items, categories: response.categories, brands: response.brands, units: response.units,
    productCount: items.length, totalStockValue
  };
}

export function classifyProductError(error: unknown): ProductFailureState {
  if (!(error instanceof BackendRequestError)) return 'unexpected-error';
  if (error.status === null) return 'network-error';
  if (error.status === 401) return 'unauthorized';
  if (error.status === 403) return 'forbidden';
  if (error.status === 404) return 'not-found';
  if (error.status === 409) return 'conflict';
  if (error.status >= 500) return 'server-error';
  return 'invalid-request';
}
