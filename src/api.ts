import type { AuthUser, BankAccount, LookupItem, Product, ProductForm, StockLot, Purchase, PurchaseForm, PurchaseReturnData, PurchaseReturnRecord, Supplier, SupplierDetail, SupplierForm, SupplierPaymentForm, PosProduct, PosCustomer, PosVendor, CashSessionSummary, PosCartLine, PosInvoice } from './types';

const TOKEN_KEY = 'shererp_auth_token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    if (response.status === 401) clearToken();
    throw new Error(data?.error || `Request failed: ${response.status}`);
  }
  return data as T;
}

export async function getSetupStatus(): Promise<{ ok: true; setupRequired: boolean }> {
  return request('/api/setup/status');
}

export async function setupAdmin(payload: { fullName: string; phone: string; password: string }, setupSecret: string): Promise<{ ok: true; token: string; user: AuthUser }> {
  return request('/api/setup/admin', {
    method: 'POST',
    headers: { 'x-setup-secret': setupSecret },
    body: JSON.stringify(payload)
  });
}

export async function login(payload: { phone: string; password: string }): Promise<{ ok: true; token: string; user: AuthUser }> {
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
}

export async function getMe(): Promise<{ ok: true; user: AuthUser | null }> {
  return request('/api/auth/me');
}

export async function logout(): Promise<{ ok: true }> {
  return request('/api/auth/logout', { method: 'POST' });
}

export async function getBootstrap(): Promise<{ ok: true; products: Product[]; categories: LookupItem[]; brands: LookupItem[]; units: LookupItem[]; suppliers: Supplier[]; bankAccounts: BankAccount[]; lowStockThreshold: number; currencySymbol: string }> {
  return request('/api/bootstrap');
}

