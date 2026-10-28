<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import {
  completeSalesReturn,
  getPosBootstrap,
  getPosInvoice,
  getSaleDetail,
  getSaleReturnData,
  receiveSalesCustomerPayment,
} from '../api';
import type { BankAccount, PosInvoice, SaleDetail, SaleReturnData } from '../types';
import { downloadElementAsJpg, printInvoiceElement } from '../utils/invoiceOutput';
import { notifyError, notifySuccess, notifyWarning } from '../utils/notify';
import InvoicePaper from './InvoicePaper.vue';

const props = withDefaults(defineProps<{ open: boolean; invoiceId: string; initialAction?: 'view'|'return'|'payment' }>(), { initialAction: 'view' });
const emit = defineEmits<{ (e:'close'):void; (e:'changed'):void }>();

const today = new Date().toISOString().slice(0,10);
const loading = ref(false);
const detail = ref<SaleDetail|null>(null);
const printableInvoice = ref<PosInvoice|null>(null);
const bankAccounts = ref<BankAccount[]>([]);
const invoiceSettings = ref<Record<string,string>>({});
const invoiceLogoDataUri = ref('');
const printMode = ref<'a4'|'thermal'>('a4');
const invoicePaperRef = ref<HTMLElement|null>(null);
const showPay = ref(false);
const showReturn = ref(false);
const returnData = ref<SaleReturnData|null>(null);
const returnSaving = ref(false);
const paySaving = ref(false);
const consumedInitialAction = ref('');
const payForm = reactive({ amount:0, method:'Cash', bankAccountId:'', reference:'', note:'' });
const returnForm = reactive({ refundMethod:'Cash' as 'Cash'|'Store Credit', reason:'', notes:'', date:today, backdatedReason:'' });

