/** Real BanijjIQ /api adapter. The demo stores elsewhere in HisabIQ remain preview-only. */
export interface BackendUser {
  userId: string;
  fullName: string;
  phone: string;
  role: string;
  allowedModules?: string[] | null;
  permissions?: Record<string, { view: boolean; add: boolean; edit: boolean; delete?: boolean | string }> | null;
}
export interface BackendProduct {
  productId: string;
  productName: string;
  displayName?: string;
  category: string;
  brand: string;
  unit: string;
  barcode: string;
  sellingPrice: number;
  purchasePrice: number;
  minimumStock: number;
  trackSerial: boolean | number;
  trackExpiry: boolean | number;
  trackWarranty: boolean | number;
  updatedAt: string;
  currentStock: number;
  sellableStock?: number;
  stockValue?: number;
  pendingTracking?: number;
  expiredStock?: number;
  productType?: 'Standard' | 'Bundle';
  status: string;
}
const tokenKey = 'shererp_auth_token';
export const readToken = () => localStorage.getItem(tokenKey) || '';
export const storeToken = (value: string) => localStorage.setItem(tokenKey, value);
export const clearToken = () => localStorage.removeItem(tokenKey);

export class BackendRequestError extends Error {
  constructor(message: string, public readonly status: number | null) {
    super(message);
    this.name = 'BackendRequestError';
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/api/')) throw new Error('API requests must use a relative /api/ path');
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body) headers.set('Content-Type', 'application/json');
  const token = readToken();
  if (token) headers.set('Authorization', 'Bearer ' + token);
  let response: Response;
  try { response = await fetch(path, { ...options, headers, credentials: 'same-origin' }); }
  catch { throw new BackendRequestError('Network connection failed. The server may have received your request.', null); }
  const payload = await response.json().catch(() => null) as (T & { ok?: boolean; error?: string }) | null;
  if (!response.ok || !payload || payload.ok === false) {
    if (response.status === 401) clearToken();
    throw new BackendRequestError(payload?.error || 'Request failed (' + response.status + ')', response.status);
  }
  return payload as T;
}

export const login = (phone: string, password: string) =>
  request<{ ok: true; token: string; user: BackendUser }>('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ phone, password })
  });
export const getMe = () =>
  request<{ ok: true; user: BackendUser | null }>('/api/auth/me');
export const logout = () =>
  request<{ ok: true }>('/api/auth/logout', { method: 'POST' });
export const getBootstrap = () =>
  request<{ ok: true; products: BackendProduct[] }>('/api/bootstrap');

export interface PosUnitEntry { unit:string; symbol:string; factor:number; containsNext:number|null; sellingPrice:number }
export interface ProductUnitProfile {baseUnit:string;units:PosUnitEntry[]}
export interface UnitProfileDraft {expectedRevision:number;units:Array<{
  unit:string;symbol:string;containsNext?:number;sellingPrice?:number
}>}
export const getProductUnitProfile=(id:string)=>
  request<{ok:true;productId:string;revision:number;profile:ProductUnitProfile|null;postingEnabled:boolean}>(
    '/api/products/'+encodeURIComponent(id)+'/unit-profile');
export const updateProductUnitProfile=(id:string,input:UnitProfileDraft)=>
  request<{ok:true;productId:string;revision:number;profile:ProductUnitProfile;postingEnabled:boolean}>(
    '/api/products/'+encodeURIComponent(id)+'/unit-profile',{method:'PUT',body:JSON.stringify(input)});

