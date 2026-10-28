<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { notifySuccess, notifyError } from '../utils/notify';
import ModuleTabs from './ModuleTabs.vue';
import SalesInvoiceDetail from './SalesInvoiceDetail.vue';
import {
  completeSalesReturn, deleteSale, getSaleDetail, getSaleReturnData, getSalesManagementList,
  getSalesReturnDetail, getSalesReturnHistory, receiveSalesCustomerPayment, searchSalesInvoicesForReturn
} from '../api';
import type {
  BankAccount, PosLoadRequest, SaleDetail, SaleReturnData, SalesListRow,
  SalesReturnDetail, SalesReturnRecord, SalesReturnSearchResult
} from '../types';

type SalesTab = 'sales' | 'newReturn' | 'returnHistory';
const emit = defineEmits<{ (e:'open-pos', request: PosLoadRequest): void }>();
const props = defineProps<{ openRequest?: { invoiceId?: string; returnId?: string; tab: SalesTab; action?: 'open' | 'edit' | 'delete' | 'return' | 'receive-payment'; nonce: number } | null }>();

const today = new Date().toISOString().slice(0,10);
const activeTab = ref<SalesTab>('sales');
const tabs = [
  { key:'sales', label:'Sales Invoice', hint:'বিক্রির রশিদ' },
  { key:'newReturn', label:'New Return', hint:'বিক্রি ফেরত' },
  { key:'returnHistory', label:'Return History', hint:'আগের ফেরতের তালিকা' }
] as const;

const loading = ref(false);
const error = ref('');
const message = ref('');
const sales = ref<SalesListRow[]>([]);
const returns = ref<SalesReturnRecord[]>([]);
const bankAccounts = ref<BankAccount[]>([]);

const search = ref('');
const dateFrom = ref('');
const dateTo = ref('');
const paymentStatus = ref('');
const returnStatus = ref('');
const detail = ref<SaleDetail|null>(null);
const showView = ref(false);
const showPay = ref(false);
const showDelete = ref(false);
const deleteReason = ref('');
const selected = ref<SalesListRow|null>(null);
const salesActionMenu = ref<{ sale: SalesListRow; left: number; top: number } | null>(null);

const payForm = reactive({ amount:0, method:'Cash', bankAccountId:'', reference:'', note:'' });

const returnSearch = ref('');
const returnMatches = ref<SalesReturnSearchResult[]>([]);
const returnSearchLoading = ref(false);
const returnData = ref<SaleReturnData|null>(null);
const returnForm = reactive({
  refundMethod:'Cash' as 'Cash'|'Store Credit',
  reason:'',
  notes:'',
  date:today,
  backdatedReason:''
});
const returnSaving = ref(false);

const historySearch = ref('');
const returnDetail = ref<SalesReturnDetail|null>(null);

function money(v:number){ return Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
function qty(v:number){ const n=Number(v||0); return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.00$/,''); }
function flash(text:string){ message.value=''; error.value=''; notifySuccess(text); }
function isBackdated(date:string){ return !!date && date < today; }

function closeSalesActions(){ salesActionMenu.value=null; }
function toggleSalesActions(event: MouseEvent, sale: SalesListRow){
  event.stopPropagation();
  if(salesActionMenu.value?.sale.invoiceId===sale.invoiceId){ closeSalesActions(); return; }
  const r=(event.currentTarget as HTMLElement).getBoundingClientRect(),menuWidth=190,menuHeight=232,gap=6;
  const left=Math.max(8,Math.min(r.right-menuWidth,window.innerWidth-menuWidth-8));
  let top=r.bottom+gap;if(top+menuHeight>window.innerHeight-8)top=Math.max(8,r.top-menuHeight-gap);
  salesActionMenu.value={sale,left,top};
}
function onSalesPointerDown(event: PointerEvent){
  const target=event.target as HTMLElement|null;
  if(target?.closest('.sales-action-menu')||target?.closest('.actions-trigger'))return;
  closeSalesActions();
}
function runSalesAction(action:'view'|'duplicate'|'update'|'return'|'delete'){
  const sale=salesActionMenu.value?.sale;if(!sale)return;closeSalesActions();
  if(action==='view')void viewSale(sale);
  else if(action==='duplicate')duplicateSale(sale);
  else if(action==='update')updateSale(sale);
  else if(action==='return')void startReturn(sale.invoiceId);
  else askDelete(sale);
}

