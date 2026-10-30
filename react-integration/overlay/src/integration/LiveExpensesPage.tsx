import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Receipt,RefreshCw} from 'lucide-react';
import {useUiCopy} from '../i18n/useUiCopy';
import {canUseModule,useBackendSession} from './BackendGate';
import {
 BackendRequestError,getLiveExpenseBootstrap,getLiveExpenses,postLiveExpense,
 updateLiveExpense,cancelLiveExpense,
 type LiveExpenseBootstrap,type LiveExpenseRow,type LiveExpenseInput
} from './banijjApi';

const today=()=>new Intl.DateTimeFormat('sv-SE',{
 timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'
}).format(new Date());
const money=(n:number,symbol:string)=>symbol+n.toLocaleString('en-BD',{
 minimumFractionDigits:2,maximumFractionDigits:4
});

export function LiveExpensesPage(){
 const user=useBackendSession(),{text}=useUiCopy();
 const canView=canUseModule(user,'expense','view');
 const canAdd=canUseModule(user,'expense','add'),canEdit=canUseModule(user,'expense','edit');
 const [bootstrap,setBootstrap]=useState<LiveExpenseBootstrap|null>(null);
 const [entries,setEntries]=useState<LiveExpenseRow[]>([]);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [reload,setReload]=useState(0),[search,setSearch]=useState('');
 const [categoryId,setCategoryId]=useState(''),[payeeId,setPayeeId]=useState('');
 const [date,setDate]=useState(today()),[amount,setAmount]=useState('');
 const [method,setMethod]=useState<LiveExpenseInput['paymentMethod']>('Cash');
 const [bankId,setBankId]=useState(''),[description,setDescription]=useState('');
 const [backdatedReason,setBackdatedReason]=useState('');
 const [review,setReview]=useState(false),[uncertain,setUncertain]=useState(false);
 const [editingId,setEditingId]=useState('');
 const [cancelId,setCancelId]=useState(''),[cancelReason,setCancelReason]=useState('');
 const requestKey=useRef(crypto.randomUUID());

 useEffect(()=>{
  if(!canView)return;
  let mounted=true;setLoading(true);setError('');
  Promise.all([getLiveExpenseBootstrap(),getLiveExpenses()])
   .then(([b,x])=>{if(mounted){setBootstrap(b);setEntries(x.expenses);}})
   .catch(e=>{if(mounted)setError(e instanceof Error?e.message:'Unable to load expenses.');})
   .finally(()=>{if(mounted)setLoading(false);});
  return ()=>{mounted=false;};
 },[canView,reload]);
 const reset=()=>{
  setEditingId('');setCategoryId('');setPayeeId('');setDate(today());
  setAmount('');setMethod('Cash');setBankId('');setDescription('');setBackdatedReason('');
  setReview(false);setUncertain(false);requestKey.current=crypto.randomUUID();
 };
 const eligible=bootstrap?.activeCashSession && !!categoryId && Number(amount)>0 &&
  Number.isFinite(Number(amount)) &&
  Math.abs(Number(amount)*10000-Math.round(Number(amount)*10000))<0.00001 &&
  (method==='Cash'||bootstrap.bankAccounts.some(a=>a.id===bankId&&a.accountType===method)) &&
  (date>=today()||backdatedReason.trim().length>=8);
 const data:LiveExpenseInput={
  categoryId,payeeId,amount:Number(amount),paymentMethod:method,
  bankAccountId:method==='Cash'?'':bankId,description,date,backdatedReason,
  clientRequestId:requestKey.current
 };
 async function submit(e:FormEvent){
  e.preventDefault();
  if(busy||!eligible||!(editingId?canEdit:canAdd))return;
  if(!review&&!uncertain){setReview(true);return;}
  setBusy(true);setError('');setNotice('');
  try{
   const result=editingId?await updateLiveExpense(editingId,data):await postLiveExpense(data);
   setNotice(text('Expense recorded: ','খরচ জমা হয়েছে: ')+result.id);
   reset();setReload(v=>v+1);
  }catch(e){
   const ambiguous=e instanceof BackendRequestError&&(e.status===null||e.status>=500);
   setUncertain(ambiguous);
   setError(ambiguous?
    text('Posting status unknown. Retry the same request ID or refresh before another entry.',
         'লেনদেন নিশ্চিত নয়। একই অনুরোধ আবার দিন, অথবা নতুন করার আগে হালনাগাদ করুন।'):
    e instanceof Error?e.message:'Could not save expense.');
  }finally{setBusy(false);}
 }
 function edit(row:LiveExpenseRow){
  setEditingId(row.expenseId);setCategoryId(row.categoryId);setPayeeId(row.payeeId);
  setDate(row.date);setAmount(String(row.amount));
  setMethod(row.paymentMethod as LiveExpenseInput['paymentMethod']);setBankId(row.bankAccountId);
  setDescription(row.description);setBackdatedReason(row.backdatedReason);
  setReview(false);setUncertain(false);setCancelId('');requestKey.current=crypto.randomUUID();
 }
 async function cancel(){
  if(!canEdit||!cancelId||cancelReason.trim().length<8||busy)return;
  setBusy(true);setError('');
  try{
   await cancelLiveExpense(cancelId,cancelReason);
   setNotice(text('Expense cancelled.','খরচ বাতিল হয়েছে।'));
   setCancelId('');setCancelReason('');setReload(v=>v+1);
  }catch(e){
   setError(e instanceof Error?e.message:'Cancellation was not confirmed. Refresh before retrying.');
  }finally{setBusy(false);}
 }
 const filtered=entries.filter(x=>
  [x.expenseId,x.category,x.payeeName,x.description,x.referenceNo]
   .some(v=>v.toLowerCase().includes(search.trim().toLowerCase())));
 const symbol=bootstrap?.currencySymbol||'৳';
 if(!canView)return <main className="p-4" data-live-expenses="">
  <h1 className="text-lg font-semibold text-ink">{text('Expenses','খরচ')}</h1>
  <p role="alert" className="mt-2 text-sm text-danger">{text('Access denied.','দেখার অনুমতি নেই।')}</p>
 </main>;
 return <main className="mx-auto w-full max-w-[1300px] space-y-3 p-3 sm:p-4" data-live-expenses="">
  <header className="flex flex-wrap items-center justify-between gap-2">
   <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
    <Receipt size={20} aria-hidden="true"/>{text('Expenses','খরচ')}</h1>
   <button className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm"
    onClick={()=>setReload(v=>v+1)} type="button" disabled={loading}>
    <RefreshCw size={15} aria-hidden="true"/>{text('Refresh','হালনাগাদ')}
   </button>
  </header>
  {loading&&<p role="status" className="text-sm text-ink-500">{text('Loading real expenses…','মূল খরচ লোড হচ্ছে…')}</p>}
  {error&&<p role="alert" className="rounded-lg border border-danger bg-danger-bg p-3 text-sm text-danger">{error}</p>}
  {notice&&<p role="status" className="text-sm text-success">{notice}</p>}
  {(canAdd||canEdit)&&<form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-card p-3">
   <div className="flex items-center justify-between gap-2">
    <h2 className="text-sm font-semibold">{editingId?text('Edit expense','খরচ সংশোধন'):text('Add expense','নতুন খরচ')}</h2>
    {editingId&&<button type="button" onClick={reset} className="text-xs text-primary underline">{text('Cancel edit','সংশোধন বাতিল')}</button>}
   </div>
   {!bootstrap?.activeCashSession&&<p role="status" className="text-xs text-warning">
    {text('Start the POS cash session before posting.','খরচের আগে POS নগদ সেশন শুরু করুন।')}</p>}
   <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
    <label className="text-xs text-ink-600">{text('Category','ধরন')}
     <select aria-label="Expense category" value={categoryId} disabled={busy||uncertain}
      onChange={e=>{setCategoryId(e.target.value);setReview(false);}}
      className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm">
      <option value="">{text('Select','বাছুন')}</option>
      {bootstrap?.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
     </select>
    </label>
    <label className="text-xs text-ink-600">{text('Amount','টাকা')}
     <input aria-label="Expense amount" type="number" min="0.0001" step="0.0001"
      value={amount} disabled={busy||uncertain} onChange={e=>{setAmount(e.target.value);setReview(false);}}
      className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"/>
    </label>
    <label className="text-xs text-ink-600">{text('Payment method','পেমেন্ট মাধ্যম')}
     <select aria-label="Expense payment method" value={method} disabled={busy||uncertain}
      onChange={e=>{setMethod(e.target.value as LiveExpenseInput['paymentMethod']);setBankId('');setReview(false);}}
      className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm">
      <option value="Cash">{text('Cash','নগদ')}</option>
      <option value="Bank">{text('Bank','ব্যাংক')}</option>
      <option value="Mobile Banking">{text('Mobile Banking','মোবাইল ব্যাংকিং')}</option>
     </select>
    </label>
    {method!=='Cash'&&<label className="text-xs text-ink-600">{text('Account','হিসাব')}
     <select aria-label="Expense bank account" value={bankId} disabled={busy||uncertain}
      onChange={e=>{setBankId(e.target.value);setReview(false);}}
      className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm">
      <option value="">{text('Select account','হিসাব বাছুন')}</option>
      {bootstrap?.bankAccounts.filter(a=>a.accountType===method).map(a=>
       <option key={a.id} value={a.id}>{a.name}</option>)}
     </select>
    </label>}
    <label className="text-xs text-ink-600">{text('Date','তারিখ')}
     <input aria-label="Expense date" type="date" value={date} disabled={busy||uncertain}
      onChange={e=>{setDate(e.target.value);setReview(false);}}
      className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"/>
    </label>
    <label className="text-xs text-ink-600">{text('Payee (optional)','প্রাপক (ঐচ্ছিক)')}
     <select aria-label="Expense payee" value={payeeId} disabled={busy||uncertain}
      onChange={e=>{setPayeeId(e.target.value);setReview(false);}}
      className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm">
      <option value="">{text('None','নেই')}</option>
      {bootstrap?.payees.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
     </select>
    </label>
    <label className="col-span-2 text-xs text-ink-600">{text('Description','বিবরণ')}
     <input aria-label="Expense description" value={description} disabled={busy||uncertain}
      onChange={e=>{setDescription(e.target.value);setReview(false);}}
      className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"/>
    </label>
    {date<today()&&<label className="col-span-2 text-xs text-ink-600">
      {text('Reason for old date','পুরনো তারিখের কারণ')}
     <input aria-label="Expense backdate reason" value={backdatedReason} disabled={busy||uncertain}
      onChange={e=>{setBackdatedReason(e.target.value);setReview(false);}}
      className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"/>
    </label>}
   </div>
   {review&&<p role="status" className="rounded-lg border border-border bg-ink-50 p-2 text-xs">
    {text('Review: ','যাচাই: ')}{amount} · {method} · {bootstrap?.categories.find(c=>c.id===categoryId)?.name}
   </p>}
   <button type="submit" disabled={!eligible||busy||!(editingId?canEdit:canAdd)}
    className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50">
    {uncertain?text('Retry same request','একই অনুরোধ আবার দিন'):
     review?text('Confirm expense','খরচ নিশ্চিত করুন'):text('Review expense','খরচ যাচাই করুন')}
   </button>
  </form>}
  <section className="rounded-xl border border-border bg-card p-3">
   <label className="block text-xs text-ink-600">{text('Search expenses','খরচ খুঁজুন')}
    <input aria-label="Expense search" value={search} onChange={e=>setSearch(e.target.value)}
     className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-3 text-sm"/>
   </label>
   <div role="region" tabIndex={0} aria-label="Expense table" className="mt-3 overflow-x-auto rounded-lg border border-border">
    <table className="w-full min-w-[630px] text-left text-sm">
     <thead className="bg-ink-50 text-xs text-ink-500"><tr>
      <th className="p-2">{text('Date','তারিখ')}</th><th className="p-2">{text('Category / Reference','ধরন / রেফারেন্স')}</th>
      <th className="p-2">{text('Payment','পেমেন্ট')}</th>
      <th className="p-2 text-right">{text('Amount','টাকা')}</th><th className="p-2">{text('Actions','কাজ')}</th>
     </tr></thead>
     <tbody>{filtered.map(e=><tr key={e.expenseId} className="border-t border-border">
      <td className="p-2 text-xs">{e.date}</td>
      <td className="p-2">{e.category}<span className="block text-xs text-ink-500">{e.expenseId}</span>
       {e.description&&<span className="block text-xs text-ink-500">{e.description}</span>}
      </td><td className="p-2 text-xs">{e.paymentMethod}{e.bankAccountName?' · '+e.bankAccountName:''}</td>
      <td className="p-2 text-right text-danger">{money(e.amount,symbol)}</td>
      <td className="p-2 text-xs">
       {canEdit&&<div className="flex gap-2">
        <button type="button" className="h-9 rounded-lg border border-border px-2 text-primary"
         onClick={()=>edit(e)}>{text('Edit','সংশোধন')}</button>
        <button type="button" className="h-9 rounded-lg border border-border px-2 text-danger"
         onClick={()=>{setCancelId(e.expenseId);setCancelReason('');}}>{text('Cancel','বাতিল')}</button>
       </div>}
      </td>
     </tr>)}</tbody>
    </table>
   </div>
   {!loading&&filtered.length===0&&<p className="p-3 text-xs text-ink-500">{text('No expenses found.','কোনো খরচ নেই।')}</p>}
   {cancelId&&<div className="mt-3 space-y-2 border-t border-border pt-3">
    <p className="text-xs font-semibold">{text('Confirm cancellation','বাতিল নিশ্চিত করুন')}: {cancelId}</p>
    <label className="block text-xs">{text('Reason','কারণ')}
     <input aria-label="Expense cancellation reason" value={cancelReason}
      onChange={e=>setCancelReason(e.target.value)}
      className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"/>
    </label>
    <div className="flex gap-2">
     <button type="button" onClick={()=>void cancel()} disabled={busy||cancelReason.trim().length<8}
      className="h-9 rounded-lg bg-danger px-3 text-xs text-white disabled:opacity-50">{text('Confirm cancel','বাতিল করুন')}</button>
     <button type="button" onClick={()=>setCancelId('')}
      className="h-9 rounded-lg border border-border px-3 text-xs">{text('Keep expense','রাখুন')}</button>
    </div>
   </div>}
  </section>
 </main>;
}
