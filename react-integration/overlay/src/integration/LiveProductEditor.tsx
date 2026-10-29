import { useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { AddProductDialog } from '../components/products/AddProductDialog';
import type { Product } from '../types/erp';
import { BackendRequestError, createBasicProduct, updateProductCatalog,
  type BackendProduct, type BasicProductInput } from './banijjApi';

const finite = (n: number, name: string) => {
  if (!Number.isFinite(n) || n < 0 || Math.round(n*10000) !== n*10000) {
    // Allow numeric rounding error within four decimal places.
    if (!Number.isFinite(n) || n < 0 || Math.abs(Math.round(n*10000)-n*10000)>0.00001)
      throw new Error(name + ' must be a nonnegative number with up to 4 decimals.');
  }
  return n;
};
const toOriginalForm = (p: BackendProduct): Product => ({
  id:p.productId, kind:'Stock', name:p.productName, sku:p.barcode||'',
  category:p.category, brand:p.brand, unit:p.unit||'Pcs', stock:p.currentStock,
  minStock:p.minimumStock, sellPrice:p.sellingPrice, purchasePrice:p.purchasePrice,
  active:p.status!=='Inactive', serialTracking:'Off'
});
const noSupport = (p: Product) => {
  if (p.kind && p.kind!=='Stock') throw new Error('Only stock products are supported by the live backend. Bundle and Service products remain design previews.');
  if (p.nameBn?.trim()) throw new Error('Bangla product names cannot be stored by the current backend. Remove the Bangla name for now.');
  if (p.image || p.images?.length) throw new Error('Product images require a storage integration. Remove images for the live save.');
  if (p.unitRelations?.length || p.altUnit || Object.keys(p.unitSellPrices||{}).length ||
      Object.keys(p.unitPurchasePrices||{}).length) throw new Error('Multi-unit conversion is not supported by this backend yet.');
  if (p.warranty?.enabled || p.serialTracking && p.serialTracking!=='Off' || p.expiry?.enabled) {
    throw new Error('Serial, warranty and expiry settings are not connected. Turn these off before a live save.');
  }
};
function mapBasic(p:Product):BasicProductInput {
  noSupport(p);
  const name=p.name.trim(), category=p.category.trim(), unit=p.unit.trim();
  if (!name || !category || !unit) throw new Error('Name, category and unit are required.');
  const stock=finite(p.stock,'Opening stock');
  if (!Number.isSafeInteger(stock)) throw new Error('Opening stock must be a whole base-unit quantity in this phase.');
  const sell=finite(p.sellPrice,'Selling price'), buy=finite(p.purchasePrice,'Purchase price');
  const minimum=finite(p.minStock,'Minimum stock');
  if (!Number.isSafeInteger(minimum)) throw new Error('Minimum stock must be a whole unit.');
  if ([name,category,unit,p.brand||'',p.sku||''].some(x=>x.length>200)) throw new Error('A product field is too long.');
  return {productName:name,brand:p.brand?.trim()||'',category,unit,barcode:p.sku?.trim()||'',
    purchasePrice:buy,sellingPrice:sell,minimumStock:minimum,currentStock:stock,
    status:p.active?'Active':'Inactive',
    trackSerial:false,trackExpiry:false,trackWarranty:false,
    warrantyPeriodValue:0,warrantyPeriodUnit:'Months'};
}
export function LiveProductEditor({ product, onDone, onCancel }:{
  product:BackendProduct|null; onDone:(savedId:string)=>void; onCancel:()=>void;
}) {
  const [message,setMessage]=useState('');
  const [saving,setSaving]=useState(false);
  const pending=useRef(false);
  const original=useRef(product?toOriginalForm(product):null);
  const onSave=(draft: Product) => {
    if (pending.current) throw new Error('This product is being saved.');
    const payload=mapBasic(draft); // Synchronous rejection appears in source form's ErrorSummary.
    if (product && payload.unit!==product.unit) throw new Error('Changing a product base unit is not supported. Use the original unit.');
    if (product && payload.status!==product.status) throw new Error('Product status must be changed from the existing ERP until the status workflow is integrated.');
    pending.current=true; setSaving(true); setMessage('');
    void (async()=>{
      const result=product
        ? await updateProductCatalog(product.productId,{
          expectedUpdatedAt:product.updatedAt, productName:payload.productName,
          brand:payload.brand,category:payload.category,barcode:payload.barcode,
          purchasePrice:payload.purchasePrice,sellingPrice:payload.sellingPrice,
          minimumStock:payload.minimumStock
        })
        : await createBasicProduct(payload);
      onDone(result.productId);
    })().catch(async err=>{
      let msg=err instanceof Error?err.message:'Could not save the product.';
      // If a network request failed, the server may already have committed the create/update.
      if(err instanceof BackendRequestError && (err.status===null || err.status>=500)){
        msg='Save result unknown. Verify the product record in the existing ERP before retrying. '+msg;
      }
      setMessage(msg);
    }).finally(()=>{pending.current=false;setSaving(false);});
  };
  const close=(open:boolean)=>{if(!open && !pending.current)onCancel();};
  return <div className="relative" data-live-product-editor>
    <div className="mx-auto mb-3 max-w-[1440px] rounded-lg border border-warning/30 bg-warning-bg p-3 text-xs text-warning">
      <strong>Live catalog editor · সীমিত ফিচার</strong>
      <p>Only basic stock products, single units, prices and categories are supported. No multi-unit,
      serial, expiry, warranty, Bangla name or images yet. Editing never adjusts current stock or FIFO lots.</p>
    </div>
    {message && <div role="alert" className="mx-auto mb-3 max-w-[1440px] rounded-lg border border-danger bg-danger-bg p-3 text-sm text-danger">
      <AlertTriangle className="mr-2 inline size-4"/>{message}
    </div>}
    {saving && <div role="status" className="fixed right-4 top-4 z-[300] flex items-center gap-2 rounded-lg border border-teal-200 bg-card p-3 shadow-pop">
      <Loader2 className="size-4 animate-spin text-teal-700"/>Saving to BanijjIQ…
    </div>}
    <AddProductDialog open onOpenChange={close} onSave={onSave}
      initialProduct={original.current} presentation="page" />
  </div>;
}
