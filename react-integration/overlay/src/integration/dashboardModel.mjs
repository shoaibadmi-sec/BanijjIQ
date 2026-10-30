/** Strict mapping of authenticated report evidence to original HisabIQ dashboard widgets.
 * Missing, inconsistent, or unapproved amounts are unavailable, never replaced by demo totals.
 */
const amount=(metric,allowed)=>metric&&allowed.includes(metric.status)&&
  metric.valueMinor!==null&&Number.isSafeInteger(metric.valueMinor)
    ?metric.valueMinor/100:null;
export function loadDashboardMetrics(metrics,products){
  const byKey=new Map((metrics??[]).map(metric=>[metric.key,metric]));
  const metric=(key,status)=>amount(byKey.get(key),status);
  return {
    'today-sales':{amount:metric('netSales',['ready']),note:'Verified today · source invoices'},
    'gross-profit':{amount:metric('grossProfit',['ready']),note:'Verified FIFO profit today'},
    receivable:{amount:metric('receivablesBalance',['needs-review','ready']),note:'Current ledger balance · aging unavailable'},
    payable:{amount:metric('payablesBalance',['needs-review','ready']),note:'Current ledger balance · aging unavailable'},
    cash:{amount:metric('cashBookBalance',['needs-review','ready']),note:'Cash book balance · not physical cash count'},
    'low-stock':{amount:Array.isArray(products)?products.filter(p=>p.status==='Active'&&Number.isFinite(p.currentStock)&&
      Number.isFinite(p.minimumStock)&&p.currentStock<p.minimumStock).length:null,note:'Current stock below minimum'}
  };
}
export function visibleSales(rows){
  return (rows??[]).filter(row=>row.sourceModule==='sales'&&
    ['ready','needs-review'].includes(row.status)&&Number.isSafeInteger(row.amountMinor)&&row.amountMinor>=0)
    .map(row=>({id:row.sourceId,customer:row.label,date:row.date,amount:row.amountMinor/100}));
}
export function visibleDues(rows){
  return (rows??[]).filter(row=>row.sourceModule==='customers'&&
    ['ready','needs-review'].includes(row.status)&&Number.isSafeInteger(row.amountMinor)&&row.amountMinor>0)
    .map(row=>({id:row.sourceId,name:row.label,amount:row.amountMinor/100}));
}

export function recentSalesFrom(today){
 const date=new Date(today+'T12:00:00.000Z');
 date.setUTCDate(date.getUTCDate()-364);
 return date.toISOString().slice(0,10);
}