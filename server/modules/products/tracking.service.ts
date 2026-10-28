import type { SherDatabase, SqlPreparedStatement } from '../../db/types.js';
import type { LotTrackingInput, WarrantyPeriodUnit } from './tracking.types.js';
import type { AuthUser } from '../auth/types.js';

export type TrackingProductRow = {
  product_id: string;
  product_name?: string;
  brand?: string;
  current_stock?: number;
  track_serial?: number;
  track_expiry?: number;
  track_warranty?: number;
  warranty_period_value?: number;
  warranty_period_unit?: WarrantyPeriodUnit | string;
};

export type TrackingAvailability = {
  physical: number;
  sellable: number;
  pending: number;
  expired: number;
};

export type PreparedLotTracking = {
  statements: SqlPreparedStatement[];
  status: 'Ready' | 'Pending';
  assignedQuantity: number;
};

export type SaleTrackingDraw = {
  lotId: string;
  quantity: number;
  expiryBatchId?: string;
  serialId?: string;
  serialNumber?: string;
};

function cleanText(value: unknown): string { return String(value ?? '').trim(); }
function roundQty(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 10000) / 10000;
}
function uniqueTexts(values: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(values) ? values : []) {
    const value = cleanText(raw);
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key); out.push(value);
  }
  return out;
}
function isIsoDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value); }

export function trackingEnabled(product: TrackingProductRow): boolean {
  return Boolean(Number(product.track_serial || 0) || Number(product.track_expiry || 0));
}

export function warrantyEndDate(saleDate: string, valueRaw: unknown, unitRaw: unknown): string {
  const value = Math.max(0, Math.round(Number(valueRaw || 0)));
  if (!value || !isIsoDate(saleDate)) return saleDate;
  const date = new Date(`${saleDate}T00:00:00Z`);
  const unit = cleanText(unitRaw) as WarrantyPeriodUnit;
  if (unit === 'Days') date.setUTCDate(date.getUTCDate() + value);
  else if (unit === 'Years') date.setUTCFullYear(date.getUTCFullYear() + value);
  else date.setUTCMonth(date.getUTCMonth() + value);
  return date.toISOString().slice(0, 10);
}

async function validateSerialsUnique(db: SherDatabase, serials: string[], excludeLotId = ''): Promise<void> {
  for (const serial of serials) {
    const row = await db.prepare(`SELECT lot_id AS lotId FROM product_serials WHERE serial_number = ? COLLATE NOCASE LIMIT 1`).bind(serial).first<{ lotId: string }>();
    if (row && row.lotId !== excludeLotId) throw new Error(`Serial / IMEI already exists: ${serial}`);
  }
}

export async function prepareNewLotTracking(
  db: SherDatabase,
  product: TrackingProductRow,
  lotId: string,
  quantityRaw: unknown,
  input?: LotTrackingInput,
  allowPartial = true,
  excludeExistingLotId = ''
): Promise<PreparedLotTracking> {
  const quantity = roundQty(quantityRaw);
  const trackSerial = Boolean(Number(product.track_serial || 0));
  const trackExpiry = Boolean(Number(product.track_expiry || 0));
  if (!trackSerial && !trackExpiry) return { statements: [], status: 'Ready', assignedQuantity: quantity };

  const statements: SqlPreparedStatement[] = [];
  let assigned = 0;

  if (trackExpiry) {
    const batches = (Array.isArray(input?.expiryBatches) ? input!.expiryBatches! : [])
      .map((batch) => ({
        quantity: roundQty(batch.quantity),
        expiryDate: cleanText(batch.expiryDate),
        batchNo: cleanText(batch.batchNo),
        serialNumbers: uniqueTexts(batch.serialNumbers)
      }))
      .filter((batch) => batch.quantity > 0 || batch.expiryDate || batch.serialNumbers.length > 0);

    const allSerials = batches.flatMap((batch) => batch.serialNumbers);
    if (trackSerial) await validateSerialsUnique(db, allSerials, excludeExistingLotId);
    if (trackSerial && new Set(allSerials.map((s) => s.toLocaleLowerCase())).size !== allSerials.length) throw new Error('Duplicate Serial / IMEI in tracking entry.');

    for (let i = 0; i < batches.length; i += 1) {
      const batch = batches[i];
      if (!batch.expiryDate || !isIsoDate(batch.expiryDate)) throw new Error(`Expiry batch ${i + 1}: enter a valid expiry date.`);
      const batchQty = trackSerial ? batch.serialNumbers.length : batch.quantity;
      if (trackSerial && batch.quantity > 0 && batch.quantity !== batch.serialNumbers.length) throw new Error(`Expiry batch ${i + 1}: quantity must match the number of serials.`);
      if (batchQty <= 0) throw new Error(`Expiry batch ${i + 1}: quantity must be greater than zero.`);
      assigned = roundQty(assigned + batchQty);
      if (assigned > quantity) throw new Error('Tracking quantity cannot exceed the received stock quantity.');
      const expiryBatchId = `EXP-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      statements.push(db.prepare(`INSERT INTO stock_expiry_batches
        (expiry_batch_id, lot_id, product_id, batch_no, expiry_date, original_quantity, remaining_quantity)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(expiryBatchId, lotId, product.product_id, batch.batchNo, batch.expiryDate, batchQty, batchQty));
      if (trackSerial) {
        for (const serial of batch.serialNumbers) {
          statements.push(db.prepare(`INSERT INTO product_serials
            (serial_id, serial_number, product_id, lot_id, expiry_batch_id, status)
            VALUES (?, ?, ?, ?, ?, 'In Stock')`)
            .bind(`SER-${crypto.randomUUID().slice(0, 12).toUpperCase()}`, serial, product.product_id, lotId, expiryBatchId));
        }
      }
    }
  } else if (trackSerial) {
    const serials = uniqueTexts(input?.serialNumbers);
    if (new Set(serials.map((s) => s.toLocaleLowerCase())).size !== serials.length) throw new Error('Duplicate Serial / IMEI in tracking entry.');
    await validateSerialsUnique(db, serials, excludeExistingLotId);
    if (serials.length > quantity) throw new Error('Serial / IMEI count cannot exceed the received stock quantity.');
    assigned = serials.length;
    for (const serial of serials) {
      statements.push(db.prepare(`INSERT INTO product_serials
        (serial_id, serial_number, product_id, lot_id, status)
        VALUES (?, ?, ?, ?, 'In Stock')`)
        .bind(`SER-${crypto.randomUUID().slice(0, 12).toUpperCase()}`, serial, product.product_id, lotId));
    }
  }

  const ready = assigned === quantity;
  if (!allowPartial && !ready) throw new Error(`Complete tracking for all ${quantity} item(s) before saving.`);
  return { statements, status: ready ? 'Ready' : 'Pending', assignedQuantity: assigned };
}

