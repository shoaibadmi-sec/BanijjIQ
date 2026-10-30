import { handleLiveReportsRoute } from './live/routes.js';
import type { SherDatabase } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
import {
  getDayBookBootstrapRoute, getDayBookRoute, getDashboardRoute, getReportsBootstrapRoute,
  getSalesReportRoute, getPurchaseReportRoute, getStockReportRoute, getCashBankReportRoute,
  getProfitReportRoute, getBalanceSheetReportRoute
} from './service.js';

export async function handleReportingRoute(db: SherDatabase, request: Request, path: string, auth: AuthUser): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== 'GET') return null;
  const live = await handleLiveReportsRoute(db, request, path);
  if (live) return live;

  if (path === '/api/dashboard') return getDashboardRoute(db, auth);
  if (path === '/api/reports/bootstrap') return getReportsBootstrapRoute(db);
  if (path === '/api/reports/sales') return getSalesReportRoute(db, url);
  if (path === '/api/reports/purchase') return getPurchaseReportRoute(db, url);
  if (path === '/api/reports/stock') return getStockReportRoute(db);
  if (path === '/api/reports/cash-bank') return getCashBankReportRoute(db, url);
  if (path === '/api/reports/profit') return getProfitReportRoute(db, url);
  if (path === '/api/reports/balance-sheet') return getBalanceSheetReportRoute(db);
  if (path === '/api/daybook/bootstrap') return getDayBookBootstrapRoute(db, auth);
  if (path === '/api/daybook') return getDayBookRoute(db, url, auth);

  return null;
}
