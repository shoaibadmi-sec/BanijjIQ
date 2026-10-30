import {useEffect,useMemo,useState} from 'react';
import {Dashboard} from '../pages/Dashboard';
import {businessToday} from '../utils/dateRange';
import {canUseModule,useBackendSession} from './BackendGate';
import {getBootstrap,getLiveReportSummary,getLiveReportRows,request,type LiveReportMetric} from './banijjApi';
import {loadDashboardMetrics,visibleSales,visibleDues,recentSalesFrom} from './dashboardModel.mjs';
import {LiveDashboardContext,type LiveData} from './LiveDashboardWidgets';

/** Preserve original HisabIQ page and widget ordering, replacing only demo data sources. */
export function LiveDashboardPage(){
  const user=useBackendSession();
  const reportsAllowed=canUseModule(user,'reports','view');
  const productsAllowed=canUseModule(user,'products','view');
  const settingsAllowed=canUseModule(user,'settings','view');
  const [source,setSource]=useState<LiveData>({metrics:{},sales:[],dues:[],loading:true,error:''});
  const now=useMemo(()=>businessToday(),[]);
  useEffect(()=>{
    let alive=true;
    if(!reportsAllowed){
      setSource({metrics:{},sales:[],dues:[],loading:false,error:'Reports permission required to view dashboard financial records.'});
      return()=>{alive=false;};
    }
    setSource({metrics:{},sales:[],dues:[],loading:true,error:''});
    const read=async()=>{
      const [summary,sales,dues,products,settings]=await Promise.allSettled([
        getLiveReportSummary(now,now),
        getLiveReportRows({report:'sales',from:recentSalesFrom(now),to:now,page:1,pageSize:50}),
        getLiveReportRows({report:'receivables',from:now,to:now,page:1,pageSize:50}),
        productsAllowed?getBootstrap():Promise.resolve(null),
        settingsAllowed?request<{ok:true;settings:Record<string,string>}>('/api/settings/bootstrap'):Promise.resolve(null)
      ]);
      if(!alive)return;
      // No mock fallback: each failed source stays empty, never displaying a previous user's numbers.
      const metrics=summary.status==='fulfilled'?summary.value.metrics:[];
      const productRows=products.status==='fulfilled'?products.value?.products??null:null;
      const error=summary.status==='rejected'
        ?'Unable to load verified dashboard totals. Check your connection and permissions.':'';
      setSource({
        businessName:settings.status==='fulfilled'?settings.value?.settings?.['Shop Name']?.trim()||'':'',
        metrics:loadDashboardMetrics(metrics as LiveReportMetric[],productRows),
        sales:sales.status==='fulfilled'?visibleSales(sales.value.rows):[],
        dues:dues.status==='fulfilled'?visibleDues(dues.value.rows):[],
        loading:false,error
      });
    };
    void read().catch(()=>{if(alive)setSource({metrics:{},sales:[],dues:[],loading:false,
      error:'Dashboard source records unavailable. No demo totals shown.'});});
    return()=>{alive=false;};
  },[reportsAllowed,productsAllowed,settingsAllowed,now]);
  return <LiveDashboardContext.Provider value={{...source,userName:user?.fullName||''}}>
    <section data-live-dashboard="" aria-label="D1-backed HisabIQ dashboard">
      {source.error&&<p role="alert" className="mx-auto max-w-[1440px] rounded-lg border border-danger/20 bg-danger-bg p-2 text-sm text-danger">{source.error}</p>}
      <Dashboard/>
    </section>
  </LiveDashboardContext.Provider>;
}