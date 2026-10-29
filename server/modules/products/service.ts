import type { SherDatabase } from '../../db/types.js';
import type { ProductInput, ProductRow } from './types.js';
import { getAvailabilityMap, prepareNewLotTracking, trackingEnabled } from './tracking.service.js';
import type { LotTrackingInput, WarrantyPeriodUnit } from './tracking.types.js';

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

async function normalizePreferredSupplierId(db: SherDatabase, value: unknown): Promise<string> {
  const supplierId = cleanText(value);
  if (!supplierId) return '';
  const row = await db.prepare(`SELECT supplier_id FROM suppliers WHERE supplier_id = ? AND status = 'Active' AND COALESCE(is_deleted,0) = 0 LIMIT 1`).bind(supplierId).first<{ supplier_id: string }>();
  if (!row) throw new Error('Preferred supplier not found or inactive.');
  return row.supplier_id;
}

async function nextLookupId(db: SherDatabase, table: string, idColumn: string, prefix: string): Promise<string> {
  const row = await db.prepare(`SELECT ${idColumn} AS id FROM ${table} WHERE ${idColumn} LIKE ? ORDER BY ${idColumn} DESC LIMIT 1`)
    .bind(`${prefix}-%`).first<{ id: string }>();
  const last = row?.id ? Number(row.id.replace(`${prefix}-`, '')) : 0;
  return `${prefix}-${String(last + 1).padStart(6, '0')}`;
}

async function nextProductId(db: SherDatabase): Promise<string> {
  const row = await db.prepare(`
    SELECT product_id
    FROM products
    WHERE product_id LIKE 'PRD-%'
    ORDER BY CAST(SUBSTR(product_id, 5) AS INTEGER) DESC
    LIMIT 1
  `).first<{ product_id: string }>();
  const last = row?.product_id ? Number(row.product_id.replace('PRD-', '')) : 0;
  return `PRD-${String(last + 1).padStart(6, '0')}`;
}

export async function ensureLookup(db: SherDatabase, table: 'product_categories' | 'product_brands' | 'product_units', name: string): Promise<{ id: string; name: string }> {
  const value = cleanText(name);
  if (!value) throw new Error('Name is required');
  const column = table === 'product_categories' ? 'category_name' : table === 'product_brands' ? 'brand_name' : 'unit_name';
  const prefix = table === 'product_categories' ? 'PCAT' : table === 'product_brands' ? 'PBRD' : 'PUNT';
  const idColumn = table === 'product_categories' ? 'category_id' : table === 'product_brands' ? 'brand_id' : 'unit_id';
  const existing = await db.prepare(`SELECT ${idColumn} AS id, ${column} AS name, status FROM ${table} WHERE LOWER(${column}) = LOWER(?) LIMIT 1`)
    .bind(value).first<{ id: string; name: string; status: string }>();
  if (existing) {
    if (existing.status !== 'Active') {
      await db.prepare(`UPDATE ${table} SET status = 'Active' WHERE ${idColumn} = ?`).bind(existing.id).run();
    }
    return { id: existing.id, name: existing.name };
  }
  const id = await nextLookupId(db, table, idColumn, prefix);
  await db.prepare(`INSERT INTO ${table} (${idColumn}, ${column}, status) VALUES (?, ?, 'Active')`).bind(id, value).run();
  return { id, name: value };
}

