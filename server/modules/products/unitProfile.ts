/**
 * Canonical HisabIQ multi-unit calculations. These are independent of any demo store.
 * Unit order: largest -> smallest/base, e.g. CT -> BOX -> PCS.
 * Live accounting still uses integer quantities of the product's existing base unit.
 */
export type UnitEntry = {
  unit: string;
  symbol: string;
  containsNext: number | null;
  factor: number;
  sellingPrice: number;
};
export type UnitProfile = {
  baseUnit: string;
  units: UnitEntry[];
};
export type UnitProfileForm = {
  units: Array<{ unit: string; symbol: string; containsNext?: number | null; sellingPrice?: number }>;
  expectedRevision: number;
};

function label(raw: unknown, field: string, limit = 48): string {
  if (typeof raw !== 'string') throw new Error(field + ' must be text.');
  const text = raw.trim();
  if (!text || text.length > limit) throw new Error(field + ' is required and must be short.');
  return text;
}
function priceCents(raw: unknown, field: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 100000000 ||
      !Number.isSafeInteger(Math.round(raw * 100)) || Math.abs(raw * 100 - Math.round(raw * 100)) > 0.000001) {
    throw new Error(field + ' must be a valid nonnegative amount with at most 2 decimals.');
  }
  return Math.round(raw * 100);
}
function factor(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 2 || raw > 1000000) {
    throw new Error('Each conversion must contain 2–1,000,000 of the next smaller unit.');
  }
  return raw;
}
const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** Reject disconnected, duplicate, overflow, or contradictory unit chains. */
export function buildUnitProfile(raw: unknown, baseUnitRaw: string, baseSellingPrice: number): UnitProfile {
  const baseUnit = label(baseUnitRaw, 'Base unit');
  if (!raw || typeof raw !== 'object' || !('units' in raw)) throw new Error('Unit chain is required.');
  const entries = (raw as { units: unknown }).units;
  if (!Array.isArray(entries) || entries.length < 2 || entries.length > 4) {
    throw new Error('Choose between 2 and 4 units in largest-to-smallest order.');
  }
  const seenUnits = new Set<string>(), seenSymbols = new Set<string>();
  const parsed = entries.map((item: unknown, index: number) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid unit row.');
    const row = item as Record<string,unknown>;
    const unit = label(row.unit, 'Unit');
    const symbol = label(row.symbol, 'Unit symbol', 8);
    if (!/^[\p{L}\p{N}]{1,8}$/u.test(symbol)) throw new Error('Unit symbols must be 1–8 letters or numbers.');
    if (seenUnits.has(unit.toLowerCase()) || seenSymbols.has(symbol.toLowerCase())) {
      throw new Error('Unit names and symbols must be unique in a product chain.');
    }
    seenUnits.add(unit.toLowerCase());seenSymbols.add(symbol.toLowerCase());
    const isLast = index === entries.length - 1;
    let containsNext: number | null;
    if (isLast) {
      if (row.containsNext !== undefined && row.containsNext !== null && row.containsNext !== 1)
        throw new Error('The smallest unit must not convert to another unit.');
      containsNext = null;
    } else containsNext = factor(row.containsNext);
    return {unit,symbol,containsNext,priceRaw:row.sellingPrice};
  });
  if (!same(parsed[parsed.length - 1].unit, baseUnit))
    throw new Error('The last/smallest unit must match the product stock unit ('+baseUnit+').');
  parsed[parsed.length - 1].unit=baseUnit;
  const factors = Array<number>(parsed.length).fill(1);
  for (let i = parsed.length - 2; i >= 0; i--) {
    factors[i] = factors[i + 1] * (parsed[i].containsNext as number);
    if (!Number.isSafeInteger(factors[i]) || factors[i] > 1000000000)
      throw new Error('Unit conversion factor is too large.');
  }
  const baseCents=priceCents(baseSellingPrice,'Base product selling price');
  const units=parsed.map((row,index):UnitEntry=>{
    const defaultCents=baseCents*factors[index];
    if (!Number.isSafeInteger(defaultCents)) throw new Error('Default unit price overflows.');
    const cents=row.priceRaw===undefined ? defaultCents : priceCents(row.priceRaw,'Selling price for '+row.unit);
    return {unit:row.unit,symbol:row.symbol,containsNext:row.containsNext,
      factor:factors[index],sellingPrice:cents/100};
  });
  return {baseUnit,units};
}

/**
 * Preview-only arithmetic until the atomic sale-posting and invoice-snapshot gates exist.
 * No rounding of base inventory or hidden fractional stock.
 */
export function quoteUnitQuantities(profile: UnitProfile, quantities: Record<string,number>) {
  if (!quantities || typeof quantities !== 'object' || Array.isArray(quantities))throw new Error('Quantities must be a unit map.');
  const rows = profile.units.filter(x=>Object.hasOwn(quantities,x.unit));
  if (Object.keys(quantities).length !== rows.length) throw new Error('Unknown unit in quantity map.');
  let baseQuantity=0,amountCents=0;
  const parts:string[]=[];
  for(const row of rows){
    const q=quantities[row.unit];
    if (!Number.isSafeInteger(q) || q<0 || q>10000000) throw new Error('Enter whole nonnegative unit quantities.');
    if(q===0)continue;
    baseQuantity+=q*row.factor;
    amountCents+=q*Math.round(row.sellingPrice*100);
    if(!Number.isSafeInteger(baseQuantity)||baseQuantity>1000000000||
       !Number.isSafeInteger(amountCents)||amountCents>100000000000)
      throw new Error('Mixed-unit sale quantity or price is too large.');
    parts.push(String(q)+' '+row.symbol);
  }
  if(baseQuantity<=0)throw new Error('Enter at least one unit quantity.');
  return { baseQuantity, lineTotal: amountCents/100, description:parts.join(' '),
    entries:rows.filter(r=>quantities[r.unit]>0).map(r=>({
      unit:r.unit,symbol:r.symbol,quantity:quantities[r.unit],factor:r.factor,price:r.sellingPrice
    })) };
}
