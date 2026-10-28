import type { SherDatabase } from '../../db/types.js';

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

async function nextSupplierId(db: SherDatabase): Promise<string> {
  const row = await db.prepare(`
    SELECT supplier_id
    FROM suppliers
    WHERE supplier_id LIKE 'SUP-%'
    ORDER BY CAST(SUBSTR(supplier_id, 5) AS INTEGER) DESC
    LIMIT 1
  `).first<{ supplier_id: string }>();
  const last = row?.supplier_id ? Number(row.supplier_id.replace('SUP-', '')) : 0;
  return `SUP-${String(last + 1).padStart(6, '0')}`;
}

export async function ensureSupplier(db: SherDatabase, supplierId?: string, supplierName?: string): Promise<{ supplierId: string; supplierName: string }> {
  const suppliedId = cleanText(supplierId);
  if (suppliedId) {
    const row = await db.prepare(`
      SELECT supplier_id AS supplierId, supplier_name AS supplierName
      FROM suppliers
      WHERE supplier_id = ? AND status = 'Active' AND is_deleted = 0
      LIMIT 1
    `).bind(suppliedId).first<{ supplierId: string; supplierName: string }>();
    if (!row) throw new Error('Supplier not found.');
    return row;
  }
  const name = cleanText(supplierName);
  if (!name) throw new Error('Choose a supplier.');
  const existing = await db.prepare(`
    SELECT supplier_id AS supplierId, supplier_name AS supplierName
    FROM suppliers
    WHERE LOWER(supplier_name) = LOWER(?) AND is_deleted = 0
    LIMIT 1
  `).bind(name).first<{ supplierId: string; supplierName: string }>();
  if (existing) return existing;
  const newId = await nextSupplierId(db);
  await db.prepare(`
    INSERT INTO suppliers (supplier_id, supplier_name, current_due, status, is_deleted, created_at, updated_at)
    VALUES (?, ?, 0, 'Active', 0, datetime('now'), datetime('now'))
  `).bind(newId, name).run();
  return { supplierId: newId, supplierName: name };
}

export async function createSupplierId(db: SherDatabase): Promise<string> {
  return nextSupplierId(db);
}

export async function hasActiveCashSession(db: SherDatabase): Promise<boolean> {
  const row = await db.prepare(`SELECT session_id FROM cash_sessions WHERE status='Open' ORDER BY opened_at DESC LIMIT 1`).first();
  return Boolean(row);
}

export function methodNeedsBank(method: string): boolean {
  return method === 'Bank' || method === 'Mobile Banking';
}

export async function validateBankAccount(db: SherDatabase, method: string, bankAccountIdRaw?: string): Promise<string> {
  if (!methodNeedsBank(method)) return '';
  const bankAccountId = cleanText(bankAccountIdRaw);
  if (!bankAccountId) throw new Error(method === 'Mobile Banking' ? 'Mobile Banking account is required.' : 'Bank account is required.');
  const bank = await db.prepare(`SELECT bank_account_id FROM bank_accounts WHERE bank_account_id=? AND status='Active' LIMIT 1`).bind(bankAccountId).first();
  if (!bank) throw new Error('Selected account is not active.');
  return bankAccountId;
}
