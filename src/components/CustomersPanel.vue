<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import LedgerHistoryControls from './LedgerHistoryControls.vue';
import SalesInvoiceDetail from './SalesInvoiceDetail.vue';
import {
  createCustomer, deleteCustomer, deleteCustomerPayment, deleteSale, getCustomerDetail,
  getCustomerPaymentForEdit, getCustomersPage, receiveCustomerPayment,
  updateCustomer, updateCustomerPayment
} from '../api';
import type { BankAccount, CustomerDetail, CustomerForm, CustomerLedgerRow, CustomerRow } from '../types';
import { exportRowsToCsv, printRows } from '../utils/tableOutput';
import { sortRows } from '../utils/tableSorting';
import { useLedgerHistory } from '../composables/useLedgerHistory';


const props = defineProps<{ openRequest?: { customerId: string; ledgerId?: string; action?: 'open' | 'edit-payment' | 'delete-payment'; nonce: number } | null }>();

const today = () => new Date().toISOString().slice(0, 10);
const customers = ref<CustomerRow[]>([]);
const bankAccounts = ref<BankAccount[]>([]);
const activeCashSession = ref(false);
const search = ref('');
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const message = ref('');
const modal = ref<''|'form'|'detail'|'payment-edit'|'payment-delete'|'sale-delete'|'customer-delete'>('');
const editingId = ref('');
const detail = ref<CustomerDetail|null>(null);
const editingPaymentId = ref('');
const paymentDeleteTarget = ref<CustomerLedgerRow|null>(null);
const saleDeleteTarget = ref<CustomerLedgerRow|null>(null);
const customerDeleteTarget = ref<CustomerRow|null>(null);
const deleteReason = ref('');
const deleteKey = ref('');
const formError = ref('');
const paymentError = ref('');
const customerActionMenu = ref<{ customer: CustomerRow; left: number; top: number } | null>(null);
const ledgerActionMenu = ref<{ row: CustomerLedgerRow; left: number; top: number; width: number } | null>(null);
const saleInvoiceAction = ref<{ invoiceId: string; initialAction: 'view'|'return'|'payment' } | null>(null);

const form = reactive<CustomerForm>({ name:'', fatherName:'', phone:'', address:'', openingBalance:0, notes:'' });
const pay = reactive({ amount:0, method:'Cash', bankAccountId:'', notes:'', date:today(), backdatedReason:'' });
const { filters: ledgerFilters } = useLedgerHistory();

const filtered = computed(() => {
  const q=search.value.trim().toLowerCase();
  if(!q) return customers.value;
  return customers.value.filter(c => `${c.name} ${c.phone}`.toLowerCase().includes(q));
});
const payNeedsBank = computed(() => pay.method==='Bank'||pay.method==='Mobile Banking');
const payBackdated = computed(() => !!pay.date && pay.date < today());