async function adjustStockToTarget(db: SherDatabase, product: ProductRow, newStock: number, reason: string, tracking?: LotTrackingInput): Promise<void> {
  const oldStock = qty(product.current_stock);
  const targetStock = qty(newStock);
  const diff = Math.round((targetStock - oldStock) * 10000) / 10000;
  if (diff === 0) return;

  if (diff > 0) {
    const lotId = crypto.randomUUID();
    const prepared = await prepareNewLotTracking(db, product, lotId, diff, tracking, true);
    await db.batch([
      db.prepare(`INSERT INTO stock_lots
        (lot_id, product_id, source_type, source_ref, original_quantity, remaining_quantity, unit_cost, tracking_required_quantity, tracking_status, created_at)
        VALUES (?, ?, 'OPENING_ADJUSTMENT', 'PRODUCT_EDIT', ?, ?, ?, ?, ?, datetime('now'))`)
        .bind(lotId, product.product_id, diff, diff, money(product.purchase_price), trackingEnabled(product) ? Math.max(0, diff - prepared.assignedQuantity) : 0, prepared.status),
      ...prepared.statements,
      db.prepare(`INSERT INTO stock_movements
        (movement_id, product_id, movement_type, quantity_in, quantity_out, balance_after, note, lot_id, created_at)
        VALUES (?, ?, 'STOCK_IN_ADJUSTMENT', ?, 0, ?, ?, ?, datetime('now'))`)
        .bind(crypto.randomUUID(), product.product_id, diff, targetStock, reason, lotId)
    ]);
    return;
  }

  if (trackingEnabled(product)) throw new Error('Tracked stock cannot be reduced by a manual quantity adjustment. Use the tracked Serial / Expiry workflow or a return transaction.');
  let remainingToRemove = Math.abs(diff);
  const lots = await db.prepare(`SELECT lot_id, remaining_quantity FROM stock_lots WHERE product_id = ? AND remaining_quantity > 0 ORDER BY created_at ASC, id ASC`).bind(product.product_id).all<{ lot_id: string; remaining_quantity: number }>();
  for (const lot of lots.results ?? []) {
    if (remainingToRemove <= 0) break;
    const take = Math.min(Number(lot.remaining_quantity), remainingToRemove);
    await db.prepare(`UPDATE stock_lots SET remaining_quantity = remaining_quantity - ?, updated_at = datetime('now') WHERE lot_id = ?`).bind(take, lot.lot_id).run();
    remainingToRemove = Math.round((remainingToRemove - take) * 10000) / 10000;
  }
  await db.prepare(`INSERT INTO stock_movements
      (movement_id, product_id, movement_type, quantity_in, quantity_out, balance_after, note, created_at)
    VALUES (?, ?, 'STOCK_OUT_ADJUSTMENT', 0, ?, ?, ?, datetime('now'))`)
    .bind(crypto.randomUUID(), product.product_id, Math.abs(diff), targetStock, reason).run();
}

export async function getProductsBootstrap(db: SherDatabase): Promise<Response> {
  const [products, categories, brands, units, suppliers, bankAccounts] = await Promise.all([
    db.prepare(`
      SELECT p.product_id AS productId, p.product_name AS productName, COALESCE(p.brand,'') AS brand,
             CASE WHEN TRIM(COALESCE(p.brand,'')) <> '' THEN TRIM(p.brand) || ' ' || p.product_name ELSE p.product_name END AS displayName, p.category, p.unit,
             COALESCE(p.barcode, '') AS barcode,
             p.purchase_price AS purchasePrice, p.selling_price AS sellingPrice,
             p.current_stock AS currentStock, p.minimum_stock AS minimumStock,
             p.track_serial AS trackSerial, p.track_expiry AS trackExpiry, p.track_warranty AS trackWarranty,
             p.warranty_period_value AS warrantyPeriodValue, p.warranty_period_unit AS warrantyPeriodUnit,
             ROUND(p.current_stock * p.purchase_price, 4) AS stockValue,
             COALESCE(p.preferred_supplier_id, '') AS preferredSupplierId,
             COALESCE(s.supplier_name, '') AS preferredSupplierName,
             p.status, p.created_at AS createdAt, p.updated_at AS updatedAt
      FROM products p
      LEFT JOIN suppliers s ON s.supplier_id = p.preferred_supplier_id
        AND s.status = 'Active' AND COALESCE(s.is_deleted,0)=0
      WHERE p.is_deleted = 0
      ORDER BY p.product_name COLLATE NOCASE ASC
    `).all(),
    db.prepare(`SELECT category_id AS id, category_name AS name FROM product_categories WHERE status = 'Active' ORDER BY category_name COLLATE NOCASE ASC`).all(),
    db.prepare(`SELECT brand_id AS id, brand_name AS name FROM product_brands WHERE status = 'Active' ORDER BY brand_name COLLATE NOCASE ASC`).all(),
    db.prepare(`SELECT unit_id AS id, unit_name AS name FROM product_units WHERE status = 'Active' ORDER BY unit_name COLLATE NOCASE ASC`).all(),
    db.prepare(`SELECT supplier_id AS id, supplier_name AS name, current_due AS currentDue FROM suppliers WHERE status = 'Active' AND is_deleted = 0 ORDER BY supplier_name COLLATE NOCASE ASC`).all(),
    db.prepare(`SELECT bank_account_id AS id, account_name AS name, account_type AS accountType FROM bank_accounts WHERE status = 'Active' ORDER BY account_name COLLATE NOCASE ASC`).all()
  ]);

  const availability = await getAvailabilityMap(db);
  const productRows = (products.results ?? []).map((p: any) => ({ ...p,
    sellableStock: availability.get(String(p.productId))?.sellable ?? Number(p.currentStock || 0),
    pendingTracking: availability.get(String(p.productId))?.pending ?? 0,
    expiredStock: availability.get(String(p.productId))?.expired ?? 0
  }));

  return json({
    ok: true,
    products: productRows,
    categories: categories.results ?? [],
    brands: brands.results ?? [],
    units: units.results ?? [],
    suppliers: suppliers.results ?? [],
    bankAccounts: bankAccounts.results ?? [],
    lowStockThreshold: 5,
    currencySymbol: '৳'
  });
}

