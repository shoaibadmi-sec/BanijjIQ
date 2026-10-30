import type { SherDatabase } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
import type { PosSaleInput } from './types.js';
import {getSplitSaleReversalPreviewRoute,postSplitSaleReversalRoute} from './split-reversal.js';
import {getStoreCreditCasesRoute,getStoreCreditCaseDetailRoute,resolveStoreCreditCaseRoute} from './store-credit-cases.js';
import {getStoreCreditOutstandingImpactRoute} from './store-credit-outstanding-impact.js';
import {
  closeCashSessionRoute, completeSaleRoute, completeSalesReturnRoute, deleteSaleRoute,
  getCashSessionSummaryRoute, getInvoiceRoute, getPosBootstrapRoute, getSaleDetailRoute,
  getSaleReturnDataRoute, getSalesByPhoneRoute, getSalesManagementRoute, getSalesReturnDetailRoute,
  getSalesReturnHistoryRoute, getSaleUpdateDataRoute, receiveCustomerPaymentRoute,
  searchSalesInvoicesForReturnRoute, startCashSessionRoute, updateSaleRoute,
  getMixedSaleReversalPreviewRoute, reverseMixedSaleRoute, getStoreCreditAccountRoute, getStoreCreditReconciliationRoute
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
  if (path === '/api/sales-returns/search' && request.method === 'GET') return searchSalesInvoicesForReturnRoute(db, url);
  const salesReturnHistoryDetailMatch = path.match(/^\/api\/sales-returns\/history\/([^/]+)$/);
  if (salesReturnHistoryDetailMatch && request.method === 'GET') return getSalesReturnDetailRoute(db, decodeURIComponent(salesReturnHistoryDetailMatch[1]));
  if (path === '/api/sales-returns' && request.method === 'GET') return getSalesReturnHistoryRoute(db);
  if (path === '/api/sales-returns' && request.method === 'POST') return completeSalesReturnRoute(db, await readBody<any>(request), user);

  if (path === '/api/pos/bootstrap' && request.method === 'GET') return getPosBootstrapRoute(db, user);
  if(path==='/api/pos/store-credit/reconciliation/cases' && request.method==='GET')
    return getStoreCreditCasesRoute(db,user,url);
  const caseImpactMatch=path.match(/^\/api\/pos\/store-credit\/reconciliation\/cases\/([^/]+)\/impact$/);
  if(caseImpactMatch && request.method==='GET')
    return getStoreCreditOutstandingImpactRoute(db,user,decodeURIComponent(caseImpactMatch[1]));
  const caseResolutionMatch=path.match(/^\/api\/pos\/store-credit\/reconciliation\/cases\/([^/]+)\/resolve$/);
  if(caseResolutionMatch && request.method==='POST')
    return resolveStoreCreditCaseRoute(db,user,decodeURIComponent(caseResolutionMatch[1]),
      await readBody<any>(request));
  const caseMatch=path.match(/^\/api\/pos\/store-credit\/reconciliation\/cases\/([^/]+)$/);
  if(caseMatch && request.method==='GET')
    return getStoreCreditCaseDetailRoute(db,user,decodeURIComponent(caseMatch[1]));
  if(path==='/api/pos/store-credit/reconciliation' && request.method==='GET')
    return getStoreCreditReconciliationRoute(db,user);
  const creditMatch=path.match(/^\/api\/pos\/store-credit\/([^/]+)$/);
  if(creditMatch && request.method==='GET')return getStoreCreditAccountRoute(db,decodeURIComponent(creditMatch[1]),user);
  if (path === '/api/pos/cash-session/summary' && request.method === 'GET') return getCashSessionSummaryRoute(db);
  if (path === '/api/pos/cash-session/start' && request.method === 'POST') return startCashSessionRoute(db, await readBody<{ openingCash?: number; notes?: string }>(request), user);
  if (path === '/api/pos/cash-session/close' && request.method === 'POST') return closeCashSessionRoute(db, await readBody<{ countedCash?: number; notes?: string }>(request), user);
  if (path === '/api/pos/sales' && request.method === 'POST') return completeSaleRoute(db, await readBody<PosSaleInput>(request), user);
  if (path === '/api/pos/sales-by-phone' && request.method === 'GET') return getSalesByPhoneRoute(db, cleanText(url.searchParams.get('phone')));

  const posInvoiceMatch = path.match(/^\/api\/pos\/invoices\/([^/]+)$/);
  if (posInvoiceMatch && request.method === 'GET') return getInvoiceRoute(db, decodeURIComponent(posInvoiceMatch[1]));

  const salesReturnDataMatch = path.match(/^\/api\/sales-returns\/([^/]+)\/data$/);
  if (salesReturnDataMatch && request.method === 'GET') return getSaleReturnDataRoute(db, decodeURIComponent(salesReturnDataMatch[1]));

  const splitReversalMatch=path.match(/^\/api\/sales-management\/([^/]+)\/split-reversal$/);
  if(splitReversalMatch&&request.method==='GET')
    return getSplitSaleReversalPreviewRoute(db,decodeURIComponent(splitReversalMatch[1]));
  if(splitReversalMatch&&request.method==='POST')
    return postSplitSaleReversalRoute(db,decodeURIComponent(splitReversalMatch[1]),await readBody<{reason?:string}>(request),user);
  const reverseMatch=path.match(/^\/api\/sales-management\/([^/]+)\/reverse$/);
  if(reverseMatch && request.method==='GET')return getMixedSaleReversalPreviewRoute(db,decodeURIComponent(reverseMatch[1]));
  if(reverseMatch && request.method==='POST')return reverseMixedSaleRoute(
    db,decodeURIComponent(reverseMatch[1]),await readBody<any>(request),user);

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
