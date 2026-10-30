import {useEffect,useState,type FormEvent} from 'react';
import {RefreshCw,Printer} from 'lucide-react';
import {businessToday} from '../utils/dateRange';
import {useUiCopy} from '../i18n/useUiCopy';
import {canUseModule,useBackendSession} from './BackendGate';
import {getLiveDaybook,type LiveDaybookQuery,type LiveDaybookResponse,type LiveDaybookRow} from './banijjApi';

const money=(n:number)=>'৳'+n.toLocaleString('en-BD',{minimumFractionDigits:2,maximumFractionDigits:4});
const key=(r:LiveDaybookRow)=>r.sourceModule+':'+r.sourceId+':'+r.referenceNo+':'+r.date;

export function LiveDaybookPage(){
  const user=useBackendSession();
  const {text}=useUiCopy();
  const allowed=canUseModule(user,'daybook','view');
  const today=businessToday();
  const [dateFrom,setDateFrom]=useState(today),[dateTo,setDateTo]=useState(today);
  const [module,setModule]=useState(''),[query,setQuery]=useState('');
  const [applied,setApplied]=useState({dateFrom:today,dateTo:today,module:'',query:''});
  const [sortBy,setSortBy]=useState<'transaction'|'created'>('transaction');
  const [pageSize,setPageSize]=useState<50|100>(50),[page,setPage]=useState(1);
  const [reload,setReload]=useState(0);
  const [data,setData]=useState<LiveDaybookResponse|null>(null);
  const [loading,setLoading]=useState(false),[error,setError]=useState('');
  const [selected,setSelected]=useState<string[]>([]);

  useEffect(()=>{
    if(!allowed)return;
    let active=true;
    setLoading(true);setError('');setData(null);
    const args:LiveDaybookQuery={...applied,sortBy,page,pageSize};
    getLiveDaybook(args).then(value=>{
      if(active){setData(value);setSelected([]);}
    }).catch(e=>{if(active)setError(e instanceof Error?e.message:'Unable to load Daybook.');})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[allowed,applied,sortBy,page,pageSize,reload]);

  function apply(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(dateFrom>dateTo){setError(text('Start date must be before end date.','শুরুর তারিখ শেষ তারিখের আগে দিন।'));return;}
    setPage(1);setApplied({dateFrom,dateTo,module,query:query.trim()});
  }
  const rows=data?.rows||[];
  const printable=selected.length?rows.filter(r=>selected.includes(key(r))):rows;
  const toggle=(id:string)=>setSelected(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]);
  const numberOfPages=data?.pagination.totalPages||0;
  const totalRows=data?.pagination.totalRows||0;

  if(!allowed)return <main className="p-5" data-live-daybook="">
    <h1 className="text-xl font-semibold text-ink">{text('Daybook','দৈনিক খাতা')}</h1>
    <p role="alert" className="mt-2 text-sm text-danger">
      {text('You do not have permission to view Daybook.','দৈনিক খাতা দেখার অনুমতি নেই।')}</p>
  </main>;

  return <main className="mx-auto w-full max-w-[1440px] space-y-4 p-3 sm:p-4 print:p-0" data-live-daybook="">
    <header className="flex flex-wrap items-start justify-between gap-3 print:hidden">
      <div>
        <h1 className="text-xl font-semibold text-ink">{text('Daybook','দৈনিক খাতা')}</h1>
        <p className="mt-1 text-xs text-ink-500">{text(
          'Read-only transactions from their original records. Edit or reverse in the original module.',
          'মূল লেনদেনের তালিকা। পরিবর্তন বা বাতিল মূল মডিউলে করুন।'
        )}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={loading} onClick={()=>setReload(v=>v+1)}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-ink disabled:opacity-50">
          <RefreshCw size={15}/>{text('Refresh','হালনাগাদ')}</button>
        <button type="button" disabled={!printable.length} onClick={()=>window.print()}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-white disabled:opacity-50">
          <Printer size={15}/>{selected.length?text('Print selected','নির্বাচিত প্রিন্ট'):text('Print page','পৃষ্ঠা প্রিন্ট')}</button>
      </div>
    </header>

    <form onSubmit={apply} className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-3 print:hidden">
      <label className="flex min-w-32 flex-col gap-1 text-xs font-medium text-ink-600">
        {text('From','শুরু')}
        <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} required
          className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-ink"/>
      </label>
      <label className="flex min-w-32 flex-col gap-1 text-xs font-medium text-ink-600">
        {text('To','শেষ')}
        <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} required
          className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-ink"/>
      </label>
      <label className="flex min-w-36 flex-col gap-1 text-xs font-medium text-ink-600">
        {text('Module','মডিউল')}
        <select value={module} onChange={e=>setModule(e.target.value)}
          className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-ink">
          <option value="">{text('All modules','সব মডিউল')}</option>
          {['Sales','Sales Return','Purchase','Purchase Return','Customer Payment','Supplier Payment','Expense','Bank','Finance'].map(x=>
            <option key={x} value={x}>{x}</option>)}
        </select>
      </label>
      <label className="flex min-w-36 flex-1 flex-col gap-1 text-xs font-medium text-ink-600">
        {text('Search','খুঁজুন')}
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder={text('Reference or person','রেফারেন্স বা ব্যক্তি')}
          className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-ink"/>
      </label>
      <button type="submit" disabled={loading}
        className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50">
        {text('Apply','দেখুন')}</button>
    </form>

    <section className="overflow-hidden rounded-xl border border-border bg-card print:hidden" aria-label={text('Daybook entries','দৈনিক লেনদেন')}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="text-xs text-ink-600">{loading?text('Loading…','লোড হচ্ছে…'):
          text('Entries','লেনদেন')+': '+totalRows.toLocaleString('en-BD')}
          {selected.length>0&&<span className="ml-2 font-semibold text-primary">{selected.length} {text('selected','নির্বাচিত')}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-ink-600">{text('Order','সাজান')}{' '}
            <select value={sortBy} onChange={e=>{setSortBy(e.target.value as typeof sortBy);setPage(1);}}
              className="h-9 rounded-lg border border-border bg-card px-2 text-sm">
              <option value="transaction">{text('Transaction date','লেনদেনের তারিখ')}</option>
              <option value="created">{text('Entry time','এন্ট্রির সময়')}</option>
            </select>
          </label>
          <label className="text-xs text-ink-600">{text('Rows','সারি')}{' '}
            <select value={pageSize} onChange={e=>{setPageSize(Number(e.target.value) as 50|100);setPage(1);}}
              className="h-9 rounded-lg border border-border bg-card px-2 text-sm">
              <option value="50">50</option><option value="100">100</option>
            </select>
          </label>
        </div>
      </div>
      {error&&<p role="alert" className="m-3 rounded-lg bg-danger-bg p-3 text-sm text-danger">{error}</p>}
      <div className="overflow-x-auto" role="region" tabIndex={0} aria-label={text('Transaction table','লেনদেন তালিকা')}>
        <table className="w-full min-w-[850px] text-left text-sm">
          <thead className="bg-ink-50 text-xs text-ink-600"><tr>
            <th className="p-3"><span className="sr-only">{text('Select','নির্বাচন')}</span></th>
            <th className="p-3">{text('Date','তারিখ')}</th><th className="p-3">{text('Reference','রেফারেন্স')}</th>
            <th className="p-3">{text('Module','মডিউল')}</th><th className="p-3">{text('Person / Description','ব্যক্তি / বিবরণ')}</th>
            <th className="p-3 text-right">{text('Money in','জমা')}</th>
            <th className="p-3 text-right">{text('Money out','খরচ')}</th>
            <th className="p-3">{text('By','কে করেছেন')}</th>
          </tr></thead>
          <tbody>{rows.map(r=><tr key={key(r)} className="border-t border-border hover:bg-ink-50">
            <td className="p-3"><input aria-label={text('Select','নির্বাচন')+' '+r.referenceNo} type="checkbox"
              checked={selected.includes(key(r))} onChange={()=>toggle(key(r))}/></td>
            <td className="whitespace-nowrap p-3 text-xs">{r.date}{r.isBackdated?' *':''}
              <div className="text-ink-500">{r.time}</div></td>
            <td className="p-3 font-medium text-primary" title={r.sourceModule+': '+r.sourceId}>{r.referenceNo}</td>
            <td className="p-3 text-xs">{r.module}<div className="text-ink-500">{r.status}</div></td>
            <td className="p-3"><div className="font-medium">{r.party||'—'}</div>
              <div className="max-w-64 truncate text-xs text-ink-500" title={r.description}>{r.description||r.transactionType}</div>
              <div className="text-xs text-ink-500">{r.paymentMethod}</div></td>
            <td className="p-3 text-right">{r.cashIn+r.bankIn>0?money(r.cashIn+r.bankIn):'—'}</td>
            <td className="p-3 text-right">{r.cashOut+r.bankOut>0?money(r.cashOut+r.bankOut):'—'}</td>
            <td className="p-3 text-xs text-ink-600">{r.createdBy||'—'}</td>
          </tr>)}</tbody>
        </table>
        {!loading&&!error&&rows.length===0&&<p className="p-4 text-sm text-ink-500">
          {text('No posted transactions in this range.','এই সময়ে কোনো লেনদেন নেই।')}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2">
        <p className="text-xs text-ink-600">
          {text('Total in','মোট জমা')}: {data?money(data.totals.cashIn+data.totals.bankIn):'—'} ·{' '}
          {text('Total out','মোট খরচ')}: {data?money(data.totals.cashOut+data.totals.bankOut):'—'}
        </p>
        <div className="flex items-center gap-2">
          <button type="button" disabled={page<=1||loading} onClick={()=>setPage(p=>p-1)}
            className="h-9 rounded-lg border border-border px-3 text-sm disabled:opacity-50">{text('Previous','আগে')}</button>
          <span className="text-xs text-ink-600">{page} / {Math.max(1,numberOfPages)}</span>
          <button type="button" disabled={page>=numberOfPages||loading} onClick={()=>setPage(p=>p+1)}
            className="h-9 rounded-lg border border-border px-3 text-sm disabled:opacity-50">{text('Next','পরে')}</button>
        </div>
      </div>
    </section>

    <section className="hidden print:block" aria-label={text('Printable Daybook','প্রিন্ট দৈনিক খাতা')}>
      <h1 className="text-lg font-bold">{text('Daybook','দৈনিক খাতা')} · {applied.dateFrom} — {applied.dateTo}</h1>
      <p className="mb-3 text-xs">{selected.length?text('Selected entries','নির্বাচিত লেনদেন'):text('Current page','বর্তমান পৃষ্ঠা')}</p>
      <table className="w-full text-left text-xs"><thead><tr className="border-b">
        <th className="p-1">{text('Date','তারিখ')}</th><th className="p-1">{text('Source','উৎস')}</th>
        <th className="p-1">{text('Person','ব্যক্তি')}</th><th className="p-1">{text('In','জমা')}</th><th className="p-1">{text('Out','খরচ')}</th>
      </tr></thead><tbody>{printable.map(r=><tr key={key(r)} className="border-b">
        <td className="p-1">{r.date}</td><td className="p-1">{r.referenceNo}</td>
        <td className="p-1">{r.party}</td><td className="p-1">{money(r.cashIn+r.bankIn)}</td>
        <td className="p-1">{money(r.cashOut+r.bankOut)}</td>
      </tr>)}</tbody></table>
    </section>
  </main>;
}