/** Reject malformed values before any D1 write; zero cost/stock remain valid. */
function strictQuantity(value: unknown, field: string): number {
  if (value === null || value === '' || (typeof value !== 'number' && typeof value !== 'string') ||
      !Number.isFinite(Number(value)) || Number(value) < 0 ||
      !Number.isSafeInteger(Math.round(Number(value) * 10000))) {
    throw new Error(field + ' must be a finite nonnegative number within safe range.');
  }
  return Math.round(Number(value) * 10000) / 10000;
}

/** Lookups must be part of the SAME transaction as the product and its stock. */
async function planLookup(db: SherDatabase, table: 'product_brands' | 'product_categories' | 'product_units', name: string) {
  if (!name) return [];
  const field = table === 'product_brands' ? 'brand_name' : table === 'product_categories' ? 'category_name' : 'unit_name';
  const idField = table === 'product_brands' ? 'brand_id' : table === 'product_categories' ? 'category_id' : 'unit_id';
  const prefix = table === 'product_brands' ? 'PBRD' : table === 'product_categories' ? 'PCAT' : 'PUNT';
  const current = await db.prepare(`SELECT ${idField} AS id,status FROM ${table} WHERE LOWER(${field})=LOWER(?) LIMIT 1`).bind(name).first<{id:string;status:string}>();
  if (current) return current.status === 'Active' ? [] : [
    db.prepare(`UPDATE ${table} SET status='Active' WHERE ${idField}=?`).bind(current.id)
  ];
  const id = await nextLookupId(db, table, idField, prefix);
  return [db.prepare(`INSERT INTO ${table} (${idField},${field},status) VALUES (?,?,'Active')`).bind(id, name)];
}

