import type { SherDatabase } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
import type { CustomerInput, CustomerPaymentInput } from './types.js';
import {
  createCustomer,
  deleteCustomer,
  deleteCustomerPayment,
  getCustomerDetail,
  getCustomerPayment,
  getCustomersPage,
  receiveCustomerPayment,
  updateCustomer,
  updateCustomerPayment
} from './service.js';

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

export async function handleCustomersRoute(db: SherDatabase, request: Request, path: string, auth: AuthUser): Promise<Response | null> {
  if (path === '/api/customers' && request.method === 'GET') return getCustomersPage(db);
  if (path === '/api/customers' && request.method === 'POST') return createCustomer(db, await readBody<CustomerInput>(request), auth);

  const customerPaymentCreateMatch = path.match(/^\/api\/customers\/([^/]+)\/payments$/);
  if (customerPaymentCreateMatch && request.method === 'POST') {
    return receiveCustomerPayment(db, decodeURIComponent(customerPaymentCreateMatch[1]), await readBody<CustomerPaymentInput>(request), auth);
  }

  const customerMatch = path.match(/^\/api\/customers\/([^/]+)$/);
  if (customerMatch && request.method === 'GET') return getCustomerDetail(db, decodeURIComponent(customerMatch[1]), new URL(request.url));
  if (customerMatch && request.method === 'PUT') return updateCustomer(db, decodeURIComponent(customerMatch[1]), await readBody<CustomerInput>(request));
  if (customerMatch && request.method === 'DELETE') {
    const body = await readBody<{ confirmKey?: string; reason?: string }>(request);
    return deleteCustomer(db, decodeURIComponent(customerMatch[1]), cleanText(body.confirmKey), cleanText(body.reason), auth);
  }

  const customerPaymentMatch = path.match(/^\/api\/customer-payments\/([^/]+)$/);
  if (customerPaymentMatch && request.method === 'GET') return getCustomerPayment(db, decodeURIComponent(customerPaymentMatch[1]));
  if (customerPaymentMatch && request.method === 'PUT') return updateCustomerPayment(db, decodeURIComponent(customerPaymentMatch[1]), await readBody<CustomerPaymentInput>(request), auth);
  if (customerPaymentMatch && request.method === 'DELETE') {
    const body = await readBody<{ reason?: string }>(request);
    return deleteCustomerPayment(db, decodeURIComponent(customerPaymentMatch[1]), cleanText(body.reason), auth);
  }

  return null;
}
