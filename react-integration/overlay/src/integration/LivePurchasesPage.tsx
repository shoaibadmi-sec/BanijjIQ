import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Link,useNavigate,useSearchParams} from 'react-router-dom';
import {LiveMixedPurchaseReturns} from './LiveMixedPurchaseReturns';
import {LiveStandardPurchaseReturns} from './LiveStandardPurchaseReturns';
import {LiveSupplierSettlements} from './LiveSupplierSettlements';
import {LivePurchasePlans} from './LivePurchasePlans';
import {ArrowLeft,Plus,RefreshCw,Search,Trash2} from 'lucide-react';
import {Button} from '../components/Button';
import {Input} from '../components/Input';
import {PageHeader} from '../components/PageHeader';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '../components/Table';
import {BillDetailDialog,type BillDetail} from '../components/purchases/BillDetailDialog';
import {canUseModule,useBackendSession} from './BackendGate';
import {BackendRequestError,type BackendProduct,type PosProfilePreview} from './banijjApi';
import {LiveMultiUnitQuantity} from './LiveMultiUnitQuantity';
import {createDuePurchase,createPurchaseWithPayment,getPurchaseProducts,getRealPurchases,getRealPurchaseDetail,getPurchaseUnitProfile,getOrderToPurchase,loadSupplierSettlements,quotePurchaseLine,searchPurchaseSuppliers,validateDuePurchase,validatePurchasePayment,
 type DuePurchaseLine,type PurchaseSupplier,type PurchaseRecord,type PurchaseTender,type SettlementDetails} from './purchaseApi';

type Line=DuePurchaseLine&{key:string;profile?:PosProfilePreview|null;profileBusy?:boolean;profileError?:string};
const money=(value:number)=>'৳'+Number(value||0).toLocaleString('en-BD',{maximumFractionDigits:4});
const positive=(value:string)=>value!==''&&Number.isFinite(Number(value))&&Number(value)>=0;
const newLine=():Line=>({key:crypto.randomUUID(),productId:'',qty:1,unitPrice:0});