export async function replacePendingLotTrackingRoute(db: SherDatabase, lotId: string, input: LotTrackingInput): Promise<Response> {
  const lot = await db.prepare(`SELECT sl.lot_id AS lotId, sl.product_id AS productId, sl.original_quantity AS originalQuantity,
      sl.remaining_quantity AS physicalRemainingQuantity, sl.tracking_required_quantity AS pendingQuantity, sl.tracking_status AS trackingStatus,
      p.product_name, COALESCE(p.brand,'') brand, p.track_serial, p.track_expiry, p.track_warranty,
      p.warranty_period_value, p.warranty_period_unit
    FROM stock_lots sl JOIN products p ON p.product_id=sl.product_id WHERE sl.lot_id=? LIMIT 1`).bind(lotId).first<any>();
  if (!lot) return responseError('Stock lot not found.', 404);
  const product: TrackingProductRow = {
    product_id: lot.productId, product_name: lot.product_name, brand: lot.brand,
    track_serial: lot.track_serial, track_expiry: lot.track_expiry, track_warranty: lot.track_warranty,
    warranty_period_value: lot.warranty_period_value, warranty_period_unit: lot.warranty_period_unit
  };
  if (!trackingEnabled(product)) return responseError('This product does not require serial or expiry tracking.');
  const pending = Math.max(0, roundQty(lot.pendingQuantity));
  if (pending <= 0) return responseError('This stock lot has no pending tracking.');
  try {
    // Pending completion is additive. Existing Serial/Expiry assignments remain intact,
    // including assignments already sold/returned, so users can finish missing tracking later.
    const prepared = await prepareNewLotTracking(db, product, lotId, pending, input, true);
    const pendingAfter = Math.max(0, roundQty(pending - prepared.assignedQuantity));
    const status: 'Ready' | 'Pending' = pendingAfter <= 0 ? 'Ready' : 'Pending';
    const statements: SqlPreparedStatement[] = [
      ...prepared.statements,
      db.prepare(`UPDATE stock_lots SET tracking_status=?, tracking_required_quantity=?, updated_at=datetime('now') WHERE lot_id=?`)
        .bind(status, pendingAfter, lotId)
    ];
    await db.batch(statements);
    return responseJson({ ok: true, status, assignedQuantity: prepared.assignedQuantity, requiredQuantity: pendingAfter });
  } catch (err) { return responseError(err instanceof Error ? err.message : 'Could not save tracking.'); }
}

export async function getAvailabilityMap(db: SherDatabase): Promise<Map<string, TrackingAvailability>> {
  const [products, pendingRows, expiryRows, serialRows] = await Promise.all([
    db.prepare(`SELECT product_id AS productId, current_stock AS physical, track_serial AS trackSerial, track_expiry AS trackExpiry FROM products WHERE is_deleted=0`).all<any>(),
    db.prepare(`SELECT product_id AS productId, COALESCE(SUM(tracking_required_quantity),0) qty
      FROM stock_lots WHERE tracking_required_quantity>0 AND remaining_quantity>0 GROUP BY product_id`).all<any>(),
    db.prepare(`SELECT eb.product_id AS productId, COALESCE(SUM(eb.remaining_quantity),0) qty
      FROM stock_expiry_batches eb JOIN stock_lots sl ON sl.lot_id=eb.lot_id
      WHERE eb.remaining_quantity>0 AND sl.remaining_quantity>0 AND eb.expiry_date < date('now') GROUP BY eb.product_id`).all<any>(),
    db.prepare(`SELECT ps.product_id AS productId,
        SUM(CASE WHEN eb.expiry_batch_id IS NULL OR eb.expiry_date >= date('now') THEN 1 ELSE 0 END) AS sellableQty,
        SUM(CASE WHEN eb.expiry_batch_id IS NOT NULL AND eb.expiry_date < date('now') THEN 1 ELSE 0 END) AS expiredQty
      FROM product_serials ps JOIN stock_lots sl ON sl.lot_id=ps.lot_id
      LEFT JOIN stock_expiry_batches eb ON eb.expiry_batch_id=ps.expiry_batch_id
      WHERE ps.status='In Stock' AND sl.remaining_quantity>0 GROUP BY ps.product_id`).all<any>()
  ]);
  const pending = new Map((pendingRows.results || []).map((r:any) => [String(r.productId), Number(r.qty || 0)]));
  const expiryExpired = new Map((expiryRows.results || []).map((r:any) => [String(r.productId), Number(r.qty || 0)]));
  const serialStats = new Map((serialRows.results || []).map((r:any) => [String(r.productId), { sellable:Number(r.sellableQty||0), expired:Number(r.expiredQty||0) }]));
  const map = new Map<string, TrackingAvailability>();
  for (const row of products.results || []) {
    const physical = Number(row.physical || 0), p = Number(pending.get(row.productId) || 0);
    let sellable = physical, expired = 0;
    if (Number(row.trackSerial || 0)) {
      const stats = serialStats.get(String(row.productId)) || { sellable:0, expired:0 };
      sellable = stats.sellable; expired = stats.expired;
    } else if (Number(row.trackExpiry || 0)) {
      expired = Number(expiryExpired.get(row.productId) || 0);
      // Assigned non-expired expiry batches are sellable even if some quantity from the same source lot is still pending.
      sellable = Math.max(0, physical - p - expired);
    }
    map.set(String(row.productId), { physical, pending: p, expired, sellable: Math.max(0, sellable) });
  }
  return map;
}

