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
  getSalesReturnHistory, type ReturnInvoiceMatch, type ReturnableInvoice, type SalesReturnPayload
} from './banijjApi';
import type { Product } from '../types/erp';

type Item = { productId:string;qty:number;unitPrice:number;serialNumbers:string[] };
const money=(n:number)=>'৳'+Number(n||0).toLocaleString('en-BD',{maximumFractionDigits:2});
const emptySerials:string[]=[];

export function LiveSalesReturnsPage(){
  const user=useBackendSession();
  const canView=canUseModule(user,'returns','view');
  const canPost=canUseModule(user,'returns','add');
  const [search,setSearch]=useState('');
  const [matches,setMatches]=useState<ReturnInvoiceMatch[]>([]);
  const [sale,setSale]=useState<ReturnableInvoice|null>(null);
  const [items,setItems]=useState<Item[]>([]);
  const [picker,setPicker]=useState<string|null>(null);
  const [refundMethod,setRefundMethod]=useState<'Cash'|'Store Credit'>('Cash');
  const [reason,setReason]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState<{id:string;amount:number}|null>(null);
  const [unknown,setUnknown]=useState(false);
  const [history,setHistory]=useState<Array<{returnId:string;invoiceId:string;totalReturnAmount:number}>>([]);
  const [review,setReview]=useState(false);
  const [posting,setPosting]=useState(false);
  const activeLine=sale?.items.find(x=>x.productId===picker);
  const activeItem=items.find(x=>x.productId===picker);
  const selected=items.filter(x=>x.qty>0);
  const total=selected.reduce((a,b)=>a+b.qty*b.unitPrice,0);
  const remainingPaid=sale?Math.max(0,sale.paidAmount-sale.previouslyReturnedAmount):0;
  const problems:string[]=[];
  if(!canPost)problems.push('You cannot post Sales Returns.');
  if(!sale)problems.push('Select a saved invoice.');
  if(!selected.length)problems.push('Select at least one returned item.');
  if(!reason.trim())problems.push('Enter the reason for returning.');
  if(total<=0)problems.push('Return amount must be greater than zero.');
  if(sale&&total>sale.netSale+0.00001)problems.push('Return amount exceeds the unreturned invoice balance.');
  if(refundMethod==='Cash'&&total>remainingPaid+0.00001)
    problems.push('Cash refund exceeds the paid amount remaining; use Store Credit after verifying the customer ledger.');
  if(sale?.items.some(line=>{
    const item=items.find(x=>x.productId===line.productId);
    return !!item&&(item.qty<0||!Number.isInteger(item.qty)||item.qty>line.availableQty||
      (item.qty>0&&item.unitPrice>line.unitPrice));
  }))problems.push('Return quantity/price exceeds the eligible saved invoice amount.');
  if(sale?.items.some(line=>Boolean(line.trackSerial)&&
    (items.find(i=>i.productId===line.productId)?.qty||0)>0&&
    (items.find(i=>i.productId===line.productId)?.serialNumbers.length||0)!==
    (items.find(i=>i.productId===line.productId)?.qty||0)))
    problems.push('Select exactly the returned serial numbers.');
  if(unknown)problems.push('Return outcome is uncertain. Check return history first.');

  const find=async()=>{
    if(!search.trim())return;
    setBusy(true);setError('');setSale(null);setItems([]);setSuccess(null);setMatches([]);
    try{const result=await searchReturnInvoices(search.trim());setMatches(result.matches);}
    catch(e){setError(e instanceof Error?e.message:'Could not search invoices.');}
    finally{setBusy(false);}
  };
  const choose=async(id:string)=>{
    setBusy(true);setError('');setSale(null);setItems([]);setSuccess(null);
    try{
      const result=await getReturnableInvoice(id);
      setSale(result.sale);
      setItems(result.sale.items.map(x=>({productId:x.productId,qty:0,unitPrice:x.unitPrice,serialNumbers:[]})));
      setRefundMethod(result.sale.paidAmount>0?'Cash':'Store Credit');
      setMatches([]);
    }catch(e){setError(e instanceof Error?e.message:'Could not read invoice.');}
    finally{setBusy(false);}
  };
  const change=(id:string,patch:Partial<Item>)=>{
    setItems(old=>old.map(x=>x.productId===id?{...x,...patch,
      ...(patch.qty!==undefined?{serialNumbers:[]}:{} )}:x));
  };
  const post=async()=>{
    if(posting||problems.length){setError(problems[0]||'Cannot return this sale.');return;}
    if(!window.confirm('Post a REAL sales return for '+money(total)+'? This changes stock and cash/customer ledger.'))return;
    setPosting(true);setError('');setReview(false);
    const payload:SalesReturnPayload={
      invoiceId:sale!.invoiceId,refundMethod,reason:reason.trim(),
      items:selected.map(i=>({productId:i.productId,qty:i.qty,unitPrice:i.unitPrice,
        ...(sale!.items.find(x=>x.productId===i.productId)?.trackSerial?{serialNumbers:i.serialNumbers}:{})}))
    };
    try{
      const r=await postSalesReturn(payload);
      setSuccess({id:r.returnId,amount:r.totalReturnAmount});
      setSale(null);setItems([]);setReason('');
    }catch(e){
      const uncertain=!(e instanceof BackendRequestError)||e.status===null||e.status>=500;
      if(uncertain){setUnknown(true);
        setError('The return may have been posted. Do not retry before verifying Return History and the ledger.');}
      else setError(e instanceof Error?e.message:'Return rejected.');
    }finally{setPosting(false);}
  };
  const checkHistory=async()=>{
    setBusy(true);setError('');
    try{setHistory((await getSalesReturnHistory()).returns.slice(0,30));}
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
      Real invoice returns only. Use exact serial numbers for tracked products; vendor-sourced quantities are not returnable as own stock.
      Batch multi-invoice returns and refund-price adjustments above historic net price remain unavailable here.
    </p>
    {error&&<p role="alert" className="rounded-lg bg-danger-bg p-3 text-sm text-danger">{error}</p>}
    {unknown&&<div role="alert" className="space-y-2 rounded-xl border border-danger bg-danger-bg p-3">
      <p className="text-xs font-medium text-danger">Unknown posting outcome · ফেরত যাচাই করুন</p>
      <Button variant="outline" size="sm" disabled={busy} onClick={()=>void checkHistory()}>
        <RefreshCw className="size-4"/> Check real Return History
      </Button>
      {history.map(h=><p className="text-xs" key={h.returnId}>{h.returnId} · {h.invoiceId} · {money(h.totalReturnAmount)}</p>)}
      {history.length>0&&<Button variant="outline" size="sm" onClick={()=>{
        setUnknown(false);setSale(null);setItems([]);setHistory([]);setError('');
      }}>I verified the invoice and return ledger — start a fresh search</Button>}
    </div>}
    {success&&<div role="status" className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm">
      <CheckCircle2 className="mr-2 inline size-4 text-success"/>
      Return posted: <strong>{success.id}</strong> · {money(success.amount)}
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
          <strong className="w-20 text-right text-[13px]">{money(item.qty*item.unitPrice)}</strong>
        </div>;
      })}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-ink-600">Refund method
          <select value={refundMethod} onChange={e=>setRefundMethod(e.target.value as typeof refundMethod)}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-ink">
            <option value="Cash">Cash · নগদ</option><option value="Store Credit">Store Credit · জমা</option>
          </select>
        </label>
        <label className="text-xs text-ink-600">Reason * · কারণ
          <Input className="mt-1 h-9" value={reason} onChange={e=>setReason(e.target.value)}
            placeholder="Why was this returned?"/>
        </label>
      </div>
      <div className="flex items-center justify-between rounded-xl border border-teal-200 bg-teal-50 p-3">
        <span className="text-sm">Total refund · ফেরতের টাকা</span>
        <strong className="text-xl">{money(total)}</strong>
      </div>
      {problems.length>0&&<p role="alert" className="flex gap-2 text-xs text-warning">
        <AlertTriangle className="size-4 shrink-0"/>{problems[0]}
      </p>}
      <Button className="h-12 w-full" disabled={posting||busy||problems.length>0}
        onClick={()=>setReview(true)}>Review real return</Button>
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
          <DialogDescription>This is a real transaction affecting inventory and the cash/customer ledger.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 rounded-lg bg-ink-50 p-3 text-sm">
          <p>Invoice <strong>{sale?.invoiceId}</strong></p>
          <p>Selected lines <strong>{selected.length}</strong></p>
          <p>Refund <strong>{money(total)}</strong> · {refundMethod}</p>
        </div>
        <DialogFooter><Button variant="outline" onClick={()=>setReview(false)}>Cancel</Button>
          <Button disabled={posting||problems.length>0} onClick={()=>void post()}>
            {posting?'Posting…':'Confirm & refund'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
