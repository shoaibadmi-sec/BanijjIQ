import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, Loader2, MoreHorizontal } from 'lucide-react';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/Dialog';
import type { BackendProduct } from '../banijjApi';
import type { LiveLot, StockMovement } from './productApi';
import { productActionPolicy } from './productForm';

type Panel='view'|'adjust'|'lots'|'history'|null;
type Props={
 product:BackendProduct;canEdit:boolean;onEdit:()=>void;onChanged:()=>void;
 onAdjustStock:(productId:string,delta:number,note:string)=>Promise<unknown>;
 onSetStatus:(productId:string,status:'Active'|'Inactive')=>Promise<unknown>;
 loadLots:(productId:string)=>Promise<LiveLot[]>;
 loadHistory:(productId:string)=>Promise<StockMovement[]>;
};
const format=(v:number)=>v.toLocaleString('en-BD',{maximumFractionDigits:4});
export function MohimProductActions({
 product,canEdit,onEdit,onChanged,onAdjustStock,onSetStatus,loadLots,loadHistory
}:Props){
 const policy=productActionPolicy(product,canEdit);
 const [open,setOpen]=useState(false),[panel,setPanel]=useState<Panel>(null);
 const [delta,setDelta]=useState(''),[reason,setReason]=useState('');
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
 const [error,setError]=useState(''),[lots,setLots]=useState<LiveLot[]>([]);
 const [history,setHistory]=useState<StockMovement[]>([]);
 const menuRef=useRef<HTMLDivElement>(null),buttonRef=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
   if(!open)return;
   const handler=(e:PointerEvent)=>{
     if(menuRef.current&&!menuRef.current.contains(e.target as Node))setOpen(false);
   };
   const key=(e:KeyboardEvent)=>{
     if(e.key==='Escape'){setOpen(false);buttonRef.current?.focus();}
   };
   document.addEventListener('pointerdown',handler);document.addEventListener('keydown',key);
   return()=>{document.removeEventListener('pointerdown',handler);document.removeEventListener('keydown',key);};
 },[open]);
 const show=async(next:Exclude<Panel,null>)=>{
   setOpen(false);setPanel(next);setError('');setDelta('');setReason('');
   if(next!=='lots'&&next!=='history')return;
   setLoading(true);
   try {
     if(next==='lots')setLots(await loadLots(product.productId));
     else setHistory(await loadHistory(product.productId));
   } catch(e){setError(e instanceof Error?e.message:'Could not load product details');}
   finally{setLoading(false);}
 };
 const adjust=async(e:FormEvent<HTMLFormElement>)=>{
   e.preventDefault();
   const n=Number(delta);
   if(!delta.trim()||!Number.isFinite(n)||n===0||Math.abs(n*10000-Math.round(n*10000))>0.00001){
     setError('Enter a non-zero stock change, up to four decimal places.');return;
   }
   if(!reason.trim()){setError('Reason for adjustment is required.');return;}
   const next=Number(product.currentStock)+n;
   if(next<0){setError('Stock cannot become negative using this adjustment.');return;}
   if(!window.confirm('Confirm stock change: '+format(product.currentStock)+' → '+format(next)+' '+product.unit+'?\nReason: '+reason.trim()))return;
   setBusy(true);setError('');
   try {
     await onAdjustStock(product.productId,n,reason.trim());
     setPanel(null);onChanged();
   }catch(e){setError(e instanceof Error?e.message:'Could not adjust stock. Confirm the current balance before retrying.');}
   finally{setBusy(false);}
 };
 const toggle=async()=>{
   const next=product.status==='Inactive'?'Active':'Inactive';
   setOpen(false);
   if(!window.confirm(next+' '+product.productName+'?'))return;
   setBusy(true);setError('');
   try{await onSetStatus(product.productId,next);onChanged();}
   catch(e){setError(e instanceof Error?e.message:'Could not change product status.');setPanel('view');}
   finally{setBusy(false);}
 };
 const deferred=[policy.addLot,policy.offers,policy.delete,policy.bundle];
 return <div ref={menuRef} className="relative inline-flex text-left" data-mohim-product-actions>
   <Button ref={buttonRef} size="sm" variant="outline" disabled={busy} aria-label={'Actions for '+product.productName}
     aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(s=>!s)}>
     {busy?<Loader2 className="size-3.5 animate-spin"/>:<MoreHorizontal className="size-3.5"/>}
     Actions <ChevronDown className="size-3"/>
   </Button>
   {open&&<div role="menu" aria-label={'Actions for '+product.productName}
     className="absolute right-0 top-full z-40 mt-1 w-52 rounded-lg border border-border bg-card p-1 shadow-pop">
     <button role="menuitem" type="button" className="block w-full rounded px-3 py-2 text-left text-xs text-ink hover:bg-ink-50"
       onClick={()=>void show('view')}>View · দেখুন</button>
     <button role="menuitem" type="button" disabled={!policy.edit}
       className="block w-full rounded px-3 py-2 text-left text-xs text-ink hover:bg-ink-50 disabled:opacity-40"
       onClick={()=>{setOpen(false);onEdit();}}>Edit · সংশোধন</button>
     <button role="menuitem" type="button" disabled={!policy.adjustStock}
       className="block w-full rounded px-3 py-2 text-left text-xs text-ink hover:bg-ink-50 disabled:opacity-40"
       onClick={()=>void show('adjust')}>Adjust stock · স্টক ঠিক করুন</button>
     <button role="menuitem" type="button" disabled={!policy.lots}
       className="block w-full rounded px-3 py-2 text-left text-xs text-ink hover:bg-ink-50 disabled:opacity-40"
       onClick={()=>void show('lots')}>Stock lots · স্টক লট</button>
     <button role="menuitem" type="button" disabled={!policy.history}
       className="block w-full rounded px-3 py-2 text-left text-xs text-ink hover:bg-ink-50 disabled:opacity-40"
       onClick={()=>void show('history')}>Stock history · হিস্ট্রি</button>
     <button role="menuitem" type="button" disabled={!policy.toggleStatus}
       className="block w-full rounded px-3 py-2 text-left text-xs text-ink hover:bg-ink-50 disabled:opacity-40"
       onClick={()=>void toggle()}>{product.status==='Inactive'?'Activate':'Deactivate'} · অবস্থা</button>
     <div className="my-1 border-t border-border"/>
     {deferred.map((item,i)=><button key={i} disabled role="menuitem" type="button"
       title={item.reason} className="block w-full cursor-not-allowed rounded px-3 py-1.5 text-left text-xs text-ink-400">
       {['Add purchase lot','Offers','Delete','Edit bundle'][i]} · Not available
     </button>)}
   </div>}
   <Dialog open={panel!==null} onOpenChange={next=>{if(!next&&!busy)setPanel(null);}}>
     <DialogContent className="max-h-[85vh] w-[min(94vw,580px)] overflow-y-auto" aria-label={product.productName+' details'}>
       <DialogTitle>{panel==='adjust'?'Adjust stock · স্টক ঠিক করুন':
        panel==='lots'?'Stock lots · স্টক লট':panel==='history'?'Stock history · স্টক হিস্ট্রি':
        'Product details · পণ্যের তথ্য'}</DialogTitle>
       <DialogDescription>{product.productName} · {product.productId}</DialogDescription>
       {error&&<p role="alert" className="rounded-lg bg-danger-bg p-2 text-sm text-danger">{error}</p>}
       {panel==='view'&&<dl className="grid grid-cols-2 gap-3 text-sm">
         {[
           ['Product',product.productName],['Category',product.category],
           ['Brand',product.brand||'—'],['Unit',product.unit],
           ['Current stock',format(product.currentStock)],['Sellable stock',product.sellableStock==null?'Not reported':format(product.sellableStock)],
           ['Purchase price','৳'+format(product.purchasePrice)],['Selling price','৳'+format(product.sellingPrice)],
           ['Status',product.status],['Barcode',product.barcode||'—']
         ].map(([k,v])=><div key={k}><dt className="text-xs text-ink-500">{k}</dt><dd className="font-medium text-ink">{v}</dd></div>)}
       </dl>}
       {panel==='adjust'&&<form onSubmit={e=>void adjust(e)} className="space-y-3">
         <p className="text-sm text-ink-600">Current stock: <strong>{format(product.currentStock)} {product.unit}</strong></p>
         <label className="block text-xs font-medium text-ink-700">Change quantity (use − to remove)
           <Input type="number" step="0.0001" min={-1000000000} aria-label="Stock change" required
             className="mt-1 h-9 w-full" value={delta} onChange={e=>setDelta(e.target.value)} disabled={busy}/>
         </label>
         {delta&&Number.isFinite(Number(delta))&&<p className="text-xs text-ink-600">
           New quantity: <strong>{format(product.currentStock+Number(delta))} {product.unit}</strong>
         </p>}
         <label className="block text-xs font-medium text-ink-700">Reason · কারণ
           <Input aria-label="Adjustment reason" required className="mt-1 h-9 w-full"
             value={reason} onChange={e=>setReason(e.target.value)} disabled={busy}/>
         </label>
         <p className="text-xs text-ink-500">Tracked stock removal is restricted; purchase lots and costs are not changed here.</p>
         <Button disabled={busy} type="submit">{busy?'Saving…':'Review and save adjustment'}</Button>
       </form>}
       {loading&&<p role="status" className="text-sm text-ink-500">Loading live records…</p>}
       {!loading&&panel==='lots'&&<div className="space-y-2 text-xs">
         {!lots.length&&<p>No stock lots recorded.</p>}
         {lots.map(l=><div key={l.lotId} className="flex justify-between gap-3 rounded-lg border border-border p-3">
           <span className="min-w-0"><strong className="block truncate">{l.lotId}</strong>
             <small className="text-ink-500">{l.purchaseId||'Opening / adjustment'} · {l.purchaseDate}</small></span>
           <span className="shrink-0 text-right"><strong>{format(l.remainingQuantity)} / {format(l.originalQuantity)}</strong>
             <small className="block text-ink-500">৳{format(l.purchasePrice)} per {product.unit}</small></span>
         </div>)}
       </div>}
       {!loading&&panel==='history'&&<div className="space-y-2 text-xs">
         {!history.length&&<p>No recorded stock movements.</p>}
         {history.map(h=><div key={h.movementId} className="flex justify-between gap-3 rounded-lg border border-border p-3">
           <span className="min-w-0"><strong className="block">{h.type}</strong>
             <span className="block text-ink-500">{h.date} · {h.note||'—'}</span>
             <small className="block truncate text-ink-400">{h.movementId}</small></span>
           <span className="shrink-0 text-right font-medium">{h.quantityIn>0?'+':''}{format(h.quantityIn-h.quantityOut)}
             <small className="block text-ink-500">Balance {format(h.balanceAfter)}</small></span>
         </div>)}
       </div>}
     </DialogContent>
   </Dialog>
 </div>;
}
