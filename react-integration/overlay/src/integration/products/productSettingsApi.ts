import {BackendRequestError,request} from '../banijjApi';

export type LookupKind='category'|'brand'|'unit';
export type NamedProductLookup={id:string;name:string;nameBn?:string;usage:number;active:boolean};
export type UnitProductLookup=NamedProductLookup & {symbol:string;kind:'Base'|'Compound-ready'};
export type ProductSettingsLookups={
 categories:NamedProductLookup[];brands:NamedProductLookup[];units:UnitProductLookup[];
};
export type NewProductSettingsLookup={
 kind:LookupKind;name:string;nameBn?:string;symbol?:string;
};
const validName=(v:unknown,max=96)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=max;
function validateKind(kind:unknown):asserts kind is LookupKind{
 if(kind!=='category'&&kind!=='brand'&&kind!=='unit')
  throw new Error('Invalid product settings lookup kind.');
}
function validRows(values:unknown[],unit:boolean){
 return values.every(x=>{
  if(!x||typeof x!=='object')return false;
  const row=x as Record<string,unknown>;
  const named=typeof row.id==='string'&&row.id.length>0&&
   validName(row.name)&&typeof row.active==='boolean'&&
   typeof row.usage==='number'&&Number.isSafeInteger(row.usage)&&row.usage>=0&&
   (row.nameBn===undefined||typeof row.nameBn==='string');
  return named&&(!unit||typeof row.symbol==='string'&&validName(row.symbol,48)&&
   (row.kind==='Base'||row.kind==='Compound-ready'));
 });
}
export async function loadProductSettingsLookups():Promise<ProductSettingsLookups>{
 const result=await request<{ok:true;categories:unknown[];brands:unknown[];units:unknown[]}>('/api/products/settings/lookups');
 if(!result||result.ok!==true||!Array.isArray(result.categories)||
    !Array.isArray(result.brands)||!Array.isArray(result.units)||
    !validRows(result.categories,false)||!validRows(result.brands,false)||!validRows(result.units,true))
  throw new BackendRequestError('Invalid D1 product settings data; no preview settings will be shown.',502);
 return result as ProductSettingsLookups;
}
export async function createProductSettingsLookup(input:NewProductSettingsLookup):Promise<void>{
 validateKind(input.kind);
 if(!validName(input.name))throw new Error('Enter a valid category, brand or unit name.');
 if(input.nameBn!==undefined&&(typeof input.nameBn!=='string'||input.nameBn.trim().length>128))
  throw new Error('Invalid Bangla name.');
 if(input.kind==='unit'&&(!input.symbol||!/^[\p{L}\p{N}]{1,8}$/u.test(input.symbol.trim())))
  throw new Error('Unit symbol must be 1–8 letters or numbers.');
 const result=await request<{ok:true}>('/api/products/settings/lookups',{
  method:'POST',body:JSON.stringify(input)
 });
 if(result.ok!==true)throw new BackendRequestError('Product lookup creation not confirmed.',502);
}
export async function setProductSettingsLookupStatus(kind:LookupKind,id:string,status:'Active'|'Inactive'):Promise<void>{
 validateKind(kind);
 if(!id||!['Active','Inactive'].includes(status))throw new Error('Invalid settings operation.');
 const result=await request<{ok:true}>('/api/products/settings/lookups/'+kind+'/'+encodeURIComponent(id)+'/status',{
  method:'PUT',body:JSON.stringify({status})
 });
 if(result.ok!==true)throw new BackendRequestError('Lookup status change not confirmed.',502);
}
export async function deleteProductSettingsLookup(kind:LookupKind,id:string):Promise<void>{
 validateKind(kind);
 if(!id)throw new Error('Lookup ID is required.');
 const result=await request<{ok:true}>('/api/products/settings/lookups/'+kind+'/'+encodeURIComponent(id),{
  method:'DELETE'
 });
 if(result.ok!==true)throw new BackendRequestError('Lookup deletion not confirmed.',502);
}
