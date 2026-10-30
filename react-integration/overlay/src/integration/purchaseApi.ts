import { request, BackendRequestError, type BackendProduct, type PosUnitProfile } from './banijjApi';

export interface PurchaseSupplier {
  id:string; name:string; phone:string; currentDue:number; ledgerDue:number; needsReconciliation:boolean;
}
export interface PurchaseRecord {
  purchaseId:string; purchaseDate:string; supplierId:string; supplierName:string;
  grandTotal:number; paidAmount:number; dueAmount:number; paymentStatus:string;
  items:Array<{productId:string;productName:string;quantity:number;unitPrice:number;lineTotal:number;unitDescription?:string}>;
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
export function validateDuePurchase(supplier:PurchaseSupplier|null,lines:DuePurchaseLine[],purchasePlanOrderId=''){
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
 return {supplierId:supplier.id,paidAmount:0,discount:0,purchasePlanOrderId,
  items:lines.map(l=>l.unitQuantities!==undefined
   ?{productId:l.productId,unitQuantities:l.unitQuantities,unitProfileRevision:l.unitProfileRevision,
      priceUnit:l.priceUnit,unitPrice:l.unitPrice}
   :{productId:l.productId,qty:l.qty,unitPrice:l.unitPrice})};
}
export async function createDuePurchase(supplier:PurchaseSupplier|null,lines:DuePurchaseLine[],purchasePlanOrderId=''){
  const payload=validateDuePurchase(supplier,lines,purchasePlanOrderId);
  return request<PurchaseCreated>('/api/purchases',{method:'POST',body:JSON.stringify(payload)});
}

export interface MixedReturnLine {
 productId:string;productName:string;boughtQty:number;unitPrice:number;
 previouslyReturnedQty:number;availableQty:number;unitDescription:string;
 returnSupported:boolean;unsupportedReason:string;
 unitSnapshot:{revision:number;profile:PosUnitProfile;quantities:Record<string,number>;
  priceUnit:string;enteredUnitPrice:number;description:string;sourceLotId:string}|null;
 originalLineTotal:number;
}
export interface MixedReturnSource{
 ok:true;purchase:{purchaseId:string;supplierId:string;supplierName:string;
  grandTotal:number;paidAmount:number;previouslyReturnedAmount:number;netPurchase:number;
  items:MixedReturnLine[]};
}
export type MixedReturnInput={
 purchaseId:string;reason:string;refundMethod:'Supplier Credit';clientRequestId:string;
 items:Array<{productId:string;unitQuantities:Record<string,number>}>;
}
export async function loadMixedPurchaseReturn(id:string){
 return request<MixedReturnSource>('/api/purchases/'+encodeURIComponent(id)+'/return-data');
}
export async function postMixedPurchaseReturn(body:MixedReturnInput){
 return request<{ok:true;returnId:string;totalReturnAmount:number;idempotent?:boolean}>(
  '/api/purchase-returns',{method:'POST',body:JSON.stringify(body)});
}
export function quoteOriginalReturn(line:MixedReturnLine,quantities:Record<string,number>){
 if(!line.unitSnapshot)throw Error('Original unit snapshot unavailable');
 const quoted=quotePurchaseLine(line.unitSnapshot.profile,quantities,
  line.unitSnapshot.priceUnit,line.unitSnapshot.enteredUnitPrice);
 if(quoted.qty>line.availableQty)throw Error('Return exceeds available original stock');
 const base=BigInt(line.boughtQty),prior=BigInt(line.previouslyReturnedQty);
 const qty=BigInt(quoted.qty),micro=BigInt(Math.round(line.originalLineTotal*10000));
 if(base<1n||prior+qty>base)throw Error('Return exceeds original quantity');
 const cumulative=(prior+qty)*micro+base/2n,previous=prior*micro+base/2n;
 return {qty:quoted.qty,amount:Number(cumulative/base-previous/base)/10000};
}

export interface SupplierSettlement{
 settlementId:string;requestId:string;ledgerId:string;amount:number;
 method:'Cash'|'Bank'|'Mobile Banking';bankAccountId:string;
 date:string;status:'Posted'|'Reversed';reversalLedgerId:string;createdAt:string
}
export interface SettlementDetails{
 ok:true;supplier:{id:string;name:string;currentDue:number};
 ledgerDue:number;needsReconciliation:boolean;activeSession:boolean;
 bankAccounts:Array<{id:string;name:string;type:string;currentBalance:number}>;
 settlements:SupplierSettlement[];
}
export async function loadSupplierSettlements(id:string){
 return request<SettlementDetails>('/api/purchases/supplier-settlements/supplier/'+encodeURIComponent(id));
}
export async function submitSupplierSettlement(body:{supplierId:string;clientRequestId:string;
 amount:number;method:string;bankAccountId:string;notes:string}){
 return request<{ok:true;settlementId:string;ledgerId:string;amount:number;newDue:number;
  idempotent?:boolean}>('/api/purchases/supplier-settlements',{
 method:'POST',body:JSON.stringify(body)});
}
export async function reverseSettlement(id:string,reason:string){
 return request<{ok:true;settlementId:string;reversalLedgerId:string;newDue:number}>(
 '/api/purchases/supplier-settlements/'+encodeURIComponent(id)+'/reverse',{
 method:'POST',body:JSON.stringify({reason})});
}

export interface PlanSupplier{id:string;name:string}
export interface PlanRow{productId:string;productName:string;currentStock:number;suggestedQty:number;
 plannedQty:number;included:boolean;supplierId:string;lastPurchaseCost:number}
export interface PlanSummary{planId:string;planNo:string;status:string;itemCount:number;totalInvestment:number}
export interface OrderSummary{orderId:string;orderNo:string;status:string;supplierId:string;
 supplierName:string;totalQty:number;convertedPurchaseId:string}
export async function analyzePurchasePlan(){
 return request<{ok:true;rows:PlanRow[];suppliers:PlanSupplier[]}>('/api/purchases/planner/analyze');
}
export async function savePurchasePlan(items:Array<{productId:string;supplierId:string;plannedQty:number;included:boolean}>){
 return request<{ok:true;planId:string}>('/api/purchases/planner/plans',{
  method:'POST',body:JSON.stringify({items})});
}
export async function listPurchasePlans(){
 const x=await request<{ok:true;plans:PlanSummary[]}>('/api/purchases/planner/plans');return x.plans;
}
export async function approvePurchasePlan(id:string){
 return request<{ok:true;planId:string}>('/api/purchases/planner/plans/'+encodeURIComponent(id)+'/approve',{
 method:'POST',body:'{}'});
}
export async function listPurchaseOrders(){
 const x=await request<{ok:true;orders:OrderSummary[]}>('/api/purchases/planner/orders');return x.orders;
}
export async function getOrderToPurchase(id:string){
 return request<{ok:true;purchase:{purchasePlanOrderId:string;orderNo:string;
  supplierId:string;supplierName:string;
  items:Array<{productId:string;productName:string;quantity:number;unitPrice:number}>}}>(
 '/api/purchases/planner/orders/'+encodeURIComponent(id)+'/convert-data');
}