export function LivePurchasesPage(){
  const user=useBackendSession(),permitted=canUseModule(user,'purchase');
  const navigate=useNavigate();
  const [params]=useSearchParams();
  const tab=params.get('tab')==='return'?'return':params.get('tab')==='payments'?'payments':params.get('tab')==='plans'?'plans':'purchases';
  const [items,setItems]=useState<PurchaseRecord[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [query,setQuery]=useState('');
  const [invoice,setInvoice]=useState<BillDetail|null>(null);
  const [invoiceLoading,setInvoiceLoading]=useState('');
  const [invoiceError,setInvoiceError]=useState('');
  const invoiceSequence=useRef(0);
  async function viewInvoice(id:string){
    const sequence=++invoiceSequence.current;
    setInvoice(null);setInvoiceError('');setInvoiceLoading(id);
    try{
      const source=await getRealPurchaseDetail(id);
      if(sequence!==invoiceSequence.current)return;
      if(!source.items.length)throw Error('Purchase invoice has no recorded source lines.');
      const description=source.items.map(line=>
        line.productName+' · '+(line.unitDescription||String(line.quantity)+' base units')+
        ' · '+money(line.unitPrice)+'/unit · '+money(line.lineTotal)).join('; ')+
        (source.returnedAmount>0
          ?' · Returns recorded: '+money(source.returnedAmount)+' (original bill amounts shown)':'');
      setInvoice({ref:source.purchaseId,date:source.purchaseDate,
        party:source.supplierName,description,
        total:source.grandTotal,paid:source.paidAmount});
    }catch(e){
      if(sequence===invoiceSequence.current)
        setInvoiceError(e instanceof Error?e.message:'Cannot load purchase invoice');
    }finally{
      if(sequence===invoiceSequence.current)setInvoiceLoading('');
    }
  }
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
        {canUseModule(user,'purchase','add')&&<Button size="sm" onClick={()=>navigate('/app/purchases/new')}>
          <Plus className="size-4"/> New Purchase
        </Button>}
      </div>}/>
    <nav aria-label="Purchase sections" className="flex items-center gap-2 overflow-x-auto whitespace-nowrap border-b border-border text-sm">
      <Link to="/app/purchases" className={'px-3 py-2 '+(tab==='purchases'?'border-b-2 border-teal-600 font-semibold text-ink':'text-ink-500')}>Purchases · ক্রয়</Link>
      <Link to="/app/purchases?tab=return" className={'px-3 py-2 '+(tab==='return'?'border-b-2 border-teal-600 font-semibold text-ink':'text-ink-500')}>Purchase Return · ক্রয় ফেরত</Link>
      <Link to="/app/purchases?tab=payments" className={'px-3 py-2 '+(tab==='payments'?'border-b-2 border-teal-600 font-semibold text-ink':'text-ink-500')}>Supplier Payments · টাকা পরিশোধ</Link>
      <Link to="/app/purchases?tab=plans" className={'px-3 py-2 '+(tab==='plans'?'border-b-2 border-teal-600 font-semibold text-ink':'text-ink-500')}>Purchase Plans · পরিকল্পনা</Link>
    </nav>
    {invoiceError&&<p role="alert" className="rounded-md bg-danger-bg p-3 text-sm text-danger">{invoiceError}</p>}
    {tab==='return'?(params.get('purchaseId')&&items.some(p=>p.purchaseId===params.get('purchaseId')&&!p.items?.some(i=>!!i.unitDescription))
      ?<LiveStandardPurchaseReturns purchaseId={params.get('purchaseId')!} onRefresh={()=>void refresh()}/>
      :<LiveMixedPurchaseReturns purchaseId={params.get('purchaseId')||''}
         purchases={items} loading={loading} onRefresh={()=>void refresh()}/>):
    tab==='payments'?<LiveSupplierSettlements supplierId={params.get('supplierId')||''}/>:
    tab==='plans'?<LivePurchasePlans/>:
    <>
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
          <TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Due</TableHead><TableHead>Actions</TableHead>
        </TableRow></TableHeader>
        <TableBody>{visible.map(p=><TableRow key={p.purchaseId}>
          <TableCell className="text-sm font-medium">{p.purchaseId}</TableCell>
          <TableCell className="text-sm">{p.supplierName}</TableCell>
          <TableCell className="text-xs text-ink-600">{p.purchaseDate}</TableCell>
          <TableCell className="text-right">{money(p.grandTotal)}</TableCell>
          <TableCell className="text-right">{money(p.paidAmount)}</TableCell>
          <TableCell className="text-right">{money(p.dueAmount)}</TableCell>
          <TableCell><div className="flex flex-wrap gap-3">
          <Button size="sm" variant="ghost"
            aria-label={'View invoice '+p.purchaseId}
            disabled={!!invoiceLoading}
            onClick={()=>void viewInvoice(p.purchaseId)}>
            {invoiceLoading===p.purchaseId?'Loading…':'View · দেখুন'}
          </Button>
          {p.items?.length>0&&
            <Link className="text-xs font-semibold text-teal-700 hover:underline"
              to={'/app/purchases?tab=return&purchaseId='+encodeURIComponent(p.purchaseId)}>
              Return · ফেরত
            </Link>}
          {p.supplierId&&<Link className="text-xs font-semibold text-teal-700 hover:underline"
              to={'/app/purchases?tab=payments&supplierId='+encodeURIComponent(p.supplierId)}>
              Pay supplier · পরিশোধ
            </Link>}</div></TableCell>
        </TableRow>)}</TableBody></Table>
        {visible.length===0&&<p className="py-8 text-center text-sm text-ink-500">No purchases found · কোনো ক্রয় নেই</p>}
       </div>}
    </div>
    </>}
    <BillDetailDialog bill={invoice} onClose={()=>{invoiceSequence.current++;setInvoice(null);}}/>
  </section>;
}

