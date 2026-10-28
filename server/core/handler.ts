import type { SherDatabase } from '../db/types.js';
import { requireUser } from '../modules/auth/service.js';
import { handlePublicAuthRoute } from '../modules/auth/routes.js';
import { enforceRequestPermission } from '../modules/auth/permissions.js';
import { handleProductsRoute } from '../modules/products/routes.js';
import { handlePurchasesRoute } from '../modules/purchases/routes.js';
import { handleSalesRoute } from '../modules/sales/routes.js';
import { handleCustomersRoute } from '../modules/customers/routes.js';
import { handleVendorsRoute } from '../modules/vendors/routes.js';
import { handleExpensesRoute } from '../modules/expenses/routes.js';
import { handleBankFinanceRoute } from '../modules/finance/routes.js';
import { handleReportingRoute } from '../modules/reporting/routes.js';
import { handleAdminRoute } from '../modules/admin/routes.js';

interface Env { DB: SherDatabase; }

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type, authorization'
};
function json(data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status, headers: jsonHeaders }); }
function error(message: string, status = 400): Response { return json({ ok: false, error: message }, status); }

async function router(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { headers: jsonHeaders });
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/health') return json({ ok: true, name: 'SherERP Products V4 Auth' });

  const publicAuthResponse = await handlePublicAuthRoute(env.DB, request, path);
  if (publicAuthResponse) return publicAuthResponse;

  const auth = await requireUser(env.DB, request);
  if (auth instanceof Response) return auth;

  const permissionDenied = await enforceRequestPermission(env.DB, auth, path, request.method);
  if (permissionDenied) return permissionDenied;

  const productsResponse = await handleProductsRoute(env.DB, request, path, auth);
  if (productsResponse) return productsResponse;

  const purchasesResponse = await handlePurchasesRoute(env.DB, request, path, auth);
  if (purchasesResponse) return purchasesResponse;

  const salesResponse = await handleSalesRoute(env.DB, request, path, auth);
  if (salesResponse) return salesResponse;

  const customersResponse = await handleCustomersRoute(env.DB, request, path, auth);
  if (customersResponse) return customersResponse;

  const adminResponse = await handleAdminRoute(env.DB, request, path, auth);
  if (adminResponse) return adminResponse;

  const reportingResponse = await handleReportingRoute(env.DB, request, path, auth);
  if (reportingResponse) return reportingResponse;

  const bankFinanceResponse = await handleBankFinanceRoute(env.DB, request, path, auth);
  if (bankFinanceResponse) return bankFinanceResponse;

  const expensesResponse = await handleExpensesRoute(request, env.DB, auth);
  if (expensesResponse) return expensesResponse;

  const vendorsResponse = await handleVendorsRoute(request, env.DB, auth);
  if (vendorsResponse) return vendorsResponse;

  return error('API route not found', 404);
}

export async function handleApiRequest(request: Request, db: SherDatabase): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return error('API route not found', 404);
  try { return await router(request, { DB: db }); }
  catch (err) { return error(err instanceof Error ? err.message : 'Unexpected server error', 500); }
}
