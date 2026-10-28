import type { SherDatabase, SqlPreparedStatement } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
import type { ProductRow } from './types.js';
import type { LotTrackingInput } from './tracking.types.js';
import { prepareNewLotTracking, trackingEnabled } from './tracking.service.js';

const headers = { 'content-type': 'application/json; charset=utf-8' };
function json(data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status, headers }); }
function error(message: string, status = 400): Response { return json({ ok: false, error: message }, status); }
function cleanText(value: unknown): string { return String(value ?? '').trim(); }
function round(value: unknown): number { const n = Number(value ?? 0); return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0; }
function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function isIsoDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)); }
function id(prefix: string): string { return `${prefix}-${crypto.randomUUID().slice(0, 12).toUpperCase()}`; }

async function nextRmaNo(db: SherDatabase): Promise<string> {
  const row = await db.prepare(`SELECT rma_no AS rmaNo FROM supplier_warranty_rmas WHERE rma_no LIKE 'RMA-%' ORDER BY CAST(SUBSTR(rma_no,5) AS INTEGER) DESC LIMIT 1`).first<any>();
  const last = row?.rmaNo ? Number(String(row.rmaNo).slice(4)) : 0;
  return `RMA-${String(last + 1).padStart(6, '0')}`;
}

function audit(db: SherDatabase, user: AuthUser, action: string, entityId: string, note: string): SqlPreparedStatement {
  return db.prepare(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) VALUES (?,?,?,?,?)`)
    .bind(user.userId, action, 'SUPPLIER_WARRANTY_RMA', entityId, note);
}

function serialsFromTracking(product: ProductRow, tracking?: LotTrackingInput): string[] {
  if (!Number(product.track_serial || 0)) return [];
  const raw = Number(product.track_expiry || 0)
    ? (tracking?.expiryBatches || []).flatMap((b) => Array.isArray(b.serialNumbers) ? b.serialNumbers : [])
    : (Array.isArray(tracking?.serialNumbers) ? tracking!.serialNumbers! : []);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const text = cleanText(value);
    const key = text.toLocaleLowerCase();
    if (text && !seen.has(key)) { seen.add(key); out.push(text); }
  }
  return out;
}

export type SupplierWarrantyReceivedInput = {
  productId?: string;
  quantity?: number;
  unitValue?: number;
  tracking?: LotTrackingInput;
};

export type SupplierWarrantyResolveInput = {
  resolvedDate?: string;
  resolutionType?: 'Same Item Returned' | 'Replacement Same Product' | 'Settlement' | 'Warranty Rejected';
  directToCustomer?: boolean;
  receivedItems?: SupplierWarrantyReceivedInput[];
  supplierCreditAmount?: number;
  additionalPayableAmount?: number;
  cashRefundAmount?: number;
  refundMethod?: 'Cash' | 'Bank' | 'Mobile Banking';
  bankAccountId?: string;
  resolutionNote?: string;
};

export async function getSupplierWarrantyOverviewRoute(db: SherDatabase): Promise<Response> {
  const [rmas, received, financials, suppliers, banks, products] = await Promise.all([
    db.prepare(`SELECT r.rma_id AS rmaId,r.rma_no AS rmaNo,r.supplier_id AS supplierId,r.supplier_name AS supplierName,
      COALESCE(r.claim_id,'') AS claimId,COALESCE(r.warranty_id,'') AS warrantyId,r.product_id AS productId,r.product_name AS productName,
      COALESCE(r.serial_number,'') AS serialNumber,r.quantity,r.customer_handling AS customerHandling,r.sent_date AS sentDate,
      r.supplier_reference AS supplierReference,r.status,r.notes,r.resolution_type AS resolutionType,COALESCE(r.resolved_date,'') AS resolvedDate,
      r.resolution_note AS resolutionNote,r.created_by AS createdBy,r.resolved_by AS resolvedBy,r.created_at AS createdAt,
      wr.customer_name AS customerName,wr.customer_phone AS customerPhone,wr.invoice_id AS invoiceId
      FROM supplier_warranty_rmas r LEFT JOIN warranty_records wr ON wr.warranty_id=r.warranty_id
      ORDER BY CASE r.status WHEN 'At Supplier' THEN 0 ELSE 1 END,r.sent_date DESC,r.created_at DESC LIMIT 1000`).all<any>(),
    db.prepare(`SELECT received_item_id AS receivedItemId,rma_id AS rmaId,product_id AS productId,product_name AS productName,
      quantity,unit_value AS unitValue,destination,lot_id AS lotId,tracking_status AS trackingStatus,created_at AS createdAt
      FROM supplier_warranty_rma_received_items ORDER BY created_at`).all<any>(),
    db.prepare(`SELECT financial_id AS financialId,rma_id AS rmaId,financial_type AS financialType,amount,payment_method AS paymentMethod,
      bank_account_id AS bankAccountId,supplier_ledger_id AS supplierLedgerId,created_at AS createdAt
      FROM supplier_warranty_rma_financials ORDER BY created_at`).all<any>(),
    db.prepare(`SELECT supplier_id AS id,supplier_name AS name,current_due AS currentDue FROM suppliers WHERE status='Active' AND COALESCE(is_deleted,0)=0 ORDER BY supplier_name COLLATE NOCASE`).all<any>(),
    db.prepare(`SELECT bank_account_id AS id,account_name AS name,account_type AS type,current_balance AS currentBalance FROM bank_accounts WHERE status='Active' ORDER BY account_name COLLATE NOCASE`).all<any>(),
    db.prepare(`SELECT product_id AS productId,product_name AS productName,COALESCE(brand,'') AS brand,category,unit,COALESCE(barcode,'') AS barcode,
      purchase_price AS purchasePrice,selling_price AS sellingPrice,current_stock AS currentStock,minimum_stock AS minimumStock,status,
      COALESCE(preferred_supplier_id,'') AS preferredSupplierId,track_serial AS trackSerial,track_expiry AS trackExpiry,track_warranty AS trackWarranty,
      warranty_period_value AS warrantyPeriodValue,warranty_period_unit AS warrantyPeriodUnit
      FROM products WHERE is_deleted=0 AND status<>'Inactive' ORDER BY product_name COLLATE NOCASE`).all<any>()
  ]);
  const receivedByRma = new Map<string, any[]>();
  for (const row of received.results || []) { const key = String(row.rmaId); const list = receivedByRma.get(key) || []; list.push(row); receivedByRma.set(key, list); }
  const financialByRma = new Map<string, any[]>();
  for (const row of financials.results || []) { const key = String(row.rmaId); const list = financialByRma.get(key) || []; list.push(row); financialByRma.set(key, list); }
  return json({ ok: true,
    rmas: (rmas.results || []).map((row: any) => ({ ...row, receivedItems: receivedByRma.get(String(row.rmaId)) || [], financials: financialByRma.get(String(row.rmaId)) || [] })),
    suppliers: suppliers.results || [], bankAccounts: banks.results || [], products: products.results || []
  });
}

export async function createSupplierWarrantyRmaRoute(
  db: SherDatabase,
  input: { claimId?: string; supplierId?: string; sentDate?: string; supplierReference?: string; customerHandling?: string; notes?: string },
  user: AuthUser
): Promise<Response> {
  const claimId = cleanText(input.claimId);
  const supplierId = cleanText(input.supplierId);
  const sentDate = cleanText(input.sentDate) || todayIso();
  const customerHandling = cleanText(input.customerHandling) || 'Waiting for Supplier';
  if (!claimId) return error('Choose a warranty claim.');
  if (!supplierId) return error('Choose the supplier receiving this warranty item.');
  if (!isIsoDate(sentDate)) return error('Enter a valid sent date.');
  if (!['Waiting for Supplier','Already Replaced from Our Stock'].includes(customerHandling)) return error('Choose how the customer warranty is being handled.');

  const supplier = await db.prepare(`SELECT supplier_id AS supplierId,supplier_name AS supplierName FROM suppliers WHERE supplier_id=? AND status='Active' AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(supplierId).first<any>();
  if (!supplier) return error('Supplier not found.', 404);
  const claim = await db.prepare(`SELECT wc.claim_id AS claimId,wc.warranty_id AS warrantyId,wc.status AS claimStatus,wc.issue,
      wr.invoice_id AS invoiceId,wr.product_id AS productId,wr.product_name AS productName,wr.customer_name AS customerName,
      COALESCE(rep.original_serial_id,wr.serial_id) AS sourceSerialId,COALESCE(rep.original_serial_number,wr.serial_number,'') AS sourceSerialNumber,
      CASE WHEN rep.replacement_id IS NULL THEN 0 ELSE 1 END AS hasOwnReplacement
    FROM warranty_claims wc JOIN warranty_records wr ON wr.warranty_id=wc.warranty_id
    LEFT JOIN warranty_replacements rep ON rep.claim_id=wc.claim_id
    WHERE wc.claim_id=? LIMIT 1`).bind(claimId).first<any>();
  if (!claim) return error('Warranty claim not found.', 404);
  const existing = await db.prepare(`SELECT rma_no AS rmaNo FROM supplier_warranty_rmas WHERE claim_id=? AND status='At Supplier' LIMIT 1`).bind(claimId).first<any>();
  if (existing) return error(`This claim is already at supplier under ${existing.rmaNo}.`);

  const expectedHandling = Number(claim.hasOwnReplacement || 0) ? 'Already Replaced from Our Stock' : 'Waiting for Supplier';
  if (customerHandling !== expectedHandling) return error(`Customer handling must be "${expectedHandling}" for the current claim state.`);

  let serial: any = null;
  let stockWasOnHand = 0;
  let currentStock = 0;
  if (cleanText(claim.sourceSerialId)) {
    serial = await db.prepare(`SELECT ps.serial_id AS serialId,ps.serial_number AS serialNumber,ps.status,ps.lot_id AS lotId,
        sl.remaining_quantity AS lotRemaining,p.current_stock AS currentStock
      FROM product_serials ps JOIN stock_lots sl ON sl.lot_id=ps.lot_id JOIN products p ON p.product_id=ps.product_id
      WHERE ps.serial_id=? LIMIT 1`).bind(claim.sourceSerialId).first<any>();
    if (!serial) return error('Warranty Serial / IMEI record not found.', 404);
    const expectedStatus = expectedHandling === 'Already Replaced from Our Stock' ? 'Warranty Hold' : 'Sold';
    if (String(serial.status) !== expectedStatus) return error(`Defective Serial / IMEI is ${serial.status}; expected ${expectedStatus}.`);
    stockWasOnHand = expectedStatus === 'Warranty Hold' ? 1 : 0;
    currentStock = Number(serial.currentStock || 0);
    if (stockWasOnHand && (currentStock < 1 || Number(serial.lotRemaining || 0) < 1)) return error('Defective warranty stock is no longer available to send to supplier.');
  } else if (expectedHandling === 'Already Replaced from Our Stock') {
    return error('Automatic supplier send after an own-stock replacement currently requires a serialized/IMEI warranty item.');
  }

  const rmaId = id('SRMA');
  const rmaNo = await nextRmaNo(db);
  const statements: SqlPreparedStatement[] = [
    db.prepare(`INSERT INTO supplier_warranty_rmas(rma_id,rma_no,supplier_id,supplier_name,claim_id,warranty_id,product_id,product_name,serial_id,serial_number,quantity,customer_handling,sent_date,supplier_reference,status,stock_was_on_hand,notes,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'At Supplier',?,?,?)`).bind(rmaId,rmaNo,supplier.supplierId,supplier.supplierName,claim.claimId,claim.warrantyId,claim.productId,claim.productName,claim.sourceSerialId || null,claim.sourceSerialNumber || '',1,customerHandling,sentDate,cleanText(input.supplierReference),stockWasOnHand,cleanText(input.notes),user.fullName),
    audit(db,user,'SEND_SUPPLIER_WARRANTY',rmaId,`${rmaNo}; ${claim.productName}; ${claim.sourceSerialNumber || 'non-serialized'}; ${supplier.supplierName}`)
  ];
  if (serial) statements.unshift(db.prepare(`UPDATE product_serials SET status='Warranty at Supplier',updated_at=datetime('now') WHERE serial_id=?`).bind(serial.serialId));
  if (serial && stockWasOnHand) {
    const nextStock = round(currentStock - 1);
    const nextLot = round(Number(serial.lotRemaining || 0) - 1);
    statements.unshift(
      db.prepare(`UPDATE products SET current_stock=?,updated_at=datetime('now') WHERE product_id=?`).bind(nextStock,claim.productId),
      db.prepare(`UPDATE stock_lots SET remaining_quantity=?,status=CASE WHEN ?>0 THEN 'Active' ELSE 'Depleted' END,updated_at=datetime('now') WHERE lot_id=?`).bind(nextLot,nextLot,serial.lotId),
      db.prepare(`INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,lot_id,note,created_at)
        VALUES (?,?,'Warranty Send to Supplier',0,1,?,?,?,?)`).bind(id('SM'),claim.productId,nextStock,serial.lotId,`${rmaNo}; ${serial.serialNumber}; ${supplier.supplierName}`,sentDate)
    );
  }
  await db.batch(statements);
  return json({ ok: true, rmaId, rmaNo });
}