export async function getProductTrackingOverviewRoute(db: SherDatabase): Promise<Response> {
  const availability = await getAvailabilityMap(db);
  const [products, pending, serials, expiry, warranties, claims, replacements] = await Promise.all([
    db.prepare(`SELECT product_id AS productId, product_name AS productName, COALESCE(brand,'') brand,
      track_serial AS trackSerial, track_expiry AS trackExpiry, track_warranty AS trackWarranty,
      warranty_period_value AS warrantyPeriodValue, warranty_period_unit AS warrantyPeriodUnit, current_stock AS currentStock
      FROM products WHERE is_deleted=0 AND (track_serial=1 OR track_expiry=1 OR track_warranty=1) ORDER BY product_name COLLATE NOCASE`).all<any>(),
    db.prepare(`SELECT sl.lot_id AS lotId, sl.product_id AS productId, p.product_name AS productName, COALESCE(p.brand,'') brand,
      sl.source_type AS sourceType, COALESCE(sl.source_ref,'') sourceRef, sl.original_quantity AS originalQuantity,
      sl.tracking_required_quantity AS remainingQuantity, sl.created_at AS createdAt, p.track_serial AS trackSerial, p.track_expiry AS trackExpiry
      FROM stock_lots sl JOIN products p ON p.product_id=sl.product_id
      WHERE sl.tracking_required_quantity>0 AND sl.remaining_quantity>0 ORDER BY sl.created_at DESC`).all<any>(),
    db.prepare(`SELECT ps.serial_id AS serialId, ps.serial_number AS serialNumber, ps.product_id AS productId,
      p.product_name AS productName, COALESCE(p.brand,'') brand, ps.lot_id AS lotId, ps.status,
      COALESCE(ps.sale_invoice_id,'') AS invoiceId, eb.expiry_date AS expiryDate, ps.created_at AS createdAt
      FROM product_serials ps JOIN products p ON p.product_id=ps.product_id
      LEFT JOIN stock_expiry_batches eb ON eb.expiry_batch_id=ps.expiry_batch_id
      ORDER BY ps.created_at DESC LIMIT 1000`).all<any>(),
    db.prepare(`SELECT eb.expiry_batch_id AS expiryBatchId, eb.product_id AS productId, p.product_name AS productName, COALESCE(p.brand,'') brand,
      eb.lot_id AS lotId, eb.batch_no AS batchNo, eb.expiry_date AS expiryDate, eb.original_quantity AS originalQuantity,
      eb.remaining_quantity AS remainingQuantity, eb.created_at AS createdAt
      FROM stock_expiry_batches eb JOIN products p ON p.product_id=eb.product_id ORDER BY eb.expiry_date ASC LIMIT 1000`).all<any>(),
    db.prepare(`SELECT wr.warranty_id AS warrantyId, wr.invoice_id AS invoiceId, wr.sale_date AS saleDate, wr.product_id AS productId,
      wr.product_name AS productName, wr.customer_name AS customerName, wr.customer_phone AS customerPhone, wr.serial_number AS serialNumber,
      wr.quantity, wr.remaining_quantity AS remainingQuantity, wr.warranty_end_date AS warrantyEndDate, wr.status, wr.created_at AS createdAt,
      (SELECT COUNT(*) FROM warranty_claims wc WHERE wc.warranty_id=wr.warranty_id AND wc.status='Open') AS openClaimCount
      FROM warranty_records wr ORDER BY wr.warranty_end_date ASC LIMIT 1000`).all<any>(),
    db.prepare(`SELECT wc.claim_id AS claimId, wc.warranty_id AS warrantyId, wc.claim_date AS claimDate, wc.issue, wc.resolution,
      wc.status, wc.created_by AS createdBy, wc.created_at AS createdAt, wc.updated_at AS updatedAt,
      wr.invoice_id AS invoiceId, wr.product_id AS productId, wr.product_name AS productName,
      wr.customer_name AS customerName, wr.customer_phone AS customerPhone, wr.serial_number AS serialNumber,
      wr.warranty_end_date AS warrantyEndDate
      FROM warranty_claims wc JOIN warranty_records wr ON wr.warranty_id=wc.warranty_id
      ORDER BY CASE wc.status WHEN 'Open' THEN 0 ELSE 1 END, wc.claim_date DESC, wc.created_at DESC LIMIT 1000`).all<any>(),
    db.prepare(`SELECT r.replacement_id AS replacementId, r.claim_id AS claimId, r.warranty_id AS warrantyId,
      r.replacement_date AS replacementDate, r.product_id AS productId, r.invoice_id AS invoiceId,
      r.original_serial_id AS originalSerialId, r.original_serial_number AS originalSerialNumber,
      r.replacement_serial_id AS replacementSerialId, r.replacement_serial_number AS replacementSerialNumber,
      r.note, r.created_by AS createdBy, r.created_at AS createdAt,
      wr.product_name AS productName, wr.customer_name AS customerName, wr.customer_phone AS customerPhone
      FROM warranty_replacements r JOIN warranty_records wr ON wr.warranty_id=r.warranty_id
      ORDER BY r.replacement_date DESC, r.created_at DESC LIMIT 1000`).all<any>()
  ]);
  return responseJson({ ok: true,
    products: (products.results || []).map((p:any) => ({ ...p, ...(availability.get(String(p.productId)) || { physical:Number(p.currentStock||0),sellable:Number(p.currentStock||0),pending:0,expired:0 }) })),
    pending: pending.results || [], serials: serials.results || [], expiry: expiry.results || [], warranties: warranties.results || [], claims: claims.results || [], replacements: replacements.results || []
  });
}

