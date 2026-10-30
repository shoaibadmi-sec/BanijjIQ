import type { SherDatabase } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
import type { PurchaseInput, PurchaseReturnInput } from './types.js';
import type { PurchasePlanActionInput, PurchasePlanSaveInput, PurchasePlannerAnalysisInput } from './planner.types.js';
import { searchPurchaseSuppliersRoute } from './supplier-search.js';
import {
  completePurchaseReturnRoute, createPurchase, createSupplierRoute, deletePurchaseRoute,
  deleteSupplierPaymentRoute, deleteSupplierRoute, getPurchaseDetail, getPurchaseForReturn,
  getPurchaseReturnHistory, getPurchases, getSupplierDetailRoute, getSupplierPaymentRoute,
  getSuppliersPageRoute, paySupplierRoute, setSupplierStatusRoute, updatePurchase,
  updateSupplierPaymentRoute, updateSupplierRoute
} from './service.js';
import {
  analyzePurchasePlannerRoute, approvePurchasePlanRoute, deletePurchasePlanRoute, getPurchasePlanOrderConvertDataRoute,
  getPurchasePlanOrderRoute, getPurchasePlanRoute, listPurchasePlanOrdersRoute, listPurchasePlansRoute,
  rejectPurchasePlanRoute, savePurchasePlanRoute, updatePurchasePlanRoute
} from './planner.service.js';

function cleanText(value: unknown): string { return String(value ?? '').trim(); }

async function readBody<T>(request: Request): Promise<T> {
  try { return await request.json() as T; }
  catch { throw new Error('Invalid JSON body'); }
}