const filtered = computed(()=>sales.value.filter(s=>{
  const q=search.value.trim().toLowerCase();
  const matchesQ=!q||s.invoiceId.toLowerCase().includes(q)||s.customerName.toLowerCase().includes(q)||s.customerPhone.includes(q);
  return matchesQ&&(!dateFrom.value||s.date>=dateFrom.value)&&(!dateTo.value||s.date<=dateTo.value)&&(!paymentStatus.value||s.paymentStatus===paymentStatus.value)&&(!returnStatus.value||s.returnStatus===returnStatus.value);
}));
const filteredReturns = computed(()=>{
  const q=historySearch.value.trim().toLowerCase();
  return returns.value.filter(r=>!q||r.returnId.toLowerCase().includes(q)||r.invoiceId.toLowerCase().includes(q)||r.customerName.toLowerCase().includes(q)||r.customerPhone.includes(q));
});

async function load(){
  loading.value=true;error.value='';
  try{
    const [s,r]=await Promise.all([getSalesManagementList(),getSalesReturnHistory()]);
    sales.value=s.sales;bankAccounts.value=s.bankAccounts;returns.value=r.returns;
  }catch(e){error.value=e instanceof Error?e.message:'Sales load failed';}
  finally{loading.value=false;}
}
async function viewSale(row:SalesListRow){
  closeSalesActions();selected.value=row;
  try{detail.value=(await getSaleDetail(row.invoiceId)).invoice;showView.value=true;}
  catch(e){error.value=e instanceof Error?e.message:'Invoice load failed';}
}
function duplicateSale(row:SalesListRow){emit('open-pos',{invoiceId:row.invoiceId,mode:'duplicate',nonce:Date.now()});}
function updateSale(row:SalesListRow){
  if(!row.editable){error.value='This invoice cannot be updated because the cash session is closed or a return already exists.';return;}
  const reason=window.prompt('Reason for update — পরিবর্তনের কারণ');if(!reason?.trim())return;
  emit('open-pos',{invoiceId:row.invoiceId,mode:'update',reason:reason.trim(),nonce:Date.now()});
}
function openPay(){
  if(!detail.value?.customerId){error.value='This invoice has no linked customer to pay against.';return;}
  payForm.amount=Math.max(0,detail.value.dueAmount);payForm.method='Cash';payForm.bankAccountId='';payForm.reference='';payForm.note='';showView.value=false;showPay.value=true;
}
async function savePayment(){
  if(!detail.value?.customerId)return;error.value='';
  try{
    await receiveSalesCustomerPayment({customerId:detail.value.customerId,amount:Number(payForm.amount||0),method:payForm.method,bankAccountId:payForm.bankAccountId,reference:payForm.reference,note:payForm.note});
    showPay.value=false;flash('Payment recorded');await load();
  }catch(e){error.value=e instanceof Error?e.message:'Payment failed';}
}
function askDelete(row:SalesListRow){selected.value=row;deleteReason.value='';showDelete.value=true;}
async function confirmDelete(){
  if(!selected.value)return;if(!deleteReason.value.trim()){error.value='Enter a delete reason.';return;}
  try{await deleteSale(selected.value.invoiceId,deleteReason.value.trim());showDelete.value=false;flash('Invoice deleted');await load();}
  catch(e){error.value=e instanceof Error?e.message:'Delete failed';}
}

