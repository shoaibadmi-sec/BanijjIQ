import { useEffect, useRef, useState, type FormEvent } from 'react';
import { RefreshCw, Landmark, Users } from 'lucide-react';
import { useUiCopy } from '../i18n/useUiCopy';
import { canUseModule, useBackendSession } from './BackendGate';
import {
  getBankReconciliation, getFinanceBootstrap, getBankAccounts, getBankTransfers,
  postBankTransfer, reverseBankTransfer, getCashSessionSummary, closeCashSession,
  startCashSession, getFinancePersonLedger, postFinanceTransaction, BackendRequestError,
  type LiveBankAccount, type LiveBankTransfer, type BankReconciliation, type FinanceBootstrap,
  type FinancePersonLedgerResponse
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


function LiveCashSessionPanel({canAdd,canEdit,text,onChanged}:{
  canAdd:boolean;canEdit:boolean;text:(en:string,bn:string)=>string;onChanged:()=>void;
}){
  const [summary,setSummary]=useState<Awaited<ReturnType<typeof getCashSessionSummary>>['summary']>(null);
  const [loading,setLoading]=useState(true);
  const [opening,setOpening]=useState('0'),[counted,setCounted]=useState('');
  const [notes,setNotes]=useState(''),[review,setReview]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [reload,setReload]=useState(0);
  const startRequestId=useRef(crypto.randomUUID()),closeRequestId=useRef(crypto.randomUUID());
  useEffect(()=>{
    let mounted=true;setLoading(true);
    getCashSessionSummary().then(result=>{
      if(mounted){setSummary(result.summary);setError('');}
    }).catch(e=>{if(mounted)setError(e instanceof Error?e.message:'Cash session could not be loaded.');})
      .finally(()=>{if(mounted)setLoading(false);});
    return ()=>{mounted=false;};
  },[reload]);
  const countedCash=Number(counted);
  const expectedCash=summary?.expectedCash??0;
  const validCount=counted.trim()!==''&&Number.isFinite(countedCash)&&countedCash>=0&&
    Math.abs(countedCash*10000-Math.round(countedCash*10000))<0.00001;
  const variance=Math.round((countedCash-expectedCash)*10000)/10000;
  const permitted=validCount&&(variance===0||(canEdit&&notes.trim().length>=8));
  const refresh=()=>{setReload(v=>v+1);onChanged();};
  async function beginSession(){
    const amount=Number(opening);
    if(!canAdd||busy||!Number.isFinite(amount)||amount<0)return;
    setBusy(true);setError('');setNotice('');
    try {
      await startCashSession(amount,startRequestId.current);
      startRequestId.current=crypto.randomUUID();
      setNotice(text('Cash session started.','ক্যাশ সেশন শুরু হয়েছে।'));refresh();
    }catch(e){setError(e instanceof Error?e.message:'Opening was not confirmed; retry the same request.');}
    finally{setBusy(false);}
  }
  async function finishSession(){
    if(!canAdd||busy||!summary||!permitted)return;
    setBusy(true);setError('');setNotice('');
    try{
      const result=await closeCashSession(countedCash,notes,closeRequestId.current);
      closeRequestId.current=crypto.randomUUID();setReview(false);
      setCounted('');setNotes('');
      setNotice(text('Cash session closed. Variance: ','ক্যাশ সেশন বন্ধ। পার্থক্য: ')+result.variance.toLocaleString('en-BD'));
      refresh();
    }catch(e){
      const unknown=e instanceof BackendRequestError&&(e.status===null||e.status>=500);
      setError(unknown?
        text('Close status unknown. Retry the same request; it cannot close twice.',
          'বন্ধ হয়েছে কি না অজানা। একই অনুরোধ পুনরায় দিন।'):
        e instanceof Error?e.message:'Cash close was not posted.');
      if(!unknown){setReview(false);closeRequestId.current=crypto.randomUUID();refresh();}
    }finally{setBusy(false);}
  }
  return <section className="space-y-3 rounded-xl border border-border bg-card p-3" data-phase6-cash-session=""
    aria-label={text('Cash session','ক্যাশ সেশন')}>
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-ink">{text('Cash session','ক্যাশ সেশন')}</h2>
      <button type="button" onClick={()=>setReload(v=>v+1)} disabled={busy}
        className="h-9 rounded-lg border border-border px-3 text-xs text-ink">{text('Refresh','হালনাগাদ')}</button>
    </div>
    {loading&&<p role="status" className="text-xs text-ink-500">{text('Reading cash book…','ক্যাশ খতিয়ান পড়া হচ্ছে…')}</p>}
    {error&&<p role="alert" className="rounded-lg border border-border p-2 text-xs text-danger">{error}</p>}
    {notice&&<p role="status" className="rounded-lg border border-border p-2 text-xs text-success">{notice}</p>}
    {!loading&&summary&&<>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          [text('Opening float','শুরুর নগদ'),summary.openingCash],
          [text('Cash in','নগদ জমা'),summary.cashIn],
          [text('Cash out','নগদ খরচ'),summary.cashOut],
          [text('Expected cash','প্রত্যাশিত নগদ'),expectedCash]
        ] as Array<[string,number]>).map(([name,value])=><div key={name} className="min-w-0">
          <dt className="text-xs text-ink-500">{name}</dt>
          <dd className="mt-1 text-sm font-semibold text-ink">{value.toLocaleString('en-BD',{maximumFractionDigits:4})}</dd>
        </div>)}
      </dl>
      <p className="text-xs text-ink-500">{text('Opening cash is not income. Differences are audit-only.',
        'শুরুর নগদ আয় নয়। গরমিল শুধু নিরীক্ষার তথ্য।')}</p>
      {canAdd&&<div className="space-y-2 border-t border-border pt-3">
        <label className="block text-xs text-ink-600">{text('Cash counted in drawer','হাতে গোনা নগদ টাকা')}
          <input type="number" min="0" step="0.0001" value={counted}
            aria-label="Counted cash" onChange={e=>{setCounted(e.target.value);setReview(false);}}
            className="mt-1 h-9 w-full max-w-[230px] rounded-lg border border-border bg-card px-3 text-sm"/>
        </label>
        {validCount&&<p className="text-xs text-ink-600">
          {text('Difference','পার্থক্য')}: <strong className={variance===0?'text-success':'text-warning'}>
            {variance.toLocaleString('en-BD',{maximumFractionDigits:4})}</strong></p>}
        {validCount&&variance!==0&&<label className="block text-xs text-ink-600">
          {text('Variance reason (required)','গরমিলের কারণ (আবশ্যক)')}
          <input aria-label="Cash variance reason" value={notes} onChange={e=>{setNotes(e.target.value);setReview(false);}}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-3 text-sm"/>
        </label>}
        {validCount&&variance!==0&&!canEdit&&<p role="alert" className="text-xs text-warning">
          {text('Manager permission required for a cash discrepancy.',
            'নগদের গরমিল বন্ধ করতে ম্যানেজারের অনুমতি দরকার।')}</p>}
        {review&&<p role="status" className="rounded-lg border border-border bg-ink-50 p-3 text-sm">
          {text('Review closing count','শেষ নগদ যাচাই করুন')} · {text('Expected','প্রত্যাশিত')} {expectedCash.toLocaleString('en-BD')}
          {' · '}{text('Counted','গোনা')} {countedCash.toLocaleString('en-BD')}
          {' · '}{text('Variance','পার্থক্য')} {variance.toLocaleString('en-BD')}
        </p>}
        <button type="button" disabled={busy||!permitted}
          onClick={()=>{if(review)void finishSession();else setReview(true);}}
          className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50">
          {review?text('Confirm close','বন্ধ নিশ্চিত করুন'):'Review close'}
        </button>
      </div>}
    </>}
    {!loading&&!summary&&<div className="space-y-2">
      <p className="text-xs text-ink-500">{text('No open cash session.','এখন কোনো ক্যাশ সেশন খোলা নেই।')}</p>
      {canAdd&&<>
        <label className="block text-xs text-ink-600">{text('Opening cash','শুরুর নগদ টাকা')}
          <input type="number" step="0.0001" min="0" value={opening} aria-label="Opening cash"
            onChange={e=>setOpening(e.target.value)}
            className="mt-1 h-9 w-full max-w-[230px] rounded-lg border border-border bg-card px-3 text-sm"/>
        </label>
        <button type="button" onClick={()=>void beginSession()} disabled={busy||opening.trim()===''}
          className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50">
          {text('Start cash session','ক্যাশ সেশন শুরু')}
        </button>
      </>}
    </div>}
  </section>;
}


