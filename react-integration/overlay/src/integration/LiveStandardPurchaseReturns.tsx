import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,RefreshCw} from 'lucide-react';
import {Link} from 'react-router-dom';
import {Button} from '../components/Button';
import {Input} from '../components/Input';
import {canUseModule,useBackendSession} from './BackendGate';
import {BackendRequestError} from './banijjApi';
import {loadPurchaseDetail,loadStandardReturnSource,loadSupplierSettlements,
 loadPurchaseReturnHistory,postVerifiedPurchaseRefund,validatePaidPurchaseRefund,
 type StandardPurchaseDetail,type StandardReturnSource,type SettlementDetails} from './purchaseApi';

const taka=(n:number)=>'৳'+Number(n||0).toLocaleString('en-BD',{maximumFractionDigits:4});

export function LiveStandardPurchaseReturns({purchaseId,onRefresh}:{
 purchaseId:string;onRefresh:()=>void
}){
 const user=useBackendSession(),permitted=canUseModule(user,'purchase','add');
 const [purchase,setPurchase]=useState<StandardPurchaseDetail|null>(null);
 const [source,setSource]=useState<StandardReturnSource['purchase']|null>(null);
 const [settlement,setSettlement]=useState<SettlementDetails|null>(null);
 const [quantities,setQuantities]=useState<Record<string,string>>({});
 const [reason,setReason]=useState('');
 const [received,setReceived]=useState(false);
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
 const [error,setError]=useState(''),[success,setSuccess]=useState('');
 const [uncertain,setUncertain]=useState(false);
 const requestId=useRef(crypto.randomUUID()),posting=useRef(false);
 useEffect(()=>{
  let active=true;
  requestId.current=crypto.randomUUID();setQuantities({});setReason('');setReceived(false);
  setSource(null);setPurchase(null);setSettlement(null);setError('');setSuccess('');setUncertain(false);
  setLoading(true);
  const load=async()=>{
   try{
    const [detail,returnSource]=await Promise.all([
      loadPurchaseDetail(purchaseId),loadStandardReturnSource(purchaseId)]);
    if(!active)return;
    if(returnSource.purchase.items.some(i=>i.unitSnapshot))
      throw Error('Mixed-unit returns use their original joined-unit return form.');
    const balances=await loadSupplierSettlements(detail.supplierId);
    if(active){setPurchase(detail);setSource(returnSource.purchase);setSettlement(balances);}
   }catch(e){if(active)setError(e instanceof Error?e.message:'Original refund source unavailable');}
   finally{if(active)setLoading(false);}
  };
  void load();return ()=>{active=false;};
 },[purchaseId]);
 const payloadResult=useMemo(()=>{
  if(!purchase||!source||!settlement)return {payload:null,message:'Checking original purchase…'};
  try{
   const qty=Object.fromEntries(Object.entries(quantities).map(([id,value])=>[id,value.trim()===''?0:Number(value)]));
   return {payload:validatePaidPurchaseRefund(purchase,source.items,settlement,qty,reason,requestId.current),message:''};
  }catch(e){return {payload:null,message:e instanceof Error?e.message:'Invalid original refund'};}
 },[purchase,source,settlement,quantities,reason]);
 const eligible=!!purchase&&purchase.status==='Completed'&&purchase.paidAmount>0&&
  Math.abs(purchase.paidAmount-purchase.grandTotal)<=0.0001&&purchase.dueAmount===0&&
  purchase.discount===0&&['Cash','Bank','Mobile Banking'].includes(purchase.paymentMethod);
 const available=Number(purchase?.grandTotal||0)-Number(purchase?.returnedAmount||0);
 const selectedTotal=payloadResult.payload?.items.reduce((sum,l)=>sum+l.qty*l.unitPrice,0)||0;
 async function reload(){
  if(!purchase)return;
  const [updated,returnSource,balances]=await Promise.all([
   loadPurchaseDetail(purchaseId),loadStandardReturnSource(purchaseId),
   loadSupplierSettlements(purchase.supplierId)]);
  setPurchase(updated);setSource(returnSource.purchase);setSettlement(balances);
  onRefresh();
 }
 async function post(){
  if(!permitted||!received||!payloadResult.payload||loading||saving||uncertain||posting.current)return;
  posting.current=true;setSaving(true);setError('');setSuccess('');
  try{
   // Revalidate against refreshed account and stock views; the Worker rechecks inside D1.
   const [freshPurchase,freshSource,freshBalance]=await Promise.all([
     loadPurchaseDetail(purchaseId),loadStandardReturnSource(purchaseId),
     loadSupplierSettlements(purchase!.supplierId)]);
   const refreshed=validatePaidPurchaseRefund(freshPurchase,freshSource.purchase.items,
     freshBalance,Object.fromEntries(Object.entries(quantities).map(([id,v])=>[id,Number(v)])),
     reason,requestId.current);
   const posted=await postVerifiedPurchaseRefund(refreshed);
   setSuccess('Refund recorded · '+posted.returnId+' · '+taka(posted.totalReturnAmount));
   requestId.current=crypto.randomUUID();setQuantities({});setReason('');setReceived(false);
   await reload();
  }catch(e){
   setError(e instanceof Error?e.message:'Refund could not be recorded');
   if(e instanceof BackendRequestError&&(e.status===null||e.status>=500))setUncertain(true);
  }finally{posting.current=false;setSaving(false);}
 }
 async function checkUnknown(){
  if(!uncertain)return;
  try{
   const history=await loadPurchaseReturnHistory();
   const receipt=history.find(x=>x.refundRequestId===requestId.current);
   if(receipt){
    setSuccess('Refund recorded · '+receipt.returnId+' · '+taka(receipt.totalReturnAmount));
    requestId.current=crypto.randomUUID();setQuantities({});setReason('');setReceived(false);
    setUncertain(false);await reload();
   }else{
    setError('Not found in recent return history. Retry ONLY with the same request ID; the backend prevents duplicate receipts.');
    setUncertain(false);
   }
  }catch(e){setError(e instanceof Error?e.message:'History unavailable. Do not change or repeat this refund.');}
 }
 return <section data-live-standard-purchase-returns className="space-y-3 rounded-xl border border-border bg-card p-3 shadow-card">
  <div className="flex flex-wrap items-start justify-between gap-2">
   <div><h2 className="text-sm font-semibold text-ink">Verified supplier refund · সরবরাহকারীর ফেরত টাকা</h2>
    <p className="text-xs text-ink-500">{purchaseId} · {purchase?.supplierName||'Loading…'}</p></div>
   <Link to="/app/purchases?tab=return" className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700">
    <ArrowLeft className="size-4"/> Change purchase</Link>
  </div>
  {loading&&<p role="status" className="py-3 text-sm text-ink-500">Checking original invoice, cash session and money source…</p>}
  {error&&<p role="alert" className="rounded-md bg-danger-bg p-3 text-sm text-danger">{error}</p>}
  {success&&<p role="status" className="rounded-md bg-success-bg p-3 text-sm text-success">{success}</p>}
  {uncertain&&<div role="alert" className="space-y-2 rounded-md border border-warning bg-warning-bg p-3 text-sm text-warning">
   The refund outcome is uncertain. Do not create a new request.
   <Button variant="outline" size="sm" onClick={()=>void checkUnknown()}>Check return history · ফেরতের ইতিহাস</Button>
  </div>}
  {purchase&&source&&settlement&&<>
   <div className="flex flex-wrap gap-2 text-xs">
    <span className="rounded-md bg-ink-50 px-3 py-2">Original paid · পরিশোধ: <strong>{taka(purchase.paidAmount)}</strong></span>
    <span className="rounded-md bg-ink-50 px-3 py-2">Original due · বাকি: <strong>{taka(purchase.dueAmount)}</strong></span>
    <span className="rounded-md bg-ink-50 px-3 py-2">Refund available · ফেরতযোগ্য: <strong>{taka(available)}</strong></span>
   </div>
   <p className="text-xs text-ink-600">Original payment: <strong>{purchase.paymentMethod||'Not recorded'}</strong>
    {purchase.bankAccountId?' · Account: '+(settlement.bankAccounts.find(x=>x.id===purchase.bankAccountId)?.name||purchase.bankAccountId):''}
    {' · Refunds can only return to this original source.'}
   </p>
   {!eligible&&<p role="alert" className="rounded-md border border-warning p-3 text-sm text-warning">
    Paid refunds are unavailable for partial, due, discounted or unverified original purchases. Cash/Bank receipt is disabled · আংশিক পরিশোধে নগদ ফেরত বন্ধ।
   </p>}
   {!settlement.activeSession&&<p role="alert" className="rounded-md border border-warning p-3 text-sm text-warning">
    Open a cash session before receiving a supplier refund · ক্যাশ সেশন খুলুন।
   </p>}
   {settlement.needsReconciliation&&<p role="alert" className="rounded-md border border-warning p-3 text-sm text-warning">
    Supplier ledger needs reconciliation before posting.
   </p>}
   <div className="overflow-x-auto">
    <table className="w-full min-w-[580px] text-left text-xs">
     <thead><tr className="border-b border-border text-ink-500">
      <th className="px-2 py-2">Product · পণ্য</th><th className="px-2 py-2">Available qty</th>
      <th className="px-2 py-2">Return qty · ফেরত</th><th className="px-2 py-2 text-right">Original unit cost</th>
     </tr></thead>
     <tbody>{source.items.map(line=>{
       const locked=!!line.trackSerial||!!line.trackExpiry||!!line.unitSnapshot||line.availableQty<=0;
       return <tr key={line.productId} className="border-b border-border">
        <td className="px-2 py-2 font-medium text-ink">{line.productName}
         {locked&&<p className="mt-1 text-[11px] text-warning">Tracked or unavailable: refund disabled</p>}</td>
        <td className="px-2 py-2">{line.availableQty}</td>
        <td className="px-2 py-2"><Input type="number" min="0" max={line.availableQty} step="0.0001"
          aria-label={'Return quantity for '+line.productName}
          className="w-28" value={quantities[line.productId]||''} disabled={!eligible||locked||saving||uncertain||!permitted}
          onChange={e=>{setQuantities(old=>({...old,[line.productId]:e.target.value}));setReceived(false);}}/></td>
        <td className="px-2 py-2 text-right font-medium">{taka(line.unitPrice)}</td>
       </tr>;
     })}</tbody>
    </table>
   </div>
   <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-3">
    <div className="max-w-md flex-1 space-y-2">
     <label htmlFor="standard-return-reason" className="block text-xs font-medium">Reason · ফেরতের কারণ</label>
     <Input id="standard-return-reason" aria-label="Return reason" value={reason}
       maxLength={200} disabled={!eligible||saving||uncertain} onChange={e=>{setReason(e.target.value);setReceived(false);}}
       placeholder="Why did your supplier return money?"/>
     <label className="flex items-start gap-2 text-xs text-ink-600">
      <input type="checkbox" className="mt-0.5 accent-teal-600" checked={received}
       disabled={!eligible||saving||uncertain} onChange={e=>setReceived(e.target.checked)}/>
      <span>I confirm the supplier's refund money was actually received · ফেরতের টাকা পেয়েছি</span>
     </label>
     <p className="text-[11px] text-ink-500">No payable credit is created for a paid refund. Original account and cost are locked.</p>
    </div>
    <div className="text-right">
     <p className="text-xs text-ink-600">Money received · ফেরত টাকা</p>
     <p className="text-xl font-semibold text-ink">{taka(selectedTotal)}</p>
     {eligible&&payloadResult.message&&<p className="max-w-[240px] text-xs text-ink-500">{payloadResult.message}</p>}
     <Button disabled={!eligible||!permitted||loading||saving||uncertain||!received||!payloadResult.payload}
       onClick={()=>void post()}>{saving?'Recording refund…':'Confirm verified refund · ফেরত নিশ্চিত'}</Button>
    </div>
   </div>
  </>}
 </section>;
}