export async function getPendingLotTrackingRoute(db: SherDatabase, lotId: string): Promise<Response> {
  const lot = await db.prepare(`SELECT sl.lot_id AS lotId, sl.product_id AS productId, sl.original_quantity AS originalQuantity,
      sl.tracking_required_quantity AS remainingQuantity, sl.remaining_quantity AS physicalRemainingQuantity,
      sl.tracking_status AS trackingStatus, p.product_name AS productName,
      COALESCE(p.brand,'') brand, p.track_serial AS trackSerial, p.track_expiry AS trackExpiry
    FROM stock_lots sl JOIN products p ON p.product_id=sl.product_id WHERE sl.lot_id=? LIMIT 1`).bind(lotId).first<any>();
  if (!lot) return responseError('Stock lot not found.', 404);
  return responseJson({ ok:true, lot, tracking: {} });
}

export async function getPosTrackingOptionsRoute(db: SherDatabase, productId: string): Promise<Response> {
  const product = await db.prepare(`SELECT product_id AS productId, product_name AS productName, COALESCE(brand,'') brand,
      track_serial AS trackSerial, track_expiry AS trackExpiry, track_warranty AS trackWarranty
    FROM products WHERE product_id=? AND is_deleted=0 LIMIT 1`).bind(productId).first<any>();
  if (!product) return responseError('Product not found.',404);
  const serials = Number(product.trackSerial || 0) ? await db.prepare(`SELECT ps.serial_number AS serialNumber, eb.expiry_date AS expiryDate
    FROM product_serials ps JOIN stock_lots sl ON sl.lot_id=ps.lot_id
    LEFT JOIN stock_expiry_batches eb ON eb.expiry_batch_id=ps.expiry_batch_id
    WHERE ps.product_id=? AND ps.status='In Stock' AND sl.remaining_quantity>0
      AND (eb.expiry_batch_id IS NULL OR eb.expiry_date >= date('now'))
    ORDER BY COALESCE(eb.expiry_date,'9999-12-31'), ps.created_at`).bind(productId).all<any>() : { results: [] as any[] };
  return responseJson({ ok:true, product, serials: serials.results || [] });
}

export async function planTrackedSale(db: SherDatabase, product: TrackingProductRow, quantityRaw: unknown, serialNumbersRaw: unknown, saleDate: string): Promise<SaleTrackingDraw[]> {
  const quantity = Math.max(0, Math.round(Number(quantityRaw || 0)));
  if (!trackingEnabled(product)) return [];
  if (Number(product.track_serial || 0)) {
    const serials = uniqueTexts(serialNumbersRaw);
    if (serials.length !== quantity) throw new Error(`${cleanText(product.product_name) || 'Product'}: select exactly ${quantity} Serial / IMEI number(s).`);
    const draws: SaleTrackingDraw[] = [];
    for (const serial of serials) {
      const row = await db.prepare(`SELECT ps.serial_id AS serialId, ps.serial_number AS serialNumber, ps.lot_id AS lotId,
          ps.expiry_batch_id AS expiryBatchId, eb.expiry_date AS expiryDate
        FROM product_serials ps JOIN stock_lots sl ON sl.lot_id=ps.lot_id
        LEFT JOIN stock_expiry_batches eb ON eb.expiry_batch_id=ps.expiry_batch_id
        WHERE ps.product_id=? AND ps.serial_number=? COLLATE NOCASE AND ps.status='In Stock' AND sl.remaining_quantity>0 LIMIT 1`)
        .bind(product.product_id, serial).first<any>();
      if (!row) throw new Error(`${cleanText(product.product_name) || 'Product'}: Serial / IMEI ${serial} is not available.`);
      if (row.expiryDate && String(row.expiryDate) < saleDate) throw new Error(`${serial} expired on ${row.expiryDate}.`);
      draws.push({ lotId: row.lotId, quantity: 1, serialId: row.serialId, serialNumber: row.serialNumber, expiryBatchId: row.expiryBatchId || undefined });
    }
    return draws;
  }

  const batches = await db.prepare(`SELECT eb.expiry_batch_id AS expiryBatchId, eb.lot_id AS lotId, eb.expiry_date AS expiryDate, eb.remaining_quantity AS remainingQuantity
    FROM stock_expiry_batches eb JOIN stock_lots sl ON sl.lot_id=eb.lot_id
    WHERE eb.product_id=? AND eb.remaining_quantity>0 AND sl.remaining_quantity>0 AND eb.expiry_date>=?
    ORDER BY eb.expiry_date ASC, eb.created_at ASC`).bind(product.product_id, saleDate).all<any>();
  let need = quantity; const draws: SaleTrackingDraw[] = [];
  for (const row of batches.results || []) {
    if (need <= 0) break;
    const take = Math.min(need, Number(row.remainingQuantity || 0));
    if (take > 0) { draws.push({ lotId: row.lotId, expiryBatchId: row.expiryBatchId, quantity: take }); need -= take; }
  }
  if (need > 0) throw new Error(`${cleanText(product.product_name) || 'Product'}: only ${quantity - need} non-expired tracked item(s) are ready to sell.`);
  return draws;
}