async function findReturnInvoices(){
  const q=returnSearch.value.trim();returnMatches.value=[];
  if(!q)return;
  returnSearchLoading.value=true;error.value='';
  try{
    const r=await searchSalesInvoicesForReturn(q);
    returnMatches.value=r.matches;
    const exact=r.matches.find(x=>x.invoiceId.toLowerCase()===q.toLowerCase());
    if(exact)await loadReturnInvoice(exact.invoiceId);
  }catch(e){error.value=e instanceof Error?e.message:'Invoice search failed.';}
  finally{returnSearchLoading.value=false;}
}
async function loadReturnInvoice(invoiceId:string){
  error.value='';
  try{
    const r=await getSaleReturnData(invoiceId);
    returnData.value=r.sale;
    returnData.value.items.forEach(i=>{i.returnQty=0;i.serialNumbers=[];});
    Object.assign(returnForm,{refundMethod:'Cash',reason:'',notes:'',date:today,backdatedReason:''});
    returnMatches.value=[];
  }catch(e){error.value=e instanceof Error?e.message:'Return data failed.';}
}
async function startReturn(invoiceId:string){
  activeTab.value='newReturn';
  returnSearch.value=invoiceId;
  await loadReturnInvoice(invoiceId);
}
function clearReturn(){
  returnSearch.value='';returnMatches.value=[];returnData.value=null;
  Object.assign(returnForm,{refundMethod:'Cash',reason:'',notes:'',date:today,backdatedReason:''});
}
const returnTotal=computed(()=>returnData.value?.items.reduce((s,i)=>s+(Number(i.returnQty||0)*Number(i.unitPrice||0)),0)||0);
async function saveReturn(){
  if(!returnData.value)return;
  const items=returnData.value.items.filter(i=>Number(i.returnQty||0)>0).map(i=>({
    productId:i.productId,name:i.name,qty:Math.max(1,Math.round(Number(i.returnQty||0))),unitPrice:Number(i.unitPrice||0),
    serialNumbers:i.trackSerial?(i.serialNumbers||[]).slice(0,Math.max(1,Math.round(Number(i.returnQty||0)))):undefined
  }));
  if(!items.length){error.value='Enter a return quantity for at least one product.';return;}
  for(const row of returnData.value.items.filter(i=>Number(i.returnQty||0)>0&&i.trackSerial)){
    const need=Math.max(1,Math.round(Number(row.returnQty||0)));
    if((row.serialNumbers||[]).length!==need){error.value=`${row.name}: select exactly ${need} Serial / IMEI number(s) being returned.`;return;}
  }
  if(isBackdated(returnForm.date)&&!returnForm.backdatedReason.trim()){error.value='A reason is required when dating a return in the past.';return;}
  returnSaving.value=true;error.value='';
  try{
    const r=await completeSalesReturn({
      invoiceId:returnData.value.invoiceId,refundMethod:returnForm.refundMethod,reason:returnForm.reason.trim(),
      notes:returnForm.notes,date:returnForm.date,backdatedReason:returnForm.backdatedReason.trim(),items
    });
    flash(`Return ${r.returnId} completed — ${money(r.totalReturnAmount)} refunded`);
    clearReturn();await load();activeTab.value='returnHistory';
  }catch(e){error.value=e instanceof Error?e.message:'Sales return failed';}
  finally{returnSaving.value=false;}
}
async function openReturnDetail(r:SalesReturnRecord){
  error.value='';
  try{returnDetail.value=(await getSalesReturnDetail(r.returnId)).detail;}
  catch(e){error.value=e instanceof Error?e.message:'Return detail failed.';}
}

watch(() => props.openRequest?.nonce, async ()=>{
  const req=props.openRequest;if(!req)return;activeTab.value=req.tab;
  if(req.tab==='sales'&&req.invoiceId){
    if(!sales.value.length)await load();
    const row=sales.value.find(s=>s.invoiceId===req.invoiceId)||null;
    selected.value=row;
    if(req.action==='return'){ await startReturn(req.invoiceId); return; }
    if(req.action==='edit'){
      if(!row){ error.value='Invoice is not available in Sales Management.'; return; }
      updateSale(row); return;
    }
    if(req.action==='delete'){
      if(!row){ error.value='Invoice is not available in Sales Management.'; return; }
      askDelete(row); return;
    }
    try{
      detail.value=(await getSaleDetail(req.invoiceId)).invoice;
      showView.value=true;
      if(req.action==='receive-payment'){
        if(Number(detail.value.dueAmount||0)<=0){ error.value='This invoice has no outstanding due.'; return; }
        openPay();
      }
    }
    catch(e){error.value=e instanceof Error?e.message:'Invoice load failed';}
  }else if(req.tab==='newReturn'&&req.invoiceId){
    await startReturn(req.invoiceId);
  }else if(req.tab==='returnHistory'){
    if(!returns.value.length)await load();
    if(req.returnId){
      const r=returns.value.find(x=>x.returnId===req.returnId);
      if(r)await openReturnDetail(r);
    }
  }
});

