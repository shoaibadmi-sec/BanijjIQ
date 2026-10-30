import { useEffect, useState } from 'react';
import { RefreshCw, Landmark, Users } from 'lucide-react';
import { useUiCopy } from '../i18n/useUiCopy';
import { canUseModule, useBackendSession } from './BackendGate';
import {
  getBankReconciliation, getFinanceBootstrap,
  type BankReconciliation, type FinanceBootstrap
} from './banijjApi';

const taka = (value:number, symbol:string) =>
  symbol + value.toLocaleString('en-BD',{minimumFractionDigits:2,maximumFractionDigits:4});

export function LiveFinancePage() {
  const user = useBackendSession();
  const { text } = useUiCopy();
  const canFinance = canUseModule(user,'finance','view');
  const canBank = canUseModule(user,'bank','view');
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