function money(v:unknown){ return Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
function dateShort(v:string){ if(!v) return ''; const d=new Date(v); return Number.isNaN(d.getTime())?v:d.toLocaleDateString(); }
function close(){ modal.value=''; formError.value=''; paymentError.value=''; }
function toast(s:string){ message.value=s; error.value=''; setTimeout(()=>{if(message.value===s)message.value='';},2400); }
function fail(e:unknown){ error.value=e instanceof Error?e.message:String(e); }
function closeCustomerActions(){ customerActionMenu.value=null; }
function closeLedgerActions(){ ledgerActionMenu.value=null; }
function toggleLedgerActions(event: MouseEvent, row: CustomerLedgerRow){
  event.stopPropagation();
  if(ledgerActionMenu.value?.row.ledgerId===row.ledgerId){ closeLedgerActions(); return; }
  const el=event.currentTarget as HTMLElement;
  const r=el.getBoundingClientRect();
  const isSale=row.type==='Sale';
  const width=isSale?210:170, menuHeight=isSale?198:104, gap=6;
  const left=Math.max(8, Math.min(r.right-width, window.innerWidth-width-8));
  let top=r.bottom+gap;
  if(top+menuHeight>window.innerHeight-8) top=Math.max(8, r.top-menuHeight-gap);
  ledgerActionMenu.value={row,left,top,width};
}
function openSaleInvoice(row: CustomerLedgerRow, initialAction:'view'|'return'|'payment'='view'){
  const invoiceId=String(row.reference||'').trim();
  if(!invoiceId){ fail(new Error('Invoice reference is missing for this sale.')); return; }
  closeLedgerActions();
  saleInvoiceAction.value={invoiceId,initialAction};
}
function runLedgerAction(action:'edit'|'delete'|'view-sale'|'return-sale'|'payment-sale'|'delete-sale'){
  const row=ledgerActionMenu.value?.row;
  if(!row) return;
  closeLedgerActions();
  if(action==='edit') void editPayment(row);
  else if(action==='delete') askDeletePayment(row);
  else if(action==='view-sale') openSaleInvoice(row,'view');
  else if(action==='return-sale') openSaleInvoice(row,'return');
  else if(action==='payment-sale') openSaleInvoice(row,'payment');
  else if(action==='delete-sale') askDeleteSale(row);
}
async function handleSaleInvoiceChanged(){
  await load();
  await refreshDetail();
}
function toggleCustomerActions(event: MouseEvent, customer: CustomerRow){
  event.stopPropagation();
  if(customerActionMenu.value?.customer.id===customer.id){ closeCustomerActions(); return; }
  const el=event.currentTarget as HTMLElement;
  const r=el.getBoundingClientRect();
  const menuWidth=190;
  const menuHeight=154;
  const gap=6;
  const left=Math.max(8, Math.min(r.right-menuWidth, window.innerWidth-menuWidth-8));
  let top=r.bottom+gap;
  if(top+menuHeight>window.innerHeight-8) top=Math.max(8, r.top-menuHeight-gap);
  customerActionMenu.value={customer,left,top};
}
function onDocumentPointerDown(event: PointerEvent){
  const target=event.target as HTMLElement | null;
  if(target?.closest('.customer-action-menu') || target?.closest('.customer-action-trigger') || target?.closest('.customer-ledger-action-menu') || target?.closest('.customer-ledger-action-trigger')) return;
  closeCustomerActions();
  closeLedgerActions();
}
function runCustomerAction(action:'view'|'edit'|'delete'){
  const c=customerActionMenu.value?.customer;
  if(!c) return;
  closeCustomerActions();
  if(action==='view') void view(c);
  else if(action==='edit') edit(c);
  else askDeleteCustomer(c);
}

async function load(){ loading.value=true; try{const r=await getCustomersPage();customers.value=r.customers;bankAccounts.value=r.bankAccounts;activeCashSession.value=r.activeCashSession;}catch(e){fail(e);}finally{loading.value=false;} }
function resetForm(){Object.assign(form,{name:'',fatherName:'',phone:'',address:'',openingBalance:0,notes:''});editingId.value='';formError.value='';}
function add(){resetForm();modal.value='form';}
function edit(c:CustomerRow){editingId.value=c.id;Object.assign(form,{name:c.name,fatherName:c.fatherName||'',phone:c.phone,address:c.address||'',openingBalance:Number(c.openingBalance||0),notes:c.notes||''});modal.value='form';}
async function save(){formError.value='';saving.value=true;try{if(editingId.value)await updateCustomer(editingId.value,form);else await createCustomer(form);close();toast('Customer saved');await load();}catch(e){formError.value=e instanceof Error?e.message:String(e);}finally{saving.value=false;}}
async function view(c:CustomerRow){try{const r=await getCustomerDetail(c.id, ledgerFilters);detail.value=r.detail;Object.assign(pay,{amount:0,method:'Cash',bankAccountId:'',notes:'',date:today(),backdatedReason:''});modal.value='detail';}catch(e){fail(e);}}
async function refreshDetail(){if(!detail.value)return;const r=await getCustomerDetail(detail.value.customer.id, ledgerFilters);detail.value=r.detail;}
async function receive(){if(!detail.value)return;paymentError.value='';try{await receiveCustomerPayment(detail.value.customer.id,pay);toast('Payment recorded');await load();await refreshDetail();Object.assign(pay,{amount:0,method:'Cash',bankAccountId:'',notes:'',date:today(),backdatedReason:''});}catch(e){paymentError.value=e instanceof Error?e.message:String(e);}}
async function editPayment(row:CustomerLedgerRow){try{const r=await getCustomerPaymentForEdit(row.ledgerId);editingPaymentId.value=row.ledgerId;Object.assign(pay,{amount:r.payment.amount,method:r.payment.method||'Cash',bankAccountId:r.payment.bankAccountId||'',notes:r.payment.notes||'',date:r.payment.date,backdatedReason:''});modal.value='payment-edit';}catch(e){fail(e);}}
async function savePaymentEdit(){paymentError.value='';try{await updateCustomerPayment(editingPaymentId.value,pay);toast('Payment updated');modal.value='detail';await load();await refreshDetail();}catch(e){paymentError.value=e instanceof Error?e.message:String(e);}}
function askDeletePayment(row:CustomerLedgerRow){paymentDeleteTarget.value=row;deleteReason.value='';modal.value='payment-delete';}
async function confirmDeletePayment(){if(!paymentDeleteTarget.value)return;try{await deleteCustomerPayment(paymentDeleteTarget.value.ledgerId,deleteReason.value);toast('Payment deleted');modal.value='detail';await load();await refreshDetail();}catch(e){paymentError.value=e instanceof Error?e.message:String(e);}}
function askDeleteSale(row:CustomerLedgerRow){saleDeleteTarget.value=row;deleteReason.value='';paymentError.value='';modal.value='sale-delete';}
async function confirmDeleteSale(){
  if(!saleDeleteTarget.value)return;
  if(!deleteReason.value.trim()){paymentError.value='Enter a delete reason.';return;}
  const invoiceId=String(saleDeleteTarget.value.reference||'').trim();
  if(!invoiceId){paymentError.value='Invoice reference is missing for this sale.';return;}
  try{
    await deleteSale(invoiceId,deleteReason.value.trim());
    toast('Sale deleted and reversed');
    saleDeleteTarget.value=null;
    modal.value='detail';
    await load();
    await refreshDetail();
  }catch(e){paymentError.value=e instanceof Error?e.message:String(e);}
}
function askDeleteCustomer(c:CustomerRow){customerDeleteTarget.value=c;deleteReason.value='';deleteKey.value='';modal.value='customer-delete';}
async function confirmDeleteCustomer(){if(!customerDeleteTarget.value)return;try{await deleteCustomer(customerDeleteTarget.value.id,deleteKey.value,deleteReason.value);close();toast('Customer deleted');await load();}catch(e){formError.value=e instanceof Error?e.message:String(e);}}


watch(() => props.openRequest?.nonce, async () => {
  const req = props.openRequest;
  if (!req?.customerId) return;
  try {
    const r = await getCustomerDetail(req.customerId, ledgerFilters);
    detail.value = r.detail;
    Object.assign(pay,{amount:0,method:'Cash',bankAccountId:'',notes:'',date:today(),backdatedReason:''});
    modal.value = 'detail';
    if (req.ledgerId && req.action && req.action !== 'open') {
      const paymentRow = { ledgerId: req.ledgerId, type: 'Payment' } as CustomerLedgerRow;
      if (req.action === 'edit-payment') await editPayment(paymentRow);
      else if (req.action === 'delete-payment') askDeletePayment(paymentRow);
    }
  } catch (e) { fail(e); }
});

const customerLedgerColumns = [
  { label: 'Date', value: (r: CustomerLedgerRow) => dateShort(r.date) },
  { label: 'Type', key: 'type' as const },
  { label: 'Reference', key: 'reference' as const },
  { label: 'Debit (খরচ)', value: (r: CustomerLedgerRow) => r.debit ? money(r.debit) : '', align: 'right' as const },
  { label: 'Credit (জমা)', value: (r: CustomerLedgerRow) => r.credit ? money(r.credit) : '', align: 'right' as const },
  { label: 'Balance', value: (r: CustomerLedgerRow) => r.balance > 0 ? `Due ${money(r.balance)}` : r.balance < 0 ? `Advance ${money(Math.abs(r.balance))}` : `Settled ${money(0)}`, align: 'right' as const },
  { label: 'Notes', key: 'notes' as const }
];
function printCustomerLedger(): void {
  if (!detail.value) return;
  const rows = sortRows('customer-ledger', detail.value.ledger);
  const h = detail.value.history;
  const s = detail.value.summary;
  printRows({
    title: 'Customer Ledger',
    subtitle: `${detail.value.customer.name}${detail.value.customer.phone ? ` — ${detail.value.customer.phone}` : ''}`,
    businessHeader: detail.value.printHeader,
    contextLines: [
      `Date range: ${h.from || 'Beginning'} to ${h.to}`,
      `Showing ${h.returnedCount} of ${h.matchingCount} matching records · Limit ${h.limit}`
    ],
    columns: customerLedgerColumns,
    rows,
    footerLines: [
      { label: 'Opening Balance (shown rows)', value: money(s.displayedOpeningBalance) },
      { label: 'Total Debit / খরচ (shown rows)', value: money(s.totalDebit) },
      { label: 'Total Credit / জমা (shown rows)', value: money(s.totalCredit) },
      { label: 'Closing Balance (shown rows)', value: money(s.displayedClosingBalance) },
      { label: 'Current Balance', value: detail.value.customer.currentDue < 0 ? `Advance ${money(Math.abs(detail.value.customer.currentDue))}` : detail.value.customer.currentDue > 0 ? `Due ${money(detail.value.customer.currentDue)}` : `Settled ${money(0)}` }
    ]
  });
}
function exportCustomerLedger(): void {
  if (!detail.value) return;
  exportRowsToCsv({
    filename: `customer-ledger-${detail.value.customer.name}-${detail.value.customer.phone || detail.value.customer.id}`,
    columns: customerLedgerColumns,
    rows: sortRows('customer-ledger', detail.value.ledger)
  });
}

async function refresh(): Promise<void> {
  await load();
  if (detail.value) await refreshDetail();
}
defineExpose({ refresh });

onMounted(()=>{ void load(); document.addEventListener('pointerdown', onDocumentPointerDown); window.addEventListener('resize', closeLedgerActions); window.addEventListener('scroll', closeLedgerActions, true); });
onBeforeUnmount(()=>{ document.removeEventListener('pointerdown', onDocumentPointerDown); window.removeEventListener('resize', closeLedgerActions); window.removeEventListener('scroll', closeLedgerActions, true); });
</script>

<template>
  <div class="customer-page">
    <div v-if="message" class="toast success">{{message}}</div><div v-if="error" class="toast error">{{error}}</div>
    <div class="toolbar customer-toolbar"><input v-model="search" class="search-input" placeholder="Search by name or phone..."/><div class="toolbar-spacer"></div><button class="btn btn-primary" @click="add">+ Add Customer</button></div>
    <div class="cash-session-note" v-if="!activeCashSession">Customer opening balance and payments require an open POS cash session. <span class="bn-hint" style="display:inline">POS চালু হলে পেমেন্ট করা যাবে।</span></div>
    <div class="card customer-list-card" style="padding:0"><div class="customer-list-scroll"><table class="customer-table"><thead><tr><SortableHeader table-id="customers" column="name">Customer</SortableHeader><SortableHeader table-id="customers" column="phone">Phone</SortableHeader><SortableHeader table-id="customers" column="address">Address</SortableHeader><SortableHeader table-id="customers" column="currentDue" type="number" class="num">Current Due</SortableHeader><th></th></tr></thead><tbody>
      <tr v-if="loading"><td colspan="5">Loading customers...</td></tr>
      <tr v-for="c in $sortRows('customers', filtered)" :key="c.id"><td><button type="button" class="ledger-name-link" @click="view(c)">{{c.name}}</button><div class="bn-hint">{{c.fatherName||''}}</div></td><td>{{c.phone}}</td><td>{{c.address||''}}</td><td class="num mono"><span v-if="c.currentDue>0" class="badge badge-danger">Due {{money(c.currentDue)}}</span><span v-else-if="c.currentDue<0" class="badge badge-success">Advance {{money(Math.abs(c.currentDue))}}</span><span v-else class="badge badge-success">Settled {{money(0)}}</span></td><td class="action-cell"><button class="btn btn-sm action-trigger customer-action-trigger" @click="toggleCustomerActions($event, c)">Actions</button></td></tr>
    </tbody></table></div><div class="empty-state" v-if="!loading&&filtered.length===0">No customers yet.</div></div>

    <Teleport to="body">
      <div v-if="ledgerActionMenu" class="action-dropdown customer-ledger-action-menu" :style="{position:'fixed',top:ledgerActionMenu.top+'px',left:ledgerActionMenu.left+'px',width:ledgerActionMenu.width+'px',zIndex:'10040'}" @pointerdown.stop>
        <template v-if="ledgerActionMenu.row.type==='Sale'">
          <button @click="runLedgerAction('view-sale')">View Invoice</button>
          <button @click="runLedgerAction('return-sale')">Sales Return</button>
          <button @click="runLedgerAction('payment-sale')">Receive Payment</button>
          <button class="danger" @click="runLedgerAction('delete-sale')">Delete Sale</button>
        </template>
        <template v-else>
          <button @click="runLedgerAction('edit')">Edit Payment</button>
          <div class="action-dropdown-separator"></div>
          <button class="danger" @click="runLedgerAction('delete')">Delete Payment</button>
        </template>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="customerActionMenu"
        class="customer-action-menu"
        :style="{ left: customerActionMenu.left + 'px', top: customerActionMenu.top + 'px' }"
        @pointerdown.stop
      >
        <button @click="runCustomerAction('view')">View</button>
        <button @click="runCustomerAction('edit')">Edit</button>
        <div class="customer-action-separator"></div>
        <button class="danger" @click="runCustomerAction('delete')">Delete</button>
      </div>
    </Teleport>

    <div class="modal-overlay" v-if="modal==='form'"><div class="modal"><div class="modal-header"><div><h3>{{editingId?'Edit Customer':'Add Customer'}}</h3><span class="bn-hint">কাস্টমারের তথ্য</span></div><button class="modal-close" @click="close">✕</button></div><div class="modal-body"><div class="form-grid">
      <div class="full"><label>Customer Name *</label><input v-model.trim="form.name"/></div><div><label>Father Name</label><input v-model.trim="form.fatherName"/></div><div><label>Phone *</label><input v-model.trim="form.phone"/></div><div><label>Opening Balance (Due)</label><input v-model.number="form.openingBalance" type="number" min="0" step="0.01" :disabled="!!editingId"/></div><div class="full"><label>Address</label><input v-model.trim="form.address"/></div><div class="full"><label>Notes</label><input v-model.trim="form.notes"/></div>
    </div><div class="field-error" v-if="formError">{{formError}}</div></div><div class="modal-footer"><button class="btn" @click="close">Cancel</button><button class="btn btn-primary" :disabled="saving" @click="save">{{saving?'Saving...':'Save Customer'}}</button></div></div></div>

    <div class="modal-overlay" v-if="modal==='detail'&&detail"><div class="modal modal-lg"><div class="modal-header"><div><h3>{{detail.customer.name}} — {{detail.customer.phone}}</h3><span class="bn-hint">কাস্টমারের বাকি ও হিসাব</span></div><button class="modal-close" @click="close">✕</button></div><div class="modal-body">
      <div class="customer-pay-grid">
        <div class="current-due-block">
          <div class="stat-label">Current Balance</div>
          <div v-if="detail.customer.currentDue>0" class="balance-status balance-due">Due {{money(detail.customer.currentDue)}}</div>
          <div v-else-if="detail.customer.currentDue<0" class="balance-status balance-advance">Advance {{money(Math.abs(detail.customer.currentDue))}}</div>
          <div v-else class="balance-status balance-settled">Settled {{money(0)}}</div>
        </div>
        <div><label>Receive Payment</label><input v-model.number="pay.amount" type="number" min="0" step="0.01" placeholder="Amount"/></div>
        <div><label>Method</label><select v-model="pay.method"><option>Cash</option><option>Bank</option><option>Mobile Banking</option></select></div>
        <div v-if="payNeedsBank"><label>Account *</label><select v-model="pay.bankAccountId"><option value="">Select account...</option><option v-for="b in bankAccounts" :key="b.id" :value="b.id">{{b.name}}</option></select></div>
        <div><label>Note</label><input v-model.trim="pay.notes" placeholder="Optional"/></div>
        <div><label>Payment Date</label><input v-model="pay.date" type="date"/></div>
        <button class="btn btn-primary pay-button" :disabled="!activeCashSession" @click="receive">Receive</button>
        <div class="full" v-if="payBackdated"><label>Reason for Backdating *</label><input v-model.trim="pay.backdatedReason"/></div>
      </div>
      <div class="field-error" v-if="paymentError">{{paymentError}}</div>
      <LedgerHistoryControls v-model:from="ledgerFilters.from" v-model:to="ledgerFilters.to" v-model:limit="ledgerFilters.limit" :matching-count="detail.history.matchingCount" :returned-count="detail.history.returnedCount" :has-more="detail.history.hasMore" :loading="loading" @refresh="refreshDetail" />
      <div class="ledger-history-summary"><span>Opening: <strong>{{money(detail.summary.displayedOpeningBalance)}}</strong></span><span>Debit / খরচ: <strong>{{money(detail.summary.totalDebit)}}</strong></span><span>Credit / জমা: <strong>{{money(detail.summary.totalCredit)}}</strong></span><span>Closing: <strong>{{money(detail.summary.displayedClosingBalance)}}</strong></span></div>
      <div class="table-scroll"><table class="customer-ledger-table"><thead><tr><SortableHeader table-id="customer-ledger" column="date" type="date">Date</SortableHeader><SortableHeader table-id="customer-ledger" column="type">Type</SortableHeader><SortableHeader table-id="customer-ledger" column="reference">Reference</SortableHeader><SortableHeader table-id="customer-ledger" column="debit" type="number" class="num"><span class="ledger-head">Debit<small>খরচ</small></span></SortableHeader><SortableHeader table-id="customer-ledger" column="credit" type="number" class="num"><span class="ledger-head">Credit<small>জমা</small></span></SortableHeader><SortableHeader table-id="customer-ledger" column="balance" type="number" class="num">Balance</SortableHeader><th></th></tr></thead><tbody><tr v-for="r in $sortRows('customer-ledger', detail.ledger)" :key="r.ledgerId"><td>{{dateShort(r.date)}}</td><td>{{r.type}}</td><td class="mono">{{r.reference}}</td><td class="num mono">{{r.debit?money(r.debit):''}}</td><td class="num mono">{{r.credit?money(r.credit):''}}</td><td class="num mono"><span v-if="r.balance>0" class="balance-pill balance-pill-due">Due {{money(r.balance)}}</span><span v-else-if="r.balance<0" class="balance-pill balance-pill-advance">Advance {{money(Math.abs(r.balance))}}</span><span v-else class="balance-pill balance-pill-settled">Settled {{money(0)}}</span></td><td><button v-if="r.type==='Payment'||r.type==='Sale'" class="btn btn-sm action-trigger customer-ledger-action-trigger" @click="toggleLedgerActions($event,r)">Actions</button></td></tr></tbody></table></div><div class="empty-state" v-if="detail.ledger.length===0">No transactions yet.</div>
    </div><div class="modal-footer"><button class="btn" @click="exportCustomerLedger">Export CSV</button><button class="btn" @click="printCustomerLedger">Print</button><button class="btn" @click="close">Close</button></div></div></div>


    <SalesInvoiceDetail
      v-if="saleInvoiceAction"
      :open="true"
      :invoice-id="saleInvoiceAction.invoiceId"
      :initial-action="saleInvoiceAction.initialAction"
      @close="saleInvoiceAction=null"
      @changed="handleSaleInvoiceChanged"
    />

    <div class="modal-overlay" v-if="modal==='payment-edit'"><div class="modal"><div class="modal-header"><h3>Edit Payment</h3><button class="modal-close" @click="close">✕</button></div><div class="modal-body"><div class="form-grid"><div><label>Date *</label><input v-model="pay.date" type="date"/></div><div><label>Amount *</label><input v-model.number="pay.amount" type="number" min="0" step="0.01"/></div><div><label>Payment Method</label><select v-model="pay.method"><option>Cash</option><option>Bank</option><option>Mobile Banking</option></select></div><div v-if="payNeedsBank"><label>Account *</label><select v-model="pay.bankAccountId"><option value="">Select account...</option><option v-for="b in bankAccounts" :key="b.id" :value="b.id">{{b.name}}</option></select></div><div class="full"><label>Note</label><input v-model.trim="pay.notes"/></div></div><div class="field-error" v-if="paymentError">{{paymentError}}</div></div><div class="modal-footer"><button class="btn" @click="modal='detail'">Cancel</button><button class="btn btn-primary" @click="savePaymentEdit">Save Changes</button></div></div></div>

    <div class="modal-overlay" v-if="modal==='payment-delete'&&paymentDeleteTarget"><div class="modal modal-sm"><div class="modal-header"><h3>Delete Payment</h3><button class="modal-close" @click="modal='detail'">✕</button></div><div class="modal-body"><label>Delete Reason *</label><input v-model.trim="deleteReason"/><div class="field-error" v-if="paymentError">{{paymentError}}</div></div><div class="modal-footer"><button class="btn" @click="modal='detail'">Cancel</button><button class="btn btn-danger" @click="confirmDeletePayment">Delete Payment</button></div></div></div>
    <div class="modal-overlay" v-if="modal==='sale-delete'&&saleDeleteTarget"><div class="modal modal-sm"><div class="modal-header"><h3>Delete Sale {{ saleDeleteTarget.reference }}</h3><button class="modal-close" @click="modal='detail'">✕</button></div><div class="modal-body"><p>This uses the existing Sales delete/reversal rules. Stock, customer balance and payment entries are reversed. Sales with protected returns cannot be deleted.</p><label>Delete Reason *</label><input v-model.trim="deleteReason" placeholder="Why is this sale being deleted?"/><div class="field-error" v-if="paymentError">{{paymentError}}</div></div><div class="modal-footer"><button class="btn" @click="modal='detail'">Cancel</button><button class="btn btn-danger" @click="confirmDeleteSale">Delete Sale</button></div></div></div>

    <div class="modal-overlay" v-if="modal==='customer-delete'&&customerDeleteTarget"><div class="modal modal-sm"><div class="modal-header"><h3>Delete Customer</h3><button class="modal-close" @click="close">✕</button></div><div class="modal-body"><p>Customer must have zero due/credit before deletion.</p><label>Delete Confirmation Key *</label><input v-model.trim="deleteKey" type="password"/><label>Reason</label><input v-model.trim="deleteReason"/><div class="field-error" v-if="formError">{{formError}}</div></div><div class="modal-footer"><button class="btn" @click="close">Cancel</button><button class="btn btn-danger" @click="confirmDeleteCustomer">Delete Customer</button></div></div></div>
  </div>
</template>

<style scoped>
.customer-toolbar{margin-bottom:12px}.customer-list-card{overflow:visible}.customer-list-scroll{overflow-x:auto;overflow-y:visible;max-height:none!important;-webkit-overflow-scrolling:touch}.customer-table{width:100%;min-width:720px}.customer-ledger-table{min-width:820px}.customer-pay-grid{display:grid;grid-template-columns:1.15fr 1fr .85fr 1.1fr 1.2fr auto;gap:10px;align-items:end;margin-bottom:12px}.customer-pay-grid .full{grid-column:1/-1}.current-due-block{align-self:center;min-width:190px}.balance-status{font-size:25px;font-weight:800;line-height:1.15;margin-top:4px;white-space:nowrap}.balance-due{color:#dc2626}.balance-advance{color:#16a34a}.balance-settled{color:#16a34a}.ledger-head{display:inline-flex;flex-direction:column;line-height:1.05;align-items:flex-end}.ledger-head small{font-size:11px;font-weight:500;margin-top:3px}.balance-pill{display:inline-block;border-radius:999px;padding:4px 8px;font-weight:700;white-space:nowrap}.balance-pill-due{background:#fee2e2;color:#b91c1c}.balance-pill-advance{background:#dcfce7;color:#15803d}.balance-pill-settled{background:#dcfce7;color:#15803d}.pay-button{height:42px}@media(max-width:1050px){.customer-pay-grid{grid-template-columns:1fr 1fr 1fr}.current-due-block{grid-column:1/-1}.pay-button{width:100%}}@media(max-width:700px){.customer-pay-grid{grid-template-columns:1fr 1fr}.current-due-block{grid-column:1/-1}}@media(max-width:560px){.customer-toolbar{display:grid;grid-template-columns:1fr}.customer-toolbar .toolbar-spacer{display:none}.customer-toolbar .btn{width:100%}.customer-pay-grid{grid-template-columns:1fr}.customer-pay-grid .full{grid-column:auto}}
</style>

<style scoped>
.customer-action-menu {
  position: fixed;
  z-index: 10050;
  width: 190px;
  padding: 6px;
  background: #fff;
  border: 1px solid #dfe5ee;
  border-radius: 10px;
  box-shadow: 0 10px 28px rgba(15, 23, 42, .16);
}
.customer-action-menu button {
  width: 100%;
  display: block;
  border: 0;
  background: transparent;
  border-radius: 7px;
  padding: 11px 12px;
  text-align: left;
  font: inherit;
  color: #273247;
  cursor: pointer;
}
.customer-action-menu button:hover,
.customer-action-menu button:focus-visible {
  background: #eef4ff;
  outline: none;
}
.customer-action-menu button.danger { color: #e11d48; }
.customer-action-menu button.danger:hover,
.customer-action-menu button.danger:focus-visible { background: #fff0f3; }
.customer-action-separator { height: 1px; margin: 4px 2px; background: #e5e9f0; }
.customer-action-trigger { white-space: nowrap; }
</style>
