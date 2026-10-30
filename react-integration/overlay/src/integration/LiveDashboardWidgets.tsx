import {createContext,useContext} from 'react';
import {Link} from 'react-router-dom';
import {ArrowDownLeft,HandCoins,PackageMinus,Percent,ShoppingCart,Wallet,ChevronRight} from 'lucide-react';
import {taka} from '../utils/currency';
import type {DashboardWidget} from '../types/erp';
import {Table,TableHead,TableHeader,TableBody,TableRow,TableCell} from '../components/Table';
import {PartyAvatar} from '../components/PartyAvatar';

export type LiveMetric={amount:number|null;note:string};
export type LiveRow={id:string;customer:string;date:string;amount:number};
export type LiveDue={id:string;name:string;amount:number};
export type LiveData={
  metrics:Record<string,LiveMetric>;
  sales:LiveRow[];dues:LiveDue[];
  loading:boolean;error:string;userName?:string;businessName?:string;
};
export const useLiveDashboardIdentity=()=>{
  const source=useContext(LiveDashboardContext);
  return {userName:source.userName||'',businessName:source.businessName||''};
};
export const LiveDashboardContext=createContext<LiveData>({
  metrics:{},sales:[],dues:[],loading:true,error:''
});
const unavailable=(message:string)=><p className="flex h-[220px] items-center justify-center px-3 text-center text-xs text-ink-500" role="status">{message}</p>;
const entries={
  'today-sales':{icon:ShoppingCart,tone:'bg-teal-50 text-teal-700',to:'/app/reports?screen=overview'},
  receivable:{icon:ArrowDownLeft,tone:'bg-ink-50 text-ink-700',to:'/app/reports?screen=library&report=receivables'},
  payable:{icon:HandCoins,tone:'bg-warning-bg text-warning',to:'/app/reports?screen=library&report=payables'},
  cash:{icon:Wallet,tone:'bg-ink-50 text-ink-700',to:'/app/reports?screen=library&report=cash-book'},
  'gross-profit':{icon:Percent,tone:'bg-teal-50 text-teal-700',to:'/app/reports?screen=overview'},
  'low-stock':{icon:PackageMinus,tone:'bg-danger-bg text-danger',to:'/app/products'}
};
export function MetricCard({widget}:{widget:DashboardWidget}){
  const {metrics,loading,error}=useContext(LiveDashboardContext);
  const config=entries[widget.id as keyof typeof entries];
  if(!config)return null;
  const Icon=config.icon;
  const entry=metrics[widget.id];
  const value=entry?.amount;
  const rendered=value===null||value===undefined?'—':
    widget.id==='low-stock'?value+' items':taka(value);
  const note=error|| (loading?'Loading verified records…':entry?.note??'Source unavailable');
  return <Link to={config.to} className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
    <div data-live-dashboard-metric={widget.id} className="h-full rounded-xl border border-border bg-card p-3.5 shadow-card transition-colors hover:border-ink-200">
      <div className="flex items-start justify-between gap-2"><div className="min-w-0">
        <p className="truncate text-[12.5px] font-medium text-ink-600">{widget.label}</p>
        <p className="font-bn truncate text-[11px] text-ink-400">{widget.labelBn}</p>
      </div><span className={'flex size-7 shrink-0 items-center justify-center rounded-lg '+config.tone}>
        <Icon className="size-3.5" aria-hidden="true"/>
      </span></div>
      <p className="mt-2 text-[22px] font-semibold tabular-nums tracking-tight text-ink">{rendered}</p>
      <p className="mt-0.5 truncate text-[11.5px] text-ink-500" title={note}>{value===null||value===undefined?'Awaiting verified data · ':''}{note}</p>
    </div>
  </Link>;
}
export function SalesTrendChart(){return unavailable('Daily sales and profit trend unavailable until source-based daily reconciliation is verified.');}
export function CashflowChart(){return unavailable('Monthly cash in/out chart unavailable until the complete source series is verified.');}
export function RecentSalesTable(){
  const {sales,loading,error}=useContext(LiveDashboardContext);
  if(error)return unavailable(error);
  if(loading)return unavailable('Loading recorded invoices…');
  if(!sales.length)return unavailable('No recorded invoices available for this period.');
  return <Table><TableHeader><TableRow className="hover:bg-transparent">
    <TableHead className="h-8 pl-4 text-xs">Invoice</TableHead>
    <TableHead className="h-8 text-xs">Customer</TableHead>
    <TableHead className="h-8 text-xs">Source</TableHead>
    <TableHead className="h-8 text-right text-xs">Recorded total</TableHead>
    <TableHead className="h-8 pr-4 text-right text-xs">Due</TableHead>
  </TableRow></TableHeader><TableBody>{sales.slice(0,8).map(row=><TableRow key={row.id} className="text-[13px]">
    <TableCell className="py-2 pl-4"><Link className="font-medium text-teal-700" to="/app/reports?screen=library&report=sales-register">{row.id}</Link><span data-table-helper="" className="block text-[11px] text-ink-400">{row.date}</span></TableCell>
    <TableCell className="py-2 text-ink-700">{row.customer}</TableCell>
    <TableCell className="py-2 text-ink-500">Recorded</TableCell>
    <TableCell className="py-2 text-right tabular-nums font-medium text-ink">{taka(row.amount)}</TableCell>
    <TableCell className="py-2 pr-4 text-right text-ink-400" title="Invoice-level due must be reconciled">—</TableCell>
  </TableRow>)}</TableBody></Table>;
}
export function DuesList(){
  const {dues,loading,error}=useContext(LiveDashboardContext);
  if(error)return unavailable(error);
  if(loading)return unavailable('Loading current customer balances…');
  if(!dues.length)return unavailable('No customer dues recorded or balances unavailable.');
  const max=Math.max(1,...dues.map(row=>row.amount));
  return <ul className="divide-y divide-border">{dues.slice(0,6).map(row=><li key={row.id}>
    <Link to="/app/reports?screen=library&report=receivables" className="group flex items-center gap-3 px-4 py-2.5 hover:bg-ink-50">
      <PartyAvatar name={row.name} size={30}/><div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[13px] font-medium text-ink">{row.name}</p>
          <p className="text-[13px] font-semibold tabular-nums text-ink">{taka(row.amount)}</p>
        </div><div className="mt-1 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-100">
            <div className="h-full rounded-full bg-teal-500" style={{width:(row.amount/max*100)+'%'}}/>
          </div><span className="shrink-0 text-[11px] text-ink-500">Current due</span>
        </div>
      </div><ChevronRight className="size-4 text-helper group-hover:text-ink-500" aria-hidden="true"/>
    </Link>
  </li>)}</ul>;
}