function todayIso(): string { return new Date().toISOString().slice(0, 10); }

function trackingAuditStatement(db: SherDatabase, user: AuthUser, action: string, entityType: string, entityId: string, note: string): SqlPreparedStatement {
  return db.prepare(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) VALUES (?,?,?,?,?)`)
    .bind(user.userId, action, entityType, entityId, note);
}

export async function correctSerialRoute(db: SherDatabase, serialId: string, input: { serialNumber?: string; reason?: string }, user: AuthUser): Promise<Response> {
  const serialNumber = cleanText(input?.serialNumber);
  const reason = cleanText(input?.reason);
  if (!serialNumber) return responseError('Enter the corrected Serial / IMEI.');
  if (!reason) return responseError('Correction reason is required.');
  const row = await db.prepare(`SELECT serial_id AS serialId, serial_number AS serialNumber, product_id AS productId, status
    FROM product_serials WHERE serial_id=? LIMIT 1`).bind(serialId).first<any>();
  if (!row) return responseError('Serial / IMEI record not found.', 404);
  if (String(row.serialNumber).toLocaleLowerCase() === serialNumber.toLocaleLowerCase()) return responseError('Enter a different Serial / IMEI.');
  const duplicate = await db.prepare(`SELECT serial_id AS serialId FROM product_serials WHERE serial_number=? COLLATE NOCASE AND serial_id<>? LIMIT 1`)
    .bind(serialNumber, serialId).first<any>();
  if (duplicate) return responseError(`Serial / IMEI already exists: ${serialNumber}`);
  const old = String(row.serialNumber || '');
  await db.batch([
    db.prepare(`UPDATE product_serials SET serial_number=?,updated_at=datetime('now') WHERE serial_id=?`).bind(serialNumber, serialId),
    db.prepare(`UPDATE sale_item_tracking SET serial_number=? WHERE serial_id=?`).bind(serialNumber, serialId),
    db.prepare(`UPDATE warranty_records SET serial_number=?,updated_at=datetime('now') WHERE serial_id=?`).bind(serialNumber, serialId),
    trackingAuditStatement(db, user, 'CORRECT_PRODUCT_SERIAL', 'PRODUCT_SERIAL', serialId, `${old} -> ${serialNumber}; ${reason}`)
  ]);
  return responseJson({ ok: true, serialId, serialNumber });
}

export async function correctExpiryBatchRoute(db: SherDatabase, expiryBatchId: string, input: { expiryDate?: string; batchNo?: string; reason?: string }, user: AuthUser): Promise<Response> {
  const expiryDate = cleanText(input?.expiryDate);
  const batchNo = cleanText(input?.batchNo);
  const reason = cleanText(input?.reason);
  if (!isIsoDate(expiryDate)) return responseError('Enter a valid expiry date.');
  if (!reason) return responseError('Correction reason is required.');
  const row = await db.prepare(`SELECT expiry_batch_id AS expiryBatchId, expiry_date AS expiryDate, batch_no AS batchNo, product_id AS productId
    FROM stock_expiry_batches WHERE expiry_batch_id=? LIMIT 1`).bind(expiryBatchId).first<any>();
  if (!row) return responseError('Expiry batch not found.', 404);
  const latestSale = await db.prepare(`SELECT MAX(s.sale_date) AS latestSaleDate
    FROM sale_item_tracking sit JOIN sales s ON s.invoice_id=sit.invoice_id
    WHERE sit.expiry_batch_id=?`).bind(expiryBatchId).first<any>();
  if (latestSale?.latestSaleDate && expiryDate < String(latestSale.latestSaleDate)) {
    return responseError(`Expiry date cannot be before tracked sale date ${latestSale.latestSaleDate}.`);
  }
  await db.batch([
    db.prepare(`UPDATE stock_expiry_batches SET expiry_date=?,batch_no=?,updated_at=datetime('now') WHERE expiry_batch_id=?`)
      .bind(expiryDate, batchNo, expiryBatchId),
    trackingAuditStatement(db, user, 'CORRECT_EXPIRY_BATCH', 'EXPIRY_BATCH', expiryBatchId,
      `${row.expiryDate || '-'} / ${row.batchNo || '-'} -> ${expiryDate} / ${batchNo || '-'}; ${reason}`)
  ]);
  return responseJson({ ok: true, expiryBatchId, expiryDate, batchNo });
}

export async function updateWarrantyRoute(db: SherDatabase, warrantyId: string, input: { warrantyEndDate?: string; status?: string; reason?: string }, user: AuthUser): Promise<Response> {
  const row = await db.prepare(`SELECT warranty_id AS warrantyId, sale_date AS saleDate, warranty_end_date AS warrantyEndDate, status
    FROM warranty_records WHERE warranty_id=? LIMIT 1`).bind(warrantyId).first<any>();
  if (!row) return responseError('Warranty record not found.', 404);
  const warrantyEndDate = cleanText(input?.warrantyEndDate) || String(row.warrantyEndDate || '');
  const requestedStatus = cleanText(input?.status) || String(row.status || 'Active');
  const reason = cleanText(input?.reason);
  if (!isIsoDate(warrantyEndDate)) return responseError('Enter a valid warranty end date.');
  if (warrantyEndDate < String(row.saleDate || '')) return responseError('Warranty end date cannot be before the sale date.');
  if (!['Active','Voided'].includes(requestedStatus)) return responseError('Warranty status must be Active or Voided.');
  if (!reason) return responseError('Change reason is required.');
  const openClaim = await db.prepare(`SELECT 1 ok FROM warranty_claims WHERE warranty_id=? AND status='Open' LIMIT 1`).bind(warrantyId).first<any>();
  const finalStatus = requestedStatus === 'Voided' ? 'Voided' : openClaim ? 'Claimed' : (warrantyEndDate < todayIso() ? 'Expired' : 'Active');
  await db.batch([
    db.prepare(`UPDATE warranty_records SET warranty_end_date=?,status=?,updated_at=datetime('now') WHERE warranty_id=?`)
      .bind(warrantyEndDate, finalStatus, warrantyId),
    trackingAuditStatement(db, user, 'UPDATE_WARRANTY', 'WARRANTY', warrantyId,
      `End ${row.warrantyEndDate} -> ${warrantyEndDate}; status ${row.status} -> ${finalStatus}; ${reason}`)
  ]);
  return responseJson({ ok: true, warrantyId, warrantyEndDate, status: finalStatus });
}

export async function createWarrantyClaimRoute(db: SherDatabase, warrantyId: string, input: { claimDate?: string; issue?: string }, user: AuthUser): Promise<Response> {
  const claimDate = cleanText(input?.claimDate) || todayIso();
  const issue = cleanText(input?.issue);
  if (!isIsoDate(claimDate)) return responseError('Enter a valid claim date.');
  if (!issue) return responseError('Describe the warranty issue.');
  const warranty = await db.prepare(`SELECT warranty_id AS warrantyId, sale_date AS saleDate, warranty_end_date AS warrantyEndDate, status
    FROM warranty_records WHERE warranty_id=? LIMIT 1`).bind(warrantyId).first<any>();
  if (!warranty) return responseError('Warranty record not found.', 404);
  if (String(warranty.status) === 'Voided') return responseError('This warranty is voided.');
  if (claimDate < String(warranty.saleDate || '')) return responseError('Claim date cannot be before the sale date.');
  if (claimDate > String(warranty.warrantyEndDate || '')) return responseError(`Warranty expired on ${warranty.warrantyEndDate}.`);
  const existing = await db.prepare(`SELECT claim_id AS claimId FROM warranty_claims WHERE warranty_id=? AND status='Open' LIMIT 1`).bind(warrantyId).first<any>();
  if (existing) return responseError('This warranty already has an open claim.');
  const claimId = `WCL-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  await db.batch([
    db.prepare(`INSERT INTO warranty_claims(claim_id,warranty_id,claim_date,issue,status,created_by) VALUES (?,?,?,?,'Open',?)`)
      .bind(claimId, warrantyId, claimDate, issue, user.fullName),
    db.prepare(`UPDATE warranty_records SET status='Claimed',updated_at=datetime('now') WHERE warranty_id=?`).bind(warrantyId),
    trackingAuditStatement(db, user, 'CREATE_WARRANTY_CLAIM', 'WARRANTY_CLAIM', claimId, `Warranty ${warrantyId}; ${issue}`)
  ]);
  return responseJson({ ok: true, claimId });
}

