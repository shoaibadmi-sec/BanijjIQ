import type { SherDatabase, SqlPreparedStatement } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
import { getLedgerPrintHeader, ledgerDateWhere, ledgerHistoryMeta, parseLedgerHistory } from '../../core/ledgerHistory.js';
import type { ProductRow } from '../products/types.js';
import type { PurchaseInput, PurchaseLineInput, PurchaseReturnInput } from './types.js';
import { prepareNewLotTracking, trackingEnabled } from '../products/tracking.service.js';
import { quotePurchaseUnits, type PurchaseUnitQuote } from './purchaseUnits.js';
import { getMixedPurchaseForReturn, completeMixedPurchaseReturn } from './mixedReturn.service.js';

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

function qty(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 10000) / 10000;
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

async function ensureSupplier(db: SherDatabase, supplierId?: string, supplierName?: string): Promise<{ supplierId: string; supplierName: string }> {
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

async function nextPurchaseId(db: SherDatabase): Promise<string> {
  const row = await db.prepare(`
    SELECT purchase_id
    FROM purchases
    WHERE purchase_id LIKE 'PUR-%'
    ORDER BY CAST(SUBSTR(purchase_id, 5) AS INTEGER) DESC
    LIMIT 1
  `).first<{ purchase_id: string }>();
  const last = row?.purchase_id ? Number(row.purchase_id.replace('PUR-', '')) : 0;
  return `PUR-${String(last + 1).padStart(6, '0')}`;
}

export async function createSupplierRoute(db: SherDatabase, input: { name?: string; phone?: string; address?: string; openingBalance?: number; notes?: string }, user?: AuthUser): Promise<Response> {
  const name = cleanText(input.name);
  if (!name) return error('Supplier name is required.');
  const existing = await db.prepare(`SELECT supplier_id AS id, supplier_name AS name FROM suppliers WHERE LOWER(supplier_name) = LOWER(?) AND COALESCE(is_deleted,0) = 0 LIMIT 1`).bind(name).first<{ id: string; name: string }>();
  if (existing) return error('A supplier with this name already exists.', 409);
  const opening = money(input.openingBalance);
  if (opening > 0 && !(await hasActiveCashSession(db))) return error('Start your cash session in POS before creating a supplier with an opening balance.');
  const id = await nextSupplierId(db);
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

export async function createPurchase(db: SherDatabase, input: PurchaseInput, user: AuthUser): Promise<Response> {
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length === 0) return error('Add at least one product line.');
  if(items.some(i=>i.unitQuantities!==undefined)&&!cleanText(input.supplierId))
    return error('Select a saved supplier for mixed-unit purchases.');
  const lineIds=items.map(i=>cleanText(i.productId));
  if(new Set(lineIds).size!==lineIds.length)return error('Duplicate product lines must be merged.');

  const purchaseDate = cleanText(input.date || input.purchaseDate) || new Date().toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (purchaseDate < today && !cleanText(input.backdatedReason)) return error('Reason for backdating is required.');

  let supplier: { supplierId: string; supplierName: string };
  try {
    supplier = await ensureSupplier(db, input.supplierId, cleanText(input.quickSupplierName || input.supplierName));
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Choose a supplier.');
  }

  const purchasePlanOrderId = cleanText(input.purchasePlanOrderId);
  if (purchasePlanOrderId) {
    const sourceOrder = await db.prepare(`SELECT order_id AS orderId, supplier_id AS supplierId, status, converted_purchase_id AS convertedPurchaseId FROM purchase_plan_orders WHERE order_id=? LIMIT 1`).bind(purchasePlanOrderId).first<{ orderId: string; supplierId: string; status: string; convertedPurchaseId: string }>();
    if (!sourceOrder) return error('Source supplier purchase order not found.');
    if (sourceOrder.status !== 'Open' || cleanText(sourceOrder.convertedPurchaseId)) return error('This supplier purchase order has already been converted or closed.');
    if (sourceOrder.supplierId !== supplier.supplierId) return error('Purchase supplier must match the supplier purchase order.');
  }

  const normalized: Array<{ product: ProductRow; qty: number; unitPrice: number; lineTotal: number; sellingPrice: number | null; tracking: any; mixed:(PurchaseUnitQuote & {profileJson:string})|null }> = [];
  const stockByProduct = new Map<string, number>();

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const productId = cleanText(item.productId);
    if(!productId)return error(`Line ${i+1}: product is required.`);
    const product=await db.prepare(`SELECT * FROM products WHERE product_id=? AND is_deleted=0 AND status<>'Inactive'`).bind(productId).first<ProductRow>();
    if(!product)return error(`Line ${i+1}: product no longer exists.`);
    const mixedInput=item.unitQuantities!==undefined||item.unitProfileRevision!==undefined||item.priceUnit!==undefined;
    let mixed:(PurchaseUnitQuote & {profileJson:string})|null=null;
    let quantity:number,unitPrice:number,lineTotal:number;
    if(mixedInput){
      const saved=await db.prepare(`SELECT revision,profile_json FROM product_unit_profiles WHERE product_id=?`)
        .bind(productId).first<{revision:number;profile_json:string}>();
      if(!saved||saved.revision!==item.unitProfileRevision)
        return error(`Line ${i+1}: unit profile changed. Refresh and retry.`,409);
      try{
        const q=quotePurchaseUnits(JSON.parse(saved.profile_json),saved.revision,
          item.unitQuantities as Record<string,number>,cleanText(item.priceUnit),item.unitPrice as number);
        if((item.qty!==undefined||item.quantity!==undefined)&&Number(item.qty??item.quantity)!==q.baseQuantity)
          return error(`Line ${i+1}: base-unit quantity does not match unit entries.`,409);
        mixed={...q,profileJson:saved.profile_json};
        quantity=q.baseQuantity;unitPrice=q.baseUnitCost;lineTotal=q.lineTotal;
      }catch(e){return error(`Line ${i+1}: `+(e instanceof Error?e.message:'Invalid unit quantities.'));}
    }else{
      const q=item.qty??item.quantity,c=item.unitPrice??item.purchasePrice;
      if(typeof q!=='number'||typeof c!=='number'||!Number.isFinite(q)||!Number.isFinite(c)||
         q<=0||q>1000000000||c<0||c>100000000||
         Math.abs(q*10000-Math.round(q*10000))>0.000001||
         Math.abs(c*10000-Math.round(c*10000))>0.000001)
        return error(`Line ${i+1}: invalid base-unit quantity or cost.`);
      quantity=q;unitPrice=c;lineTotal=Math.round(q*c*10000)/10000;
    }
    if(!Number.isFinite(lineTotal)||lineTotal>10000000000)
      return error(`Line ${i+1}: purchase amount exceeds limit.`);
    const sellingPrice=item.sellingPrice===undefined||item.sellingPrice===null?null:money(item.sellingPrice);
    const already=stockByProduct.get(productId)??Number(product.current_stock||0);
    const next=Math.round((already+quantity)*10000)/10000;
    if(!Number.isFinite(next)||next>1000000000)return error('Resulting product stock exceeds limit.');
    stockByProduct.set(productId,next);
    normalized.push({product,qty:quantity,unitPrice,lineTotal,sellingPrice,tracking:item.tracking,mixed});
  }

  const subtotal = Math.round(normalized.reduce((sum, item) => sum + item.lineTotal, 0) * 10000) / 10000;
  const discount = Math.min(money(input.discount), subtotal);
  const grandTotal = Math.max(0, Math.round((subtotal - discount) * 10000) / 10000);
  const paidAmount = Math.min(money(input.paidAmount), grandTotal);
  const dueAmount = Math.max(0, Math.round((grandTotal - paidAmount) * 10000) / 10000);
  const paymentStatus = dueAmount <= 0 ? 'Paid' : (paidAmount > 0 ? 'Partial' : 'Due');
  const paymentMethod = paidAmount > 0 ? cleanText(input.paymentMethod || 'Cash') : '';
  const bankAccountId = cleanText(input.bankAccountId);
  let bankAccountName = '';
  if (paidAmount > 0 && (paymentMethod === 'Bank' || paymentMethod === 'Mobile Banking')) {
    if (!bankAccountId) return error('Bank account is required for bank/mobile payment.');
    const bank = await db.prepare(`SELECT account_name AS name FROM bank_accounts WHERE bank_account_id = ? AND status = 'Active' LIMIT 1`).bind(bankAccountId).first<{ name: string }>();
    if (!bank) return error('Bank account not found.');
    bankAccountName = bank.name;
  }

  const purchaseId = await nextPurchaseId(db);
  const batch: SqlPreparedStatement[] = [];
  batch.push(db.prepare(`
    INSERT INTO purchases (
      purchase_id, purchase_date, supplier_id, supplier_name, subtotal, discount, grand_total,
      paid_amount, due_amount, payment_status, note, status, payment_method,
      bank_account_id, bank_account_name, is_backdated, backdated_days, backdated_reason,
      purchase_plan_order_id, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Completed', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).bind(
    purchaseId, purchaseDate, supplier.supplierId, supplier.supplierName, subtotal, discount, grandTotal,
    paidAmount, dueAmount, paymentStatus, cleanText(input.notes || input.note), paymentMethod,
    bankAccountId, bankAccountName, purchaseDate < today ? 1 : 0, purchaseDate < today ? 1 : 0, cleanText(input.backdatedReason), purchasePlanOrderId, user.userId
  ));

  for (const line of normalized) {
    const lotId = crypto.randomUUID();
    let prepared;
    try { prepared = await prepareNewLotTracking(db, line.product, lotId, line.qty, line.tracking, true); }
    catch (err) { return error(err instanceof Error ? err.message : 'Invalid product tracking data.'); }
    const newStock = stockByProduct.get(line.product.product_id) ?? Number(line.product.current_stock || 0) + line.qty;
    batch.push(db.prepare(`
      INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, purchase_price, line_total, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(purchaseId, line.product.product_id, (line.product.brand ? `${line.product.brand} ${line.product.product_name}` : line.product.product_name), line.qty, line.unitPrice, line.lineTotal));
    batch.push(db.prepare(`
      INSERT INTO stock_lots (lot_id, product_id, source_type, source_ref, original_quantity, remaining_quantity, unit_cost, tracking_required_quantity, tracking_status, created_at)
      VALUES (?, ?, 'PURCHASE', ?, ?, ?, ?, ?, ?, ?)
    `).bind(lotId, line.product.product_id, purchaseId, line.qty, line.qty, line.unitPrice, trackingEnabled(line.product) ? Math.max(0, line.qty - prepared.assignedQuantity) : 0, prepared.status, purchaseDate));
    if(line.mixed)batch.push(db.prepare(`INSERT INTO purchase_unit_snapshots
      (purchase_id,product_id,lot_id,profile_revision,profile_json,quantities_json,
       price_unit,entered_unit_price,base_quantity,base_unit_cost,line_total,description)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        purchaseId,line.product.product_id,lotId,line.mixed.unitProfileRevision,
        line.mixed.profileJson,JSON.stringify(line.mixed.unitQuantities),line.mixed.priceUnit,
        line.mixed.enteredUnitPrice,line.mixed.baseQuantity,line.mixed.baseUnitCost,
        line.mixed.lineTotal,line.mixed.description));
    batch.push(...prepared.statements);
    batch.push(db.prepare(`
      INSERT INTO stock_movements (movement_id, product_id, movement_type, quantity_in, quantity_out, balance_after, lot_id, note, created_at)
      VALUES (?, ?, 'Purchase', ?, 0, ?, ?, ?, datetime('now'))
    `).bind(crypto.randomUUID(), line.product.product_id, line.qty, newStock, lotId, prepared.status === 'Pending' ? `${purchaseId} — Tracking pending` : purchaseId));
    batch.push(db.prepare(`
      UPDATE products SET current_stock = ?, purchase_price = ?, selling_price = CASE WHEN ? IS NULL THEN selling_price ELSE ? END, updated_at = datetime('now') WHERE product_id = ?
    `).bind(newStock, line.unitPrice, line.sellingPrice, line.sellingPrice, line.product.product_id));
  }

  if (dueAmount > 0) {
    batch.push(db.prepare(`UPDATE suppliers SET current_due = current_due + ?, updated_at = datetime('now') WHERE supplier_id = ?`).bind(dueAmount, supplier.supplierId));
    batch.push(db.prepare(`
      INSERT INTO supplier_ledger (ledger_id, date, supplier_id, supplier_name, type, reference, debit, credit, balance, notes, created_by, created_at)
      VALUES (?, datetime('now'), ?, ?, 'Purchase', ?, ?, 0, (SELECT current_due FROM suppliers WHERE supplier_id = ?), ?, ?, datetime('now'))
    `).bind(crypto.randomUUID(), supplier.supplierId, supplier.supplierName, purchaseId, dueAmount, supplier.supplierId, '', user.userId));
  }

  if (purchasePlanOrderId) {
    batch.push(db.prepare(`UPDATE purchase_plan_orders SET status='Converted', converted_purchase_id=?, updated_at=datetime('now') WHERE order_id=? AND status='Open'`).bind(purchaseId, purchasePlanOrderId));
    batch.push(db.prepare(`UPDATE purchase_plans
      SET status = CASE
        WHEN EXISTS (SELECT 1 FROM purchase_plan_orders o WHERE o.plan_id = purchase_plans.plan_id AND o.status='Open') THEN 'Partially Converted'
        ELSE 'Converted'
      END, updated_at=datetime('now')
      WHERE plan_id=(SELECT plan_id FROM purchase_plan_orders WHERE order_id=?)`).bind(purchasePlanOrderId));
  }

  batch.push(db.prepare(`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, note) VALUES (?, 'CREATE_PURCHASE', 'PURCHASE', ?, ?)` ).bind(user.userId, purchaseId, purchasePlanOrderId ? `Purchase grand total ${grandTotal}; source order ${purchasePlanOrderId}` : `Purchase grand total ${grandTotal}`));
  await db.batch(batch);
  return json({ ok: true, purchaseId, grandTotal, dueAmount });
}

export async function getPurchases(db: SherDatabase): Promise<Response> {
  const purchases = await db.prepare(`
    SELECT purchase_id AS purchaseId,
           purchase_date AS purchaseDate,
           COALESCE(supplier_id, '') AS supplierId,
           supplier_name AS supplierName,
           subtotal,
           COALESCE(discount, 0) AS discount,
           COALESCE(grand_total, subtotal) AS grandTotal,
           COALESCE(paid_amount, 0) AS paidAmount,
           COALESCE(due_amount, 0) AS dueAmount,
           COALESCE(payment_status, '') AS paymentStatus,
           COALESCE(returned_amount, 0) AS returnedAmount,
           COALESCE(payment_method, '') AS paymentMethod,
           note,
           status,
           COALESCE(purchase_plan_order_id, '') AS purchasePlanOrderId,
           created_at AS createdAt
    FROM purchases
    ORDER BY purchase_date DESC, created_at DESC
    LIMIT 200
  `).all();

  const rows = (purchases.results ?? []) as Array<{ purchaseId: string; purchaseDate: string; supplierId: string; supplierName: string; subtotal: number; discount: number; grandTotal: number; paidAmount: number; dueAmount: number; paymentStatus: string; returnedAmount: number; paymentMethod: string; note: string; status: string; createdAt: string; items?: unknown[] }>;
  if (rows.length === 0) return json({ ok: true, purchases: [] });

  const ids = rows.map((p) => p.purchaseId);
  const placeholders = ids.map(() => '?').join(',');
  const items = await db.prepare(`
    SELECT pi.purchase_id AS purchaseId,pi.product_id AS productId,
           pi.product_name AS productName,pi.quantity,
           pi.purchase_price AS unitPrice,pi.purchase_price AS purchasePrice,
           pi.line_total AS lineTotal,
           COALESCE(u.description,'') AS unitDescription,
           u.profile_revision AS unitProfileRevision,
           COALESCE(u.price_unit,'') AS purchasePriceUnit,
           u.entered_unit_price AS enteredUnitPrice
    FROM purchase_items pi
    LEFT JOIN purchase_unit_snapshots u ON u.purchase_id=pi.purchase_id AND u.product_id=pi.product_id
    WHERE pi.purchase_id IN (${placeholders})
    ORDER BY pi.id ASC
  `).bind(...ids).all();

  const grouped = new Map<string, unknown[]>();
  for (const item of (items.results ?? []) as Array<Record<string, unknown> & { purchaseId: string }>) {
    const key = item.purchaseId;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }

  return json({ ok: true, purchases: rows.map((row) => ({ ...row, items: grouped.get(row.purchaseId) ?? [] })) });
}


export async function getPurchaseDetail(db: SherDatabase, purchaseId: string): Promise<Response> {
  const one = await db.prepare(`
    SELECT purchase_id AS purchaseId, purchase_date AS purchaseDate, supplier_id AS supplierId,
           supplier_name AS supplierName, subtotal, discount, grand_total AS grandTotal,
           paid_amount AS paidAmount, due_amount AS dueAmount, payment_status AS paymentStatus,
           returned_amount AS returnedAmount, payment_method AS paymentMethod, bank_account_id AS bankAccountId,
           bank_account_name AS bankAccountName, note, status, COALESCE(purchase_plan_order_id,'') AS purchasePlanOrderId, created_at AS createdAt
    FROM purchases
    WHERE purchase_id = ? AND COALESCE(is_deleted,0) = 0
    LIMIT 1
  `).bind(purchaseId).first<Record<string, unknown>>();
  if (!one) return error('Purchase not found.');
  const items = await db.prepare(`
    SELECT pi.product_id AS productId,pi.product_name AS productName,
           pi.quantity,pi.purchase_price AS unitPrice,pi.purchase_price AS purchasePrice,
           pi.line_total AS lineTotal,
           u.description AS unitDescription,u.profile_revision AS unitProfileRevision,
           u.profile_json AS unitProfileJson,u.quantities_json AS unitQuantitiesJson,
           u.price_unit AS purchasePriceUnit,u.entered_unit_price AS enteredUnitPrice,
           u.base_unit_cost AS baseUnitCost,u.lot_id AS sourceLotId
    FROM purchase_items pi
    LEFT JOIN purchase_unit_snapshots u ON u.purchase_id=pi.purchase_id AND u.product_id=pi.product_id
    WHERE pi.purchase_id = ?
    ORDER BY pi.id ASC
  `).bind(purchaseId).all();
  const lines=(items.results||[]).map((row:any)=>{
    const {unitProfileJson,unitQuantitiesJson,...publicRow}=row;
    return {...publicRow,unitSnapshot:unitProfileJson&&unitQuantitiesJson
      ?{revision:row.unitProfileRevision,profile:JSON.parse(unitProfileJson),
        quantities:JSON.parse(unitQuantitiesJson),priceUnit:row.purchasePriceUnit,
        enteredUnitPrice:row.enteredUnitPrice,baseUnitCost:row.baseUnitCost,
        lotId:row.sourceLotId,description:row.unitDescription}:null};
  });
  return json({ok:true,purchase:{...one,items:lines}});
}

async function hasMixedUnitPurchase(db:SherDatabase,purchaseId:string):Promise<boolean>{
 const row=await db.prepare('SELECT 1 AS yes FROM purchase_unit_snapshots WHERE purchase_id=? LIMIT 1')
  .bind(purchaseId).first();
 return !!row;
}

async function hasPurchaseReturn(db: SherDatabase, purchaseId: string): Promise<boolean> {
  const row = await db.prepare(`SELECT return_id FROM purchase_returns WHERE purchase_id = ? AND COALESCE(is_deleted,0) = 0 LIMIT 1`).bind(purchaseId).first();
  return Boolean(row);
}

async function summarizePurchaseItems(db: SherDatabase, purchaseId: string): Promise<Map<string, { productName: string; qty: number; unitPrice: number }>> {
  const rows = await db.prepare(`
    SELECT product_id AS productId, product_name AS productName, SUM(quantity) AS qty, AVG(purchase_price) AS unitPrice
    FROM purchase_items WHERE purchase_id = ? GROUP BY product_id, product_name
  `).bind(purchaseId).all();
  const map = new Map<string, { productName: string; qty: number; unitPrice: number }>();
  for (const r of (rows.results ?? []) as Array<Record<string, unknown>>) {
    map.set(String(r.productId), { productName: String(r.productName), qty: qty(r.qty), unitPrice: money(r.unitPrice) });
  }
  return map;
}

async function purchaseLotTotals(db: SherDatabase, purchaseId: string, productId: string): Promise<{ original: number; remaining: number; lotId: string | null }> {
  const row = await db.prepare(`
    SELECT SUM(original_quantity) AS original, SUM(remaining_quantity) AS remaining, MIN(lot_id) AS lotId
    FROM stock_lots
    WHERE source_type = 'PURCHASE' AND source_ref = ? AND product_id = ?
  `).bind(purchaseId, productId).first<{ original: number; remaining: number; lotId: string }>();
  return { original: qty(row?.original), remaining: qty(row?.remaining), lotId: row?.lotId ?? null };
}

async function normalizePurchaseLines(db: SherDatabase, items: PurchaseLineInput[]): Promise<Array<{ product: ProductRow; qty: number; unitPrice: number; lineTotal: number; sellingPrice: number | null }>> {
  const normalized: Array<{ product: ProductRow; qty: number; unitPrice: number; lineTotal: number; sellingPrice: number | null; tracking: any }> = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const productId = cleanText(item.productId);
    const quantity = qty(item.qty ?? item.quantity);
    const unitPrice = money(item.unitPrice ?? item.purchasePrice);
    const sellingPrice = item.sellingPrice === undefined || item.sellingPrice === null ? null : money(item.sellingPrice);
    if (!productId) throw new Error(`Line ${i + 1}: product is required.`);
    if (quantity <= 0) throw new Error(`Line ${i + 1}: quantity must be greater than zero.`);
    if (unitPrice < 0) throw new Error(`Line ${i + 1}: unit price must be a valid number.`);
    const product = await db.prepare(`SELECT * FROM products WHERE product_id = ? AND is_deleted = 0`).bind(productId).first<ProductRow>();
    if (!product) throw new Error(`Line ${i + 1}: product no longer exists.`);
    normalized.push({ product, qty: quantity, unitPrice, lineTotal: Math.round(quantity * unitPrice * 10000) / 10000, sellingPrice, tracking: item.tracking });
  }
  return normalized;
}

export async function updatePurchase(db: SherDatabase, purchaseId: string, input: PurchaseInput, user: AuthUser): Promise<Response> {
  const reason = cleanText(input.reason);
  if (!reason) return error('Enter a reason for this update.');
  const existing = await db.prepare(`SELECT * FROM purchases WHERE purchase_id = ? AND COALESCE(is_deleted,0) = 0 LIMIT 1`).bind(purchaseId).first<Record<string, unknown>>();
  if (!existing) return error('Purchase not found.');
  if(await hasMixedUnitPurchase(db,purchaseId))
    return error('Mixed-unit purchase edits are locked until historical cost-safe reversal is implemented (Phase 4C).',409);
  if (await hasPurchaseReturn(db, purchaseId)) return error('This purchase has Purchase Return records and can no longer be updated. Use Purchase Return for further corrections.');
  const trackedPurchase = await db.prepare(`SELECT 1 AS x FROM purchase_items pi JOIN products p ON p.product_id=pi.product_id WHERE pi.purchase_id=? AND (p.track_serial=1 OR p.track_expiry=1) LIMIT 1`).bind(purchaseId).first();
  if (trackedPurchase) return error('A purchase containing Serial / Expiry tracked products cannot be edited. Use Purchase Return and create a new purchase for corrections.');

  let normalized: Awaited<ReturnType<typeof normalizePurchaseLines>>;
  try { normalized = await normalizePurchaseLines(db, Array.isArray(input.items) ? input.items : []); } catch (err) { return error(err instanceof Error ? err.message : 'Invalid purchase lines.'); }
  if (normalized.length === 0) return error('Add at least one product line.');

  const oldMap = await summarizePurchaseItems(db, purchaseId);
  const newMap = new Map<string, { product: ProductRow; qty: number; unitPrice: number; sellingPrice: number | null }>();
  for (const line of normalized) {
    const old = newMap.get(line.product.product_id);
    newMap.set(line.product.product_id, {
      product: line.product,
      qty: (old?.qty ?? 0) + line.qty,
      unitPrice: line.unitPrice,
      sellingPrice: line.sellingPrice
    });
  }

  const affected = new Set([...oldMap.keys(), ...newMap.keys()]);
  const batch: SqlPreparedStatement[] = [];
  for (const productId of affected) {
    const oldQty = oldMap.get(productId)?.qty ?? 0;
    const newItem = newMap.get(productId);
    const newQty = newItem?.qty ?? 0;
    const delta = Math.round((newQty - oldQty) * 10000) / 10000;
    if (delta === 0) continue;
    const product = newItem?.product ?? await db.prepare(`SELECT * FROM products WHERE product_id = ? AND is_deleted = 0`).bind(productId).first<ProductRow>();
    if (!product) return error('A product on this purchase no longer exists.');
    const newStock = Math.round((Number(product.current_stock || 0) + delta) * 10000) / 10000;
    if (delta < 0) {
      const lot = await purchaseLotTotals(db, purchaseId, productId);
      if (lot.remaining < Math.abs(delta)) {
        return error(`${product.product_name}: only ${lot.remaining} of this purchase is still unsold, so the quantity cannot be reduced by ${Math.abs(delta)}.`);
      }
      if (newStock < 0) return error(`${product.product_name}: reducing this purchase would make stock negative.`);
      batch.push(db.prepare(`
        UPDATE stock_lots
        SET original_quantity = original_quantity - ?, remaining_quantity = remaining_quantity - ?
        WHERE source_type='PURCHASE' AND source_ref=? AND product_id=? AND lot_id IN (
          SELECT lot_id FROM stock_lots WHERE source_type='PURCHASE' AND source_ref=? AND product_id=? ORDER BY created_at DESC LIMIT 1
        )
      `).bind(Math.abs(delta), Math.abs(delta), purchaseId, productId, purchaseId, productId));
    } else if (delta > 0) {
      const lotId = crypto.randomUUID();
      batch.push(db.prepare(`INSERT INTO stock_lots (lot_id, product_id, source_type, source_ref, original_quantity, remaining_quantity, unit_cost, created_at)
        VALUES (?, ?, 'PURCHASE', ?, ?, ?, ?, ?)`)
        .bind(lotId, productId, purchaseId, delta, delta, newItem?.unitPrice ?? oldMap.get(productId)?.unitPrice ?? 0, String(existing.purchase_date)));
    }
    batch.push(db.prepare(`UPDATE products SET current_stock = ?, purchase_price = CASE WHEN ? > 0 THEN ? ELSE purchase_price END, updated_at = datetime('now') WHERE product_id = ?`)
      .bind(newStock, newItem?.unitPrice ?? 0, newItem?.unitPrice ?? 0, productId));
    batch.push(db.prepare(`INSERT INTO stock_movements (movement_id, product_id, movement_type, quantity_in, quantity_out, balance_after, lot_id, note, created_at)
      VALUES (?, ?, 'Purchase Update', ?, ?, ?, '', ?, datetime('now'))`)
      .bind(crypto.randomUUID(), productId, delta > 0 ? delta : 0, delta < 0 ? Math.abs(delta) : 0, newStock, purchaseId));
  }

  const subtotal = Math.round(normalized.reduce((sum, item) => sum + item.lineTotal, 0) * 10000) / 10000;
  const discount = Math.min(money(input.discount), subtotal);
  const grandTotal = Math.max(0, Math.round((subtotal - discount) * 10000) / 10000);
  const paidAmount = Math.min(money(input.paidAmount), grandTotal);
  const dueAmount = Math.max(0, Math.round((grandTotal - paidAmount) * 10000) / 10000);
  const paymentStatus = dueAmount <= 0 ? 'Paid' : (paidAmount > 0 ? 'Partial' : 'Due');
  const oldDue = money(existing.due_amount);
  const dueDelta = Math.round((dueAmount - oldDue) * 10000) / 10000;

  batch.push(db.prepare(`DELETE FROM purchase_items WHERE purchase_id = ?`).bind(purchaseId));
  for (const line of normalized) {
    batch.push(db.prepare(`INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, purchase_price, line_total, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`).bind(purchaseId, line.product.product_id, (line.product.brand ? `${line.product.brand} ${line.product.product_name}` : line.product.product_name), line.qty, line.unitPrice, line.lineTotal));
  }
  batch.push(db.prepare(`UPDATE purchases SET subtotal=?, discount=?, grand_total=?, paid_amount=?, due_amount=?, payment_status=?, payment_method=?, bank_account_id=?, note=?, updated_at=datetime('now') WHERE purchase_id=?`)
    .bind(subtotal, discount, grandTotal, paidAmount, dueAmount, paymentStatus, paidAmount > 0 ? cleanText(input.paymentMethod || 'Cash') : '', cleanText(input.bankAccountId), cleanText(input.notes || input.note), purchaseId));
  if (dueDelta !== 0) {
    batch.push(db.prepare(`UPDATE suppliers SET current_due = current_due + ?, updated_at=datetime('now') WHERE supplier_id = ?`).bind(dueDelta, String(existing.supplier_id || '')));
    batch.push(db.prepare(`INSERT INTO supplier_ledger (ledger_id, date, supplier_id, supplier_name, type, reference, debit, credit, balance, notes, created_by, created_at)
      VALUES (?, datetime('now'), ?, ?, 'Purchase Update', ?, ?, ?, (SELECT current_due + ? FROM suppliers WHERE supplier_id = ?), ?, ?, datetime('now'))`)
      .bind(crypto.randomUUID(), String(existing.supplier_id || ''), String(existing.supplier_name || ''), purchaseId, dueDelta > 0 ? dueDelta : 0, dueDelta < 0 ? Math.abs(dueDelta) : 0, dueDelta, String(existing.supplier_id || ''), reason, user.userId));
  }
  batch.push(db.prepare(`INSERT INTO invoice_edit_logs (log_id, invoice_id, entity_type, reason, before_total, after_total, edited_by, created_at) VALUES (?, ?, 'PURCHASE', ?, ?, ?, ?, datetime('now'))`)
    .bind(crypto.randomUUID(), purchaseId, reason, money(existing.grand_total ?? existing.subtotal), grandTotal, user.userId));
  batch.push(db.prepare(`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, note) VALUES (?, 'UPDATE_PURCHASE', 'PURCHASE', ?, ?)`)
    .bind(user.userId, purchaseId, reason));

  await db.batch(batch);
  return json({ ok: true, purchaseId, grandTotal, dueAmount });
}

export async function deletePurchaseRoute(db: SherDatabase, purchaseId: string, input: { reason?: string }, user: AuthUser): Promise<Response> {
  const reason = cleanText(input.reason);
  if (!reason) return error('Enter a reason for deleting this purchase.');
  const purchase = await db.prepare(`SELECT * FROM purchases WHERE purchase_id = ? AND COALESCE(is_deleted,0) = 0 LIMIT 1`).bind(purchaseId).first<Record<string, unknown>>();
  if (!purchase) return error('Purchase not found.');
  if(await hasMixedUnitPurchase(db,purchaseId))
    return error('Mixed-unit purchase delete is locked until cost-safe reversal is implemented (Phase 4C).',409);
  if (await hasPurchaseReturn(db, purchaseId)) return error('This purchase has return records and cannot be deleted.');
  const trackedPurchase = await db.prepare(`SELECT 1 AS x FROM purchase_items pi JOIN products p ON p.product_id=pi.product_id WHERE pi.purchase_id=? AND (p.track_serial=1 OR p.track_expiry=1) LIMIT 1`).bind(purchaseId).first();
  if (trackedPurchase) return error('A purchase containing Serial / Expiry tracked products cannot be deleted. Use Purchase Return so tracking history remains intact.');
  const lots = await db.prepare(`SELECT lot_id AS lotId, product_id AS productId, original_quantity AS originalQty, remaining_quantity AS remainingQty FROM stock_lots WHERE source_type='PURCHASE' AND source_ref=?`).bind(purchaseId).all();
  for (const lot of (lots.results ?? []) as Array<Record<string, unknown>>) {
    if (qty(lot.remainingQty) < qty(lot.originalQty)) return error('Some stock from this purchase has already been sold/used. Use Purchase Return instead of delete.');
  }
  const batch: SqlPreparedStatement[] = [];
  for (const lot of (lots.results ?? []) as Array<Record<string, unknown>>) {
    const productId = String(lot.productId);
    const q = qty(lot.originalQty);
    const product = await db.prepare(`SELECT current_stock, product_name FROM products WHERE product_id=?`).bind(productId).first<{ current_stock: number; product_name: string }>();
    const newStock = Math.round((Number(product?.current_stock || 0) - q) * 10000) / 10000;
    if (newStock < 0) return error(`${product?.product_name || productId}: deleting purchase would make stock negative.`);
    batch.push(db.prepare(`UPDATE products SET current_stock=?, updated_at=datetime('now') WHERE product_id=?`).bind(newStock, productId));
    batch.push(db.prepare(`UPDATE stock_lots SET remaining_quantity=0 WHERE lot_id=?`).bind(String(lot.lotId)));
    batch.push(db.prepare(`INSERT INTO stock_movements (movement_id, product_id, movement_type, quantity_in, quantity_out, balance_after, lot_id, note, created_at)
      VALUES (?, ?, 'Purchase Delete', 0, ?, ?, ?, ?, datetime('now'))`).bind(crypto.randomUUID(), productId, q, newStock, String(lot.lotId), reason));
  }
  const due = money(purchase.due_amount);
  if (due > 0) {
    batch.push(db.prepare(`UPDATE suppliers SET current_due = current_due - ?, updated_at=datetime('now') WHERE supplier_id=?`).bind(due, String(purchase.supplier_id || '')));
  }
  batch.push(db.prepare(`UPDATE purchases SET is_deleted=1, status='Deleted', delete_reason=?, deleted_by=?, deleted_at=datetime('now'), updated_at=datetime('now') WHERE purchase_id=?`).bind(reason, user.userId, purchaseId));
  batch.push(db.prepare(`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, note) VALUES (?, 'DELETE_PURCHASE', 'PURCHASE', ?, ?)`)
    .bind(user.userId, purchaseId, reason));
  await db.batch(batch);
  return json({ ok: true });
}

async function nextPurchaseReturnId(db: SherDatabase): Promise<string> {
  const row = await db.prepare(`SELECT return_id FROM purchase_returns WHERE return_id LIKE 'PRTN-%' ORDER BY CAST(SUBSTR(return_id, 6) AS INTEGER) DESC LIMIT 1`).first<{ return_id: string }>();
  const last = row?.return_id ? Number(row.return_id.replace('PRTN-', '')) : 0;
  return `PRTN-${String(last + 1).padStart(6, '0')}`;
}

export async function getPurchaseForReturn(db: SherDatabase, purchaseId: string): Promise<Response> {
  if(await hasMixedUnitPurchase(db,purchaseId))return getMixedPurchaseForReturn(db,purchaseId);
  const purchase = await db.prepare(`SELECT purchase_id AS purchaseId, purchase_date AS purchaseDate, supplier_id AS supplierId, supplier_name AS supplierName, grand_total AS grandTotal, paid_amount AS paidAmount, due_amount AS dueAmount FROM purchases WHERE purchase_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(purchaseId).first<Record<string, unknown>>();
  if (!purchase) return error('Purchase not found.');
  const rows = await db.prepare(`
    SELECT pi.product_id AS productId, pi.product_name AS productName, SUM(pi.quantity) AS boughtQty, AVG(pi.purchase_price) AS unitPrice,
           COALESCE((SELECT SUM(return_quantity) FROM purchase_return_items pri WHERE pri.purchase_id=pi.purchase_id AND pri.product_id=pi.product_id),0) AS previouslyReturnedQty
    FROM purchase_items pi WHERE pi.purchase_id=? GROUP BY pi.product_id, pi.product_name
  `).bind(purchaseId).all();
  const items: any[] = [];
  for (const raw of (rows.results ?? []) as any[]) {
    const product = await db.prepare(`SELECT track_serial AS trackSerial, track_expiry AS trackExpiry, track_warranty AS trackWarranty FROM products WHERE product_id=?`).bind(raw.productId).first<any>();
    let availableQty = Math.max(0, qty(raw.boughtQty) - qty(raw.previouslyReturnedQty));
    let availableSerials: string[] = [];
    if (Number(product?.trackSerial || 0)) {
      const sr = await db.prepare(`SELECT ps.serial_number AS serialNumber FROM product_serials ps JOIN stock_lots sl ON sl.lot_id=ps.lot_id
        WHERE ps.product_id=? AND sl.source_type='PURCHASE' AND sl.source_ref=? AND ps.status='In Stock' ORDER BY ps.created_at`).bind(raw.productId, purchaseId).all<any>();
      availableSerials = (sr.results || []).map((r:any)=>String(r.serialNumber));
      availableQty = Math.min(availableQty, availableSerials.length);
    } else if (Number(product?.trackExpiry || 0)) {
      const er = await db.prepare(`SELECT COALESCE(SUM(eb.remaining_quantity),0) qty FROM stock_expiry_batches eb JOIN stock_lots sl ON sl.lot_id=eb.lot_id
        WHERE eb.product_id=? AND sl.source_type='PURCHASE' AND sl.source_ref=? AND eb.remaining_quantity>0`).bind(raw.productId,purchaseId).first<any>();
      availableQty = Math.min(availableQty, Number(er?.qty || 0));
    }
    items.push({ ...raw, ...product, availableQty, availableSerials });
  }
  const prev = items.reduce((sum: number, r: any) => sum + qty(r.previouslyReturnedQty) * money(r.unitPrice), 0);
  return json({ ok: true, purchase: { ...purchase, previouslyReturnedAmount: prev, netPurchase: money(purchase.grandTotal) - prev, items } });
}