export async function createProduct(db: SherDatabase, input: ProductInput): Promise<Response> {
  if (!input || typeof input !== 'object') return error('Product data is required');
  const productName = cleanText(input.productName);
  const brand = cleanText(input.brand), category = cleanText(input.category);
  const unit = cleanText(input.unit), barcode = cleanText(input.barcode);
  if (!productName || !category || !unit) return error('Product name, category and unit are required');
  if ([productName,brand,category,unit,barcode].some(x=>x.length>200)) return error('Product field is too long');
  let purchasePrice:number,sellingPrice:number,currentStock:number,minimumStock:number;
  try {
    purchasePrice = strictQuantity(input.purchasePrice ?? 0,'Purchase price');
    sellingPrice = strictQuantity(input.sellingPrice ?? 0,'Selling price');
    currentStock = strictQuantity(input.currentStock ?? 0,'Opening stock');
    minimumStock = strictQuantity(input.minimumStock ?? 0,'Minimum stock');
  } catch(e) { return error(e instanceof Error ? e.message : 'Invalid product number'); }
  if (input.status !== undefined && input.status !== 'Active' && input.status !== 'Inactive') return error('Invalid product status');
  const trackSerial = input.trackSerial ? 1 : 0, trackExpiry = input.trackExpiry ? 1 : 0;
  const trackWarranty = input.trackWarranty ? 1 : 0;
  if (trackSerial && !Number.isInteger(currentStock)) return error('Serial-tracked opening stock must be a whole number');
  const warrantyPeriodValue=trackWarranty ? Number(input.warrantyPeriodValue ?? 0):0;
  if (!Number.isSafeInteger(warrantyPeriodValue) || warrantyPeriodValue<0) return error('Invalid warranty duration');
  const warrantyPeriodUnit:WarrantyPeriodUnit=['Days','Months','Years'].includes(String(input.warrantyPeriodUnit)) ?
    input.warrantyPeriodUnit as WarrantyPeriodUnit : 'Months';
  const rawSerials = [
    ...(Array.isArray(input.openingTracking?.serialNumbers) ? input.openingTracking!.serialNumbers! : []),
    ...(Array.isArray(input.openingTracking?.expiryBatches) ?
      input.openingTracking!.expiryBatches!.flatMap(b => Array.isArray(b.serialNumbers) ? b.serialNumbers : []) : [])
  ].map(x=>cleanText(x).toLowerCase()).filter(Boolean);
  if (new Set(rawSerials).size !== rawSerials.length) return error('Duplicate Serial / IMEI in opening stock');
  if (!trackSerial && rawSerials.length) return error('Serial metadata requires serial tracking');
  if (!trackExpiry && input.openingTracking?.expiryBatches?.length) return error('Expiry metadata requires expiry tracking');
  const duplicate=await db.prepare("SELECT product_id FROM products WHERE LOWER(product_name)=LOWER(?) AND is_deleted=0 LIMIT 1").bind(productName).first();
  if (duplicate) return error('Product name already exists');
  if (barcode) {
    const conflicting=await db.prepare('SELECT product_id FROM products WHERE barcode=? AND is_deleted=0 LIMIT 1').bind(barcode).first();
    if (conflicting) return error('Barcode already exists');
  }
  let preferredSupplierId='';
  try {preferredSupplierId=await normalizePreferredSupplierId(db,input.preferredSupplierId);} catch(e) {
    return error(e instanceof Error ? e.message : 'Preferred supplier is invalid');
  }
  const productId=await nextProductId(db);
  const lotId=crypto.randomUUID();
  let tracking:Awaited<ReturnType<typeof prepareNewLotTracking>>|null=null;
  try {
    if (currentStock>0) {
      tracking=await prepareNewLotTracking(db,{
        product_id:productId,product_name:productName,track_serial:trackSerial,track_expiry:trackExpiry,
        track_warranty:trackWarranty,warranty_period_value:warrantyPeriodValue,
        warranty_period_unit:warrantyPeriodUnit
      },lotId,currentStock,input.openingTracking,true);
    }
  } catch(e) { return error(e instanceof Error ? e.message : 'Invalid opening tracking'); }
  try {
    const statements = [
      db.prepare(`INSERT INTO products
        (product_id,product_name,brand,category,unit,barcode,purchase_price,selling_price,current_stock,minimum_stock,preferred_supplier_id,status,
         track_serial,track_expiry,track_warranty,warranty_period_value,warranty_period_unit,is_deleted,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,datetime('now'),datetime('now'))`)
       .bind(productId,productName,brand,category,unit,barcode,purchasePrice,sellingPrice,currentStock,minimumStock,
         preferredSupplierId,input.status==='Inactive'?'Inactive':'Active',
         trackSerial,trackExpiry,trackWarranty,warrantyPeriodValue,warrantyPeriodUnit),
      ...await planLookup(db,'product_brands',brand),
      ...await planLookup(db,'product_categories',category),
      ...await planLookup(db,'product_units',unit)
    ];
    if (currentStock>0 && tracking) {
      statements.push(db.prepare(`INSERT INTO stock_lots
        (lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost,tracking_required_quantity,tracking_status,created_at)
        VALUES (?,?,'OPENING_ADJUSTMENT','PRODUCT_EDIT',?,?,?,?,?,datetime('now'))`)
        .bind(lotId,productId,currentStock,currentStock,purchasePrice,
          (trackSerial||trackExpiry)?Math.max(0,currentStock-tracking.assignedQuantity):0,tracking.status));
      statements.push(...tracking.statements);
      statements.push(db.prepare(`INSERT INTO stock_movements
        (movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id,created_at)
        VALUES (?,?,'STOCK_IN_ADJUSTMENT',?,0,?,?,?,datetime('now'))`)
        .bind(crypto.randomUUID(),productId,currentStock,currentStock,'Initial opening stock from Product form',lotId));
    }
    await db.batch(statements);
  } catch(e) {
    const message=e instanceof Error?e.message:'Product creation failed';
    return error(/unique|constraint|duplicate|already exists/i.test(message) ?
      'Concurrent product/lookup conflict. Refresh and retry.' : 'Product creation failed. No changes saved.',409);
  }
  return json({ok:true,productId});
}