export async function updateWarrantyClaimRoute(db: SherDatabase, claimId: string, input: { status?: string; resolution?: string }, user: AuthUser): Promise<Response> {
  const status = cleanText(input?.status);
  const resolution = cleanText(input?.resolution);
  if (!['Resolved','Rejected','Cancelled'].includes(status)) return responseError('Choose Resolved, Rejected, or Cancelled.');
  if ((status === 'Resolved' || status === 'Rejected') && !resolution) return responseError('Resolution note is required.');
  const claim = await db.prepare(`SELECT claim_id AS claimId, warranty_id AS warrantyId, status FROM warranty_claims WHERE claim_id=? LIMIT 1`).bind(claimId).first<any>();
  if (!claim) return responseError('Warranty claim not found.', 404);
  if (String(claim.status) !== 'Open') return responseError('Only an open claim can be completed.');
  const warranty = await db.prepare(`SELECT warranty_end_date AS warrantyEndDate,status FROM warranty_records WHERE warranty_id=? LIMIT 1`).bind(claim.warrantyId).first<any>();
  const statements: SqlPreparedStatement[] = [
    db.prepare(`UPDATE warranty_claims SET status=?,resolution=?,updated_at=datetime('now') WHERE claim_id=?`).bind(status,resolution,claimId)
  ];
  if (warranty && String(warranty.status) !== 'Voided') {
    const otherOpen = await db.prepare(`SELECT 1 ok FROM warranty_claims WHERE warranty_id=? AND status='Open' AND claim_id<>? LIMIT 1`).bind(claim.warrantyId, claimId).first<any>();
    const nextStatus = otherOpen ? 'Claimed' : (String(warranty.warrantyEndDate || '') < todayIso() ? 'Expired' : 'Active');
    statements.push(db.prepare(`UPDATE warranty_records SET status=?,updated_at=datetime('now') WHERE warranty_id=?`).bind(nextStatus,claim.warrantyId));
  }
  statements.push(trackingAuditStatement(db, user, 'COMPLETE_WARRANTY_CLAIM', 'WARRANTY_CLAIM', claimId, `${status}; ${resolution || 'No resolution note'}`));
  await db.batch(statements);
  return responseJson({ ok: true, claimId, status });
}


