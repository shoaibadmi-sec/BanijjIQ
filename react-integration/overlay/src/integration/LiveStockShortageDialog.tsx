import { useEffect, useState } from 'react';
import { AlertTriangle, PackageCheck, TrendingDown, Truck } from 'lucide-react';
import { Button } from '../components/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/Dialog';
import { Input } from '../components/Input';
import { createPosVendor, type PosVendor } from './banijjApi';

export type ShortageSelection =
  | {mode:'own'}
  | {mode:'negative'}
  | {mode:'vendor';vendorId:string;vendorUnitCost:number};

export function LiveStockShortageDialog({open,onOpenChange,name,qty,stock,vendors,onApply,onVendorCreated}:{
  open:boolean;onOpenChange:(open:boolean)=>void;name:string;qty:number;stock:number;
  vendors:PosVendor[];onApply:(selection:ShortageSelection,clampedQty:number)=>void;
  onVendorCreated:(vendor:PosVendor)=>void
}) {
  const [choice,setChoice]=useState<'own'|'negative'|'vendor'>('own');
  const [vendorId,setVendorId]=useState('');
  const [vendorCost,setVendorCost]=useState('');
  const [vendorsLocal,setVendorsLocal]=useState<PosVendor[]>([]);
  const [newName,setNewName]=useState('');
  const [newPhone,setNewPhone]=useState('');
  const [adding,setAdding]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{if(open){setChoice('own');setVendorCost('');setVendorId('');
    setVendorsLocal(vendors);setError('');setNewName('');setNewPhone('');}},[open]);
  const allVendors=vendorsLocal;
  const shortage=Math.max(0,qty-Math.max(0,stock));
  const unitCost=Number(vendorCost);
  const choose=()=>{
    if(choice==='own'){onApply({mode:'own'},Math.max(0,Math.min(qty,stock)));return;}
    if(choice==='negative'){onApply({mode:'negative'},qty);return;}
    if(!vendorId || !vendorCost.trim() || !Number.isFinite(unitCost) || unitCost<0){
      setError('Choose a vendor and enter the agreed unit cost.');return;
    }
    onApply({mode:'vendor',vendorId,vendorUnitCost:unitCost},qty);
  };
  const addVendor=async()=>{
    if(!newName.trim())return setError('Vendor name is required.');
    if(adding)return;
    setAdding(true);setError('');
    try{
      const result=await createPosVendor(newName.trim(),newPhone.trim());
      setVendorsLocal(existing=>[...existing,result.vendor]);
      onVendorCreated(result.vendor);
      setVendorId(result.vendor.id);setNewName('');setNewPhone('');
    }catch(e){setError(e instanceof Error?e.message:'Could not save vendor');}
    finally{setAdding(false);}
  };
  return <Dialog open={open} onOpenChange={v=>!adding&&onOpenChange(v)}>
    <DialogContent role="dialog" aria-modal="true" aria-label="Stock shortage" className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Stock shortage <span className="font-bn text-sm font-normal text-ink-500">· স্টক কম</span></DialogTitle>
        <DialogDescription>{name}: requested {qty}, own sellable stock {stock}.
          Choose how to handle {shortage} shortage.</DialogDescription>
      </DialogHeader>
      <div className="space-y-2" role="radiogroup" aria-label="Stock shortage method">
        {([
          {id:'own',label:'Own Stock',bn:'নিজের স্টক',hint:stock>0?'Reduce this line to '+stock+'.':'Remove this line.',Icon:PackageCheck},
          {id:'negative',label:'Negative Sale',bn:'নেগেটিভ বিক্রি',hint:'The shortage remains negative until stock is received.',Icon:TrendingDown},
          {id:'vendor',label:'Vendor',bn:'ভেন্ডর থেকে',hint:'Source only the shortage from a real vendor.',Icon:Truck}
        ] as const).map(({id,label,bn,hint,Icon})=>
          <button key={id} type="button" role="radio" aria-checked={choice===id}
            onClick={()=>setChoice(id)} className={'flex w-full items-start gap-3 rounded-xl border p-3 text-left '+
              (choice===id?'border-teal-400 bg-teal-50/60':'border-border hover:bg-ink-50')}>
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-card text-teal-700 ring-1 ring-border"><Icon className="size-4"/></span>
            <span><span className="block text-sm font-medium text-ink">{label} <span className="font-bn text-xs font-normal text-ink-400">· {bn}</span></span>
              <span className="block text-xs text-ink-500">{hint}</span></span>
          </button>)}
      </div>
      {choice==='vendor'&&<div className="space-y-3 rounded-xl border border-border bg-ink-50/30 p-3">
        <label className="block text-xs text-ink-600">Vendor · কাছের দোকান
          <select aria-label="Select live vendor" value={vendorId} onChange={e=>setVendorId(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-ink">
            <option value="">Choose Vendor</option>{allVendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label className="block text-xs text-ink-600">Vendor cost per {name} unit
          <Input type="number" min="0" step="0.01" value={vendorCost}
            onChange={e=>setVendorCost(e.target.value)} aria-label="Vendor unit cost" className="mt-1 h-9"/>
        </label>
        <div className="border-t border-border pt-2">
          <p className="mb-1 text-xs font-medium text-ink">Quick add live Vendor · নতুন ভেন্ডর</p>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Vendor name" aria-label="New vendor name" value={newName} onChange={e=>setNewName(e.target.value)} className="h-9"/>
            <Input placeholder="Phone" aria-label="New vendor phone" value={newPhone} onChange={e=>setNewPhone(e.target.value)} className="h-9"/>
          </div>
          <Button size="sm" variant="outline" className="mt-2" disabled={adding||!newName.trim()} onClick={()=>void addVendor()}>
            {adding?'Saving…':'+ Add & select vendor'}
          </Button>
        </div>
      </div>}
      <p className="flex gap-2 rounded-lg bg-ink-50 p-2.5 text-xs text-ink-500">
        <AlertTriangle className="size-3.5 shrink-0 text-warning"/>
        This choice applies only to the cart line. Quantity changes require another review.
      </p>
      {error&&<p className="text-xs text-danger" role="alert">{error}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button>
        <Button disabled={adding} onClick={choose}>
          {choice==='own'?'Use own stock':choice==='negative'?'Allow negative sale':'Use vendor'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