export async function updateProduct(db: SherDatabase, productId: string, input: ProductInput): Promise<Response> {
  const existing = await db.prepare(`SELECT * FROM products WHERE product_id = ? AND is_deleted = 0`).bind(productId).first<ProductRow>();
  if (!existing) return error('Product not found', 404);

  const productName = cleanText(input.productName);
  const brand = cleanText(input.brand);
  const category = cleanText(input.category);
  const unit = cleanText(input.unit);
  const barcode = cleanText(input.barcode);
  if (!productName) return error('Product name is required');
  if (!category) return error('Category is required');
  if (!unit) return error('Unit is required');

  const duplicate = await db.prepare(`
    SELECT product_id FROM products
    WHERE LOWER(product_name) = LOWER(?) AND product_id <> ? AND is_deleted = 0
    LIMIT 1
  `).bind(productName, productId).first();
  if (duplicate) return error('Another product already uses this name');

  if (barcode) {
    const barcodeDuplicate = await db.prepare(`SELECT product_id FROM products WHERE barcode = ? AND product_id <> ? AND is_deleted = 0 LIMIT 1`).bind(barcode, productId).first();
    if (barcodeDuplicate) return error('Another product already uses this barcode');
  }

  const newStock = qty(input.currentStock);
  const nextTrackSerial = input.trackSerial ? 1 : 0;
  const nextTrackExpiry = input.trackExpiry ? 1 : 0;
  const nextTrackWarranty = input.trackWarranty ? 1 : 0;
  const nextWarrantyValue = nextTrackWarranty ? Math.max(0, Math.round(Number(input.warrantyPeriodValue || 0))) : 0;
  const nextWarrantyUnit: WarrantyPeriodUnit = ['Days','Months','Years'].includes(String(input.warrantyPeriodUnit)) ? input.warrantyPeriodUnit as WarrantyPeriodUnit : 'Months';
  const trackingModeChanged = nextTrackSerial !== Number(existing.track_serial || 0) || nextTrackExpiry !== Number(existing.track_expiry || 0);
  if (trackingModeChanged) {
    const sold = await db.prepare(`SELECT 1 AS x FROM sale_items WHERE product_id=? LIMIT 1`).bind(productId).first();
    if (sold) return error('Serial / Expiry tracking mode cannot be changed after this product has sales history.');
  }
  let preferredSupplierId = '';
  try { preferredSupplierId = await normalizePreferredSupplierId(db, input.preferredSupplierId); }
  catch (err) { return error(err instanceof Error ? err.message : 'Preferred supplier is invalid.'); }

  await db.prepare(`
    UPDATE products
    SET product_name = ?, brand = ?, category = ?, unit = ?, barcode = ?, purchase_price = ?, selling_price = ?,
        minimum_stock = ?, preferred_supplier_id = ?, status = ?, track_serial=?, track_expiry=?, track_warranty=?, warranty_period_value=?, warranty_period_unit=?, updated_at = datetime('now')
    WHERE product_id = ?
  `).bind(
    productName,
    brand,
    category,
    unit,
    barcode,
    money(input.purchasePrice),
    money(input.sellingPrice),
    qty(input.minimumStock),
    preferredSupplierId,
    input.status === 'Inactive' ? 'Inactive' : 'Active',
    nextTrackSerial, nextTrackExpiry, nextTrackWarranty, nextWarrantyValue, nextWarrantyUnit,
    productId
  ).run();

  if (trackingModeChanged) {
    if (nextTrackSerial || nextTrackExpiry) {
      await db.prepare(`UPDATE stock_lots SET tracking_status='Pending', tracking_required_quantity=remaining_quantity, updated_at=datetime('now') WHERE product_id=? AND remaining_quantity>0`).bind(productId).run();
    } else {
      await db.batch([
        db.prepare(`DELETE FROM product_serials WHERE product_id=? AND status='In Stock'`).bind(productId),
        db.prepare(`DELETE FROM stock_expiry_batches WHERE product_id=?`).bind(productId),
        db.prepare(`UPDATE stock_lots SET tracking_status='Ready', tracking_required_quantity=0, updated_at=datetime('now') WHERE product_id=? AND remaining_quantity>0`).bind(productId)
      ]);
    }
  }

  const updatedBase = await db.prepare(`SELECT * FROM products WHERE product_id = ?`).bind(productId).first<ProductRow>();
  if (updatedBase) {
    await adjustStockToTarget(db, { ...updatedBase, current_stock: existing.current_stock }, newStock, 'Manual stock edit from Product module', input.stockTracking || input.openingTracking);
    await db.prepare(`UPDATE products SET current_stock = ?, updated_at = datetime('now') WHERE product_id = ?`).bind(newStock, productId).run();
  }

  if (brand) await ensureLookup(db, 'product_brands', brand);
  await ensureLookup(db, 'product_categories', category);
  await ensureLookup(db, 'product_units', unit);
  return json({ ok: true });
}

