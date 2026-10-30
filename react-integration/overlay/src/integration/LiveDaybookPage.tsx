import {useEffect,useState} from 'react';
import {BookOpen,RefreshCw} from 'lucide-react';
import {useUiCopy} from '../i18n/useUiCopy';
import {canUseModule,useBackendSession} from './BackendGate';
import {getLiveDaybookBootstrap,getLiveDaybookRows,type LiveDaybookEntry,type LiveDaybookResponse} from './banijjApi';

const dateInBangladesh=()=>new Intl.DateTimeFormat('sv-SE',{
  timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'
}).format(new Date());
const currency=(amount:number,symbol:string)=>
  symbol+amount.toLocaleString('en-BD',{minimumFractionDigits:2,maximumFractionDigits:4});
const viewSource=(row:LiveDaybookEntry):{page:string;module:string}|null=>{
  const key=row.sourceModule;
  if(key==='Sales'||key==='Sales Return')return {page:'sales',module:'sales'};
  if(key==='Purchase'||key==='Purchase Return'||key==='Supplier Payment'||key==='Supplier Warranty')
    return {page:'purchases',module:'purchase'};
  if(key==='Customer Payment')return {page:'parties',module:'customers'};
  if(key==='Expense')return {page:'expenses',module:'expense'};
  if(key==='Finance'||key==='Bank'||key==='Bank Transfer')return {page:'finance',module:'finance'};
  if(key==='Stock Adjustment')return {page:'products',module:'products'};
  return null;
};

