import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { Button } from '../../components/Button';
import { getStockAlerts, type StockAlert, type StockAlertsResponse } from '../banijjApi';

type Props = {
  enabled: boolean;
  refreshKey: unknown;
  onSelectProduct: (name:string) => void;
};
const labels:Record<StockAlert['kind'],string>={
  'needs-review':'Check stock · যাচাই',
  'out-of-stock':'No stock · স্টক নেই',
  'low-stock':'Low stock · কম স্টক',
  'expired':'Expired · মেয়াদ শেষ',
  'expiring':'Expiry soon · মেয়াদ শিগগির'
};
const localDay=()=>{
  const date=new Date();
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
};
export function LiveStockAlerts({enabled,refreshKey,onSelectProduct}:Props) {
  const [snapshot,setSnapshot]=useState<StockAlertsResponse|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [expanded,setExpanded]=useState(false);
  const [page,setPage]=useState(1);
  const [reload,setReload]=useState(0);
  useEffect(()=>{
    if(!enabled){setSnapshot(null);return;}
    let active=true;
    setLoading(true);setError('');setSnapshot(null);
    getStockAlerts({asOf:localDay(),days:30,page,pageSize:50})
      .then(data=>{if(active)setSnapshot(data);})
      .catch(err=>{if(active){setSnapshot(null);setError(err instanceof Error?err.message:'Could not check inventory alerts');}})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[enabled,refreshKey,page,reload]);

  if(!enabled)return null;
  const counts=snapshot?.counts;
  return <section aria-label="Live stock alerts" className="rounded-xl border border-border bg-card px-3 py-2 shadow-card">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
          <AlertTriangle aria-hidden="true" className="size-3.5 text-warning"/>
          Stock alerts <span className="font-bn font-normal text-ink-500">· স্টক সতর্কতা</span>
        </span>
        {counts ? <>
          <span className="text-danger">{counts.expired} expired</span>
          <span className="text-warning">{counts.expiring} expiry soon</span>
          <span className="text-ink-700">{counts.needsReview} check stock</span>
        </> : <span role="status" className="text-ink-500">
          {loading?'Checking live inventory…':error?'Alerts unavailable — retry':'Checking live inventory…'}
        </span>}
      </div>
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="outline" disabled={loading}
          onClick={()=>setReload(n=>n+1)} aria-label="Refresh live stock alerts">
          <RefreshCw aria-hidden="true" className="size-3.5"/>
        </Button>
        <Button size="sm" variant="outline" disabled={!snapshot||snapshot.totalAlerts===0}
          aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>
          {expanded?'Hide':'Review'} {snapshot?String(snapshot.totalAlerts):''}
          {expanded?<ChevronUp aria-hidden="true" className="size-3.5"/>:
            <ChevronDown aria-hidden="true" className="size-3.5"/>}
        </Button>
      </div>
    </div>
    {error&&<p role="alert" className="mt-2 text-xs text-danger">{error} · No unverified stock figures shown.</p>}
    {expanded&&snapshot&&<div className="mt-2 border-t border-border pt-2">
      <ul className="space-y-1" aria-label="Source-linked inventory alerts">
        {snapshot.alerts.map((alert,index)=><li key={alert.kind+'-'+alert.productId+'-'+(alert.expiryBatchId||index)}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1 text-xs hover:bg-ink-50">
          <button type="button" onClick={()=>onSelectProduct(alert.productName)}
            className="min-w-0 max-w-full truncate text-left font-medium text-teal-700 underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2">
            {alert.productName}
          </button>
          <span className={alert.kind==='expired'||alert.kind==='out-of-stock'?'text-danger':alert.kind==='needs-review'?'text-warning':'text-ink-600'}>
            {labels[alert.kind]}
            {alert.expiryDate?' · '+alert.expiryDate:''}
            {alert.quantity!==undefined?' · '+alert.quantity:''}
          </span>
          {alert.kind==='needs-review'&&alert.reason&&
            <span className="w-full text-[11px] text-ink-500">{alert.reason}</span>}
        </li>)}
      </ul>
      {snapshot.totalAlerts>snapshot.pageSize&&<div className="mt-2 flex items-center justify-end gap-2 text-xs">
        <Button size="sm" variant="outline" disabled={loading||page<=1}
          onClick={()=>setPage(n=>Math.max(1,n-1))}>Previous</Button>
        <span>Page {snapshot.page}</span>
        <Button size="sm" variant="outline" disabled={loading||page*snapshot.pageSize>=snapshot.totalAlerts}
          onClick={()=>setPage(n=>n+1)}>Next</Button>
      </div>}
    </div>}
  </section>;
}
