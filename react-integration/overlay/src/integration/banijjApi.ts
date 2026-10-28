/** Real BanijjIQ /api adapter. The demo stores elsewhere in HisabIQ remain preview-only. */
export interface BackendUser {
  userId: string;
  fullName: string;
  phone: string;
  role: string;
  allowedModules?: string[] | null;
  permissions?: Record<string, { view: boolean; add: boolean; edit: boolean }> | null;
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
  currentStock: number;
  sellableStock?: number;
  status: string;
}
const tokenKey = 'shererp_auth_token';
export const readToken = () => localStorage.getItem(tokenKey) || '';
export const storeToken = (value: string) => localStorage.setItem(tokenKey, value);
export const clearToken = () => localStorage.removeItem(tokenKey);

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/api/')) throw new Error('API requests must use a relative /api/ path');
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body) headers.set('Content-Type', 'application/json');
  const token = readToken();
  if (token) headers.set('Authorization', 'Bearer ' + token);
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  const payload = await response.json().catch(() => null) as (T & { ok?: boolean; error?: string }) | null;
  if (!response.ok || !payload || payload.ok === false) {
    if (response.status === 401) clearToken();
    throw new Error(payload?.error || 'Request failed (' + response.status + ')');
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

export interface PosProduct {
  id: string; name: string; productName: string; brand: string; category: string; unit: string;
  barcode: string; sellingPrice: number; stock: number; minimumStock: number;
  trackSerial: boolean; trackExpiry: boolean; trackWarranty: boolean;
}
export interface PosCustomer {
  id: string; name: string; phone: string; fatherName: string; address: string; currentDue: number;
}
export interface PosBankAccount { id: string; name: string; accountType: string }
export interface PosBootstrap {
  ok: true; products: PosProduct[]; customers: PosCustomer[]; bankAccounts: PosBankAccount[];
  activeSession: { sessionId: string; openedAt: string; openingCash: number } | null;
}
export interface PosSaleLine {
  productId: string; name: string; qty: number; unitPrice: number;
  fulfillmentMode: 'own';
}
export interface PosSalePayload {
  customerId?: string; customerName: string; customerPhone: string; customerAddress?: string;
  customerFatherName?: string; discount: number; paymentType: 'Cash' | 'Due' | 'Partial';
  paidAmount: number; paymentMethod: 'Cash' | 'Bank' | 'Mobile Banking'; bankAccountId?: string;
  items: PosSaleLine[];
}
export interface PosInvoice {
  invoiceId: string; date: string; customerName: string; customerPhone: string;
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
