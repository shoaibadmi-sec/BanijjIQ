import type { SherDatabase } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
import {
  addVendorLedgerRoute,
  addVendorRoute,
  getVendorDetailRoute,
  getVendorsBootstrapRoute,
  giveProductsToVendorRoute,
  payVendorLedgerRoute,
  receiveProductsFromVendorRoute,
  receiveVendorPaymentRoute,
  returnProductsToVendorRoute,
  setVendorStatusRoute,
  updateVendorRoute
} from './service.js';

async function readBody<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new Error('Invalid JSON body');
  }
}

export async function handleVendorsRoute(request: Request, db: SherDatabase, auth: AuthUser): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/vendors/bootstrap' && request.method === 'GET') return getVendorsBootstrapRoute(db);
  if (path === '/api/vendors' && request.method === 'POST') return addVendorLedgerRoute(db, await readBody<any>(request));
  if (path === '/api/pos/vendors' && request.method === 'POST') return addVendorRoute(db, await readBody<{ name?: string; phone?: string }>(request));

  const vendorStatusMatch = path.match(/^\/api\/vendors\/([^/]+)\/status$/);
  if (vendorStatusMatch && request.method === 'PUT') return setVendorStatusRoute(db, decodeURIComponent(vendorStatusMatch[1]), await readBody<{status?:string}>(request));

  const vendorPayMatch = path.match(/^\/api\/vendors\/([^/]+)\/pay$/);
  if (vendorPayMatch && request.method === 'POST') return payVendorLedgerRoute(db, decodeURIComponent(vendorPayMatch[1]), await readBody<any>(request), auth);

  const vendorReturnMatch = path.match(/^\/api\/vendors\/([^/]+)\/return-products$/);
  if (vendorReturnMatch && request.method === 'POST') return returnProductsToVendorRoute(db, decodeURIComponent(vendorReturnMatch[1]), await readBody<any>(request), auth);

  const vendorGiveMatch = path.match(/^\/api\/vendors\/([^/]+)\/give-products$/);
  if (vendorGiveMatch && request.method === 'POST') return giveProductsToVendorRoute(db, decodeURIComponent(vendorGiveMatch[1]), await readBody<any>(request), auth);

  const vendorReceivePaymentMatch = path.match(/^\/api\/vendors\/([^/]+)\/receive-payment$/);
  if (vendorReceivePaymentMatch && request.method === 'POST') return receiveVendorPaymentRoute(db, decodeURIComponent(vendorReceivePaymentMatch[1]), await readBody<any>(request), auth);

  const vendorReceiveProductsMatch = path.match(/^\/api\/vendors\/([^/]+)\/receive-products$/);
  if (vendorReceiveProductsMatch && request.method === 'POST') return receiveProductsFromVendorRoute(db, decodeURIComponent(vendorReceiveProductsMatch[1]), await readBody<any>(request), auth);

  const vendorDetailMatch = path.match(/^\/api\/vendors\/([^/]+)$/);
  if (vendorDetailMatch && request.method === 'GET') return getVendorDetailRoute(db, decodeURIComponent(vendorDetailMatch[1]), url);
  if (vendorDetailMatch && request.method === 'PUT') return updateVendorRoute(db, decodeURIComponent(vendorDetailMatch[1]), await readBody<{ name?: string; phone?: string }>(request));

  const posVendorStatusMatch = path.match(/^\/api\/pos\/vendors\/([^/]+)\/status$/);
  if (posVendorStatusMatch && request.method === 'PUT') return setVendorStatusRoute(db, decodeURIComponent(posVendorStatusMatch[1]), await readBody<{ status?: string }>(request));

  return null;
}
