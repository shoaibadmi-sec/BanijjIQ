import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/Dialog';
import { LayoutDashboard, LibraryBig, RefreshCw, Search } from 'lucide-react';
import { reportCatalog, reportGroups } from '../reports/catalog';
import { reportKeyForScreen } from '../reports/screens';
import type { ReportScreen } from '../reports/types';
import { businessToday } from '../utils/dateRange';
import { useUiCopy } from '../i18n/useUiCopy';
import { canUseModule, useBackendSession } from './BackendGate';
import { getLiveReportCatalog, getLiveReportRows, getLiveReportSummary, getPosInvoice,
  type PosInvoice,
  type LiveReportBackendKey, type LiveReportEntry, type LiveReportPageResponse, type LiveReportMetric } from './banijjApi';

const mapToBackend: Record<string,LiveReportBackendKey> = {
  'sales-register':'sales',purchases:'purchase',stock:'stock',receivables:'receivables',
  payables:'payables','product-profit':'profit','profit-loss':'profit',
  'cash-book':'cash','finance-movements':'finance',expenses:'expenses','business-audit':'audit'
};
const money=(minor:number|null)=>minor===null?'—':'৳'+(minor/100).toLocaleString('en-BD',{minimumFractionDigits:0,maximumFractionDigits:2});
const choices=[...reportCatalog.filter(r=>r.id!=='overview').map(r=>({id:r.id,en:r.en,bn:r.bn,group:r.group})),
  {id:'business-audit',en:'Business Audit (A4)',bn:'ব্যবসা পর্যালোচনা',group:'controls'}];

