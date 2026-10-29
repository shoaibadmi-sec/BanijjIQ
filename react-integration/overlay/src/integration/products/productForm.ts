import type { BackendProduct, BasicProductInput, ProductCatalogEdit } from '../banijjApi';

export const MOHIM_PRODUCT_FIELDS = [
  'productName','brand','category','unit','purchasePrice',
  'sellingPrice','currentStock','minimumStock','barcode'
] as const;
export type ProductField = typeof MOHIM_PRODUCT_FIELDS[number];
export type ProductDraft = Record<ProductField,string>;

export function draftFromProduct(row: BackendProduct | null): ProductDraft {
  return {
    productName: row?.productName ?? '', brand: row?.brand ?? '',
    category: row?.category ?? '', unit: row?.unit ?? '',
    purchasePrice: String(row?.purchasePrice ?? 0),
    sellingPrice: String(row?.sellingPrice ?? 0),
    currentStock: String(row?.currentStock ?? 0),
    minimumStock: String(row?.minimumStock ?? 0),
    barcode: row?.barcode ?? ''
  };
}
const clean=(value:unknown)=>String(value??'').trim();
function required(value: string, label: string): string {
  const v=clean(value);
  if(!v)throw new Error(label+' is required.');
  if(v.length>200)throw new Error(label+' is too long.');
  return v;
}
function amount(value: string, label: string, whole=false): number {
  const raw=clean(value);
  if(!raw)throw new Error(label+' is required.');
  if(!/^(?:\d+(?:\.\d{1,4})?|\.\d{1,4})$/.test(raw))
    throw new Error(label+' must be a valid nonnegative number with at most four decimal places.');
  const n=Number(raw);
  if(!Number.isFinite(n)||!Number.isSafeInteger(Math.round(n*10000)))
    throw new Error(label+' exceeds the safe numeric limit.');
  if(whole && !Number.isSafeInteger(n))throw new Error(label+' must be a whole number.');
  return n;
}
export function createPayload(draft: ProductDraft): BasicProductInput {
  return {
    productName: required(draft.productName,'Product name'),
    brand: clean(draft.brand).slice(0,200),
    category: required(draft.category,'Category'),
    unit: required(draft.unit,'Unit'),
    barcode: clean(draft.barcode).slice(0,200),
    purchasePrice: amount(draft.purchasePrice,'Purchase price'),
    sellingPrice: amount(draft.sellingPrice,'Selling price'),
    currentStock: amount(draft.currentStock,'Opening stock',true),
    minimumStock: amount(draft.minimumStock,'Minimum stock'),
    status:'Active', trackSerial:false,trackExpiry:false,trackWarranty:false,
    warrantyPeriodValue:0,warrantyPeriodUnit:'Months'
  };
}
export function editPayload(existing:BackendProduct, draft:ProductDraft): ProductCatalogEdit {
  if(!existing.updatedAt?.trim())throw new Error('Product revision missing. Refresh and retry.');
  if(draft.unit.trim()!==existing.unit)throw new Error('Base unit is locked and cannot be changed.');
  if(Number(draft.currentStock)!==existing.currentStock)
    throw new Error('Current stock must be changed using Adjust Stock.');
  const result=createPayload({...draft,currentStock:'0'});
  return {
    expectedUpdatedAt:existing.updatedAt,
    productName:result.productName,brand:result.brand,category:result.category,
    barcode:result.barcode,purchasePrice:result.purchasePrice,
    sellingPrice:result.sellingPrice,minimumStock:result.minimumStock
  };
}
type DeferredAction={enabled:false;reason:string};
export interface ProductActionPolicy {
  view:boolean;edit:boolean;adjustStock:boolean;lots:boolean;
  history:boolean;toggleStatus:boolean;
  delete:DeferredAction; offers:DeferredAction; addLot:DeferredAction; bundle:DeferredAction;
}
export function productActionPolicy(row:BackendProduct,canEdit:boolean):ProductActionPolicy {
  const supported=row.productType!=='Bundle';
  return {
    view:true,edit:canEdit&&supported,adjustStock:canEdit&&supported,
    lots:supported,history:supported,toggleStatus:canEdit&&supported,
    delete:{enabled:false,reason:'Delete is withheld until full reference and history checks are verified.'},
    offers:{enabled:false,reason:'Offers need a verified live pricing workflow.'},
    addLot:{enabled:false,reason:'Purchase lots require purchase accounting; use Purchases.'},
    bundle:{enabled:false,reason:'Bundle stock and FIFO accounting are not enabled in this React migration.'}
  };
}
