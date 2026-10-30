import { useEffect, useRef, useState, type FormEvent } from 'react';
import { RefreshCw, Landmark, Users } from 'lucide-react';
import { useUiCopy } from '../i18n/useUiCopy';
import { canUseModule, useBackendSession } from './BackendGate';
import {
  getBankReconciliation, getFinanceBootstrap, getBankAccounts, getBankTransfers,
  postBankTransfer, reverseBankTransfer, BackendRequestError,
  type LiveBankAccount, type LiveBankTransfer, type BankReconciliation, type FinanceBootstrap
} from './banijjApi';

const taka = (value:number, symbol:string) =>
  symbol + value.toLocaleString('en-BD',{minimumFractionDigits:2,maximumFractionDigits:4});


function LiveBankTransferTools({add,edit,onChanged, text}:{
  add:boolean; edit:boolean; onChanged:()=>void; text:(english:string,bangla:string)=>string;
}){
  const [accounts,setAccounts]=useState<LiveBankAccount[]>([]);
  const [history,setHistory]=useState<LiveBankTransfer[]>([]);
  const [loading,setLoading]=useState(true);
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[amount,setAmount]=useState(''),[notes,setNotes]=useState('');
  const [review,setReview]=useState(false),[pending,setPending]=useState(false),[unknown,setUnknown]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const [reverseId,setReverseId]=useState(''),[reason,setReason]=useState('');
  const [refresh,setRefresh]=useState(0);
  const clientRequestId=useRef(crypto.randomUUID());

  useEffect(()=>{
    let live=true;setLoading(true);
    Promise.all([getBankAccounts(),getBankTransfers()])
      .then(([a,t])=>{if(live){setAccounts(a.bankAccounts);setHistory(t.transfers);setError('');}})
      .catch(e=>{if(live)setError(e instanceof Error?e.message:'Unable to load transfer accounts.');})
      .finally(()=>{if(live)setLoading(false);});
    return ()=>{live=false;};
  },[refresh]);
  const active=accounts.filter(a=>a.status==='Active');
  const formatted=(id:string)=>active.find(a=>a.id===id)?.name||id;
  const valid=from!==''&&to!==''&&from!==to&&Number(amount)>0&&
    Number.isFinite(Number(amount))&&Math.abs(Number(amount)*10000-Math.round(Number(amount)*10000))<0.00001;
  const resetDraft=()=>{
    setFrom('');setTo('');setAmount('');setNotes('');setReview(false);setUnknown(false);
    clientRequestId.current=crypto.randomUUID();
  };
  async function confirmTransfer(){
    if(!valid||pending)return;
    setPending(true);setError('');setNotice('');
    try{
      const result=await postBankTransfer({
        fromAccountId:from,toAccountId:to,amount:Number(amount),notes,
        clientRequestId:clientRequestId.current
      });
      setNotice(text('Transfer saved: ','টাকা স্থানান্তর হয়েছে: ')+result.id);
      resetDraft();setRefresh(v=>v+1);onChanged();
    }catch(e){
      const uncertain=e instanceof BackendRequestError&&(e.status===null||e.status>=500);
      setUnknown(uncertain);
      setError(uncertain?
        text('Posting status unknown. Retry same request; it cannot create a second transfer.',
          'পোস্ট হয়েছে কি না অজানা। একই অনুরোধ আবার দিন, দ্বিতীয় লেনদেন হবে না।'):
        e instanceof Error?e.message:'Transfer not posted.');
    }finally{setPending(false);}
  }
  async function performReversal(){
    if(pending||!reverseId||reason.trim().length<8)return;
    setPending(true);setError('');setNotice('');
    try{
      await reverseBankTransfer(reverseId,reason.trim());
      setNotice(text('Transfer reversed with two ledger entries.','উভয় খতিয়ানে বিপরীত লেনদেন লেখা হয়েছে।'));
      setReverseId('');setReason('');setRefresh(v=>v+1);onChanged();
    }catch(e){setError(e instanceof Error?e.message:'Could not reverse transfer.');}
    finally{setPending(false);}
  }
  return <section className="space-y-3 rounded-xl border border-border bg-card p-3" aria-label={text('Bank transfers','ব্যাংক স্থানান্তর')} data-phase6-bank-transfers="">
    <h2 className="text-sm font-semibold text-ink">{text('Bank & mobile transfers','ব্যাংক ও মোবাইল টাকা স্থানান্তর')}</h2>
    {loading&&<p role="status" className="text-xs text-ink-500">{text('Loading transfer history…','স্থানান্তর হিসাব লোড হচ্ছে…')}</p>}
    {error&&<p role="alert" className="rounded-lg bg-danger-bg p-2 text-xs text-danger">{error}</p>}
    {notice&&<p role="status" className="rounded-lg border border-border p-2 text-xs text-success">{notice}</p>}
    {add&&<form onSubmit={(e:FormEvent)=>{e.preventDefault();if(!unknown)setReview(true);}} className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-ink-600">{text('From account','যে হিসাব থেকে')}
          <select aria-label="Transfer from account" value={from} onChange={e=>{setFrom(e.target.value);setReview(false);}}
            disabled={pending||unknown} required className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm">
            <option value="">{text('Choose account','হিসাব বাছুন')}</option>
            {active.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-600">{text('To account','যে হিসাবে')}
          <select aria-label="Transfer to account" value={to} onChange={e=>{setTo(e.target.value);setReview(false);}}
            disabled={pending||unknown} required className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm">
            <option value="">{text('Choose account','হিসাব বাছুন')}</option>
            {active.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-600">{text('Amount','টাকার পরিমাণ')}
          <input aria-label="Transfer amount" type="number" step="0.0001" min="0.0001" value={amount}
            onChange={e=>{setAmount(e.target.value);setReview(false);}} disabled={pending||unknown}
            required className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-3 text-sm"/>
        </label>
        <label className="text-xs text-ink-600">{text('Note (optional)','বিবরণ (ঐচ্ছিক)')}
          <input aria-label="Transfer note" value={notes} onChange={e=>{setNotes(e.target.value);setReview(false);}}
            disabled={pending||unknown} className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-3 text-sm"/>
        </label>
      </div>
      {review&&<p role="status" className="rounded-lg border border-border bg-ink-50 p-3 text-sm text-ink">
        {text('Please confirm:','যাচাই করুন:')} {formatted(from)} → {formatted(to)} · {amount}
      </p>}
      {unknown?
        <button type="button" disabled={pending} onClick={confirmTransfer}
          className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50">
          Retry same request
        </button>:
        <button type={review?'button':'submit'} disabled={pending||!valid} onClick={review?confirmTransfer:undefined}
          className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50">
          {review?text('Confirm transfer','স্থানান্তর নিশ্চিত করুন'):text('Review transfer','স্থানান্তর যাচাই')}
        </button>}
    </form>}
    <div className="space-y-2 border-t border-border pt-3">
      <h3 className="text-xs font-semibold text-ink">{text('Recent transfers','সাম্প্রতিক স্থানান্তর')}</h3>
      {!loading&&history.length===0&&<p className="text-xs text-ink-500">{text('No transfers yet.','এখনো স্থানান্তর নেই।')}</p>}
      {history.slice(0,10).map(t=><div key={t.transferId} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-xs">
        <div className="min-w-0"><p className="font-medium text-ink">{t.fromAccountName} → {t.toAccountName}</p>
          <p className="text-ink-500">{t.transferId} · {t.date} · {t.amount.toLocaleString('en-BD')}</p>
          {t.reversedAt&&<p className="text-warning">{text('Reversed','বাতিল হয়েছে')}</p>}
        </div>
        {edit&&!t.reversedAt&&<button type="button" disabled={pending} onClick={()=>{setReverseId(t.transferId);setReason('');}}
          className="h-9 rounded-lg border border-border px-3 text-xs text-ink focus-visible:ring-2 focus-visible:ring-primary">
          {text('Reverse','বিপরীত করুন')}
        </button>}
      </div>)}
      {edit&&reverseId&&<div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-xs font-semibold text-ink">{text('Reverse transfer','স্থানান্তর বিপরীত করুন')} · {reverseId}</p>
        <label className="block text-xs text-ink-600">{text('Reason','কারণ')}
          <input aria-label="Transfer reversal reason" value={reason} onChange={e=>setReason(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-3 text-sm"/>
        </label>
        <div className="flex gap-2">
          <button type="button" disabled={pending||reason.trim().length<8} onClick={performReversal}
            className="h-9 rounded-lg border border-border px-3 text-xs font-semibold text-danger disabled:opacity-50">
            {text('Confirm reversal','বিপরীত লেনদেন নিশ্চিত')}
          </button>
          <button type="button" onClick={()=>setReverseId('')}
            className="h-9 rounded-lg border border-border px-3 text-xs">{text('Cancel','ফিরুন')}</button>
        </div>
      </div>}
    </div>
  </section>;
}

export function LiveFinancePage() {
  const user = useBackendSession();
  const { text } = useUiCopy();
  const canFinance = canUseModule(user,'finance','view');
  const canBank = canUseModule(user,'bank','view');
  const canBankAdd=canUseModule(user,'bank','add');
  const canBankEdit=canUseModule(user,'bank','edit');
  const [bank,setBank] = useState<BankReconciliation|null>(null);
  const [finance,setFinance] = useState<FinanceBootstrap|null>(null);
  const [errors,setErrors] = useState<string[]>([]);
  const [loading,setLoading] = useState(false);
  const [reload,setReload] = useState(0);

  useEffect(()=>{
    if(!canFinance&&!canBank)return;
    let current=true;
    setLoading(true);setErrors([]);setBank(null);setFinance(null);
    Promise.allSettled([
      canBank?getBankReconciliation():Promise.resolve(null),
      canFinance?getFinanceBootstrap():Promise.resolve(null)
    ]).then(([b,f])=>{
      if(!current)return;
      const failures:string[]=[];
      if(b.status==='fulfilled')setBank(b.value);
      else failures.push(b.reason instanceof Error?b.reason.message:'Unable to load bank accounts.');
      if(f.status==='fulfilled')setFinance(f.value);
      else failures.push(f.reason instanceof Error?f.reason.message:'Unable to load finance people.');
      setErrors(failures);
    }).finally(()=>{if(current)setLoading(false);});
    return ()=>{current=false;};
  },[canFinance,canBank,reload]);

  if(!canFinance&&!canBank)return <main className="p-5" data-live-finance="">
    <h1 className="text-lg font-semibold text-ink">{text('Finance','অর্থ হিসাব')}</h1>
    <p role="alert" className="mt-2 text-sm text-danger">
      {text('You do not have permission to view finance.','অর্থ হিসাব দেখার অনুমতি নেই।')}</p>
  </main>;

  const symbol=finance?.currencySymbol||'৳';
  return <main className="mx-auto w-full max-w-[1440px] space-y-4 p-3 sm:p-4" data-live-finance="">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-semibold text-ink">{text('Finance','অর্থ হিসাব')}</h1>
        <p className="mt-1 text-xs text-ink-500">
          {text('Live accounts and finance people. Book balance is not a bank statement balance.',
            'মূল ব্যাংক ও ব্যক্তির হিসাব। বইয়ের জের ব্যাংক স্টেটমেন্টের জের নয়।')}
        </p>
      </div>
      <button type="button" onClick={()=>setReload(v=>v+1)} disabled={loading}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-ink hover:bg-ink-50 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">
        <RefreshCw size={15} aria-hidden="true"/>{text('Refresh','হালনাগাদ')}</button>
    </header>
    {loading&&<p role="status" className="text-xs text-ink-500">
      {text('Loading real accounts…','মূল হিসাব লোড হচ্ছে…')}</p>}
    {errors.map((error,i)=><p key={i} role="alert" className="rounded-lg border border-danger bg-danger-bg p-3 text-sm text-danger">{error}</p>)}

    {canBank&&<section className="overflow-hidden rounded-xl border border-border bg-card" aria-label={text('Bank and mobile accounts','ব্যাংক ও মোবাইল হিসাব')}>
      <div className="flex items-center gap-2 border-b border-border p-3">
        <Landmark className="size-4 text-primary" aria-hidden="true"/>
        <h2 className="text-sm font-semibold text-ink">{text('Bank and mobile banking','ব্যাংক ও মোবাইল ব্যাংকিং')}</h2>
      </div>
      {bank&&<>
        {bank.coverage.status==='needs-review'&&
          <p role="status" className="border-b border-border px-3 py-2 text-xs text-warning">
            {text('Some balances need review. Only matching book balances are displayed.',
              'কিছু জের যাচাই করতে হবে। শুধু মিলে যাওয়া বইয়ের জের দেখানো হচ্ছে।')}
          </p>}
        <div className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" role="region" tabIndex={0}
          aria-label={text('Bank account balances table','ব্যাংক হিসাবের জেরের তালিকা')}>
          <table className="w-full min-w-[420px] text-left text-sm">
          <thead className="bg-ink-50 text-xs text-ink-500"><tr>
            <th className="p-3 font-medium">{text('Account','হিসাব')}</th>
            <th className="p-3 font-medium">{text('Type','ধরন')}</th>
            <th className="p-3 font-medium">{text('Book check','বইয়ের মিল')}</th>
            <th className="p-3 text-right font-medium">{text('Book balance','বইয়ের জের')}</th>
          </tr></thead>
          <tbody>{bank.accounts.map(a=><tr key={a.id} className="border-t border-border">
            <td className="p-3 font-medium text-ink">{a.name}</td>
            <td className="p-3 text-xs text-ink-600">{a.accountType}</td>
            <td className="p-3 text-xs"><span className={a.status==='ready'?'text-success':'text-warning'}>
              {a.status==='ready'?text('Book matched','বই মিলে গেছে'):text('Needs review','যাচাই দরকার')}
            </span><span className="sr-only">: {a.reason}</span></td>
            <td className="p-3 text-right tabular-nums text-ink">
              {a.status==='ready'&&a.bookBalance!==null?taka(a.bookBalance,symbol):'—'}
            </td>
          </tr>)}</tbody>
        </table></div>
        {bank.accounts.length===0&&<p className="p-4 text-xs text-ink-500">
          {text('No bank accounts yet.','এখনো কোনো ব্যাংক হিসাব নেই।')}</p>}
      </>}
    </section>}

    {canBank&&<LiveBankTransferTools add={canBankAdd} edit={canBankEdit} text={text} onChanged={()=>setReload(v=>v+1)}/>}

    {canFinance&&<section className="overflow-hidden rounded-xl border border-border bg-card" aria-label={text('Finance people','অর্থ হিসাবের ব্যক্তি')}>
      <div className="flex items-center gap-2 border-b border-border p-3">
        <Users className="size-4 text-primary" aria-hidden="true"/>
        <h2 className="text-sm font-semibold text-ink">{text('Owners and lenders','মালিক ও ঋণদাতা')}</h2>
      </div>
      {finance&&<div className="divide-y divide-border">
        {finance.personsAll.map(p=><div key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
          <span className="font-medium text-ink">{p.name}</span>
          <span className="text-xs text-ink-500">{p.type==='Owner'?text('Owner','মালিক'):text('Lender','ঋণদাতা')}
            {' · '}{p.status}</span>
        </div>)}
        {finance.personsAll.length===0&&<p className="p-4 text-xs text-ink-500">
          {text('No finance people yet.','এখনো কোনো অর্থ হিসাবের ব্যক্তি নেই।')}</p>}
      </div>}
      <p className="border-t border-border px-3 py-2 text-xs text-ink-500">
        {text('Person balances require original-ledger reconciliation in Phase 6D. No unverified totals are shown.',
          'ব্যক্তির জের ৬ডি ধাপে মূল খতিয়ানের সাথে মিলিয়ে দেখানো হবে।')}</p>
    </section>}
  </main>;
}
