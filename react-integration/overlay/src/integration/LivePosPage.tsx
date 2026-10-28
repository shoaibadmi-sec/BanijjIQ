import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Keyboard, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '../components/Button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '../components/Dialog';
import { Input } from '../components/Input';
import { PageHeader } from '../components/PageHeader';
import { ProductCombobox } from '../components/pos/ProductCombobox';
import { StatusBadge } from '../components/StatusBadge';
import type { Product } from '../types/erp';
import { canUseModule, useBackendSession } from './BackendGate';
import {
  BackendRequestError, getPosBootstrap, getSalesByPhone, postSale, startCashSession,
  type PosBootstrap, type PosProduct, type PosInvoice, type PosSalePayload
} from './banijjApi';

type Line = { product: PosProduct; qty: number; price: number };
const taka = (n: number) => '৳' + Number(n || 0).toLocaleString('en-BD', { maximumFractionDigits: 2 });
const asNumber = (n: unknown) => Number.isFinite(Number(n)) ? Number(n) : 0;
const supported = (p: PosProduct) => !p.trackSerial && !p.trackExpiry && p.stock > 0;

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
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [fatherName, setFatherName] = useState('');
  const [address, setAddress] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [discount, setDiscount] = useState('');
  const [paid, setPaid] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Bank' | 'Mobile Banking'>('Cash');
  const [bankAccountId, setBankAccountId] = useState('');
  const [openingCash, setOpeningCash] = useState('0');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [finished, setFinished] = useState<PosInvoice | null>(null);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const [salesChecked, setSalesChecked] = useState(false);
  const [recentSales, setRecentSales] = useState<Array<{ invoiceId: string; date: string; grandTotal: number; paymentStatus: string }>>([]);
  const postingRef = useRef(false);
  const productRef = useRef<HTMLInputElement>(null);
  const paidRef = useRef<HTMLInputElement>(null);
  const quantityRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    if (!canView) { setBusy(false); return; }
    setBusy(true); setError('');
    try { const result = await getPosBootstrap(); setBootstrap(result); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load the POS'); }
    finally { setBusy(false); }
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
  const subtotal = useMemo(() => lines.reduce((sum, l) => sum + l.qty * l.price, 0), [lines]);
  const discountAmount = asNumber(discount);
  const paidAmount = paid.trim() ? asNumber(paid) : 0;
  const total = Math.max(0, subtotal - discountAmount);
  const due = Math.max(0, total - paidAmount);
  const selectedCustomer = bootstrap?.customers.find(p => p.phone === customerPhone.trim());
  const matchingAccounts = (bootstrap?.bankAccounts || []).filter(a =>
    (a.accountType || 'Bank') === (paymentMethod === 'Mobile Banking' ? 'Mobile Banking' : 'Bank'));
  const requiresAccount = paidAmount > 0 && paymentMethod !== 'Cash';
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
    for (const line of lines) {
      if (!Number.isSafeInteger(line.qty) || line.qty <= 0) found.push(line.product.name + ': enter a whole-number quantity.');
      if (!Number.isFinite(line.price) || line.price < 0) found.push(line.product.name + ': invalid selling price.');
      if (!supported(line.product)) found.push(line.product.name + ': advanced/tracked products are not available yet.');
      if (line.qty > line.product.stock) found.push(line.product.name + ': quantity exceeds available stock.');
    }
    return found;
  }, [canPost, bootstrap, lines, customerName, customerPhone, discountAmount, subtotal,
      paidAmount, total, requiresAccount, matchingAccounts, bankAccountId, outcomeUnknown]);
  const addProduct = (p: Product) => {
    const record = bootstrap?.products.find(item => item.id === p.id);
    if (!record || !supported(record)) {
      setFeedback('This product requires serial/expiry or stock-shortage handling. Use the existing Vue POS until its React integration is complete.');
      return;
    }
    setFeedback('');
    setLines(current => {
      const found = current.find(l => l.product.id === record.id);
      if (found) {
        if (found.qty >= found.product.stock) { setFeedback('Available stock reached for '+record.name); return current; }
        return current.map(l => l.product.id === record.id ? { ...l, qty: l.qty + 1 } : l);
      }
      return [...current, { product: record, qty: 1, price: record.sellingPrice }];
    });
    requestAnimationFrame(() => {
      quantityRefs.current[record.id]?.focus();
      quantityRefs.current[record.id]?.select();
    });
  };
  const patchLine = (id: string, patch: Partial<Pick<Line, 'qty' | 'price'>>) =>
    setLines(old => old.map(line => line.product.id === id ? { ...line, ...patch } : line));
  const selectCustomer = (value: string, field: 'name' | 'phone') => {
    const customer = bootstrap?.customers.find(c => field === 'name'
      ? c.name.toLocaleLowerCase() === value.trim().toLocaleLowerCase()
      : c.phone === value.trim());
    if (!customer) return;
    setCustomerName(customer.name); setCustomerPhone(customer.phone);
    setFatherName(customer.fatherName || ''); setAddress(customer.address || '');
  };
  const newSale = () => {
    setLines([]);setCustomerName('');setCustomerPhone('');setFatherName('');setAddress('');
    setPaid('');setDiscount('');setPaymentMethod('Cash');setBankAccountId('');
    setFinished(null);setFeedback('');setError('');
    setOutcomeUnknown(false);setSalesChecked(false);setRecentSales([]);
    requestAnimationFrame(() => productRef.current?.focus());
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
      customerId: selectedCustomer?.id,
      customerName: customerName.trim(), customerPhone: customerPhone.trim(),
      customerAddress: address.trim(), customerFatherName: fatherName.trim(),
      discount: discountAmount, paymentType,
      paidAmount: paymentType === 'Partial' ? paidAmount : 0,
      paymentMethod: method, bankAccountId: requiresAccount ? bankAccountId : '',
      items: lines.map(l => ({
        productId: l.product.id, name: l.product.name, qty: l.qty,
        unitPrice: l.price, fulfillmentMode: 'own'
      }))
    };
    setSaving(true);setError('');
    try {
      const result = await postSale(payload);
      setFinished(result.invoice);
      setReviewOpen(false);
      await load();
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

  return <section className="pos-screen mx-auto max-w-[1440px] space-y-4" data-live-pos>
    <PageHeader title="POS" titleBn="বিক্রি" description="HisabIQ POS layout · Live single-unit sales through BanijjIQ API"
      actions={<div className="flex flex-wrap items-center gap-2">
        <span className="hidden items-center gap-2 rounded-lg border border-border bg-card px-2 py-1 text-[11px] text-ink-500 lg:flex">
          <Keyboard className="size-3.5"/><kbd>F2</kbd> Search <kbd>F8</kbd> Paid
        </span>
        <StatusBadge tone="teal">Real API · Basic POS</StatusBadge>
        <Button variant="outline" size="sm" disabled={busy || saving} onClick={() => void load()}>
          <RefreshCw className="size-3.5"/> Refresh
        </Button>
      </div>} />
    <p className="rounded-lg border border-warning/25 bg-warning-bg px-3 py-2 text-xs text-warning">
      Real transactions: basic whole-unit sales only. Tracked stock, multi-unit, vendor/negative stock, bundles, installments, split payment, drafts, returns and invoice printing are not yet connected here.
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
        <span>{simpleCount} regular sellable products</span>
        <span>{excludedCount} products require advanced handling or stock</span>
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
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card" data-cart-kind="sale">
            <header className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <h2 className="text-sm font-semibold text-ink">Products <span className="font-bn font-normal text-xs text-ink-500">· বিক্রির তালিকা</span></h2>
              <span className="text-xs text-ink-500">{lines.length} lines</span>
            </header>
            <div className="overflow-x-auto">
              <div className="grid min-w-[670px] grid-cols-[28px_minmax(160px,1fr)_82px_110px_110px_28px] gap-2 border-b border-border bg-ink-50 px-3 py-2 text-[11px] font-medium uppercase text-ink-500">
                <span>#</span><span>Product</span><span className="text-right">Qty</span>
                <span className="text-right">Price</span><span className="text-right">Total</span><span></span>
              </div>
              {lines.map((line,index) => <div key={line.product.id}
                className="grid min-w-[670px] grid-cols-[28px_minmax(160px,1fr)_82px_110px_110px_28px] items-center gap-2 border-b border-border px-3 py-2">
                <span className="text-right text-xs text-ink-400">{index+1}.</span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-ink">{line.product.name}</p>
                  <p className="text-[11px] text-ink-500">{line.product.unit} · {line.product.stock} available</p>
                </div>
                <Input ref={node => { quantityRefs.current[line.product.id] = node; }}
                  type="number" min="1" step="1" value={line.qty}
                  aria-label={'Quantity for '+line.product.name}
                  onChange={e => patchLine(line.product.id,{qty:Number(e.target.value)})}
                  onKeyDown={e => { if(e.key === 'Enter'){e.preventDefault();productRef.current?.focus();} }}
                  className="h-9 w-full text-right" />
                <Input type="number" min="0" step="0.01" value={line.price}
                  aria-label={'Price for '+line.product.name}
                  onChange={e => patchLine(line.product.id,{price:Number(e.target.value)})}
                  className="h-9 w-full text-right"/>
                <strong className="text-right text-[13px] font-semibold">{taka(line.qty*line.price)}</strong>
                <button type="button" className="rounded p-1 text-ink-400 hover:bg-danger-bg hover:text-danger"
                  aria-label={'Remove '+line.product.name}
                  onClick={() => setLines(old => old.filter(l => l.product.id !== line.product.id))}>
                  <Trash2 className="size-4"/>
                </button>
              </div>)}
              {!lines.length && <div className="p-6 text-center text-sm text-ink-500">
                No products added · <span className="font-bn">পণ্য যোগ করুন</span>
              </div>}
            </div>
            <div className="border-t border-border px-3 py-3">
              <label className="mb-1.5 block text-xs font-medium text-ink-700">Add product · <span className="font-bn">পণ্য যোগ করুন</span></label>
              <ProductCombobox ref={productRef} products={selectable} onSelect={addProduct}
                ariaLabel="Add real BanijjIQ product" disabled={saving}/>
            </div>
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
        <aside className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-card" aria-label="Live checkout">
          <div className="space-y-3 border-b border-border p-3.5">
            <div className="flex items-center justify-between">
              <div><h2 className="text-sm font-semibold text-ink">Sale checkout</h2>
                <p className="font-bn text-[11px] text-ink-500">বিক্রির টাকা নিন</p></div>
              <button type="button" onClick={newSale} className="text-xs font-medium text-teal-700 hover:underline">New sale</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="min-w-0 text-xs text-ink-700">Customer name *
                <Input list="live-pos-customer-names" value={customerName}
                  onChange={e=>setCustomerName(e.target.value)}
                  onBlur={()=>selectCustomer(customerName,'name')} className="mt-1 h-9" />
                <datalist id="live-pos-customer-names">{bootstrap.customers.map(c=><option key={c.id} value={c.name}/>)}</datalist>
              </label>
              <label className="min-w-0 text-xs text-ink-700">Phone *
                <Input list="live-pos-customer-phones" inputMode="tel" value={customerPhone}
                  onChange={e=>setCustomerPhone(e.target.value)}
                  onBlur={()=>selectCustomer(customerPhone,'phone')} className="mt-1 h-9" />
                <datalist id="live-pos-customer-phones">{bootstrap.customers.map(c=><option key={c.id} value={c.phone}/>)}</datalist>
              </label>
            </div>
            {selectedCustomer && <div className="flex justify-between gap-2 rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">
              <span>Previous due · আগের বাকি</span><strong>{taka(selectedCustomer.currentDue)}</strong>
            </div>}
            <button type="button" onClick={()=>setDetailsOpen(v=>!v)} className="text-left text-xs text-teal-700 hover:underline">
              {detailsOpen?'−':'+'} More customer details
            </button>
            {detailsOpen && <div className="grid grid-cols-2 gap-2">
              <label className="text-xs">Father name<Input value={fatherName} onChange={e=>setFatherName(e.target.value)} className="mt-1 h-9"/></label>
              <label className="text-xs">Address<Input value={address} onChange={e=>setAddress(e.target.value)} className="mt-1 h-9"/></label>
            </div>}
          </div>
          <div className="space-y-3 p-3.5">
            <div className="flex items-center justify-between text-sm text-ink-600"><span>Subtotal</span><strong className="text-ink">{taka(subtotal)}</strong></div>
            <label className="flex items-center justify-between gap-2 text-sm text-ink-600">
              Discount · ছাড় <Input type="number" min="0" step="0.01" value={discount}
                onChange={e=>setDiscount(e.target.value)} className="h-9 w-28 text-right"/>
            </label>
            <div className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-3">
              <span className="text-xs text-ink-600">Total payable · সর্বমোট</span>
              <div className="text-right text-[28px] font-semibold tracking-tight text-ink">{taka(total)}</div>
            </div>
            <label className="block text-xs text-ink-700">
              Amount received · কত টাকা পেলেন
              <Input ref={paidRef} type="number" min="0" step="0.01" value={paid}
                onChange={e=>setPaid(e.target.value)} placeholder="Blank for full due" className="mt-1 h-9 w-full"/>
            </label>
            <label className="block text-xs text-ink-700">
              Payment method · টাকা নিলেন
              <select value={paymentMethod} onChange={e=>{setPaymentMethod(e.target.value as typeof paymentMethod);setBankAccountId('');}}
                className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-ink">
                <option>Cash</option><option>Bank</option><option>Mobile Banking</option>
              </select>
            </label>
            {requiresAccount && <label className="block text-xs text-ink-700">Payment account *
              <select value={bankAccountId} onChange={e=>setBankAccountId(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-ink">
                <option value="">Select account</option>{matchingAccounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>}
            {due > 0 && <div className="flex items-center justify-between rounded-lg bg-danger-bg p-2 text-xs text-danger"><span>Due · বাকি</span><strong>{taka(due)}</strong></div>}
            {errors.length > 0 && <p className="flex items-start gap-2 rounded-lg bg-warning-bg p-2 text-xs text-warning" role="alert">
              <AlertTriangle className="size-4 shrink-0"/>{errors[0]}
            </p>}
            <Button className="h-12 w-full" disabled={saving || errors.length > 0 || !!finished}
              onClick={()=>setReviewOpen(true)}>Review and post real sale</Button>
            <p className="text-center text-[11px] text-ink-500">Saves inventory, cash and customer ledger through BanijjIQ backend.</p>
          </div>
        </aside>
      </div>
    </>}
    <Dialog open={reviewOpen} onOpenChange={open=>!saving&&setReviewOpen(open)}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Confirm real sale · বিক্রি নিশ্চিত করুন</DialogTitle>
          <DialogDescription>This is not a demo. Confirming posts stock, payment and customer dues to BanijjIQ.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 rounded-lg bg-ink-50 p-3 text-sm">
          <p className="flex justify-between"><span>Customer</span><strong>{customerName}</strong></p>
          <p className="flex justify-between"><span>Products</span><strong>{lines.length}</strong></p>
          <p className="flex justify-between"><span>Grand total</span><strong>{taka(total)}</strong></p>
          <p className="flex justify-between"><span>Paid</span><strong>{taka(paidAmount)}</strong></p>
          <p className="flex justify-between"><span>Due</span><strong>{taka(due)}</strong></p>
        </div>
        <DialogFooter><Button variant="outline" disabled={saving} onClick={()=>setReviewOpen(false)}>Cancel</Button>
          <Button disabled={saving || errors.length > 0} onClick={()=>void confirmPost()}>
            {saving?'Posting…':'Confirm and post'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!finished} onOpenChange={open=>{if(!open && !saving)newSale();}}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><CheckCircle2 className="size-5 text-success"/> Sale posted successfully</DialogTitle>
          <DialogDescription>BanijjIQ confirmed this invoice and posted the transaction.</DialogDescription></DialogHeader>
        <div className="space-y-2 rounded-lg border border-border bg-ink-50 p-3 text-sm">
          <p>Invoice <strong>{finished?.invoiceId}</strong></p>
          <p>Customer <strong>{finished?.customerName}</strong></p>
          <p>Total <strong>{taka(finished?.grandTotal || 0)}</strong></p>
          <p>Due <strong>{taka(finished?.dueAmount || 0)}</strong></p>
        </div>
        <p className="text-xs text-ink-500">Invoice printing and editing are not yet integrated in React. Use the existing Vue application for those workflows.</p>
        <DialogFooter><Button onClick={newSale}>New Sale</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