export async function adjustStockByDelta(db: SherDatabase, productId: string, deltaValue: unknown, note: string): Promise<Response> {
  const product=await db.prepare('SELECT * FROM products WHERE product_id=? AND is_deleted=0')
    .bind(productId).first<ProductRow>();
  if (!product) return error('Product not found',404);
  const delta=Number(deltaValue);
  if (deltaValue === null || deltaValue === undefined || deltaValue === '' ||
      !Number.isFinite(delta) || delta === 0 ||
      !Number.isSafeInteger(Math.round(delta*10000)) ||
      Math.abs(delta - Math.round(delta*10000)/10000)>1e-8) {
    return error('Adjustment must be a finite non-zero quantity with at most four decimals.');
  }
  const oldStock=Number(product.current_stock);
  const newStock=Math.round((oldStock+delta)*10000)/10000;
  if (!Number.isFinite(newStock) || !Number.isSafeInteger(Math.round(newStock*10000)) || newStock<0) {
    return error('Stock cannot become negative or exceed safe quantity.');
  }
  if (delta<0 && trackingEnabled(product)) {
    return error('Tracked stock cannot be removed by quantity adjustment. Use the tracked workflow.');
  }
  const lots=await db.prepare(`SELECT lot_id,remaining_quantity,source_type
    FROM stock_lots WHERE product_id=? ORDER BY created_at ASC,id ASC`)
    .bind(productId).all<{lot_id:string;remaining_quantity:number;source_type:string}>();
  const rows=lots.results??[];
  const physical=rows.reduce((total,l)=>total+Number(l.remaining_quantity||0),0);
  if (Math.abs(physical-oldStock)>0.0001) {
    return error('Stock lot/master balances do not match. Reconcile before adjusting.',409);
  }
  let remaining=-delta;
  const lotStatements: ReturnType<SherDatabase['prepare']>[]=[];
  let movementLotId: string | null=null;
  if (delta<0) {
    for (const lot of rows) {
      if (remaining<=0) break;
      if (Number(lot.remaining_quantity)<=0 || lot.source_type==='OVERSOLD') continue;
      const taken=Math.min(remaining,Number(lot.remaining_quantity));
      // The ordinary FIFO lot trigger rejects a stale draw that would go negative;
      // the entire db.batch transaction (including master and movement) rolls back.
      lotStatements.push(db.prepare(`UPDATE stock_lots
        SET remaining_quantity=remaining_quantity-?,updated_at=datetime('now')
        WHERE lot_id=?`).bind(taken,lot.lot_id));
      remaining=Math.round((remaining-taken)*10000)/10000;
    }
    if (remaining>0) return error('Insufficient available FIFO stock.');
  } else {
    movementLotId=crypto.randomUUID();
    let tracking:Awaited<ReturnType<typeof prepareNewLotTracking>>;
    try {tracking=await prepareNewLotTracking(db,product,movementLotId,delta,undefined,true);}
    catch(e) {return error(e instanceof Error?e.message:'Tracking validation failed');}
    lotStatements.push(db.prepare(`INSERT INTO stock_lots
      (lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost,tracking_required_quantity,tracking_status,created_at)
      VALUES (?,?,'OPENING_ADJUSTMENT','MANUAL_ADJUSTMENT',?,?,?,?,?,datetime('now'))`)
      .bind(movementLotId,productId,delta,delta,money(product.purchase_price),
        trackingEnabled(product)?Math.max(0,delta-tracking.assignedQuantity):0,tracking.status));
    lotStatements.push(...tracking.statements);
  }
  try {
    await db.batch([
      // Conditional expression fails with a SQL error on a stale snapshot, preventing lost updates.
      db.prepare(`UPDATE products SET current_stock=CASE WHEN current_stock=? THEN ?
        ELSE json_extract('STALE_STOCK_SNAPSHOT','$') END, updated_at=datetime('now')
        WHERE product_id=? AND is_deleted=0`).bind(oldStock,newStock,productId),
      ...lotStatements,
      db.prepare(`INSERT INTO stock_movements
        (movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,datetime('now'))`).bind(
          crypto.randomUUID(),productId,delta>0?'STOCK_IN_ADJUSTMENT':'STOCK_OUT_ADJUSTMENT',
          Math.max(delta,0),Math.max(-delta,0),newStock,cleanText(note)||'Manual stock adjustment',movementLotId)
    ]);
  } catch(e) {
    return error('Stock changed during adjustment or lot update failed. Refresh and retry.',409);
  }
  return json({ok:true});
}

