import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Keyboard, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '../components/Button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '../components/Dialog';
import { Input } from '../components/Input';
import { PageHeader } from '../components/PageHeader';
import { ProductCombobox } from '../components/pos/ProductCombobox';
import { StatusBadge } from '../components/StatusBadge';
import { ReceiptPreview } from '../components/brand/ReceiptPreview';
import { SerialPickerDialog } from '../components/pos/SerialPickerDialog';
import { LiveStockShortageDialog, type ShortageSelection } from './LiveStockShortageDialog';
import { LiveCheckoutPanel } from './LiveCheckoutPanel';
import { LiveMultiUnitQuantity } from './LiveMultiUnitQuantity';
import { quoteLiveUnits } from './posUnitMath';
import { Link } from 'react-router-dom';
import './liveReceiptPrint.css';
import type { Product } from '../types/erp';
import { canUseModule, useBackendSession } from './BackendGate';
import {
  BackendRequestError, getPosBootstrap, getPosInvoice, getPosTrackingOptions, getSalesByPhone, postSale, startCashSession,
  type PosBootstrap, type PosProduct, type PosInvoice, type PosSalePayload
} from './banijjApi';

type Line = { product: PosProduct; qty: number; price: number; serialNumbers: string[];
  unitQuantities?: Record<string,number>;
  source: ShortageSelection };
const mixedQuote=(line:Line)=>{
  const profile=line.product.unitProfilePreview;
  if(!line.unitQuantities||!profile)return null;
  try{return quoteLiveUnits(profile,line.unitQuantities);}catch{return null;}
};
const lineTotal=(line:Line)=>line.unitQuantities ? (mixedQuote(line)?.total ?? 0) : line.qty*line.price;
const noSerials: string[] = [];
const taka = (n: number) => '৳' + Number(n || 0).toLocaleString('en-BD', { maximumFractionDigits: 2 });
const supported = (p: PosProduct) => p.stock > 0 || (!p.trackSerial && !p.trackExpiry);

