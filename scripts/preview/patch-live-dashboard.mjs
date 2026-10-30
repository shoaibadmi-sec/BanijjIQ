/**
 * Build-copy-only adapter: the upstream HisabIQ Dashboard JSX remains untouched.
 * Every replacement is exact and fails closed if source UI layout changes.
 */
export function patchLiveDashboardSource(source) {
  const result={...source};
  const edit=(file,before,after)=>{
    if(typeof result[file]!=='string'||result[file].split(before).length!==2)
      throw Error('Dashboard upstream contract changed: '+file+' '+before.slice(0,55));
    result[file]=result[file].replace(before,after);
  };
  edit('dashboard',"import { useState } from 'react';",
    "import { useState } from 'react';\nimport { useLiveDashboardData } from '../integration/useLiveDashboardData';");
  edit('dashboard','  const { metrics, panels, setGroup, toggle, move, reset } = useDashboardLayout();',
    '  const { metrics, panels, setGroup, toggle, move, reset } = useDashboardLayout();\n  const live=useLiveDashboardData();');
  edit('dashboard',"description={englishDate+' · '+business+' · '+text('Sample figures','নমুনার হিসাব')}",
    "description={englishDate+' · '+business+' · '+text('Verified API data only','শুধু যাচাইকৃত হিসাব')}");
  edit('dashboard',"descriptionBn={banglaDate+' · '+business+' · নমুনার হিসাব'}",
    "descriptionBn={banglaDate+' · '+business+' · শুধু যাচাইকৃত হিসাব'}");
  edit('dashboard','<MetricCard widget={w} />',
    "<MetricCard widget={w} liveValue={live.values[w.id]?.value??'—'} liveFoot={live.values[w.id]?.foot??'Awaiting verified API data'} />");
  edit('dashboard','<SalesTrendChart />','<SalesTrendChart data={[]} />');
  edit('dashboard','<CashflowChart />','<CashflowChart data={[]} />');
  edit('dashboard','<RecentSalesTable />','<RecentSalesTable sales={[]} />');
  edit('dashboard','<DuesList />','<DuesList dues={[]} />');
  edit('metric','export function MetricCard({ widget }: {widget: DashboardWidget;}) {',
    'export function MetricCard({ widget, liveValue, liveFoot }: {widget: DashboardWidget;liveValue?:string;liveFoot?:string;}) {');
  edit('metric','{c.value}',"{liveValue ?? '—'}");
  edit('metric','{c.foot}',"{liveFoot ?? 'Awaiting verified API data'}");
  edit('trend',"import { salesTrend } from '../../data/dashboard';",'');
  edit('trend','export function SalesTrendChart({ height = 220 }: {height?: number;}) {',
    'export function SalesTrendChart({ height = 220, data = [] }: {height?: number;data?:Array<{day:string;sales:number;profit:number}>;}) {');
  edit('trend','<AreaChart data={salesTrend}', '<AreaChart data={data}');
  edit('cashflow',"import { cashflow } from '../../data/dashboard';",'');
  edit('cashflow','export function CashflowChart({ height = 220 }: {height?: number;}) {',
    'export function CashflowChart({ height = 220, data = [] }: {height?: number;data?:Array<{month:string;in:number;out:number}>;}) {');
  edit('cashflow','<BarChart data={cashflow}', '<BarChart data={data}');
  edit('sales','export function RecentSalesTable() {',
    'export function RecentSalesTable({sales}: {sales?:typeof recentSales}) {');
  edit('sales','{recentSales.map((s) => {','{(sales ?? recentSales).map((s) => {');
  edit('dues','export function DuesList() {',
    'export function DuesList({dues}: {dues?:typeof duesToCollect}) {');
  edit('dues','const max = Math.max(...duesToCollect.map((d) => d.amount));',
    'const max = Math.max(1,...(dues ?? duesToCollect).map((d) => d.amount));');
  edit('dues','{duesToCollect.map((d) => {',
    '{(dues ?? duesToCollect).map((d) => {');
  return result;
}