async function restoreWarrantyStateStatements(db: SherDatabase, claim: any, status: 'Resolved' | 'Rejected', note: string): Promise<SqlPreparedStatement[]> {
  const claimId = cleanText(claim?.claimId ?? claim?.claim_id);
  const warrantyId = cleanText(claim?.warrantyId ?? claim?.warranty_id);
  if (!claimId || String(claim?.claimStatus || '') !== 'Open') return [];
  const warrantyStatus = String(claim?.warrantyEndDate || claim?.warranty_end_date || '') < todayIso() ? 'Expired' : 'Active';
  return [
    db.prepare(`UPDATE warranty_claims SET status=?,resolution=?,updated_at=datetime('now') WHERE claim_id=?`).bind(status,note,claimId),
    db.prepare(`UPDATE warranty_records SET status=?,updated_at=datetime('now') WHERE warranty_id=? AND status<>'Voided'`).bind(warrantyStatus,warrantyId)
  ];
}

export async function resolveSupplierWarrantyRmaRoute(db: SherDatabase, rmaId: string, input: SupplierWarrantyResolveInput, user: AuthUser): Promise<Response> {
  const resolvedDate = cleanText(input.resolvedDate) || todayIso();
  const resolutionType = cleanText(input.resolutionType) as SupplierWarrantyResolveInput['resolutionType'];
  const resolutionNote = cleanText(input.resolutionNote);
  if (!isIsoDate(resolvedDate)) return error('Enter a valid resolution date.');
  if (!['Same Item Returned','Replacement Same Product','Settlement','Warranty Rejected'].includes(String(resolutionType))) return error('Choose a supplier warranty resolution.');
  if (!resolutionNote) return error('Resolution note is required.');

  const rma = await db.prepare(`SELECT r.*,wc.status AS claimStatus,wr.invoice_id AS invoiceId,wr.warranty_end_date AS warrantyEndDate,
      wr.status AS warrantyStatus,wr.serial_id AS warrantySerialId,wr.serial_number AS warrantySerialNumber
    FROM supplier_warranty_rmas r LEFT JOIN warranty_claims wc ON wc.claim_id=r.claim_id LEFT JOIN warranty_records wr ON wr.warranty_id=r.warranty_id
    WHERE r.rma_id=? LIMIT 1`).bind(rmaId).first<any>();
  if (!rma) return error('Supplier warranty RMA not found.', 404);
  if (String(rma.status) !== 'At Supplier') return error('Only an RMA currently at supplier can be resolved.');
  if (resolvedDate < String(rma.sent_date || '')) return error('Resolution date cannot be before the sent date.');

  const supplier = await db.prepare(`SELECT supplier_name AS supplierName,current_due AS currentDue FROM suppliers WHERE supplier_id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`).bind(rma.supplier_id).first<any>();
  if (!supplier) return error('Supplier no longer exists.', 404);

  const receivedInputs = Array.isArray(input.receivedItems) ? input.receivedItems.filter((x) => cleanText(x?.productId) && round(x?.quantity) > 0) : [];
  if (resolutionType === 'Replacement Same Product') {
    if (receivedInputs.length !== 1 || cleanText(receivedInputs[0].productId) !== String(rma.product_id) || round(receivedInputs[0].quantity) !== 1) {
      return error('Same-product replacement must contain exactly 1 unit of the original product.');
    }
  }

  if (resolutionType === 'Settlement' && receivedInputs.length === 0 && Math.max(0, round(input.supplierCreditAmount)) <= 0 && Math.max(0, round(input.additionalPayableAmount)) <= 0 && Math.max(0, round(input.cashRefundAmount)) <= 0) {
    return error('Add a received product or financial settlement before resolving this RMA.');
  }

  const supplierCredit = Math.max(0, round(input.supplierCreditAmount));
  const additionalPayable = Math.max(0, round(input.additionalPayableAmount));
  const cashRefund = Math.max(0, round(input.cashRefundAmount));
  const refundMethod = cleanText(input.refundMethod) || 'Cash';
  const bankAccountId = cleanText(input.bankAccountId);
  if (cashRefund > 0 && !['Cash','Bank','Mobile Banking'].includes(refundMethod)) return error('Choose Cash, Bank, or Mobile Banking for the supplier refund.');
  let refundBank: any = null;
  if (cashRefund > 0 && refundMethod !== 'Cash') {
    if (!bankAccountId) return error('Choose the bank/mobile account receiving the warranty refund.');
    refundBank = await db.prepare(`SELECT bank_account_id AS id,account_name AS name,current_balance AS currentBalance FROM bank_accounts WHERE bank_account_id=? AND status='Active' LIMIT 1`).bind(bankAccountId).first<any>();
    if (!refundBank) return error('Selected bank account was not found.');
  }

  const statements: SqlPreparedStatement[] = [];
  const currentStockByProduct = new Map<string, number>();
  async function stockNow(productId: string): Promise<number> {
    if (currentStockByProduct.has(productId)) return currentStockByProduct.get(productId)!;
    const row = await db.prepare(`SELECT current_stock AS currentStock FROM products WHERE product_id=? AND is_deleted=0 LIMIT 1`).bind(productId).first<any>();
    if (!row) throw new Error('Received product no longer exists.');
    const value = Number(row.currentStock || 0); currentStockByProduct.set(productId, value); return value;
  }
  function setStock(productId: string, value: number) { currentStockByProduct.set(productId, round(value)); }

  const originalSerial = cleanText(rma.serial_id) ? await db.prepare(`SELECT ps.serial_id AS serialId,ps.serial_number AS serialNumber,ps.status,ps.lot_id AS lotId,
      sl.original_quantity AS lotOriginal,sl.remaining_quantity AS lotRemaining
    FROM product_serials ps JOIN stock_lots sl ON sl.lot_id=ps.lot_id WHERE ps.serial_id=? LIMIT 1`).bind(rma.serial_id).first<any>() : null;
  if (originalSerial && String(originalSerial.status) !== 'Warranty at Supplier') return error(`Defective Serial / IMEI is ${originalSerial.status}, not at supplier.`);

  const customerWaiting = String(rma.customer_handling) === 'Waiting for Supplier';
  const directToCustomer = Boolean(input.directToCustomer) && customerWaiting && resolutionType === 'Replacement Same Product';
  if (customerWaiting && resolutionType === 'Replacement Same Product' && !directToCustomer) {
    return error('Customer is still waiting. Send the supplier replacement directly to the customer, or replace the customer from your own stock first.');
  }
  if (customerWaiting && resolutionType === 'Settlement') {
    return error('Customer is still waiting. Replace the customer from your own stock first, then resolve the supplier RMA settlement.');
  }

  if (resolutionType === 'Same Item Returned') {
    if (originalSerial) {
      if (customerWaiting) {
        statements.push(db.prepare(`UPDATE product_serials SET status='Sold',sale_invoice_id=?,sold_at=COALESCE(sold_at,?),updated_at=datetime('now') WHERE serial_id=?`).bind(rma.invoiceId || '',resolvedDate,originalSerial.serialId));
      } else {
        const physical = await stockNow(String(rma.product_id));
        const next = round(physical + 1); setStock(String(rma.product_id), next);
        const lotNext = Math.min(Number(originalSerial.lotOriginal || 0), round(Number(originalSerial.lotRemaining || 0) + 1));
        statements.push(
          db.prepare(`UPDATE products SET current_stock=?,updated_at=datetime('now') WHERE product_id=?`).bind(next,rma.product_id),
          db.prepare(`UPDATE stock_lots SET remaining_quantity=?,status='Active',updated_at=datetime('now') WHERE lot_id=?`).bind(lotNext,originalSerial.lotId),
          db.prepare(`UPDATE product_serials SET status='In Stock',sale_invoice_id='',sold_at=NULL,returned_at=?,updated_at=datetime('now') WHERE serial_id=?`).bind(resolvedDate,originalSerial.serialId),
          db.prepare(`INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,lot_id,note,created_at) VALUES (?,?,'Warranty Recovery',1,0,?,?,?,?)`).bind(id('SM'),rma.product_id,next,originalSerial.lotId,`${rma.rma_no}; repaired/same item returned`,resolvedDate)
        );
      }
    }
    if (customerWaiting) statements.push(...await restoreWarrantyStateStatements(db,rma,'Resolved',`Supplier returned/repaired same item; ${resolutionNote}`));
  }

  if (resolutionType === 'Warranty Rejected') {
    if (originalSerial) {
      if (customerWaiting) {
        statements.push(db.prepare(`UPDATE product_serials SET status='Sold',sale_invoice_id=?,updated_at=datetime('now') WHERE serial_id=?`).bind(rma.invoiceId || '',originalSerial.serialId));
      } else {
        const physical = await stockNow(String(rma.product_id));
        const next = round(physical + 1); setStock(String(rma.product_id), next);
        const lotNext = Math.min(Number(originalSerial.lotOriginal || 0), round(Number(originalSerial.lotRemaining || 0) + 1));
        statements.push(
          db.prepare(`UPDATE products SET current_stock=?,updated_at=datetime('now') WHERE product_id=?`).bind(next,rma.product_id),
          db.prepare(`UPDATE stock_lots SET remaining_quantity=?,status='Active',updated_at=datetime('now') WHERE lot_id=?`).bind(lotNext,originalSerial.lotId),
          db.prepare(`UPDATE product_serials SET status='Warranty Rejected',returned_at=?,updated_at=datetime('now') WHERE serial_id=?`).bind(resolvedDate,originalSerial.serialId),
          db.prepare(`INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,lot_id,note,created_at) VALUES (?,?,'Warranty Rejected Return',1,0,?,?,?,?)`).bind(id('SM'),rma.product_id,next,originalSerial.lotId,`${rma.rma_no}; warranty rejected`,resolvedDate)
        );
      }
    }
    if (customerWaiting) statements.push(...await restoreWarrantyStateStatements(db,rma,'Rejected',`Supplier rejected warranty; ${resolutionNote}`));
  }

  if (resolutionType === 'Replacement Same Product' || resolutionType === 'Settlement') {
    if (originalSerial) statements.push(db.prepare(`UPDATE product_serials SET status='Warranty Settled',updated_at=datetime('now') WHERE serial_id=?`).bind(originalSerial.serialId));
  }

  // Supplier replacement / settlement products. Inventory receipts use the same lot/tracking engine as Purchase.
  for (let index = 0; index < receivedInputs.length; index += 1) {
    const line = receivedInputs[index];
    const productId = cleanText(line.productId);
    const quantity = round(line.quantity);
    const unitValue = Math.max(0, round(line.unitValue));
    const product = await db.prepare(`SELECT * FROM products WHERE product_id=? AND is_deleted=0 AND status<>'Inactive' LIMIT 1`).bind(productId).first<ProductRow>();
    if (!product) return error(`Received item ${index + 1}: product not found.`);
    if (quantity <= 0) return error(`Received item ${index + 1}: quantity must be greater than zero.`);
    const destination = directToCustomer && index === 0 ? 'Customer' : 'Inventory';
    if (destination === 'Customer' && (productId !== String(rma.product_id) || quantity !== 1)) return error('Direct customer replacement must be exactly 1 unit of the original product.');
    const lotId = id('LOT-RMA');
    let prepared;
    try { prepared = await prepareNewLotTracking(db, product, lotId, quantity, line.tracking, destination === 'Inventory'); }
    catch (err) { return error(err instanceof Error ? err.message : `Received item ${index + 1}: invalid tracking.`); }
    if (destination === 'Customer' && trackingEnabled(product) && prepared.status !== 'Ready') return error('Complete all Serial/Expiry tracking before sending a supplier replacement directly to the customer.');

    const physicalBefore = await stockNow(productId);
    const physicalAfterReceipt = round(physicalBefore + quantity);
    const pending = trackingEnabled(product) ? Math.max(0, round(quantity - prepared.assignedQuantity)) : 0;
    const lotRemaining = destination === 'Customer' ? 0 : quantity;
    statements.push(
      db.prepare(`INSERT INTO stock_lots(lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost,status,tracking_required_quantity,tracking_status,created_at)
        VALUES (?,?,'WARRANTY_RMA',?,?,?,?,?,?,?,?)`).bind(lotId,productId,rma.rma_no,quantity,lotRemaining,unitValue,lotRemaining>0?'Active':'Depleted',destination==='Customer'?0:pending,destination==='Customer'?'Ready':prepared.status,resolvedDate),
      ...prepared.statements,
      db.prepare(`INSERT INTO supplier_warranty_rma_received_items(received_item_id,rma_id,product_id,product_name,quantity,unit_value,destination,lot_id,tracking_status)
        VALUES (?,?,?,?,?,?,?,?,?)`).bind(id('RMAI'),rmaId,productId,(product.brand?`${product.brand} ${product.product_name}`:product.product_name),quantity,unitValue,destination,lotId,destination==='Customer'?'Ready':prepared.status),
      db.prepare(`INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,lot_id,note,created_at)
        VALUES (?,?,'Warranty Supplier Receive',?,0,?,?,?,?)`).bind(id('SM'),productId,quantity,physicalAfterReceipt,lotId,`${rma.rma_no}; ${supplier.supplierName}`,resolvedDate)
    );

    if (destination === 'Inventory') {
      setStock(productId, physicalAfterReceipt);
      statements.push(db.prepare(`UPDATE products SET current_stock=?,updated_at=datetime('now') WHERE product_id=?`).bind(physicalAfterReceipt,productId));
    } else {
      // Receive + immediately issue to the waiting customer. Net on-hand stock does not change.
      statements.push(
        db.prepare(`INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,lot_id,note,created_at)
          VALUES (?,?,'Warranty Supplier Direct to Customer',0,?, ?,?,?,?)`).bind(id('SM'),productId,quantity,physicalBefore,lotId,`${rma.rma_no}; direct customer replacement`,resolvedDate),
        db.prepare(`UPDATE stock_expiry_batches SET remaining_quantity=0,updated_at=datetime('now') WHERE lot_id=?`).bind(lotId)
      );
      const serials = serialsFromTracking(product, line.tracking);
      if (Number(product.track_serial || 0)) {
        if (serials.length !== 1) return error('Direct serialized replacement requires exactly one new Serial / IMEI.');
        const newSerial = serials[0];
        statements.push(
          db.prepare(`UPDATE product_serials SET status='Sold',sale_invoice_id=?,sold_at=?,updated_at=datetime('now') WHERE product_id=? AND lot_id=? AND serial_number=? COLLATE NOCASE`).bind(rma.invoiceId || '',resolvedDate,productId,lotId,newSerial),
          db.prepare(`UPDATE sale_item_tracking SET lot_id=?,serial_id=(SELECT serial_id FROM product_serials WHERE product_id=? AND lot_id=? AND serial_number=? COLLATE NOCASE LIMIT 1),serial_number=?,expiry_batch_id=(SELECT expiry_batch_id FROM product_serials WHERE product_id=? AND lot_id=? AND serial_number=? COLLATE NOCASE LIMIT 1) WHERE invoice_id=? AND serial_id=? AND returned_quantity<quantity`).bind(lotId,productId,lotId,newSerial,newSerial,productId,lotId,newSerial,rma.invoiceId || '',rma.serial_id || ''),
          db.prepare(`UPDATE warranty_records SET serial_id=(SELECT serial_id FROM product_serials WHERE product_id=? AND lot_id=? AND serial_number=? COLLATE NOCASE LIMIT 1),serial_number=?,status=CASE WHEN warranty_end_date<? THEN 'Expired' ELSE 'Active' END,updated_at=datetime('now') WHERE warranty_id=?`).bind(productId,lotId,newSerial,newSerial,resolvedDate,rma.warranty_id)
        );
      }
      if (customerWaiting) statements.push(...await restoreWarrantyStateStatements(db,rma,'Resolved',`Supplier replacement delivered to customer; ${resolutionNote}`));
    }
  }

  // Supplier credit offsets what the business owes. Additional payable increases it.
  let due = Number(supplier.currentDue || 0);
  if (supplierCredit > 0) {
    due = round(due - supplierCredit);
    const ledgerId = id('SL');
    statements.push(
      db.prepare(`INSERT INTO supplier_ledger(ledger_id,date,supplier_id,supplier_name,type,reference,debit,credit,balance,notes,created_by,created_at) VALUES (?,?,?,?, 'Warranty Credit',?,0,?,?,?,?,datetime('now'))`)
        .bind(ledgerId,resolvedDate,rma.supplier_id,supplier.supplierName,rma.rma_no,supplierCredit,due,resolutionNote,user.userId),
      db.prepare(`INSERT INTO supplier_warranty_rma_financials(financial_id,rma_id,financial_type,amount,supplier_ledger_id) VALUES (?,?,?,?,?)`).bind(id('RMAF'),rmaId,'Supplier Credit',supplierCredit,ledgerId)
    );
  }
  if (additionalPayable > 0) {
    due = round(due + additionalPayable);
    const ledgerId = id('SL');
    statements.push(
      db.prepare(`INSERT INTO supplier_ledger(ledger_id,date,supplier_id,supplier_name,type,reference,debit,credit,balance,notes,created_by,created_at) VALUES (?,?,?,?, 'Warranty Additional Payable',?,?,0,?,?,?,datetime('now'))`)
        .bind(ledgerId,resolvedDate,rma.supplier_id,supplier.supplierName,rma.rma_no,additionalPayable,due,resolutionNote,user.userId),
      db.prepare(`INSERT INTO supplier_warranty_rma_financials(financial_id,rma_id,financial_type,amount,supplier_ledger_id) VALUES (?,?,?,?,?)`).bind(id('RMAF'),rmaId,'Additional Payable',additionalPayable,ledgerId)
    );
  }
  if (supplierCredit > 0 || additionalPayable > 0) statements.push(db.prepare(`UPDATE suppliers SET current_due=?,updated_at=datetime('now') WHERE supplier_id=?`).bind(due,rma.supplier_id));

  if (cashRefund > 0) {
    const financialId = id('RMAF');
    if (refundMethod === 'Cash') {
      statements.push(db.prepare(`INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted,created_at) VALUES (?,?, 'Supplier Warranty Refund',?,?,0,?,'Cash',0,datetime('now'))`)
        .bind(id('CB'),resolvedDate,rma.rma_no,`Warranty refund from ${supplier.supplierName}`,cashRefund));
    } else {
      const nextBank = round(Number(refundBank.currentBalance || 0) + cashRefund);
      statements.push(
        db.prepare(`INSERT INTO bank_book(entry_id,bank_account_id,bank_account_name,date,type,reference,description,debit,credit,balance,status,created_by,is_deleted,created_at)
          VALUES (?,?,?,?,'Supplier Warranty Refund',?,?,0,?,?,'Active',?,0,datetime('now'))`).bind(id('BB'),refundBank.id,refundBank.name,resolvedDate,rma.rma_no,`Warranty refund from ${supplier.supplierName}`,cashRefund,nextBank,user.fullName),
        db.prepare(`UPDATE bank_accounts SET current_balance=current_balance+? WHERE bank_account_id=?`).bind(cashRefund,refundBank.id)
      );
    }
    statements.push(db.prepare(`INSERT INTO supplier_warranty_rma_financials(financial_id,rma_id,financial_type,amount,payment_method,bank_account_id) VALUES (?,?,?,?,?,?)`).bind(financialId,rmaId,'Cash Refund',cashRefund,refundMethod,refundMethod==='Cash'?'':bankAccountId));
  }

  statements.push(
    db.prepare(`UPDATE supplier_warranty_rmas SET status=?,resolution_type=?,resolved_date=?,resolution_note=?,resolved_by=?,updated_at=datetime('now') WHERE rma_id=?`)
      .bind(resolutionType === 'Warranty Rejected' ? 'Rejected' : 'Resolved',resolutionType,resolvedDate,resolutionNote,user.fullName,rmaId),
    audit(db,user,'RESOLVE_SUPPLIER_WARRANTY',rmaId,`${rma.rma_no}; ${resolutionType}; credit ${supplierCredit}; payable ${additionalPayable}; refund ${cashRefund}`)
  );

  try { await db.batch(statements); }
  catch (err) { return error(err instanceof Error ? err.message : 'Could not resolve supplier warranty RMA.'); }
  return json({ ok: true, rmaId, status: resolutionType === 'Warranty Rejected' ? 'Rejected' : 'Resolved', supplierDue: due });
}
