import {loadProductCatalog} from './products/productApi';
import {toCatalogView, type ProductCatalogResponse} from './products/productContracts';
import type {Product} from '../types/erp';

export async function loadOriginalPosCatalog(
  load: () => Promise<ProductCatalogResponse> = loadProductCatalog
): Promise<readonly Product[]> {
  return toCatalogView(await load()).items.map(({product}) => product);
}

import type {PosBootstrap} from './banijjApi';

/** Attach D1's revisioned unit chain to the ORIGINAL HisabIQ Product contract; no new cart UI. */
export function attachOriginalPosUnitProfiles(catalog:readonly Product[],pos:PosBootstrap):readonly Product[]{
  if(pos?.ok!==true||!Array.isArray(pos.products))throw new Error('Invalid POS bootstrap products.');
  const byId=new Map<string,PosBootstrap['products'][number]>();
  for(const record of pos.products){
    if(!record||typeof record.id!=='string'||!record.id.trim())throw new Error('Invalid POS product identity.');
    if(byId.has(record.id))throw new Error('Duplicate POS product identity.');
    byId.set(record.id,record);
  }
  return catalog.flatMap(product=>{
    if(!product.active)return [];
    const record=byId.get(product.id);
    if(!record)return []; // Never sell from catalog-only data not confirmed by POS.
    if(record.unit!==product.unit)throw new Error('POS base unit mismatch: '+product.id);
    if(!Number.isFinite(record.stock))throw new Error('Invalid POS stock: '+product.id);
    if(!Number.isFinite(record.sellingPrice)||record.sellingPrice<0)throw new Error('Invalid POS price: '+product.id);
    const base={...product,stock:record.stock,sellPrice:record.sellingPrice};
    const profile=record.unitProfilePreview;
    if(!profile)return [base];
    if(profile.postingEnabled===false)return []; // Disabled revision cannot be represented as a sellable multi-unit.
    if(profile.postingEnabled!==true)throw new Error('Invalid POS profile posting status: '+product.id);
    if(!Number.isSafeInteger(profile.revision)||profile.revision<1)throw new Error('Invalid POS profile revision: '+product.id);
    if(profile.baseUnit!==product.unit)throw new Error('POS profile base unit mismatch: '+product.id);
    const units=profile.units;
    if(!Array.isArray(units)||units.length<2||units.length>4)throw new Error('Invalid POS unit count: '+product.id);
    if(units[units.length-1].unit!==product.unit)throw new Error('POS profile base unit mismatch: '+product.id);
    const names=new Set<string>();
    for(let i=0;i<units.length;i++){
      const row=units[i];
      if(!row||typeof row.unit!=='string'||!row.unit.trim())throw new Error('Invalid POS unit name: '+product.id);
      const normalized=row.unit.trim().toLowerCase();
      if(names.has(normalized))throw new Error('Duplicate POS unit: '+product.id);
      names.add(normalized);
      if(!Number.isFinite(row.sellingPrice)||row.sellingPrice<0)throw new Error('Invalid POS unit price: '+product.id);
      if(!Number.isSafeInteger(row.factor)||row.factor<1)throw new Error('Invalid POS unit factor: '+product.id);
      if(i===units.length-1){
        if(row.factor!==1||row.containsNext!==null)throw new Error('Invalid POS base unit factor: '+product.id);
      }else{
        if(!Number.isSafeInteger(row.containsNext)||row.containsNext<2)
          throw new Error('Invalid POS unit conversion: '+product.id);
        if(row.factor!==row.containsNext*units[i+1].factor)
          throw new Error('Invalid POS unit factor chain: '+product.id);
      }
    }
    return [{
      ...base,sellPrice:units[units.length-1].sellingPrice,stockViewUnit:units[0].unit,
      unitRelations:units.slice(0,-1).map((row,i)=>({
        leftUnit:row.unit,rightUnit:units[i+1].unit,quantity:row.containsNext!
      })),
      unitSellPrices:Object.fromEntries(units.map(row=>[row.unit,row.sellingPrice]))
    }];
  });
}
