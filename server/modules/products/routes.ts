import type { SherDatabase } from '../../db/types.js';
import { getStockAlertsRoute } from './stock-alerts.service.js';
import type { ProductInput } from './types.js';
import {
  addLookup,
  listLookups,
  adjustStockByDelta,
  createProduct,
  deleteProduct,
  getProductLots,
  getProductHistory,
  getProductsBootstrap,
  setLookupStatus,
  setProductStatus,
  updateLookup,
  updateProduct
} from './service.js';
import {
  correctExpiryBatchRoute,
  correctSerialRoute,
  createWarrantyClaimRoute,
  getPendingLotTrackingRoute,
  getPosTrackingOptionsRoute,
  getProductTrackingOverviewRoute,
  replacePendingLotTrackingRoute,
  replaceWarrantyClaimRoute,
  updateWarrantyClaimRoute,
  updateWarrantyRoute
} from './tracking.service.js';
import type { LotTrackingInput } from './tracking.types.js';
import type { AuthUser } from '../auth/types.js';
import { getUserPermissions } from '../auth/permissions.js';
import { updateProductCatalog } from './catalog.service.js';
import { readUnitProfile, saveUnitProfile, saveGlobalUnitSymbol } from './unitProfile.service.js';
import { createSupplierWarrantyRmaRoute, getSupplierWarrantyOverviewRoute, resolveSupplierWarrantyRmaRoute } from './supplierWarranty.service.js';

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

async function readBody<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new Error('Invalid JSON body');
  }
}