export async function replaceWarrantyClaimRoute(
  db: SherDatabase,
  claimId: string,
  input: { replacementDate?: string; replacementSerialId?: string; note?: string },
  user: AuthUser
): Promise<Response> {
  const replacementDate = cleanText(input?.replacementDate) || todayIso();
  const replacementSerialId = cleanText(input?.replacementSerialId);
  const note = cleanText(input?.note);
  if (!isIsoDate(replacementDate)) return responseError('Enter a valid replacement date.');
  if (!replacementSerialId) return responseError('Select the replacement Serial / IMEI.');

  const claim = await db.prepare(`SELECT wc.claim_id AS claimId, wc.warranty_id AS warrantyId, wc.status AS claimStatus,
      wc.issue, wr.invoice_id AS invoiceId, wr.sale_date AS saleDate, wr.product_id AS productId,
      wr.product_name AS productName, wr.serial_id AS originalSerialId, wr.serial_number AS originalSerialNumber,
      wr.warranty_end_date AS warrantyEndDate, wr.status AS warrantyStatus
    FROM warranty_claims wc JOIN warranty_records wr ON wr.warranty_id=wc.warranty_id
    WHERE wc.claim_id=? LIMIT 1`).bind(claimId).first<any>();
  if (!claim) return responseError('Warranty claim not found.', 404);
  if (String(claim.claimStatus) !== 'Open') return responseError('Only an open warranty claim can be replaced.');
  if (!cleanText(claim.originalSerialId)) return responseError('Automatic replacement requires a serialized warranty item. Complete non-serialized claims without stock replacement.');
  if (replacementDate < String(claim.saleDate || '')) return responseError('Replacement date cannot be before the original sale date.');
  if (String(claim.warrantyStatus) === 'Voided') return responseError('This warranty is voided.');

  const existingReplacement = await db.prepare(`SELECT replacement_id AS replacementId FROM warranty_replacements WHERE claim_id=? LIMIT 1`).bind(claimId).first<any>();
  if (existingReplacement) return responseError('This claim already has a replacement record.');

  const original = await db.prepare(`SELECT ps.serial_id AS serialId, ps.serial_number AS serialNumber, ps.product_id AS productId,
      ps.lot_id AS lotId, COALESCE(ps.expiry_batch_id,'') AS expiryBatchId, ps.status,
      sl.original_quantity AS lotOriginalQuantity, sl.remaining_quantity AS lotRemainingQuantity
    FROM product_serials ps JOIN stock_lots sl ON sl.lot_id=ps.lot_id
    WHERE ps.serial_id=? LIMIT 1`).bind(claim.originalSerialId).first<any>();
  if (!original) return responseError('Original warranty Serial / IMEI record not found.', 404);
  const originalAtSupplier = String(original.status) === 'Warranty at Supplier';
  if (String(original.status) !== 'Sold' && !originalAtSupplier) return responseError(`Original Serial / IMEI is ${original.status}; expected Sold or Warranty at Supplier.`);

  const replacement = await db.prepare(`SELECT ps.serial_id AS serialId, ps.serial_number AS serialNumber, ps.product_id AS productId,
      ps.lot_id AS lotId, COALESCE(ps.expiry_batch_id,'') AS expiryBatchId, ps.status,
      sl.original_quantity AS lotOriginalQuantity, sl.remaining_quantity AS lotRemainingQuantity,
      eb.expiry_date AS expiryDate
    FROM product_serials ps JOIN stock_lots sl ON sl.lot_id=ps.lot_id
    LEFT JOIN stock_expiry_batches eb ON eb.expiry_batch_id=ps.expiry_batch_id
    WHERE ps.serial_id=? LIMIT 1`).bind(replacementSerialId).first<any>();
  if (!replacement) return responseError('Replacement Serial / IMEI not found.', 404);
  if (String(replacement.productId) !== String(claim.productId)) return responseError('Replacement Serial / IMEI must be for the same product.');
  if (String(replacement.status) !== 'In Stock') return responseError('Replacement Serial / IMEI is not available in stock.');
  if (replacement.expiryDate && String(replacement.expiryDate) < replacementDate) return responseError(`Replacement Serial / IMEI expired on ${replacement.expiryDate}.`);
  if (Number(replacement.lotRemainingQuantity || 0) < 1) return responseError('Replacement stock lot is no longer available.');

  const saleTracking = await db.prepare(`SELECT id, quantity, returned_quantity AS returnedQuantity
    FROM sale_item_tracking WHERE invoice_id=? AND serial_id=? AND returned_quantity<quantity LIMIT 1`).bind(claim.invoiceId, original.serialId).first<any>();
  if (!saleTracking) return responseError('The original sale tracking is no longer eligible for warranty replacement. It may already have been returned.');

  const product = await db.prepare(`SELECT current_stock AS currentStock FROM products WHERE product_id=? AND is_deleted=0 LIMIT 1`).bind(claim.productId).first<any>();
  if (!product) return responseError('Product not found.', 404);
  const physical = Number(product.currentStock || 0);
  const replacementLotAfter = Math.max(0, Number(replacement.lotRemainingQuantity || 0) - 1);
  const originalLotAfter = Math.min(Number(original.lotOriginalQuantity || 0), Number(original.lotRemainingQuantity || 0) + 1);
  const replacementId = `WRP-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  const resolution = `Warranty replacement: ${original.serialNumber} -> ${replacement.serialNumber}${note ? `; ${note}` : ''}`;
  const warrantyStatus = String(claim.warrantyEndDate || '') < replacementDate ? 'Expired' : 'Active';
  const statements: SqlPreparedStatement[] = [
    db.prepare(`UPDATE product_serials SET status='Sold',sale_invoice_id=?,sold_at=?,returned_at=NULL,updated_at=datetime('now') WHERE serial_id=?`).bind(claim.invoiceId, replacementDate, replacement.serialId),
    db.prepare(`UPDATE sale_item_tracking SET lot_id=?,serial_id=?,serial_number=?,expiry_batch_id=? WHERE id=?`).bind(replacement.lotId, replacement.serialId, replacement.serialNumber, replacement.expiryBatchId || null, saleTracking.id),
    db.prepare(`UPDATE warranty_records SET serial_id=?,serial_number=?,status=?,updated_at=datetime('now') WHERE warranty_id=?`).bind(replacement.serialId, replacement.serialNumber, warrantyStatus, claim.warrantyId),
    db.prepare(`UPDATE warranty_claims SET status='Resolved',resolution=?,updated_at=datetime('now') WHERE claim_id=?`).bind(resolution, claimId),
    db.prepare(`INSERT INTO warranty_replacements(replacement_id,claim_id,warranty_id,replacement_date,product_id,invoice_id,original_serial_id,original_serial_number,replacement_serial_id,replacement_serial_number,note,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(replacementId, claimId, claim.warrantyId, replacementDate, claim.productId, claim.invoiceId, original.serialId, original.serialNumber, replacement.serialId, replacement.serialNumber, note, user.fullName),
    trackingAuditStatement(db, user, 'WARRANTY_REPLACEMENT', 'WARRANTY_REPLACEMENT', replacementId, resolution)
  ];
  if (originalAtSupplier) {
    // The defective item is already physically away at the supplier. Only the replacement leaves our on-hand stock.
    const physicalAfter = Math.max(0, physical - 1);
    statements.push(
      db.prepare(`UPDATE products SET current_stock=?,updated_at=datetime('now') WHERE product_id=?`).bind(physicalAfter, claim.productId),
      db.prepare(`UPDATE stock_lots SET remaining_quantity=?,status=CASE WHEN ?>0 THEN 'Active' ELSE 'Depleted' END,updated_at=datetime('now') WHERE lot_id=?`).bind(replacementLotAfter, replacementLotAfter, replacement.lotId),
      db.prepare(`UPDATE supplier_warranty_rmas SET customer_handling='Already Replaced from Our Stock',updated_at=datetime('now') WHERE claim_id=? AND status='At Supplier'`).bind(claimId),
      db.prepare(`INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id)
        VALUES (?,?,'Warranty Replacement',0,1,?,?,?)`).bind(`SM-${crypto.randomUUID().slice(0,10).toUpperCase()}`, claim.productId, physicalAfter, `${claim.invoiceId}; claim ${claimId}; replacement ${replacement.serialNumber}; defective already at supplier`, replacement.lotId)
    );
    if (replacement.expiryBatchId) {
      statements.push(db.prepare(`UPDATE stock_expiry_batches SET remaining_quantity=MAX(0,remaining_quantity-1),updated_at=datetime('now') WHERE expiry_batch_id=?`).bind(replacement.expiryBatchId));
    }
  } else {
    statements.push(
      db.prepare(`UPDATE product_serials SET status='Warranty Hold',returned_at=?,updated_at=datetime('now') WHERE serial_id=?`).bind(replacementDate, original.serialId),
      db.prepare(`INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id)
        VALUES (?,?,'Warranty Return',1,0,?,?,?)`).bind(`SM-${crypto.randomUUID().slice(0,10).toUpperCase()}`, claim.productId, physical + 1, `${claim.invoiceId}; claim ${claimId}; defective ${original.serialNumber}`, original.lotId),
      db.prepare(`INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id)
        VALUES (?,?,'Warranty Replacement',0,1,?,?,?)`).bind(`SM-${crypto.randomUUID().slice(0,10).toUpperCase()}`, claim.productId, physical, `${claim.invoiceId}; claim ${claimId}; replacement ${replacement.serialNumber}`, replacement.lotId)
    );
    if (String(original.lotId) !== String(replacement.lotId)) {
      statements.push(
        db.prepare(`UPDATE stock_lots SET remaining_quantity=?,status='Active',updated_at=datetime('now') WHERE lot_id=?`).bind(originalLotAfter, original.lotId),
        db.prepare(`UPDATE stock_lots SET remaining_quantity=?,status=CASE WHEN ?>0 THEN 'Active' ELSE 'Depleted' END,updated_at=datetime('now') WHERE lot_id=?`).bind(replacementLotAfter, replacementLotAfter, replacement.lotId)
      );
    }
    if (original.expiryBatchId && String(original.expiryBatchId) !== String(replacement.expiryBatchId || '')) {
      statements.push(db.prepare(`UPDATE stock_expiry_batches SET remaining_quantity=MIN(original_quantity,remaining_quantity+1),updated_at=datetime('now') WHERE expiry_batch_id=?`).bind(original.expiryBatchId));
    }
    if (replacement.expiryBatchId && String(replacement.expiryBatchId) !== String(original.expiryBatchId || '')) {
      statements.push(db.prepare(`UPDATE stock_expiry_batches SET remaining_quantity=MAX(0,remaining_quantity-1),updated_at=datetime('now') WHERE expiry_batch_id=?`).bind(replacement.expiryBatchId));
    }
  }
  await db.batch(statements);
  return responseJson({ ok: true, replacementId, claimId, originalSerialNumber: original.serialNumber, replacementSerialNumber: replacement.serialNumber, warrantyStatus });
}

export function aggregateSaleTrackingDraws(draws: SaleTrackingDraw[]): { lots: Map<string,number>; batches: Map<string,number> } {
  const lots=new Map<string,number>(), batches=new Map<string,number>();
  for(const d of draws){lots.set(d.lotId,(lots.get(d.lotId)||0)+d.quantity);if(d.expiryBatchId)batches.set(d.expiryBatchId,(batches.get(d.expiryBatchId)||0)+d.quantity);}
  return {lots,batches};
}

function responseJson(data: unknown, status=200): Response { return new Response(JSON.stringify(data), { status, headers:{'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*'} }); }
function responseError(message:string,status=400):Response{return responseJson({ok:false,error:message},status);}