export interface PosUnitProfile { baseUnit:string; units:PosUnitEntry[] }
export interface PosProfilePreview extends PosUnitProfile { revision:number; postingEnabled:boolean }
export interface PosProduct {
  id: string; name: string; productName: string; brand: string; category: string; unit: string;
  barcode: string; sellingPrice: number; stock: number; minimumStock: number;
  trackSerial: boolean; trackExpiry: boolean; trackWarranty: boolean;
  totalStock?: number; pendingTracking?: number; expiredStock?: number;
  unitProfilePreview?: PosProfilePreview | null;
}
export interface PosCustomer {
  id: string; name: string; phone: string; fatherName: string; address: string; currentDue: number;
}
export interface PosBankAccount { id: string; name: string; accountType: string }
export interface PosVendor { id: string; name: string; phone: string; currentDue: number; status: string }
export interface PosBootstrap {
  ok: true; products: PosProduct[]; customers: PosCustomer[]; bankAccounts: PosBankAccount[];
  vendors: PosVendor[];
  activeSession: { sessionId: string; openedAt: string; openingCash: number } | null;
  invoiceDesign: { settings: Record<string,string>; logoDataUri: string };
}
export interface PosSaleLine {
  productId: string; name: string; qty: number; unitPrice: number;
  fulfillmentMode: 'own' | 'negative' | 'vendor';
  serialNumbers?: string[];
  unitQuantities?: Record<string,number>; unitProfileRevision?: number;
  vendorId?: string;
  vendorUnitCost?: number;
}
export interface PosSalePayload {
  clientRequestId: string;
  customerId?: string; customerName: string; customerPhone: string; customerAddress?: string;
  customerFatherName?: string; discount: number; paymentType: 'Cash' | 'Due' | 'Partial';
  paidAmount: number; paymentMethod: 'Cash' | 'Bank' | 'Mobile Banking'; bankAccountId?: string;
  items: PosSaleLine[];
}
export interface PosInvoice {
  invoiceId: string; date: string; customerName: string; customerPhone: string;
  customerFatherName?: string; customerAddress?: string; subtotal: number; discount: number;
  paymentMethod: string;
  items: Array<{productId:string;productName:string;quantity:number;unit:string;unitPrice:number;lineTotal:number;
    unitDescription?:string;unitSnapshot?:{revision:number;profile:PosUnitProfile;quantities:Record<string,number>}}>;
  grandTotal: number; paidAmount: number; dueAmount: number; paymentStatus: string;
}
export const getPosBootstrap = () => request<PosBootstrap>('/api/pos/bootstrap');
export const startCashSession = (openingCash: number) =>
  request<{ ok: true; sessionId: string }>('/api/pos/cash-session/start', {
    method: 'POST', body: JSON.stringify({ openingCash })
  });
export const postSale = (payload: PosSalePayload) =>
  request<{ ok: true; invoice: PosInvoice }>('/api/pos/sales', {
    method: 'POST', body: JSON.stringify(payload)
  });

export const getSalesByPhone = (phone: string) =>
  request<{ ok: true; sales: Array<{ invoiceId: string; date: string; grandTotal: number; paymentStatus: string }> }>(
    '/api/pos/sales-by-phone?phone=' + encodeURIComponent(phone));

/** Product creation uses the existing BanijjIQ API and creates the opening FIFO lot when needed. */
export interface BasicProductInput {
  productName: string; brand: string; category: string; unit: string; barcode: string;
  purchasePrice: number; sellingPrice: number; minimumStock: number; currentStock: number;
  status: 'Active' | 'Inactive'; trackSerial: false; trackExpiry: false; trackWarranty: false;
  warrantyPeriodValue: 0; warrantyPeriodUnit: 'Months';
}
export type ProductCatalogEdit = Pick<BasicProductInput,
  'productName' | 'brand' | 'category' | 'barcode' | 'purchasePrice' | 'sellingPrice' | 'minimumStock'
> & { expectedUpdatedAt: string };
export const createBasicProduct = (payload: BasicProductInput) =>
  request<{ ok: true; productId: string }>('/api/products', { method: 'POST', body: JSON.stringify(payload) });
export const updateProductCatalog = (productId: string, payload: ProductCatalogEdit) =>
  request<{ ok: true; productId: string }>('/api/products/' + encodeURIComponent(productId) + '/catalog', {
    method: 'PUT', body: JSON.stringify(payload)
  });

export const getPosInvoice = (id:string) =>
  request<{ ok:true; invoice:PosInvoice }>('/api/pos/invoices/'+encodeURIComponent(id));

/** Phase 13 live stock/tracking and invoice return APIs. Never source IDs from demo stores. */
export const getPosTrackingOptions = (productId: string) =>
  request<{ ok: true; serials: Array<{serialNumber:string;expiryDate?:string}> }>(
    '/api/pos/products/' + encodeURIComponent(productId) + '/tracking-options');
export const createPosVendor = (name:string,phone:string) =>
  request<{ok:true;vendor:PosVendor}>('/api/pos/vendors',{
    method:'POST',body:JSON.stringify({name,phone})
  });
export interface ReturnInvoiceMatch {
  invoiceId:string;date:string;customerName:string;customerPhone:string;
  grandTotal:number;paymentStatus:string;returnStatus:string;
}
export interface ReturnMixedUnit {profile:PosUnitProfile;originalQuantities:Record<string,number>;
  availableQuantities:Record<string,number>;description:string;netPriceFactor:number}
export interface ReturnableLine {
  productId:string;name:string;soldQty:number;vendorQty:number;previouslyReturnedQty:number;
  availableQty:number;unitPrice:number;trackSerial:boolean|number;trackExpiry:boolean|number;
  trackWarranty:boolean|number;availableSerials:string[];mixedUnit?:ReturnMixedUnit|null;
}
export interface ReturnableInvoice {
  invoiceId:string;date:string;customerId:string;customerName:string;customerPhone:string;
  grandTotal:number;paidAmount:number;dueAmount:number;previouslyReturnedAmount:number;
  netSale:number;items:ReturnableLine[];
}
export interface SalesReturnPayload {
  invoiceId:string;refundMethod:'Cash'|'Store Credit';reason:string;
  items:Array<{productId:string;qty:number;unitPrice:number;serialNumbers?:string[];unitQuantities?:Record<string,number>}>;
}
export const searchReturnInvoices = (query:string) =>
  request<{ok:true;matches:ReturnInvoiceMatch[]}>('/api/sales-returns/search?q='+encodeURIComponent(query));