export function LivePurchaseEditorPage(){
  const user=useBackendSession(),navigate=useNavigate();
  const [params]=useSearchParams();
  const orderId=params.get('orderId')||'';
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
  const [tender,setTender]=useState<PurchaseTender>('Due');
  const [paidText,setPaidText]=useState('');
  const [bankId,setBankId]=useState('');
  const [paymentDetails,setPaymentDetails]=useState<SettlementDetails|null>(null);
  const [paymentBusy,setPaymentBusy]=useState(false);
  const [paymentLoadError,setPaymentLoadError]=useState('');
  const [saving,setSaving]=useState(false);
  const [outcomeUnknown,setOutcomeUnknown]=useState(false);
  const posting=useRef(false),requestId=useRef(crypto.randomUUID());
  const newRequestId=()=>{requestId.current=crypto.randomUUID();};
  useEffect(()=>{
    if(!permitted)return;
    let live=true;
    getPurchaseProducts().then(data=>{if(live)setProducts(data);})
      .catch(e=>{if(live)setError(e instanceof Error?e.message:'Products could not load');})
      .finally(()=>{if(live)setLoading(false);});
    return ()=>{live=false;};
  },[permitted]);
  useEffect(()=>{
    if(!permitted||!orderId)return;
    let live=true;
    getOrderToPurchase(orderId).then(async result=>{
      const suppliers=await searchPurchaseSuppliers(result.purchase.supplierId);
      if(!live)return;
      const found=suppliers.find(s=>s.id===result.purchase.supplierId);
      if(!found||found.needsReconciliation)throw Error('Supplier unavailable or ledger unreconciled');
      setChosen(found);setSearch(found.name);setOpen(false);
      setLines(result.purchase.items.map(i=>({
        key:crypto.randomUUID(),productId:i.productId,qty:i.quantity,unitPrice:i.unitPrice
      })));
    }).catch(e=>{if(live)setError(e instanceof Error?e.message:'Cannot load approved order');});
    return ()=>{live=false;};
  },[permitted,orderId]);
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
  useEffect(()=>{
    if(!chosen||tender==='Due'){
      setPaymentDetails(null);setPaymentBusy(false);setPaymentLoadError('');return;
    }
    let live=true;
    setPaymentBusy(true);setPaymentDetails(null);setPaymentLoadError('');
    loadSupplierSettlements(chosen.id).then(data=>{if(live)setPaymentDetails(data);})
      .catch(e=>{if(live)setPaymentLoadError(e instanceof Error?e.message:'Cannot read payment accounts');})
      .finally(()=>{if(live)setPaymentBusy(false);});
    return ()=>{live=false;};
  },[chosen?.id,tender]);
  const choose=(s:PurchaseSupplier)=>{setChosen(s);setSearch(s.name);setOpen(false);setBankId('');newRequestId();setError('');};
  const edit=(key:string,patch:Partial<Line>)=>{newRequestId();setLines(before=>before.map(l=>l.key===key?{...l,...patch}:l));};
  const quote=(l:Line)=>{
    if(!l.unitQuantities||!l.profile||!l.priceUnit)return Number(l.qty||0)*Number(l.unitPrice||0);
    try{return quotePurchaseLine(l.profile,l.unitQuantities,l.priceUnit,l.unitPrice).total;}catch{return NaN;}
  };
  const total=lines.reduce((sum,l)=>sum+quote(l),0);
  const amountValue=paidText.trim()===''?0:Number(paidText);
  const dueAfter=Math.round((total-(tender==='Due'?0:amountValue))*10000)/10000;
  const payment={method:tender,amount:tender==='Due'?0:amountValue,bankAccountId:bankId,
    activeSession:paymentDetails?.activeSession===true,bankAccounts:paymentDetails?.bankAccounts};
  let validationError='';
  try{
    if(tender==='Due')validateDuePurchase(chosen,lines,orderId);
    else validatePurchasePayment(chosen,lines,payment,requestId.current,orderId);
  }catch(e){validationError=e instanceof Error?e.message:'Invalid purchase payment';}
  const canPost=permitted&&!!chosen&&!chosen.needsReconciliation&&!loading&&!saving&&!outcomeUnknown&&
    !validationError&&lines.every(l=>!l.profileBusy&&!l.profileError&&Number.isFinite(quote(l)))&&
    (tender==='Due'||(!paymentBusy&&!paymentLoadError&&
      paymentDetails?.supplier.id===chosen.id&&!paymentDetails.needsReconciliation));
  const productById=useMemo(()=>new Map(products.map(p=>[p.productId,p])),[products]);
  async function selectProduct(key:string,id:string){
    const p=productById.get(id);
    edit(key,{productId:id,qty:1,unitPrice:Number(p?.purchasePrice||0),
      unitQuantities:undefined,unitProfileRevision:undefined,priceUnit:undefined,
      profile:null,profileBusy:!!id,profileError:undefined});
    if(!id)return;
    try{
      const data=await getPurchaseUnitProfile(id);
      setLines(previous=>previous.map(l=>{
        if(l.key!==key||l.productId!==id)return l;
        if(!data.profile)return {...l,profile:null,profileBusy:false};
        const profile={...data.profile,revision:data.revision,postingEnabled:data.postingEnabled};
        return {...l,profile,profileBusy:false,qty:1,
          unitProfileRevision:data.revision,unitQuantities:{[data.profile.baseUnit]:1},
          priceUnit:data.profile.baseUnit,unitPrice:Number(p?.purchasePrice||0)};
      }));
    }catch(e){
      setLines(previous=>previous.map(l=>l.key===key&&l.productId===id
        ?{...l,profileBusy:false,profileError:e instanceof Error?e.message:'Unit profile unavailable'}:l));
    }
  }
  function changeMixedQty(l:Line,unit:string,value:number){
    if(!l.profile||!l.unitQuantities)return;
    const entries={...l.unitQuantities,[unit]:value};
    let qty=0;
    try{qty=quotePurchaseLine(l.profile,entries,l.priceUnit||l.profile.baseUnit,l.unitPrice).qty;}
    catch{qty=l.profile.units.reduce((sum,u)=>sum+(entries[u.unit]||0)*u.factor,0);}
    edit(l.key,{unitQuantities:entries,qty});
  }
  async function submit(){
    if(posting.current||!canPost)return;
    setError('');
    try{
      if(tender==='Due')validateDuePurchase(chosen,lines,orderId);
      else validatePurchasePayment(chosen,lines,payment,requestId.current,orderId);
    }catch(e){setError(e instanceof Error?e.message:'Invalid purchase');return;}
    posting.current=true;setSaving(true);
    try{
      // Refresh supplier and payment account state before posting; D1 rechecks atomically.
      const refreshed=await searchPurchaseSuppliers(chosen!.id);
      const supplier=refreshed.find(s=>s.id===chosen!.id);
      if(!supplier||supplier.needsReconciliation)
        throw new Error('Supplier unavailable or ledger unreconciled. Refresh before posting.');
      let result;
      if(tender==='Due')result=await createDuePurchase(supplier,lines,orderId);
      else{
        const latest=await loadSupplierSettlements(supplier.id);
        if(latest.needsReconciliation)throw new Error('Supplier balance needs reconciliation.');
        result=await createPurchaseWithPayment(supplier,lines,{...payment,
          activeSession:latest.activeSession,bankAccounts:latest.bankAccounts},
          requestId.current,orderId);
      }
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
      description={orderId?'Approved supplier order '+orderId+' · quantities locked':'Live supplier, joined 2–4-unit quantities and cost-per-unit purchasing.'}
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
          onFocus={()=>{if(!saving&&!outcomeUnknown)setOpen(true);}}
          disabled={!!orderId||saving||outcomeUnknown}
          onChange={e=>{setSearch(e.target.value);setChosen(null);setBankId('');newRequestId();setOpen(true);}}
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
        <Button variant="outline" size="sm" onClick={()=>{newRequestId();setLines(v=>[...v,newLine()]);}} disabled={!!orderId||saving||outcomeUnknown}>
          <Plus className="size-4"/> Add line</Button>
      </div>
      {loading?<p role="status" className="py-6 text-center text-sm">Loading real products…</p>:
      <div className="overflow-x-auto">
        <Table scrollRegionLabel="Purchase entry lines" className="min-w-[620px]">
          <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Stock unit</TableHead>
            <TableHead>Quantity</TableHead><TableHead>Price in</TableHead><TableHead>Unit cost ৳</TableHead>
            <TableHead className="text-right">Total</TableHead><TableHead className="w-9"> </TableHead>
          </TableRow></TableHeader>
          <TableBody>{lines.map(l=><TableRow key={l.key}>
            <TableCell><select aria-label="Product" value={l.productId}
              disabled={!!orderId||saving||outcomeUnknown} onChange={e=>void selectProduct(l.key,e.target.value)}
              className="h-9 w-full min-w-[190px] rounded-md border border-border bg-card px-2 text-sm text-ink">
                <option value="">Choose product…</option>
                {products.map(p=><option key={p.productId} value={p.productId}>{p.displayName||p.productName}</option>)}
              </select></TableCell>
            <TableCell className="text-xs">{productById.get(l.productId)?.unit||'—'}</TableCell>
            <TableCell>{l.profile&&l.unitQuantities
              ?<div className="w-[164px]"><LiveMultiUnitQuantity
                profile={l.profile} quantities={l.unitQuantities}
                productName={productById.get(l.productId)?.productName||'Product'}
                onChange={(unit,value)=>changeMixedQty(l,unit,value)}
                onLastEnter={()=>{}} disabled={saving||outcomeUnknown}/></div>
              :<Input aria-label="Purchase quantity" type="number" min="0.0001" step="0.0001"
                disabled={!!orderId||saving||outcomeUnknown||!!l.profileBusy||!!l.profileError}
                value={l.qty} onChange={e=>edit(l.key,{qty:e.target.value===''?0:Number(e.target.value)})}
                className="w-24"/>}
              {l.profileBusy&&<span className="text-xs text-ink-500">Loading units…</span>}
              {l.profileError&&<span role="alert" className="text-xs text-danger">{l.profileError}</span>}
              </TableCell>
            <TableCell>{l.profile&&l.unitQuantities
             ?<select aria-label="Purchase price unit" value={l.priceUnit||l.profile.baseUnit}
               disabled={saving||outcomeUnknown}
               onChange={e=>{
                 const chosen=l.profile!.units.find(u=>u.unit===e.target.value);
                 const prior=l.profile!.units.find(u=>u.unit===l.priceUnit);
                 const equivalent=prior&&chosen
                   ?Math.round(l.unitPrice*chosen.factor/prior.factor*10000)/10000:l.unitPrice;
                 edit(l.key,{priceUnit:e.target.value,unitPrice:equivalent});
               }}
               className="h-9 w-[77px] rounded-md border border-border bg-card px-1 text-xs text-ink">
                {l.profile.units.map(u=><option key={u.unit} value={u.unit}>{u.symbol}</option>)}
               </select>:<span className="text-xs text-ink-600">{productById.get(l.productId)?.unit||'—'}</span>}
             </TableCell>
            <TableCell><Input aria-label="Purchase unit cost" type="number" min="0" step="0.0001"
              disabled={saving||outcomeUnknown}
              value={l.unitPrice} onChange={e=>edit(l.key,{unitPrice:e.target.value===''?0:Number(e.target.value)})}
              className="w-28"/></TableCell>
            <TableCell className="text-right text-sm">{Number.isFinite(quote(l))&&positive(String(l.unitPrice))?money(quote(l)):'—'}</TableCell>
            <TableCell><Button size="icon" variant="ghost" title="Remove line" aria-label="Remove purchase line"
              onClick={()=>{newRequestId();setLines(before=>before.filter(x=>x.key!==l.key));}} disabled={!!orderId||saving||outcomeUnknown}>
              <Trash2 className="size-4"/></Button></TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </div>}
      <div className="mt-3 rounded-lg border border-border p-3" data-purchase-payment>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="purchase-tender" className="mb-1 block text-xs font-medium text-ink-600">Payment method · পরিশোধ</label>
            <select id="purchase-tender" aria-label="Purchase payment method" value={tender}
              disabled={saving||outcomeUnknown} onChange={e=>{setTender(e.target.value as PurchaseTender);setBankId('');newRequestId();}}
              className="h-9 rounded-md border border-border bg-card px-2 text-sm text-ink">
              <option value="Due">Due · বাকি</option><option value="Cash">Cash · নগদ</option>
              <option value="Bank">Bank</option><option value="Mobile Banking">Mobile Banking</option>
            </select>
          </div>
          {tender!=='Due'&&<div className="w-36">
            <label htmlFor="purchase-paid" className="mb-1 block text-xs font-medium text-ink-600">Paid amount · জমা ৳</label>
            <Input id="purchase-paid" aria-label="Purchase paid amount" type="number" min="0" step="0.0001"
              max={Number.isFinite(total)?total:undefined} value={paidText}
              disabled={saving||outcomeUnknown} onChange={e=>{setPaidText(e.target.value);newRequestId();}}/>
          </div>}
          {tender!=='Due'&&tender!=='Cash'&&<div>
            <label htmlFor="purchase-bank" className="mb-1 block text-xs font-medium text-ink-600">Bank/mobile account · হিসাব</label>
            <select id="purchase-bank" aria-label="Purchase bank account" value={bankId}
              disabled={saving||outcomeUnknown||paymentBusy} onChange={e=>{setBankId(e.target.value);newRequestId();}}
              className="h-9 max-w-[260px] rounded-md border border-border bg-card px-2 text-sm text-ink">
              <option value="">Choose account…</option>
              {paymentDetails?.bankAccounts.filter(a=>a.type===tender).map(a=>
                <option key={a.id} value={a.id}>{a.name} · {money(a.currentBalance)}</option>)}
            </select>
          </div>}
        </div>
        {paymentBusy&&<p role="status" className="mt-2 text-xs text-ink-500">Checking live cash session and accounts…</p>}
        {tender!=='Due'&&chosen&&!paymentBusy&&
         (paymentLoadError||paymentDetails?.needsReconciliation||validationError)&&
         <p role="alert" className="mt-2 text-xs text-danger">
          {paymentLoadError|| (paymentDetails?.needsReconciliation?'Supplier ledger needs reconciliation.':validationError)}
         </p>}
        <div className="mt-3 flex flex-wrap justify-end gap-4 border-t border-border pt-2 text-sm">
          <span className="text-ink-600">Invoice total <strong className="text-ink">{Number.isFinite(total)?money(total):'—'}</strong></span>
          <span className="text-ink-600">Paid <strong className="text-ink">{tender==='Due'?'৳0':Number.isFinite(amountValue)?money(amountValue):'—'}</strong></span>
          <span className="text-ink-600">Remaining due <strong className="text-ink">{Number.isFinite(dueAfter)?money(dueAfter):'—'}</strong></span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-lg text-xs text-ink-500">Multi-unit products remain one compact line. Pay a mixed-unit invoice later through Supplier Payments until paid mixed-unit returns are reconciled.</p>
        <Button disabled={!canPost||!lines.length||!products.length}
          onClick={()=>void submit()}>{saving?'Posting…':tender==='Due'?'Confirm Due Purchase · বাকি ক্রয় নিশ্চিত':'Confirm Paid Purchase · পরিশোধসহ ক্রয় নিশ্চিত'}</Button>
      </div>
    </div>
  </section>;
}
