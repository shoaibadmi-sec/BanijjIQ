import { request, BackendRequestError, type BackendProduct, type PosUnitProfile } from './banijjApi';

export interface PurchaseSupplier {
  id:string; name:string; phone:string; currentDue:number; ledgerDue:number; needsReconciliation:boolean;
}
export interface PurchaseRecord {
  purchaseId:string; purchaseDate:string; supplierId:string; supplierName:string;
  grandTotal:number; paidAmount:number; dueAmount:number; paymentStatus:string;
  items:Array<{productId:string;productName:string;quantity:number;unitPrice:number;lineTotal:number}>;
}
export interface DuePurchaseLine {productId:string;qty:number;unitPrice:number;
 unitQuantities?:Record<string,number>;unitProfileRevision?:number;priceUnit?:string}
export interface PurchaseCreated {ok:true;purchaseId:string;grandTotal:number;dueAmount:number}

export interface PurchaseProfileReply{ok:true;productId:string;revision:number;
 profile:PosUnitProfile|null;postingEnabled:boolean}
export async function getPurchaseUnitProfile(id:string):Promise<PurchaseProfileReply>{
 return request<PurchaseProfileReply>('/api/purchases/unit-profile/'+encodeURIComponent(id));
}
/** Client quote deliberately matches Worker integer-micro arithmetic. */
export function quotePurchaseLine(profile:PosUnitProfile,quantities:Record<string,number>,
 priceUnit:string,enteredPrice:number){
 const units=profile.units;
 if(!Array.isArray(units)||units.length<2||units.length>4)throw Error('Invalid unit chain');
 const priced=units.find(u=>u.unit===priceUnit);
 if(!priced||!Number.isSafeInteger(priced.factor)||priced.factor<1)throw Error('Choose price unit');
 if(!Number.isFinite(enteredPrice)||enteredPrice<0||enteredPrice>100000000||
  Math.abs(enteredPrice*10000-Math.round(enteredPrice*10000))>0.000001)
   throw Error('Unit cost must use up to four decimals');
 if(Object.keys(quantities).some(k=>!units.some(u=>u.unit===k)))throw Error('Unknown purchase unit');
 let base=0n;
 for(const u of units){
  const count=quantities[u.unit]??0;
  if(!Number.isSafeInteger(count)||count<0||count>10000000||
   !Number.isSafeInteger(u.factor)||u.factor<1)throw Error('Invalid unit count or factor');
  base+=BigInt(count)*BigInt(u.factor);
 }
 if(base<=0n||base>1000000000n)throw Error('Enter valid unit quantities');
 const priceMicro=BigInt(Math.round(enteredPrice*10000)),factor=BigInt(priced.factor);
 const amount=(base*priceMicro+factor/2n)/factor;
 if(amount>100000000000000n)throw Error('Amount too large');
 return {qty:Number(base),total:Number(amount)/10000,baseUnitCost:Number(priceMicro)/priced.factor/10000};
}


export async function searchPurchaseSuppliers(q:string):Promise<PurchaseSupplier[]> {
  const result=await request<{ok:true;suppliers:PurchaseSupplier[]}>(
    '/api/purchases/supplier-search?q='+encodeURIComponent(q.trim()));
  if(!Array.isArray(result.suppliers))throw new BackendRequestError('Invalid supplier lookup response.',502);
  return result.suppliers;
}
export async function getPurchaseProducts():Promise<BackendProduct[]> {
  const result=await request<{ok:true;products:BackendProduct[]}>('/api/bootstrap');
  if(!Array.isArray(result.products))throw new BackendRequestError('Invalid product catalog.',502);
  return result.products.filter(p=>p.status==='Active'&&p.productType!=='Bundle');
}
export async function getRealPurchases():Promise<PurchaseRecord[]>{
  const result=await request<{ok:true;purchases:PurchaseRecord[]}>('/api/purchases');
  if(!Array.isArray(result.purchases))throw new BackendRequestError('Invalid purchase history.',502);
  return result.purchases;
}
function exact4(n:number,name:string,positive:boolean){
  if(!Number.isFinite(n)||n<0||(positive&&n===0)||n>1e9||!Number.isSafeInteger(Math.round(n*10000))||
     Math.abs(n*10000-Math.round(n*10000))>0.000001)
    throw new Error(name+' must be a valid non-negative value with up to 4 decimals.');
  return n;
}
export function validateDuePurchase(supplier:PurchaseSupplier|null,lines:DuePurchaseLine[]){
 if(!supplier?.id)throw Error('Select a saved supplier.');
 if(supplier.needsReconciliation)throw Error('Supplier balance needs reconciliation.');
 if(lines.length===0)throw Error('Add at least one product.');
 const ids=new Set<string>();
 for(const l of lines){
  if(!l.productId||ids.has(l.productId))throw Error('Choose distinct products.');
  ids.add(l.productId);
  if(l.unitQuantities!==undefined){
   if(!Number.isSafeInteger(l.unitProfileRevision)||!l.priceUnit||!Number.isSafeInteger(l.qty)||l.qty<=0)
    throw Error('Mixed-unit profile is not ready.');
   exact4(l.unitPrice,'Purchase unit cost',false);
  }else{
   exact4(l.qty,'Quantity',true);exact4(l.unitPrice,'Unit cost',false);
  }
 }
 return {supplierId:supplier.id,paidAmount:0,discount:0,
  items:lines.map(l=>l.unitQuantities!==undefined
   ?{productId:l.productId,unitQuantities:l.unitQuantities,unitProfileRevision:l.unitProfileRevision,
      priceUnit:l.priceUnit,unitPrice:l.unitPrice}
   :{productId:l.productId,qty:l.qty,unitPrice:l.unitPrice})};
}
export async function createDuePurchase(supplier:PurchaseSupplier|null,lines:DuePurchaseLine[]){
  const payload=validateDuePurchase(supplier,lines);
  return request<PurchaseCreated>('/api/purchases',{method:'POST',body:JSON.stringify(payload)});
}
