import { request, BackendRequestError, type BackendProduct } from './banijjApi';

export interface PurchaseSupplier {
  id:string; name:string; phone:string; currentDue:number; ledgerDue:number; needsReconciliation:boolean;
}
export interface PurchaseRecord {
  purchaseId:string; purchaseDate:string; supplierId:string; supplierName:string;
  grandTotal:number; paidAmount:number; dueAmount:number; paymentStatus:string;
  items:Array<{productId:string;productName:string;quantity:number;unitPrice:number;lineTotal:number}>;
}
export interface DuePurchaseLine {productId:string;qty:number;unitPrice:number}
export interface PurchaseCreated {ok:true;purchaseId:string;grandTotal:number;dueAmount:number}

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
  if(!supplier?.id)throw new Error('Select a saved supplier.');
  if(supplier.needsReconciliation)throw new Error('Supplier balance needs reconciliation before new purchases.');
  if(lines.length===0)throw new Error('Add at least one product.');
  const ids=new Set<string>();
  for(const line of lines){
    if(!line.productId||ids.has(line.productId))throw new Error('Choose distinct products.');
    ids.add(line.productId);
    exact4(line.qty,'Quantity',true);exact4(line.unitPrice,'Unit cost',false);
  }
  const amount=Math.round(lines.reduce((n,l)=>n+l.qty*l.unitPrice,0)*10000)/10000;
  if(!Number.isFinite(amount)||amount>1e12)throw new Error('Purchase total exceeds limit.');
  return {supplierId:supplier.id,paidAmount:0,discount:0,items:lines};
}
export async function createDuePurchase(supplier:PurchaseSupplier|null,lines:DuePurchaseLine[]){
  const payload=validateDuePurchase(supplier,lines);
  return request<PurchaseCreated>('/api/purchases',{method:'POST',body:JSON.stringify(payload)});
}
