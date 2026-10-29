import type { SherDatabase } from '../../db/types.js';
import { ensureLookup } from './service.js';

type CatalogInput = {
  expectedUpdatedAt?: unknown;
  productName?: unknown; brand?: unknown; category?: unknown; barcode?: unknown;
  purchasePrice?: unknown; sellingPrice?: unknown; minimumStock?: unknown;
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8' }
});
const fail = (message: string, status = 400) => json({ ok: false, error: message }, status);
const clean = (v: unknown) => String(v ?? '').trim();
function amount(value: unknown, field: string): number {
  // Reject rather than silently normalize invalid/negative prices or quantities.
  if (value === '' || value === null || value === undefined ||
      !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new Error(field + ' must be a valid nonnegative number.');
  }
  const rounded = Math.round(Number(value) * 10000) / 10000;
  if (!Number.isSafeInteger(Math.round(Number(value) * 10000))) {
    throw new Error(field + ' is too large.');
  }
  return rounded;
}
/** Update catalog metadata only. Never use stale frontend stock values to change lots or balances. */
export async function updateProductCatalog(db: SherDatabase, id: string, input: CatalogInput): Promise<Response> {
  if (!input || typeof input !== 'object') return fail('Invalid product data.');
  const name = clean(input.productName), category = clean(input.category);
  const brand = clean(input.brand), barcode = clean(input.barcode);
  const version = clean(input.expectedUpdatedAt);
  if (!version) return fail('Product revision is required. Refresh before editing.', 409);
  if (!name || !category) return fail('Product name and category are required.');
  if ([name, brand, category, barcode].some(s => s.length > 200)) return fail('A product field is too long.');
  let purchasePrice:number, sellingPrice:number, minimumStock:number;
  try {
    purchasePrice = amount(input.purchasePrice, 'Purchase price');
    sellingPrice = amount(input.sellingPrice, 'Selling price');
    minimumStock = amount(input.minimumStock, 'Minimum stock');
  } catch (e) { return fail(e instanceof Error ? e.message : 'Invalid amount.'); }

  const existing = await db.prepare(
    'SELECT product_id,updated_at FROM products WHERE product_id=? AND is_deleted=0'
  ).bind(id).first<{product_id:string;updated_at:string}>();
  if (!existing) return fail('Product not found.', 404);
  if (existing.updated_at !== version) return fail('Product changed since you opened it. Refresh and try again.', 409);
  const duplicate = await db.prepare(
    'SELECT product_id FROM products WHERE LOWER(product_name)=LOWER(?) AND product_id<>? AND is_deleted=0 LIMIT 1'
  ).bind(name,id).first();
  if (duplicate) return fail('Another product already uses this name.');
  if (barcode) {
    const duplicateBarcode = await db.prepare(
      'SELECT product_id FROM products WHERE barcode=? AND product_id<>? AND is_deleted=0 LIMIT 1'
    ).bind(barcode,id).first();
    if (duplicateBarcode) return fail('Another product already uses this barcode.');
  }
  // Conditional SQL prevents stale catalog edits from overwriting another user's changes.
  const result = await db.prepare(
    "UPDATE products SET product_name=?,brand=?,category=?,barcode=?,purchase_price=?,selling_price=?,"+
    "minimum_stock=?,updated_at=strftime('%Y-%m-%d %H:%M:%f','now') "+
    "WHERE product_id=? AND is_deleted=0 AND updated_at=?"
  ).bind(name,brand,category,barcode,purchasePrice,sellingPrice,minimumStock,id,version).run();
  if (Number(result.meta.changes) !== 1) return fail('Concurrent change detected. Refresh and try again.', 409);
  if (brand) await ensureLookup(db, 'product_brands', brand);
  await ensureLookup(db, 'product_categories', category);
  return json({ ok: true, productId: id });
}