async function reducePurchaseLots(db: SherDatabase, purchaseId: string, productId: string, amount: number): Promise<Array<{ lotId: string; qty: number }>> {
  let remaining = amount;
  const reduced: Array<{ lotId: string; qty: number }> = [];
  const lots = await db.prepare(`SELECT lot_id AS lotId, remaining_quantity AS remainingQuantity FROM stock_lots WHERE source_type='PURCHASE' AND source_ref=? AND product_id=? AND remaining_quantity > 0 ORDER BY created_at ASC, id ASC`).bind(purchaseId, productId).all();
  for (const lot of (lots.results ?? []) as Array<Record<string, unknown>>) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, qty(lot.remainingQuantity));
    if (take <= 0) continue;
    remaining = Math.round((remaining - take) * 10000) / 10000;
    reduced.push({ lotId: String(lot.lotId), qty: take });
  }
  if (remaining > 0) throw new Error('Not enough unsold stock remains in the selected purchase lots.');
  return reduced;
}


async function reduceTrackedPurchaseLots(db: SherDatabase, purchaseId: string, productId: string, amount: number, serialNumbersRaw: unknown): Promise<{ reductions: Array<{lotId:string;qty:number}>; serials: Array<{serialId:string;serialNumber:string;lotId:string;expiryBatchId:string}>; batches: Array<{expiryBatchId:string;lotId:string;qty:number}> }> {
  const product = await db.prepare(`SELECT product_name, track_serial AS trackSerial, track_expiry AS trackExpiry FROM products WHERE product_id=?`).bind(productId).first<any>();
  if (!product) throw new Error('Product not found.');
  const reductions = new Map<string,number>();
  const serials: Array<{serialId:string;serialNumber:string;lotId:string;expiryBatchId:string}> = [];
  const batches: Array<{expiryBatchId:string;lotId:string;qty:number}> = [];
  if (Number(product.trackSerial || 0)) {
    const selected = Array.from(new Set((Array.isArray(serialNumbersRaw) ? serialNumbersRaw : []).map((x:any)=>cleanText(x)).filter(Boolean)));
    if (selected.length !== Math.round(amount)) throw new Error(`${product.product_name}: select exactly ${Math.round(amount)} Serial / IMEI number(s) to return.`);
    for (const serialNumber of selected) {
      const row = await db.prepare(`SELECT ps.serial_id AS serialId, ps.serial_number AS serialNumber, ps.lot_id AS lotId, COALESCE(ps.expiry_batch_id,'') AS expiryBatchId
        FROM product_serials ps JOIN stock_lots sl ON sl.lot_id=ps.lot_id
        WHERE ps.product_id=? AND ps.serial_number=? COLLATE NOCASE AND ps.status='In Stock' AND sl.source_type='PURCHASE' AND sl.source_ref=? LIMIT 1`)
        .bind(productId, serialNumber, purchaseId).first<any>();
      if (!row) throw new Error(`${product.product_name}: Serial / IMEI ${serialNumber} is not available from this purchase.`);
      serials.push(row); reductions.set(row.lotId,(reductions.get(row.lotId)||0)+1);
      if (row.expiryBatchId) batches.push({expiryBatchId:row.expiryBatchId,lotId:row.lotId,qty:1});
    }
  } else {
    let need=amount;
    const rows=await db.prepare(`SELECT eb.expiry_batch_id AS expiryBatchId, eb.lot_id AS lotId, eb.remaining_quantity AS remainingQuantity
      FROM stock_expiry_batches eb JOIN stock_lots sl ON sl.lot_id=eb.lot_id
      WHERE eb.product_id=? AND sl.source_type='PURCHASE' AND sl.source_ref=? AND eb.remaining_quantity>0
      ORDER BY eb.expiry_date ASC, eb.created_at ASC`).bind(productId,purchaseId).all<any>();
    for(const row of rows.results||[]){if(need<=0)break;const take=Math.min(need,Number(row.remainingQuantity||0));if(take>0){batches.push({expiryBatchId:row.expiryBatchId,lotId:row.lotId,qty:take});reductions.set(row.lotId,(reductions.get(row.lotId)||0)+take);need-=take;}}
    if(need>0) throw new Error(`${product.product_name}: only ${amount-need} fully tracked item(s) from this purchase can be returned. Complete pending tracking first.`);
  }
  return { reductions:[...reductions].map(([lotId,qty])=>({lotId,qty})), serials, batches };
}