function LiveFinancePersonLedger({people,symbol,canAdd,canBankView,activeCashSession,onChanged,text}:{
  people:FinanceBootstrap['personsAll'];symbol:string;canAdd:boolean;canBankView:boolean;
  activeCashSession:boolean;onChanged:()=>void;text:(en:string,bn:string)=>string;
}){
  const [kind,setKind]=useState<'Owner'|'Lender'>('Owner');
  const [personId,setPersonId]=useState('');
  const [dateFrom,setDateFrom]=useState(''),[dateTo,setDateTo]=useState('');
  const [page,setPage]=useState(1),[pageSize,setPageSize]=useState<50|100>(50);
  const [ledger,setLedger]=useState<FinancePersonLedgerResponse|null>(null);
  const [loading,setLoading]=useState(false),[error,setError]=useState('');
  const [reload,setReload]=useState(0),[accounts,setAccounts]=useState<LiveBankAccount[]>([]);
  const [action,setAction]=useState(''),[method,setMethod]=useState<'Cash'|'Bank'|'Mobile Banking'>('Cash');
  const [bankId,setBankId]=useState(''),[amount,setAmount]=useState(''),[notes,setNotes]=useState('');
  const [transactionDate,setTransactionDate]=useState(''),[backdatedReason,setBackdatedReason]=useState('');
  const [review,setReview]=useState(false),[pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false);
  const [notice,setNotice]=useState('');
  const requestId=useRef(crypto.randomUUID());
  const matching=people.filter(p=>p.type===kind);
  const selected=people.find(p=>p.id===personId);
  useEffect(()=>{
    if(!matching.some(p=>p.id===personId))setPersonId(matching[0]?.id||'');
  },[kind,personId,people]);
  useEffect(()=>{
    if(!canBankView)return;
    let live=true;
    getBankAccounts().then(a=>{if(live)setAccounts(a.bankAccounts);}).catch(()=>{if(live)setAccounts([]);});
    return ()=>{live=false;};
  },[canBankView,reload]);
  useEffect(()=>{
    if(!personId){setLedger(null);return;}
    let live=true;setLoading(true);setError('');setLedger(null);
    getFinancePersonLedger(personId,{dateFrom,dateTo,page,pageSize})
      .then(r=>{if(live)setLedger(r);})
      .catch(e=>{if(live)setError(e instanceof Error?e.message:'Unable to load person ledger.');})
      .finally(()=>{if(live)setLoading(false);});
    return ()=>{live=false;};
  },[personId,dateFrom,dateTo,page,pageSize,reload]);
  const types=kind==='Owner'?[
    {value:'Owner Investment',en:'Owner investment',bn:'মালিকের মূলধন'},
    {value:'Owner Withdrawal',en:'Owner withdrawal',bn:'মালিকের উত্তোলন'}
  ]:[
    {value:'Loan Received',en:'Loan received',bn:'ঋণ গ্রহণ'},
    {value:'Loan Repayment',en:'Loan repayment',bn:'ঋণ পরিশোধ'}
  ];
  const canPost=canAdd&&activeCashSession&&selected?.status==='Active'&&
    Number.isFinite(Number(amount))&&Number(amount)>0&&
    Math.abs(Number(amount)*10000-Math.round(Number(amount)*10000))<0.00001&&
    Boolean(action)&&
    (method==='Cash'||accounts.some(a=>a.id===bankId&&a.accountType===method&&a.status==='Active'))&&
    (!transactionDate||transactionDate>=new Date().toISOString().slice(0,10)||backdatedReason.trim().length>0);
  const refresh=(alsoReloadParent=true)=>{setReload(v=>v+1);if(alsoReloadParent)onChanged();};
  async function submitFinance(){
    if(!canPost||pending)return;
    setPending(true);setError('');setNotice('');
    try{
      const result=await postFinanceTransaction({
        personId,transactionType:action,amount:Number(amount),paymentMethod:method,
        bankAccountId:method==='Cash'?'':bankId,
        date:transactionDate||undefined,backdatedReason,notes,
        clientRequestId:requestId.current
      });
      setNotice(text('Finance entry posted: ','অর্থ লেনদেন জমা হয়েছে: ')+result.id);
      setAmount('');setNotes('');setBackdatedReason('');setAction('');setReview(false);setUncertain(false);
      requestId.current=crypto.randomUUID();
      refresh(false);
    }catch(e){
      const ambiguous=e instanceof BackendRequestError&&(e.status===null||e.status>=500);
      setUncertain(ambiguous);
      setError(ambiguous?
        text('Posting status unknown. Retry the same request; it cannot be posted twice.',
          'পোস্ট হয়েছে কি না অজানা। একই অনুরোধ আবার দিন, দ্বিগুণ হবে না।'):
        e instanceof Error?e.message:'Could not post finance transaction.');
    }finally{setPending(false);}
  }
  function setPerson(next:string){
    setPersonId(next);setPage(1);setAction('');setReview(false);setUncertain(false);
    requestId.current=crypto.randomUUID();
  }
  return <section className="space-y-3 rounded-xl border border-border bg-card p-3" aria-label={text('Finance person ledger','ব্যক্তির অর্থ খতিয়ান')}
    data-finance-person-ledger="">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-ink"><Users className="mr-2 inline-block size-4 text-primary" aria-hidden="true"/>
        {text('Owner & lender ledger','মালিক ও ঋণদাতার খতিয়ান')}</h2>
      <button type="button" onClick={()=>refresh()} className="h-9 rounded-lg border border-border px-3 text-xs">
        {text('Refresh','হালনাগাদ')}</button>
    </div>
    <div role="tablist" aria-label={text('Finance person type','ব্যক্তির ধরন')} className="flex gap-5 border-b border-border">
      {(['Owner','Lender'] as const).map(k=><button type="button" role="tab" key={k}
        aria-selected={kind===k} onClick={()=>{setKind(k);setPage(1);}}
        className={"h-9 border-b-2 px-1 text-sm "+(kind===k?'border-primary font-semibold text-primary':'border-transparent text-ink-500')}>
        {k==='Owner'?text('Owners','মালিক'):text('Lenders','ঋণদাতা')}
      </button>)}
    </div>
    <label className="block max-w-md text-xs text-ink-600">{text('Select person','ব্যক্তি বাছুন')}
      <select aria-label="Finance person" value={personId} onChange={e=>setPerson(e.target.value)}
        className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-3 text-sm">
        {matching.length===0&&<option value="">{text('No people found','কোনো ব্যক্তি নেই')}</option>}
        {matching.map(p=><option key={p.id} value={p.id}>{p.name}{p.status==='Inactive'?' (Inactive)':''}</option>)}
      </select>
    </label>
    {personId&&<>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-xs text-ink-600">{text('From','শুরু')}
          <input aria-label="Finance ledger from date" type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setPage(1);}}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"/></label>
        <label className="text-xs text-ink-600">{text('To','শেষ')}
          <input aria-label="Finance ledger to date" type="date" value={dateTo} onChange={e=>{setDateTo(e.target.value);setPage(1);}}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"/></label>
        <label className="text-xs text-ink-600">{text('Rows','সারি')}
          <select aria-label="Finance ledger page size" value={pageSize} onChange={e=>{setPageSize(Number(e.target.value) as 50|100);setPage(1);}}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm">
            <option value={50}>50</option><option value={100}>100</option>
          </select></label>
      </div>
      {loading&&<p role="status" className="text-xs text-ink-500">{text('Loading financing records…','অর্থ লেনদেন লোড হচ্ছে…')}</p>}
      {error&&<p role="alert" className="rounded-lg border border-danger bg-danger-bg p-2 text-xs text-danger">{error}</p>}
      {notice&&<p role="status" className="text-xs text-success">{notice}</p>}
      {ledger&&<>
        {ledger.coverage.status==='needs-review'&&<p role="alert" className="rounded-lg border border-border p-3 text-sm text-warning">
          {text('Source records need reconciliation. Balances are withheld until matched.',
            'মূল খতিয়ান মেলেনি। যাচাই না হওয়া পর্যন্ত জের দেখানো হচ্ছে না।')}
        </p>}
        <p role="status" className="text-sm font-medium text-ink">
          {text(kind==='Owner'?'Owner capital':'Outstanding loan',kind==='Owner'?'মালিকের মূলধন':'বাকি ঋণ')}
          {': '}{ledger.balance===null?'—':taka(ledger.balance,symbol)}
        </p>
        <div role="region" tabIndex={0} aria-label={text('Finance person ledger table','ব্যক্তির অর্থ খতিয়ানের তালিকা')}
          className="overflow-x-auto rounded-lg border border-border focus-visible:ring-2 focus-visible:ring-primary">
          <table className="w-full min-w-[660px] text-left text-sm">
            <thead className="bg-ink-50 text-xs text-ink-500"><tr>
              <th className="p-2">{text('Date','তারিখ')}</th>
              <th className="p-2">{text('Transaction','লেনদেন')}</th>
              <th className="p-2 text-right">{text('Out','দেওয়া')}</th>
              <th className="p-2 text-right">{text('In','পাওয়া')}</th>
              <th className="p-2 text-right">{text('Balance','জের')}</th>
            </tr></thead>
            <tbody>{ledger.rows.map(row=><tr key={row.financeId} className="border-t border-border">
              <td className="p-2 text-xs text-ink-600">{row.date}</td>
              <td className="p-2">
                <span className="text-ink">{row.transactionType}</span>
                <span className="block text-xs text-ink-500">{row.financeId} · {row.paymentMethod}</span>
                {row.isBackdated&&<span className="block text-xs text-warning">{text('Backdated','পুরনো তারিখ')}: {row.backdatedReason}</span>}
                {row.sourceStatus==='needs-review'&&<span className="block text-xs text-warning">{text('Needs review','যাচাই দরকার')}</span>}
              </td>
              <td className="p-2 text-right tabular-nums text-danger">{row.debit?taka(row.debit,symbol):'—'}</td>
              <td className="p-2 text-right tabular-nums text-success">{row.credit?taka(row.credit,symbol):'—'}</td>
              <td className="p-2 text-right tabular-nums text-ink">{row.balance===null?'—':taka(row.balance,symbol)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {ledger.rows.length===0&&<p className="text-xs text-ink-500">{text('No transactions for this date range.','এই সময়ে কোনো লেনদেন নেই।')}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-600">
          <span>{ledger.totalRows} {text('transactions','লেনদেন')} · {text('Page','পৃষ্ঠা')} {page}/{Math.max(ledger.totalPages,1)}</span>
          <div className="flex gap-2">
            <button type="button" disabled={page===1} onClick={()=>setPage(p=>Math.max(1,p-1))}
              className="h-9 rounded-lg border border-border px-3 disabled:opacity-40">{text('Previous','আগের')}</button>
            <button type="button" disabled={page>=ledger.totalPages} onClick={()=>setPage(p=>p+1)}
              className="h-9 rounded-lg border border-border px-3 disabled:opacity-40">{text('Next','পরের')}</button>
          </div>
        </div>
      </>}
      {canAdd&&selected?.status==='Active'&&<form onSubmit={e=>{e.preventDefault();if(!uncertain){if(!review){setReview(true);return;}}void submitFinance();}}
        className="space-y-2 border-t border-border pt-3">
        <h3 className="text-sm font-semibold text-ink">{text('New finance entry','নতুন অর্থ লেনদেন')}</h3>
        {!activeCashSession&&<p role="status" className="text-xs text-warning">
          {text('Start the cash session before posting.','লেনদেনের আগে নগদ সেশন শুরু করুন।')}</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-ink-600">{text('Transaction type','লেনদেনের ধরন')}
            <select value={action} aria-label="Finance transaction type" disabled={pending||uncertain}
              onChange={e=>{setAction(e.target.value);setReview(false);}}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm">
              <option value="">{text('Choose action','ধরন বাছুন')}</option>
              {types.map(t=><option key={t.value} value={t.value}>{text(t.en,t.bn)}</option>)}
            </select>
          </label>
          <label className="text-xs text-ink-600">{text('Amount','টাকার পরিমাণ')}
            <input type="number" min="0.0001" step="0.0001" aria-label="Finance transaction amount" value={amount}
              disabled={pending||uncertain} onChange={e=>{setAmount(e.target.value);setReview(false);}}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"/></label>
          <label className="text-xs text-ink-600">{text('Payment method','পেমেন্ট মাধ্যম')}
            <select value={method} aria-label="Finance payment method" disabled={pending||uncertain}
              onChange={e=>{setMethod(e.target.value as 'Cash'|'Bank'|'Mobile Banking');setBankId('');setReview(false);}}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm">
              <option value="Cash">{text('Cash','নগদ')}</option>
              {canBankView&&<option value="Bank">{text('Bank','ব্যাংক')}</option>}
              {canBankView&&<option value="Mobile Banking">{text('Mobile banking','মোবাইল ব্যাংকিং')}</option>}
            </select>
          </label>
          {method!=='Cash'&&<label className="text-xs text-ink-600">{text('Bank/mobile account','ব্যাংক/মোবাইল হিসাব')}
            <select value={bankId} aria-label="Finance bank account" disabled={pending||uncertain}
              onChange={e=>{setBankId(e.target.value);setReview(false);}}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm">
              <option value="">{text('Select account','হিসাব বাছুন')}</option>
              {accounts.filter(a=>a.accountType===method&&a.status==='Active').map(a=><option value={a.id} key={a.id}>{a.name}</option>)}
            </select></label>}
          <label className="text-xs text-ink-600">{text('Date (optional)','তারিখ (ঐচ্ছিক)')}
            <input type="date" aria-label="Finance transaction date" value={transactionDate}
              disabled={pending||uncertain} onChange={e=>{setTransactionDate(e.target.value);setReview(false);}}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"/></label>
          <label className="text-xs text-ink-600">{text('Note','বিবরণ')}
            <input aria-label="Finance transaction note" value={notes} disabled={pending||uncertain}
              onChange={e=>{setNotes(e.target.value);setReview(false);}}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"/></label>
          {transactionDate&&transactionDate<new Date().toISOString().slice(0,10)&&
            <label className="text-xs text-ink-600">{text('Reason for backdating','পুরনো তারিখের কারণ')}
              <input aria-label="Finance backdated reason" value={backdatedReason}
                onChange={e=>{setBackdatedReason(e.target.value);setReview(false);}}
                disabled={pending||uncertain} className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"/></label>}
        </div>
        {review&&<p role="status" className="rounded-lg border border-border bg-ink-50 p-3 text-sm text-ink">
          {text('Confirm finance entry','অর্থ লেনদেন নিশ্চিত করুন')}: {selected?.name} · {action} · {amount} · {method}
        </p>}
        <button type="submit" disabled={pending||!canPost}
          className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50">
          {uncertain?text('Retry same request','একই অনুরোধ আবার দিন'):
            review?text('Confirm entry','নিশ্চিত করুন'):text('Review entry','যাচাই করুন')}
        </button>
      </form>}
    </>}
  </section>;
}

export function LiveFinancePage() {
  const user = useBackendSession();
  const { text } = useUiCopy();
  const canFinance = canUseModule(user,'finance','view');
  const canFinanceAdd=canUseModule(user,'finance','add');
  const canBank = canUseModule(user,'bank','view');
  const canBankAdd=canUseModule(user,'bank','add');
  const canBankEdit=canUseModule(user,'bank','edit');
  const canCash=canUseModule(user,'pos','view');
  const canCashAdd=canUseModule(user,'pos','add');
  const canCashEdit=canUseModule(user,'pos','edit');
  const [bank,setBank] = useState<BankReconciliation|null>(null);
  const [finance,setFinance] = useState<FinanceBootstrap|null>(null);
  const [errors,setErrors] = useState<string[]>([]);
  const [loading,setLoading] = useState(false);
  const [reload,setReload] = useState(0);

  useEffect(()=>{
    if(!canFinance&&!canBank&&!canCash)return;
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

    {canCash&&<LiveCashSessionPanel canAdd={canCashAdd} canEdit={canCashEdit} text={text} onChanged={()=>setReload(v=>v+1)}/>}

    {canBank&&<LiveBankTransferTools add={canBankAdd} edit={canBankEdit} text={text} onChanged={()=>setReload(v=>v+1)}/>}

    {canFinance&&finance&&<LiveFinancePersonLedger people={finance.personsAll} symbol={symbol}
      canAdd={canFinanceAdd} canBankView={canBank} activeCashSession={finance.activeCashSession}
      text={text} onChanged={()=>setReload(v=>v+1)}/>}

  </main>;
}
