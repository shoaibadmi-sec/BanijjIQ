import { useState } from 'react';
import { ArrowLeft, RefreshCw, Search, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/Dialog';
import { Input } from '../components/Input';
import { PageHeader } from '../components/PageHeader';
import { SerialPickerDialog } from '../components/pos/SerialPickerDialog';
import { canUseModule, useBackendSession } from './BackendGate';
import {
  BackendRequestError, searchReturnInvoices, getReturnableInvoice, postSalesReturn,
  getSalesReturnHistory, type ReturnInvoiceMatch, type ReturnableInvoice, type SalesReturnPayload,
  getMixedReversalPreview,postMixedReversal,type MixedReversalPreview,
  type ReturnMixedUnit, getStoreCreditAccount, type StoreCreditAccount,
  getSplitReversalPreview, postSplitReversal, type SplitReversalPreview
} from './banijjApi';
import type { Product } from '../types/erp';

type Item = { productId:string;qty:number;unitPrice:number;serialNumbers:string[];
  unitQuantities?:Record<string,number>;lineTotal?:number };
const money=(n:number)=>'৳'+Number(n||0).toLocaleString('en-BD',{maximumFractionDigits:2});
const emptySerials:string[]=[];

export function LiveSalesReturnsPage(){
  const user=useBackendSession();
  const canView=canUseModule(user,'returns','view');
  const canPost=canUseModule(user,'returns','add');
  const canReverse=canPost&&canUseModule(user,'sales','delete');
  const [search,setSearch]=useState('');
  const [matches,setMatches]=useState<ReturnInvoiceMatch[]>([]);
  const [sale,setSale]=useState<ReturnableInvoice|null>(null);
  const [items,setItems]=useState<Item[]>([]);
  const [picker,setPicker]=useState<string|null>(null);
  const [refundMethod,setRefundMethod]=useState<'Cash'|'Store Credit'>('Cash');
  const [creditAccount,setCreditAccount]=useState<StoreCreditAccount|null>(null);
  const [reason,setReason]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState<{id:string;amount:number;method:string}|null>(null);
  const [unknown,setUnknown]=useState(false);
  const [history,setHistory]=useState<Array<{returnId:string;invoiceId:string;totalReturnAmount:number}>>([]);
  const [historyChecked,setHistoryChecked]=useState(false);
  const [review,setReview]=useState(false);
  const [reversalPreview,setReversalPreview]=useState<MixedReversalPreview|null>(null);
  const [reversalReason,setReversalReason]=useState('');
  const [reversalLoading,setReversalLoading]=useState(false);
  const [reversalPosted,setReversalPosted]=useState<{id:string;amount:number;method:string;account:string}|null>(null);
  const [posting,setPosting]=useState(false);
  const [splitPreview,setSplitPreview]=useState<SplitReversalPreview|null>(null);
  const [splitReason,setSplitReason]=useState('');
  const [splitLoading,setSplitLoading]=useState(false);
  const [splitSuccess,setSplitSuccess]=useState<{id:string;refundCents:number;creditReissueCents:number}|null>(null);
  const activeLine=sale?.items.find(x=>x.productId===picker);
  const activeItem=items.find(x=>x.productId===picker);
  const selected=items.filter(x=>x.qty>0);
  const total=Math.round(selected.reduce((a,b)=>a+(b.lineTotal??b.qty*b.unitPrice),0)*100)/100;
  const remainingPaid=sale?Math.max(0,sale.paidAmount-sale.previouslyReturnedAmount):0;
  const problems:string[]=[];
  if(!canPost)problems.push('You cannot post Sales Returns.');
  if(!sale)problems.push('Select a saved invoice.');
  if(!selected.length)problems.push('Select at least one returned item.');
  if(!reason.trim())problems.push('Enter the reason for returning.');
  if(total<=0)problems.push('Return amount must be greater than zero.');
  if(sale&&total>sale.netSale+0.00001)problems.push('Return amount exceeds the unreturned invoice balance.');
  if(sale?.paymentMethod==='Store Credit')problems.push('Store Credit-paid sale needs a dedicated credit reissue. Cash refunds are blocked.');
  if(sale?.paymentMethod==='Split')problems.push('Split payments require original-source full reversal; partial Cash refund is disabled.');
  if(refundMethod==='Store Credit'){
    if(!sale?.customerId||sale.paymentMethod!=='Cash'||sale.dueAmount!==0||
       Math.round(sale.paidAmount*100)!==Math.round(sale.grandTotal*100))
      problems.push('Store Credit requires a linked customer and original fully paid cash sale.');
    if(!creditAccount||creditAccount.blocked)
      problems.push('Customer Store Credit is unavailable or needs reconciliation.');
  }
  if(refundMethod==='Cash'&&total>remainingPaid+0.00001)
    problems.push('Cash refund exceeds paid funds remaining. Customer Store Credit returns are not enabled on this React screen yet.');
  if(sale?.items.some(line=>{
    const item=items.find(x=>x.productId===line.productId);
    return !!item&&(item.qty<0||!Number.isInteger(item.qty)||item.qty>line.availableQty||
      (!line.mixedUnit&&item.qty>0&&item.unitPrice>line.unitPrice)||
      (Boolean(line.mixedUnit)&&(!item.unitQuantities||
        Object.entries(item.unitQuantities).some(([unit,count])=>
          !Number.isSafeInteger(count)||count<0||count>Number(line.mixedUnit?.availableQuantities[unit]||0)))));
  }))problems.push('Return quantity/price exceeds the eligible saved invoice amount.');
  if(sale?.items.some(line=>Boolean(line.trackSerial)&&
    (items.find(i=>i.productId===line.productId)?.qty||0)>0&&
    (items.find(i=>i.productId===line.productId)?.serialNumbers.length||0)!==
    (items.find(i=>i.productId===line.productId)?.qty||0)))
    problems.push('Select exactly the returned serial numbers.');
  if(unknown)problems.push('Return outcome is uncertain. Check return history first.');

  const find=async()=>{
    if(!search.trim())return;
    setBusy(true);setError('');setSale(null);setItems([]);setSuccess(null);setCreditAccount(null);setMatches([]);setReversalPreview(null);setReversalPosted(null);setSplitPreview(null);setSplitReason('');setSplitSuccess(null);
    try{const result=await searchReturnInvoices(search.trim());setMatches(result.matches);}
    catch(e){setError(e instanceof Error?e.message:'Could not search invoices.');}
    finally{setBusy(false);}
  };
  const choose=async(id:string)=>{
    setBusy(true);setError('');setSale(null);setItems([]);setSuccess(null);setCreditAccount(null);setReversalPreview(null);setReversalPosted(null);setSplitPreview(null);setSplitReason('');setSplitSuccess(null);
    try{
      const result=await getReturnableInvoice(id);
      setSale(result.sale);
      setItems(result.sale.items.map(x=>({productId:x.productId,qty:0,unitPrice:x.unitPrice,serialNumbers:[],
        ...(x.mixedUnit?{unitQuantities:{},lineTotal:0}:{})})));
      setRefundMethod('Cash');
      if(result.sale.customerId){
        try{setCreditAccount(await getStoreCreditAccount(result.sale.customerId));}
        catch{setCreditAccount(null);}
      }
      setMatches([]);
    }catch(e){setError(e instanceof Error?e.message:'Could not read invoice.');}
    finally{setBusy(false);}
  };
  const change=(id:string,patch:Partial<Item>)=>{
    setItems(old=>old.map(x=>x.productId===id?{...x,...patch,
      ...(patch.qty!==undefined?{serialNumbers:[]}:{} )}:x));
  };
  const changeMixed=(id:string,unit:string,value:number)=>{
    const line=sale?.items.find(x=>x.productId===id),mixed=line?.mixedUnit;
    if(!mixed)return;
    setItems(current=>current.map(item=>{
      if(item.productId!==id)return item;
      const quantities={...item.unitQuantities,[unit]:value};
      let base=0,cents=0;
      for(const u of mixed.profile.units){
        const count=quantities[u.unit]||0;
        base+=count*u.factor;
        cents+=count*Math.round(u.sellingPrice*100);
      }
      const amount=Math.round(cents*mixed.netPriceFactor)/100;
      return{...item,unitQuantities:quantities,qty:base,unitPrice:base?amount/base:0,lineTotal:amount,serialNumbers:[]};
    }));
  };
  const post=async()=>{
    if(posting||problems.length){setError(problems[0]||'Cannot return this sale.');return;}
    if(!window.confirm('Post a REAL sales return for '+money(total)+'? '+
      (refundMethod==='Store Credit'?'Issue non-cash credit to this customer? No cash or bank payout.':'Pay a real cash refund?')
      ))return;
    setPosting(true);setError('');setReview(false);
    const payload:SalesReturnPayload={
      invoiceId:sale!.invoiceId,refundMethod,reason:reason.trim(),
      items:selected.map(i=>({productId:i.productId,qty:i.qty,unitPrice:i.unitPrice,
        ...(i.unitQuantities?{unitQuantities:i.unitQuantities}:{}),
        ...(sale!.items.find(x=>x.productId===i.productId)?.trackSerial?{serialNumbers:i.serialNumbers}:{})}))
    };
    try{
      const r=await postSalesReturn(payload);
      setSuccess({id:r.returnId,amount:r.totalReturnAmount,method:refundMethod});
      setSale(null);setItems([]);setReason('');
    }catch(e){
      const uncertain=!(e instanceof BackendRequestError)||e.status===null||e.status>=500;
      if(uncertain){setUnknown(true);
        setError('The return may have been posted. Do not retry before verifying Return History and the ledger.');}
      else setError(e instanceof Error?e.message:'Return rejected.');
    }finally{setPosting(false);}
  };
  const previewFullReversal=async()=>{
    if(!canReverse||!sale||reversalLoading||posting||unknown)return;
    setReversalLoading(true);setError('');setReversalPreview(null);
    try{setReversalPreview((await getMixedReversalPreview(sale.invoiceId)).preview);}
    catch(e){setError(e instanceof Error?e.message:'Could not verify full reversal eligibility.');}
    finally{setReversalLoading(false);}
  };
  const submitFullReversal=async()=>{
    if(!canReverse||!sale||!reversalPreview?.eligible||reversalReason.trim().length<8||posting||unknown)return;
    if(!window.confirm('Complete the FULL remaining reversal for invoice '+sale.invoiceId+
      (reversalPreview.refundMethod==='Due Adjustment'?' and cancel customer due of ':' and issue a real '+reversalPreview.refundMethod+' refund of ')+money(reversalPreview.refundAmount)+
      (reversalPreview.refundAccountName?' to '+reversalPreview.refundAccountName:'')+
      '? This preserves the original invoice and creates a permanent reversal journal.'))return;
    setPosting(true);setError('');
    try{
      const saved=await postMixedReversal(sale.invoiceId,reversalReason.trim());
      setReversalPosted({id:saved.returnId,amount:saved.totalReturnAmount,
        method:reversalPreview.refundMethod,account:reversalPreview.refundAccountName});
      setReversalPreview(null);setSale(null);setItems([]);setReason('');setReversalReason('');
    }catch(e){
      const uncertain=!(e instanceof BackendRequestError)||e.status===null||e.status>=500;
      if(uncertain){
        setUnknown(true);setError('Reversal outcome is uncertain. Verify the original invoice and Return History before trying again.');
      }else setError(e instanceof Error?e.message:'Full reversal was rejected.');
    }finally{setPosting(false);}
  };
  const previewSplit=async()=>{
    if(!canPost||!sale||sale.paymentMethod!=='Split'||posting||splitLoading||unknown)return;
    setSplitLoading(true);setError('');setSplitPreview(null);setSplitReason('');
    try{setSplitPreview((await getSplitReversalPreview(sale.invoiceId)).preview);}
    catch(e){setError(e instanceof Error?e.message:'Original sources could not be verified.');}
    finally{setSplitLoading(false);}
  };
  const submitSplit=async()=>{
    if(!canPost||!sale||sale.paymentMethod!=='Split'||!splitPreview?.eligible||
      splitPreview.invoiceId!==sale.invoiceId||splitReason.trim().length<8||posting||unknown)return;
    if(!window.confirm('Reverse the ENTIRE invoice '+sale.invoiceId+'? Refund '+money(splitPreview.refundCents/100)+
      ' ONLY to original Cash/Bank/Mobile sources and reissue '+money(splitPreview.creditReissueCents/100)+
      ' as Store Credit (not Cash)?'))return;
    setPosting(true);setError('');
    try{
      const saved=await postSplitReversal(sale.invoiceId,splitReason.trim());
      setSplitSuccess({id:saved.returnId,refundCents:saved.refundCents,
        creditReissueCents:saved.creditReissueCents});
      setSplitPreview(null);setSplitReason('');setSale(null);setItems([]);setReason('');
    }catch(e){
      const uncertain=!(e instanceof BackendRequestError)||e.status===null||e.status>=500;
      if(uncertain){setUnknown(true);setError('Refund outcome unknown. Verify Return History and source ledgers before retrying.');}
      else{setSplitPreview(null);setError(e instanceof Error?e.message:'Source-specific refund rejected.');}
    }finally{setPosting(false);}
  };
  const checkHistory=async()=>{
    setBusy(true);setError('');setHistoryChecked(false);
    try{setHistory((await getSalesReturnHistory()).returns.slice(0,30));setHistoryChecked(true);}
    catch(e){setError(e instanceof Error?e.message:'Could not verify return history.');}
    finally{setBusy(false);}
  };
  if(!canView)return <p role="alert" className="rounded-xl border border-danger p-4 text-danger">
    You do not have permission to view Sales Returns. · ফেরত অনুমতি নেই
  </p>;
  return <section className="mx-auto max-w-[1200px] space-y-4" data-live-sales-returns>
    <PageHeader title="Sales Returns" titleBn="বিক্রয় ফেরত"
      description="HisabIQ compact return workflow · Real BanijjIQ invoice and stock"
      actions={<Link to="/app/pos" className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium text-teal-700">
        <ArrowLeft className="size-4"/> Back to POS
      </Link>}/>
    <p className="rounded-lg border border-warning/25 bg-warning-bg px-3 py-2 text-xs text-warning">
      Mixed-unit returns use original saved unit quantities and their historical discounted net prices. Tracked mixed-unit returns and vendor-sourced quantities remain unavailable here.
      Store Credit issuance is available for linked, fully paid, reconciled cash-sale customers. Verified full split refunds use the separate source-specific review; partial split returns, batch returns and higher-price adjustments remain unavailable.
    </p>
    {error&&<p role="alert" className="rounded-lg bg-danger-bg p-3 text-sm text-danger">{error}</p>}
    {unknown&&<div role="alert" className="space-y-2 rounded-xl border border-danger bg-danger-bg p-3">
      <p className="text-xs font-medium text-danger">Unknown posting outcome · ফেরত যাচাই করুন</p>
      <Button variant="outline" size="sm" disabled={busy} onClick={()=>void checkHistory()}>
        <RefreshCw className="size-4"/> Check real Return History
      </Button>
      {history.map(h=><p className="text-xs" key={h.returnId}>{h.returnId} · {h.invoiceId} · {money(h.totalReturnAmount)}</p>)}
      {historyChecked&&<Button variant="outline" size="sm" onClick={()=>{
        setUnknown(false);setSale(null);setItems([]);setHistory([]);setHistoryChecked(false);setError('');
      }}>I verified the invoice and return ledger — start a fresh search</Button>}
    </div>}
    {splitSuccess&&<div role="status" data-split-refund-success className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm">
      <CheckCircle2 className="mr-2 inline size-4 text-success"/>
      Refund posted <strong>{splitSuccess.id}</strong> · Cash/Bank/Mobile <strong>{money(splitSuccess.refundCents/100)}</strong> ·
      Store Credit reissued <strong>{money(splitSuccess.creditReissueCents/100)}</strong> (no cash conversion).
      Original invoice remains for audit.
    </div>}
    {reversalPosted&&<div role="status" className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm">
      <CheckCircle2 className="mr-2 inline size-4 text-success"/>
      Full invoice reversed: <strong>{reversalPosted.id}</strong> · {reversalPosted.method==='Due Adjustment'?'Customer due cancelled':reversalPosted.method+' refund'} {money(reversalPosted.amount)}
      {reversalPosted.account?' · '+reversalPosted.account:''}.
      Original invoice remains visible for audit. <Link to="/app/pos" className="ml-2 font-semibold text-teal-700 underline">Create corrected sale</Link>
    </div>}
    {success&&<div role="status" className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm">
      <CheckCircle2 className="mr-2 inline size-4 text-success"/>
      Return posted: <strong>{success.id}</strong> · {money(success.amount)}
      {success.method==='Store Credit'&&<span className="ml-2">Customer credit issued · ক্রেডিট জমা (নগদ ফেরত নয়)</span>}
    </div>}
    <div className="rounded-xl border border-border bg-card p-3 shadow-card">
      <label className="mb-1 block text-xs font-medium text-ink-700">Invoice / customer / phone · চালান খুঁজুন</label>
      <div className="flex gap-2">
        <Input value={search} onChange={e=>setSearch(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void find();}}}
          placeholder="Invoice number, name or mobile" className="h-9" aria-label="Search saved invoices"/>
        <Button disabled={busy||posting||unknown||!search.trim()} onClick={()=>void find()}>
          <Search className="size-4"/> Search
        </Button>
      </div>
      {matches.length>0&&<div className="mt-3 divide-y divide-border rounded-lg border border-border">
        {matches.map(m=><button type="button" key={m.invoiceId} onClick={()=>void choose(m.invoiceId)}
          className="flex w-full items-center justify-between gap-3 p-3 text-left text-xs hover:bg-teal-50">
          <span><strong>{m.invoiceId}</strong><span className="block text-ink-500">{m.customerName} · {m.date} · {m.returnStatus}</span></span>
          <strong className="shrink-0">{money(m.grandTotal)}</strong>
        </button>)}
      </div>}
      {busy&&<p className="mt-2 text-xs text-ink-500">Loading saved data…</p>}
    </div>
    {sale&&<div className="space-y-3 rounded-xl border border-border bg-card p-3 shadow-card">
      <div className="flex flex-wrap justify-between gap-2 border-b border-border pb-2 text-sm">
        <span><strong>{sale.invoiceId}</strong> · {sale.customerName}</span>
        <strong>Remaining {money(sale.netSale)}</strong>
      </div>
      {creditAccount&&<div data-return-store-credit-summary className="rounded-lg border border-teal-200 bg-teal-50/40 p-2.5 text-xs text-ink-700">
        <div className="flex justify-between gap-2"><span>Customer due · ক্রেতার বাকি</span><strong>{money(creditAccount.due)}</strong></div>
        <div className="mt-1 flex justify-between gap-2"><span>Store Credit · জমা ক্রেডিট</span><strong>{money(creditAccount.availableCents/100)}</strong></div>
        {creditAccount.blocked&&<p role="alert" className="mt-1 text-warning">Old Store Credit needs verification · পুরোনো ক্রেডিট যাচাই দরকার</p>}
        {creditAccount.history.length>0&&<details className="mt-2"><summary className="cursor-pointer">Credit history · ক্রেডিট হিসাব</summary>
          <div className="mt-1 space-y-1">{creditAccount.history.slice(0,5).map(e=><div key={e.entryId} className="flex justify-between gap-2">
            <span>{e.type==='ISSUE'?'Issued · জমা':'Used · খরচ'} · {e.sourceId}</span><strong>{money(e.deltaCents/100)}</strong>
          </div>)}</div>
        </details>}
      </div>}
      {sale.paymentMethod==='Split'&&<div data-split-refund-review className="space-y-3 rounded-lg border border-primary/30 bg-ink-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><p className="text-sm font-semibold">Full split refund · মূল মাধ্যমেই ফেরত</p>
            <p className="mt-1 text-xs text-ink-600">Entire invoice only. No partial refund or Store Credit cash conversion.</p></div>
          <Button type="button" size="sm" variant="outline" disabled={!canPost||busy||posting||splitLoading||unknown}
            onClick={()=>void previewSplit()}>{splitLoading?'Verifying…':'Verify original payment sources'}</Button>
        </div>
        {splitPreview&&!splitPreview.eligible&&<p role="alert" className="rounded-md bg-warning-bg p-2 text-xs text-warning">{splitPreview.reason}</p>}
        {splitPreview?.eligible&&splitPreview.invoiceId===sale.invoiceId&&<>
          <p className="text-xs font-medium">Verified original allocations · মূল পরিশোধ</p>
          <div className="rounded-lg border border-border bg-card p-2 text-xs">
            {splitPreview.allocations.map((a,i)=><div key={a.sourceKey+':'+i}
              className="flex items-center justify-between gap-2 border-b border-border py-1.5">
              <span>{a.method==='Store Credit'?'Store Credit · নগদ নয়':a.method}
                {a.bankAccountId?' · '+a.bankAccountId:''}</span>
              <strong>{money(a.amountCents/100)}</strong>
            </div>)}
          </div>
          <p className="text-xs">Cash / Bank / Mobile returned to original accounts · <strong>{money(splitPreview.refundCents/100)}</strong></p>
          <p className="text-xs">Store Credit liability reissued · ক্রেডিট জমা · <strong>{money(splitPreview.creditReissueCents/100)}</strong></p>
          <label className="block text-xs">Reason · কারণ (at least 8 characters)
            <Input className="mt-1 h-9" maxLength={500} aria-label="Split refund reason"
              value={splitReason} onChange={e=>setSplitReason(e.target.value)}
              placeholder="Why reverse this entire split invoice?"/>
          </label>
          <Button type="button" className="h-12 w-full"
            disabled={posting||unknown||splitReason.trim().length<8}
            onClick={()=>void submitSplit()}>{posting?'Posting…':'Confirm full original-source refund'}</Button>
        </>}
      </div>}
      {canReverse&&sale.paymentMethod!=='Split'&&sale.items.some(line=>Boolean(line.mixedUnit))&&
        <div data-mixed-full-reversal className="space-y-2 rounded-lg border border-border bg-ink-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-ink-700">Full invoice reversal · সম্পূর্ণ চালান বাতিল</span>
            <Button type="button" size="sm" variant="outline" disabled={busy||posting||reversalLoading||unknown}
              onClick={()=>void previewFullReversal()}>
              {reversalLoading?'Checking…':'Check full reversal'}
            </Button>
          </div>
          <p className="text-[11px] text-ink-500">Complete remaining original units through an audited reversal. Fully unpaid invoices cancel only their customer due, with no cash payout. Paid refunds use their original payment account.</p>
          {reversalPreview&&!reversalPreview.eligible&&
            <p role="alert" className="rounded-md bg-warning-bg p-2 text-xs text-warning">{reversalPreview.reason}</p>}
          {reversalPreview?.eligible&&<>
            <p className="text-xs text-ink-700">Remaining: {reversalPreview.items.length} lines · {reversalPreview.remainingBaseQuantity} base units · {reversalPreview.refundMethod==='Due Adjustment'?'Due to cancel':reversalPreview.refundMethod+' refund'} <strong>{money(reversalPreview.refundAmount)}</strong></p>
            {reversalPreview.refundMethod==='Due Adjustment'&&<p data-reversal-due-notice className="text-[11px] text-ink-600">Customer receivable {money(reversalPreview.customerDueBefore)} → ৳0 · No cash refund · বাকি বাতিল</p>}
            {reversalPreview.refundAccountName&&<p data-reversal-bank-account className="text-[11px] text-ink-600">Refund to original {reversalPreview.refundMethod} account: <strong>{reversalPreview.refundAccountName}</strong> · মূল হিসাবে ফেরত</p>}
            {reversalPreview.previouslyRefundedAmount>0&&<p data-prior-refunds className="text-[11px] text-ink-600">Already refunded: {money(reversalPreview.previouslyRefundedAmount)} · Prior returns stay unchanged</p>}
            <label className="block text-[11px] text-ink-600">Reversal reason · বাতিলের কারণ
              <Input className="mt-1 h-9" value={reversalReason} maxLength={500}
                aria-label="Full invoice reversal reason"
                placeholder="Why is this entire invoice being reversed?"
                onChange={e=>setReversalReason(e.target.value)}/>
            </label>
            <Button type="button" disabled={posting||unknown||reversalReason.trim().length<8}
              onClick={()=>void submitFullReversal()}>
              {posting?'Reversing…':'Review and reverse entire invoice'}
            </Button>
          </>}
        </div>}
      {sale.paymentMethod!=='Split'&&<>
      <p className="text-xs text-ink-500">Only original eligible items can be returned. Qty 0 skips a line.</p>
      {sale.items.map(line=>{
        const item=items.find(x=>x.productId===line.productId);
        if(!item)return null;
        return <div className="flex flex-wrap items-center gap-2 border-b border-border py-2" key={line.productId}>
          <div className="min-w-[150px] flex-1">
            <p className="text-[13px] font-medium text-ink">{line.name}</p>
            <p className="text-[11px] text-ink-500">{line.availableQty} returnable · {money(line.unitPrice)} original
              {line.vendorQty>0?' · '+line.vendorQty+' vendor-sourced excluded':''}</p>
            {Boolean(line.trackSerial)&&item.qty>0&&
              <button type="button" onClick={()=>setPicker(line.productId)}
                className="text-xs font-medium text-teal-700 hover:underline">
                Serial / IMEI · {item.serialNumbers.length}/{item.qty} selected
              </button>}
          </div>
          {line.mixedUnit ? <div data-mixed-return-quantities className="flex min-w-[200px] max-w-full flex-1 flex-wrap items-end gap-1.5">
            {line.mixedUnit.profile.units.filter(u=>(line.mixedUnit?.originalQuantities[u.unit]||0)>0)
              .map(u=><label key={u.unit} className="min-w-0 text-[10px] text-ink-600">
                {u.symbol} · {line.mixedUnit?.availableQuantities[u.unit]||0} left
                <Input className="mt-1 h-9 w-[65px] px-1 text-right text-[12px]" type="number"
                  min="0" max={line.mixedUnit?.availableQuantities[u.unit]||0} step="1" inputMode="numeric"
                  aria-label={'Return '+u.unit+' for '+line.name}
                  value={item.unitQuantities?.[u.unit]||0}
                  onChange={e=>changeMixed(line.productId,u.unit,Number(e.target.value))}/>
              </label>)}
            <p className="w-full text-[10px] text-ink-500">Return in originally sold units only · Net unit prices preserved</p>
          </div> : <>
            <label className="text-[11px] text-ink-500">Return qty
              <Input className="mt-1 h-9 w-20 text-right" type="number" min="0" max={line.availableQty} step="1"
                aria-label={'Return quantity for '+line.name} value={item.qty}
                onChange={e=>change(line.productId,{qty:Number(e.target.value)})}/>
            </label>
            <label className="text-[11px] text-ink-500">Refund / unit
              <Input className="mt-1 h-9 w-28 text-right" type="number" min="0" max={line.unitPrice} step="0.01"
                aria-label={'Return unit price for '+line.name} value={item.unitPrice}
                onChange={e=>change(line.productId,{unitPrice:Number(e.target.value)})}/>
            </label>
          </>}
          <strong className="w-20 text-right text-[13px]">{money(item.lineTotal??item.qty*item.unitPrice)}</strong>
        </div>;
      })}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-ink-600">Refund method
          <select value={refundMethod} onChange={e=>setRefundMethod(e.target.value as typeof refundMethod)}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-ink">
            <option value="Cash">Cash · নগদ</option><option value="Store Credit">Store Credit · জমা ক্রেডিট</option>
          </select>
        </label>
        <label className="text-xs text-ink-600">Reason * · কারণ
          <Input className="mt-1 h-9" value={reason} onChange={e=>setReason(e.target.value)}
            placeholder="Why was this returned?"/>
        </label>
      </div>
      {refundMethod==='Store Credit'&&<p data-return-credit-no-cash className="text-xs text-teal-700">
        This adds credit for future purchases. No cash or bank refund · ভবিষ্যৎ কেনাকাটার ক্রেডিট, নগদ নয়।
      </p>}
      <div className="flex items-center justify-between rounded-xl border border-teal-200 bg-teal-50 p-3">
        <span className="text-sm">Total refund · ফেরতের টাকা</span>
        <strong className="text-xl">{money(total)}</strong>
      </div>
      {problems.length>0&&<p role="alert" className="flex gap-2 text-xs text-warning">
        <AlertTriangle className="size-4 shrink-0"/>{problems[0]}
      </p>}
      <Button className="h-12 w-full" disabled={posting||busy||problems.length>0}
        onClick={()=>setReview(true)}>Review real return</Button>
      </>}
    </div>}
    {sale&&activeLine&&<SerialPickerDialog
      product={{id:activeLine.productId,name:activeLine.name} as Product}
      open={!!picker} onOpenChange={v=>{if(!v)setPicker(null);}}
      eligible={activeLine.availableSerials} selected={activeItem?.serialNumbers||emptySerials}
      required={activeItem?.qty||0} maxCount={activeItem?.qty||0} blocked={emptySerials}
      onSave={serials=>{if(picker)change(picker,{serialNumbers:serials});}}
    />}
    <Dialog open={review} onOpenChange={v=>!posting&&setReview(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Confirm Sales Return · ফেরত নিশ্চিত করুন</DialogTitle>
          <DialogDescription>{refundMethod==='Store Credit'?
            'Returns stock and issues customer credit liability. No cash/bank movement · নগদ নয়।':
            'Returns stock and pays a real cash refund.'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 rounded-lg bg-ink-50 p-3 text-sm">
          <p>Invoice <strong>{sale?.invoiceId}</strong></p>
          <p>Selected lines <strong>{selected.length}</strong></p>
          <p>Refund <strong>{money(total)}</strong> · {refundMethod}</p>
        </div>
        <DialogFooter><Button variant="outline" onClick={()=>setReview(false)}>Cancel</Button>
          <Button disabled={posting||problems.length>0} onClick={()=>void post()}>
            {posting?'Posting…':refundMethod==='Store Credit'?'Confirm & issue credit':'Confirm & refund'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