export async function createProduct(payload: ProductForm): Promise<{ ok: true; productId: string }> {
  return request('/api/products', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateProduct(productId: string, payload: ProductForm): Promise<{ ok: true }> {
  return request(`/api/products/${encodeURIComponent(productId)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function deleteProduct(productId: string): Promise<{ ok: true }> {
  return request(`/api/products/${encodeURIComponent(productId)}`, { method: 'DELETE' });
}

export async function setProductStatus(productId: string, status: 'Active' | 'Inactive'): Promise<{ ok: true }> {
  return request(`/api/products/${encodeURIComponent(productId)}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
}

export async function adjustStock(productId: string, delta: number, note: string): Promise<{ ok: true }> {
  return request(`/api/products/${encodeURIComponent(productId)}/adjust-stock`, { method: 'POST', body: JSON.stringify({ delta, note }) });
}

export async function getProductLots(productId: string): Promise<{ ok: true; lots: StockLot[] }> {
  return request(`/api/products/${encodeURIComponent(productId)}/lots`);
}

export async function getProductTrackingOverview(): Promise<{ ok: true } & import('./types').ProductTrackingOverview> {
  return request('/api/product-tracking');
}

export async function getPendingLotTracking(lotId: string): Promise<{ ok: true; lot: import('./types').ProductTrackingPendingLot; tracking: import('./types').LotTrackingInput }> {
  return request(`/api/product-tracking/lots/${encodeURIComponent(lotId)}`);
}

export async function savePendingLotTracking(lotId: string, tracking: import('./types').LotTrackingInput): Promise<{ ok: true; status: 'Ready' | 'Pending'; assignedQuantity: number; requiredQuantity: number }> {
  return request(`/api/product-tracking/lots/${encodeURIComponent(lotId)}`, { method: 'PUT', body: JSON.stringify(tracking) });
}

export async function getPosProductTrackingOptions(productId: string): Promise<{ ok: true; product: { productId:string; productName:string; brand:string; trackSerial:boolean; trackExpiry:boolean; trackWarranty:boolean }; serials: Array<{ serialNumber:string; expiryDate?:string }> }> {
  return request(`/api/pos/products/${encodeURIComponent(productId)}/tracking-options`);
}

export async function correctProductSerial(serialId: string, serialNumber: string, reason: string): Promise<{ ok: true; serialId: string; serialNumber: string }> {
  return request(`/api/product-tracking/serials/${encodeURIComponent(serialId)}`, { method: 'PUT', body: JSON.stringify({ serialNumber, reason }) });
}

export async function correctProductExpiryBatch(expiryBatchId: string, expiryDate: string, batchNo: string, reason: string): Promise<{ ok: true; expiryBatchId: string; expiryDate: string; batchNo: string }> {
  return request(`/api/product-tracking/expiry/${encodeURIComponent(expiryBatchId)}`, { method: 'PUT', body: JSON.stringify({ expiryDate, batchNo, reason }) });
}

export async function updateProductWarranty(warrantyId: string, payload: { warrantyEndDate: string; status: 'Active' | 'Voided'; reason: string }): Promise<{ ok: true; warrantyId: string; warrantyEndDate: string; status: string }> {
  return request(`/api/product-tracking/warranties/${encodeURIComponent(warrantyId)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function createProductWarrantyClaim(warrantyId: string, payload: { claimDate: string; issue: string }): Promise<{ ok: true; claimId: string }> {
  return request(`/api/product-tracking/warranties/${encodeURIComponent(warrantyId)}/claims`, { method: 'POST', body: JSON.stringify(payload) });
}

export async function completeProductWarrantyClaim(claimId: string, payload: { status: 'Resolved' | 'Rejected' | 'Cancelled'; resolution: string }): Promise<{ ok: true; claimId: string; status: string }> {
  return request(`/api/product-tracking/warranty-claims/${encodeURIComponent(claimId)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function replaceProductWarrantyClaim(claimId: string, payload: { replacementDate: string; replacementSerialId: string; note: string }): Promise<{ ok: true; replacementId: string; claimId: string; originalSerialNumber: string; replacementSerialNumber: string; warrantyStatus: string }> {
  return request(`/api/product-tracking/warranty-claims/${encodeURIComponent(claimId)}/replace`, { method: 'POST', body: JSON.stringify(payload) });
}

export async function getSupplierWarrantyOverview(): Promise<{ ok:true } & import('./types').SupplierWarrantyOverview> {
  return request('/api/product-tracking/supplier-warranty');
}

export async function createSupplierWarrantyRma(payload: { claimId:string; supplierId:string; sentDate:string; supplierReference?:string; customerHandling:string; notes?:string }): Promise<{ ok:true; rmaId:string; rmaNo:string }> {
  return request('/api/product-tracking/supplier-warranty', { method:'POST', body:JSON.stringify(payload) });
}

export async function resolveSupplierWarrantyRma(rmaId:string, payload: import('./types').SupplierWarrantyResolveInput): Promise<{ ok:true; rmaId:string; status:string; supplierDue:number }> {
  return request(`/api/product-tracking/supplier-warranty/${encodeURIComponent(rmaId)}/resolve`, { method:'POST', body:JSON.stringify(payload) });
}

export interface ProductLookupManageItem { id: string; name: string; status: 'Active' | 'Inactive' }

export async function getProductCategories(): Promise<{ ok: true; items: ProductLookupManageItem[] }> {
  return request('/api/categories');
}

export async function getProductBrands(): Promise<{ ok: true; items: ProductLookupManageItem[] }> {
  return request('/api/brands');
}

export async function getProductUnits(): Promise<{ ok: true; items: ProductLookupManageItem[] }> {
  return request('/api/units');
}

export async function addProductCategory(name: string): Promise<{ ok: true; id: string; name: string }> {
  return request('/api/categories', { method: 'POST', body: JSON.stringify({ name }) });
}

export async function updateProductCategory(id: string, name: string): Promise<{ ok: true; id: string; name: string }> {
  return request(`/api/categories/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ name }) });
}

export async function addProductBrand(name: string): Promise<{ ok: true; id: string; name: string }> {
  return request('/api/brands', { method: 'POST', body: JSON.stringify({ name }) });
}

export async function updateProductBrand(id: string, name: string): Promise<{ ok: true; id: string; name: string }> {
  return request(`/api/brands/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ name }) });
}

export async function addProductUnit(name: string): Promise<{ ok: true; id: string; name: string }> {
  return request('/api/units', { method: 'POST', body: JSON.stringify({ name }) });
}

export async function updateProductUnit(id: string, name: string): Promise<{ ok: true; id: string; name: string }> {
  return request(`/api/units/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ name }) });
}

export async function setProductCategoryStatus(id: string, status: 'Active' | 'Inactive'): Promise<{ ok: true }> {
  return request(`/api/categories/${encodeURIComponent(id)}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
}

export async function setProductBrandStatus(id: string, status: 'Active' | 'Inactive'): Promise<{ ok: true }> {
  return request(`/api/brands/${encodeURIComponent(id)}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
}

export async function setProductUnitStatus(id: string, status: 'Active' | 'Inactive'): Promise<{ ok: true }> {
  return request(`/api/units/${encodeURIComponent(id)}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
}


export async function getPurchases(): Promise<{ ok: true; purchases: Purchase[] }> {
  return request('/api/purchases');
}

export async function createPurchase(payload: PurchaseForm): Promise<{ ok: true; purchaseId: string }> {
  return request('/api/purchases', { method: 'POST', body: JSON.stringify(payload) });
}


export async function addSupplier(name: string): Promise<{ ok: true; id: string; name: string }> {
  return request('/api/suppliers', { method: 'POST', body: JSON.stringify({ name }) });
}


export async function getPurchaseDetail(purchaseId: string): Promise<{ ok: true; purchase: Purchase }> {
  return request(`/api/purchases/${encodeURIComponent(purchaseId)}`);
}

export async function updatePurchase(purchaseId: string, payload: PurchaseForm & { reason: string }): Promise<{ ok: true; purchaseId: string }> {
  return request(`/api/purchases/${encodeURIComponent(purchaseId)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function deletePurchase(purchaseId: string, reason: string): Promise<{ ok: true }> {
  return request(`/api/purchases/${encodeURIComponent(purchaseId)}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
}

export async function getPurchaseForReturn(purchaseId: string): Promise<{ ok: true; purchase: PurchaseReturnData }> {
  return request(`/api/purchases/${encodeURIComponent(purchaseId)}/return-data`);
}

export async function completePurchaseReturn(payload: {
  purchaseId: string;
  date: string;
  backdatedReason?: string;
  refundMethod: 'Cash' | 'Supplier Credit';
  reason: string;
  notes?: string;
  items: Array<{ productId: string; qty: number; unitPrice: number; serialNumbers?: string[] }>;
}): Promise<{ ok: true; returnId: string; totalReturnAmount: number }> {
  return request('/api/purchase-returns', { method: 'POST', body: JSON.stringify(payload) });
}

export async function getPurchaseReturns(): Promise<{ ok: true; returns: PurchaseReturnRecord[] }> {
  return request('/api/purchase-returns');
}

export async function analyzePurchasePlanner(params: {
  scope: import('./types').PurchasePlannerScope;
  supplierId?: string;
  salesWindowDays: number;
  targetCoverDays: number;
  budgetAmount?: number;
}): Promise<{ ok: true; params: typeof params; rows: import('./types').PurchasePlannerRow[]; totals: import('./types').PurchasePlannerTotals; suppliers: Supplier[] }> {
  const query = new URLSearchParams({
    scope: params.scope,
    supplierId: params.supplierId || '',
    salesWindowDays: String(params.salesWindowDays),
    targetCoverDays: String(params.targetCoverDays),
    budgetAmount: String(params.budgetAmount || 0)
  });
  return request(`/api/purchases/planner/analyze?${query.toString()}`);
}

export async function savePurchasePlan(payload: {
  scope: import('./types').PurchasePlannerScope;
  supplierId?: string;
  salesWindowDays: number;
  targetCoverDays: number;
  budgetAmount?: number;
  planDate?: string;
  notes?: string;
  items: Array<{ productId: string; supplierId?: string; plannedQty: number; included: boolean }>;
}): Promise<{ ok: true; planId: string; planNo: string; totals: import('./types').PurchasePlannerTotals }> {
  return request('/api/purchases/planner/plans', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updatePurchasePlan(planId: string, payload: {
  scope: import('./types').PurchasePlannerScope;
  supplierId?: string;
  salesWindowDays: number;
  targetCoverDays: number;
  budgetAmount?: number;
  planDate?: string;
  notes?: string;
  items: Array<{ productId: string; supplierId?: string; plannedQty: number; included: boolean }>;
}): Promise<{ ok: true; planId: string; planNo: string; totals: import('./types').PurchasePlannerTotals }> {
  return request(`/api/purchases/planner/plans/${encodeURIComponent(planId)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function rejectPurchasePlan(planId: string, reason: string): Promise<{ ok: true; planId: string; status: string }> {
  return request(`/api/purchases/planner/plans/${encodeURIComponent(planId)}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export async function deletePurchasePlan(planId: string, reason: string): Promise<{ ok: true; planId: string }> {
  return request(`/api/purchases/planner/plans/${encodeURIComponent(planId)}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
}

export async function getPurchasePlans(): Promise<{ ok: true; plans: import('./types').PurchasePlanSummary[] }> {
  return request('/api/purchases/planner/plans');
}

export async function getPurchasePlan(planId: string): Promise<{ ok: true; plan: import('./types').PurchasePlanSummary; items: import('./types').PurchasePlannerRow[] }> {
  return request(`/api/purchases/planner/plans/${encodeURIComponent(planId)}`);
}

export async function approvePurchasePlan(planId: string): Promise<{ ok: true; planId: string; orders: Array<{ orderId: string; orderNo: string; supplierId: string; supplierName: string }> }> {
  return request(`/api/purchases/planner/plans/${encodeURIComponent(planId)}/approve`, { method: 'POST' });
}

export async function getPurchasePlanOrders(): Promise<{ ok: true; orders: import('./types').PurchasePlanOrderSummary[] }> {
  return request('/api/purchases/planner/orders');
}

export async function getPurchasePlanOrder(orderId: string): Promise<{ ok: true; order: import('./types').SupplierPurchaseOrder }> {
  return request(`/api/purchases/planner/orders/${encodeURIComponent(orderId)}`);
}

export async function getPurchasePlanOrderConvertData(orderId: string): Promise<{ ok: true; purchase: { purchasePlanOrderId: string; orderNo: string; supplierId: string; supplierName: string; items: Array<{ productId: string; productName: string; quantity: number; unitPrice: number; sellingPrice: number }> } }> {
  return request(`/api/purchases/planner/orders/${encodeURIComponent(orderId)}/convert-data`);
}

export async function getSuppliersPage(): Promise<{ ok: true; suppliers: Supplier[]; bankAccounts: BankAccount[]; currencySymbol: string; activeCashSession: boolean }> {
  return request('/api/suppliers');
}

export async function createSupplierFull(payload: SupplierForm): Promise<{ ok: true; id: string }> {
  return request('/api/suppliers', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateSupplierFull(supplierId: string, payload: SupplierForm): Promise<{ ok: true; id: string }> {
  return request(`/api/suppliers/${encodeURIComponent(supplierId)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function getSupplierDetail(supplierId: string, filters: { from?: string; to?: string; limit?: number } = {}): Promise<{ ok: true } & SupplierDetail> {
  const q = new URLSearchParams();
  if (filters.from) q.set('from', filters.from);
  if (filters.to) q.set('to', filters.to);
  if (filters.limit) q.set('limit', String(filters.limit));
  return request(`/api/suppliers/${encodeURIComponent(supplierId)}${q.toString() ? `?${q.toString()}` : ''}`);
}


export async function setSupplierStatus(supplierId: string, status: 'Active' | 'Inactive'): Promise<{ ok: true; id: string; status: string }> {
  return request(`/api/suppliers/${encodeURIComponent(supplierId)}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
}

export async function deleteSupplier(supplierId: string, reason: string): Promise<{ ok: true }> {
  return request(`/api/suppliers/${encodeURIComponent(supplierId)}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
}

export async function paySupplier(supplierId: string, payload: SupplierPaymentForm): Promise<{ ok: true; newDue: number }> {
  return request(`/api/suppliers/${encodeURIComponent(supplierId)}/payments`, { method: 'POST', body: JSON.stringify(payload) });
}

export async function getSupplierPaymentForEdit(ledgerId: string): Promise<{ ok: true; payment: { ledgerId: string; supplierId: string; supplierName: string; date: string; amount: number; method: string; bankAccountId?: string; notes: string } }> {
  return request(`/api/supplier-payments/${encodeURIComponent(ledgerId)}`);
}

export async function updateSupplierPayment(ledgerId: string, payload: SupplierPaymentForm): Promise<{ ok: true; newDue: number }> {
  return request(`/api/supplier-payments/${encodeURIComponent(ledgerId)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function deleteSupplierPayment(ledgerId: string, reason: string): Promise<{ ok: true }> {
  return request(`/api/supplier-payments/${encodeURIComponent(ledgerId)}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
}


export async function getPosBootstrap(): Promise<{ ok: true; products: PosProduct[]; customers: PosCustomer[]; bankAccounts: BankAccount[]; vendors: PosVendor[]; vendorsAll: PosVendor[]; activeSession: { sessionId: string; openedAt: string; openingCash: number } | null; showPurchasePrice: boolean; invoiceDesign: import('./types').InvoiceDesignBootstrap }> {
  return request('/api/pos/bootstrap');
}

export async function getCashSessionSummary(): Promise<{ ok: true; summary: CashSessionSummary | null }> {
  return request('/api/pos/cash-session/summary');
}

export async function startCashSession(openingCash: number, notes: string): Promise<{ ok: true; sessionId: string }> {
  return request('/api/pos/cash-session/start', { method: 'POST', body: JSON.stringify({ openingCash, notes }) });
}

export async function closeCashSession(countedCash: number, notes: string): Promise<{ ok: true; expected: number; counted: number; variance: number }> {
  return request('/api/pos/cash-session/close', { method: 'POST', body: JSON.stringify({ countedCash, notes }) });
}

export async function completeSale(payload: { customerId?: string; customerName: string; customerPhone: string; customerAddress?: string; customerFatherName?: string; date: string; backdatedReason?: string; discount: number; paymentType: 'Cash' | 'Due' | 'Partial'; paidAmount: number; paymentMethod: string; bankAccountId?: string; items: PosCartLine[] }): Promise<{ ok: true; invoice: PosInvoice }> {
  return request('/api/pos/sales', { method: 'POST', body: JSON.stringify(payload) });
}

export async function getSalesByPhone(phone: string): Promise<{ ok: true; sales: Array<{ invoiceId: string; date: string; grandTotal: number; paymentStatus: string }> }> {
  return request(`/api/pos/sales-by-phone?phone=${encodeURIComponent(phone)}`);
}

export async function getPosInvoice(invoiceId: string): Promise<{ ok: true; invoice: PosInvoice }> {
  return request(`/api/pos/invoices/${encodeURIComponent(invoiceId)}`);
}

export async function addPosVendor(name: string, phone: string): Promise<{ ok: true; vendor: PosVendor }> {
  return request('/api/pos/vendors', { method: 'POST', body: JSON.stringify({ name, phone }) });
}

export async function setPosVendorStatus(id: string, status: 'Active' | 'Inactive'): Promise<{ ok: true; id: string; status: string }> {
  return request(`/api/pos/vendors/${encodeURIComponent(id)}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
}

export async function getSalesManagementList(): Promise<{ ok: true; sales: import('./types').SalesListRow[]; bankAccounts: import('./types').BankAccount[] }> {
  return request('/api/sales-management');
}

export async function getSaleDetail(invoiceId: string): Promise<{ ok: true; invoice: import('./types').SaleDetail }> {
  return request(`/api/sales-management/${encodeURIComponent(invoiceId)}`);
}

export async function getSaleForUpdate(invoiceId: string): Promise<{ ok: true; sale: import('./types').SaleUpdateData }> {
  return request(`/api/sales-management/${encodeURIComponent(invoiceId)}/update-data`);
}

export async function updateSale(invoiceId: string, payload: {
  reason: string;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  customerFatherName?: string;
  discount: number;
  paymentType: 'Cash' | 'Due' | 'Partial';
  paidAmount: number;
  paymentMethod: string;
  bankAccountId?: string;
  items: PosCartLine[];
}): Promise<{ ok: true; invoice: PosInvoice }> {
  return request(`/api/sales-management/${encodeURIComponent(invoiceId)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function deleteSale(invoiceId: string, reason: string): Promise<{ ok: true }> {
  return request(`/api/sales-management/${encodeURIComponent(invoiceId)}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
}

export async function receiveSalesCustomerPayment(payload: {
  customerId: string;
  amount: number;
  method: string;
  bankAccountId?: string;
  reference?: string;
  note?: string;
}): Promise<{ ok: true; newDue: number }> {
  return request('/api/sales-management/customer-payment', { method: 'POST', body: JSON.stringify(payload) });
}

export async function getSaleReturnData(invoiceId: string): Promise<{ ok: true; sale: import('./types').SaleReturnData }> {
  return request(`/api/sales-returns/${encodeURIComponent(invoiceId)}/data`);
}

export async function completeSalesReturn(payload: {
  invoiceId: string;
  refundMethod: 'Cash' | 'Store Credit';
  reason?: string;
  notes?: string;
  date?: string;
  backdatedReason?: string;
  items: Array<{ productId: string; name: string; qty: number; unitPrice: number; serialNumbers?: string[] }>;
}): Promise<{ ok: true; returnId: string; totalReturnAmount: number }> {
  return request('/api/sales-returns', { method: 'POST', body: JSON.stringify(payload) });
}

export async function getSalesReturnHistory(): Promise<{ ok: true; returns: import('./types').SalesReturnRecord[] }> {
  return request('/api/sales-returns');
}

export async function getCustomersPage(): Promise<{ ok: true; customers: import('./types').CustomerRow[]; bankAccounts: import('./types').BankAccount[]; currencySymbol: string; activeCashSession: boolean }> {
  return request('/api/customers');
}

export async function createCustomer(payload: import('./types').CustomerForm): Promise<{ ok: true; id: string }> {
  return request('/api/customers', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateCustomer(customerId: string, payload: import('./types').CustomerForm): Promise<{ ok: true; id: string }> {
  return request(`/api/customers/${encodeURIComponent(customerId)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function getCustomerDetail(customerId: string, filters: { from?: string; to?: string; limit?: number } = {}): Promise<{ ok: true; detail: import('./types').CustomerDetail }> {
  const q = new URLSearchParams();
  if (filters.from) q.set('from', filters.from);
  if (filters.to) q.set('to', filters.to);
  if (filters.limit) q.set('limit', String(filters.limit));
  return request(`/api/customers/${encodeURIComponent(customerId)}${q.toString() ? `?${q.toString()}` : ''}`);
}


export async function receiveCustomerPayment(customerId: string, payload: import('./types').CustomerPaymentForm): Promise<{ ok: true; newDue: number }> {
  return request(`/api/customers/${encodeURIComponent(customerId)}/payments`, { method: 'POST', body: JSON.stringify(payload) });
}

export async function getCustomerPaymentForEdit(ledgerId: string): Promise<{ ok: true; payment: { ledgerId: string; customerId: string; customerName: string; date: string; amount: number; method: string; bankAccountId?: string; notes: string } }> {
  return request(`/api/customer-payments/${encodeURIComponent(ledgerId)}`);
}

export async function updateCustomerPayment(ledgerId: string, payload: import('./types').CustomerPaymentForm): Promise<{ ok: true; newDue: number }> {
  return request(`/api/customer-payments/${encodeURIComponent(ledgerId)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function deleteCustomerPayment(ledgerId: string, reason: string): Promise<{ ok: true }> {
  return request(`/api/customer-payments/${encodeURIComponent(ledgerId)}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
}

export async function deleteCustomer(customerId: string, confirmKey: string, reason = ''): Promise<{ ok: true }> {
  return request(`/api/customers/${encodeURIComponent(customerId)}`, { method: 'DELETE', body: JSON.stringify({ confirmKey, reason }) });
}

export async function getExpenseBootstrap(): Promise<{ ok: true; categories: import('./types').ExpenseCategory[]; payees: import('./types').ExpensePayee[]; bankAccounts: import('./types').BankAccount[]; paymentMethods: string[]; currencySymbol: string; activeCashSession: boolean }> {
  return request('/api/expenses/bootstrap');
}

export async function getExpenses(): Promise<{ ok: true; expenses: import('./types').ExpenseRow[] }> {
  return request('/api/expenses');
}

export async function getExpenseDetail(expenseId: string): Promise<{ ok: true; expense: import('./types').ExpenseRow }> {
  return request(`/api/expenses/${encodeURIComponent(expenseId)}`);
}

export async function addExpense(payload: import('./types').ExpenseForm): Promise<{ ok: true; id: string }> {
  return request('/api/expenses', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateExpense(expenseId: string, payload: import('./types').ExpenseForm): Promise<{ ok: true; id: string }> {
  return request(`/api/expenses/${encodeURIComponent(expenseId)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function cancelExpense(expenseId: string, reason: string): Promise<{ ok: true; id: string }> {
  return request(`/api/expenses/${encodeURIComponent(expenseId)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export async function getExpenseCategories(): Promise<{ ok: true; categories: import('./types').ExpenseCategory[] }> {
  return request('/api/expense-categories');
}

export async function addExpenseCategory(payload: { name: string; description?: string }): Promise<{ ok: true; id: string }> {
  return request('/api/expense-categories', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateExpenseCategory(categoryId: string, payload: { name: string; description?: string }): Promise<{ ok: true; id: string }> {
  return request(`/api/expense-categories/${encodeURIComponent(categoryId)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function setExpenseCategoryStatus(categoryId: string, status: 'Active' | 'Inactive'): Promise<{ ok: true; id: string; status: string }> {
  return request(`/api/expense-categories/${encodeURIComponent(categoryId)}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
}


export async function getExpensePayees(): Promise<{ ok: true; payees: import('./types').ExpensePayee[] }> {
  return request('/api/expense-payees');
}

export async function addExpensePayee(payload: import('./types').ExpensePayeeForm): Promise<{ ok: true; id: string }> {
  return request('/api/expense-payees', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateExpensePayee(payeeId: string, payload: import('./types').ExpensePayeeForm): Promise<{ ok: true; id: string }> {
  return request(`/api/expense-payees/${encodeURIComponent(payeeId)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function setExpensePayeeStatus(payeeId: string, status: 'Active' | 'Inactive'): Promise<{ ok: true; id: string; status: string }> {
  return request(`/api/expense-payees/${encodeURIComponent(payeeId)}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
}

export async function getExpensePayeeLedger(payeeId: string, filters: { from?: string; to?: string; limit?: number } = {}): Promise<{ ok: true } & import('./types').ExpensePayeeLedgerResult> {
  const q = new URLSearchParams();
  if (filters.from) q.set('from', filters.from);
  if (filters.to) q.set('to', filters.to);
  if (filters.limit) q.set('limit', String(filters.limit));
  return request(`/api/expense-payees/${encodeURIComponent(payeeId)}/ledger${q.toString() ? `?${q.toString()}` : ''}`);
}


export async function getBankAccountsPage(): Promise<{ ok: true; bankAccounts: import('./types').BankAccountFull[]; currencySymbol: string }> {
  return request('/api/bank/accounts');
}

export async function createBankAccount(payload: import('./types').BankAccountForm): Promise<{ ok: true; id: string }> {
  return request('/api/bank/accounts', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateBankAccount(accountId: string, payload: import('./types').BankAccountForm): Promise<{ ok: true; id: string }> {
  return request(`/api/bank/accounts/${encodeURIComponent(accountId)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function setBankAccountStatus(accountId: string, status: 'Active' | 'Inactive'): Promise<{ ok: true; id: string; status: string }> {
  return request(`/api/bank/accounts/${encodeURIComponent(accountId)}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
}

export async function getBankLedgerBootstrap(): Promise<{ ok: true; accounts: import('./types').BankLedgerAccount[]; entryTypes: import('./types').BankManualEntryType[]; currencySymbol: string; defaultFrom: string; defaultTo: string; activeCashSession: boolean }> {
  return request('/api/bank/ledger/bootstrap');
}

export async function getBankLedger(filters: { bankAccountId: string; from?: string; to?: string; limit?: number }): Promise<{ ok: true } & import('./types').BankLedgerResult> {
  const params = new URLSearchParams();
  params.set('bankAccountId', filters.bankAccountId);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.limit) params.set('limit', String(filters.limit));
  return request(`/api/bank/ledger?${params.toString()}`);
}

export async function addBankManualEntry(payload: {
  bankAccountId: string;
  entryType: string;
  amount: number;
  date: string;
  direction?: 'debit' | 'credit';
  reference?: string;
  description?: string;
  notes?: string;
  backdatedReason?: string;
}): Promise<{ ok: true; bankAccountId: string; newBalance: number }> {
  return request('/api/bank/manual-entry', { method: 'POST', body: JSON.stringify(payload) });
}

export async function reverseBankEntry(entryId: string, reason: string): Promise<{ ok: true; entryId: string }> {
  return request(`/api/bank/ledger/${encodeURIComponent(entryId)}/reverse`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export async function transferBetweenBankAccounts(payload: { fromAccountId: string; toAccountId: string; amount: number; notes?: string }): Promise<{ ok: true; id: string }> {
  return request('/api/bank/transfers', { method: 'POST', body: JSON.stringify(payload) });
}

export async function getBankTransferHistory(): Promise<{ ok: true; transfers: import('./types').BankTransferRow[] }> {
  return request('/api/bank/transfers');
}

export async function getDayBookBootstrap(): Promise<{ ok: true } & import('./types').DayBookBootstrap> {
  return request('/api/daybook/bootstrap');
}

export async function getDayBookTransactions(filters: {
  dateFrom?: string;
  dateTo?: string;
  module?: string;
  paymentMethod?: string;
  query?: string;
  backdatedOnly?: boolean;
  includeDeleted?: boolean;
}): Promise<{ ok: true } & import('./types').DayBookResult> {
  const params = new URLSearchParams();
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.module) params.set('module', filters.module);
  if (filters.paymentMethod) params.set('paymentMethod', filters.paymentMethod);
  if (filters.query) params.set('query', filters.query);
  if (filters.backdatedOnly) params.set('backdatedOnly', '1');
  if (filters.includeDeleted) params.set('includeDeleted', '1');
  const qs = params.toString();
  return request(`/api/daybook${qs ? `?${qs}` : ''}`);
}


export async function getFinanceBootstrap(): Promise<import('./types').FinanceBootstrap & { ok: true }> {
  return request('/api/finance/bootstrap');
}
export async function addFinancePerson(payload: { name: string; personType: 'Owner' | 'Lender'; phone?: string; notes?: string }): Promise<{ ok: true; id: string }> {
  return request('/api/finance/persons', { method: 'POST', body: JSON.stringify(payload) });
}
export async function updateFinancePerson(id: string, payload: { name: string; personType: 'Owner' | 'Lender'; phone?: string; notes?: string }): Promise<{ ok: true; id: string; name: string; personType: 'Owner' | 'Lender'; notes: string }> {
  return request(`/api/finance/persons/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
}
export async function setFinancePersonStatus(id: string, status: 'Active' | 'Inactive'): Promise<{ ok: true; id: string; status: string }> {
  return request(`/api/finance/persons/${encodeURIComponent(id)}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
}
export async function addFinanceTransaction(payload: import('./types').FinanceForm): Promise<{ ok: true; id: string; ownerCapital: number; outstandingLoan: number }> {
  return request('/api/finance/transactions', { method: 'POST', body: JSON.stringify(payload) });
}
export async function getFinanceLedger(filters: { dateFrom?: string; dateTo?: string; transactionType?: string; personId?: string; query?: string; limit?: number } = {}): Promise<import('./types').FinanceLedgerResult & { ok: true }> {
  const q = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) q.set(k, String(v)); });
  return request(`/api/finance/ledger${q.toString() ? `?${q.toString()}` : ''}`);
}
export async function getFinanceTransactionForEdit(id: string): Promise<{ ok: true; transaction: import('./types').FinanceForm & { financeId: string } }> {
  return request(`/api/finance/transactions/${encodeURIComponent(id)}`);
}
export async function updateFinanceTransaction(id: string, payload: import('./types').FinanceForm): Promise<{ ok: true; financeId: string; ownerCapital: number; outstandingLoan: number }> {
  return request(`/api/finance/transactions/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
}
export async function deleteFinanceTransaction(id: string, reason: string): Promise<{ ok: true; financeId: string; ownerCapital: number; outstandingLoan: number }> {
  return request(`/api/finance/transactions/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
}

export async function getDashboardStats(): Promise<import('./types').DashboardStats & { ok: true }> {
  return request('/api/dashboard');
}

export async function getReportsBootstrap(): Promise<import('./types').ReportsBootstrap & { ok: true }> {
  return request('/api/reports/bootstrap');
}
export async function getSalesReport(filters: { from?: string; to?: string }): Promise<import('./types').SalesReport & { ok: true }> {
  const q=new URLSearchParams(); if(filters.from)q.set('from',filters.from); if(filters.to)q.set('to',filters.to); return request(`/api/reports/sales?${q}`);
}
export async function getPurchaseReport(filters: { from?: string; to?: string }): Promise<import('./types').PurchaseReport & { ok: true }> {
  const q=new URLSearchParams(); if(filters.from)q.set('from',filters.from); if(filters.to)q.set('to',filters.to); return request(`/api/reports/purchase?${q}`);
}
export async function getStockReport(): Promise<import('./types').StockReport & { ok: true }> { return request('/api/reports/stock'); }
export async function getCashBankReport(filters: { from?: string; to?: string }): Promise<import('./types').CashBankReport & { ok: true }> {
  const q=new URLSearchParams(); if(filters.from)q.set('from',filters.from); if(filters.to)q.set('to',filters.to); return request(`/api/reports/cash-bank?${q}`);
}
export async function getProfitReport(filters: { from?: string; to?: string }): Promise<import('./types').ProfitReport & { ok: true }> {
  const q=new URLSearchParams(); if(filters.from)q.set('from',filters.from); if(filters.to)q.set('to',filters.to); return request(`/api/reports/profit?${q}`);
}
export async function getBalanceSheetReport(): Promise<import('./types').BalanceSheetReport & { ok: true }> { return request('/api/reports/balance-sheet'); }


export async function getSettingsBootstrap(): Promise<import('./types').SettingsBootstrap & { ok: true }> {
  return request('/api/settings/bootstrap');
}
export async function updateSettings(payload: Record<string, unknown>): Promise<{ ok: true }> {
  return request('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
}
export async function getInvoiceDesignBootstrap(): Promise<import('./types').InvoiceDesignBootstrap & { ok: true }> {
  return request('/api/settings/invoice-design');
}
export async function uploadInvoiceLogo(base64Data: string, mimeType: string): Promise<{ ok: true; dataUri: string }> {
  return request('/api/settings/invoice-logo', { method: 'POST', body: JSON.stringify({ base64Data, mimeType }) });
}
export async function removeInvoiceLogo(): Promise<{ ok: true }> {
  return request('/api/settings/invoice-logo', { method: 'DELETE' });
}


export async function getUsersBootstrap(): Promise<{ ok: true } & import('./types').UsersBootstrap> {
  return request('/api/users');
}
export async function createManagedUser(payload: { name: string; mobile: string; role: string; password: string }): Promise<{ ok: true; id: string }> {
  return request('/api/users', { method: 'POST', body: JSON.stringify(payload) });
}
export async function updateManagedUser(userId: string, payload: { name: string; mobile: string; role: string }): Promise<{ ok: true; id: string }> {
  return request(`/api/users/${encodeURIComponent(userId)}`, { method: 'PUT', body: JSON.stringify(payload) });
}
export async function resetManagedUserPassword(userId: string, newPassword: string): Promise<{ ok: true; id: string }> {
  return request(`/api/users/${encodeURIComponent(userId)}/reset-password`, { method: 'POST', body: JSON.stringify({ newPassword }) });
}
export async function setManagedUserStatus(userId: string, status: 'Active' | 'Inactive'): Promise<{ ok: true; id: string; status: string }> {
  return request(`/api/users/${encodeURIComponent(userId)}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
}
export async function deleteManagedUser(userId: string): Promise<{ ok: true; id: string }> {
  return request(`/api/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

export async function getRolesBootstrap(): Promise<{ ok: true } & import('./types').RolesBootstrap> {
  return request('/api/roles');
}
export async function createManagedRole(payload: { name: string; permissions: import('./types').RolePermissions }): Promise<{ ok: true; id: string }> {
  return request('/api/roles', { method: 'POST', body: JSON.stringify(payload) });
}
export async function updateManagedRole(roleId: string, payload: { name: string; permissions: import('./types').RolePermissions }): Promise<{ ok: true; id: string }> {
  return request(`/api/roles/${encodeURIComponent(roleId)}`, { method: 'PUT', body: JSON.stringify(payload) });
}
export async function setManagedRoleStatus(roleId: string, status: 'Active' | 'Inactive'): Promise<{ ok: true; id: string; status: string }> {
  return request(`/api/roles/${encodeURIComponent(roleId)}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
}
export async function deleteManagedRole(roleId: string): Promise<{ ok: true; id: string }> {
  return request(`/api/roles/${encodeURIComponent(roleId)}`, { method: 'DELETE' });
}


export async function getVendorsBootstrap(): Promise<{ ok: true } & import('./types').VendorBootstrap> {
  return request('/api/vendors/bootstrap');
}
export async function addVendor(payload: { name: string; phone?: string }): Promise<{ ok: true; id: string }> {
  return request('/api/vendors', { method: 'POST', body: JSON.stringify(payload) });
}
export async function updateVendor(vendorId: string, payload: { name: string; phone?: string }): Promise<{ ok: true; id: string; name: string; phone: string }> {
  return request(`/api/vendors/${encodeURIComponent(vendorId)}`, { method: 'PUT', body: JSON.stringify(payload) });
}
export async function setVendorStatus(vendorId: string, status: 'Active' | 'Inactive'): Promise<{ ok: true; id: string; status: string }> {
  return request(`/api/vendors/${encodeURIComponent(vendorId)}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
}
export async function getVendorDetail(vendorId: string, filters: { from?: string; to?: string; limit?: number } = {}): Promise<{ ok: true } & import('./types').VendorDetail> {
  const q = new URLSearchParams();
  if (filters.from) q.set('from', filters.from);
  if (filters.to) q.set('to', filters.to);
  if (filters.limit) q.set('limit', String(filters.limit));
  return request(`/api/vendors/${encodeURIComponent(vendorId)}${q.toString() ? `?${q.toString()}` : ''}`);
}

export async function payVendor(vendorId: string, payload: { amount: number; method: string; bankAccountId?: string; notes?: string; date: string; backdatedReason?: string }): Promise<{ ok: true; ledgerId: string; newDue: number }> {
  return request(`/api/vendors/${encodeURIComponent(vendorId)}/pay`, { method: 'POST', body: JSON.stringify(payload) });
}
export async function returnProductsToVendor(vendorId: string, payload: { sourcingId: string; quantity: number; unitCost: number; notes?: string; date: string; backdatedReason?: string }): Promise<{ ok: true }> {
  return request(`/api/vendors/${encodeURIComponent(vendorId)}/return-products`, { method: 'POST', body: JSON.stringify(payload) });
}
export async function giveProductsToVendor(vendorId: string, payload: { productId: string; quantity: number; unitValue: number; notes?: string; date: string; backdatedReason?: string }): Promise<{ ok: true }> {
  return request(`/api/vendors/${encodeURIComponent(vendorId)}/give-products`, { method: 'POST', body: JSON.stringify(payload) });
}
export async function receiveVendorPayment(vendorId: string, payload: { amount: number; method: string; bankAccountId?: string; notes?: string; date: string; backdatedReason?: string }): Promise<{ ok: true; ledgerId: string; newReceivable: number }> {
  return request(`/api/vendors/${encodeURIComponent(vendorId)}/receive-payment`, { method: 'POST', body: JSON.stringify(payload) });
}
export async function receiveProductsFromVendor(vendorId: string, payload: { issueId: string; quantity: number; unitValue: number; notes?: string; date: string; backdatedReason?: string }): Promise<{ ok: true }> {
  return request(`/api/vendors/${encodeURIComponent(vendorId)}/receive-products`, { method: 'POST', body: JSON.stringify(payload) });
}


export async function searchSalesInvoicesForReturn(query: string): Promise<{ ok: true; matches: import('./types').SalesReturnSearchResult[] }> {
  return request(`/api/sales-returns/search?q=${encodeURIComponent(query)}`);
}

export async function getSalesReturnDetail(returnId: string): Promise<{ ok: true; detail: import('./types').SalesReturnDetail }> {
  return request(`/api/sales-returns/history/${encodeURIComponent(returnId)}`);
}


export async function getSystemOverview(): Promise<{ ok: true; overview: import('./types').SystemOverview }> {
  return request('/api/admin/system/overview');
}

export async function downloadSystemBackup(): Promise<import('./types').SystemBackupFile> {
  const token = getToken();
  const response = await fetch('/api/admin/system/backup', {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `Backup failed: ${response.status}`);
  return data.backup as import('./types').SystemBackupFile;
}

export async function restoreSystemBackup(backup: import('./types').SystemBackupFile, confirmation: string): Promise<{ ok: true; restoredTables: number; restoredRows: number; signInAgain: boolean }> {
  return request('/api/admin/system/restore', {
    method: 'POST',
    body: JSON.stringify({ backup, confirmation })
  });
}

export async function getAuditLogs(filters: { dateFrom?: string; dateTo?: string; action?: string; entityType?: string; query?: string }): Promise<{ ok: true } & import('./types').AuditLogResult> {
  const qs = new URLSearchParams();
  if (filters.dateFrom) qs.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) qs.set('dateTo', filters.dateTo);
  if (filters.action) qs.set('action', filters.action);
  if (filters.entityType) qs.set('entityType', filters.entityType);
  if (filters.query) qs.set('q', filters.query);
  return request(`/api/admin/audit?${qs.toString()}`);
}

// Optional mixed-unit configuration; canonical product stock remains in the base unit.
export interface ProductUnitRelation { unit: string; count: number; smallerUnit: string; factor?: number }
export async function getProductConversions(id: string): Promise<{ok:true; productId:string; baseUnit:string; relations: ProductUnitRelation[]}> {
  return request(`/api/products/${encodeURIComponent(id)}/conversions`);
}
export async function saveProductConversions(id: string, relations: ProductUnitRelation[]): Promise<{ok:true; productId:string; baseUnit:string; relations: ProductUnitRelation[]}> {
  return request(`/api/products/${encodeURIComponent(id)}/conversions`, { method:'PUT', body: JSON.stringify({relations}) });
}

export interface BatchReturnCustomer { id:string;name:string;phone:string;currentDue:number;invoiceCount:number }
export interface BatchReturnInvoice { invoiceId:string;date:string;grandTotal:number;paidAmount:number;dueAmount:number;returnedAmount:number;remainingQuantity:number }
export function searchBatchReturnCustomers(q:string): Promise<{ok:true;customers:BatchReturnCustomer[]}> {
  return request(`/api/sales-returns/customers/search?q=${encodeURIComponent(q)}`);
}
export function getBatchReturnCustomerInvoices(id:string): Promise<{ok:true;customer:{customer_id:string;customer_name:string;phone:string};invoices:BatchReturnInvoice[]}> {
  return request(`/api/sales-returns/customers/${encodeURIComponent(id)}/invoices`);
}
export function completeBatchSalesReturn(payload: {
  customerId:string;refundMethod:'Cash'|'Store Credit';date:string;reason:string;notes?:string;backdatedReason?:string;
  invoices:Array<{invoiceId:string;items:Array<{productId:string;qty:number;unitPrice:number}>}>;
}): Promise<{ok:true;batchId:string;returns:Array<{returnId:string;invoiceId:string;totalReturnAmount:number}>;totalReturnAmount:number}> {
  return request('/api/sales-returns/batch',{method:'POST',body:JSON.stringify(payload)});
}