export const getReturnableInvoice = (id:string) =>
  request<{ok:true;sale:ReturnableInvoice}>('/api/sales-returns/'+encodeURIComponent(id)+'/data');
export const postSalesReturn = (payload:SalesReturnPayload) =>
  request<{ok:true;returnId:string;totalReturnAmount:number}>('/api/sales-returns',{
    method:'POST',body:JSON.stringify(payload)
  });
export interface MixedReversalPreview {
  eligible:boolean;reason:string;invoiceId:string;refundAmount:number;
  previouslyRefundedAmount:number;remainingBaseQuantity:number;
  items:Array<{productId:string;qty:number;unitPrice:number;unitQuantities:Record<string,number>}>;
}
export const getMixedReversalPreview = (id:string)=>
  request<{ok:true;preview:MixedReversalPreview}>(
    '/api/sales-management/'+encodeURIComponent(id)+'/reverse');
export const postMixedReversal = (id:string,reason:string)=>
  request<{ok:true;returnId:string;totalReturnAmount:number}>(
    '/api/sales-management/'+encodeURIComponent(id)+'/reverse',{
      method:'POST',body:JSON.stringify({reason})
    });

export const getSalesReturnHistory = () =>
  request<{ok:true;returns:Array<{returnId:string;invoiceId:string;totalReturnAmount:number}>}>('/api/sales-returns');

/** Phase 5 Reports: server-only source records; no demo report stores. */
export type LiveReportStatus = 'ready'|'needs-review'|'incomplete'|'unavailable';
export type LiveReportBackendKey = 'sales'|'purchase'|'stock'|'receivables'|'payables'|'profit'|'cash'|'bank'|'finance'|'expenses'|'audit';
export interface LiveReportEntry {id:LiveReportBackendKey;en:string;bn:string;group:string;status:LiveReportStatus;reason:string}
export interface LiveReportRecord {
  sourceId:string;sourceModule:string;date:string;label:string;
  amountMinor:number|null;status:LiveReportStatus;reason:string;
}
export interface LiveReportMetric {
  key:string; valueMinor:number|null; status:LiveReportStatus; reason:string; asOf:string;
  sources:Array<{module:string;sourceId:string;date:string|null}>;
}
export interface LiveReportPageResponse {
  ok:true;report:LiveReportBackendKey;range:{from:string;to:string};page:number;pageSize:50|100;
  totalRows:number;rows:LiveReportRecord[];metrics:LiveReportMetric[];
  coverage:{status:LiveReportStatus;reason:string};
}
export interface LiveReportRequest {
  report:LiveReportBackendKey;from:string;to:string;page:number;pageSize:50|100;search?:string;
}
export const getLiveReportCatalog=()=>request<{
  ok:true;mainTabs:Array<{id:'overview'|'library';en:string;bn:string}>;
  reports:LiveReportEntry[];
}>('/api/reports/v2/catalog');
export const getLiveReportRows=(query:LiveReportRequest)=>{
  const params=new URLSearchParams({
    report:query.report,from:query.from,to:query.to,page:String(query.page),
    pageSize:String(query.pageSize),search:query.search??''
  });
  return request<LiveReportPageResponse>('/api/reports/v2/rows?'+params.toString());
};
export const getLiveReportSummary=(from:string,to:string)=>{
  const params=new URLSearchParams({from,to,report:'sales'});
  return request<{ok:true;range:{from:string;to:string};metrics:LiveReportMetric[];
    coverage:{status:LiveReportStatus;reason:string}}>('/api/reports/v2/summary?'+params.toString());
};

export interface BankReconciliationAccount {
  id: string;
  name: string;
  accountType: 'Bank' | 'Mobile Banking';
  openingBalance: number;
  recordedBalance: number;
  bookBalance: number | null;
  status: 'ready' | 'needs-review';
  reason: string;
}
export interface BankReconciliation {
  ok: true;
  asOf: string;
  accounts: BankReconciliationAccount[];
  coverage: { status:'ready'|'needs-review'; reason:string };
}
export interface FinanceBootstrap {
  ok: true;
  currencySymbol: string;
  activeCashSession: boolean;
  personsAll: Array<{id:string;name:string;type:'Owner'|'Lender';status:string;phone:string}>;
}
export const getBankReconciliation = () =>
  request<BankReconciliation>('/api/bank/reconciliation');
export const getFinanceBootstrap = () =>
  request<FinanceBootstrap>('/api/finance/bootstrap');