export async function completePurchaseReturnRoute(db: SherDatabase, input: PurchaseReturnInput, user: AuthUser): Promise<Response> {
  const purchaseId = cleanText(input.purchaseId);
  if (!purchaseId) return error('No purchase selected.');
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length === 0) return error('Select at least one product to return.');
  const refundMethod = cleanText(input.refundMethod || 'Supplier Credit');
  if (refundMethod !== 'Cash' && refundMethod !== 'Supplier Credit') return error('Choose a refund method.');
  const reason = cleanText(input.reason);
  if (!reason) return error('Enter a return reason.');
  const returnDate = cleanText(input.date) || new Date().toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (returnDate < today && !cleanText(input.backdatedReason)) return error('Reason for backdating is required.');
  const purchase = await db.prepare(`SELECT * FROM purchases WHERE purchase_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(purchaseId).first<Record<string, unknown>>();
  if (!purchase) return error('Purchase not found.');
  if(await hasMixedUnitPurchase(db,purchaseId))
    return completeMixedPurchaseReturn(db,input,user);
  const availableResp = await getPurchaseForReturn(db, purchaseId);
  const availableData = await availableResp.clone().json() as any;
  if (!availableData.ok) return availableResp;
  const available = new Map((availableData.purchase.items as any[]).map((i) => [String(i.productId), i]));
  const returnId = await nextPurchaseReturnId(db);
  const batch: SqlPreparedStatement[] = [];
  let totalReturnAmount = 0;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const productId = cleanText(item.productId);
    const quantity = qty(item.qty ?? item.quantity);
    const price = money(item.unitPrice ?? item.returnPrice);
    if (!productId || quantity <= 0) return error(`Line ${i + 1}: return quantity must be greater than zero.`);
    const av: any = available.get(productId);
    if (!av) return error(`Line ${i + 1}: product was not part of this purchase.`);
    if (quantity > qty(av.availableQty)) return error(`${av.productName}: only ${av.availableQty} available to return.`);
    const product = await db.prepare(`SELECT current_stock, product_name FROM products WHERE product_id=?`).bind(productId).first<{ current_stock: number; product_name: string }>();
    const newStock = Math.round((Number(product?.current_stock || 0) - quantity) * 10000) / 10000;
    if (newStock < 0) return error(`${product?.product_name || av.productName}: only ${product?.current_stock || 0} in stock — cannot return more than on hand.`);
    const trackingProduct = await db.prepare(`SELECT track_serial AS trackSerial, track_expiry AS trackExpiry FROM products WHERE product_id=?`).bind(productId).first<any>();
    if (Number(trackingProduct?.trackSerial || 0) || Number(trackingProduct?.trackExpiry || 0)) {
      let tracked;
      try { tracked = await reduceTrackedPurchaseLots(db, purchaseId, productId, quantity, item.serialNumbers); }
      catch (err) { return error(err instanceof Error ? err.message : 'Tracked purchase return failed.'); }
      for (const r of tracked.reductions) {
        batch.push(db.prepare(`UPDATE stock_lots SET remaining_quantity=remaining_quantity-?, updated_at=datetime('now'), status=CASE WHEN remaining_quantity-?>0 THEN 'Active' ELSE 'Depleted' END WHERE lot_id=?`).bind(r.qty,r.qty,r.lotId));
        batch.push(db.prepare(`INSERT INTO stock_movements (movement_id, product_id, movement_type, quantity_in, quantity_out, balance_after, lot_id, note, created_at)
          VALUES (?, ?, 'Purchase Return', 0, ?, ?, ?, ?, datetime('now'))`).bind(crypto.randomUUID(), productId, r.qty, newStock, r.lotId, returnId));
      }
      for (const b of tracked.batches) batch.push(db.prepare(`UPDATE stock_expiry_batches SET remaining_quantity=remaining_quantity-?, updated_at=datetime('now') WHERE expiry_batch_id=?`).bind(b.qty,b.expiryBatchId));
      for (const serial of tracked.serials) batch.push(db.prepare(`UPDATE product_serials SET status='Returned to Supplier', updated_at=datetime('now') WHERE serial_id=?`).bind(serial.serialId));
    } else {
      const reductions = await reducePurchaseLots(db, purchaseId, productId, quantity);
      for (const r of reductions) {
        batch.push(db.prepare(`UPDATE stock_lots SET remaining_quantity = remaining_quantity - ? WHERE lot_id=?`).bind(r.qty, r.lotId));
        batch.push(db.prepare(`INSERT INTO stock_movements (movement_id, product_id, movement_type, quantity_in, quantity_out, balance_after, lot_id, note, created_at)
          VALUES (?, ?, 'Purchase Return', 0, ?, ?, ?, ?, datetime('now'))`).bind(crypto.randomUUID(), productId, r.qty, newStock, r.lotId, returnId));
      }
    }
    batch.push(db.prepare(`UPDATE products SET current_stock=?, updated_at=datetime('now') WHERE product_id=?`).bind(newStock, productId));
    const lineTotal = Math.round(quantity * price * 10000) / 10000;
    totalReturnAmount += lineTotal;
    batch.push(db.prepare(`INSERT INTO purchase_return_items (return_id, purchase_id, product_id, product_name, return_quantity, return_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(returnId, purchaseId, productId, String(av.productName), quantity, price, lineTotal));
  }
  totalReturnAmount = Math.round(totalReturnAmount * 10000) / 10000;
  batch.push(db.prepare(`INSERT INTO purchase_returns (return_id, return_date, purchase_id, supplier_id, supplier_name, total_return_amount, refund_method, reason, notes, processed_by, is_backdated, backdated_reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`).bind(returnId, returnDate, purchaseId, String(purchase.supplier_id || ''), String(purchase.supplier_name || ''), totalReturnAmount, refundMethod, reason, cleanText(input.notes), user.userId, returnDate < today ? 1 : 0, cleanText(input.backdatedReason)));
  batch.push(db.prepare(`UPDATE purchases SET returned_amount = COALESCE(returned_amount,0) + ?, updated_at=datetime('now') WHERE purchase_id=?`).bind(totalReturnAmount, purchaseId));
  if (refundMethod === 'Supplier Credit') {
    batch.push(db.prepare(`UPDATE suppliers SET current_due = current_due - ?, updated_at=datetime('now') WHERE supplier_id=?`).bind(totalReturnAmount, String(purchase.supplier_id || '')));
    batch.push(db.prepare(`INSERT INTO supplier_ledger (ledger_id, date, supplier_id, supplier_name, type, reference, debit, credit, balance, notes, created_by, created_at)
      VALUES (?, ?, ?, ?, 'Purchase Return Credit', ?, 0, ?, (SELECT current_due - ? FROM suppliers WHERE supplier_id=?), ?, ?, datetime('now'))`)
      .bind(crypto.randomUUID(), returnDate, String(purchase.supplier_id || ''), String(purchase.supplier_name || ''), returnId, totalReturnAmount, totalReturnAmount, String(purchase.supplier_id || ''), reason, user.userId));
  }
  batch.push(db.prepare(`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, note) VALUES (?, 'PURCHASE_RETURN', 'PURCHASE_RETURN', ?, ?)`)
    .bind(user.userId, returnId, reason));
  await db.batch(batch);
  return json({ ok: true, returnId, totalReturnAmount });
}

