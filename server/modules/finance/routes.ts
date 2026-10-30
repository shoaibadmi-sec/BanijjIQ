import type { SherDatabase } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
import type { BankAccountInput, BankManualInput, BankTransferInput, FinanceInput, FinancePersonInput } from './types.js';
import {
  getBankAccountsRoute, createBankAccountRoute, updateBankAccountRoute, setBankAccountStatusRoute,
  getBankReconciliationRoute, getBankLedgerBootstrapRoute, getBankLedgerRoute, addBankManualEntryRoute, reverseBankEntryRoute,
  transferBankRoute, reverseBankTransferRoute, getBankTransfersRoute, getFinanceBootstrapRoute, addFinancePersonRoute,
  setFinancePersonStatusRoute, updateFinancePersonRoute, addFinanceTransactionRoute, getFinanceLedgerRoute, getFinancePersonLedgerRoute, getFinanceTransactionRoute,
  updateFinanceTransactionRoute, deleteFinanceTransactionRoute
} from './service.js';

async function readBody<T>(request: Request): Promise<T> { try { return await request.json() as T; } catch { throw new Error('Invalid JSON body'); } }
function cleanText(value: unknown): string { return String(value ?? '').trim(); }

export async function handleBankFinanceRoute(db: SherDatabase, request: Request, path: string, auth: AuthUser): Promise<Response | null> {
  const url = new URL(request.url);

  if (path === '/api/finance/bootstrap' && request.method === 'GET') return getFinanceBootstrapRoute(db);
  if (path === '/api/finance/persons' && request.method === 'POST') return addFinancePersonRoute(db, await readBody<FinancePersonInput>(request));
  if (path === '/api/finance/transactions' && request.method === 'POST') return addFinanceTransactionRoute(db, await readBody<FinanceInput>(request), auth);
  if (path === '/api/finance/ledger' && request.method === 'GET') return getFinanceLedgerRoute(db, url);

  const personLedgerMatch=path.match(/^\/api\/finance\/persons\/([^/]+)\/ledger$/);
  if(personLedgerMatch && request.method==='GET')return getFinancePersonLedgerRoute(db,decodeURIComponent(personLedgerMatch[1]),url);
  const financePersonStatusMatch = path.match(/^\/api\/finance\/persons\/([^/]+)\/status$/);
  if (financePersonStatusMatch && request.method === 'PUT') { const body=await readBody<{status?:string}>(request); return setFinancePersonStatusRoute(db, decodeURIComponent(financePersonStatusMatch[1]), cleanText(body.status)); }
  const financePersonMatch = path.match(/^\/api\/finance\/persons\/([^/]+)$/);
  if (financePersonMatch && request.method === 'PUT') return updateFinancePersonRoute(db, decodeURIComponent(financePersonMatch[1]), await readBody<FinancePersonInput>(request));
  const financeTxMatch = path.match(/^\/api\/finance\/transactions\/([^/]+)$/);
  if (financeTxMatch && request.method === 'GET') return getFinanceTransactionRoute(db, decodeURIComponent(financeTxMatch[1]));
  if (financeTxMatch && request.method === 'PUT') return updateFinanceTransactionRoute(db, decodeURIComponent(financeTxMatch[1]), await readBody<FinanceInput>(request), auth);
  if (financeTxMatch && request.method === 'DELETE') { const body=await readBody<{reason?:string}>(request); return deleteFinanceTransactionRoute(db, decodeURIComponent(financeTxMatch[1]), cleanText(body.reason), auth); }

  if (path === '/api/bank/reconciliation' && request.method === 'GET') return getBankReconciliationRoute(db);
  if (path === '/api/bank/accounts' && request.method === 'GET') return getBankAccountsRoute(db);
  if (path === '/api/bank/accounts' && request.method === 'POST') return createBankAccountRoute(db, await readBody<BankAccountInput>(request));
  if (path === '/api/bank/ledger/bootstrap' && request.method === 'GET') return getBankLedgerBootstrapRoute(db);
  if (path === '/api/bank/ledger' && request.method === 'GET') return getBankLedgerRoute(db, url);
  if (path === '/api/bank/manual-entry' && request.method === 'POST') return addBankManualEntryRoute(db, await readBody<BankManualInput>(request), auth);
  if (path === '/api/bank/transfers' && request.method === 'GET') return getBankTransfersRoute(db);
  if (path === '/api/bank/transfers' && request.method === 'POST') return transferBankRoute(db, await readBody<BankTransferInput>(request), auth);
  const bankTransferReverseMatch=path.match(/^\/api\/bank\/transfers\/([^/]+)\/reverse$/);
  if(bankTransferReverseMatch && request.method==='POST') { const body=await readBody<{reason?:string}>(request);return reverseBankTransferRoute(db,decodeURIComponent(bankTransferReverseMatch[1]),cleanText(body.reason),auth); }
  const bankAccountStatusMatch = path.match(/^\/api\/bank\/accounts\/([^/]+)\/status$/);
  if (bankAccountStatusMatch && request.method === 'PUT') { const body=await readBody<{ status?: string }>(request); return setBankAccountStatusRoute(db, decodeURIComponent(bankAccountStatusMatch[1]), cleanText(body.status)); }
  const bankAccountMatch = path.match(/^\/api\/bank\/accounts\/([^/]+)$/);
  if (bankAccountMatch && request.method === 'PUT') return updateBankAccountRoute(db, decodeURIComponent(bankAccountMatch[1]), await readBody<BankAccountInput>(request));
  const bankReverseMatch = path.match(/^\/api\/bank\/ledger\/([^/]+)\/reverse$/);
  if (bankReverseMatch && request.method === 'POST') { const body=await readBody<{ reason?: string }>(request); return reverseBankEntryRoute(db, decodeURIComponent(bankReverseMatch[1]), cleanText(body.reason), auth); }

  return null;
}
