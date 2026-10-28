import type { SherDatabase } from '../../db/types.js';
import { searchReturnCustomers, getCustomerReturnInvoices, completeSalesReturnBatchRoute } from './batchReturns.service.js';
import type { AuthUser } from '../auth/types.js';
import type { PosSaleInput } from './types.js';
import {
  closeCashSessionRoute, completeSaleRoute, completeSalesReturnRoute, deleteSaleRoute,
  getCashSessionSummaryRoute, getInvoiceRoute, getPosBootstrapRoute, getSaleDetailRoute,
  getSaleReturnDataRoute, getSalesByPhoneRoute, getSalesManagementRoute, getSalesReturnDetailRoute,
  getSalesReturnHistoryRoute, getSaleUpdateDataRoute, receiveCustomerPaymentRoute,
  searchSalesInvoicesForReturnRoute, startCashSessionRoute, updateSaleRoute
} from './service.js';

function cleanText(value: unknown): string { return String(value ?? '').trim(); }
async function readBody<T>(request: Request): Promise<T> {
  try { return await request.json() as T; }
  catch { throw new Error('Invalid JSON body'); }
}

export async function handleSalesRoute(db: SherDatabase, request: Request, path: string, user: AuthUser): Promise<Response | null> {
  const url = new URL(request.url);

  if (path === '/api/sales-management' && request.method === 'GET') return getSalesManagementRoute(db);
  if (path === '/api/sales-management/customer-payment' && request.method === 'POST') return receiveCustomerPaymentRoute(db, await readBody<any>(request), user);
  if (path === '/api/sales-returns/customers/search' && request.method === 'GET') return searchReturnCustomers(db, url);
  const customerReturnInvoicesMatch = path.match(/^\/api\/sales-returns\/customers\/([^/]+)\/invoices$/);
  if (customerReturnInvoicesMatch && request.method === 'GET') return getCustomerReturnInvoices(db, decodeURIComponent(customerReturnInvoicesMatch[1]));
  if (path === '/api/sales-returns/batch' && request.method === 'POST') return completeSalesReturnBatchRoute(db, await readBody<any>(request), user);
  if (path === '/api/sales-returns/search' && request.method === 'GET') return searchSalesInvoicesForReturnRoute(db, url);
  const salesReturnHistoryDetailMatch = path.match(/^\/api\/sales-returns\/history\/([^/]+)$/);
  if (salesReturnHistoryDetailMatch && request.method === 'GET') return getSalesReturnDetailRoute(db, decodeURIComponent(salesReturnHistoryDetailMatch[1]));
  if (path === '/api/sales-returns' && request.method === 'GET') return getSalesReturnHistoryRoute(db);
  if (path === '/api/sales-returns' && request.method === 'POST') return completeSalesReturnRoute(db, await readBody<any>(request), user);

  if (path === '/api/pos/bootstrap' && request.method === 'GET') return getPosBootstrapRoute(db, user);
  if (path === '/api/pos/cash-session/summary' && request.method === 'GET') return getCashSessionSummaryRoute(db);
  if (path === '/api/pos/cash-session/start' && request.method === 'POST') return startCashSessionRoute(db, await readBody<{ openingCash?: number; notes?: string }>(request), user);
  if (path === '/api/pos/cash-session/close' && request.method === 'POST') return closeCashSessionRoute(db, await readBody<{ countedCash?: number; notes?: string }>(request), user);
  if (path === '/api/pos/sales' && request.method === 'POST') return completeSaleRoute(db, await readBody<PosSaleInput>(request), user);
  if (path === '/api/pos/sales-by-phone' && request.method === 'GET') return getSalesByPhoneRoute(db, cleanText(url.searchParams.get('phone')));

  const posInvoiceMatch = path.match(/^\/api\/pos\/invoices\/([^/]+)$/);
  if (posInvoiceMatch && request.method === 'GET') return getInvoiceRoute(db, decodeURIComponent(posInvoiceMatch[1]));

  const salesReturnDataMatch = path.match(/^\/api\/sales-returns\/([^/]+)\/data$/);
  if (salesReturnDataMatch && request.method === 'GET') return getSaleReturnDataRoute(db, decodeURIComponent(salesReturnDataMatch[1]));

  const salesUpdateDataMatch = path.match(/^\/api\/sales-management\/([^/]+)\/update-data$/);
  if (salesUpdateDataMatch && request.method === 'GET') return getSaleUpdateDataRoute(db, decodeURIComponent(salesUpdateDataMatch[1]));

  const salesManageMatch = path.match(/^\/api\/sales-management\/([^/]+)$/);
  if (salesManageMatch && request.method === 'GET') return getSaleDetailRoute(db, decodeURIComponent(salesManageMatch[1]));
  if (salesManageMatch && request.method === 'PUT') return updateSaleRoute(db, decodeURIComponent(salesManageMatch[1]), await readBody<any>(request), user);
  if (salesManageMatch && request.method === 'DELETE') {
    const body = await readBody<{ reason?: string }>(request);
    return deleteSaleRoute(db, decodeURIComponent(salesManageMatch[1]), cleanText(body.reason), user);
  }

  return null;
}
