import type { SherDatabase } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
import { financeBalances, financeType } from '../finance/service.js';
import type { DashboardProfitResult, DayBookDeleteAction, DayBookRowOut, ReportRange } from './types.js';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };
function json(data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status, headers: jsonHeaders }); }
function cleanText(value: unknown): string { return String(value ?? '').trim(); }
function qty(value: unknown): number { const n = Number(value ?? 0); if (!Number.isFinite(n) || n < 0) return 0; return Math.round(n * 10000) / 10000; }
function todayDate(): string { return new Date().toISOString().slice(0, 10); }
function dayDiff(from: string, to: string): number { const a = new Date(`${from}T00:00:00Z`).getTime(); const b = new Date(`${to}T00:00:00Z`).getTime(); return Math.max(0, Math.floor((b-a)/86400000)); }
async function getOpenCashSession(db: SherDatabase) { return db.prepare(`SELECT * FROM cash_sessions WHERE status='Open' ORDER BY opened_at DESC LIMIT 1`).first<any>(); }

const DAYBOOK_MODULES = [
  'Sales', 'Sales Return', 'Purchase', 'Purchase Return',
  'Customer Payment', 'Supplier Payment', 'Expense',
  'Bank', 'Bank Transfer', 'Finance', 'Stock Adjustment', 'Supplier Warranty'
];

function dbNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function dbBool(value: unknown): boolean { return Number(value ?? 0) !== 0; }
function dayBookTs(value: unknown, fallbackDate = ''): string {
  let s = cleanText(value);
  if (!s) s = fallbackDate ? `${fallbackDate} 00:00:00` : '';
  if (!s) return '';
  return s.includes('T') ? s : s.replace(' ', 'T');
}
function dayBookTime(ts: string, explicit?: unknown): string {
  const own = cleanText(explicit);
  if (own) return own.slice(0, 8);
  const i = ts.indexOf('T');
  return i >= 0 ? ts.slice(i + 1, i + 9) : '';
}
function dayBookBackdatedDays(date: string, createdAt: unknown, stored?: unknown): number {
  const n = Number(stored ?? 0);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  const createdDate = cleanText(createdAt).slice(0, 10);
  return date && createdDate && date < createdDate ? dayDiff(date, createdDate) : 0;
}
function dayBookIsBankMethod(method: string): boolean { return method === 'Bank' || method === 'Mobile Banking'; }
function dayBookRow(input: Partial<DayBookRowOut> & Pick<DayBookRowOut, 'module' | 'sourceModule' | 'sourceId'>): DayBookRowOut {
  const cashIn = dbNumber(input.cashIn), cashOut = dbNumber(input.cashOut), bankIn = dbNumber(input.bankIn), bankOut = dbNumber(input.bankOut);
  return {
    ts: cleanText(input.ts), date: cleanText(input.date), time: cleanText(input.time), referenceNo: cleanText(input.referenceNo),
    module: input.module, transactionType: cleanText(input.transactionType), party: cleanText(input.party),
    description: cleanText(input.description), paymentMethod: cleanText(input.paymentMethod), cashIn, cashOut, bankIn, bankOut,
    amount: cashIn + bankIn - cashOut - bankOut, runningCashBalance: input.runningCashBalance ?? null,
    createdBy: cleanText(input.createdBy), status: cleanText(input.status) || 'Active', isDeleted: !!input.isDeleted,
    deletedBy: cleanText(input.deletedBy), deleteReason: cleanText(input.deleteReason), isBackdated: !!input.isBackdated,
    backdatedDays: dbNumber(input.backdatedDays), backdatedReason: cleanText(input.backdatedReason), sourceModule: input.sourceModule,
    sourceId: input.sourceId, openId: cleanText(input.openId) || input.sourceId, deleteAction: input.deleteAction || '',
    deleteId: cleanText(input.deleteId) || input.sourceId, canEdit: !!input.canEdit
  };
}

export async function getDayBookBootstrapRoute(db: SherDatabase, user: AuthUser): Promise<Response> {
  const settings = await db.prepare(`SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('Currency Symbol','Day Book Editable Days')`).all<any>();
  const map = new Map<string, string>();
  for (const r of settings.results || []) map.set(String(r.setting_key), String(r.setting_value ?? ''));
  return json({
    ok: true,
    currencySymbol: map.get('Currency Symbol') || '৳',
    editableDays: Math.max(0, Number(map.get('Day Book Editable Days') || 0)),
    modules: DAYBOOK_MODULES,
    isAdmin: user.role === 'admin'
  });
}

