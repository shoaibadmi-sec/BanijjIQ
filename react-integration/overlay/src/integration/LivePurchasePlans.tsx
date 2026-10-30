import {useCallback,useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {Button} from '../components/Button';
import {Input} from '../components/Input';
import {canUseModule,useBackendSession} from './BackendGate';
import {analyzePurchasePlan,savePurchasePlan,approvePurchasePlan,
 listPurchasePlans,listPurchaseOrders,type PlanRow,type PlanSupplier,type PlanSummary,type OrderSummary} from './purchaseApi';

const money=(n:number)=>'৳'+Number(n||0).toLocaleString('en-BD',{maximumFractionDigits:2});
export function LivePurchasePlans(){
 const user=useBackendSession(),permitted=canUseModule(user,'purchase','add');
 const [rows,setRows]=useState<PlanRow[]>([]),[suppliers,setSuppliers]=useState<PlanSupplier[]>([]);
 const [plans,setPlans]=useState<PlanSummary[]>([]),[orders,setOrders]=useState<OrderSummary[]>([]);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[message,setMessage]=useState('');
 const refresh=useCallback(async()=>{
  setLoading(true);setError('');
  try{
   const [analysis,planList,orderList]=await Promise.all([
    analyzePurchasePlan(),listPurchasePlans(),listPurchaseOrders()]);
   setRows(analysis.rows.filter(r=>r.suggestedQty>0));
   setSuppliers(analysis.suppliers);setPlans(planList);setOrders(orderList);
  }catch(e){setError(e instanceof Error?e.message:'Cannot load purchase planning data');}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{void refresh();},[refresh]);
 const change=(id:string,patch:Partial<PlanRow>)=>
  setRows(old=>old.map(r=>r.productId===id?{...r,...patch}:r));
 const selected=rows.filter(r=>r.included&&r.plannedQty>0);
 async function act(promise:()=>Promise<unknown>,label:string){
  if(busy)return;setBusy(true);setError('');setMessage('');
  try{await promise();setMessage(label);await refresh();}
  catch(e){setError(e instanceof Error?e.message:'Purchase plan action failed');}
  finally{setBusy(false);}
 }
 return <section data-live-purchase-plans className="space-y-4">
  {error&&<p role="alert" className="rounded-md bg-danger-bg p-3 text-sm text-danger">{error}</p>}
  {message&&<p role="status" className="rounded-md bg-success-bg p-3 text-sm text-success">{message}</p>}
  {loading?<p role="status" className="text-sm text-ink-500">Loading purchase planner…</p>:<>
  <div className="rounded-xl border border-border bg-card p-3 shadow-card">
   <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
    <div><h2 className="text-sm font-semibold text-ink">Suggested Purchases · ক্রয় পরিকল্পনা</h2>
     <p className="text-xs text-ink-500">Sales, low stock and pending orders inform suggestions.</p></div>
    <Button size="sm" variant="outline" onClick={()=>void refresh()} disabled={busy}>Refresh</Button>
   </div>
   <div role="region" tabIndex={0} aria-label="Purchase planner table" className="overflow-x-auto">
    <table className="w-full min-w-[660px] text-left text-xs">
     <thead><tr className="border-b border-border text-ink-600">
      <th className="px-2 py-2">Include</th><th className="px-2 py-2">Product</th>
      <th className="px-2 py-2">Stock</th><th className="px-2 py-2">Suggested</th>
      <th className="px-2 py-2">Order quantity</th><th className="px-2 py-2">Supplier</th>
      <th className="px-2 py-2 text-right">Cost / unit</th>
     </tr></thead>
     <tbody>{rows.map(r=><tr key={r.productId} className="border-b border-border">
      <td className="px-2 py-2"><input type="checkbox" checked={r.included}
       aria-label={'Include '+r.productName} disabled={!permitted||busy}
       onChange={e=>change(r.productId,{included:e.target.checked})}/></td>
      <td className="px-2 py-2 font-medium text-ink">{r.productName}</td>
      <td className="px-2 py-2">{r.currentStock}</td><td className="px-2 py-2">{r.suggestedQty}</td>
      <td className="px-2 py-2"><Input type="number" min="0" step="1"
       aria-label={'Planned quantity for '+r.productName} className="w-20"
       disabled={!permitted||busy} value={r.plannedQty}
       onChange={e=>change(r.productId,{plannedQty:Math.max(0,Math.round(Number(e.target.value)||0))})}/></td>
      <td className="px-2 py-2"><select aria-label={'Supplier for '+r.productName}
        value={r.supplierId||''} disabled={!permitted||busy}
        onChange={e=>change(r.productId,{supplierId:e.target.value})}
        className="h-9 max-w-[180px] rounded-md border border-border bg-card px-2 text-xs text-ink">
       <option value="">Select supplier</option>
       {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
      </select></td>
      <td className="px-2 py-2 text-right">{money(r.lastPurchaseCost)}</td>
     </tr>)}</tbody>
    </table>
   </div>
   {!rows.length&&<p className="py-4 text-sm text-ink-500">No items need replenishment.</p>}
   <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
    <p className="text-xs text-ink-600">{selected.length} items · Estimated cost {money(selected.reduce((n,r)=>n+r.plannedQty*r.lastPurchaseCost,0))}</p>
    <Button disabled={!permitted||busy||!selected.length||selected.some(r=>!r.supplierId||r.lastPurchaseCost<=0)}
     onClick={()=>void act(()=>savePurchasePlan(selected.map(r=>({
      productId:r.productId,supplierId:r.supplierId,plannedQty:r.plannedQty,included:true
     }))),'Draft purchase plan saved')}>Save Purchase Plan</Button>
   </div>
  </div>
  <div className="rounded-xl border border-border bg-card p-3 shadow-card">
   <h2 className="mb-2 text-sm font-semibold text-ink">Saved Plans · সংরক্ষিত পরিকল্পনা</h2>
   {!plans.length?<p className="text-xs text-ink-500">No saved plans</p>:<div className="space-y-2">
    {plans.map(p=><div key={p.planId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
     <span><strong>{p.planNo}</strong> <span className="text-xs text-ink-500">{p.status} · {p.itemCount} items · {money(p.totalInvestment)}</span></span>
     {p.status==='Draft'&&permitted&&<Button size="sm" variant="outline" disabled={busy}
      onClick={()=>void act(()=>approvePurchasePlan(p.planId),'Approved and created supplier orders')}>
      Approve & Create Orders</Button>}
    </div>)}</div>}
  </div>
  <div className="rounded-xl border border-border bg-card p-3 shadow-card">
   <h2 className="mb-2 text-sm font-semibold text-ink">Supplier Orders · সরবরাহকারী অর্ডার</h2>
   {!orders.length?<p className="text-xs text-ink-500">No supplier purchase orders</p>:<div className="space-y-2">
    {orders.map(o=><div key={o.orderId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
     <div><strong>{o.orderNo}</strong> <span className="text-xs text-ink-500">{o.supplierName} · {o.status} · {o.totalQty} units</span>
      {o.convertedPurchaseId&&<div className="text-xs text-ink-500">Invoice: {o.convertedPurchaseId}</div>}</div>
     {o.status==='Open'&&permitted&&<Link to={'/app/purchases/new?orderId='+encodeURIComponent(o.orderId)}
       className="rounded-md border border-teal-600 px-3 py-2 text-xs font-semibold text-teal-700">
       Convert to Purchase</Link>}
    </div>)}</div>}
  </div>
  </>}
 </section>;
}
