import type {Product} from '../types/erp';
import type {CartLine} from '../hooks/usePosCart';
import type {PosProduct,PosVendor} from './banijjApi';
import type {ShortageSelection} from './LiveStockShortageDialog';
import {quoteLiveUnits} from './posUnitMath';

export type LiveCartRow={product:PosProduct;qty:number;price:number;serialNumbers:string[];
  unitQuantities?:Record<string,number>;source:ShortageSelection};

/** Original HisabIQ source components receive only real POS bootstrap records. */
export function toSourceProduct(p:PosProduct):Product {
 const profile=p.unitProfilePreview?.postingEnabled?p.unitProfilePreview:null;
 return {id:p.id,kind:'Stock',name:p.name,nameBn:'',sku:p.barcode||p.id,
  category:p.category,brand:p.brand,unit:p.unit||'Pcs',stock:p.stock,
  minStock:p.minimumStock,sellPrice:p.sellingPrice,purchasePrice:0,active:true,
  serialTracking:p.trackSerial?'Required':'Off',
  ...(profile?{
   unitRelations:profile.units.slice(0,-1).map((unit,i)=>({
     leftUnit:unit.unit,rightUnit:profile.units[i+1].unit,quantity:unit.containsNext!})),
   unitSellPrices:Object.fromEntries(profile.units.map(unit=>[unit.unit,unit.sellingPrice]))
  }:{}),
  ...(p.trackExpiry?{expiry:{enabled:true,dateRequired:true,warningDays:0,allocationMethod:'FIFO' as const}}:{})};
}

export function toSourceCartLine(l:LiveCartRow,vendors:PosVendor[]=[]):CartLine {
 const profile=l.product.unitProfilePreview?.postingEnabled?l.product.unitProfilePreview:null;
 return {key:l.product.id,product:toSourceProduct(l.product),qty:String(l.qty),
  secondaryQty:'',unit:l.product.unit,price:String(l.price),serials:l.serialNumbers,
  ...(profile?{historicalUnitSnapshot:{baseUnit:profile.baseUnit,
    factors:Object.fromEntries(profile.units.map(u=>[u.unit,u.factor])),
    sellingPrices:Object.fromEntries(profile.units.map(u=>[u.unit,u.sellingPrice])),
    purchasePrices:Object.fromEntries(profile.units.map(u=>[u.unit,0]))}}:{}),
  ...(l.source.mode==='negative'?{stockSource:{mode:'Negative' as const}}:
    l.source.mode==='vendor'?{stockSource:{mode:'Vendor' as const,vendorId:l.source.vendorId,
      vendorName:vendors.find(v=>v.id===(l.source.mode==='vendor'?l.source.vendorId:''))?.name??'Selected vendor',unitCost:l.source.vendorUnitCost}}:{}),
  ...(l.unitQuantities?{unitQuantities:Object.fromEntries(Object.entries(l.unitQuantities).map(([unit,n])=>[unit,String(n)]))}:{})};
}

/** Keep the live transaction payload authoritative; never copy demo carts or ledger records. */
export function patchLiveLineFromSource(line:LiveCartRow,patch:Partial<Pick<CartLine,
 'qty'|'secondaryQty'|'unitQuantities'|'unit'|'price'|'serials'>>):LiveCartRow {
 if(patch.unitQuantities){
  if(!line.product.unitProfilePreview?.postingEnabled)throw Error('Unit profile is not approved for posting.');
  const units=Object.fromEntries(Object.entries(patch.unitQuantities).map(([u,n])=>{
   const text=n.trim();if(text&&!/^\d+$/.test(text))throw Error('Unit quantities must be whole-number values.');
   return [u,text?Number(text):0];
  }));
  const baseQty=Object.values(units).some(n=>n>0)?quoteLiveUnits(line.product.unitProfilePreview,units).qty:0;
  return {...line,qty:baseQty,unitQuantities:units,serialNumbers:[],source:{mode:'own'}};
 }
 if(patch.qty!==undefined){
  const qty=Number(patch.qty);
  return {...line,qty,serialNumbers:[],source:{mode:'own'},
   ...(line.unitQuantities?{unitQuantities:{[line.product.unit]:qty}}:{})};
 }
 if(patch.price!==undefined&&!line.unitQuantities)return {...line,price:Number(patch.price)};
 if(patch.serials!==undefined)return {...line,serialNumbers:patch.serials};
 return line;
}