async function refresh(): Promise<void> {
  await load();
  if (showView.value && detail.value) {
    detail.value = (await getSaleDetail(detail.value.invoiceId)).invoice;
  }
  if (activeTab.value === 'newReturn' && returnData.value?.invoiceId) {
    const invoiceId = returnData.value.invoiceId;
    await loadReturnInvoice(invoiceId);
  }
}
defineExpose({ refresh });

onMounted(()=>{void load();document.addEventListener('pointerdown',onSalesPointerDown);});
onBeforeUnmount(()=>document.removeEventListener('pointerdown',onSalesPointerDown));
</script>

<template>
  <div class="sales-page">
    <ModuleTabs v-model="activeTab" :tabs="tabs" aria-label="Sales sections" />

    <div v-if="error" class="sales-alert error">{{error}}</div>
    <div v-if="message" class="sales-alert ok">{{message}}</div>

    <template v-if="activeTab==='sales'">
      <div class="sales-toolbar">
        <input v-model="search" placeholder="Search invoice #, customer, or phone...">
        <input v-model="dateFrom" type="date" title="From date">
        <input v-model="dateTo" type="date" title="To date">
        <select v-model="paymentStatus"><option value="">All payment status</option><option>Paid</option><option>Partial</option><option>Due</option></select>
        <select v-model="returnStatus"><option value="">All return status</option><option>No Return</option><option>Partially Returned</option><option>Fully Returned</option></select>
      </div>
      <div class="sales-table-wrap"><table class="sales-table"><thead><tr><SortableHeader table-id="sales-list" column="invoiceId">Invoice</SortableHeader><SortableHeader table-id="sales-list" column="date" type="date">Date</SortableHeader><SortableHeader table-id="sales-list" column="customerName">Customer</SortableHeader><SortableHeader table-id="sales-list" column="customerPhone">Phone</SortableHeader><SortableHeader table-id="sales-list" column="grandTotal" type="number" class="num">Total</SortableHeader><SortableHeader table-id="sales-list" column="paidAmount" type="number" class="num">Paid</SortableHeader><SortableHeader table-id="sales-list" column="dueAmount" type="number" class="num">Due</SortableHeader><SortableHeader table-id="sales-list" column="returnedAmount" type="number" class="num">Returned</SortableHeader><SortableHeader table-id="sales-list" column="paymentStatus">Status</SortableHeader><th></th></tr></thead>
        <tbody><tr v-for="s in $sortRows('sales-list', filtered)" :key="s.invoiceId">
          <td class="mono"><strong>{{s.invoiceId}}</strong></td><td>{{s.date}}</td><td>{{s.customerName}}</td><td>{{s.customerPhone}}</td>
          <td class="num mono">{{money(s.grandTotal)}}</td><td class="num mono">{{money(s.paidAmount)}}</td><td class="num mono">{{money(s.dueAmount)}}</td><td class="num mono">{{money(s.returnedAmount)}}</td>
          <td><span class="sale-badge" :class="s.paymentStatus.toLowerCase()">{{s.paymentStatus}}</span><span v-if="s.returnStatus!=='No Return'" class="sale-badge returned">{{s.returnStatus}}</span></td>
          <td class="action-cell"><button class="actions-trigger action-trigger" @click="toggleSalesActions($event,s)">Actions</button></td>
        </tr><tr v-if="!filtered.length"><td colspan="10" class="empty">No sales found.</td></tr></tbody>
      </table></div>
    </template>

    <template v-else-if="activeTab==='newReturn'">
      <div class="card return-search-card">
        <label>Find Invoice by Invoice Number or Customer Phone</label>
        <div class="return-search-row"><input v-model.trim="returnSearch" placeholder="e.g. INV-000012 or 01911-100001" @keydown.enter="findReturnInvoices"><button class="btn btn-primary" :disabled="returnSearchLoading" @click="findReturnInvoices">{{returnSearchLoading?'Searching...':'Find Invoice'}}</button><button class="btn" @click="clearReturn">Clear</button></div>
        <div v-if="returnMatches.length" class="sales-table-wrap return-results"><table class="sales-table"><thead><tr><SortableHeader table-id="sales-return-search" column="invoiceId">Invoice</SortableHeader><SortableHeader table-id="sales-return-search" column="date" type="date">Date</SortableHeader><SortableHeader table-id="sales-return-search" column="customerName">Customer</SortableHeader><SortableHeader table-id="sales-return-search" column="grandTotal" type="number" class="num">Total</SortableHeader><SortableHeader table-id="sales-return-search" column="paymentStatus">Status</SortableHeader><th></th></tr></thead><tbody>
          <tr v-for="m in $sortRows('sales-return-search', returnMatches)" :key="m.invoiceId"><td class="mono">{{m.invoiceId}}</td><td>{{m.date}}</td><td>{{m.customerName}}<span v-if="m.customerPhone" class="subline">{{m.customerPhone}}</span></td><td class="num mono">{{money(m.grandTotal)}}</td><td>{{m.paymentStatus}}</td><td><button class="btn btn-sm" @click="loadReturnInvoice(m.invoiceId)">Load</button></td></tr>
        </tbody></table></div>
      </div>

      <template v-if="returnData">
        <div class="card return-invoice-card">
          <div class="return-invoice-info">
            <div><span>Invoice</span><strong class="mono">{{returnData.invoiceId}}</strong></div>
            <div><span>Date</span><strong>{{returnData.date}}</strong></div>
            <div><span>Customer</span><strong>{{returnData.customerName||'Walk-in Customer'}}</strong></div>
            <div><span>Phone</span><strong>{{returnData.customerPhone||'—'}}</strong></div>
          </div>
          <div class="return-summary">
            <div><span>Original Total</span><strong>{{money(returnData.grandTotal)}}</strong></div>
            <div><span>Paid</span><strong>{{money(returnData.paidAmount)}}</strong></div>
            <div><span>Due</span><strong>{{money(returnData.dueAmount)}}</strong></div>
            <div><span>Previously Returned</span><strong>{{money(returnData.previouslyReturnedAmount)}}</strong></div>
            <div><span>Net Sale</span><strong>{{money(returnData.netSale)}}</strong></div>
          </div>
        </div>

        <div class="card return-cart-card">
          <h3>Return Cart <span class="bn-hint" style="display:inline">— ফেরত দেওয়া মাল</span></h3>
          <div class="sales-table-wrap"><table class="sales-table"><thead><tr><th>Product</th><th class="num">Sold</th><th class="num">Returned</th><th class="num">Available</th><th class="num">Return Qty</th><th class="num">Return Price</th><th class="num">Line Total</th></tr></thead><tbody>
            <tr v-for="i in returnData.items" :key="i.productId"><td>{{i.name}}<div v-if="i.trackSerial && Number(i.returnQty||0)>0" class="sales-return-serials"><label v-for="serial in i.availableSerials||[]" :key="serial"><input v-model="i.serialNumbers" type="checkbox" :value="serial" :disabled="!(i.serialNumbers||[]).includes(serial)&&(i.serialNumbers||[]).length>=Math.round(Number(i.returnQty||0))"><span class="mono">{{serial}}</span></label><small>{{(i.serialNumbers||[]).length}} / {{Math.round(Number(i.returnQty||0))}} selected</small></div></td><td class="num">{{qty(i.soldQty)}}</td><td class="num">{{qty(i.previouslyReturnedQty)}}</td><td class="num">{{qty(i.availableQty)}}</td><td><input v-model.number="i.returnQty" type="number" min="0" :max="i.availableQty" step="1" :disabled="i.availableQty<=0"></td><td><input v-model.number="i.unitPrice" type="number" min="0" step="0.01" :disabled="i.availableQty<=0"></td><td class="num mono">{{money(Number(i.returnQty||0)*Number(i.unitPrice||0))}}</td></tr>
          </tbody></table></div>
          <div class="return-form-grid">
            <div><label>Refund Method *</label><select v-model="returnForm.refundMethod"><option value="Cash">Cash Refund</option><option value="Store Credit">Adjust to Customer Due (Store Credit)</option></select></div>
            <div><label>Return Reason</label><input v-model.trim="returnForm.reason" placeholder="Optional"></div>
            <div><label>Return Date</label><input v-model="returnForm.date" type="date"></div>
            <div class="wide"><label>Note</label><input v-model.trim="returnForm.notes" placeholder="Optional"></div>
            <div v-if="isBackdated(returnForm.date)" class="wide"><label>Reason for Backdating *</label><input v-model.trim="returnForm.backdatedReason" placeholder="Why is this dated in the past?"></div>
          </div>
          <div class="return-footer"><div class="return-total">Total Return Amount <strong>{{money(returnTotal)}}</strong></div><div class="return-buttons"><button class="btn" @click="clearReturn">Cancel</button><button class="btn btn-primary" :disabled="returnSaving" @click="saveReturn">{{returnSaving?'Saving...':'Complete Return'}}</button></div></div>
        </div>
      </template>
    </template>

    <template v-else>
      <div class="toolbar"><input v-model="historySearch" class="search-input" placeholder="Search return #, invoice #, customer, or phone..."></div>
      <div class="card" style="padding:0"><div class="table-scroll"><table class="return-history-table"><thead><tr><SortableHeader table-id="sales-return-history" column="returnId">Return #</SortableHeader><SortableHeader table-id="sales-return-history" column="returnDate" type="date">Date</SortableHeader><SortableHeader table-id="sales-return-history" column="invoiceId">Invoice</SortableHeader><SortableHeader table-id="sales-return-history" column="customerName">Customer</SortableHeader><SortableHeader table-id="sales-return-history" column="refundMethod">Refund Method</SortableHeader><SortableHeader table-id="sales-return-history" column="totalReturnAmount" type="number" class="num">Amount</SortableHeader><SortableHeader table-id="sales-return-history" column="processedBy">Processed By</SortableHeader><th></th></tr></thead><tbody>
        <tr v-for="r in $sortRows('sales-return-history', filteredReturns)" :key="r.returnId"><td class="mono"><strong>{{r.returnId}}</strong></td><td>{{r.returnDate}} <span v-if="r.isBackdated" class="badge badge-warning" :title="r.backdatedReason">⚠</span></td><td class="mono">{{r.invoiceId}}</td><td>{{r.customerName}}<span v-if="r.customerPhone" class="subline">{{r.customerPhone}}</span></td><td>{{r.refundMethod}}</td><td class="num mono">{{money(r.totalReturnAmount)}}</td><td>{{r.processedBy||'—'}}</td><td><button class="btn btn-sm" @click="openReturnDetail(r)">View</button></td></tr>
      </tbody></table></div><div v-if="!filteredReturns.length" class="empty-state">No returns yet.</div></div>
    </template>

    <Teleport to="body"><div v-if="salesActionMenu" class="sales-action-menu" :style="{left:salesActionMenu.left+'px',top:salesActionMenu.top+'px'}" @pointerdown.stop>
      <button @click="runSalesAction('view')">View</button><button @click="runSalesAction('duplicate')">Duplicate</button><button :disabled="!salesActionMenu.sale.editable" @click="runSalesAction('update')">Update</button><button @click="runSalesAction('return')">Return</button><div class="sales-action-separator"></div><button class="danger" @click="runSalesAction('delete')">Delete</button>
    </div></Teleport>

    <SalesInvoiceDetail
      :open="showView && !!detail"
      :invoice-id="detail?.invoiceId || ''"
      @close="showView=false"
      @changed="load"
    />

    <div v-if="showPay&&detail" class="modal-overlay"><div class="modal"><div class="modal-header"><h3>Receive Due Payment — বাকির টাকা নিন</h3><button class="modal-close" @click="showPay=false">✕</button></div><div class="modal-body"><p>Invoice due: <strong>{{money(detail.dueAmount)}}</strong></p><label>Payment Amount *<input v-model.number="payForm.amount" type="number" min="0" step="0.01"></label><label>Payment Method<select v-model="payForm.method"><option>Cash</option><option>Bank</option><option>Mobile Banking</option><option>Other</option></select></label><label v-if="payForm.method==='Bank'||payForm.method==='Mobile Banking'">Account *<select v-model="payForm.bankAccountId"><option value="">Select account...</option><option v-for="b in bankAccounts" :key="b.id" :value="b.id">{{b.name}}</option></select></label><label>Reference<input v-model="payForm.reference"></label><label>Note<input v-model="payForm.note"></label></div><div class="modal-footer"><button class="btn" @click="showPay=false">Cancel</button><button class="btn btn-primary" @click="savePayment">Receive Payment</button></div></div></div>

    <div v-if="showDelete&&selected" class="modal-overlay"><div class="modal"><div class="modal-header"><h3>Delete invoice {{selected.invoiceId}}</h3><button class="modal-close" @click="showDelete=false">✕</button></div><div class="modal-body"><p>This reverses stock, customer due and payment entries. A sale with a return cannot be deleted.</p><label>Delete Reason *<textarea v-model="deleteReason" rows="3"></textarea></label></div><div class="modal-footer"><button class="btn" @click="showDelete=false">Cancel</button><button class="btn btn-danger" @click="confirmDelete">Delete Invoice</button></div></div></div>

    <Teleport to="body"><div v-if="returnDetail" class="modal-overlay" @click.self="returnDetail=null"><div class="modal modal-lg"><div class="modal-header"><h3>Return <span class="mono">{{returnDetail.header.returnId}}</span></h3><button class="modal-close" @click="returnDetail=null">✕</button></div><div class="modal-body">
      <div class="return-detail-grid"><div><span>Invoice</span><strong class="mono">{{returnDetail.header.invoiceId}}</strong></div><div><span>Date</span><strong>{{returnDetail.header.returnDate}}</strong></div><div><span>Customer</span><strong>{{returnDetail.header.customerName||'—'}}</strong></div><div><span>Refund Method</span><strong>{{returnDetail.header.refundMethod}}</strong></div></div>
      <div class="sales-table-wrap"><table class="sales-table"><thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr></thead><tbody><tr v-for="i in returnDetail.items" :key="i.productId"><td>{{i.productName}}</td><td class="num">{{qty(i.quantity)}}</td><td class="num mono">{{money(i.unitPrice)}}</td><td class="num mono">{{money(i.lineTotal)}}</td></tr></tbody></table></div>
      <div class="return-detail-total">Total Return <strong>{{money(returnDetail.header.totalReturnAmount)}}</strong></div>
      <p><strong>Reason:</strong> {{returnDetail.header.reason||'—'}}</p><p><strong>Note:</strong> {{returnDetail.header.notes||'—'}}</p><p v-if="returnDetail.header.isBackdated"><strong>Backdated Reason:</strong> {{returnDetail.header.backdatedReason}}</p>
    </div><div class="modal-footer"><button class="btn" @click="returnDetail=null">Close</button></div></div></div></Teleport>
  </div>