export async function handleProductsRoute(db: SherDatabase, request: Request, path: string, user: AuthUser): Promise<Response | null> {
  if (path === '/api/products/stock-alerts' && request.method === 'GET') return getStockAlertsRoute(db,request);
  if (path === '/api/bootstrap' && request.method === 'GET') {
    const permissions = await getUserPermissions(db, user);
    const canView = (key: string) => permissions === null || !!permissions[key]?.view;
    const canEdit = (key: string) => permissions === null || !!permissions[key]?.edit;
    return getProductsBootstrap(db, {
      includeCosts: canEdit('products') || canView('purchase') || canView('posCost'),
      includeSuppliers: canView('suppliers') || canView('purchase'),
      includeBankAccounts: canView('bank') || canView('purchase'),
    });
  }
  if (path === '/api/product-tracking' && request.method === 'GET') return getProductTrackingOverviewRoute(db);
  if (path === '/api/product-tracking/supplier-warranty' && request.method === 'GET') return getSupplierWarrantyOverviewRoute(db);
  if (path === '/api/product-tracking/supplier-warranty' && request.method === 'POST') return createSupplierWarrantyRmaRoute(db, await readBody<any>(request), user);
  if (path === '/api/products' && request.method === 'POST') return createProduct(db, await readBody<ProductInput>(request));
  if (path === '/api/categories' && request.method === 'GET') return listLookups(db, 'category');
  if (path === '/api/categories' && request.method === 'POST') return addLookup(db, 'category', await readBody<{ name?: string }>(request));
  if (path === '/api/brands' && request.method === 'GET') return listLookups(db, 'brand');
  if (path === '/api/brands' && request.method === 'POST') return addLookup(db, 'brand', await readBody<{ name?: string }>(request));
  if (path === '/api/units' && request.method === 'GET') return listLookups(db, 'unit');
  if (path === '/api/units' && request.method === 'POST') return addLookup(db, 'unit', await readBody<{ name?: string }>(request));

  const trackingLotMatch = path.match(/^\/api\/product-tracking\/lots\/([^/]+)$/);
  if (trackingLotMatch && request.method === 'GET') return getPendingLotTrackingRoute(db, decodeURIComponent(trackingLotMatch[1]));
  if (trackingLotMatch && request.method === 'PUT') return replacePendingLotTrackingRoute(db, decodeURIComponent(trackingLotMatch[1]), await readBody<LotTrackingInput>(request));

  const posTrackingMatch = path.match(/^\/api\/pos\/products\/([^/]+)\/tracking-options$/);
  if (posTrackingMatch && request.method === 'GET') return getPosTrackingOptionsRoute(db, decodeURIComponent(posTrackingMatch[1]));


  const serialCorrectionMatch = path.match(/^\/api\/product-tracking\/serials\/([^/]+)$/);
  if (serialCorrectionMatch && request.method === 'PUT') return correctSerialRoute(db, decodeURIComponent(serialCorrectionMatch[1]), await readBody<{ serialNumber?: string; reason?: string }>(request), user);

  const expiryCorrectionMatch = path.match(/^\/api\/product-tracking\/expiry\/([^/]+)$/);
  if (expiryCorrectionMatch && request.method === 'PUT') return correctExpiryBatchRoute(db, decodeURIComponent(expiryCorrectionMatch[1]), await readBody<{ expiryDate?: string; batchNo?: string; reason?: string }>(request), user);

  const warrantyMatch = path.match(/^\/api\/product-tracking\/warranties\/([^/]+)$/);
  if (warrantyMatch && request.method === 'PUT') return updateWarrantyRoute(db, decodeURIComponent(warrantyMatch[1]), await readBody<{ warrantyEndDate?: string; status?: string; reason?: string }>(request), user);

  const warrantyClaimCreateMatch = path.match(/^\/api\/product-tracking\/warranties\/([^/]+)\/claims$/);
  if (warrantyClaimCreateMatch && request.method === 'POST') return createWarrantyClaimRoute(db, decodeURIComponent(warrantyClaimCreateMatch[1]), await readBody<{ claimDate?: string; issue?: string }>(request), user);

  const warrantyClaimMatch = path.match(/^\/api\/product-tracking\/warranty-claims\/([^/]+)$/);
  if (warrantyClaimMatch && request.method === 'PUT') return updateWarrantyClaimRoute(db, decodeURIComponent(warrantyClaimMatch[1]), await readBody<{ status?: string; resolution?: string }>(request), user);

  const warrantyReplacementMatch = path.match(/^\/api\/product-tracking\/warranty-claims\/([^/]+)\/replace$/);
  if (warrantyReplacementMatch && request.method === 'POST') return replaceWarrantyClaimRoute(db, decodeURIComponent(warrantyReplacementMatch[1]), await readBody<{ replacementDate?: string; replacementSerialId?: string; note?: string }>(request), user);

  const supplierWarrantyResolveMatch = path.match(/^\/api\/product-tracking\/supplier-warranty\/([^/]+)\/resolve$/);
  if (supplierWarrantyResolveMatch && request.method === 'POST') return resolveSupplierWarrantyRmaRoute(db, decodeURIComponent(supplierWarrantyResolveMatch[1]), await readBody<any>(request), user);

  const unitProfileMatch = path.match(/^\/api\/products\/([^/]+)\/unit-profile$/);
  if (unitProfileMatch && request.method === 'GET') return readUnitProfile(db, decodeURIComponent(unitProfileMatch[1]));
  if (unitProfileMatch && request.method === 'PUT') return saveUnitProfile(db, decodeURIComponent(unitProfileMatch[1]), await readBody<unknown>(request));

  const unitSymbolMatch = path.match(/^\/api\/units\/([^/]+)\/symbol$/);
  if (unitSymbolMatch && request.method === 'PUT') return saveGlobalUnitSymbol(db, decodeURIComponent(unitSymbolMatch[1]), await readBody<unknown>(request));

  const catalogMatch = path.match(/^\/api\/products\/([^/]+)\/catalog$/);
  if (catalogMatch && request.method === 'PUT') return updateProductCatalog(db, decodeURIComponent(catalogMatch[1]), await readBody<any>(request));

  const productMatch = path.match(/^\/api\/products\/([^/]+)$/);
  if (productMatch && request.method === 'PUT') return updateProduct(db, decodeURIComponent(productMatch[1]), await readBody<ProductInput>(request));
  if (productMatch && request.method === 'DELETE') return deleteProduct(db, decodeURIComponent(productMatch[1]));

  const statusMatch = path.match(/^\/api\/products\/([^/]+)\/status$/);
  if (statusMatch && request.method === 'PUT') {
    const body = await readBody<{ status?: string }>(request);
    return setProductStatus(db, decodeURIComponent(statusMatch[1]), cleanText(body.status));
  }

  const adjustMatch = path.match(/^\/api\/products\/([^/]+)\/adjust-stock$/);
  if (adjustMatch && request.method === 'POST') {
    const body = await readBody<{ delta?: number; note?: string }>(request);
    return adjustStockByDelta(db, decodeURIComponent(adjustMatch[1]), body.delta, cleanText(body.note));
  }

  const historyMatch = path.match(/^\/api\/products\/([^/]+)\/history$/);
  if (historyMatch && request.method === 'GET') return getProductHistory(db,decodeURIComponent(historyMatch[1]));

  const lotsMatch = path.match(/^\/api\/products\/([^/]+)\/lots$/);
  if (lotsMatch && request.method === 'GET') return getProductLots(db, decodeURIComponent(lotsMatch[1]));

  const categoryMatch = path.match(/^\/api\/categories\/([^/]+)$/);
  if (categoryMatch && request.method === 'PUT') return updateLookup(db, 'category', decodeURIComponent(categoryMatch[1]), await readBody<{ name?: string }>(request));

  const brandMatch = path.match(/^\/api\/brands\/([^/]+)$/);
  if (brandMatch && request.method === 'PUT') return updateLookup(db, 'brand', decodeURIComponent(brandMatch[1]), await readBody<{ name?: string }>(request));

  const unitMatch = path.match(/^\/api\/units\/([^/]+)$/);
  if (unitMatch && request.method === 'PUT') return updateLookup(db, 'unit', decodeURIComponent(unitMatch[1]), await readBody<{ name?: string }>(request));

  const catStatusMatch = path.match(/^\/api\/categories\/([^/]+)\/status$/);
  if (catStatusMatch && request.method === 'PUT') {
    const body = await readBody<{ status?: string }>(request);
    return setLookupStatus(db, 'category', decodeURIComponent(catStatusMatch[1]), cleanText(body.status));
  }

  const brandStatusMatch = path.match(/^\/api\/brands\/([^/]+)\/status$/);
  if (brandStatusMatch && request.method === 'PUT') {
    const body = await readBody<{ status?: string }>(request);
    return setLookupStatus(db, 'brand', decodeURIComponent(brandStatusMatch[1]), cleanText(body.status));
  }

  const unitStatusMatch = path.match(/^\/api\/units\/([^/]+)\/status$/);
  if (unitStatusMatch && request.method === 'PUT') {
    const body = await readBody<{ status?: string }>(request);
    return setLookupStatus(db, 'unit', decodeURIComponent(unitStatusMatch[1]), cleanText(body.status));
  }

  return null;
}