export function LivePosPage() {
  const user = useBackendSession();
  const canView = canUseModule(user, 'pos');
  const canPost = canUseModule(user, 'pos', 'add');
  const [bootstrap, setBootstrap] = useState<PosBootstrap | null>(null);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [shortageId,setShortageId] = useState<string | null>(null);
  const [serialId,setSerialId] = useState<string | null>(null);
  const [availableSerials,setAvailableSerials] = useState<string[]>([]);
  const [loadingTracking,setLoadingTracking] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [fatherName, setFatherName] = useState('');
  const [address, setAddress] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [discount, setDiscount] = useState('');
  const [discountMode, setDiscountMode] = useState<'amount' | 'percent'>('amount');
  const [paid, setPaid] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PosSalePayload['paymentMethod']>('Cash');
  const [bankAccountId, setBankAccountId] = useState('');
  const [openingCash, setOpeningCash] = useState('0');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [finished, setFinished] = useState<PosInvoice | null>(null);
  const [receipt,setReceipt] = useState<PosInvoice | null>(null);
  const [receiptOpen,setReceiptOpen] = useState(false);
  const [receiptBusy,setReceiptBusy] = useState(false);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const [salesChecked, setSalesChecked] = useState(false);
  const [recentSales, setRecentSales] = useState<Array<{ invoiceId: string; date: string; grandTotal: number; paymentStatus: string }>>([]);
  const postingRef = useRef(false);
  // A posted sale stays read-only until the user explicitly chooses New Sale.
  // Outside-click/Escape dialogs must NEVER silently reset a subsequent cart.
  const lastResetPostedInvoiceRef = useRef<string | null>(null);
  const [saleResetVersion,setSaleResetVersion]=useState(0);
  const saleRequestId = useRef(crypto.randomUUID());
  const productRef = useRef<HTMLInputElement>(null);
  const paidRef = useRef<HTMLInputElement>(null);
  const quantityRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async (silent = false) => {
    if (!canView) { setBusy(false); return; }
    if(!silent)setBusy(true); setError('');
    try { const result = await getPosBootstrap(); setBootstrap(result); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load the POS'); }
    finally { if(!silent)setBusy(false); }
  }, [canView]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === 'F2') { event.preventDefault(); productRef.current?.focus(); }
      if (event.key === 'F8') { event.preventDefault(); paidRef.current?.focus(); }
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  const selectable = useMemo(() => (bootstrap?.products || []).filter(supported).map(p => ({
    id: p.id, name: p.name, nameBn: '', sku: p.barcode || p.id, category: p.category,
    brand: p.brand, unit: p.unit || 'Pcs', stock: p.stock, minStock: p.minimumStock,
    sellPrice: p.sellingPrice, purchasePrice: 0, active: true
  } satisfies Product)), [bootstrap]);
  const simpleCount = selectable.length;
  const excludedCount = (bootstrap?.products.length || 0) - simpleCount;
  const serialLine = lines.find(l=>l.product.id===serialId);
  const shortageLine = lines.find(l=>l.product.id===shortageId);
  const serialProduct=selectable.find(p=>p.id===serialId);
  const subtotal = useMemo(() => Math.round(lines.reduce((sum, l) => sum + lineTotal(l), 0) * 100)/100, [lines]);
  const rawDiscount = discount.trim() ? Number(discount) : 0;
  const discountAmount = discountMode === 'percent' ? Math.round(subtotal * rawDiscount) / 100 : rawDiscount;
  const total = Number.isFinite(discountAmount) ? Math.max(0, subtotal - discountAmount) : 0;
  const paidAmount = paymentMethod==='Store Credit'?total:(paid.trim()?Number(paid):0);
  const due = Math.max(0, total - paidAmount);
  const selectedCustomer = bootstrap?.customers.find(p => p.phone === customerPhone.trim());
  const matchingAccounts = (bootstrap?.bankAccounts || []).filter(a =>
    (a.accountType || 'Bank') === (paymentMethod === 'Mobile Banking' ? 'Mobile Banking' : 'Bank'));
  const requiresAccount = paidAmount > 0 && (paymentMethod === 'Bank' || paymentMethod === 'Mobile Banking');
  const errors = useMemo(() => {
    const found: string[] = [];
    if (!canPost) found.push('Your account cannot post POS sales.');
    if (outcomeUnknown) found.push('Sale outcome is unknown. Check recent sales before attempting another post.');
    if (!bootstrap?.activeSession) found.push('Start your cash session first.');
    if (!lines.length) found.push('Add at least one product.');
    if (!customerName.trim() || !customerPhone.trim()) found.push('Customer name and phone are required.');
    if (!Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > subtotal) found.push('Enter a valid discount.');
    if (!Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount > total) found.push('Received amount cannot exceed the payable total.');
    if (requiresAccount && !matchingAccounts.some(a => a.id === bankAccountId)) found.push('Select an active payment account.');
    if(paymentMethod==='Store Credit'){
      if(!selectedCustomer)found.push('Select a saved customer with Store Credit · ক্রেতা নির্বাচন করুন।');
      else if(selectedCustomer.storeCreditBlocked)found.push('Historical Store Credit needs reconciliation · পুরোনো হিসাব যাচাই দরকার।');
      else if(Math.round(total*100)>selectedCustomer.storeCreditCents)
        found.push('Not enough Store Credit · জমা ক্রেডিট যথেষ্ট নয়।');
      if(total<=0)found.push('Store Credit requires a positive payable total.');
    }
    for (const line of lines) {
      if (!Number.isSafeInteger(line.qty) || line.qty <= 0) found.push(line.product.name + ': enter a whole-number quantity.');
      if(line.unitQuantities){
        const quote=mixedQuote(line);
        if(!line.product.unitProfilePreview?.postingEnabled)found.push(line.product.name+': mixed-unit posting is not available.');
        if(!quote || quote.qty!==line.qty)found.push(line.product.name+': enter valid whole-number unit quantities.');
      }
      if (!Number.isFinite(line.price) || line.price < 0) found.push(line.product.name + ': invalid selling price.');
      if (!supported(line.product)) found.push(line.product.name + ': no sellable tracked stock.');
      if (line.product.trackSerial && line.serialNumbers.length!==line.qty)
        found.push(line.product.name + ': select exactly '+line.qty+' serial number(s).');
      if (line.product.trackSerial && new Set(line.serialNumbers.map(x=>x.toLowerCase())).size!==line.serialNumbers.length)
        found.push(line.product.name + ': duplicate serial selection.');
      if (line.qty > line.product.stock) {
        if (line.product.trackSerial || line.product.trackExpiry)
          found.push(line.product.name + ': tracked stock cannot use vendor/negative sourcing.');
        else if (line.source.mode==='own')
          found.push(line.product.name + ': review the stock shortage before checkout.');
        else if (line.source.mode==='vendor' &&
          (!(bootstrap?.vendors||[]).some(v=>v.id===line.source.vendorId) ||
           !Number.isFinite(line.source.vendorUnitCost) || line.source.vendorUnitCost<0))
          found.push(line.product.name + ': select an active vendor and valid unit cost.');
      }
    }
    return found;
  }, [canPost, bootstrap, lines, customerName, customerPhone, discountAmount, subtotal,
      paidAmount, total, requiresAccount, matchingAccounts, bankAccountId, outcomeUnknown,
      paymentMethod, selectedCustomer]);
  const addProduct = (p: Product) => {
    const record = bootstrap?.products.find(item => item.id === p.id);
    if (!record || !supported(record)) {
      setFeedback('No sellable tracked stock is available. Complete serial/expiry tracking or receive new stock first.');
      return;
    }
    setFeedback('');
    setLines(current => {
      const found = current.find(l => l.product.id === record.id);
      if (found) {
        if ((found.product.trackSerial || found.product.trackExpiry) && found.qty>=found.product.stock) {
          setFeedback('Sellable tracked stock reached for '+record.name);return current;
        }
        return current.map(l => l.product.id === record.id ? {
          ...l, qty: l.qty+1,
          ...(l.unitQuantities?{unitQuantities:{...l.unitQuantities,
            [l.product.unit]:(l.unitQuantities[l.product.unit]||0)+1}}:{}),
          serialNumbers:[],source:{mode:'own'} as ShortageSelection
        }:l);
      }
      return [...current, { product: record, qty: 1, price: record.sellingPrice,
        ...(record.unitProfilePreview?{unitQuantities:{[record.unit]:1}}:{}),
        serialNumbers: [], source:{mode:'own'} }];
    });
    requestAnimationFrame(() => {
      quantityRefs.current[record.id]?.focus();
      quantityRefs.current[record.id]?.select();
    });
  };
  const patchLine = (id: string, patch: Partial<Pick<Line, 'qty' | 'price'>>) =>
    setLines(old => old.map(line => line.product.id === id ?
      { ...line, ...patch, ...(patch.qty!==undefined?{
        serialNumbers:[],source:{mode:'own'} as ShortageSelection
      }:{}) } : line));
  const patchMixedUnit=(id:string,unit:string,quantity:number)=>{
    setLines(old=>old.map(line=>{
      if(line.product.id!==id || !line.unitQuantities || !line.product.unitProfilePreview)return line;
      const quantities={...line.unitQuantities,[unit]:quantity};
      let qty=0;
      try{qty=quoteLiveUnits(line.product.unitProfilePreview,quantities).qty;}catch{}
      return {...line,unitQuantities:quantities,qty,serialNumbers:[],source:{mode:'own'} as ShortageSelection};
    }));
  };
  const openSerialPicker = async (id:string) => {
    if(loadingTracking)return;
    setLoadingTracking(true);setError('');
    try {
      const result=await getPosTrackingOptions(id);
      setAvailableSerials(result.serials.map(x=>x.serialNumber));
      setSerialId(id);
    } catch(err){setError(err instanceof Error?err.message:'Could not load serial availability.');}
    finally{setLoadingTracking(false);}
  };
  const applyShortage = (selection:ShortageSelection,clampedQty:number) => {
    if(!shortageId)return;
    setLines(old=>old.flatMap(line=>line.product.id!==shortageId?[line]:
      clampedQty>0?[{...line,qty:clampedQty,source:selection,serialNumbers:[],
        ...(line.unitQuantities&&selection.mode==='own'?
          {unitQuantities:{[line.product.unit]:clampedQty}}:{})
      }]:[]));
    setShortageId(null);
  };
  const selectCustomer = (value: string, field: 'name' | 'phone') => {
    const customer = bootstrap?.customers.find(c => field === 'name'
      ? c.name.toLocaleLowerCase() === value.trim().toLocaleLowerCase()
      : c.phone === value.trim());
    if (!customer) return;
    setCustomerName(customer.name); setCustomerPhone(customer.phone);
    setFatherName(customer.fatherName || ''); setAddress(customer.address || '');
  };
  const resetSaleState=()=>{
    setSaleResetVersion(v=>v+1);
    setLines([]);setCustomerName('');setCustomerPhone('');setFatherName('');setAddress('');
    setPaid('');setDiscount('');setDiscountMode('amount');setPaymentMethod('Cash');setBankAccountId('');
    setFinished(null);setReceipt(null);setReceiptOpen(false);setFeedback('');setError('');
    setShortageId(null);setSerialId(null);setAvailableSerials([]);
    saleRequestId.current=crypto.randomUUID();
    setOutcomeUnknown(false);setSalesChecked(false);setRecentSales([]);
    requestAnimationFrame(() => productRef.current?.focus());
  };
  const newSale=()=>{
    // The success dialog can emit repeated click/close events after another
    // transaction begins. An invoice may reset the form only once.
    if(!finished?.invoiceId||lastResetPostedInvoiceRef.current===finished.invoiceId)return;
    lastResetPostedInvoiceRef.current=finished.invoiceId;
    resetSaleState();
  };
  const clearDraft=()=>{
    if(finished)return; // Posted invoices must use the explicit New Sale action.
    if(!lines.length&&!customerName.trim()&&!customerPhone.trim()&&!paid.trim()&&!discount.trim())return;
    if(window.confirm('Discard this unsaved cart, customer and payment details?'))resetSaleState();
  };
  const startDay = async () => {
    const amount = Number(openingCash);
    if (!canPost) return;
    if (!Number.isFinite(amount) || amount < 0) { setError('Enter a valid opening cash amount.'); return; }
    if (!window.confirm('Start the real BanijjIQ cash session with '+taka(amount)+' opening cash?')) return;
    setSaving(true); setError('');
    try { await startCashSession(amount); await load(); setFeedback('Cash session opened.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not start cash session'); }
    finally { setSaving(false); }
  };
  const confirmPost = async () => {
    if (postingRef.current || saving || errors.length) { setError(errors[0] || 'Sale cannot be posted.'); return; }
    postingRef.current = true;
    const method = paymentMethod;
    const paymentType: PosSalePayload['paymentType'] = paidAmount === 0 ? 'Due' : paidAmount >= total ? 'Cash' : 'Partial';
    const payload: PosSalePayload = {
      clientRequestId: saleRequestId.current,
      customerId: selectedCustomer?.id,
      customerName: customerName.trim(), customerPhone: customerPhone.trim(),
      customerAddress: address.trim(), customerFatherName: fatherName.trim(),
      discount: discountAmount, paymentType,
      paidAmount: paymentType === 'Partial' ? paidAmount : 0,
      paymentMethod: method, bankAccountId: requiresAccount ? bankAccountId : '',
      items: lines.map(l => ({
        productId: l.product.id, name: l.product.name, qty: l.qty,
        unitPrice: l.price, fulfillmentMode: l.source.mode,
        ...(l.unitQuantities&&l.product.unitProfilePreview?
          {unitQuantities:l.unitQuantities,unitProfileRevision:l.product.unitProfilePreview.revision}:{}),
        ...(l.product.trackSerial?{serialNumbers:l.serialNumbers}:{}),
        ...(l.source.mode==='vendor'?{vendorId:l.source.vendorId,vendorUnitCost:l.source.vendorUnitCost}:{})
      }))
    };
    setSaving(true);setError('');
    try {
      const result = await postSale(payload);
      setFinished(result.invoice);
      setReviewOpen(false);
      await load(true);
    } catch (err) {
      const unknown = !(err instanceof BackendRequestError) || err.status === null || err.status >= 500;
      if (unknown) {
        setOutcomeUnknown(true);setSalesChecked(false);
        setError('The sale may already have been posted. Do not retry until you check recent invoices for this phone.');
      } else {
        setError(err instanceof Error ? err.message : 'Sale rejected. Your cart is retained.');
      }
      setReviewOpen(false);
    } finally { postingRef.current = false; setSaving(false); }
  };
  const openReceipt = async () => {
    if (!finished?.invoiceId) return;
    setReceiptBusy(true);setError('');
    try {
      const result=await getPosInvoice(finished.invoiceId);
      if (!result.invoice?.items?.length) throw new Error('Saved invoice items could not be loaded.');
      setReceipt(result.invoice);setReceiptOpen(true);
    } catch(err) {
      setError(err instanceof Error?err.message:'Could not retrieve saved invoice.');
    } finally { setReceiptBusy(false); }
  };
  const checkRecentSales = async () => {
    setSalesChecked(false);
    try {
      const result = await getSalesByPhone(customerPhone.trim());
      setRecentSales(result.sales.slice(0, 10));
      setSalesChecked(true);
      setFeedback('Review the invoices below and check your Sales ledger. Only clear this warning if no invoice was posted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check recent invoices.');
    }
  };
  if (!canView) return <section className="rounded-xl border border-danger bg-danger-bg p-4 text-sm text-danger" role="alert">
    You do not have permission to use POS. · বিক্রির অনুমতি নেই
  </section>;

  return <section className="pos-screen mx-auto max-w-[1440px] space-y-4" data-live-pos data-sale-reset-version={saleResetVersion}>
    <PageHeader title="POS" titleBn="বিক্রি" description="Original HisabIQ POS cart · Live base-unit FIFO accounting through BanijjIQ API"
      actions={<div className="flex flex-wrap items-center gap-2">
        <span className="hidden items-center gap-2 rounded-lg border border-border bg-card px-2 py-1 text-[11px] text-ink-500 lg:flex">
          <Keyboard className="size-3.5"/><kbd>F2</kbd> Search <kbd>F8</kbd> Paid
        </span>
        <StatusBadge tone="teal">Real API · Tracked POS</StatusBadge>
        <Link to="/app/live-sales-returns" className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-teal-700 hover:bg-teal-50">
          Sales Returns · বিক্রয় ফেরত
        </Link>
        <Button variant="outline" size="sm" disabled={busy || saving} onClick={() => void load()}>
          <RefreshCw className="size-3.5"/> Refresh
        </Button>
      </div>} />
    <p className="rounded-lg border border-warning/25 bg-warning-bg px-3 py-2 text-xs text-warning">
      Mixed-unit sales and returns preserve original prices and base-unit FIFO history. Invoice edit-in-place, bundles, installments, split payments and drafts remain pending.
    </p>
    {error && <p role="alert" className="rounded-lg bg-danger-bg p-3 text-sm text-danger">{error}</p>}
    {feedback && <p role="status" className="rounded-lg bg-info-bg p-3 text-sm text-info">{feedback}</p>}
    {outcomeUnknown && <div className="space-y-2 rounded-lg border border-danger bg-danger-bg p-3 text-xs text-danger" role="alert">
      <strong>Possible duplicate sale — posting result unknown.</strong>
      <p>Do not repeat the sale blindly. Check recent invoices and the sales ledger before retrying.</p>
      <Button variant="outline" size="sm" onClick={() => void checkRecentSales()}>Check recent invoices for this phone</Button>
      {salesChecked && <div className="space-y-1">
        {recentSales.length ? recentSales.map(item=><p key={item.invoiceId}>{item.invoiceId} · {item.date} · {taka(item.grandTotal)} · {item.paymentStatus}</p>)
          : <p>No invoice returned for this phone. Check the Sales ledger too.</p>}
        <Button variant="outline" size="sm" onClick={() => {setOutcomeUnknown(false);setError('');}}>
          I checked Sales and confirmed this invoice was not posted — allow retry
        </Button>
      </div>}
    </div>}
    {busy && <p role="status" className="rounded-xl border border-border bg-card p-4 text-sm text-ink-500">Loading live POS…</p>}
    {!busy && bootstrap && <>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-xs text-ink-600">
        <span>Cash session: <strong className={bootstrap.activeSession ? 'text-success' : 'text-warning'}>
          {bootstrap.activeSession ? 'Open' : 'Closed'}
        </strong></span>
        <span>{simpleCount} selectable products</span>
        <span>{excludedCount} tracked products have no sellable stock</span>
      </div>
      {!bootstrap.activeSession && <div className="flex flex-wrap items-end gap-3 rounded-xl border border-warning/30 bg-warning-bg p-3">
        <label className="flex flex-col gap-1 text-xs text-ink-700">Opening cash · শুরুর টাকা
          <Input type="number" min="0" step="0.01" value={openingCash} onChange={e=>setOpeningCash(e.target.value)} className="h-9 w-40 bg-card"/>
        </label>
        <Button disabled={!canPost || saving} onClick={() => void startDay()}>Start Day · শুরু করুন</Button>
        <span className="text-xs text-warning">This starts a real cash session on BanijjIQ.</span>
      </div>}
      <div className="pos-columns grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_370px]" data-pos-layout>
        <div className="min-w-0 space-y-3">
          {/* Original HisabIQ CartTable.tsx grid and inline search structure,
              with live BanijjIQ product records and persisted accounting actions. */}
          <div data-cart-kind="sale" className="min-w-0 overflow-x-auto rounded-xl border border-border bg-card shadow-card"
            tabIndex={0} role="region" aria-label="Sales cart rows — scroll horizontally with keyboard">
            <div data-cart-header className={`grid min-w-[790px] grid-cols-[36px_minmax(130px,1fr)_160px_88px_168px_112px_28px] items-center gap-1.5 border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-ink-400`}>
              <span className="text-right">#</span>
              <span>Product · পণ্য</span>
              <span className="text-right">Quantity · পরিমাণ</span>
              <span>Price in · একক</span>
              <span className="text-right">Price · দাম</span>
              <span className="text-right">Total · মোট</span>
              <span className="sr-only">Remove</span>
            </div>
            <div data-testid="pos-cart" className="divide-y divide-border">
              {lines.map((line,index) => <div data-testid="pos-cart-row" data-cart-row="sale" data-pos-line key={line.product.id}
                className={`grid min-w-[790px] grid-cols-[36px_minmax(130px,1fr)_160px_88px_168px_112px_28px] items-center gap-1.5 px-3 py-2`}>
                <span className="pr-1 text-right text-xs text-ink-400">{index+1}.</span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-ink" title={line.product.name}>{line.product.name}</p>
                  <p className="truncate text-[11px] text-ink-500">{line.product.stock} {line.product.unit} sellable</p>
                  {line.product.trackSerial&&<button type="button" disabled={loadingTracking||saving}
                    onClick={()=>void openSerialPicker(line.product.id)}
                    className="block max-w-full truncate text-left text-[11px] font-medium text-teal-700 hover:underline">
                    Serial / IMEI · {line.serialNumbers.length}/{line.qty} selected
                  </button>}
                  {(line.product.trackSerial||line.product.trackExpiry) &&
                    <span className="block truncate text-[10px] text-ink-500">Tracked stock</span>}
                  {!line.product.trackSerial&&!line.product.trackExpiry&&line.qty>line.product.stock&&
                    <button type="button" onClick={()=>setShortageId(line.product.id)}
                      className="block max-w-full truncate text-left text-[11px] font-medium text-warning hover:underline">
                      {line.source.mode==='own'?'Resolve stock shortage':line.source.mode==='vendor'?'Vendor sourcing selected':'Negative sale selected'}
                    </button>}
                </div>
                <div className="flex min-w-0 items-center justify-end gap-1">
                  {line.product.unitProfilePreview && line.unitQuantities
                    ? <LiveMultiUnitQuantity profile={line.product.unitProfilePreview}
                        quantities={line.unitQuantities} productName={line.product.name} disabled={saving}
                        primaryRef={node=>{quantityRefs.current[line.product.id]=node;}}
                        onChange={(unit,qty)=>patchMixedUnit(line.product.id,unit,qty)}
                        onLastEnter={()=>productRef.current?.focus()}/>
                    : <>
                      <Input ref={node => { quantityRefs.current[line.product.id] = node; }}
                        type="number" min="1" step="1" value={line.qty}
                        aria-label={'Quantity for '+line.product.name}
                        onChange={e => patchLine(line.product.id,{qty:Number(e.target.value)})}
                        onKeyDown={e => { if(e.key === 'Enter'){e.preventDefault();productRef.current?.focus();} }}
                        className="h-9 min-w-0 w-[106px] text-right" />
                      <span className="w-[44px] shrink-0 truncate text-right text-[11px] text-ink-500" title={line.product.unit}>
                        {line.product.unit}
                      </span>
                    </>}
                </div>
                <span className="truncate text-xs text-ink-600" title={'Price per '+line.product.unit}>
                  {line.unitQuantities?'Mixed':line.product.unit}
                </span>
                <div className="flex min-w-0 items-center gap-1">
                  {line.unitQuantities&&line.product.unitProfilePreview
                    ? <span data-mixed-unit-prices className="w-full truncate rounded-md bg-ink-50 px-2 py-2 text-right text-[11px] text-ink-600"
                        title={line.product.unitProfilePreview.units.map(u=>u.symbol+': '+taka(u.sellingPrice)).join(' · ')}>
                        Unit prices · একক দাম
                      </span>
                    : <>
                      <span className="shrink-0 text-xs text-ink-500">৳</span>
                      <Input type="number" min="0" step="0.01" value={line.price}
                        aria-label={'Price for '+line.product.name}
                        onChange={e => patchLine(line.product.id,{price:Number(e.target.value)})}
                        className="h-9 min-w-0 w-full text-right"/>
                    </>}
                </div>
                <strong className="text-right text-[13px] font-semibold text-ink">{taka(lineTotal(line))}</strong>
                <button type="button" className="flex size-8 items-center justify-center rounded-md text-ink-400 hover:bg-danger-bg hover:text-danger"
                  aria-label={'Remove '+line.product.name}
                  onClick={() => setLines(old => old.filter(l => l.product.id !== line.product.id))}>
                  <Trash2 className="size-4"/>
                </button>
              </div>)}
              <div data-testid="pos-add-row" data-cart-add
                className={`grid min-w-[790px] grid-cols-[36px_minmax(130px,1fr)_160px_88px_168px_112px_28px] items-center gap-1.5 border-t border-border bg-teal-50/35 px-3 py-2`}>
                <span className="pr-1 text-right text-sm text-teal-600">{lines.length+1}.</span>
                <ProductCombobox ref={productRef} products={selectable} onSelect={addProduct}
                  ariaLabel="Add real BanijjIQ product" disabled={saving}/>
                <span className="pr-2 text-right text-sm text-ink-400">Qty</span>
                <span className="px-2 text-xs text-ink-400">Unit</span>
                <span className="pr-2 text-right text-sm text-ink-400">Price</span>
                <span className="text-right text-sm text-ink-400">Total</span>
                <span aria-hidden="true" />
              </div>
            </div>
            {!lines.length && <p className="border-t border-border px-4 py-6 text-center text-sm text-ink-500">
              No products added · <span className="font-bn">পণ্য যোগ করুন</span>
            </p>}
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">Quick items <span className="font-bn font-normal text-xs text-ink-500">· দ্রুত যোগ</span></h2>
              <span className="text-xs text-ink-500">Tap to add</span>
            </div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 2xl:grid-cols-4">
              {selectable.slice(0,8).map(p => <button key={p.id} type="button" onClick={() => addProduct(p)}
                className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card p-2 text-left hover:border-teal-300 hover:bg-teal-50">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ink-50 text-xs font-semibold text-ink-500">
                  {p.name.slice(0,2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium text-ink">{p.name}</span>
                  <span className="block truncate text-[11px] text-ink-500">{taka(p.sellPrice)} / {p.unit}</span>
                </span><Plus className="size-4 shrink-0 text-teal-600"/>
              </button>)}
            </div>
          </div>
        </div>
        <LiveCheckoutPanel
          customers={bootstrap.customers} selectedCustomer={selectedCustomer}
          accounts={bootstrap.bankAccounts}
          customerName={customerName} customerPhone={customerPhone}
          fatherName={fatherName} address={address}
          detailsOpen={detailsOpen} onDetailsOpen={setDetailsOpen}
          onCustomerName={setCustomerName} onCustomerPhone={setCustomerPhone}
          onFatherName={setFatherName} onAddress={setAddress}
          onSelectCustomer={selectCustomer}
          subtotal={subtotal} itemCount={lines.length}
          discount={discount} discountMode={discountMode} discountAmount={discountAmount}
          onDiscount={setDiscount} onDiscountMode={setDiscountMode}
          total={total} paid={paid} paidAmount={paidAmount} due={due}
          paymentMethod={paymentMethod} bankAccountId={bankAccountId}
          matchingAccounts={matchingAccounts} requiresAccount={requiresAccount}
          onPaid={setPaid}
          onPaymentMethod={method => { setPaymentMethod(method); setBankAccountId(''); setPaid(method==='Store Credit'?String(total):''); }}
          onBankAccountId={setBankAccountId} paidRef={paidRef}
          errors={errors} disabled={saving} completed={!!finished}
          onClear={clearDraft}
          onReview={() => setReviewOpen(true)}
        />
      </div>
    </>}
    {serialProduct && <SerialPickerDialog
      product={serialProduct}
      open={!!serialLine&&!!serialProduct}
      onOpenChange={open=>{if(!open)setSerialId(null);}}
      eligible={availableSerials}
      selected={serialLine?.serialNumbers||noSerials}
      required={serialLine?.qty||0}
      maxCount={serialLine?.qty||0}
      blocked={noSerials}
      onSave={serials=>{if(serialId)setLines(old=>old.map(l=>l.product.id===serialId?{...l,serialNumbers:serials}:l));}}
    />}
    <LiveStockShortageDialog open={!!shortageLine} onOpenChange={open=>{if(!open)setShortageId(null);}}
      name={shortageLine?.product.name||''} qty={shortageLine?.qty||0} stock={shortageLine?.product.stock||0}
      vendors={bootstrap?.vendors||[]} onApply={applyShortage}
      onVendorCreated={vendor=>setBootstrap(old=>old?{...old,vendors:[...old.vendors,vendor]}:old)}/>
    <Dialog open={reviewOpen} onOpenChange={open=>!saving&&setReviewOpen(open)}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Confirm real sale · বিক্রি নিশ্চিত করুন</DialogTitle>
          <DialogDescription>This is not a demo. Confirming posts stock, payment and customer dues to BanijjIQ.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 rounded-lg bg-ink-50 p-3 text-sm">
          <p className="flex justify-between"><span>Customer</span><strong>{customerName}</strong></p>
          <p className="flex justify-between"><span>Products</span><strong>{lines.length}</strong></p>
          <p className="flex justify-between"><span>Grand total</span><strong>{taka(total)}</strong></p>
          <p className="flex justify-between"><span>{paymentMethod==='Store Credit'?'Credit used · ক্রেডিট খরচ':'Paid'}</span><strong>{taka(paidAmount)}</strong></p>
          {paymentMethod==='Store Credit'&&<p data-credit-review-notice className="text-xs text-teal-700">
            No cash/bank receipt · নগদ বা ব্যাংকে টাকা যোগ হবে না
          </p>}
          <p className="flex justify-between"><span>Due</span><strong>{taka(due)}</strong></p>
        </div>
        <DialogFooter><Button variant="outline" disabled={saving} onClick={()=>setReviewOpen(false)}>Cancel</Button>
          <Button disabled={saving || errors.length > 0} onClick={()=>void confirmPost()}>
            {saving?'Posting…':'Confirm and post'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!finished && !receiptOpen} onOpenChange={()=>{
      // Deliberately ignore incidental close events; New Sale is explicit.
    }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><CheckCircle2 className="size-5 text-success"/> Sale posted successfully</DialogTitle>
          <DialogDescription>BanijjIQ confirmed this invoice and posted the transaction.</DialogDescription></DialogHeader>
        <div className="space-y-2 rounded-lg border border-border bg-ink-50 p-3 text-sm">
          <p>Invoice <strong>{finished?.invoiceId}</strong></p>
          <p>Customer <strong>{finished?.customerName}</strong></p>
          <p>Total <strong>{taka(finished?.grandTotal || 0)}</strong></p>
          <p>Due <strong>{taka(finished?.dueAmount || 0)}</strong></p>
        </div>
        <p className="text-xs text-ink-500">Receipts are fetched from the saved invoice. A4 invoice layout and editing remain in the Vue ERP.</p>
        <DialogFooter><Button variant="outline" disabled={receiptBusy || saving} onClick={()=>void openReceipt()}>
          {receiptBusy?'Loading receipt…':'View / Print receipt'}
        </Button><Button disabled={saving || receiptBusy} onClick={newSale}>New Sale</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>Saved invoice receipt · রশিদ</DialogTitle>
          <DialogDescription>Read from BanijjIQ after posting · সত্যিকারের চালান</DialogDescription>
        </DialogHeader>
        {receipt && <div id="hisabiq-real-receipt">
          <ReceiptPreview invoice={receipt.invoiceId} dateTime={receipt.date}
            customer={receipt.customerName} customerPhone={receipt.customerPhone}
            guardianName={receipt.customerFatherName} customerAddress={receipt.customerAddress}
            lines={receipt.items.map(i=>({
              name:i.productName,qty:i.unitDescription || String(i.quantity)+' '+(i.unit||'Pcs'),
              price:i.unitPrice,total:i.lineTotal
            }))}
            subtotal={receipt.subtotal} discount={receipt.discount} rounding={0}
            total={receipt.grandTotal} paid={receipt.paidAmount} due={receipt.dueAmount}
            method={receipt.paymentMethod||'Cash'}
            branding={{
              name:bootstrap?.invoiceDesign?.settings?.['Shop Name'] ||
                   bootstrap?.invoiceDesign?.settings?.['Shop Name Bangla'] || 'Business',
              nameBn:bootstrap?.invoiceDesign?.settings?.['Shop Name Bangla'] || '',
              address:bootstrap?.invoiceDesign?.settings?.['Address'] || '',
              phone:[bootstrap?.invoiceDesign?.settings?.['Phone 1'],
                     bootstrap?.invoiceDesign?.settings?.['Phone 2']].filter(Boolean).join(' / '),
              logo:bootstrap?.invoiceDesign?.logoDataUri||'',
              showLogo:Boolean(bootstrap?.invoiceDesign?.logoDataUri),
              footer:bootstrap?.invoiceDesign?.settings?.['Invoice Footer']||''
            }}
          />
        </div>}
        <DialogFooter><Button variant="outline" onClick={()=>setReceiptOpen(false)}>Close</Button>
          <Button disabled={!receipt} onClick={()=>window.print()}>Print receipt · প্রিন্ট</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
