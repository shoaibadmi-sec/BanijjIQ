/** Build-only transform: preserves every original Dashboard widget and its layout. */
export function patchLiveDashboard(source){
  let current=source;
  const replace=(before,after)=>{
    if(!current.includes(before))throw Error('HisabIQ original Dashboard changed; review live-source integration: '+before);
    current=current.replace(before,after);
  };
  for(const name of ['MetricCard','SalesTrendChart','CashflowChart','RecentSalesTable','DuesList'])
    replace("from '../components/dashboard/"+name+"';","from '../integration/LiveDashboardWidgets';");
  replace("text('Sample figures','নমুনার হিসাব')","text('Live source records','মূল হিসাবের তথ্য')");
  replace("· নমুনার হিসাব","· মূল হিসাবের তথ্য");
  replace('subtitle="Last 14 days · বিক্রির ধারা"','subtitle="Verified daily trend not yet available · বিক্রির ধারা"');
  replace('subtitle="Cash in vs out · নগদ প্রবাহ"','subtitle="Verified cash series not yet available · নগদ প্রবাহ"');
  replace('subtitle="Today and yesterday"','subtitle="Recorded source invoices · current and historical"');
  replace('subtitle="Oldest first · বকেয়া আদায়"','subtitle="Current customer dues · aging not yet verified"');
  replace('to="/app/sales"','to="/app/reports?screen=library&report=sales-register"');
  replace('to="/app/parties"','to="/app/reports?screen=library&report=receivables"');
  replace('<div className="mx-auto max-w-[1440px] space-y-4">','<div data-live-dashboard-page="" className="mx-auto max-w-[1440px] space-y-4">');
  return current;
}