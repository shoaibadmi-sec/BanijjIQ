import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,RefreshCw} from 'lucide-react';
import {Link} from 'react-router-dom';
import {Button} from '../components/Button';
import {Input} from '../components/Input';
import {LiveMultiUnitQuantity} from './LiveMultiUnitQuantity';
import {BackendRequestError} from './banijjApi';
import {canUseModule,useBackendSession} from './BackendGate';
import {loadMixedPurchaseReturn,postMixedPurchaseReturn,quoteOriginalReturn,
 type PurchaseRecord,type MixedReturnSource} from './purchaseApi';

const taka=(n:number)=>'৳'+Number(n||0).toLocaleString('en-BD',{maximumFractionDigits:4});
type Props={purchaseId:string;purchases:PurchaseRecord[];loading:boolean;onRefresh:()=>void};
export function LiveMixedPurchaseReturns({purchaseId,purchases,loading,onRefresh}:Props){
 const user=useBackendSession();
 const permitted=canUseModule(user,'purchase','add');
 const [data,setData]=useState<MixedReturnSource['purchase']|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [feedback,setFeedback]=useState('');
 const [reason,setReason]=useState('');
 const [qty,setQty]=useState<Record<string,Record<string,number>>>({});
 const [saving,setSaving]=useState(false);
 const [unknown,setUnknown]=useState(false);
 const requestRef=useRef(crypto.randomUUID());
 const posting=useRef(false);
 useEffect(()=>{
   requestRef.current=crypto.randomUUID();setData(null);setQty({});setError('');
   setFeedback('');setUnknown(false);
   if(!purchaseId)return;
   let active=true;setBusy(true);
   loadMixedPurchaseReturn(purchaseId).then(result=>{if(active)setData(result.purchase);})
    .catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not load original purchase');})
    .finally(()=>{if(active)setBusy(false);});
   return ()=>{active=false;};
 },[purchaseId]);
 const lines=useMemo(()=>{
  return (data?.items||[]).filter(x=>x.returnSupported&&x.unitSnapshot).map(l=>{
   try{return {line:l,...quoteOriginalReturn(l,qty[l.productId]||{})};}
   catch{return {line:l,qty:0,amount:0};}
  });
 },[data,qty]);
 const sum=useMemo(()=>lines.reduce((n,l)=>n+l.amount,0),[lines]);
 const chosen=lines.filter(l=>l.qty>0);
 async function submit(){
  if(posting.current||!permitted||!data||!chosen.length||!reason.trim()||saving||unknown)return;
  if(!Number.isFinite(sum)||sum<0){setError('Invalid original cost allocation');return;}
  posting.current=true;setSaving(true);setError('');
  try{
   const result=await postMixedPurchaseReturn({purchaseId:data.purchaseId,
    reason:reason.trim(),refundMethod:'Supplier Credit',clientRequestId:requestRef.current,
    items:chosen.map(r=>({productId:r.line.productId,unitQuantities:qty[r.line.productId]}))});
   setFeedback('Purchase return saved · '+result.returnId+' · '+taka(result.totalReturnAmount));
   requestRef.current=crypto.randomUUID();
   setQty({});setReason('');
   const fresh=await loadMixedPurchaseReturn(data.purchaseId);
   setData(fresh.purchase);onRefresh();
  }catch(e){
   setError(e instanceof Error?e.message:'Return posting failed');
   if(e instanceof BackendRequestError&&(e.status===null||e.status>=500))setUnknown(true);
  }finally{posting.current=false;setSaving(false);}
 }
 if(!purchaseId)return <div data-live-purchase-returns className="space-y-3 rounded-xl border border-border bg-card p-3 shadow-card">
  <p className="text-xs text-ink-500">Choose a saved purchase for return · ফেরত দেওয়ার ক্রয় নির্বাচন করুন।</p>
  {loading?<p role="status">Loading purchases…</p>:
   purchases.filter(p=>p.items?.length>0).map(p=>
    <Link key={p.purchaseId} to={'/app/purchases?tab=return&purchaseId='+encodeURIComponent(p.purchaseId)}
     className="flex flex-wrap justify-between gap-2 rounded-md border border-border p-3 text-sm hover:bg-ink-50">
      <span className="font-medium text-ink">{p.purchaseId} · {p.supplierName}</span>
      <span className="text-ink-600">{taka(p.grandTotal)}</span>
    </Link>)}
  {!loading&&!purchases.some(p=>p.items?.length>0)&&
   <p className="py-8 text-center text-sm text-ink-500">No purchases available to return</p>}
 </div>;
 return <div data-live-purchase-returns className="space-y-3 rounded-xl border border-border bg-card p-3 shadow-card">
  <div className="flex flex-wrap justify-between gap-2">
   <div><p className="text-sm font-semibold text-ink">Return from {purchaseId}</p>
    <p className="text-xs text-ink-500">{data?.supplierName||'Loading source purchase…'}</p></div>
   <Link to="/app/purchases?tab=return" className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700">
    <ArrowLeft className="size-4"/> Change purchase</Link>
  </div>
  {busy&&<p role="status">Loading original purchase cost and unsold FIFO lots…</p>}
  {error&&<p role="alert" className="rounded-md bg-danger-bg p-3 text-sm text-danger">{error}</p>}
  {feedback&&<p role="status" className="rounded-md bg-success-bg p-3 text-sm text-success">{feedback}</p>}
  {unknown&&<div role="alert" className="rounded-md border border-warning bg-warning-bg p-3 text-sm text-warning">
    The server result is uncertain. Do not post again. Check Purchase Return History for this invoice.
    <Button variant="outline" size="sm" className="ml-2" onClick={()=>{setUnknown(false);setFeedback('Check saved returns before changing this draft.');}}>
      I checked the return history
    </Button>
  </div>}
  {data&&<>
   <div className="overflow-x-auto">
    <table className="w-full min-w-[600px] text-left text-xs">
     <thead><tr className="border-b border-border text-ink-500">
      <th className="px-2 py-2">Product · পণ্য</th><th className="px-2 py-2">Available base qty</th>
      <th className="px-2 py-2">Return units</th><th className="px-2 py-2 text-right">Original-cost credit</th>
     </tr></thead>
     <tbody>{data.items.map(l=>{
      const quote=lines.find(x=>x.line.productId===l.productId);
      const current=qty[l.productId]||{};
      return <tr key={l.productId} className="border-b border-border">
       <td className="px-2 py-2"><div className="font-medium text-ink">{l.productName}</div>
        <div className="text-[11px] text-ink-500">{l.unitDescription||'No frozen mixed-unit snapshot'}</div></td>
       <td className="px-2 py-2 text-ink-600">{l.availableQty}</td>
       <td className="px-2 py-2">{l.unitSnapshot&&l.returnSupported?
        <div className="w-[170px]"><LiveMultiUnitQuantity profile={l.unitSnapshot.profile}
          quantities={current} productName={l.productName}
          onChange={(unit,n)=>setQty(old=>({...old,[l.productId]:{...old[l.productId],[unit]:n}}))}
          onLastEnter={()=>{}} disabled={saving||unknown||!permitted}/></div>:
          <span className="text-xs text-danger">{l.unsupportedReason}</span>}</td>
       <td className="px-2 py-2 text-right font-medium text-ink">{quote?.qty?taka(quote.amount):'—'}</td>
      </tr>;
     })}</tbody>
    </table>
   </div>
   <p className="text-xs text-ink-500">Cost and quantity factors are locked to the original purchase. Sold or previously returned units cannot be returned.</p>
   <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-3">
    <div className="max-w-md flex-1">
     <label htmlFor="mixed-return-reason" className="mb-1 block text-xs font-medium text-ink">Reason · ফেরতের কারণ</label>
     <Input id="mixed-return-reason" value={reason} onChange={e=>setReason(e.target.value)}
      maxLength={200} placeholder="Why are you returning the goods?"/>
     <p className="mt-1 text-[11px] text-ink-500">Settlement: Supplier Credit only. Cash refund follows Phase 4D.</p>
    </div>
    <div className="text-right"><p className="text-xs text-ink-600">Original purchase-cost credit</p>
     <p className="text-xl font-semibold text-ink">{taka(sum)}</p>
     <Button disabled={!permitted||busy||saving||unknown||!chosen.length||!reason.trim()||
       chosen.some(l=>l.qty>l.line.availableQty)}
       onClick={()=>void submit()}>
      {saving?'Posting return…':'Confirm Purchase Return · ফেরত নিশ্চিত'}
     </Button>
    </div>
   </div>
  </>}
 </div>;
}