</template>

<style scoped>
.sales-page{display:grid;gap:10px}.sales-toolbar{display:grid;grid-template-columns:minmax(210px,1fr) 145px 145px 160px 180px auto;gap:7px}.sales-toolbar input,.sales-toolbar select,.sales-toolbar button{min-height:36px}.sales-toolbar button,.actions-trigger{border:1px solid var(--color-border);background:#fff;border-radius:7px;padding:7px 10px;font-weight:700}.sales-table-wrap{overflow-x:auto;overflow-y:visible;max-height:none!important;border:1px solid var(--color-border);border-radius:9px;background:#fff;-webkit-overflow-scrolling:touch}.sales-table{width:100%;border-collapse:collapse;white-space:nowrap}.sales-table th,.sales-table td{padding:8px 9px;border-bottom:1px solid var(--color-border);font-size:12px}.sales-table th{font-size:10px;text-transform:uppercase;color:var(--color-text-muted);text-align:left}.sales-table .num{text-align:right}.sales-table .empty{text-align:center;padding:28px;color:var(--color-text-muted)}.sale-badge{display:inline-flex;border-radius:999px;padding:3px 7px;font-size:10px;margin-right:4px}.sale-badge.paid{background:#e8f8ef;color:#07833f}.sale-badge.partial{background:#fff4dc;color:#a55d00}.sale-badge.due{background:#ffeaea;color:#c81e1e}.sale-badge.returned{background:#eef3ff;color:#3d5fa4}.action-cell{white-space:nowrap}.sales-alert{padding:8px 10px;border-radius:7px}.sales-alert.error{background:var(--color-danger-light);color:var(--color-danger)}.sales-alert.ok{background:#e9f8ef;color:#08753d}.invoice-info{display:grid;grid-template-columns:1fr 1fr 2fr;gap:12px;margin-bottom:12px}.invoice-info label{display:block;color:var(--color-text-muted);font-size:11px}.view-totals{max-width:330px;margin:12px 0 0 auto;display:grid;gap:6px}.view-totals div{display:flex;justify-content:space-between}.view-totals .grand{font-size:16px;border-top:1px solid var(--color-border);padding-top:7px}.subline{display:block;font-size:10px;color:#64748b;margin-top:2px}

.sales-return-serials{display:grid;gap:4px;margin-top:6px;max-height:120px;overflow:auto;min-width:210px}.sales-return-serials label{display:flex;gap:6px;align-items:center;font-size:11px;font-weight:500}.sales-return-serials small{color:var(--color-text-muted);font-weight:700}
.return-search-card{margin:0}.return-search-row{display:grid;grid-template-columns:minmax(220px,1fr) auto auto;gap:8px;margin-top:5px}.return-results{margin-top:12px}.return-invoice-card{margin:0}.return-invoice-info{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.return-invoice-info div,.return-summary div,.return-detail-grid div{display:grid;gap:3px}.return-invoice-info span,.return-summary span,.return-detail-grid span{font-size:10px;text-transform:uppercase;color:#64748b;font-weight:700}.return-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;border-top:1px solid var(--color-border);padding-top:12px;margin-top:12px}.return-cart-card{margin:0}.return-cart-card>h3{font-size:14px;margin:0 0 10px}.return-cart-card input[type=number]{min-width:82px}.return-form-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:14px}.return-form-grid .wide{grid-column:1/-1}.return-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:14px}.return-total{display:flex;gap:18px;align-items:center;border:1px solid var(--color-border);border-radius:8px;padding:10px 12px;min-width:280px}.return-total strong{margin-left:auto;color:var(--color-primary)}.return-buttons{display:flex;gap:8px}.return-history-table{width:100%;min-width:900px;border-collapse:collapse}.return-history-table th,.return-history-table td{padding:8px 9px;border-bottom:1px solid var(--color-border);font-size:12px}.return-history-table th{font-size:10px;text-transform:uppercase;color:#64748b;text-align:left}.return-detail-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:12px}.return-detail-total{max-width:300px;margin:12px 0 10px auto;display:flex;justify-content:space-between;border-top:1px solid var(--color-border);padding-top:9px}

.sales-action-menu{position:fixed;z-index:10050;width:190px;padding:6px;background:#fff;border:1px solid #dfe5ee;border-radius:10px;box-shadow:0 10px 28px rgba(15,23,42,.16);display:grid}.sales-action-menu button{width:100%;border:0;background:transparent;border-radius:7px;padding:11px 12px;text-align:left;font:inherit;color:#273247;cursor:pointer}.sales-action-menu button:hover,.sales-action-menu button:focus-visible{background:#eef4ff;outline:none}.sales-action-menu button.danger{color:#e11d48}.sales-action-menu button.danger:hover,.sales-action-menu button.danger:focus-visible{background:#fff0f3}.sales-action-menu button:disabled{opacity:.42;cursor:not-allowed}.sales-action-separator{height:1px;margin:4px 2px;background:#e5e9f0}.actions-trigger{white-space:nowrap}

@media(max-width:900px){.sales-toolbar{grid-template-columns:1fr 1fr 1fr}.sales-toolbar>input:first-child{grid-column:1/-1}.invoice-info{grid-template-columns:1fr 1fr}.invoice-info>div:last-child{grid-column:1/-1}.return-invoice-info{grid-template-columns:repeat(2,1fr)}.return-summary{grid-template-columns:repeat(3,1fr)}.return-form-grid{grid-template-columns:repeat(2,1fr)}.return-detail-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:600px){.sales-toolbar{grid-template-columns:1fr 1fr}.sales-toolbar select{min-width:0}.sales-table th,.sales-table td{padding:7px 8px}.invoice-info{grid-template-columns:1fr}.invoice-info>div:last-child{grid-column:auto}.return-search-row{grid-template-columns:1fr 1fr}.return-search-row input{grid-column:1/-1}.return-summary{grid-template-columns:repeat(2,1fr)}.return-form-grid{grid-template-columns:1fr}.return-form-grid .wide{grid-column:auto}.return-footer{align-items:stretch;flex-direction:column}.return-total{width:100%;min-width:0}.return-buttons{width:100%}.return-buttons .btn{flex:1}.return-detail-grid{grid-template-columns:1fr}}
</style>
