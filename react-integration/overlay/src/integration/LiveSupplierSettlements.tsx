import {useEffect,useRef,useState} from 'react';
import {Button} from '../components/Button';
import {Input} from '../components/Input';
import {canUseModule,useBackendSession} from './BackendGate';
import {BackendRequestError} from './banijjApi';
import {searchPurchaseSuppliers,loadSupplierSettlements,
 submitSupplierSettlement,reverseSettlement,type PurchaseSupplier,
 type SettlementDetails} from './purchaseApi';

const taka=(n:number)=>'৳'+(Number(n)||0).toLocaleString('en-BD',{maximumFractionDigits:4});
export function LiveSupplierSettlements({supplierId}: {supplierId:string}){
 const user=useBackendSession(),permitted=canUseModule(user,'purchase','add');
 const [search,setSearch]=useState(''),[options,setOptions]=useState<PurchaseSupplier[]>([]);
 const [chosen,setChosen]=useState<PurchaseSupplier|null>(null);
 const [data,setData]=useState<SettlementDetails|null>(null);
 const [amount,setAmount]=useState(''),[method,setMethod]=useState('Cash');
 const [bankId,setBankId]=useState(''),[notes,setNotes]=useState('');
 const [busy,setBusy]=useState(false),[saving,setSaving]=useState(false);
 const [error,setError]=useState(''),[success,setSuccess]=useState('');
 const [uncertain,setUncertain]=useState(false);
 const [reverseId,setReverseId]=useState(''),[reverseReason,setReverseReason]=useState('');
 const requestId=useRef(crypto.randomUUID()),locked=useRef(false);
 useEffect(()=>{
   if(!supplierId)return;
   let active=true;
   searchPurchaseSuppliers(supplierId).then(rows=>{
    if(!active)return;
    const match=rows.find(s=>s.id===supplierId);
    if(match){setChosen(match);setSearch(match.name);}
   }).catch(e=>{if(active)setError(e instanceof Error?e.message:'Supplier unavailable');});
   return ()=>{active=false;};
 },[supplierId]);
 useEffect(()=>{
  if(!chosen){setData(null);return;}
  let active=true;setBusy(true);
  loadSupplierSettlements(chosen.id).then(r=>{if(active)setData(r);})
   .catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not load supplier balance');})
   .finally(()=>{if(active)setBusy(false);});
  return ()=>{active=false;};
 },[chosen]);
 useEffect(()=>{
  if(chosen||!search.trim()){setOptions([]);return;}
  let live=true;
  const timer=setTimeout(()=>searchPurchaseSuppliers(search).then(rows=>{
   if(live)setOptions(rows);
  }).catch(()=>{if(live)setOptions([]);}),120);
  return ()=>{live=false;clearTimeout(timer);};
 },[search,chosen]);
 const refresh=async()=>{
  if(!chosen)return;
  const result=await loadSupplierSettlements(chosen.id);
  setData(result);return result;
 };
 function clearDraft(){
  setAmount('');setMethod('Cash');setBankId('');setNotes('');
  requestId.current=crypto.randomUUID();setUncertain(false);
 }
 async function post(){
  if(!chosen||!data||!permitted||saving||locked.current||uncertain)return;
  const value=Number(amount);
  if(!Number.isFinite(value)||value<=0||value>data.supplier.currentDue||
    Math.abs(value*10000-Math.round(value*10000))>0.000001){
   setError('Enter a valid amount not exceeding the supplier due.');return;
  }
  if(method!=='Cash'&&!bankId){setError('Select a bank/mobile account.');return;}
  locked.current=true;setSaving(true);setError('');setSuccess('');
  try{
   const posted=await submitSupplierSettlement({supplierId:chosen.id,
    clientRequestId:requestId.current,amount:value,method,bankAccountId:bankId,notes});
   setSuccess('Payment saved · '+posted.settlementId+' · '+taka(posted.amount));
   clearDraft();await refresh();
  }catch(e){
   setError(e instanceof Error?e.message:'Payment failed');
   if(e instanceof BackendRequestError&&(e.status===null||e.status>=500))setUncertain(true);
  }finally{setSaving(false);locked.current=false;}
 }
 async function reconcileUnknown(){
  if(!chosen)return;
  try{
   const current=await refresh();
   const found=current?.settlements.find(x=>x.requestId===requestId.current);
   if(found){setSuccess('Payment confirmed · '+found.settlementId+' · '+taka(found.amount));clearDraft();}
   else {setUncertain(false);setError('Payment was not found. You may retry with the same request ID.');}
  }catch(e){setError(e instanceof Error?e.message:'Cannot check payment history');}
 }
 async function reverse(){
  if(!reverseId||reverseReason.trim().length<4||saving)return;
  locked.current=true;setSaving(true);setError('');setSuccess('');
  try{
   const done=await reverseSettlement(reverseId,reverseReason.trim());
   setSuccess('Reversal recorded · '+done.reversalLedgerId);
   setReverseId('');setReverseReason('');await refresh();
  }catch(e){setError(e instanceof Error?e.message:'Reversal failed');}
  finally{locked.current=false;setSaving(false);}
 }
 return <section data-live-supplier-settlements className="space-y-4">
  <div className="rounded-xl border border-border bg-card p-3 shadow-card">
   <h2 className="mb-2 text-sm font-semibold text-ink">Supplier · সরবরাহকারী নির্বাচন</h2>
   <div className="relative max-w-lg">
    <Input aria-label="Find supplier for payment" placeholder="Search supplier name, phone or ID"
     value={search} disabled={saving||uncertain}
     onChange={e=>{setSearch(e.target.value);setChosen(null);setData(null);setError('');}}/>
    {options.length>0&&<div role="listbox" aria-label="Supplier search results"
      className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-lg border border-border bg-card p-1 shadow-lg">
     {options.map(s=><button key={s.id} role="option" aria-selected={false} type="button"
      onClick={()=>{setChosen(s);setSearch(s.name);setOptions([]);setError('');}}
      className="flex w-full justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-ink-50">
      <span>{s.name}</span><span>{taka(s.currentDue)}</span>
     </button>)}
    </div>}
   </div>
   {data&&<div className="mt-3 flex flex-wrap gap-3 text-sm text-ink">
    <span className="rounded-md bg-ink-50 px-3 py-2">Current due · বাকি: <strong>{taka(data.supplier.currentDue)}</strong></span>
    <span className="rounded-md bg-ink-50 px-3 py-2">Ledger: {taka(data.ledgerDue)}</span>
   </div>}
   {busy&&<p role="status" className="mt-2 text-xs text-ink-500">Checking live payable…</p>}
   {data?.needsReconciliation&&<p role="alert" className="mt-2 text-sm text-danger">
    Supplier balance differs from ledger. Reconcile before paying.</p>}
   {data&&!data.activeSession&&<p role="alert" className="mt-2 text-sm text-warning">
    Open a cash session before paying this supplier.</p>}
  </div>
  {error&&<p role="alert" className="rounded-md bg-danger-bg p-3 text-sm text-danger">{error}</p>}
  {success&&<p role="status" className="rounded-md bg-success-bg p-3 text-sm text-success">{success}</p>}
  {uncertain&&<div role="alert" className="space-y-2 rounded-md border border-warning p-3 text-sm">
   Server response uncertain. Check the settlement records before retrying.
   <Button variant="outline" size="sm" onClick={()=>void reconcileUnknown()}>Check payment history</Button>
  </div>}
  {data&&<div className="rounded-xl border border-border bg-card p-3 shadow-card">
   <h2 className="mb-3 text-sm font-semibold text-ink">Pay Supplier · সরবরাহকারীকে পরিশোধ</h2>
   <div className="flex flex-wrap items-end gap-3">
    <div className="w-40">
     <label htmlFor="supplier-pay-amount" className="mb-1 block text-xs font-medium">Amount ৳</label>
     <Input id="supplier-pay-amount" aria-label="Supplier payment amount"
      type="number" step="0.0001" min="0" max={data.supplier.currentDue}
      disabled={saving||uncertain} value={amount} onChange={e=>setAmount(e.target.value)}/>
    </div>
    <div>
     <label htmlFor="supplier-pay-method" className="mb-1 block text-xs font-medium">Payment method</label>
     <select id="supplier-pay-method" aria-label="Supplier payment method"
      value={method} disabled={saving||uncertain} onChange={e=>{setMethod(e.target.value);setBankId('');}}
      className="h-9 rounded-md border border-border bg-card px-2 text-sm text-ink">
      <option value="Cash">Cash · নগদ</option><option value="Bank">Bank</option>
      <option value="Mobile Banking">Mobile Banking</option>
     </select>
    </div>
    {method!=='Cash'&&<div>
     <label htmlFor="supplier-pay-bank" className="mb-1 block text-xs font-medium">Bank/mobile account</label>
     <select id="supplier-pay-bank" aria-label="Supplier payment bank account"
      value={bankId} disabled={saving||uncertain} onChange={e=>setBankId(e.target.value)}
      className="h-9 max-w-[260px] rounded-md border border-border bg-card px-2 text-sm text-ink">
      <option value="">Choose account…</option>
      {data.bankAccounts.map(a=><option key={a.id} value={a.id}>
       {a.name} · {taka(a.currentBalance)}</option>)}
     </select>
    </div>}
    <div className="min-w-[150px] max-w-sm flex-1">
     <label htmlFor="supplier-pay-note" className="mb-1 block text-xs font-medium">Note (optional)</label>
     <Input id="supplier-pay-note" aria-label="Supplier payment note"
      value={notes} disabled={saving||uncertain} onChange={e=>setNotes(e.target.value)}/>
    </div>
    <Button disabled={!permitted||saving||uncertain||!data.activeSession||data.needsReconciliation||
      !amount||Number(amount)<=0||Number(amount)>data.supplier.currentDue||
      (method!=='Cash'&&!bankId)}
      onClick={()=>void post()}>{saving?'Posting…':'Confirm Payment · পরিশোধ নিশ্চিত'}</Button>
   </div>
   <p className="mt-2 text-xs text-ink-500">Payment, bank/cash book, supplier ledger, and audit are saved together.</p>
  </div>}
  {data&&<div className="rounded-xl border border-border bg-card p-3 shadow-card">
   <h2 className="mb-3 text-sm font-semibold text-ink">Settlement History · পরিশোধের ইতিহাস</h2>
   <div className="overflow-x-auto" role="region" tabIndex={0} aria-label="Supplier settlement history table"><table className="w-full min-w-[520px] text-left text-xs">
    <thead><tr className="border-b border-border text-ink-600">
     <th className="p-2">Date</th><th className="p-2">Method</th>
     <th className="p-2 text-right">Amount</th><th className="p-2">Status</th>
     <th className="p-2">Action</th></tr></thead>
    <tbody>{data.settlements.map(s=><tr key={s.settlementId} className="border-b border-border">
     <td className="p-2">{s.date}</td><td className="p-2">{s.method}</td>
     <td className="p-2 text-right">{taka(s.amount)}</td><td className="p-2">{s.status}</td>
     <td className="p-2">{s.status==='Posted'&&permitted&&
      (reverseId===s.settlementId?
       <div className="flex flex-wrap items-center gap-1">
        <Input aria-label="Supplier payment reversal reason" value={reverseReason}
         placeholder="Reason (required)" className="w-40" disabled={saving}
         onChange={e=>setReverseReason(e.target.value)}/>
        <Button size="sm" variant="outline" disabled={saving||reverseReason.trim().length<4}
         onClick={()=>void reverse()}>Confirm reversal</Button>
        <Button size="sm" variant="ghost" onClick={()=>{setReverseId('');setReverseReason('');}}>Cancel</Button>
       </div>:
       <Button size="sm" variant="ghost" onClick={()=>setReverseId(s.settlementId)}>
        Reverse · বাতিল
       </Button>)}</td>
    </tr>)}</tbody>
   </table></div>
   {!data.settlements.length&&<p className="py-6 text-center text-xs text-ink-500">No supplier payments found</p>}
  </div>}
 </section>;
}