export async function setProductStatus(db: SherDatabase, productId: string, status: string): Promise<Response> {
  if (status!=='Active' && status!=='Inactive') return error('Invalid product status');
  const result=await db.prepare(`UPDATE products SET status=?,updated_at=datetime('now')
    WHERE product_id=? AND is_deleted=0`).bind(status,productId).run();
  if (!result.success) return error('Status update failed');
  if (Number(result.meta.changes)!==1) return error('Product not found',404);
  return json({ok:true});
}

export async function deleteProduct(db: SherDatabase, productId: string): Promise<Response> {
  const product = await db.prepare(`SELECT * FROM products WHERE product_id = ? AND is_deleted = 0`).bind(productId).first<ProductRow>();
  if (!product) return error('Product not found', 404);
  if (Number(product.current_stock) !== 0) return error('Product has stock. Set stock to 0 or deactivate instead.');
  await db.prepare(`UPDATE products SET is_deleted = 1, status = 'Inactive', updated_at = datetime('now') WHERE product_id = ?`).bind(productId).run();
  return json({ ok: true });
}

export async function getProductLots(db: SherDatabase, productId: string): Promise<Response> {
  const lots = await db.prepare(`
    SELECT lot_id AS lotId,
           source_ref AS purchaseId,
           NULL AS supplierName,
           created_at AS purchaseDate,
           unit_cost AS purchasePrice,
           original_quantity AS originalQuantity,
           remaining_quantity AS remainingQuantity
    FROM stock_lots
    WHERE product_id = ?
    ORDER BY created_at DESC, id DESC
  `).bind(productId).all();
  return json({ ok: true, lots: lots.results ?? [] });
}