export async function getPurchaseReturnHistory(db: SherDatabase): Promise<Response> {
  const rows = await db.prepare(`SELECT return_id AS returnId, return_date AS returnDate, purchase_id AS purchaseId, supplier_name AS supplierName, total_return_amount AS totalReturnAmount, refund_method AS refundMethod, reason, notes, created_at AS createdAt FROM purchase_returns WHERE COALESCE(is_deleted,0)=0 ORDER BY return_date DESC, created_at DESC LIMIT 200`).all();
  return json({ ok: true, returns: rows.results ?? [] });
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

async function hasActiveCashSession(db: SherDatabase): Promise<boolean> {
  const row = await db.prepare(`SELECT session_id FROM cash_sessions WHERE status='Open' ORDER BY opened_at DESC LIMIT 1`).first<{ session_id: string }>();
  return !!row;
}

export async function getSuppliersPageRoute(db: SherDatabase): Promise<Response> {
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

export async function updateSupplierRoute(db: SherDatabase, supplierId: string, input: { name?: string; phone?: string; address?: string; notes?: string }): Promise<Response> {
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

export async function getSupplierDetailRoute(db: SherDatabase, supplierId: string, url: URL): Promise<Response> {
  const supplier = await db.prepare(`SELECT * FROM suppliers WHERE supplier_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(supplierId).first<Record<string, unknown>>();
  if (!supplier) return error('Supplier not found.', 404);
  const history=parseLedgerHistory(url);
  const dateWhere=ledgerDateWhere('date',history);
  const rangeSql=`supplier_id=? AND COALESCE(is_deleted,0)=0 AND ${dateWhere.sql}`;
  const [rowsResult,rangeAgg,openingRow,printHeader]=await Promise.all([
    db.prepare(`
      WITH ordered AS (
        SELECT ledger_id AS ledgerId,date,supplier_id AS supplierId,supplier_name AS supplierName,type,reference,debit,credit,
               SUM(COALESCE(debit,0)-COALESCE(credit,0)) OVER (ORDER BY date ASC,created_at ASC,ledger_id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance,
               notes,payment_method AS paymentMethod,bank_account_id AS bankAccountId,created_at AS createdAt
        FROM supplier_ledger
        WHERE supplier_id=? AND COALESCE(is_deleted,0)=0
      )
      SELECT * FROM ordered
      WHERE date<=? AND (?='' OR date>=?)
      ORDER BY date DESC,createdAt DESC,ledgerId DESC
      LIMIT ?
    `).bind(supplierId,history.to,history.from,history.from,history.limit).all<any>(),
    db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(debit),0) AS debit,COALESCE(SUM(credit),0) AS credit FROM supplier_ledger WHERE ${rangeSql}`)
      .bind(supplierId,...dateWhere.values).first<any>(),
    history.from
      ? db.prepare(`SELECT COALESCE(SUM(debit-credit),0) AS balance FROM supplier_ledger WHERE supplier_id=? AND COALESCE(is_deleted,0)=0 AND date<?`).bind(supplierId,history.from).first<any>()
      : Promise.resolve({balance:0}),
    getLedgerPrintHeader(db)
  ]);
  const ledger=(rowsResult.results||[]).map((r:any)=>({...r,debit:Number(r.debit||0),credit:Number(r.credit||0),balance:Number(r.balance||0)}));
  const matchingCount=Number(rangeAgg?.count||0),rangeOpeningBalance=Number(openingRow?.balance||0);
  const rangeDebit=Number(rangeAgg?.debit||0),rangeCredit=Number(rangeAgg?.credit||0),rangeClosingBalance=rangeOpeningBalance+rangeDebit-rangeCredit;
  const earliest=ledger.length?ledger[ledger.length-1]:null,latest=ledger.length?ledger[0]:null;
  const displayedOpeningBalance=earliest?Number(earliest.balance||0)-Number(earliest.debit||0)+Number(earliest.credit||0):rangeOpeningBalance;
  const displayedClosingBalance=latest?Number(latest.balance||0):rangeOpeningBalance;
  const totalDebit=ledger.reduce((sum:number,row:any)=>sum+Number(row.debit||0),0),totalCredit=ledger.reduce((sum:number,row:any)=>sum+Number(row.credit||0),0);
  return json({ok:true,supplier:supplierPublic(supplier),ledger,history:ledgerHistoryMeta(history,matchingCount,ledger.length),summary:{rangeOpeningBalance,rangeClosingBalance,displayedOpeningBalance,displayedClosingBalance,totalDebit,totalCredit},printHeader});
}

export async function setSupplierStatusRoute(db: SherDatabase, supplierId: string, status: string): Promise<Response> {
  const next = status === 'Active' ? 'Active' : 'Inactive';
  const result = await db.prepare(`UPDATE suppliers SET status=?, updated_at=datetime('now') WHERE supplier_id=? AND COALESCE(is_deleted,0)=0`).bind(next, supplierId).run();
  if (!result.meta.changes) return error('Supplier not found.', 404);
  return json({ ok: true, id: supplierId, status: next });
}

export async function deleteSupplierRoute(db: SherDatabase, supplierId: string, reasonRaw: string, user: AuthUser): Promise<Response> {
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

function methodNeedsBank(method: string): boolean {
  return method === 'Bank' || method === 'Mobile Banking';
}

async function validateBankAccount(db: SherDatabase, method: string, bankAccountIdRaw?: string): Promise<string> {
  if (!methodNeedsBank(method)) return '';
  const bankAccountId = cleanText(bankAccountIdRaw);
  if (!bankAccountId) throw new Error(method === 'Mobile Banking' ? 'Mobile Banking account is required.' : 'Bank account is required.');
  const row = await db.prepare(`SELECT bank_account_id FROM bank_accounts WHERE bank_account_id=? AND status='Active' LIMIT 1`).bind(bankAccountId).first();
  if (!row) throw new Error('Bank account not found.');
  return bankAccountId;
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

export async function paySupplierRoute(db: SherDatabase, supplierId: string, input: { amount?: number; method?: string; bankAccountId?: string; notes?: string; date?: string; backdatedReason?: string }, user: AuthUser): Promise<Response> {
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

export async function getSupplierPaymentRoute(db: SherDatabase, ledgerId: string): Promise<Response> {
  const row = await db.prepare(`SELECT ledger_id AS ledgerId, supplier_id AS supplierId, supplier_name AS supplierName, date, credit AS amount, payment_method AS method, bank_account_id AS bankAccountId, notes, type FROM supplier_ledger WHERE ledger_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(ledgerId).first<Record<string, unknown>>();
  if (!row) return error('Payment not found.', 404);
  if (String(row.type) !== 'Payment') return error('Only payment rows can be edited here.');
  const { type: _type, ...payment } = row;
  return json({ ok: true, payment });
}

export async function updateSupplierPaymentRoute(db: SherDatabase, ledgerId: string, input: { amount?: number; method?: string; bankAccountId?: string; notes?: string; date?: string }, user: AuthUser): Promise<Response> {
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

export async function deleteSupplierPaymentRoute(db: SherDatabase, ledgerId: string, reasonRaw: string, user: AuthUser): Promise<Response> {
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