function money(v:number){ return Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
function qty(v:number){ const n=Number(v||0); return Number.isInteger(n)?String(n):n.toFixed(2).replace(/\.00$/,''); }
function isBackdated(date:string){ return !!date && date<today; }
const receiptSize = computed(()=>invoiceSettings.value['Receipt Size']||'80mm');
const paymentNeedsAccount = computed(()=>payForm.method==='Bank'||payForm.method==='Mobile Banking');
const filteredBankAccounts = computed(()=>{
  if(!paymentNeedsAccount.value)return [];
  const want=payForm.method==='Mobile Banking'?'Mobile Banking':'Bank';
  return bankAccounts.value.filter(a=>(a.accountType||'Bank')===want);
});
const returnTotal = computed(()=>returnData.value?.items.reduce((s,i)=>s+(Number(i.returnQty||0)*Number(i.unitPrice||0)),0)||0);

async function load(){
  if(!props.open||!props.invoiceId)return;
  loading.value=true;
  try{
    const [sale,printable,bootstrap]=await Promise.all([
      getSaleDetail(props.invoiceId),
      getPosInvoice(props.invoiceId),
      getPosBootstrap(),
    ]);
    detail.value=sale.invoice;
    printableInvoice.value=printable.invoice;
    invoiceSettings.value=bootstrap.invoiceDesign.settings||{};
    invoiceLogoDataUri.value=bootstrap.invoiceDesign.logoDataUri||'';
    bankAccounts.value=bootstrap.bankAccounts||[];
    const initialKey=`${props.invoiceId}:${props.initialAction}`;
    if(props.initialAction!=='view'&&consumedInitialAction.value!==initialKey){
      consumedInitialAction.value=initialKey;
      await nextTick();
      if(props.initialAction==='return') await openReturn();
      else if(props.initialAction==='payment') openPay();
    }
  }catch(e){
    notifyError(e instanceof Error?e.message:'Invoice load failed.');
    emit('close');
  }finally{loading.value=false;}
}
watch(()=>[props.open,props.invoiceId,props.initialAction] as const,()=>void load(),{immediate:true});

function close(){ showPay.value=false;showReturn.value=false;emit('close'); }
function openPay(){
  if(!detail.value?.customerId){notifyError('This invoice has no linked customer to pay against.');return;}
  if(Number(detail.value.dueAmount||0)<=0){notifyWarning('This invoice has no outstanding due.');return;}
  payForm.amount=Math.max(0,Number(detail.value.dueAmount||0));payForm.method='Cash';payForm.bankAccountId='';payForm.reference='';payForm.note='';showPay.value=true;
}
async function savePayment(){
  if(!detail.value?.customerId||paySaving.value)return;
  if(Number(payForm.amount||0)<=0){notifyWarning('Enter a payment amount greater than zero.');return;}
  if(paymentNeedsAccount.value&&!payForm.bankAccountId){notifyWarning('Select the bank or mobile banking account.');return;}
  paySaving.value=true;
  try{
    await receiveSalesCustomerPayment({customerId:detail.value.customerId,amount:Number(payForm.amount),method:payForm.method,bankAccountId:payForm.bankAccountId,reference:payForm.reference,note:payForm.note});
    notifySuccess('Payment recorded successfully.');showPay.value=false;await load();emit('changed');
  }catch(e){notifyError(e instanceof Error?e.message:'Payment failed.');}
  finally{paySaving.value=false;}
}
async function openReturn(){
  if(!detail.value)return;
  try{
    const r=await getSaleReturnData(detail.value.invoiceId);returnData.value=r.sale;returnData.value.items.forEach(i=>i.returnQty=0);
    Object.assign(returnForm,{refundMethod:'Cash',reason:'',notes:'',date:today,backdatedReason:''});showReturn.value=true;
  }catch(e){notifyError(e instanceof Error?e.message:'Could not load return data.');}
}
async function saveReturn(){
  if(!returnData.value||returnSaving.value)return;
  const items=returnData.value.items.filter(i=>Number(i.returnQty||0)>0).map(i=>({productId:i.productId,name:i.name,qty:Math.max(1,Math.round(Number(i.returnQty||0))),unitPrice:Number(i.unitPrice||0)}));
  if(!items.length){notifyWarning('Enter a return quantity for at least one product.');return;}
  if(isBackdated(returnForm.date)&&!returnForm.backdatedReason.trim()){notifyWarning('A reason is required for a backdated return.');return;}
  returnSaving.value=true;
  try{
    const r=await completeSalesReturn({invoiceId:returnData.value.invoiceId,refundMethod:returnForm.refundMethod,reason:returnForm.reason.trim(),notes:returnForm.notes,date:returnForm.date,backdatedReason:returnForm.backdatedReason.trim(),items});
    notifySuccess(`Return ${r.returnId} completed.`);showReturn.value=false;await load();emit('changed');
  }catch(e){notifyError(e instanceof Error?e.message:'Sales return failed.');}
  finally{returnSaving.value=false;}
}
async function print(mode:'a4'|'thermal'){
  if(!invoicePaperRef.value||!printableInvoice.value)return;
  printMode.value=mode;await nextTick();
  try{await printInvoiceElement(invoicePaperRef.value,mode,receiptSize.value);}
  catch(e){notifyError(e instanceof Error?e.message:'Could not open print preview.');}
  finally{printMode.value='a4';}
}
async function downloadJpg(){
  if(!invoicePaperRef.value||!printableInvoice.value)return;
  try{
    const result=await downloadElementAsJpg(invoicePaperRef.value,`${printableInvoice.value.invoiceId}.jpg`,1600);
    if(result.omittedImages>0)notifyWarning('Invoice JPG downloaded without a blocked external logo/image.');
    else notifySuccess('Invoice JPG downloaded.');
  }catch(e){notifyError(e instanceof Error?e.message:'Could not create invoice JPG.');}
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay shared-invoice-overlay" @click.self="close">
      <div class="modal modal-xl shared-invoice-modal">
        <div class="modal-header"><h3>Invoice — বিক্রির বিস্তারিত <span v-if="detail" class="mono">{{detail.invoiceId}}</span></h3><button class="modal-close" @click="close">×</button></div>
        <div class="modal-body">
          <div v-if="loading" class="empty-state">Loading invoice...</div>
          <template v-else-if="detail">
            <div class="invoice-info"><div><label>Customer</label><strong>{{detail.customerName||'Walk-in Customer'}}</strong></div><div><label>Phone</label><strong>{{detail.customerPhone||'—'}}</strong></div><div><label>Address</label><strong>{{detail.customerAddress||'—'}}</strong></div></div>
            <div class="sales-table-wrap"><table class="sales-table"><thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Line Total</th></tr></thead><tbody><tr v-for="i in detail.items" :key="i.productId"><td>{{i.name}}</td><td class="num">{{qty(i.qty)}}</td><td class="num mono">{{money(i.unitPrice)}}</td><td class="num mono">{{money(i.lineTotal)}}</td></tr></tbody></table></div>
            <div class="view-totals"><div><span>Subtotal</span><b>{{money(detail.subtotal)}}</b></div><div><span>Discount</span><b>{{money(detail.discount)}}</b></div><div class="grand"><span>Grand Total</span><b>{{money(detail.grandTotal)}}</b></div><div><span>Paid</span><b>{{money(detail.paidAmount)}}</b></div><div><span>Due</span><b>{{money(detail.dueAmount)}}</b></div><div><span>Returned</span><b>{{money(detail.returnedAmount)}}</b></div><div class="grand"><span>Net Sale</span><b>{{money(detail.netSale)}}</b></div></div>
          </template>
        </div>
        <div v-if="detail" class="modal-footer shared-invoice-actions"><button class="btn" @click="close">Close</button><button class="btn" @click="openReturn">Sales Return</button><button v-if="detail.dueAmount>0" class="btn" @click="openPay">Receive Payment</button><button class="btn" @click="downloadJpg">Download JPG</button><button class="btn" @click="print('thermal')">Thermal Print</button><button class="btn btn-primary" @click="print('a4')">Print</button></div>
      </div>
    </div>

    <div v-if="showPay&&detail" class="modal-overlay nested-action-overlay"><div class="modal"><div class="modal-header"><h3>Receive Due Payment — বাকির টাকা নিন</h3><button class="modal-close" @click="showPay=false">×</button></div><div class="modal-body"><p>Invoice due: <strong>{{money(detail.dueAmount)}}</strong></p><label>Payment Amount *<input v-model.number="payForm.amount" type="number" min="0" step="0.01"></label><label>Payment Method<select v-model="payForm.method"><option>Cash</option><option>Bank</option><option>Mobile Banking</option><option>Other</option></select></label><label v-if="paymentNeedsAccount">Account *<select v-model="payForm.bankAccountId"><option value="">Select account...</option><option v-for="b in filteredBankAccounts" :key="b.id" :value="b.id">{{b.name}}</option></select></label><label>Reference<input v-model="payForm.reference"></label><label>Note<input v-model="payForm.note"></label></div><div class="modal-footer"><button class="btn" @click="showPay=false">Cancel</button><button class="btn btn-primary" :disabled="paySaving" @click="savePayment">{{paySaving?'Saving...':'Receive Payment'}}</button></div></div></div>

    <div v-if="showReturn&&returnData" class="modal-overlay nested-action-overlay"><div class="modal modal-lg"><div class="modal-header"><h3>Sales Return — {{returnData.invoiceId}}</h3><button class="modal-close" @click="showReturn=false">×</button></div><div class="modal-body"><div class="sales-table-wrap"><table class="sales-table"><thead><tr><th>Product</th><th class="num">Sold</th><th class="num">Available</th><th class="num">Return Qty</th><th class="num">Price</th></tr></thead><tbody><tr v-for="i in returnData.items" :key="i.productId"><td>{{i.name}}</td><td class="num">{{qty(i.soldQty)}}</td><td class="num">{{qty(i.availableQty)}}</td><td class="num"><input v-model.number="i.returnQty" type="number" min="0" :max="i.availableQty" step="1"></td><td class="num">{{money(i.unitPrice)}}</td></tr></tbody></table></div><div class="return-total">Return Total <strong>{{money(returnTotal)}}</strong></div><div class="return-form"><label>Refund Method<select v-model="returnForm.refundMethod"><option>Cash</option><option>Store Credit</option></select></label><label>Date<input v-model="returnForm.date" type="date"></label><label>Reason<input v-model="returnForm.reason"></label><label>Note<input v-model="returnForm.notes"></label><label v-if="isBackdated(returnForm.date)" class="wide">Backdated Reason *<input v-model="returnForm.backdatedReason"></label></div></div><div class="modal-footer"><button class="btn" @click="showReturn=false">Cancel</button><button class="btn btn-primary" :disabled="returnSaving" @click="saveReturn">{{returnSaving?'Saving...':'Complete Return'}}</button></div></div></div>

    <div v-if="printableInvoice" class="shared-print-source" aria-hidden="true"><div ref="invoicePaperRef"><InvoicePaper :invoice="printableInvoice" :settings="invoiceSettings" :logo-data-uri="invoiceLogoDataUri" :mode="printMode" /></div></div>
  </Teleport>
</template>

<style scoped>
.shared-invoice-overlay{z-index:10020}.nested-action-overlay{z-index:10040}.shared-invoice-modal{max-width:1120px!important}.invoice-info{display:grid;grid-template-columns:1fr 1fr 2fr;gap:12px;margin-bottom:12px}.invoice-info label{display:block;color:var(--color-text-muted);font-size:11px}.sales-table-wrap{overflow-x:auto;border:1px solid var(--color-border);border-radius:9px;background:#fff}.sales-table{width:100%;border-collapse:collapse;white-space:nowrap}.sales-table th,.sales-table td{padding:9px 10px;border-bottom:1px solid var(--color-border);font-size:12px}.sales-table th{font-size:10px;text-transform:uppercase;color:var(--color-text-muted);text-align:left}.sales-table .num{text-align:right}.view-totals{max-width:360px;margin:16px 0 0 auto;display:grid;gap:7px}.view-totals div{display:flex;justify-content:space-between}.view-totals .grand{font-size:16px;border-top:1px solid var(--color-border);padding-top:7px}.shared-invoice-actions{flex-wrap:wrap}.return-total{display:flex;justify-content:flex-end;gap:20px;font-size:16px;margin-top:12px}.return-form{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.return-form .wide{grid-column:1/-1}.shared-print-source{position:fixed;left:-100000px;top:0;width:190mm;opacity:0;pointer-events:none;z-index:-1}.mono{font-family:var(--font-mono,monospace)}
@media(max-width:700px){.invoice-info{grid-template-columns:1fr}.return-form{grid-template-columns:1fr}.return-form .wide{grid-column:auto}.shared-invoice-actions .btn{flex:1 1 calc(50% - 6px);min-height:44px}}
</style>