/** Read-only ledger of persisted stock movements; never synthesize history IDs. */
export async function getProductHistory(db: SherDatabase, productId: string): Promise<Response> {
  const found=await db.prepare('SELECT product_id FROM products WHERE product_id=? AND is_deleted=0')
    .bind(productId).first();
  if (!found) return error('Product not found',404);
  const movements=await db.prepare(`SELECT movement_id AS movementId,created_at AS date,
    movement_type AS type,quantity_in AS quantityIn,quantity_out AS quantityOut,
    balance_after AS balanceAfter,COALESCE(note,'') AS note,lot_id AS lotId
    FROM stock_movements WHERE product_id=? ORDER BY created_at DESC,id DESC`)
    .bind(productId).all();
  return json({ok:true,items:movements.results??[]});
}

export async function listLookups(db: SherDatabase, kind: 'category' | 'brand' | 'unit'): Promise<Response> {
  const table = kind === 'category' ? 'product_categories' : kind === 'brand' ? 'product_brands' : 'product_units';
  const idColumn = kind === 'category' ? 'category_id' : kind === 'brand' ? 'brand_id' : 'unit_id';
  const nameColumn = kind === 'category' ? 'category_name' : kind === 'brand' ? 'brand_name' : 'unit_name';
  const rows = await db.prepare(`SELECT ${idColumn} AS id, ${nameColumn} AS name, status FROM ${table} ORDER BY ${nameColumn} COLLATE NOCASE ASC`).all();
  return json({ ok: true, items: rows.results ?? [] });
}

export async function addLookup(db: SherDatabase, kind: 'category' | 'brand' | 'unit', body: { name?: string }): Promise<Response> {
  const item = await ensureLookup(db, kind === 'category' ? 'product_categories' : kind === 'brand' ? 'product_brands' : 'product_units', cleanText(body.name));
  return json({ ok: true, ...item });
}

export async function updateLookup(db: SherDatabase, kind: 'category' | 'brand' | 'unit', id: string, body: { name?: string }): Promise<Response> {
  const table = kind === 'category' ? 'product_categories' : kind === 'brand' ? 'product_brands' : 'product_units';
  const idColumn = kind === 'category' ? 'category_id' : kind === 'brand' ? 'brand_id' : 'unit_id';
  const nameColumn = kind === 'category' ? 'category_name' : kind === 'brand' ? 'brand_name' : 'unit_name';
  const name = cleanText(body.name);
  if (!name) return error('Name is required.');
  const existing = await db.prepare(`SELECT ${idColumn} AS id FROM ${table} WHERE ${idColumn} = ? LIMIT 1`).bind(id).first();
  if (!existing) return error(`${kind === 'category' ? 'Category' : kind === 'brand' ? 'Brand' : 'Unit'} not found.`, 404);
  const duplicate = await db.prepare(`SELECT ${idColumn} AS id FROM ${table} WHERE lower(${nameColumn}) = lower(?) AND ${idColumn} <> ? LIMIT 1`).bind(name, id).first();
  if (duplicate) return error(`A ${kind} with this name already exists.`);
  await db.prepare(`UPDATE ${table} SET ${nameColumn} = ? WHERE ${idColumn} = ?`).bind(name, id).run();
  return json({ ok: true, id, name });
}

export async function setLookupStatus(db: SherDatabase, kind: 'category' | 'brand' | 'unit', id: string, status: string): Promise<Response> {
  const table = kind === 'category' ? 'product_categories' : kind === 'brand' ? 'product_brands' : 'product_units';
  const column = kind === 'category' ? 'category_id' : kind === 'brand' ? 'brand_id' : 'unit_id';
  const next = status === 'Inactive' ? 'Inactive' : 'Active';
  await db.prepare(`UPDATE ${table} SET status = ? WHERE ${column} = ?`).bind(next, id).run();
  return json({ ok: true });
}
