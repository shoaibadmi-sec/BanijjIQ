import {BackendRequestError,request} from './banijjApi';

type Role='Customer'|'Supplier';
export type LiveParty = {
 id:string;sourceId:string;role:Role;name:string;phone:string;balance:number;status:string;
};
type SourceParty = {id:string;name:string;phone:string;currentDue:number;status:string};
export type LivePartyLedgerRow={
 id:string;date:string;type:string;reference:string;debit:number;credit:number;
 notes:string;paymentMethod:string;
};
export type LivePartyLedger={
 id:string;role:Role;balance:number;rows:LivePartyLedgerRow[];
};
const invalid=(reason:string)=>new BackendRequestError('Party ledger source '+reason,502);
function money(value:unknown):number{
 const n=Number(value);
 if(value===null||value===undefined||value===''||!Number.isFinite(n)||n<0||
  Math.abs(n*10000-Math.round(n*10000))>0.00001)throw invalid('has invalid money amount.');
 return n;
}
function sourceList(value:unknown,label:string):SourceParty[]{
 if(!Array.isArray(value))throw invalid(label+' response is incomplete.');
 return value.map(item=>{
  if(!item||typeof item.id!=='string'||!item.id||typeof item.name!=='string'||!item.name)
   throw invalid(label+' response lacks party identity.');
  return {...item,currentDue:money(item.currentDue)} as SourceParty;
 });
}
export async function getLivePartyDirectory():Promise<LiveParty[]>{
 const [customerResponse,supplierResponse]=await Promise.all([
  request<{ok:true;customers:SourceParty[]}>('/api/customers'),
  request<{ok:true;suppliers:SourceParty[]}>('/api/suppliers')
 ]);
 const customers=sourceList(customerResponse.customers,'customer');
 const suppliers=sourceList(supplierResponse.suppliers,'supplier');
 return [
  ...customers.map(row=>({id:'Customer:'+row.id,sourceId:row.id,role:'Customer' as const,
    name:row.name,phone:row.phone||'',balance:row.currentDue,status:row.status||'Active'})),
  ...suppliers.map(row=>({id:'Supplier:'+row.id,sourceId:row.id,role:'Supplier' as const,
    name:row.name,phone:row.phone||'',balance:-row.currentDue,status:row.status||'Active'}))
 ];
}
type RawLedgerRow={ledgerId:string;date:string;type:string;reference:string;debit:number;
 credit:number;notes?:string;paymentMethod?:string};
function parseRows(value:unknown):LivePartyLedgerRow[]{
 if(!Array.isArray(value))throw invalid('detail is missing ledger entries.');
 const rows=value.map((r:RawLedgerRow)=>{
  if(!r||!r.ledgerId||!/^\d{4}-\d{2}-\d{2}$/.test(String(r.date||'')))
   throw invalid('contains an invalid ledger entry.');
  return {id:String(r.ledgerId),date:r.date,type:String(r.type||''),
   reference:String(r.reference||''),debit:money(r.debit),credit:money(r.credit),
   notes:String(r.notes||''),paymentMethod:String(r.paymentMethod||'')};
 });
 if(new Set(rows.map(r=>r.id)).size!==rows.length)throw invalid('contains duplicate ledger rows.');
 return rows.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
}
export async function getLivePartyLedger(role:Role,id:string):Promise<LivePartyLedger>{
 if(!id.trim()||id.includes('/')||id.includes('?'))throw invalid('identifier is invalid.');
 if(role==='Supplier'){
  const result=await request<{ok:true;supplier:SourceParty;ledger:RawLedgerRow[]}>(
   '/api/suppliers/'+encodeURIComponent(id));
  if(result.supplier?.id!==id)throw invalid('supplier identity does not match.');
  const balance=money(result.supplier.currentDue);
  const rows=parseRows(result.ledger);
  const ledgerMicro=rows.reduce((sum,r)=>sum+Math.round(r.debit*10000)-Math.round(r.credit*10000),0);
  if(Math.abs(ledgerMicro-Math.round(balance*10000))>1)
   throw invalid('does not reconcile with supplier due (mismatch).');
  return {id:'Supplier:'+id,role,balance,rows};
 }
 if(role!=='Customer')throw invalid('role is unsupported.');
 const result=await request<{ok:true;detail:{
  customer:SourceParty;ledger:RawLedgerRow[];
  history:{hasMore:boolean;matchingCount:number;returnedCount:number};
  summary:{rangeClosingBalance:number};
 }}>('/api/customers/'+encodeURIComponent(id)+'?limit=200');
 if(result.detail?.customer?.id!==id)throw invalid('customer identity does not match.');
 const history=result.detail.history;
 if(!history||history.hasMore||history.matchingCount>history.returnedCount)
  throw invalid('has truncated or incomplete customer history.');
 const balance=money(result.detail.customer.currentDue);
 if(Math.abs(Math.round(money(result.detail.summary?.rangeClosingBalance)*10000)-
   Math.round(balance*10000))>1)
  throw invalid('customer balance does not reconcile.');
 return {id:'Customer:'+id,role,balance,rows:parseRows(result.detail.ledger)};
}