export async function handlePurchasesRoute(db: SherDatabase, request: Request, path: string, user: AuthUser): Promise<Response | null> {
  if (path === '/api/purchases/planner/analyze' && request.method === 'GET') {
    const url = new URL(request.url);
    const input: PurchasePlannerAnalysisInput = {
      scope: url.searchParams.get('scope') === 'SUPPLIER' ? 'SUPPLIER' : 'ALL',
      supplierId: cleanText(url.searchParams.get('supplierId')),
      salesWindowDays: Number(url.searchParams.get('salesWindowDays') || 30),
      targetCoverDays: Number(url.searchParams.get('targetCoverDays') || 30),
      budgetAmount: Number(url.searchParams.get('budgetAmount') || 0)
    };
    return analyzePurchasePlannerRoute(db, input);
  }
  if (path === '/api/purchases/planner/plans' && request.method === 'GET') return listPurchasePlansRoute(db);
  if (path === '/api/purchases/planner/plans' && request.method === 'POST') return savePurchasePlanRoute(db, await readBody<PurchasePlanSaveInput>(request), user);
  if (path === '/api/purchases/planner/orders' && request.method === 'GET') return listPurchasePlanOrdersRoute(db);

  const plannerApproveMatch = path.match(/^\/api\/purchases\/planner\/plans\/([^/]+)\/approve$/);
  if (plannerApproveMatch && request.method === 'POST') return approvePurchasePlanRoute(db, decodeURIComponent(plannerApproveMatch[1]), user);

  const plannerRejectMatch = path.match(/^\/api\/purchases\/planner\/plans\/([^/]+)\/reject$/);
  if (plannerRejectMatch && request.method === 'POST') {
    const body = await readBody<PurchasePlanActionInput>(request);
    return rejectPurchasePlanRoute(db, decodeURIComponent(plannerRejectMatch[1]), cleanText(body.reason), user);
  }

  const plannerPlanMatch = path.match(/^\/api\/purchases\/planner\/plans\/([^/]+)$/);
  if (plannerPlanMatch && request.method === 'GET') return getPurchasePlanRoute(db, decodeURIComponent(plannerPlanMatch[1]));
  if (plannerPlanMatch && request.method === 'PUT') return updatePurchasePlanRoute(db, decodeURIComponent(plannerPlanMatch[1]), await readBody<PurchasePlanSaveInput>(request), user);
  if (plannerPlanMatch && request.method === 'DELETE') {
    const body = await readBody<PurchasePlanActionInput>(request);
    return deletePurchasePlanRoute(db, decodeURIComponent(plannerPlanMatch[1]), cleanText(body.reason), user);
  }

  const plannerConvertMatch = path.match(/^\/api\/purchases\/planner\/orders\/([^/]+)\/convert-data$/);
  if (plannerConvertMatch && request.method === 'GET') return getPurchasePlanOrderConvertDataRoute(db, decodeURIComponent(plannerConvertMatch[1]));

  const plannerOrderMatch = path.match(/^\/api\/purchases\/planner\/orders\/([^/]+)$/);
  if (plannerOrderMatch && request.method === 'GET') return getPurchasePlanOrderRoute(db, decodeURIComponent(plannerOrderMatch[1]));

  if (path === '/api/purchases/supplier-search' && request.method === 'GET') {
    return searchPurchaseSuppliersRoute(db, new URL(request.url).searchParams.get('q') || '');
  }
  if (path === '/api/purchases' && request.method === 'GET') return getPurchases(db);
  if (path === '/api/purchases' && request.method === 'POST') return createPurchase(db, await readBody<PurchaseInput>(request), user);
  if (path === '/api/purchase-returns' && request.method === 'GET') return getPurchaseReturnHistory(db);
  if (path === '/api/purchase-returns' && request.method === 'POST') return completePurchaseReturnRoute(db, await readBody<PurchaseReturnInput>(request), user);
  if (path === '/api/suppliers' && request.method === 'GET') return getSuppliersPageRoute(db);
  if (path === '/api/suppliers' && request.method === 'POST') return createSupplierRoute(db, await readBody<{ name?: string; phone?: string; address?: string; openingBalance?: number; notes?: string }>(request), user);

  const supplierStatusMatch = path.match(/^\/api\/suppliers\/([^/]+)\/status$/);
  if (supplierStatusMatch && request.method === 'PUT') {
    const body = await readBody<{ status?: string }>(request);
    return setSupplierStatusRoute(db, decodeURIComponent(supplierStatusMatch[1]), cleanText(body.status));
  }

  const supplierPaymentCreateMatch = path.match(/^\/api\/suppliers\/([^/]+)\/payments$/);
  if (supplierPaymentCreateMatch && request.method === 'POST') return paySupplierRoute(db, decodeURIComponent(supplierPaymentCreateMatch[1]), await readBody<any>(request), user);

  const supplierMatch = path.match(/^\/api\/suppliers\/([^/]+)$/);
  if (supplierMatch && request.method === 'GET') return getSupplierDetailRoute(db, decodeURIComponent(supplierMatch[1]), new URL(request.url));
  if (supplierMatch && request.method === 'PUT') return updateSupplierRoute(db, decodeURIComponent(supplierMatch[1]), await readBody<any>(request));
  if (supplierMatch && request.method === 'DELETE') {
    const body = await readBody<{ reason?: string }>(request);
    return deleteSupplierRoute(db, decodeURIComponent(supplierMatch[1]), cleanText(body.reason), user);
  }

  const supplierPaymentMatch = path.match(/^\/api\/supplier-payments\/([^/]+)$/);
  if (supplierPaymentMatch && request.method === 'GET') return getSupplierPaymentRoute(db, decodeURIComponent(supplierPaymentMatch[1]));
  if (supplierPaymentMatch && request.method === 'PUT') return updateSupplierPaymentRoute(db, decodeURIComponent(supplierPaymentMatch[1]), await readBody<any>(request), user);
  if (supplierPaymentMatch && request.method === 'DELETE') {
    const body = await readBody<{ reason?: string }>(request);
    return deleteSupplierPaymentRoute(db, decodeURIComponent(supplierPaymentMatch[1]), cleanText(body.reason), user);
  }

  const purchaseReturnMatch = path.match(/^\/api\/purchases\/([^/]+)\/return-data$/);
  if (purchaseReturnMatch && request.method === 'GET') return getPurchaseForReturn(db, decodeURIComponent(purchaseReturnMatch[1]));

  const purchaseMatch = path.match(/^\/api\/purchases\/([^/]+)$/);
  if (purchaseMatch && request.method === 'GET') return getPurchaseDetail(db, decodeURIComponent(purchaseMatch[1]));
  if (purchaseMatch && request.method === 'PUT') return updatePurchase(db, decodeURIComponent(purchaseMatch[1]), await readBody<PurchaseInput>(request), user);
  if (purchaseMatch && request.method === 'DELETE') return deletePurchaseRoute(db, decodeURIComponent(purchaseMatch[1]), await readBody<{ reason?: string }>(request), user);

  return null;
}