export function LiveReportsPage(){
  const user=useBackendSession();
  const {text}=useUiCopy();
  const permitted=canUseModule(user, 'reports', 'view');
  const [params,setParams]=useSearchParams();
  const screen=params.get('screen');
  const tab=screen===null||screen==='overview'?'overview':'library';
  const legacyReport=screen&&screen!=='overview'&&screen!=='library'
    ? reportKeyForScreen(screen as ReportScreen):null;
  const selectedRequested=params.get('report')||legacyReport||'sales-register';
  const selected=choices.some(x=>x.id===selectedRequested)?selectedRequested:'sales-register';
  const report=choices.find(x=>x.id===selected)!;
  const today=businessToday();
  const from=params.get('from')||today.slice(0,8)+'01';
  const to=params.get('to')||today;
  const page=Math.max(1,Math.floor(Number(params.get('page'))||1));
  const pageSize=params.get('pageSize')==='100'?100:50;
  const [librarySearch,setLibrarySearch]=useState('');
  const [group,setGroup]=useState('all');
  const [rowSearch,setRowSearch]=useState('');
  const [catalog,setCatalog]=useState<LiveReportEntry[]>([]);
  const [rows,setRows]=useState<LiveReportPageResponse|null>(null);
  const [summaryStatus,setSummaryStatus]=useState('Verified dashboard totals are not yet available.');
  const [summaryMetrics,setSummaryMetrics]=useState<LiveReportMetric[]>([]);
  const [summaryKey,setSummaryKey]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [reload,setReload]=useState(0);
  const [invoiceId,setInvoiceId]=useState<string|null>(null);
  const [invoice,setInvoice]=useState<PosInvoice|null>(null);
  const [invoiceError,setInvoiceError]=useState('');
  const canViewInvoice=canUseModule(user, 'pos', 'view');
  const key=mapToBackend[selected];

  const update=(changes:Record<string,string|null>)=>{
    const next=new URLSearchParams(params);
    for(const [name,value] of Object.entries(changes))value===null?next.delete(name):next.set(name,value);
    setParams(next);
  };
  const switchTab=(next:'overview'|'library')=>update({screen:next,page:null});
  const openReport=(id:string)=>{
    setInvoiceId(null);
    setRowSearch('');
    update({screen:'library',report:id,page:null});
  };

  useEffect(()=>{
    if(!permitted)return;
    let alive=true;
    getLiveReportCatalog().then(value=>{if(alive)setCatalog(value.reports);})
      .catch(e=>{if(alive)setError(e instanceof Error?e.message:'Unable to load report catalog.');});
    return ()=>{alive=false;};
  },[permitted]);

  useEffect(()=>{
    if(!permitted)return;
    let alive=true;
    setRows(null);setError('');
    if(tab==='overview'){
      setSummaryMetrics([]);
      setSummaryKey('');
      setSummaryStatus('Loading current reporting evidence…');
      setLoading(true);
      getLiveReportSummary(from,to)
        .then(value=>{if(alive){setSummaryStatus(value.coverage.reason);setSummaryMetrics(value.metrics);setSummaryKey(from+':'+to);}})
        .catch(e=>{if(alive)setError(e instanceof Error?e.message:'Unable to load dashboard.');})
        .finally(()=>{if(alive)setLoading(false);});
    }else if(key){
      setLoading(true);
      getLiveReportRows({report:key,from,to,page,pageSize,search:rowSearch})
        .then(value=>{if(alive)setRows(value);})
        .catch(e=>{if(alive)setError(e instanceof Error?e.message:'Unable to load report.');})
        .finally(()=>{if(alive)setLoading(false);});
    }else setLoading(false);
    return ()=>{alive=false;};
  },[permitted,tab,key,from,to,page,pageSize,rowSearch,reload]);

  useEffect(()=>{
    if(!invoiceId||!canViewInvoice)return;
    let alive=true;
    setInvoice(null);setInvoiceError('');
    getPosInvoice(invoiceId)
      .then(value=>{if(alive)setInvoice(value.invoice);})
      .catch(error=>{if(alive)setInvoiceError(error instanceof Error?error.message:'Unable to open invoice.');});
    return ()=>{alive=false;};
  },[invoiceId,canViewInvoice]);

  const visible=useMemo(()=>choices.filter(c=>(group==='all'||c.group===group)
    &&(c.en+' '+c.bn).toLocaleLowerCase().includes(librarySearch.toLocaleLowerCase())),[group,librarySearch]);
  const activeCatalog=catalog.find(c=>c.id===key);
  const currentReport=key==='stock'||key==='receivables'||key==='payables';
  const moneyMovement=key==='cash'||key==='bank'||key==='finance';
  const financialReport=moneyMovement||key==='expenses';
  const financialCards=key==='cash'?['cashReceipts','cashPayments','externalNetMovement','bankCurrentBalance']:
    key==='bank'?['bankReceipts','bankPayments','bankCurrentBalance']:
    key==='expenses'?['operatingExpenses']:
    key==='finance'?['ownerCapitalIn']:[];
  const financialLabels:Record<string,{en:string;bn:string}>={
    cashReceipts:{en:'Cash in',bn:'ক্যাশ জমা'},cashPayments:{en:'Cash out',bn:'ক্যাশ খরচ'},
    bankReceipts:{en:'Bank in',bn:'ব্যাংকে জমা'},bankPayments:{en:'Bank out',bn:'ব্যাংক থেকে খরচ'},
    externalNetMovement:{en:'Net money movement',bn:'মোট টাকার পরিবর্তন'},
    bankCurrentBalance:{en:'Current bank balance',bn:'বর্তমান ব্যাংক জের'},
    operatingExpenses:{en:'Recorded expenses',bn:'লেখা খরচ'},ownerCapitalIn:{en:'Owner investment',bn:'মালিকের বিনিয়োগ'}
  };
  const unsupported=!key;
  const coverage=rows?.coverage;
  const visibleSummary=summaryKey===from+':'+to?summaryMetrics:[];
  if(!permitted)return <main className="mx-auto max-w-4xl p-6"><h1 className="text-lg font-semibold">
    {text('Reports','রিপোর্ট')}</h1><p role="alert" className="mt-3 text-sm text-danger">
    {text('You do not have permission to view reports.','আপনার রিপোর্ট দেখার অনুমতি নেই।')}</p></main>;

  return <main className="mx-auto w-full max-w-[1440px] space-y-4 p-3 sm:p-4" data-live-reports="">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h1 className="text-xl font-semibold text-ink">{text('Reports','রিপোর্ট')}</h1>
        <p className="mt-1 text-xs text-ink-500">{text('Live source records. Unverified totals are never shown as profit.','মূল রেকর্ড; যাচাই না হওয়া হিসাব লাভ হিসেবে দেখানো হয় না।')}</p>
      </div>
      <button type="button" onClick={()=>setReload(n=>n+1)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium text-ink hover:bg-ink-50">
        <RefreshCw className="size-4" aria-hidden="true"/>{text('Refresh','হালনাগাদ')}</button>
    </div>

    <div className="flex w-full gap-1 border-b border-border" role="tablist" aria-label={text('Report destinations','রিপোর্টের বিভাগ')}>
      {([{id:'overview',en:'Dashboard',bn:'ড্যাশবোর্ড',icon:LayoutDashboard},
         {id:'library',en:'Report Library',bn:'রিপোর্ট লাইব্রেরি',icon:LibraryBig}] as const).map(item=>
        <button type="button" role="tab" aria-selected={tab===item.id} key={item.id} onClick={()=>switchTab(item.id)}
          className={'relative flex h-10 items-center gap-2 px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary '+(tab===item.id?'border-b-2 border-primary text-primary':'text-ink-500 hover:text-ink')}>
          <item.icon className="size-4" aria-hidden="true"/>{text(item.en,item.bn)}
        </button>)}
    </div>
    <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3" aria-label={text('Report period','রিপোর্টের সময়কাল')}>
      <label className="flex items-center gap-2 text-xs text-ink-600">{text('From','শুরু')}
        <input type="date" value={from} onChange={e=>update({from:e.target.value,page:null})} className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-ink"/></label>
      <label className="flex items-center gap-2 text-xs text-ink-600">{text('To','শেষ')}
        <input type="date" value={to} onChange={e=>update({to:e.target.value,page:null})} className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-ink"/></label>
      <span className="text-xs text-ink-500">{text('Asia/Dhaka business dates','ঢাকা সময়ের হিসাব')}</span>
    </section>
    {error&&<p role="alert" className="rounded-lg border border-danger/20 bg-danger-bg p-3 text-sm text-danger">{error}</p>}
    {loading&&<p role="status" className="text-sm text-ink-500">{text('Loading real records…','মূল তথ্য আসছে…')}</p>}

    {tab==='overview'?<section className="space-y-3" role="tabpanel" aria-label={text('Dashboard','ড্যাশবোর্ড')}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([
          {key:'netSales',en:'Net sales',bn:'নিট বিক্রি'},
          {key:'grossProfit',en:'Gross profit',bn:'মোট লাভ'},
          {key:'operatingExpenses',en:'Expenses',bn:'খরচ'},
          {key:'netProfit',en:'Net profit',bn:'নিট লাভ'}
        ] as const).map(item=>{
          const metric=visibleSummary.find(m=>m.key===item.key);
          const confirmed=metric?.status==='ready'&&metric.valueMinor!==null;
          return <div key={item.key} data-live-metric={item.key} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-ink-500">{text(item.en,item.bn)}</p>
            <p className="mt-2 text-xl font-semibold text-ink">{confirmed?money(metric.valueMinor):'—'}</p>
            <p className="mt-1 text-xs text-warning">{confirmed
              ?text('Verified from recorded sources','মূল রেকর্ড থেকে যাচাইকৃত')
              :text('Awaiting reconciled data','যাচাইকৃত হিসাব অপেক্ষমাণ')}</p>
          </div>;
        })}
      </div>
      <section aria-label={text('Current balances','বর্তমান জের')} className="space-y-2">
        <div><h2 className="text-sm font-semibold text-ink">{text('Current balances','বর্তমান জের')}</h2>
          <p className="text-xs text-ink-500">{text('Today’s recorded balances, not historical figures for the selected date range. Invoice ageing is not yet verified.',
            'বর্তমান হিসাব; নির্বাচিত সময়ের পুরোনো জের নয়। বয়সভিত্তিক বাকি এখনো যাচাই হয়নি।')}</p></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {([
            {key:'inventoryValue',en:'Stock value',bn:'স্টক মূল্য'},
            {key:'receivablesBalance',en:'Customer dues',bn:'গ্রাহকের বাকি'},
            {key:'payablesBalance',en:'Supplier payables',bn:'সরবরাহকারীর দেনা'}
          ] as const).map(item=>{
            const metric=visibleSummary.find(m=>m.key===item.key);
            const currentOnly=metric?.status==='needs-review'&&metric?.valueMinor!==null;
            return <div key={item.key} data-current-balance={item.key} className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-ink-500">{text(item.en,item.bn)}</p>
              <p className="mt-2 text-xl font-semibold text-ink">{currentOnly?money(metric.valueMinor):'—'}</p>
              <p className="mt-1 text-xs text-warning">{currentOnly
                ?text('Current snapshot · Not historical','বর্তমান হিসাব · পুরোনো নয়')
                :text('Ledger reconciliation required','হিসাব মিলিয়ে দেখা দরকার')}</p>
              {metric&&metric.status==='incomplete'&&<p className="mt-2 text-xs text-danger">{metric.reason}</p>}
            </div>;
          })}
        </div>
      </section>
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-ink">{text('Dashboard reconciliation','ড্যাশবোর্ড হিসাব যাচাই')}</h2>
        <p className="mt-2 text-sm text-ink-600">{summaryStatus}</p>
        <button type="button" onClick={()=>switchTab('library')} className="mt-4 h-9 rounded-lg bg-primary px-4 text-sm font-medium text-white">
          {text('Open Report Library','রিপোর্ট লাইব্রেরি খুলুন')}</button>
      </div>
    </section>:<section className="space-y-3" role="tabpanel" aria-label={text('Report Library','রিপোর্ট লাইব্রেরি')}>
      <div className="flex flex-wrap gap-2">
        <label className="relative min-w-48 flex-1">
          <Search aria-hidden="true" className="absolute left-3 top-2.5 size-4 text-ink-400"/>
          <input aria-label={text('Find a report','রিপোর্ট খুঁজুন')} placeholder={text('Find a report…','রিপোর্ট খুঁজুন…')}
            value={librarySearch} onChange={e=>setLibrarySearch(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm text-ink"/>
        </label>
        <select aria-label={text('Report group','রিপোর্টের বিভাগ')} value={group} onChange={e=>setGroup(e.target.value)}
          className="h-9 rounded-lg border border-border bg-card px-2 text-sm">
          <option value="all">{text('All report groups','সব বিভাগ')}</option>
          {reportGroups.map(g=><option key={g.id} value={g.id}>{text(g.en,g.bn)}</option>)}
        </select>
      </div>
      <div className="grid min-w-0 gap-3 lg:grid-cols-[215px_minmax(0,1fr)]">
        <nav aria-label={text('Report library','রিপোর্টের তালিকা')} className="max-h-[65vh] space-y-1 overflow-y-auto rounded-xl border border-border bg-card p-2">
          {visible.map(item=><button type="button" key={item.id} onClick={()=>openReport(item.id)}
            aria-current={selected===item.id?'page':undefined}
            className={'flex h-9 w-full items-center rounded-lg px-2 text-left text-xs '+(selected===item.id?'bg-primary/10 font-semibold text-ink':'text-ink-600 hover:bg-ink-50')}>
            <span className="truncate">{text(item.en,item.bn)}</span></button>)}
          {!visible.length&&<p className="p-3 text-xs text-ink-500">{text('No matching reports','কোনো রিপোর্ট মেলেনি')}</p>}
        </nav>
        <div className="min-w-0 space-y-3">
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h2 className="text-sm font-semibold text-ink">{text(report.en,report.bn)}</h2>
                <p className="mt-1 text-xs text-ink-500">{coverage?.reason||activeCatalog?.reason||'Select a report to view verified source records.'}</p></div>
              <div className="flex flex-wrap gap-2">
                <input value={rowSearch} onChange={e=>{setRowSearch(e.target.value);update({page:null});}} aria-label={text('Search records','রেকর্ড খুঁজুন')}
                  placeholder={text('Search records','রেকর্ড খুঁজুন')} className="h-9 w-36 rounded-lg border border-border bg-card px-2 text-xs"/>
                <select value={pageSize} onChange={e=>update({pageSize:e.target.value,page:null})} aria-label={text('Rows per page','প্রতি পৃষ্ঠায় সারি')}
                  className="h-9 rounded-lg border border-border bg-card px-2 text-xs"><option value="50">50</option><option value="100">100</option></select>
              </div>
            </div>
            {unsupported&&<p className="mt-4 text-sm text-warning">{text('This report has not yet been reconciled with live D1. No preview figures are shown.','এই রিপোর্টের লাইভ হিসাব যাচাই হয়নি। ডেমো সংখ্যা দেখানো হচ্ছে না।')}</p>}
          </div>
          {rows&&financialReport&&<div className="grid grid-cols-2 gap-2 md:grid-cols-4" aria-label={text('Recorded financial movements','আর্থিক লেনদেনের হিসাব')}>
            {financialCards.map(metricKey=>{
              const item=rows.metrics.find(x=>x.key===metricKey);
              const display=!!item&&item.valueMinor!==null&&(item.status==='ready'||item.status==='needs-review');
              const isCurrent=metricKey==='bankCurrentBalance';
              return <div key={metricKey} data-report-metric={metricKey} className="rounded-xl border border-border bg-card p-3">
                <p className="text-xs text-ink-500">{text(financialLabels[metricKey].en,financialLabels[metricKey].bn)}</p>
                <p className="mt-1 text-lg font-semibold text-ink">{display?money(item.valueMinor):'—'}</p>
                <p className="mt-1 text-xs text-ink-500">{isCurrent
                  ?text('Current ledger snapshot · not historical','বর্তমান জের · পুরোনো নয়')
                  :text('Selected-period posted movement','নির্বাচিত সময়ের লেনদেন')}</p>
                {item?.status==='incomplete'&&<p className="mt-1 text-xs text-danger">{item.reason}</p>}
              </div>;
            })}
          </div>}
          {rows&&<div tabIndex={0} role="region" aria-label={text('Report results table','রিপোর্টের ফলাফলের টেবিল')} className="overflow-x-auto rounded-xl border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <table className="w-full min-w-[520px] text-[13px]"><thead className="bg-ink-50/50 text-ink-600">
              <tr><th scope="col" className="px-3 py-2 text-left">{text('Reference','নম্বর')}</th>
                <th scope="col" className="px-3 py-2 text-left">{text(currentReport?'Snapshot':'Date',currentReport?'বর্তমান হিসাব':'তারিখ')}</th>
                <th scope="col" className="px-3 py-2 text-left">{text(currentReport?'Product / Party':financialReport?'Details':'Party','পণ্য / পার্টি')}</th>
                {moneyMovement?<><th scope="col" className="px-3 py-2 text-right">{text('Money in','জমা')}</th>
                  <th scope="col" className="px-3 py-2 text-right">{text('Money out','খরচ')}</th></>:
                  <th scope="col" className="px-3 py-2 text-right">{text(key==='stock'?'Current FIFO value':currentReport?'Current due':'Recorded amount',
                    key==='stock'?'বর্তমান স্টক মূল্য':currentReport?'বর্তমান বাকি':'লেখা টাকা')}</th>}
                <th scope="col" className="px-3 py-2 text-left">{text('Status','অবস্থা')}</th></tr>
            </thead><tbody>{rows.rows.map(row=><tr className="border-t border-border" key={row.sourceModule+':'+row.sourceId}>
              <td className="px-3 py-2 font-medium text-primary">
                {row.sourceModule==='sales'&&canViewInvoice
                  ?<button type="button" className="rounded text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    onClick={()=>setInvoiceId(row.sourceId)}>{row.sourceId}</button>
                  :row.sourceId}
              </td><td className="px-3 py-2">{row.date}</td>
              <td className="px-3 py-2">{row.label}</td>
              {moneyMovement?<><td className="px-3 py-2 text-right">{row.amountMinor!==null&&row.amountMinor>0?money(row.amountMinor):'—'}</td>
                <td className="px-3 py-2 text-right">{row.amountMinor!==null&&row.amountMinor<0?money(-row.amountMinor):'—'}</td></>:
                <td className="px-3 py-2 text-right">{money(row.amountMinor)}</td>}
              <td className="px-3 py-2">
                <span title={row.reason} className={row.status==='incomplete'?'text-danger':'text-ink-500'}>
                  {row.status==='incomplete'?text('Needs checking','মিলিয়ে দেখুন'):
                    currentReport?text('Current only','বর্তমান হিসাব'):text('Recorded','রেকর্ড')}
                </span>
              </td>
            </tr>)}</tbody></table>
            {!rows.rows.length&&<p className="p-5 text-sm text-ink-500">{text('No recorded rows for this selection.','এই নির্বাচনে কোনো রেকর্ড নেই।')}</p>}
          </div>}
          {rows&&<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-600">
            <span>{text('Records','রেকর্ড')}: {rows.totalRows} · {text('Page','পৃষ্ঠা')}: {page}</span>
            <div className="flex flex-wrap items-center gap-2">
              <form className="flex items-center gap-2" onSubmit={event=>{
                event.preventDefault();
                const target=Number(new FormData(event.currentTarget).get('report-page'));
                const totalPages=Math.max(1,Math.ceil(rows.totalRows/pageSize));
                if(Number.isInteger(target)&&target>=1&&target<=totalPages)update({page:String(target)});
              }}>
                <input type="number" name="report-page" aria-label={text('Go to page','পৃষ্ঠায় যান')}
                  key={page+':'+rows.totalRows+':'+pageSize} defaultValue={page}
                  min={1} max={Math.max(1,Math.ceil(rows.totalRows/pageSize))} required
                  className="h-9 w-16 rounded-lg border border-border bg-card px-2 text-sm"/>
                <span>{text('of','মোট')} {Math.max(1,Math.ceil(rows.totalRows/pageSize))}</span>
                <button type="submit" className="h-9 rounded-lg border border-border bg-card px-3">{text('Go','যান')}</button>
              </form>
              <button type="button" disabled={page<=1} onClick={()=>update({page:String(page-1)})}
                className="h-9 rounded-lg border border-border bg-card px-3 disabled:opacity-40">{text('Previous','আগে')}</button>
              <button type="button" disabled={page*pageSize>=rows.totalRows} onClick={()=>update({page:String(page+1)})}
                className="h-9 rounded-lg border border-border bg-card px-3 disabled:opacity-40">{text('Next','পরের')}</button>
            </div>
          </div>}
        </div>
      </div>
    </section>}
    <Dialog open={invoiceId!==null&&canViewInvoice} onOpenChange={open=>{if(!open)setInvoiceId(null);}}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogTitle>{text('Recorded invoice','মূল বিক্রয় চালান')}</DialogTitle>
        <DialogDescription>{text('Read-only details from the saved invoice. No changes are made.','সংরক্ষিত চালানের তথ্য। কোনো পরিবর্তন করা হবে না।')}</DialogDescription>
        {invoiceError?<p role="alert" className="text-sm text-danger">{invoiceError}</p>:
          !invoice||invoice.invoiceId!==invoiceId?<p role="status" className="text-sm text-ink-500">{text('Loading invoice…','চালান আসছে…')}</p>:
          <div className="space-y-3 text-sm" data-report-source-invoice={invoice.invoiceId}>
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-ink-50 p-3">
              <div><p className="text-xs text-ink-500">{text('Invoice','চালান')}</p><p className="font-semibold">{invoice.invoiceId}</p></div>
              <div><p className="text-xs text-ink-500">{text('Date','তারিখ')}</p><p>{invoice.date}</p></div>
              <div><p className="text-xs text-ink-500">{text('Customer','গ্রাহক')}</p><p>{invoice.customerName}</p></div>
              <div><p className="text-xs text-ink-500">{text('Phone','ফোন')}</p><p>{invoice.customerPhone}</p></div>
            </div>
            <ul className="divide-y divide-border">
              {invoice.items.map((item,i)=><li key={i} className="flex items-start justify-between gap-3 py-2">
                <span>{item.productName} · {item.unitDescription||item.quantity+' '+item.unit}</span>
                <span className="shrink-0 font-medium">{money(Math.round(item.lineTotal*100))}</span>
              </li>)}
            </ul>
            <div className="space-y-1 border-t border-border pt-3">
              <p className="flex justify-between"><span>{text('Total','মোট')}</span><strong>{money(Math.round(invoice.grandTotal*100))}</strong></p>
              <p className="flex justify-between"><span>{text('Paid','জমা')}</span><span>{money(Math.round(invoice.paidAmount*100))}</span></p>
              <p className="flex justify-between"><span>{text('Due','বাকি')}</span><span>{money(Math.round(invoice.dueAmount*100))}</span></p>
              <p className="text-xs text-ink-500">{invoice.paymentStatus} · {invoice.paymentMethod}</p>
            </div>
          </div>}
      </DialogContent>
    </Dialog>
  </main>;
}