export async function getDayBookRoute(db: SherDatabase, url: URL, user: AuthUser): Promise<Response> {
  const today = todayDate();
  let dateFrom = cleanText(url.searchParams.get('dateFrom')) || today;
  let dateTo = cleanText(url.searchParams.get('dateTo')) || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) dateFrom = today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) dateTo = today;
  if (dateFrom > dateTo) { const t = dateFrom; dateFrom = dateTo; dateTo = t; }
  const moduleFilter = cleanText(url.searchParams.get('module'));
  const paymentFilter = cleanText(url.searchParams.get('paymentMethod'));
  const query = cleanText(url.searchParams.get('query')).toLowerCase();
  const backdatedOnly = url.searchParams.get('backdatedOnly') === '1';
  const isAdmin = user.role === 'admin';
  const includeDeleted = isAdmin && url.searchParams.get('includeDeleted') === '1';
  const editSetting = await db.prepare(`SELECT setting_value FROM app_settings WHERE setting_key='Day Book Editable Days' LIMIT 1`).first<{ setting_value: string }>();
  const editableDays = Math.max(0, Number(editSetting?.setting_value || 0));
  const cutoffDate = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - editableDays); return d.toISOString().slice(0, 10); })();
  const rows: DayBookRowOut[] = [];
  const supplierWarrantyOwnedRefs = new Set<string>();

  const salesR = await db.prepare(`
    SELECT invoice_id,sale_date,sale_time,customer_id,customer_name,customer_phone,paid_amount,payment_type,payment_status,
           payment_method,bank_account_id,bank_account_name,is_backdated,backdated_reason,status,created_by,created_at,
           is_deleted,delete_reason,deleted_by,deleted_at
    FROM sales WHERE sale_date BETWEEN ? AND ? ORDER BY created_at ASC
  `).bind(dateFrom, dateTo).all<any>();
  const sales = salesR.results || [];
  for (const s of sales) {
    const deleted = dbBool(s.is_deleted);
    if (deleted && !includeDeleted) continue;
    const method = cleanText(s.payment_method) || 'Cash', paid = dbNumber(s.paid_amount), date = cleanText(s.sale_date).slice(0, 10);
    const ts = dayBookTs(s.created_at, date);
    rows.push(dayBookRow({
      ts, date, time: dayBookTime(ts, s.sale_time), referenceNo: cleanText(s.invoice_id), module: 'Sales',
      transactionType: `${cleanText(s.payment_type)} Sale`.trim(), party: cleanText(s.customer_name),
      description: `POS sale${cleanText(s.customer_phone) ? ` — ${cleanText(s.customer_phone)}` : ''}`, paymentMethod: method,
      cashIn: !deleted && method === 'Cash' ? paid : 0, bankIn: !deleted && dayBookIsBankMethod(method) ? paid : 0,
      createdBy: s.created_by, status: deleted ? 'Deleted' : cleanText(s.payment_status) || cleanText(s.status) || 'Active',
      isDeleted: deleted, deletedBy: s.deleted_by, deleteReason: s.delete_reason,
      isBackdated: dbBool(s.is_backdated), backdatedDays: dayBookBackdatedDays(date, s.created_at), backdatedReason: s.backdated_reason,
      sourceModule: 'Sales', sourceId: cleanText(s.invoice_id), openId: cleanText(s.invoice_id),
      deleteAction: deleted ? '' : 'sale', deleteId: cleanText(s.invoice_id), canEdit: !deleted && date >= cutoffDate
    }));
  }

  const salesReturnsR = await db.prepare(`
    SELECT return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,refund_method,total_return_amount,reason,notes,processed_by,created_at
    FROM sales_returns WHERE return_date BETWEEN ? AND ? ORDER BY created_at ASC
  `).bind(dateFrom, dateTo).all<any>();
  for (const r of salesReturnsR.results || []) {
    const methodRaw = cleanText(r.refund_method) || 'Cash';
    const method = methodRaw === 'Cash' ? 'Cash' : methodRaw === 'Bank' ? 'Bank' : 'Store Credit';
    const amount = dbNumber(r.total_return_amount), date = cleanText(r.return_date).slice(0, 10), ts = dayBookTs(r.created_at, date);
    rows.push(dayBookRow({
      ts, date, time: dayBookTime(ts), referenceNo: cleanText(r.return_id), module: 'Sales Return', transactionType: `${methodRaw} Refund`,
      party: r.customer_name, description: `Return against ${cleanText(r.invoice_id)}${cleanText(r.reason) ? ` — ${cleanText(r.reason)}` : ''}`,
      paymentMethod: method, cashOut: method === 'Cash' ? amount : 0, bankOut: method === 'Bank' ? amount : 0,
      createdBy: r.processed_by, status: 'Active', sourceModule: 'Sales Return', sourceId: cleanText(r.return_id), openId: cleanText(r.invoice_id)
    }));
  }

  const purchasesR = await db.prepare(`
    SELECT purchase_id,purchase_date,supplier_id,supplier_name,note,paid_amount,payment_status,payment_method,bank_account_id,bank_account_name,
           is_backdated,backdated_days,backdated_reason,status,created_by,created_at,is_deleted,delete_reason,deleted_by,deleted_at
    FROM purchases WHERE purchase_date BETWEEN ? AND ? ORDER BY created_at ASC
  `).bind(dateFrom, dateTo).all<any>();
  const purchases = purchasesR.results || [];
  for (const p of purchases) {
    const deleted = dbBool(p.is_deleted);
    if (deleted && !includeDeleted) continue;
    const method = cleanText(p.payment_method) || 'Cash', paid = dbNumber(p.paid_amount), date = cleanText(p.purchase_date).slice(0, 10), ts = dayBookTs(p.created_at, date);
    rows.push(dayBookRow({
      ts, date, time: dayBookTime(ts), referenceNo: cleanText(p.purchase_id), module: 'Purchase', transactionType: `${cleanText(p.payment_status)} Purchase`.trim(),
      party: p.supplier_name, description: cleanText(p.note) || 'Stock purchase', paymentMethod: method,
      cashOut: !deleted && method === 'Cash' ? paid : 0, bankOut: !deleted && dayBookIsBankMethod(method) ? paid : 0,
      createdBy: p.created_by, status: deleted ? 'Deleted' : cleanText(p.payment_status) || cleanText(p.status) || 'Active',
      isDeleted: deleted, deletedBy: p.deleted_by, deleteReason: p.delete_reason, isBackdated: dbBool(p.is_backdated),
      backdatedDays: dayBookBackdatedDays(date, p.created_at, p.backdated_days), backdatedReason: p.backdated_reason,
      sourceModule: 'Purchase', sourceId: cleanText(p.purchase_id), openId: cleanText(p.purchase_id), deleteAction: deleted ? '' : 'purchase',
      deleteId: cleanText(p.purchase_id), canEdit: false
    }));
  }

  const purchaseReturnsR = await db.prepare(`
    SELECT return_id,return_date,purchase_id,supplier_id,supplier_name,total_return_amount,refund_method,reason,notes,processed_by,is_backdated,backdated_reason,is_deleted,created_at
    FROM purchase_returns WHERE return_date BETWEEN ? AND ? ORDER BY created_at ASC
  `).bind(dateFrom, dateTo).all<any>();
  for (const r of purchaseReturnsR.results || []) {
    const deleted = dbBool(r.is_deleted);
    if (deleted && !includeDeleted) continue;
    const method = cleanText(r.refund_method) || 'Supplier Credit', amount = dbNumber(r.total_return_amount), date = cleanText(r.return_date).slice(0, 10), ts = dayBookTs(r.created_at, date);
    rows.push(dayBookRow({
      ts, date, time: dayBookTime(ts), referenceNo: cleanText(r.return_id), module: 'Purchase Return', transactionType: 'Purchase Return',
      party: r.supplier_name, description: `Return against ${cleanText(r.purchase_id)}${cleanText(r.reason) ? ` — ${cleanText(r.reason)}` : ''}`,
      paymentMethod: method, cashIn: !deleted && method === 'Cash' ? amount : 0, bankIn: !deleted && method === 'Bank' ? amount : 0,
      createdBy: r.processed_by, status: deleted ? 'Deleted' : 'Active', isDeleted: deleted,
      isBackdated: dbBool(r.is_backdated), backdatedDays: dayBookBackdatedDays(date, r.created_at), backdatedReason: r.backdated_reason,
      sourceModule: 'Purchase Return', sourceId: cleanText(r.return_id), openId: cleanText(r.purchase_id)
    }));
  }

  const customerPaymentsR = await db.prepare(`
    SELECT ledger_id,date,customer_id,customer_name,reference,credit,notes,payment_method,bank_account_id,is_backdated,backdated_days,backdated_reason,
           created_by,created_at,is_deleted,delete_reason,deleted_by,deleted_at
    FROM customer_ledger WHERE type='Payment' AND date BETWEEN ? AND ? ORDER BY created_at ASC
  `).bind(dateFrom, dateTo).all<any>();
  const customerPayments = customerPaymentsR.results || [];
  for (const l of customerPayments) {
    const deleted = dbBool(l.is_deleted); if (deleted && !includeDeleted) continue;
    const method = cleanText(l.payment_method) || 'Cash', amount = dbNumber(l.credit), date = cleanText(l.date).slice(0, 10), ts = dayBookTs(l.created_at, date);
    rows.push(dayBookRow({
      ts, date, time: dayBookTime(ts), referenceNo: cleanText(l.ledger_id), module: 'Customer Payment', transactionType: 'Due Collection',
      party: l.customer_name, description: cleanText(l.notes) || 'Payment received', paymentMethod: method,
      cashIn: !deleted && method === 'Cash' ? amount : 0, bankIn: !deleted && dayBookIsBankMethod(method) ? amount : 0,
      createdBy: l.created_by, status: deleted ? 'Deleted' : 'Active', isDeleted: deleted, deletedBy: l.deleted_by, deleteReason: l.delete_reason,
      isBackdated: dbBool(l.is_backdated), backdatedDays: dayBookBackdatedDays(date, l.created_at, l.backdated_days), backdatedReason: l.backdated_reason,
      sourceModule: 'Customer Payment', sourceId: cleanText(l.ledger_id), openId: cleanText(l.customer_id),
      deleteAction: deleted ? '' : 'customer-payment', deleteId: cleanText(l.ledger_id)
    }));
  }

  const supplierPaymentsR = await db.prepare(`
    SELECT ledger_id,date,supplier_id,supplier_name,reference,credit,notes,payment_method,bank_account_id,is_backdated,backdated_days,backdated_reason,
           created_by,created_at,is_deleted,delete_reason,deleted_by,deleted_at
    FROM supplier_ledger WHERE type='Payment' AND date BETWEEN ? AND ? ORDER BY created_at ASC
  `).bind(dateFrom, dateTo).all<any>();
  const supplierPayments = supplierPaymentsR.results || [];
  for (const l of supplierPayments) {
    const deleted = dbBool(l.is_deleted); if (deleted && !includeDeleted) continue;
    const method = cleanText(l.payment_method) || 'Cash', amount = dbNumber(l.credit), date = cleanText(l.date).slice(0, 10), ts = dayBookTs(l.created_at, date);
    rows.push(dayBookRow({
      ts, date, time: dayBookTime(ts), referenceNo: cleanText(l.ledger_id), module: 'Supplier Payment', transactionType: 'Due Payment',
      party: l.supplier_name, description: cleanText(l.notes) || 'Payment made', paymentMethod: method,
      cashOut: !deleted && method === 'Cash' ? amount : 0, bankOut: !deleted && dayBookIsBankMethod(method) ? amount : 0,
      createdBy: l.created_by, status: deleted ? 'Deleted' : 'Active', isDeleted: deleted, deletedBy: l.deleted_by, deleteReason: l.delete_reason,
      isBackdated: dbBool(l.is_backdated), backdatedDays: dayBookBackdatedDays(date, l.created_at, l.backdated_days), backdatedReason: l.backdated_reason,
      sourceModule: 'Supplier Payment', sourceId: cleanText(l.ledger_id), openId: cleanText(l.supplier_id),
      deleteAction: deleted ? '' : 'supplier-payment', deleteId: cleanText(l.ledger_id)
    }));
  }

  const supplierWarrantyR = await db.prepare(`
    SELECT r.rma_id,r.rma_no,r.resolved_date,r.resolution_type,r.supplier_name,r.product_name,r.serial_number,r.resolution_note,r.resolved_by,r.updated_at,
           COALESCE(SUM(CASE WHEN f.financial_type='Supplier Credit' THEN f.amount ELSE 0 END),0) AS supplier_credit,
           COALESCE(SUM(CASE WHEN f.financial_type='Additional Payable' THEN f.amount ELSE 0 END),0) AS additional_payable,
           COALESCE(SUM(CASE WHEN f.financial_type='Cash Refund' THEN f.amount ELSE 0 END),0) AS refund_amount,
           COALESCE(MAX(CASE WHEN f.financial_type='Cash Refund' THEN f.payment_method ELSE '' END),'') AS refund_method
    FROM supplier_warranty_rmas r
    LEFT JOIN supplier_warranty_rma_financials f ON f.rma_id=r.rma_id
    WHERE r.resolved_date BETWEEN ? AND ? AND r.status IN ('Resolved','Rejected')
    GROUP BY r.rma_id
    ORDER BY r.updated_at ASC
  `).bind(dateFrom,dateTo).all<any>();
  for (const r of supplierWarrantyR.results || []) {
    const date=cleanText(r.resolved_date).slice(0,10), ts=dayBookTs(r.updated_at,date);
    const refund=dbNumber(r.refund_amount), method=cleanText(r.refund_method);
    supplierWarrantyOwnedRefs.add(cleanText(r.rma_no));
    const parts:string[]=[];
    if(dbNumber(r.supplier_credit)>0)parts.push(`Supplier credit ${dbNumber(r.supplier_credit)}`);
    if(dbNumber(r.additional_payable)>0)parts.push(`Additional payable ${dbNumber(r.additional_payable)}`);
    if(refund>0)parts.push(`Refund ${refund}`);
    rows.push(dayBookRow({
      ts,date,time:dayBookTime(ts),referenceNo:cleanText(r.rma_no),module:'Supplier Warranty',transactionType:cleanText(r.resolution_type)||'Warranty RMA',
      party:cleanText(r.supplier_name),description:`${cleanText(r.product_name)}${cleanText(r.serial_number)?` — ${cleanText(r.serial_number)}`:''}${parts.length?` — ${parts.join(' · ')}`:''}${cleanText(r.resolution_note)?` — ${cleanText(r.resolution_note)}`:''}`,
      paymentMethod:refund>0?method:'',cashIn:refund>0&&method==='Cash'?refund:0,bankIn:refund>0&&dayBookIsBankMethod(method)?refund:0,
      createdBy:r.resolved_by,status:cleanText(r.resolution_type)==='Warranty Rejected'?'Rejected':'Resolved',sourceModule:'Supplier Warranty',sourceId:cleanText(r.rma_id),openId:cleanText(r.rma_id)
    }));
  }

  const expensesR = await db.prepare(`
    SELECT expense_id,expense_date,category_name,ledger_id,ledger_name,amount,payment_method,description,reference_no,notes,status,created_by,created_at,
           bank_account_id,bank_account_name,is_backdated,backdated_days,backdated_reason,is_deleted,deleted_by,deleted_at,delete_reason
    FROM expenses WHERE expense_date BETWEEN ? AND ? ORDER BY created_at ASC
  `).bind(dateFrom, dateTo).all<any>();
  const expenses = expensesR.results || [];
  for (const e of expenses) {
    const deleted = dbBool(e.is_deleted); if (deleted && !includeDeleted) continue;
    const cancelled = cleanText(e.status) === 'Cancelled'; const live = !deleted && !cancelled;
    const method = cleanText(e.payment_method) || 'Cash', amount = dbNumber(e.amount), date = cleanText(e.expense_date).slice(0, 10), ts = dayBookTs(e.created_at, date);
    rows.push(dayBookRow({
      ts, date, time: dayBookTime(ts), referenceNo: cleanText(e.expense_id), module: 'Expense', transactionType: cleanText(e.category_name) || 'Expense',
      party: e.ledger_name, description: cleanText(e.description) || cleanText(e.notes), paymentMethod: method,
      cashOut: live && method === 'Cash' ? amount : 0, bankOut: live && dayBookIsBankMethod(method) ? amount : 0,
      createdBy: e.created_by, status: deleted ? 'Deleted' : cancelled ? 'Cancelled' : 'Active', isDeleted: deleted,
      deletedBy: e.deleted_by, deleteReason: e.delete_reason, isBackdated: dbBool(e.is_backdated),
      backdatedDays: dayBookBackdatedDays(date, e.created_at, e.backdated_days), backdatedReason: e.backdated_reason,
      sourceModule: 'Expense', sourceId: cleanText(e.expense_id), openId: cleanText(e.expense_id), deleteAction: live ? 'expense' : '',
      deleteId: cleanText(e.expense_id), canEdit: live && date >= cutoffDate
    }));
  }

  // References already represented by a document row. Bank Book entries for these are payment-side mirrors and must not appear twice.
  const owned = new Set<string>();
  for (const ref of supplierWarrantyOwnedRefs) owned.add(ref);
  for (const s of sales) owned.add(cleanText(s.invoice_id));
  for (const p of purchases) owned.add(cleanText(p.purchase_id));
  for (const e of expenses) owned.add(cleanText(e.expense_id));
  for (const l of customerPayments) owned.add(cleanText(l.ledger_id));
  for (const l of supplierPayments) owned.add(cleanText(l.ledger_id));
  for (const r of salesReturnsR.results || []) owned.add(cleanText(r.return_id));
  for (const r of purchaseReturnsR.results || []) owned.add(cleanText(r.return_id));
  const financeOwnedR = await db.prepare(`SELECT finance_id FROM finance_transactions WHERE date BETWEEN ? AND ? AND COALESCE(is_deleted,0)=0`).bind(dateFrom,dateTo).all<any>();
  for (const f of financeOwnedR.results || []) owned.add(cleanText(f.finance_id));

  const transfersR = await db.prepare(`
    SELECT transfer_id,transfer_date,from_account_id,from_account_name,to_account_id,to_account_name,amount,notes,created_by,created_at
    FROM bank_transfers WHERE transfer_date BETWEEN ? AND ? ORDER BY created_at ASC
  `).bind(dateFrom, dateTo).all<any>();
  for (const t of transfersR.results || []) owned.add(cleanText(t.transfer_id));

  const bankR = await db.prepare(`
    SELECT entry_id,bank_account_id,bank_account_name,date,type,reference,description,debit,credit,notes,status,reversal_of,created_by,created_at,
           is_backdated,backdated_days,backdated_reason,is_deleted
    FROM bank_book WHERE date BETWEEN ? AND ? ORDER BY created_at ASC
  `).bind(dateFrom, dateTo).all<any>();
  for (const b of bankR.results || []) {
    const ref = cleanText(b.reference); if (ref && owned.has(ref)) continue;
    const deleted = dbBool(b.is_deleted) || cleanText(b.status) === 'Reversed';
    if (deleted && !includeDeleted) continue;
    const debit = dbNumber(b.debit), credit = dbNumber(b.credit), date = cleanText(b.date).slice(0, 10), ts = dayBookTs(b.created_at, date);
    const canReverse = !deleted && !cleanText(b.reversal_of);
    rows.push(dayBookRow({
      ts, date, time: dayBookTime(ts), referenceNo: cleanText(b.entry_id), module: 'Bank', transactionType: cleanText(b.type) || 'Bank Entry',
      party: b.bank_account_name, description: b.description, paymentMethod: 'Bank', bankIn: deleted ? 0 : credit, bankOut: deleted ? 0 : debit,
      createdBy: b.created_by, status: deleted ? 'Reversed' : 'Active', isDeleted: deleted, deleteReason: b.notes,
      isBackdated: dbBool(b.is_backdated), backdatedDays: dayBookBackdatedDays(date, b.created_at, b.backdated_days), backdatedReason: b.backdated_reason,
      sourceModule: 'Bank', sourceId: cleanText(b.entry_id), openId: cleanText(b.bank_account_id), deleteAction: canReverse ? 'bank-reverse' : '', deleteId: cleanText(b.entry_id)
    }));
  }

  for (const t of transfersR.results || []) {
    const date = cleanText(t.transfer_date).slice(0, 10), ts = dayBookTs(t.created_at, date);
    rows.push(dayBookRow({
      ts, date, time: dayBookTime(ts), referenceNo: cleanText(t.transfer_id), module: 'Bank Transfer', transactionType: 'Bank Transfer',
      party: `${cleanText(t.from_account_name)} → ${cleanText(t.to_account_name)}`, description: cleanText(t.notes) || 'Transfer between accounts',
      paymentMethod: 'Bank', createdBy: t.created_by, status: 'Active', sourceModule: 'Bank Transfer', sourceId: cleanText(t.transfer_id), openId: cleanText(t.transfer_id)
    }));
  }

  const financeR = await db.prepare(`
    SELECT finance_id,date,transaction_type,person_name,payment_method,bank_account_id,bank_account_name,amount,reference_no,notes,created_by,created_at,is_backdated,backdated_days,backdated_reason,is_deleted,delete_reason,deleted_by,deleted_at
    FROM finance_transactions WHERE date BETWEEN ? AND ? ORDER BY created_at ASC
  `).bind(dateFrom,dateTo).all<any>();
  for(const f of financeR.results||[]){
    const deleted=dbBool(f.is_deleted); if(deleted&&!includeDeleted)continue; const t=financeType(cleanText(f.transaction_type)); const amount=dbNumber(f.amount),method=cleanText(f.payment_method)||'Cash',date=cleanText(f.date).slice(0,10),ts=dayBookTs(f.created_at,date),incoming=t?.direction==='in';
    rows.push(dayBookRow({ts,date,time:dayBookTime(ts),referenceNo:cleanText(f.finance_id),module:'Finance',transactionType:t?.label||cleanText(f.transaction_type),party:cleanText(f.person_name),description:`${t?.label||cleanText(f.transaction_type)}${cleanText(f.reference_no)?` — Ref ${cleanText(f.reference_no)}`:''}${cleanText(f.notes)?` — ${cleanText(f.notes)}`:''}`,paymentMethod:method,cashIn:!deleted&&method==='Cash'&&incoming?amount:0,cashOut:!deleted&&method==='Cash'&&!incoming?amount:0,bankIn:!deleted&&dayBookIsBankMethod(method)&&incoming?amount:0,bankOut:!deleted&&dayBookIsBankMethod(method)&&!incoming?amount:0,createdBy:f.created_by,status:deleted?'Deleted':'Active',isDeleted:deleted,deletedBy:f.deleted_by,deleteReason:f.delete_reason,isBackdated:dbBool(f.is_backdated),backdatedDays:dayBookBackdatedDays(date,f.created_at,f.backdated_days),backdatedReason:f.backdated_reason,sourceModule:'Finance',sourceId:cleanText(f.finance_id),openId:cleanText(f.finance_id),deleteAction:'',canEdit:!deleted&&date>=cutoffDate}));
  }

  const stockR = await db.prepare(`
    SELECT sm.movement_id,sm.product_id,sm.movement_type,sm.quantity_in,sm.quantity_out,sm.note,sm.created_at,p.product_name
    FROM stock_movements sm LEFT JOIN products p ON p.product_id=sm.product_id
    WHERE substr(sm.created_at,1,10) BETWEEN ? AND ? AND lower(sm.movement_type) LIKE '%adjust%'
    ORDER BY sm.created_at ASC
  `).bind(dateFrom, dateTo).all<any>();
  for (const m of stockR.results || []) {
    const date = cleanText(m.created_at).slice(0, 10), ts = dayBookTs(m.created_at, date), qIn = dbNumber(m.quantity_in), qOut = dbNumber(m.quantity_out);
    rows.push(dayBookRow({
      ts, date, time: dayBookTime(ts), referenceNo: cleanText(m.movement_id), module: 'Stock Adjustment',
      transactionType: cleanText(m.movement_type) || 'Stock Adjustment', party: m.product_name,
      description: `${cleanText(m.note) || 'Stock adjusted'} (${qIn ? `+${qIn}` : `-${qOut}`})`, paymentMethod: '', status: 'Active',
      sourceModule: 'Stock Adjustment', sourceId: cleanText(m.product_id), openId: cleanText(m.product_id)
    }));
  }

  // Running drawer balance follows the actual Cash Book sequence. A Session Open row resets the drawer to that day's opening cash.
  const cashR = await db.prepare(`
    SELECT entry_id,type,debit,credit,created_at FROM cash_book
    WHERE COALESCE(is_deleted,0)=0 ORDER BY created_at ASC, rowid ASC
  `).all<any>();
  const cashEvents = (cashR.results || []).map((c: any) => ({
    ts: dayBookTs(c.created_at), type: cleanText(c.type), debit: dbNumber(c.debit), credit: dbNumber(c.credit)
  })).filter((c: any) => c.ts);
  const chronological = [...rows].sort((a, b) => a.ts.localeCompare(b.ts));
  let cashPointer = 0; let drawer: number | null = null;
  for (const row of chronological) {
    while (cashPointer < cashEvents.length && cashEvents[cashPointer].ts <= row.ts) {
      const event = cashEvents[cashPointer++];
      if (event.type === 'Session Open') drawer = event.credit - event.debit;
      else if (drawer !== null) drawer += event.credit - event.debit;
    }
    row.runningCashBalance = drawer === null ? null : Math.round(drawer * 10000) / 10000;
    if (!row.time) row.time = dayBookTime(row.ts);
  }

  // Day Book stores the authoritative creator value from each source module.
  // Some older/newer modules store app_users.user_id while others already store a display name.
  // Resolve only known user IDs here so the UI never exposes an internal UUID, while preserving
  // existing human-readable names and historical labels such as "Initial Setup".
  const usersR = await db.prepare(`SELECT user_id, full_name FROM app_users`).all<any>();
  const userNameById = new Map<string, string>();
  for (const u of usersR.results || []) {
    const id = cleanText(u.user_id), name = cleanText(u.full_name);
    if (id && name) userNameById.set(id, name);
  }
  for (const row of rows) {
    const creator = cleanText(row.createdBy);
    if (!creator) continue;
    if (userNameById.has(creator)) row.createdBy = userNameById.get(creator) || creator;
    else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(creator)) row.createdBy = 'Unknown User';
  }

  const filtered = rows.filter((r) => {
    if (moduleFilter && r.module !== moduleFilter) return false;
    if (paymentFilter && r.paymentMethod !== paymentFilter) return false;
    if (backdatedOnly && !r.isBackdated) return false;
    if (query) {
      const hay = `${r.referenceNo} ${r.party} ${r.description} ${r.transactionType}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  }).sort((a, b) => b.ts.localeCompare(a.ts));

  const totals = { cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0, netCash: 0, netBank: 0 };
  for (const r of filtered) {
    if (r.isDeleted) continue;
    totals.cashIn += r.cashIn; totals.cashOut += r.cashOut; totals.bankIn += r.bankIn; totals.bankOut += r.bankOut;
  }
  totals.netCash = totals.cashIn - totals.cashOut;
  totals.netBank = totals.bankIn - totals.bankOut;
  for (const key of ['cashIn','cashOut','bankIn','bankOut','netCash','netBank'] as const) totals[key] = Math.round(totals[key] * 10000) / 10000;

  return json({ ok: true, rows: filtered, totals, isAdmin, count: filtered.length });
}



async function computeDashboardProfit(db:SherDatabase, from:string, to:string):Promise<DashboardProfitResult>{
  const salesR=await db.prepare(`SELECT invoice_id,subtotal,grand_total,discount FROM sales WHERE COALESCE(is_deleted,0)=0 AND status<>'Deleted' AND sale_date BETWEEN ? AND ?`).bind(from,to).all<any>();
  const sales=salesR.results||[];
  if(!sales.length){
    const expR=await db.prepare(`SELECT category_name,COUNT(*) entries,COALESCE(SUM(amount),0) amount FROM expenses WHERE COALESCE(is_deleted,0)=0 AND status<>'Cancelled' AND expense_date BETWEEN ? AND ? GROUP BY category_name ORDER BY amount DESC`).bind(from,to).all<any>();
    const expenseByCategory=(expR.results||[]).map((e:any)=>({label:cleanText(e.category_name)||'Uncategorized',entries:Number(e.entries||0),amount:Number(e.amount||0)}));
    const expenses=expenseByCategory.reduce((n,e)=>n+e.amount,0);
    return {totals:{netProfit:-expenses,grossProfit:0,cogs:0,expenses,grossMarginPercent:0},coverage:{invoicesInRange:0,invoicesMissingLotData:0},byProduct:[],expenseByCategory};
  }
  const ids=sales.map((s:any)=>cleanText(s.invoice_id));
  const factor=new Map<string,number>();
  for(const s of sales){const sub=Number(s.subtotal||0),grand=Number(s.grand_total||0);factor.set(cleanText(s.invoice_id),sub>0?grand/sub:1);}
  const placeholders=ids.map(()=>'?').join(',');
  const [itemsR,returnsR,lotsR,expR]=await Promise.all([
    db.prepare(`SELECT invoice_id,product_id,product_name,quantity,line_total FROM sale_items WHERE invoice_id IN (${placeholders})`).bind(...ids).all<any>(),
    db.prepare(`SELECT invoice_id,product_id,product_name,return_quantity,line_total FROM sales_return_items WHERE invoice_id IN (${placeholders})`).bind(...ids).all<any>(),
    db.prepare(`SELECT invoice_id,product_id,quantity,unit_cost FROM sale_item_lots WHERE invoice_id IN (${placeholders})`).bind(...ids).all<any>(),
    db.prepare(`SELECT category_name,COUNT(*) entries,COALESCE(SUM(amount),0) amount FROM expenses WHERE COALESCE(is_deleted,0)=0 AND status<>'Cancelled' AND expense_date BETWEEN ? AND ? GROUP BY category_name ORDER BY amount DESC`).bind(from,to).all<any>()
  ]);
  const buckets=new Map<string,{name:string;qtySold:number;qtyReturned:number;revenue:number;cost:number;profit:number}>();
  const bucket=(pid:string,name='')=>{let b=buckets.get(pid);if(!b){b={name:name||pid,qtySold:0,qtyReturned:0,revenue:0,cost:0,profit:0};buckets.set(pid,b);}else if(name&&b.name===pid)b.name=name;return b;};
  for(const i of itemsR.results||[]){const id=cleanText(i.invoice_id),pid=cleanText(i.product_id),b=bucket(pid,cleanText(i.product_name));b.qtySold+=Number(i.quantity||0);b.revenue+=Number(i.line_total||0)*(factor.get(id)||1);}
  const returnedQty=new Map<string,number>();
  for(const r of returnsR.results||[]){const id=cleanText(r.invoice_id),pid=cleanText(r.product_id),b=bucket(pid,cleanText(r.product_name)),q=Number(r.return_quantity||0);b.qtyReturned+=q;b.revenue-=Number(r.line_total||0)*(factor.get(id)||1);const k=`${id}\u0000${pid}`;returnedQty.set(k,(returnedQty.get(k)||0)+q);}
  const lotAgg=new Map<string,{invoiceId:string;productId:string;qty:number;cost:number}>();
  const invoicesWithLots=new Set<string>();
  for(const l of lotsR.results||[]){const id=cleanText(l.invoice_id),pid=cleanText(l.product_id),k=`${id}\u0000${pid}`;invoicesWithLots.add(id);const a=lotAgg.get(k)||{invoiceId:id,productId:pid,qty:0,cost:0};const q=Number(l.quantity||0);a.qty+=q;a.cost+=q*Number(l.unit_cost||0);lotAgg.set(k,a);}
  let cogs=0;
  for(const [k,a] of lotAgg){const returned=Math.min(a.qty,returnedQty.get(k)||0),netQty=Math.max(0,a.qty-returned),netCost=a.qty>0?a.cost*(netQty/a.qty):0;cogs+=netCost;bucket(a.productId).cost+=netCost;}
  for(const b of buckets.values())b.profit=b.revenue-b.cost;
  const byProduct=[...buckets.values()].map(b=>({name:b.name,qtySold:b.qtySold,revenue:b.revenue,profit:b.profit})).sort((a,b)=>b.profit-a.profit);
  const expenseByCategory=(expR.results||[]).map((e:any)=>({label:cleanText(e.category_name)||'Uncategorized',entries:Number(e.entries||0),amount:Number(e.amount||0)}));
  const expenses=expenseByCategory.reduce((n,e)=>n+e.amount,0);
  const grossRevenue=sales.reduce((n:any,s:any)=>n+Number(s.grand_total||0),0);
  const returnedRevenue=(returnsR.results||[]).reduce((n:number,r:any)=>n+Number(r.line_total||0)*(factor.get(cleanText(r.invoice_id))||1),0);
  const netRevenue=grossRevenue-returnedRevenue,grossProfit=netRevenue-cogs;
  return {totals:{netProfit:grossProfit-expenses,grossProfit,cogs,expenses,grossMarginPercent:netRevenue>0?(grossProfit/netRevenue)*100:0},coverage:{invoicesInRange:sales.length,invoicesMissingLotData:sales.filter((s:any)=>!invoicesWithLots.has(cleanText(s.invoice_id))).length},byProduct,expenseByCategory};
}

export async function getDashboardRoute(db:SherDatabase,user:AuthUser):Promise<Response>{
  const today=todayDate(),monthStart=`${today.slice(0,8)}01`;
  const [todaySalesR,monthSalesR,todayExpenseR,productsR,inventoryR,customersR,suppliersR,cashR,banksR,currencyR,session,finance,todayProfit,monthProfit]=await Promise.all([
    db.prepare(`SELECT invoice_id,grand_total FROM sales WHERE COALESCE(is_deleted,0)=0 AND status<>'Deleted' AND sale_date=?`).bind(today).all<any>(),
    db.prepare(`SELECT COALESCE(SUM(grand_total),0) total FROM sales WHERE COALESCE(is_deleted,0)=0 AND status<>'Deleted' AND sale_date BETWEEN ? AND ?`).bind(monthStart,today).first<any>(),
    db.prepare(`SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE COALESCE(is_deleted,0)=0 AND status<>'Cancelled' AND expense_date=?`).bind(today).first<any>(),
    db.prepare(`SELECT product_name,current_stock,minimum_stock,status FROM products WHERE COALESCE(is_deleted,0)=0`).all<any>(),
    db.prepare(`SELECT COALESCE(SUM(remaining_quantity*unit_cost),0) total FROM stock_lots`).first<any>(),
    db.prepare(`SELECT customer_name,phone,current_due FROM customers WHERE COALESCE(is_deleted,0)=0`).all<any>(),
    db.prepare(`SELECT current_due FROM suppliers WHERE COALESCE(is_deleted,0)=0`).all<any>(),
    db.prepare(`SELECT COALESCE(SUM(credit-debit),0) balance FROM cash_book WHERE COALESCE(is_deleted,0)=0`).first<any>(),
    db.prepare(`SELECT bank_account_id,account_name,current_balance FROM bank_accounts WHERE status<>'Inactive' ORDER BY account_name COLLATE NOCASE`).all<any>(),
    db.prepare(`SELECT setting_value FROM app_settings WHERE setting_key='Currency Symbol' LIMIT 1`).first<any>(),
    getOpenCashSession(db),financeBalances(db),computeDashboardProfit(db,today,today),computeDashboardProfit(db,monthStart,today)
  ]);
  const products=productsR.results||[];
  const lowStock=products.filter((p:any)=>cleanText(p.status)!=='Inactive'&&Number(p.current_stock||0)<=Number(p.minimum_stock||0)).sort((a:any,b:any)=>Number(a.current_stock||0)-Number(b.current_stock||0));
  const customers=customersR.results||[];
  const dueReceivable=customers.reduce((n:number,c:any)=>n+Math.max(0,Number(c.current_due||0)),0);
  const topDebtors=customers.filter((c:any)=>Number(c.current_due||0)>0).sort((a:any,b:any)=>Number(b.current_due||0)-Number(a.current_due||0)).slice(0,8).map((c:any)=>({name:cleanText(c.customer_name),phone:cleanText(c.phone),due:Number(c.current_due||0)}));
  const supplierPayable=(suppliersR.results||[]).reduce((n:number,s:any)=>n+Math.max(0,Number(s.current_due||0)),0);
  const bankAccounts=(banksR.results||[]).map((b:any)=>({id:cleanText(b.bank_account_id),name:cleanText(b.account_name),balance:Number(b.current_balance||0)}));
  const totalBankBalance=bankAccounts.reduce((n,b)=>n+b.balance,0),cashBalance=Number(cashR?.balance||0);
  const seven=new Date(`${today}T00:00:00Z`);seven.setUTCDate(seven.getUTCDate()-6);const since=seven.toISOString().slice(0,10);
  let activity:any[]=[];let activityAvailable=true;
  try{const u=new URL('https://internal/api/daybook');u.searchParams.set('dateFrom',since);u.searchParams.set('dateTo',today);const r=await getDayBookRoute(db,u,user);const d=await r.json() as any;if(d?.ok)activity=(d.rows||[]).slice(0,12).map((x:any)=>({date:x.date,time:x.time,module:x.module,transactionType:x.transactionType,referenceNo:x.referenceNo,party:x.party,cashIn:Number(x.cashIn||0),cashOut:Number(x.cashOut||0),status:x.status,isBackdated:!!x.isBackdated}));else activityAvailable=false;}catch{activityAvailable=false;}
  return json({ok:true,todaySalesTotal:(todaySalesR.results||[]).reduce((n:number,s:any)=>n+Number(s.grand_total||0),0),todaySalesCount:(todaySalesR.results||[]).length,todayExpenseTotal:Number(todayExpenseR?.total||0),monthSalesTotal:Number(monthSalesR?.total||0),todayProfit:todayProfit.totals.netProfit,todayGrossProfit:todayProfit.totals.grossProfit,todayCogs:todayProfit.totals.cogs,monthProfit:monthProfit.totals.netProfit,monthGrossProfit:monthProfit.totals.grossProfit,monthExpenseTotal:monthProfit.totals.expenses,monthGrossMarginPercent:monthProfit.totals.grossMarginPercent,profitCoverageWarning:monthProfit.coverage.invoicesMissingLotData,profitCoverageTotal:monthProfit.coverage.invoicesInRange,expenseByCategory:monthProfit.expenseByCategory.slice(0,8),topProducts:monthProfit.byProduct.slice(0,8),topDebtors,activity,activityAvailable,cashBalance,bankAccounts,totalBankBalance,totalBalance:cashBalance+totalBankBalance,dueReceivable,supplierPayable,inventoryValue:Number(inventoryR?.total||0),lowStockCount:lowStock.length,lowStockItems:lowStock.slice(0,8).map((p:any)=>({name:cleanText(p.product_name),stock:Number(p.current_stock||0),min:Number(p.minimum_stock||0)})),activeSession:session?{sessionId:session.session_id,openedAt:session.opened_at,openingCash:Number(session.opening_cash||0)}:null,currencySymbol:cleanText(currencyR?.setting_value)||'৳',ownerCapital:finance.ownerCapital,outstandingLoan:finance.outstandingLoan});
}


function reportRangeFromUrl(url: URL): ReportRange {
  const today = todayDate();
  let from = cleanText(url.searchParams.get('from'));
  let to = cleanText(url.searchParams.get('to'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) from = `${today.slice(0,8)}01`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) to = today;
  if (from > to) [from,to] = [to,from];
  return { from, to };
}
async function reportsSettings(db:SherDatabase):Promise<{currencySymbol:string;shopName:string}> {
  const r=await db.prepare(`SELECT setting_key,setting_value FROM app_settings WHERE setting_key IN ('Currency Symbol','Shop Name')`).all<any>();
  const m=new Map<string,string>(); for(const x of r.results||[])m.set(cleanText(x.setting_key),cleanText(x.setting_value));
  return {currencySymbol:m.get('Currency Symbol')||'৳',shopName:m.get('Shop Name')||'SherERP'};
}
export async function getReportsBootstrapRoute(db:SherDatabase):Promise<Response>{
  const s=await reportsSettings(db),today=todayDate();
  return json({ok:true,reportTypes:[{key:'sales',label:'Sales'},{key:'purchase',label:'Purchase'},{key:'stock',label:'Stock & Valuation'},{key:'cashbank',label:'Cash & Bank'},{key:'profit',label:'Profit'},{key:'balancesheet',label:'Balance Sheet'}],currencySymbol:s.currencySymbol,shopName:s.shopName,defaultFrom:`${today.slice(0,8)}01`,defaultTo:today});
}
export async function getSalesReportRoute(db:SherDatabase,url:URL):Promise<Response>{
  const range=reportRangeFromUrl(url);
  const sr=await db.prepare(`SELECT invoice_id,sale_date,customer_name,grand_total,discount,paid_amount,due_amount,payment_type FROM sales WHERE COALESCE(is_deleted,0)=0 AND status<>'Deleted' AND sale_date BETWEEN ? AND ? ORDER BY sale_date`).bind(range.from,range.to).all<any>();
  const rows=sr.results||[], ids=rows.map((x:any)=>cleanText(x.invoice_id));
  const returned=new Map<string,number>();
  if(ids.length){const ph=ids.map(()=>'?').join(',');const rr=await db.prepare(`SELECT invoice_id,COALESCE(SUM(line_total),0) total FROM sales_return_items WHERE invoice_id IN (${ph}) GROUP BY invoice_id`).bind(...ids).all<any>();for(const x of rr.results||[])returned.set(cleanText(x.invoice_id),Number(x.total||0));}
  const byDay=new Map<string,any>(),byPayment=new Map<string,any>(),byCustomer=new Map<string,any>();let grossSales=0,discount=0,retTotal=0,paid=0,due=0;
  for(const s of rows){const day=cleanText(s.sale_date),gross=Number(s.grand_total||0),ret=returned.get(cleanText(s.invoice_id))||0,net=gross-ret;grossSales+=gross;discount+=Number(s.discount||0);retTotal+=ret;paid+=Number(s.paid_amount||0);due+=Number(s.due_amount||0);
    const d=byDay.get(day)||{label:day,invoices:0,gross:0,returned:0,net:0};d.invoices++;d.gross+=gross;d.returned+=ret;d.net+=net;byDay.set(day,d);
    const pk=cleanText(s.payment_type)||'Unknown',p=byPayment.get(pk)||{label:pk,invoices:0,gross:0,net:0};p.invoices++;p.gross+=gross;p.net+=net;byPayment.set(pk,p);
    const ck=cleanText(s.customer_name)||'Walk-in Customer',c=byCustomer.get(ck)||{label:ck,invoices:0,gross:0,net:0};c.invoices++;c.gross+=gross;c.net+=net;byCustomer.set(ck,c);
  }
  return json({ok:true,range,totals:{invoices:rows.length,grossSales,discount,returned:retTotal,netSales:grossSales-retTotal,paid,due},byDay:[...byDay.values()].sort((a,b)=>a.label.localeCompare(b.label)),byPaymentType:[...byPayment.values()].sort((a,b)=>b.net-a.net),topCustomers:[...byCustomer.values()].sort((a,b)=>b.net-a.net).slice(0,15)});
}
export async function getPurchaseReportRoute(db:SherDatabase,url:URL):Promise<Response>{
  const range=reportRangeFromUrl(url);
  const pr=await db.prepare(`SELECT purchase_id,purchase_date,supplier_name,grand_total,discount,paid_amount,due_amount FROM purchases WHERE COALESCE(is_deleted,0)=0 AND status<>'Deleted' AND purchase_date BETWEEN ? AND ? ORDER BY purchase_date`).bind(range.from,range.to).all<any>();
  const rows=pr.results||[],ids=rows.map((x:any)=>cleanText(x.purchase_id));const returned=new Map<string,number>();
  if(ids.length){const ph=ids.map(()=>'?').join(',');const rr=await db.prepare(`SELECT purchase_id,COALESCE(SUM(line_total),0) total FROM purchase_return_items WHERE purchase_id IN (${ph}) GROUP BY purchase_id`).bind(...ids).all<any>();for(const x of rr.results||[])returned.set(cleanText(x.purchase_id),Number(x.total||0));}
  const byDay=new Map<string,any>(),bySupplier=new Map<string,any>();let grossPurchases=0,discount=0,retTotal=0,paid=0,due=0;
  for(const p of rows){const day=cleanText(p.purchase_date),gross=Number(p.grand_total||0),ret=returned.get(cleanText(p.purchase_id))||0,net=gross-ret;grossPurchases+=gross;discount+=Number(p.discount||0);retTotal+=ret;paid+=Number(p.paid_amount||0);due+=Number(p.due_amount||0);
    const d=byDay.get(day)||{label:day,purchases:0,gross:0,returned:0,net:0};d.purchases++;d.gross+=gross;d.returned+=ret;d.net+=net;byDay.set(day,d);
    const sk=cleanText(p.supplier_name)||'Unknown',s=bySupplier.get(sk)||{label:sk,purchases:0,gross:0,net:0,due:0};s.purchases++;s.gross+=gross;s.net+=net;s.due+=Number(p.due_amount||0);bySupplier.set(sk,s);
  }
  return json({ok:true,range,totals:{purchases:rows.length,grossPurchases,discount,returned:retTotal,netPurchases:grossPurchases-retTotal,paid,due},byDay:[...byDay.values()].sort((a,b)=>a.label.localeCompare(b.label)),topSuppliers:[...bySupplier.values()].sort((a,b)=>b.net-a.net).slice(0,15)});
}
export async function getStockReportRoute(db:SherDatabase):Promise<Response>{
  const [pr,lr]=await Promise.all([db.prepare(`SELECT product_id,product_name,category,unit,purchase_price,selling_price,current_stock,minimum_stock,status FROM products WHERE COALESCE(is_deleted,0)=0`).all<any>(),db.prepare(`SELECT product_id,remaining_quantity,unit_cost FROM stock_lots`).all<any>()]);
  const qtyMap=new Map<string,number>(),valueMap=new Map<string,number>();for(const l of lr.results||[]){const q=Number(l.remaining_quantity||0);if(q<=0)continue;const id=cleanText(l.product_id);qtyMap.set(id,(qtyMap.get(id)||0)+q);valueMap.set(id,(valueMap.get(id)||0)+q*Number(l.unit_cost||0));}
  let activeProducts=0,inventoryValue=0,retailValue=0,lowStockCount=0,outOfStockCount=0;const products=(pr.results||[]).map((p:any)=>{const id=cleanText(p.product_id),stock=Number(p.current_stock||0),min=Number(p.minimum_stock||0),lotQuantity=qtyMap.get(id)||0,lotValue=valueMap.get(id)||0,retail=stock*Number(p.selling_price||0),active=cleanText(p.status)!=='Inactive';if(active){activeProducts++;inventoryValue+=lotValue;retailValue+=retail;if(stock<=0)outOfStockCount++;else if(stock<=min)lowStockCount++;}return{productId:id,name:cleanText(p.product_name),category:cleanText(p.category)||'Uncategorized',unit:cleanText(p.unit),stock,minStock:min,purchasePrice:Number(p.purchase_price||0),sellingPrice:Number(p.selling_price||0),lotQuantity,lotValue,retailValue:retail,status:cleanText(p.status)||'Active',lotMismatch:active&&Math.abs(lotQuantity-stock)>0.0001};}).sort((a:any,b:any)=>b.lotValue-a.lotValue);
  const cats=new Map<string,any>();for(const r of products){if(r.status==='Inactive')continue;const c=cats.get(r.category)||{label:r.category,products:0,stock:0,value:0};c.products++;c.stock+=r.stock;c.value+=r.lotValue;cats.set(r.category,c);}
  return json({ok:true,totals:{products:products.length,activeProducts,inventoryValue,retailValue,potentialMargin:retailValue-inventoryValue,lowStockCount,outOfStockCount,mismatchCount:products.filter((x:any)=>x.lotMismatch).length},byCategory:[...cats.values()].sort((a,b)=>b.value-a.value),products,lowStock:products.filter((x:any)=>x.status!=='Inactive'&&x.stock<=x.minStock)});
}
export async function getCashBankReportRoute(db:SherDatabase,url:URL):Promise<Response>{
  const range=reportRangeFromUrl(url);
  const [cashBefore,cashRange,accounts]=await Promise.all([
    db.prepare(`SELECT COALESCE(SUM(credit-debit),0) balance FROM cash_book WHERE COALESCE(is_deleted,0)=0 AND substr(date,1,10) < ?`).bind(range.from).first<any>(),
    db.prepare(`SELECT type,credit,debit FROM cash_book WHERE COALESCE(is_deleted,0)=0 AND substr(date,1,10) BETWEEN ? AND ? ORDER BY date,created_at`).bind(range.from,range.to).all<any>(),
    db.prepare(`SELECT bank_account_id,account_name,bank_name,opening_balance,current_balance FROM bank_accounts WHERE status<>'Inactive' ORDER BY account_name COLLATE NOCASE`).all<any>()
  ]);
  const opening=Number(cashBefore?.balance||0),types=new Map<string,any>();let inflow=0,outflow=0;for(const r of cashRange.results||[]){const i=Number(r.credit||0),o=Number(r.debit||0),k=cleanText(r.type)||'Other';inflow+=i;outflow+=o;const x=types.get(k)||{label:k,entries:0,inflow:0,outflow:0,net:0};x.entries++;x.inflow+=i;x.outflow+=o;x.net+=i-o;types.set(k,x);}
  const banks:any[]=[];for(const a of accounts.results||[]){const id=cleanText(a.bank_account_id);const [before,rangeRows]=await Promise.all([db.prepare(`SELECT balance FROM bank_book WHERE bank_account_id=? AND COALESCE(is_deleted,0)=0 AND status<>'Reversed' AND substr(date,1,10) < ? ORDER BY date DESC,created_at DESC LIMIT 1`).bind(id,range.from).first<any>(),db.prepare(`SELECT debit,credit,balance FROM bank_book WHERE bank_account_id=? AND COALESCE(is_deleted,0)=0 AND status<>'Reversed' AND substr(date,1,10) BETWEEN ? AND ? ORDER BY date,created_at`).bind(id,range.from,range.to).all<any>()]);let bi=0,bo=0;for(const r of rangeRows.results||[]){bi+=Number(r.credit||0);bo+=Number(r.debit||0);}const bankOpening=before?Number(before.balance||0):Number(a.opening_balance||0),last=(rangeRows.results||[]).at(-1);banks.push({id,name:cleanText(a.account_name),bankName:cleanText(a.bank_name),opening:bankOpening,inflow:bi,outflow:bo,closing:last?Number(last.balance||0):bankOpening,entries:(rangeRows.results||[]).length,currentBalance:Number(a.current_balance||0)});}
  const bankTotals=banks.reduce((x,b)=>({opening:x.opening+b.opening,inflow:x.inflow+b.inflow,outflow:x.outflow+b.outflow,closing:x.closing+b.closing}),{opening:0,inflow:0,outflow:0,closing:0});
  return json({ok:true,range,cash:{opening,inflow,outflow,closing:opening+inflow-outflow,entries:(cashRange.results||[]).length,byType:[...types.values()].sort((a,b)=>b.inflow-a.inflow)},banks,bankTotals,combined:{opening:opening+bankTotals.opening,closing:opening+inflow-outflow+bankTotals.closing}});
}
async function computeReportsProfit(db:SherDatabase,range:ReportRange):Promise<any>{
  const sr=await db.prepare(`SELECT invoice_id,sale_date,subtotal,grand_total,discount FROM sales WHERE COALESCE(is_deleted,0)=0 AND status<>'Deleted' AND sale_date BETWEEN ? AND ?`).bind(range.from,range.to).all<any>();const sales=sr.results||[];const ids=sales.map((x:any)=>cleanText(x.invoice_id));
  const expR=await db.prepare(`SELECT COALESCE(NULLIF(category_name,''),'Uncategorized') label,COUNT(*) entries,COALESCE(SUM(amount),0) amount FROM expenses WHERE COALESCE(is_deleted,0)=0 AND status<>'Cancelled' AND expense_date BETWEEN ? AND ? GROUP BY COALESCE(NULLIF(category_name,''),'Uncategorized') ORDER BY amount DESC`).bind(range.from,range.to).all<any>();const expenseByCategory=(expR.results||[]).map((x:any)=>({label:cleanText(x.label),entries:Number(x.entries||0),amount:Number(x.amount||0)})),expenses=expenseByCategory.reduce((n:number,x:any)=>n+x.amount,0);
  if(!ids.length)return{range,totals:{invoices:0,grossSales:0,discount:0,returned:0,netRevenue:0,cogs:0,grossProfit:0,grossMarginPercent:0,expenses,netProfit:-expenses,netMarginPercent:0},coverage:{invoicesInRange:0,invoicesWithLotData:0,invoicesMissingLotData:0,missingSample:[]},byProduct:[],topProducts:[],lossMakers:[],expenseByCategory};
  const ph=ids.map(()=>'?').join(','),[itemsR,returnsR,lotsR]=await Promise.all([db.prepare(`SELECT invoice_id,product_id,product_name,quantity,line_total FROM sale_items WHERE invoice_id IN (${ph})`).bind(...ids).all<any>(),db.prepare(`SELECT invoice_id,product_id,product_name,return_quantity,line_total FROM sales_return_items WHERE invoice_id IN (${ph})`).bind(...ids).all<any>(),db.prepare(`SELECT invoice_id,product_id,quantity,unit_cost FROM sale_item_lots WHERE invoice_id IN (${ph})`).bind(...ids).all<any>()]);
  const factor=new Map<string,number>();let grossSales=0,discount=0;for(const s of sales){const sub=Number(s.subtotal||0),grand=Number(s.grand_total||0);factor.set(cleanText(s.invoice_id),sub>0?grand/sub:1);grossSales+=grand;discount+=Number(s.discount||0);}
  const buckets=new Map<string,any>();const bucket=(id:string,name='')=>{let b=buckets.get(id);if(!b){b={productId:id,label:name||id,qtySold:0,qtyReturned:0,revenue:0,cost:0,profit:0};buckets.set(id,b);}else if(name&&b.label===id)b.label=name;return b;};
  for(const i of itemsR.results||[]){const b=bucket(cleanText(i.product_id),cleanText(i.product_name));b.qtySold+=Number(i.quantity||0);b.revenue+=Number(i.line_total||0)*(factor.get(cleanText(i.invoice_id))||1);}
  let returned=0;const returnedQty=new Map<string,number>();for(const r of returnsR.results||[]){const id=cleanText(r.invoice_id),pid=cleanText(r.product_id),scaled=Number(r.line_total||0)*(factor.get(id)||1),b=bucket(pid,cleanText(r.product_name));b.qtyReturned+=Number(r.return_quantity||0);b.revenue-=scaled;returned+=scaled;const k=`${id}\0${pid}`;returnedQty.set(k,(returnedQty.get(k)||0)+Number(r.return_quantity||0));}
  const lotAgg=new Map<string,{invoiceId:string;productId:string;qty:number;cost:number}>(),withLots=new Set<string>();for(const l of lotsR.results||[]){const id=cleanText(l.invoice_id),pid=cleanText(l.product_id),k=`${id}\0${pid}`,q=Number(l.quantity||0);withLots.add(id);const x=lotAgg.get(k)||{invoiceId:id,productId:pid,qty:0,cost:0};x.qty+=q;x.cost+=q*Number(l.unit_cost||0);lotAgg.set(k,x);}
  let cogs=0;for(const [k,x] of lotAgg){const ret=Math.min(x.qty,returnedQty.get(k)||0),netQty=Math.max(0,x.qty-ret),cost=x.qty>0?x.cost*(netQty/x.qty):0;cogs+=cost;bucket(x.productId).cost+=cost;}
  for(const b of buckets.values())b.profit=b.revenue-b.cost;const byProduct=[...buckets.values()].sort((a,b)=>b.profit-a.profit),netRevenue=grossSales-returned,grossProfit=netRevenue-cogs,missing=sales.filter((x:any)=>!withLots.has(cleanText(x.invoice_id)));
  return{range,totals:{invoices:sales.length,grossSales,discount,returned,netRevenue,cogs,grossProfit,grossMarginPercent:netRevenue>0?grossProfit/netRevenue*100:0,expenses,netProfit:grossProfit-expenses,netMarginPercent:netRevenue>0?(grossProfit-expenses)/netRevenue*100:0},coverage:{invoicesInRange:sales.length,invoicesWithLotData:sales.length-missing.length,invoicesMissingLotData:missing.length,missingSample:missing.slice(0,10).map((s:any)=>({invoiceId:cleanText(s.invoice_id),date:cleanText(s.sale_date),grandTotal:Number(s.grand_total||0)}))},byProduct,topProducts:byProduct.slice(0,15),lossMakers:byProduct.filter((p:any)=>p.profit<0).slice(0,10),expenseByCategory};
}
export async function getProfitReportRoute(db:SherDatabase,url:URL):Promise<Response>{return json({ok:true,...await computeReportsProfit(db,reportRangeFromUrl(url))});}
export async function getBalanceSheetReportRoute(db:SherDatabase):Promise<Response>{
  const [cashR,banksR,invR,fin]=await Promise.all([db.prepare(`SELECT COALESCE(SUM(credit-debit),0) balance FROM cash_book WHERE COALESCE(is_deleted,0)=0`).first<any>(),db.prepare(`SELECT account_type,current_balance FROM bank_accounts WHERE status<>'Inactive'`).all<any>(),db.prepare(`SELECT COALESCE(SUM(remaining_quantity*unit_cost),0) total FROM stock_lots`).first<any>(),financeBalances(db)]);let bank=0,mobileBanking=0;for(const b of banksR.results||[]){if(cleanText(b.account_type)==='Mobile Banking')mobileBanking+=Number(b.current_balance||0);else bank+=Number(b.current_balance||0);}const cash=Number(cashR?.balance||0),inventory=Number(invR?.total||0);return json({ok:true,asOf:todayDate(),assets:{cash,bank,mobileBanking,inventory,total:cash+bank+mobileBanking+inventory},liabilities:{outstandingLoan:fin.outstandingLoan,total:fin.outstandingLoan},equity:{ownerCapital:fin.ownerCapital,total:fin.ownerCapital}});
}



