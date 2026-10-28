import type { SherDatabase, SqlPreparedStatement } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
import { createSupplierId, hasActiveCashSession, methodNeedsBank, validateBankAccount } from './service.js';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type, authorization'
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function error(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function money(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 10000) / 10000;
}

async function readBody<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new Error('Invalid JSON body');
  }
}

async function createSupplierRoute(db: SherDatabase, input: { name?: string; phone?: string; address?: string; openingBalance?: number; notes?: string }, user?: AuthUser): Promise<Response> {
  const name = cleanText(input.name);
  if (!name) return error('Supplier name is required.');
  const existing = await db.prepare(`SELECT supplier_id AS id, supplier_name AS name FROM suppliers WHERE LOWER(supplier_name) = LOWER(?) AND COALESCE(is_deleted,0) = 0 LIMIT 1`).bind(name).first<{ id: string; name: string }>();
  if (existing) return error('A supplier with this name already exists.', 409);
  const opening = money(input.openingBalance);
  if (opening > 0 && !(await hasActiveCashSession(db))) return error('Start your cash session in POS before creating a supplier with an opening balance.');
  const id = await createSupplierId(db);
  const ledgerId = crypto.randomUUID();
  const batch: SqlPreparedStatement[] = [db.prepare(`
    INSERT INTO suppliers (supplier_id, supplier_name, phone, address, opening_balance, current_due, notes, status, is_deleted, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', 0, datetime('now'), datetime('now'))
  `).bind(id, name, cleanText(input.phone), cleanText(input.address), opening, opening, cleanText(input.notes))];
  if (opening > 0) {
    batch.push(db.prepare(`INSERT INTO supplier_ledger (ledger_id, date, supplier_id, supplier_name, type, reference, debit, credit, balance, notes, created_by, created_at)
      VALUES (?, date('now'), ?, ?, 'Opening Balance', ?, ?, 0, ?, '', ?, datetime('now'))`)
      .bind(ledgerId, id, name, id, opening, opening, user?.userId || ''));
  }
  await db.batch(batch);
  return json({ ok: true, id, name });
}

function supplierPublic(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(row.supplier_id || ''),
    name: String(row.supplier_name || ''),
    phone: String(row.phone || ''),
    address: String(row.address || ''),
    openingBalance: money(row.opening_balance),
    currentDue: Number(row.current_due || 0),
    notes: String(row.notes || ''),
    status: String(row.status || 'Active'),
    createdAt: String(row.created_at || '')
  };
}


async function getSuppliersPageRoute(db: SherDatabase): Promise<Response> {
  const [supResult, bankResult] = await Promise.all([
    db.prepare(`SELECT * FROM suppliers WHERE COALESCE(is_deleted,0)=0 ORDER BY supplier_name COLLATE NOCASE`).all(),
    db.prepare(`SELECT bank_account_id AS id, account_name AS name, account_type AS accountType FROM bank_accounts WHERE status='Active' ORDER BY account_name`).all()
  ]);
  return json({
    ok: true,
    suppliers: (supResult.results ?? []).map((row) => supplierPublic(row as Record<string, unknown>)),
    bankAccounts: bankResult.results ?? [],
    currencySymbol: '',
    activeCashSession: await hasActiveCashSession(db)
  });
}

