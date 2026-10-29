import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ChevronDown,Plus,Save,Trash2} from 'lucide-react';
import {Button} from '../../components/Button';
import {Input} from '../../components/Input';
import {BackendRequestError,getProductUnitProfile,updateProductUnitProfile,
  type BackendProduct,type ProductUnitProfile,type UnitProfileDraft} from '../banijjApi';
import type {Lookup} from './productContracts';

type Row={unit:string;symbol:string;containsNext:string;sellingPrice:string};
const fromProfile=(profile:ProductUnitProfile):Row[]=>profile.units.map(u=>({
  unit:u.unit,symbol:u.symbol,containsNext:u.containsNext===null?'':String(u.containsNext),
  sellingPrice:String(u.sellingPrice)
}));
const symbolOf=(name:string,units:Lookup[])=>units.find(x=>x.name.toLowerCase()===name.toLowerCase())?.symbol?.trim()
  ||name.replace(/[^a-zA-Z0-9\u0980-\u09ff]/g,'').slice(0,5).toUpperCase();
const blank=(product:BackendProduct,units:Lookup[]):Row[]=>[
  {unit:'',symbol:'',containsNext:'',sellingPrice:''},
  {unit:product.unit,symbol:symbolOf(product.unit,units),containsNext:'',sellingPrice:String(product.sellingPrice)}
];
export function LiveProductUnitSettings({product,units}:{product:BackendProduct;units:Lookup[]}){
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [revision,setRevision]=useState(0);
  const [rows,setRows]=useState<Row[]>(()=>blank(product,units));
  const [original,setOriginal]=useState<Row[]|null>(null);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');
  const [uncertain,setUncertain]=useState(false);
  const inFlight=useRef(false);
  const dirty=original!==null&&JSON.stringify(original)!==JSON.stringify(rows);
  const load=async(discard=false)=>{
    if(inFlight.current)return;
    if(discard&&dirty&&!window.confirm('Discard unsaved unit changes?'))return;
    setLoading(true);setError('');setSuccess('');
    try{
      const saved=await getProductUnitProfile(product.productId);
      const next=saved.profile?fromProfile(saved.profile):blank(product,units);
      setRows(next);setOriginal(next);setRevision(saved.revision);setUncertain(false);
    }catch(e){setError(e instanceof Error?e.message:'Could not load the live unit chain.');}
    finally{setLoading(false);}
  };
  useEffect(()=>{void load();},[product.productId]);
  const change=(i:number,key:keyof Row,value:string)=>{setSuccess('');
    setRows(old=>old.map((r,j)=>i===j?{...r,[key]:value}:r));};
  const chooseUnit=(i:number,name:string)=>{setSuccess('');setRows(old=>old.map((r,j)=>
    i===j?{...r,unit:name,symbol:symbolOf(name,units)}:r));};
  const submit=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();
    if(inFlight.current||uncertain||loading)return;
    const invalid=rows.some((r,i)=>!r.unit.trim()||!r.symbol.trim()||
      (i<rows.length-1&&(!/^\d+$/.test(r.containsNext)||Number(r.containsNext)<2))||
      (r.sellingPrice.trim()!==''&&(!Number.isFinite(Number(r.sellingPrice))||Number(r.sellingPrice)<0)));
    if(invalid){setError('Enter each unit, short symbol and whole-number conversion (minimum 2).');return;}
    const payload:UnitProfileDraft={expectedRevision:revision,units:rows.map((r,i)=>({
      unit:r.unit.trim(),symbol:r.symbol.trim(),
      ...(i<rows.length-1?{containsNext:Number(r.containsNext)}:{}),
      ...(r.sellingPrice.trim()!==''?{sellingPrice:Number(r.sellingPrice)}:{})
    }))};
    inFlight.current=true;setSaving(true);setError('');setSuccess('');
    try{
      const saved=await updateProductUnitProfile(product.productId,payload);
      const next=fromProfile(saved.profile);
      setRevision(saved.revision);setRows(next);setOriginal(next);
      setSuccess('Unit chain saved · একক সংরক্ষিত');
    }catch(e){
      if(e instanceof BackendRequestError&&(e.status===null||e.status>=500)){
        setUncertain(true);
        setError('Save result uncertain. Verify the saved chain before editing again. '+e.message);
      }else if(e instanceof BackendRequestError&&e.status===409){
        setError('Another change was saved. Reload the unit chain before editing.');
      }else setError(e instanceof Error?e.message:'Could not save units.');
    }finally{inFlight.current=false;setSaving(false);}
  };
  return <section data-live-unit-settings className="rounded-xl border border-border bg-card shadow-card">
    <button type="button" aria-expanded={open} aria-controls="product-unit-settings-fields"
      onClick={()=>setOpen(v=>!v)}
      className="flex min-h-12 w-full items-center justify-between gap-2 p-4 text-left">
      <span><strong className="block text-sm text-ink">Multiple units · একাধিক একক</strong>
        <span className="mt-0.5 block text-[11px] text-ink-500">
          {loading?'Loading saved units…':revision?rows.map(x=>x.symbol).join(' · '):
            'Set 2–4 selling units for this product'}
        </span>
      </span>
      <ChevronDown className={'size-4 text-ink-500 '+(open?'rotate-180':'')}/>
    </button>
    <div id="product-unit-settings-fields" hidden={!open} className="border-t border-border p-4">
      <p className="mb-3 text-xs text-ink-600">Largest to smallest. Inventory stays in <strong>{product.unit}</strong>.
        <span className="font-bn"> · বড় থেকে ছোট একক; মজুদ ছোট এককে</span></p>
      {loading?<p role="status" className="text-xs text-ink-500">Reading saved units…</p>:
      <form onSubmit={submit} className="space-y-3">
        {rows.map((r,i)=><div key={i} className="grid grid-cols-[minmax(0,1fr)_62px_77px_86px] gap-1.5 sm:grid-cols-[minmax(0,1fr)_90px_110px_125px]">
          <label className="min-w-0 text-[11px] text-ink-600">Unit · একক
            <Input aria-label={'Unit '+(i+1)} list="chain-unit-choices" readOnly={i===rows.length-1}
              disabled={saving||uncertain} value={r.unit} onChange={e=>chooseUnit(i,e.target.value)}
              className="mt-1 h-9 min-w-0 w-full px-1 text-[12px] font-normal"/>
          </label>
          <label className="min-w-0 text-[11px] text-ink-600">Short · সংক্ষিপ্ত
            <Input aria-label={'Short symbol '+(i+1)} maxLength={8} disabled={saving||uncertain}
              value={r.symbol} onChange={e=>change(i,'symbol',e.target.value)}
              className="mt-1 h-9 min-w-0 w-full px-1 text-center text-[12px] font-normal"/>
          </label>
          <label className="min-w-0 text-[11px] text-ink-600">{i===rows.length-1?'Base':'Contains'}
            <Input type="number" inputMode="numeric" aria-label={'Contains next '+(i+1)}
              min="2" step="1" placeholder={i===rows.length-1?'1':'0'}
              disabled={i===rows.length-1||saving||uncertain} value={r.containsNext}
              onChange={e=>change(i,'containsNext',e.target.value)}
              className="mt-1 h-9 min-w-0 w-full px-1 text-right text-[12px] font-normal"/>
          </label>
          <label className="min-w-0 text-[11px] text-ink-600">Price ৳
            <Input type="number" inputMode="decimal" min="0" step="0.01"
              aria-label={'Selling price for '+(r.unit||'unit '+(i+1))}
              placeholder={i===rows.length-1?String(product.sellingPrice):'Auto'}
              disabled={saving||uncertain} value={r.sellingPrice}
              onChange={e=>change(i,'sellingPrice',e.target.value)}
              className="mt-1 h-9 min-w-0 w-full px-1 text-right text-[12px] font-normal"/>
          </label>
        </div>)}
        <datalist id="chain-unit-choices">{units.map(x=><option key={x.id} value={x.name}/>)}</datalist>
        <p className="text-[11px] text-ink-500">Contains = number of the next smaller unit in one larger unit. · ১ বড় এককে কত ছোট একক</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={saving||uncertain||rows.length>=4}
            onClick={()=>{setRows(old=>[{unit:'',symbol:'',containsNext:'',sellingPrice:''},...old]);setSuccess('');}}>
            <Plus className="size-3.5"/> Add larger unit
          </Button>
          {rows.length>2&&<Button type="button" size="sm" variant="outline" disabled={saving||uncertain}
            onClick={()=>{setRows(old=>old.slice(1));setSuccess('');}}>
            <Trash2 className="size-3.5"/> Remove largest
          </Button>}
          <span className="ml-auto text-[11px] text-ink-500">{rows.length}/4 · Rev {revision}</span>
        </div>
        {error&&<p role="alert" className="rounded-lg bg-danger-bg p-2 text-xs text-danger">{error}</p>}
        {success&&<p role="status" className="text-xs text-success">{success}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={()=>void load(true)}>
            {uncertain?'Verify saved units':'Reload'}
          </Button>
          <Button type="submit" disabled={!dirty||saving||uncertain}>
            <Save className="size-3.5"/>{saving?'Saving…':'Save units · একক সংরক্ষণ'}
          </Button>
        </div>
        <p className="text-[11px] text-ink-500">Changing conversions does not change existing inventory or posted invoices. Older sales retain their original unit prices.</p>
      </form>}
    </div>
  </section>;
}