export function LiveDaybookPage(){
  const user=useBackendSession(),{text}=useUiCopy();
  const permitted=canUseModule(user,'daybook','view');
  const [dateFrom,setDateFrom]=useState(dateInBangladesh());
  const [dateTo,setDateTo]=useState(dateInBangladesh());
  const [module,setModule]=useState(''),[paymentMethod,setPaymentMethod]=useState('');
  const [query,setQuery]=useState('');
  const [sortBy,setSortBy]=useState<'createdAt'|'transactionDate'>('transactionDate');
  const [page,setPage]=useState(1),[pageSize,setPageSize]=useState<50|100>(50);
  const [reload,setReload]=useState(0),[loading,setLoading]=useState(false);
  const [error,setError]=useState(''),[data,setData]=useState<LiveDaybookResponse|null>(null);
  const [symbol,setSymbol]=useState('৳'),[modules,setModules]=useState<string[]>([]);
  useEffect(()=>{
    if(!permitted)return;
    let live=true;
    getLiveDaybookBootstrap().then(b=>{
      if(!live)return;setSymbol(b.currencySymbol);setModules(b.modules);
    }).catch(e=>{if(live)setError(e instanceof Error?e.message:'Cannot load Daybook filters.');});
    return ()=>{live=false;};
  },[permitted]);
  useEffect(()=>{
    if(!permitted)return;
    let live=true;setLoading(true);setError('');
    if(dateFrom>dateTo){setError(text('End date must follow start date.','শেষ তারিখ শুরু তারিখের পরে হবে।'));setLoading(false);return;}
    getLiveDaybookRows({dateFrom,dateTo,module,paymentMethod,query,sortBy,page,pageSize})
      .then(r=>{if(live)setData(r);})
      .catch(e=>{if(live){setData(null);setError(e instanceof Error?e.message:'Cannot load Daybook.');}})
      .finally(()=>{if(live)setLoading(false);});
    return ()=>{live=false;};
  },[permitted,dateFrom,dateTo,module,paymentMethod,query,sortBy,page,pageSize,reload]);
  if(!permitted)return <main className="p-4" data-live-daybook="">
    <h1 className="text-xl font-semibold text-ink">{text('Daybook','দৈনিক খাতা')}</h1>
    <p role="alert" className="mt-3 text-sm text-danger">
      {text('You do not have permission to view Daybook.','দৈনিক খাতা দেখার অনুমতি নেই।')}
    </p>
  </main>;
  const changePage=()=>setPage(1);
  const totals=data?.totals;
  return <main className="mx-auto w-full max-w-[1440px] space-y-3 p-3 sm:p-4" data-live-daybook="">
    <header className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
          <BookOpen size={21} aria-hidden="true"/>{text('Daybook','দৈনিক খাতা')}</h1>
        <p className="mt-1 text-xs text-ink-500">
          {text('Real posted source records. Open a module to review or correct the original transaction.',
            'মূল খতিয়ানের লেনদেন। পরিবর্তনের জন্য সংশ্লিষ্ট হিসাব খুলুন।')}
        </p>
      </div>
      <button type="button" onClick={()=>setReload(v=>v+1)} disabled={loading}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-ink disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary">
        <RefreshCw size={15} aria-hidden="true"/>{text('Refresh','হালনাগাদ')}
      </button>
    </header>
    <section aria-label={text('Daybook filters','দৈনিক খাতার ফিল্টার')}
      className="rounded-xl border border-border bg-card p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <label className="text-xs text-ink-600">{text('From','শুরু')}
          <input type="date" aria-label="Daybook from date" value={dateFrom}
            onChange={e=>{setDateFrom(e.target.value);changePage();}}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"/>
        </label>
        <label className="text-xs text-ink-600">{text('To','শেষ')}
          <input type="date" aria-label="Daybook to date" value={dateTo}
            onChange={e=>{setDateTo(e.target.value);changePage();}}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"/>
        </label>
        <label className="text-xs text-ink-600">{text('Module','মডিউল')}
          <select aria-label="Daybook module" value={module}
            onChange={e=>{setModule(e.target.value);changePage();}}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm">
            <option value="">{text('All modules','সব মডিউল')}</option>
            {modules.map(m=><option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-600">{text('Payment','পেমেন্ট')}
          <select aria-label="Daybook payment method" value={paymentMethod}
            onChange={e=>{setPaymentMethod(e.target.value);changePage();}}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm">
            <option value="">{text('All methods','সব পদ্ধতি')}</option>
            <option value="Cash">{text('Cash','নগদ')}</option>
            <option value="Bank">{text('Bank','ব্যাংক')}</option>
            <option value="Mobile Banking">{text('Mobile Banking','মোবাইল ব্যাংকিং')}</option>
          </select>
        </label>
        <label className="text-xs text-ink-600">{text('Order by','সাজানোর নিয়ম')}
          <select aria-label="Daybook sort order" value={sortBy}
            onChange={e=>{setSortBy(e.target.value as 'createdAt'|'transactionDate');changePage();}}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm">
            <option value="transactionDate">{text('Transaction date','লেনদেনের তারিখ')}</option>
            <option value="createdAt">{text('Posted at','এন্ট্রির সময়')}</option>
          </select>
        </label>
        <label className="text-xs text-ink-600">{text('Rows','সারি')}
          <select aria-label="Daybook page size" value={pageSize}
            onChange={e=>{setPageSize(Number(e.target.value) as 50|100);changePage();}}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm">
            <option value={50}>50</option><option value={100}>100</option>
          </select>
        </label>
      </div>
      <label className="mt-3 block text-xs text-ink-600">{text('Search reference or person','রেফারেন্স বা ব্যক্তির নাম খুঁজুন')}
        <input aria-label="Daybook search" value={query}
          onChange={e=>{setQuery(e.target.value);changePage();}}
          placeholder={text('Invoice, person or reference','চালান, ব্যক্তি অথবা রেফারেন্স')}
          className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-3 text-sm"/>
      </label>
    </section>
    {loading&&<p role="status" className="text-xs text-ink-500">{text('Loading real transactions…','মূল লেনদেন লোড হচ্ছে…')}</p>}
    {error&&<p role="alert" className="rounded-lg border border-danger bg-danger-bg p-3 text-sm text-danger">{error}</p>}
    {totals&&<section aria-label={text('Daybook totals','দৈনিক খাতার মোট')}
      className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {[
        [text('Cash in','নগদ জমা'),totals.cashIn,'text-success'],
        [text('Cash out','নগদ খরচ'),totals.cashOut,'text-danger'],
        [text('Bank in','ব্যাংক জমা'),totals.bankIn,'text-success'],
        [text('Bank out','ব্যাংক খরচ'),totals.bankOut,'text-danger']
      ].map(([label,value,cls])=><div key={String(label)} className="rounded-lg border border-border bg-card p-3">
        <p className="text-xs text-ink-500">{label}</p>
        <p className={'mt-1 text-sm font-semibold '+cls}>{currency(Number(value),symbol)}</p>
      </div>)}
    </section>}
    <section className="overflow-hidden rounded-xl border border-border bg-card"
      aria-label={text('Daybook transactions','দৈনিক লেনদেন')}>
      <div role="region" tabIndex={0} aria-label={text('Daybook transactions table','দৈনিক লেনদেনের তালিকা')}
        className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-primary">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-ink-50 text-xs text-ink-500"><tr>
            <th className="p-2 font-medium">{text('Date','তারিখ')}</th>
            <th className="p-2 font-medium">{text('Source','মূল রেকর্ড')}</th>
            <th className="p-2 font-medium">{text('Person','ব্যক্তি')}</th>
            <th className="p-2 text-right font-medium">{text('Money in','জমা')}</th>
            <th className="p-2 text-right font-medium">{text('Money out','খরচ')}</th>
            <th className="p-2 font-medium">{text('Status','অবস্থা')}</th>
            <th className="p-2 font-medium">{text('Action','কাজ')}</th>
          </tr></thead>
          <tbody>{(data?.rows||[]).map((r,i)=>{
            const destination=viewSource(r);
            const allowed=destination&&canUseModule(user,destination.module,'view');
            const moneyIn=r.cashIn+r.bankIn,moneyOut=r.cashOut+r.bankOut;
            return <tr key={r.sourceModule+':'+r.sourceId+':'+i} className="border-t border-border">
              <td className="p-2 text-xs text-ink-600">{r.date}
                <span className="block">{r.time}</span>
                {r.isBackdated&&<span className="text-warning">{text('Backdated','পুরনো তারিখ')}</span>}
              </td>
              <td className="p-2">
                <span className="font-medium text-ink">{r.module}</span>
                <span className="block text-xs text-ink-600">{r.sourceId}</span>
                <span className="block max-w-[240px] truncate text-xs text-ink-500" title={r.description}>{r.description}</span>
              </td>
              <td className="p-2 text-xs text-ink-600">{r.party||'—'}</td>
              <td className="p-2 text-right tabular-nums text-success">{moneyIn?currency(moneyIn,symbol):'—'}</td>
              <td className="p-2 text-right tabular-nums text-danger">{moneyOut?currency(moneyOut,symbol):'—'}</td>
              <td className="p-2 text-xs text-ink-600">{r.status}
                {r.createdBy&&<span className="block text-ink-500">{r.createdBy}</span>}
              </td>
              <td className="p-2">{allowed&&destination?
                <a href={'#/app/'+destination.page+'?sourceId='+encodeURIComponent(r.openId||r.sourceId)}
                  className="inline-flex min-h-9 items-center rounded-lg border border-border px-3 text-xs font-medium text-primary focus-visible:ring-2 focus-visible:ring-primary">
                  {text('Open module','মডিউল খুলুন')}</a>:
                <span className="text-xs text-ink-500">—</span>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {!loading&&data?.rows.length===0&&<p className="p-4 text-sm text-ink-500">
        {text('No posted records in this range.','এই সময়ে কোনো লেনদেন নেই।')}
      </p>}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3 text-xs text-ink-600">
        <span>{data?.totalRows||0} {text('transactions','লেনদেন')} · {text('Page','পৃষ্ঠা')} {page}/{Math.max(data?.totalPages||1,1)}</span>
        <div className="flex gap-2">
          <button type="button" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}
            className="h-9 rounded-lg border border-border px-3 disabled:opacity-40">{text('Previous','আগের')}</button>
          <button type="button" disabled={page>=Math.max(data?.totalPages||1,1)} onClick={()=>setPage(p=>p+1)}
            className="h-9 rounded-lg border border-border px-3 disabled:opacity-40">{text('Next','পরের')}</button>
        </div>
      </footer>
    </section>
  </main>;
}