async function updateSupplierRoute(db: SherDatabase, supplierId: string, input: { name?: string; phone?: string; address?: string; notes?: string }): Promise<Response> {
  const name = cleanText(input.name);
  if (!name) return error('Supplier name is required.');
  const current = await db.prepare(`SELECT supplier_id FROM suppliers WHERE supplier_id=? AND COALESCE(is_deleted,0)=0`).bind(supplierId).first();
  if (!current) return error('Supplier not found.', 404);
  const dup = await db.prepare(`SELECT supplier_id FROM suppliers WHERE LOWER(supplier_name)=LOWER(?) AND supplier_id<>? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(name, supplierId).first();
  if (dup) return error('A supplier with this name already exists.', 409);
  await db.prepare(`UPDATE suppliers SET supplier_name=?, phone=?, address=?, notes=?, updated_at=datetime('now') WHERE supplier_id=?`)
    .bind(name, cleanText(input.phone), cleanText(input.address), cleanText(input.notes), supplierId).run();
  return json({ ok: true, id: supplierId });
}

async function getSupplierDetailRoute(db: SherDatabase, supplierId: string): Promise<Response> {
  const supplier = await db.prepare(`SELECT * FROM suppliers WHERE supplier_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(supplierId).first<Record<string, unknown>>();
  if (!supplier) return error('Supplier not found.', 404);
  const ledger = await db.prepare(`
    SELECT ledger_id AS ledgerId, date, supplier_id AS supplierId, supplier_name AS supplierName,
           type, reference, debit, credit, balance, notes, payment_method AS paymentMethod,
           bank_account_id AS bankAccountId, created_at AS createdAt
    FROM supplier_ledger
    WHERE supplier_id=? AND COALESCE(is_deleted,0)=0
    ORDER BY date DESC, created_at DESC
  `).bind(supplierId).all();
  return json({ ok: true, supplier: supplierPublic(supplier), ledger: ledger.results ?? [] });
}

async function setSupplierStatusRoute(db: SherDatabase, supplierId: string, status: string): Promise<Response> {
  const next = status === 'Active' ? 'Active' : 'Inactive';
  const result = await db.prepare(`UPDATE suppliers SET status=?, updated_at=datetime('now') WHERE supplier_id=? AND COALESCE(is_deleted,0)=0`).bind(next, supplierId).run();
  if (!result.meta.changes) return error('Supplier not found.', 404);
  return json({ ok: true, id: supplierId, status: next });
}

async function deleteSupplierRoute(db: SherDatabase, supplierId: string, reasonRaw: string, user: AuthUser): Promise<Response> {
  const reason = cleanText(reasonRaw);
  if (!reason) return error('Enter a reason for deleting this supplier.');
  const supplier = await db.prepare(`SELECT * FROM suppliers WHERE supplier_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(supplierId).first<Record<string, unknown>>();
  if (!supplier) return error('Supplier not found.', 404);
  const due = Number(supplier.current_due || 0);
  if (Math.abs(due) > 0.009) return error(`This supplier has an outstanding balance of ${due}. Settle it before deleting, or use Deactivate instead.`);
  const purchases = await db.prepare(`SELECT COUNT(*) AS total FROM purchases WHERE supplier_id=? AND COALESCE(is_deleted,0)=0`).bind(supplierId).first<{ total: number }>();
  if (Number(purchases?.total || 0) > 0) return error(`This supplier has ${Number(purchases?.total || 0)} purchase record(s) and cannot be deleted. Use Deactivate instead.`);
  await db.batch([
    db.prepare(`UPDATE supplier_ledger SET is_deleted=1, delete_reason=?, deleted_by=?, deleted_at=datetime('now') WHERE supplier_id=? AND COALESCE(is_deleted,0)=0`).bind(reason, user.userId, supplierId),
    db.prepare(`UPDATE suppliers SET is_deleted=1, delete_reason=?, deleted_by=?, deleted_at=datetime('now'), updated_at=datetime('now') WHERE supplier_id=?`).bind(reason, user.userId, supplierId),
    db.prepare(`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, note) VALUES (?, 'DELETE_SUPPLIER', 'SUPPLIER', ?, ?)`).bind(user.userId, supplierId, reason)
  ]);
  return json({ ok: true });
}


async function recomputeSupplierLedgerBalances(db: SherDatabase, supplierId: string): Promise<number> {
  const rows = await db.prepare(`SELECT ledger_id AS ledgerId, debit, credit FROM supplier_ledger WHERE supplier_id=? AND COALESCE(is_deleted,0)=0 ORDER BY date ASC, created_at ASC, ledger_id ASC`).bind(supplierId).all();
  let balance = 0;
  const updates: SqlPreparedStatement[] = [];
  for (const row of (rows.results ?? []) as Array<Record<string, unknown>>) {
    balance = Math.round((balance + money(row.debit) - money(row.credit)) * 10000) / 10000;
    updates.push(db.prepare(`UPDATE supplier_ledger SET balance=? WHERE ledger_id=?`).bind(balance, String(row.ledgerId)));
  }
  updates.push(db.prepare(`UPDATE suppliers SET current_due=?, updated_at=datetime('now') WHERE supplier_id=?`).bind(balance, supplierId));
  await db.batch(updates);
  return balance;
}

async function writeSupplierPaymentMoney(db: SherDatabase, ledgerId: string, supplierName: string, amount: number, method: string, bankAccountId: string, date: string): Promise<void> {
  if (method === 'Cash') {
    await db.prepare(`INSERT INTO cash_book (entry_id, date, type, reference, description, debit, credit, payment_method, created_at) VALUES (?, ?, 'Supplier Payment', ?, ?, ?, 0, 'Cash', datetime('now'))`)
      .bind(crypto.randomUUID(), date, ledgerId, `Payment to ${supplierName}`, amount).run();
  } else if (methodNeedsBank(method)) {
    await db.prepare(`INSERT INTO bank_book (entry_id, bank_account_id, date, type, reference, description, debit, credit, created_at) VALUES (?, ?, ?, 'Supplier Payment', ?, ?, ?, 0, datetime('now'))`)
      .bind(crypto.randomUUID(), bankAccountId, date, ledgerId, `Payment to ${supplierName}`, amount).run();
    await db.prepare(`UPDATE bank_accounts SET current_balance=current_balance-? WHERE bank_account_id=?`).bind(amount, bankAccountId).run();
  }
}

async function reverseSupplierPaymentMoney(db: SherDatabase, ledgerId: string): Promise<void> {
  const bankRows = await db.prepare(`SELECT entry_id, bank_account_id, debit FROM bank_book WHERE reference=? AND COALESCE(is_deleted,0)=0`).bind(ledgerId).all();
  const batch: SqlPreparedStatement[] = [
    db.prepare(`UPDATE cash_book SET is_deleted=1 WHERE reference=? AND COALESCE(is_deleted,0)=0`).bind(ledgerId),
    db.prepare(`UPDATE bank_book SET is_deleted=1 WHERE reference=? AND COALESCE(is_deleted,0)=0`).bind(ledgerId)
  ];
  for (const row of (bankRows.results ?? []) as Array<Record<string, unknown>>) {
    batch.push(db.prepare(`UPDATE bank_accounts SET current_balance=current_balance+? WHERE bank_account_id=?`).bind(money(row.debit), String(row.bank_account_id)));
  }
  await db.batch(batch);
}

async function paySupplierRoute(db: SherDatabase, supplierId: string, input: { amount?: number; method?: string; bankAccountId?: string; notes?: string; date?: string; backdatedReason?: string }, user: AuthUser): Promise<Response> {
  if (!(await hasActiveCashSession(db))) return error('No active cash session. Start your day from POS before recording supplier payments.');
  const amount = money(input.amount);
  if (amount <= 0) return error('Enter a valid payment amount.');
  const supplier = await db.prepare(`SELECT supplier_name FROM suppliers WHERE supplier_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(supplierId).first<{ supplier_name: string }>();
  if (!supplier) return error('Supplier not found.', 404);
  const date = cleanText(input.date) || new Date().toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const backdatedReason = cleanText(input.backdatedReason);
  if (date < today && !backdatedReason) return error('A reason is required when dating a payment in the past.');
  const method = cleanText(input.method) || 'Cash';
  let bankAccountId = '';
  try { bankAccountId = await validateBankAccount(db, method, input.bankAccountId); } catch (err) { return error(err instanceof Error ? err.message : 'Invalid payment method.'); }
  const current = await db.prepare(`SELECT current_due FROM suppliers WHERE supplier_id=?`).bind(supplierId).first<{ current_due: number }>();
  const newDue = Math.round((Number(current?.current_due || 0) - amount) * 10000) / 10000;
  const ledgerId = crypto.randomUUID();
  await db.prepare(`INSERT INTO supplier_ledger (ledger_id, date, supplier_id, supplier_name, type, reference, debit, credit, balance, notes, payment_method, bank_account_id, is_backdated, backdated_days, backdated_reason, created_by, created_at)
    VALUES (?, ?, ?, ?, 'Payment', 'PAYMENT', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
    .bind(ledgerId, date, supplierId, supplier.supplier_name, amount, newDue, cleanText(input.notes), method, bankAccountId, date < today ? 1 : 0, date < today ? 1 : 0, backdatedReason, user.userId).run();
  await db.prepare(`UPDATE suppliers SET current_due=?, updated_at=datetime('now') WHERE supplier_id=?`).bind(newDue, supplierId).run();
  await writeSupplierPaymentMoney(db, ledgerId, supplier.supplier_name, amount, method, bankAccountId, date);
  return json({ ok: true, newDue });
}

async function getSupplierPaymentRoute(db: SherDatabase, ledgerId: string): Promise<Response> {
  const row = await db.prepare(`SELECT ledger_id AS ledgerId, supplier_id AS supplierId, supplier_name AS supplierName, date, credit AS amount, payment_method AS method, bank_account_id AS bankAccountId, notes, type FROM supplier_ledger WHERE ledger_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(ledgerId).first<Record<string, unknown>>();
  if (!row) return error('Payment not found.', 404);
  if (String(row.type) !== 'Payment') return error('Only payment rows can be edited here.');
  const { type: _type, ...payment } = row;
  return json({ ok: true, payment });
}

async function updateSupplierPaymentRoute(db: SherDatabase, ledgerId: string, input: { amount?: number; method?: string; bankAccountId?: string; notes?: string; date?: string }, user: AuthUser): Promise<Response> {
  if (!(await hasActiveCashSession(db))) return error('No active cash session. Start your day from POS before editing supplier payments.');
  const row = await db.prepare(`SELECT * FROM supplier_ledger WHERE ledger_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(ledgerId).first<Record<string, unknown>>();
  if (!row) return error('Payment not found.', 404);
  if (String(row.type) !== 'Payment') return error('Only payment rows can be edited.');
  const amount = money(input.amount);
  if (amount <= 0) return error('Enter a valid payment amount.');
  const method = cleanText(input.method) || String(row.payment_method || 'Cash');
  let bankAccountId = '';
  try { bankAccountId = await validateBankAccount(db, method, input.bankAccountId); } catch (err) { return error(err instanceof Error ? err.message : 'Invalid payment method.'); }
  const date = cleanText(input.date) || String(row.date || new Date().toISOString().slice(0,10));
  await reverseSupplierPaymentMoney(db, ledgerId);
  await db.prepare(`UPDATE supplier_ledger SET date=?, credit=?, payment_method=?, bank_account_id=?, notes=? WHERE ledger_id=?`)
    .bind(date, amount, method, bankAccountId, cleanText(input.notes), ledgerId).run();
  const newDue = await recomputeSupplierLedgerBalances(db, String(row.supplier_id));
  await writeSupplierPaymentMoney(db, ledgerId, String(row.supplier_name), amount, method, bankAccountId, date);
  await db.prepare(`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, note) VALUES (?, 'UPDATE_SUPPLIER_PAYMENT', 'SUPPLIER_LEDGER', ?, 'Payment edited')`).bind(user.userId, ledgerId).run();
  return json({ ok: true, newDue });
}

async function deleteSupplierPaymentRoute(db: SherDatabase, ledgerId: string, reasonRaw: string, user: AuthUser): Promise<Response> {
  const reason = cleanText(reasonRaw);
  if (!reason) return error('Enter a reason for deleting this payment.');
  if (!(await hasActiveCashSession(db))) return error('No active cash session. Start your day from POS before deleting supplier payments.');
  const row = await db.prepare(`SELECT * FROM supplier_ledger WHERE ledger_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(ledgerId).first<Record<string, unknown>>();
  if (!row) return error('Payment not found.', 404);
  if (String(row.type) !== 'Payment') return error('Only payment rows can be deleted here.');
  await reverseSupplierPaymentMoney(db, ledgerId);
  await db.prepare(`UPDATE supplier_ledger SET is_deleted=1, delete_reason=?, deleted_by=?, deleted_at=datetime('now') WHERE ledger_id=?`).bind(reason, user.userId, ledgerId).run();
  await recomputeSupplierLedgerBalances(db, String(row.supplier_id));
  await db.prepare(`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, note) VALUES (?, 'DELETE_SUPPLIER_PAYMENT', 'SUPPLIER_LEDGER', ?, ?)`).bind(user.userId, ledgerId, reason).run();
  return json({ ok: true });
}


export async function handleSuppliersRoute(
  db: SherDatabase,
  request: Request,
  path: string,
  auth: AuthUser
): Promise<Response | null> {
  if (path === '/api/suppliers' && request.method === 'GET') return getSuppliersPageRoute(db);
  if (path === '/api/suppliers' && request.method === 'POST') return createSupplierRoute(db, await readBody<{ name?: string; phone?: string; address?: string; openingBalance?: number; notes?: string }>(request), auth);

  const supplierStatusMatch = path.match(/^\/api\/suppliers\/([^/]+)\/status$/);
  if (supplierStatusMatch && request.method === 'PUT') {
    const body = await readBody<{ status?: string }>(request);
    return setSupplierStatusRoute(db, decodeURIComponent(supplierStatusMatch[1]), cleanText(body.status));
  }

  const supplierPaymentCreateMatch = path.match(/^\/api\/suppliers\/([^/]+)\/payments$/);
  if (supplierPaymentCreateMatch && request.method === 'POST') return paySupplierRoute(db, decodeURIComponent(supplierPaymentCreateMatch[1]), await readBody<any>(request), auth);

  const supplierMatch = path.match(/^\/api\/suppliers\/([^/]+)$/);
  if (supplierMatch && request.method === 'GET') return getSupplierDetailRoute(db, decodeURIComponent(supplierMatch[1]));
  if (supplierMatch && request.method === 'PUT') return updateSupplierRoute(db, decodeURIComponent(supplierMatch[1]), await readBody<any>(request));
  if (supplierMatch && request.method === 'DELETE') {
    const body = await readBody<{ reason?: string }>(request);
    return deleteSupplierRoute(db, decodeURIComponent(supplierMatch[1]), cleanText(body.reason), auth);
  }

  const supplierPaymentMatch = path.match(/^\/api\/supplier-payments\/([^/]+)$/);
  if (supplierPaymentMatch && request.method === 'GET') return getSupplierPaymentRoute(db, decodeURIComponent(supplierPaymentMatch[1]));
  if (supplierPaymentMatch && request.method === 'PUT') return updateSupplierPaymentRoute(db, decodeURIComponent(supplierPaymentMatch[1]), await readBody<any>(request), auth);
  if (supplierPaymentMatch && request.method === 'DELETE') {
    const body = await readBody<{ reason?: string }>(request);
    return deleteSupplierPaymentRoute(db, decodeURIComponent(supplierPaymentMatch[1]), cleanText(body.reason), auth);
  }

  return null;
}
