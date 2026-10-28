import type { SherDatabase } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
import type { ExpenseInput } from './types.js';
import {
  addExpenseRoute,
  cancelExpenseRoute,
  createExpenseCategoryRoute,
  createExpensePayeeRoute,
  getExpenseBootstrapRoute,
  getExpenseCategoriesRoute,
  getExpenseDetailRoute,
  getExpensePayeeLedgerRoute,
  getExpensePayeesRoute,
  getExpensesRoute,
  setExpenseCategoryStatusRoute,
  setExpensePayeeStatusRoute,
  updateExpenseCategoryRoute,
  updateExpensePayeeRoute,
  updateExpenseRoute
} from './service.js';

async function readBody<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

export async function handleExpensesRoute(request: Request, db: SherDatabase, auth: AuthUser): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/expenses/bootstrap' && request.method === 'GET') return getExpenseBootstrapRoute(db);
  if (path === '/api/expenses' && request.method === 'GET') return getExpensesRoute(db);
  if (path === '/api/expenses' && request.method === 'POST') return addExpenseRoute(db, await readBody<ExpenseInput>(request), auth);
  if (path === '/api/expense-categories' && request.method === 'GET') return getExpenseCategoriesRoute(db);
  if (path === '/api/expense-categories' && request.method === 'POST') return createExpenseCategoryRoute(db, await readBody<any>(request));
  if (path === '/api/expense-payees' && request.method === 'GET') return getExpensePayeesRoute(db);
  if (path === '/api/expense-payees' && request.method === 'POST') return createExpensePayeeRoute(db, await readBody<any>(request));

  const expenseCancelMatch = path.match(/^\/api\/expenses\/([^/]+)\/cancel$/);
  if (expenseCancelMatch && request.method === 'POST') {
    const body = await readBody<{ reason?: string }>(request);
    return cancelExpenseRoute(db, decodeURIComponent(expenseCancelMatch[1]), cleanText(body.reason), auth);
  }

  const expenseMatch = path.match(/^\/api\/expenses\/([^/]+)$/);
  if (expenseMatch && request.method === 'GET') return getExpenseDetailRoute(db, decodeURIComponent(expenseMatch[1]));
  if (expenseMatch && request.method === 'PUT') return updateExpenseRoute(db, decodeURIComponent(expenseMatch[1]), await readBody<ExpenseInput>(request));

  const payeeLedgerMatch = path.match(/^\/api\/expense-payees\/([^/]+)\/ledger$/);
  if (payeeLedgerMatch && request.method === 'GET') return getExpensePayeeLedgerRoute(db, decodeURIComponent(payeeLedgerMatch[1]), url);

  const payeeStatusMatch = path.match(/^\/api\/expense-payees\/([^/]+)\/status$/);
  if (payeeStatusMatch && request.method === 'PUT') {
    const body = await readBody<{ status?: string }>(request);
    return setExpensePayeeStatusRoute(db, decodeURIComponent(payeeStatusMatch[1]), cleanText(body.status));
  }

  const payeeMatch = path.match(/^\/api\/expense-payees\/([^/]+)$/);
  if (payeeMatch && request.method === 'PUT') return updateExpensePayeeRoute(db, decodeURIComponent(payeeMatch[1]), await readBody<any>(request));

  const categoryStatusMatch = path.match(/^\/api\/expense-categories\/([^/]+)\/status$/);
  if (categoryStatusMatch && request.method === 'PUT') {
    const body = await readBody<{ status?: string }>(request);
    return setExpenseCategoryStatusRoute(db, decodeURIComponent(categoryStatusMatch[1]), cleanText(body.status));
  }

  const categoryMatch = path.match(/^\/api\/expense-categories\/([^/]+)$/);
  if (categoryMatch && request.method === 'PUT') return updateExpenseCategoryRoute(db, decodeURIComponent(categoryMatch[1]), await readBody<any>(request));

  return null;
}
