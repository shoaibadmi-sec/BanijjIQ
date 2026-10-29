import type { SherDatabase } from '../../db/types.js';

export type UnitRelation = { unit: string; count: number; smallerUnit: string };
export type UnitRule = UnitRelation & { factor: number };
export type UnitQuantity = { unit: string; count: number };

function unit(value: unknown): string { return String(value ?? '').trim(); }

export function normalizeUnitChain(baseUnit: string, relations: UnitRelation[]): UnitRule[] {
  const base = unit(baseUnit);
  if (!base) throw new Error('Product must have a smallest stock unit.');
  if (!Array.isArray(relations) || relations.length > 8) throw new Error('Up to eight conversion levels are supported.');
  if (!relations.length) return [];
  const names = new Set<string>([base.toLocaleLowerCase()]);
  let child = base;
  let factor = 1;
  const result: UnitRule[] = [];
  // Accept natural entries from largest to smallest, e.g. 1 CT=12 BOX; 1 BOX=20 PCS.
  for (const [index, relation] of [...relations].reverse().entries()) {
    const large = unit(relation.unit);
    const smaller = unit(relation.smallerUnit);
    const count = Number(relation.count);
    if (!large || !smaller || large.length > 80 || smaller.length > 80) throw new Error('Unit names are required (up to 80 characters).');
    if (smaller.toLocaleLowerCase() !== child.toLocaleLowerCase()) throw new Error('Conversions must form one chain ending with the product stock unit.');
    if (names.has(large.toLocaleLowerCase())) throw new Error('The unit chain repeats a unit or contains a cycle.');
    if (!Number.isSafeInteger(count) || count < 2 || count > 1000000) throw new Error('Each conversion must be a whole number between 2 and 1,000,000.');
    factor *= count;
    if (!Number.isSafeInteger(factor) || factor > 1000000000) throw new Error('Conversion quantity is too large.');
    names.add(large.toLocaleLowerCase());
    result.push({ unit: large, count, smallerUnit: child, factor });
    child = large;
  }
  return result.reverse();
}

export function breakdownToBase(baseUnit: string, rules: UnitRule[], breakdown: UnitQuantity[]): number {
  if (!Array.isArray(breakdown) || breakdown.length > rules.length + 1) throw new Error('Invalid mixed-unit quantity.');
  const factors = new Map<string, number>([[unit(baseUnit).toLocaleLowerCase(), 1]]);
  for (const r of rules) factors.set(r.unit.toLocaleLowerCase(), r.factor);
  const seen = new Set<string>();
  let total = 0;
  for (const part of breakdown) {
    const name = unit(part.unit).toLocaleLowerCase();
    const count = Number(part.count);
    if (!factors.has(name)) throw new Error('Quantity uses an unconfigured unit.');
    if (seen.has(name)) throw new Error('A unit appears more than once in the quantity.');
    if (!Number.isSafeInteger(count) || count < 0 || count > 1000000000) throw new Error('Unit quantities must be nonnegative whole numbers.');
    seen.add(name);
    total += count * factors.get(name)!;
    if (!Number.isSafeInteger(total) || total > 1000000000) throw new Error('Total quantity exceeds the supported maximum.');
  }
  if (total < 1) throw new Error('Quantity must be greater than zero.');
  return total;
}

export async function listProductUnitRules(db: SherDatabase, productId: string): Promise<UnitRule[]> {
  const result = await db.prepare(`SELECT unit_name AS unit, smaller_unit AS smallerUnit, units_per_smaller AS count, base_factor AS factor
    FROM product_unit_conversions WHERE product_id = ? ORDER BY sort_order`).bind(productId).all<UnitRule>();
  return result.results || [];
}

export async function getProductUnitConfig(db: SherDatabase, productId: string): Promise<Response> {
  const product = await db.prepare('SELECT product_id,unit FROM products WHERE product_id=? AND is_deleted=0').bind(productId).first<{ product_id:string; unit:string }>();
  if (!product) return Response.json({ ok:false,error:'Product not found.' }, { status:404 });
  return Response.json({ ok:true,productId,baseUnit:product.unit,relations:await listProductUnitRules(db, productId) });
}

export async function saveProductUnitConfig(db: SherDatabase, productId: string, payload: { relations?: UnitRelation[] }): Promise<Response> {
  const product = await db.prepare('SELECT product_id,unit FROM products WHERE product_id=? AND is_deleted=0').bind(productId).first<{ product_id:string; unit:string }>();
  if (!product) return Response.json({ ok:false,error:'Product not found.' }, { status:404 });
  let rules: UnitRule[];
  try { rules = normalizeUnitChain(product.unit, payload.relations || []); }
  catch (e) { return Response.json({ ok:false,error:e instanceof Error?e.message:'Invalid unit configuration.' }, { status:400 }); }
  const statements = [
    db.prepare('DELETE FROM product_unit_conversions WHERE product_id=?').bind(productId),
    ...rules.map((item,i) => db.prepare(`INSERT INTO product_unit_conversions
      (product_id,unit_name,smaller_unit,units_per_smaller,base_factor,sort_order) VALUES (?,?,?,?,?,?)`)
      .bind(productId,item.unit,item.smallerUnit,item.count,item.factor,i))
  ];
  await db.batch(statements);
  return Response.json({ ok:true,productId,baseUnit:product.unit,relations:rules });
}

export async function validateSaleUnitBreakdown(db: SherDatabase, productId: string, baseUnit: string, raw: unknown, postedQty: number): Promise<UnitQuantity[]> {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error('Invalid sale unit breakdown.');
  const breakdown: UnitQuantity[] = raw.map((x: any) => ({ unit: unit(x?.unit), count: Number(x?.count) }));
  const rules = await listProductUnitRules(db, productId);
  if (!rules.length && breakdown.length) throw new Error('No multi-unit conversions are configured for this product.');
  if (!breakdown.length) return [];
  const calculated = breakdownToBase(baseUnit, rules, breakdown);
  if (calculated !== postedQty) throw new Error('Mixed-unit quantity does not match the posted stock quantity.');
  return breakdown;
}
