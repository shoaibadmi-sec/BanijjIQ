import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Link,useNavigate} from 'react-router-dom';
import {ArrowLeft,Plus,RefreshCw,Search,Trash2} from 'lucide-react';
import {Button} from '../components/Button';
import {Input} from '../components/Input';
import {PageHeader} from '../components/PageHeader';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '../components/Table';
import {canUseModule,useBackendSession} from './BackendGate';
import {BackendRequestError,type BackendProduct} from './banijjApi';
import {createDuePurchase,getPurchaseProducts,getRealPurchases,searchPurchaseSuppliers,validateDuePurchase,
 type DuePurchaseLine,type PurchaseSupplier,type PurchaseRecord} from './purchaseApi';

type Line=DuePurchaseLine&{key:string};
const money=(value:number)=>'৳'+Number(value||0).toLocaleString('en-BD',{maximumFractionDigits:2});
const positive=(value:string)=>value!==''&&Number.isFinite(Number(value))&&Number(value)>=0;
const newLine=():Line=>({key:crypto.randomUUID(),productId:'',qty:1,unitPrice:0});

export function LivePurchasesPage(){
  const user=useBackendSession(),permitted=canUseModule(user,'purchase');
  const [items,setItems]=useState<PurchaseRecord[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [query,setQuery]=useState('');
  const refresh=useCallback(async()=>{
    if(!permitted)return;
    setLoading(true);setError('');
    try{setItems(await getRealPurchases());}
    catch(e){setItems([]);setError(e instanceof Error?e.message:'Cannot load purchases');}
    finally{setLoading(false);}
  },[permitted]);
  useEffect(()=>{void refresh();},[refresh]);
  const visible=useMemo(()=>items.filter(p=>(p.purchaseId+' '+p.supplierName+' '+p.purchaseDate)
    .toLocaleLowerCase().includes(query.toLocaleLowerCase())),[items,query]);
  if(!permitted)return <p role="alert" className="text-danger">Purchases permission required · ক্রয় দেখার অনুমতি নেই</p>;
  return <section className="mx-auto max-w-[1440px] space-y-4" data-live-purchases>
    <PageHeader title="Purchases" titleBn="ক্রয়" description="Real purchase invoices and supplier balances."
      actions={<div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={()=>void refresh()} disabled={loading}><RefreshCw className="size-4"/> Refresh</Button>
        {canUseModule(user,'purchase','add')&&<Button asChild size="sm"><Link to="/app/purchases/new"><Plus className="size-4"/> New Purchase</Link></Button>}
      </div>}/>
    <div className="flex items-center gap-2 border-b border-border text-sm">
      <span className="border-b-2 border-teal-600 px-3 py-2 font-semibold text-ink">Purchases</span>
      <span className="px-3 py-2 text-ink-500">Returns · Phase 4C</span>
      <span className="px-3 py-2 text-ink-500">Purchase Plans · Phase 4E</span>
    </div>
    <div className="rounded-xl border border-border bg-card p-3 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="relative min-w-[180px] max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-teal-600"/>
          <Input aria-label="Search saved purchases" value={query} onChange={e=>setQuery(e.target.value)}
            placeholder="Search invoice or supplier" className="pl-8"/>
        </div>
        <span className="text-xs text-ink-500">{visible.length} saved invoices</span>
      </div>
      {error&&<p role="alert" className="rounded-md bg-danger-bg p-3 text-sm text-danger">{error}</p>}
      {loading?<p role="status" className="py-8 text-center text-sm text-ink-500">Loading purchases…</p>:
       !error&&<div className="overflow-x-auto"><Table scrollRegionLabel="Purchase invoices" className="min-w-[660px]">
        <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Supplier</TableHead>
          <TableHead>Date</TableHead><TableHead className="text-right">Total</TableHead>
          <TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Due</TableHead>
        </TableRow></TableHeader>
        <TableBody>{visible.map(p=><TableRow key={p.purchaseId}>
          <TableCell className="text-sm font-medium">{p.purchaseId}</TableCell>
          <TableCell className="text-sm">{p.supplierName}</TableCell>
          <TableCell className="text-xs text-ink-600">{p.purchaseDate}</TableCell>
          <TableCell className="text-right">{money(p.grandTotal)}</TableCell>
          <TableCell className="text-right">{money(p.paidAmount)}</TableCell>
          <TableCell className="text-right">{money(p.dueAmount)}</TableCell>
        </TableRow>)}</TableBody></Table>
        {visible.length===0&&<p className="py-8 text-center text-sm text-ink-500">No purchases found · কোনো ক্রয় নেই</p>}
       </div>}
    </div>
  </section>;
}

export function LivePurchaseEditorPage(){
  const user=useBackendSession(),navigate=useNavigate();
  const permitted=canUseModule(user,'purchase','add');
  const [products,setProducts]=useState<BackendProduct[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [search,setSearch]=useState('');
  const [suggestions,setSuggestions]=useState<PurchaseSupplier[]>([]);
  const [chosen,setChosen]=useState<PurchaseSupplier|null>(null);
  const [open,setOpen]=useState(false);
  const [activeIndex,setActiveIndex]=useState(0);
  const [lines,setLines]=useState<Line[]>([newLine()]);
  const [saving,setSaving]=useState(false);
  const [outcomeUnknown,setOutcomeUnknown]=useState(false);
  const posting=useRef(false);
  useEffect(()=>{
    if(!permitted)return;
    let live=true;
    getPurchaseProducts().then(data=>{if(live)setProducts(data);})
      .catch(e=>{if(live)setError(e instanceof Error?e.message:'Products could not load');})
      .finally(()=>{if(live)setLoading(false);});
    return ()=>{live=false;};
  },[permitted]);
  useEffect(()=>{
    if(!permitted||!open)return;
    let live=true;
    const timer=setTimeout(()=>{
      searchPurchaseSuppliers(search).then(data=>{
        if(live){setSuggestions(data);setActiveIndex(0);}
      }).catch(e=>{if(live){setSuggestions([]);setError(e instanceof Error?e.message:'Supplier lookup failed');}});
    },130);
    return ()=>{live=false;clearTimeout(timer);};
  },[permitted,open,search]);
  const choose=(s:PurchaseSupplier)=>{setChosen(s);setSearch(s.name);setOpen(false);setError('');};
  const edit=(key:string,patch:Partial<Line>)=>setLines(before=>before.map(l=>l.key===key?{...l,...patch}:l));
  const total=useMemo(()=>lines.reduce((sum,l)=>sum+Number(l.qty||0)*Number(l.unitPrice||0),0),[lines]);
  const canPost=permitted&&!!chosen&&!chosen.needsReconciliation&&!loading&&!saving&&!outcomeUnknown;
  const productById=useMemo(()=>new Map(products.map(p=>[p.productId,p])),[products]);
  async function submit(){
    if(posting.current||!canPost)return;
    setError('');
    try{validateDuePurchase(chosen,lines);}catch(e){setError(e instanceof Error?e.message:'Invalid purchase');return;}
    posting.current=true;setSaving(true);
    try{
      // Refresh balances immediately before posting. Never trust a stale screen snapshot.
      const refreshed=await searchPurchaseSuppliers(chosen!.id);
      const supplier=refreshed.find(s=>s.id===chosen!.id);
      if(!supplier)throw new Error('Supplier no longer available.');
      setChosen(supplier);
      const result=await createDuePurchase(supplier,lines);
      if(!result.purchaseId)throw new Error('Purchase response missing invoice reference; verify Purchase History.');
      navigate('/app/purchases',{replace:true});
    }catch(e){
      setError(e instanceof Error?e.message:'Purchase failed');
      if(e instanceof BackendRequestError&&(e.status===null||e.status>=500))setOutcomeUnknown(true);
    }finally{posting.current=false;setSaving(false);}
  }
  if(!permitted)return <p role="alert" className="text-danger">Purchases add permission required · ক্রয় এন্ট্রির অনুমতি নেই</p>;
  return <section className="mx-auto max-w-[1200px] space-y-4" data-live-purchase-editor>
    <PageHeader title="New Purchase" titleBn="নতুন ক্রয়" compact
      description="Phase 4A: saved supplier and base-unit due purchase only."
      actions={<Button variant="outline" size="sm" onClick={()=>navigate('/app/purchases')}><ArrowLeft className="size-4"/> Purchase list</Button>}/>
    {error&&<p role="alert" className="rounded-lg bg-danger-bg p-3 text-sm text-danger">{error}</p>}
    {outcomeUnknown&&<div role="alert" className="rounded-lg border border-warning bg-warning-bg p-3 text-sm text-warning">
      Network/server outcome uncertain. Check Purchase History for the supplier and products before any retry.
      <Button variant="outline" size="sm" className="ml-2" onClick={()=>navigate('/app/purchases')}>Check Purchase History</Button>
    </div>}
    <div className="rounded-xl border border-border bg-card p-3 shadow-card">
      <h2 className="mb-3 text-sm font-semibold text-ink">Supplier · সরবরাহকারী</h2>
      <div className="relative max-w-lg">
        <Input value={search} aria-label="Search supplier name, phone or ID"
          role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls="phase4-supplier-options"
          onFocus={()=>setOpen(true)}
          onChange={e=>{setSearch(e.target.value);setChosen(null);setOpen(true);}}
          onKeyDown={e=>{
            if(!open)return;
            if(e.key==='ArrowDown'){e.preventDefault();setActiveIndex(i=>Math.min(i+1,suggestions.length-1));}
            if(e.key==='ArrowUp'){e.preventDefault();setActiveIndex(i=>Math.max(0,i-1));}
            if(e.key==='Escape'){e.preventDefault();setOpen(false);}
            if(e.key==='Enter'&&suggestions[activeIndex]){e.preventDefault();choose(suggestions[activeIndex]);}
          }}
          placeholder="Find supplier · নাম বা মোবাইল নম্বর"/>
        {open&&<div id="phase4-supplier-options" role="listbox" aria-label="Saved suppliers"
          className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg">
          {suggestions.map((s,i)=><button key={s.id} type="button" role="option" aria-selected={i===activeIndex}
            onMouseDown={e=>e.preventDefault()} onClick={()=>choose(s)}
            className={'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-teal-50 '+(i===activeIndex?'bg-teal-50':'')}>
            <span className="min-w-0 truncate">{s.name}<span className="ml-2 text-xs text-ink-500">{s.phone}</span></span>
            <span className="shrink-0 text-xs text-ink-600">{money(s.currentDue)}</span>
          </button>)}
          {suggestions.length===0&&<p className="px-3 py-2 text-xs text-ink-500">No saved suppliers found</p>}
        </div>}
      </div>
      {chosen&&<div className="mt-3 flex flex-wrap gap-2 text-sm">
        <span className="rounded-md bg-ink-50 px-3 py-2 text-ink">Existing due · আগের দেনা: <strong>{money(chosen.currentDue)}</strong></span>
        {chosen.needsReconciliation&&<span role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-danger">
          Ledger mismatch — posting disabled; reconcile supplier ledger
        </span>}
      </div>}
    </div>
    <div className="rounded-xl border border-border bg-card p-3 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Products · পণ্য</h2>
        <Button variant="outline" size="sm" onClick={()=>setLines(v=>[...v,newLine()])} disabled={saving||outcomeUnknown}>
          <Plus className="size-4"/> Add line</Button>
      </div>
      {loading?<p role="status" className="py-6 text-center text-sm">Loading real products…</p>:
      <div className="overflow-x-auto">
        <Table scrollRegionLabel="Purchase entry lines" className="min-w-[620px]">
          <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Stock unit</TableHead>
            <TableHead>Quantity</TableHead><TableHead>Unit cost ৳</TableHead>
            <TableHead className="text-right">Total</TableHead><TableHead className="w-9"> </TableHead>
          </TableRow></TableHeader>
          <TableBody>{lines.map(l=><TableRow key={l.key}>
            <TableCell><select aria-label="Product" value={l.productId}
              onChange={e=>{const p=productById.get(e.target.value);edit(l.key,{productId:e.target.value,unitPrice:Number(p?.purchasePrice||0)});}}
              className="h-9 w-full min-w-[190px] rounded-md border border-border bg-card px-2 text-sm text-ink">
                <option value="">Choose product…</option>
                {products.map(p=><option key={p.productId} value={p.productId}>{p.displayName||p.productName}</option>)}
              </select></TableCell>
            <TableCell className="text-xs">{productById.get(l.productId)?.unit||'—'}</TableCell>
            <TableCell><Input aria-label="Purchase quantity" type="number" min="0.0001" step="0.0001"
              value={l.qty} onChange={e=>edit(l.key,{qty:e.target.value===''?0:Number(e.target.value)})}
              className="w-24"/></TableCell>
            <TableCell><Input aria-label="Purchase unit cost" type="number" min="0" step="0.0001"
              value={l.unitPrice} onChange={e=>edit(l.key,{unitPrice:e.target.value===''?0:Number(e.target.value)})}
              className="w-28"/></TableCell>
            <TableCell className="text-right text-sm">{positive(String(l.qty))&&positive(String(l.unitPrice))?money(l.qty*l.unitPrice):'—'}</TableCell>
            <TableCell><Button size="icon" variant="ghost" title="Remove line" aria-label="Remove purchase line"
              onClick={()=>setLines(before=>before.filter(x=>x.key!==l.key))} disabled={saving||outcomeUnknown}>
              <Trash2 className="size-4"/></Button></TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </div>}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-border pt-3">
        <div className="text-xs text-ink-500">Base stock units only. Multi-unit buying and paid tender are locked until Phases 4B/4D.</div>
        <div className="text-right"><p className="text-xs text-ink-600">Supplier payable for this purchase</p>
          <p className="text-xl font-semibold text-ink">{Number.isFinite(total)?money(total):'—'}</p>
          <Button className="mt-2" disabled={!canPost||!lines.length||!products.length}
            onClick={()=>void submit()}>{saving?'Posting…':'Confirm Due Purchase · বাকি ক্রয় নিশ্চিত'}</Button>
        </div>
      </div>
    </div>
  </section>;
}
