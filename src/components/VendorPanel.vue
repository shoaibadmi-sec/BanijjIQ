<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { notifySuccess, notifyError } from '../utils/notify';
import LedgerHistoryControls from './LedgerHistoryControls.vue';
import ProductSearchSelect from './ui/ProductSearchSelect.vue';
import {
  addVendor, getVendorDetail, getVendorsBootstrap, giveProductsToVendor, payVendor,
  receiveProductsFromVendor, receiveVendorPayment, returnProductsToVendor, setVendorStatus, updateVendor
} from '../api';
import type {
  AuthUser, ModulePermission, VendorBootstrap, VendorDetail, VendorLedgerRow, VendorSummary
} from '../types';
import { exportRowsToCsv, printRows } from '../utils/tableOutput';
import { sortRows } from '../utils/tableSorting';
import { useLedgerHistory } from '../composables/useLedgerHistory';

const props = defineProps<{ authUser: AuthUser }>();
const today = new Date().toISOString().slice(0,10);

type VendorView = 'vendors' | 'workspace' | 'ledger';
type ActivityView = 'sourcing' | 'returns' | 'issues' | 'received';

const bootstrap = ref<VendorBootstrap|null>(null);
const detail = ref<VendorDetail|null>(null);
const activeView = ref<VendorView>('vendors');
const activityView = ref<ActivityView>('sourcing');
const selectedVendorId = ref('');
const loading = ref(false);
const detailLoading = ref(false);
const saving = ref(false);
const error = ref('');
const message = ref('');
const query = ref('');
const addOpen = ref(false);
const editOpen = ref(false);
const addForm = reactive({name:'',phone:''});
const editForm = reactive({name:'',phone:''});
const addError = ref('');
const editError = ref('');
const actionMenu = ref<{row:VendorSummary;top:number;left:number;width:number}|null>(null);

const payForm = reactive({amount:0,method:'Cash',bankAccountId:'',notes:'',date:today,backdatedReason:''});
const retForm = reactive({sourcingId:'',quantity:0,unitCost:0,notes:'',date:today,backdatedReason:''});
const giveForm = reactive({productId:'',quantity:0,unitValue:0,notes:'',date:today,backdatedReason:''});
const recvForm = reactive({amount:0,method:'Cash',bankAccountId:'',notes:'',date:today,backdatedReason:''});
const recvProdForm = reactive({issueId:'',quantity:0,unitValue:0,notes:'',date:today,backdatedReason:''});
const formError = ref('');
const { filters: ledgerFilters } = useLedgerHistory();

function perm(action:'view'|'add'|'edit'):boolean{
  if(props.authUser.role==='admin')return true;
  const p=props.authUser.permissions?.vendors as ModulePermission|undefined;
  return !!p?.[action];
}
const currency = computed(()=>bootstrap.value?.currencySymbol||'৳');
const rows = computed(()=>{
  const q=query.value.trim().toLowerCase();
  return (bootstrap.value?.vendors||[]).filter(v=>!q||v.name.toLowerCase().includes(q)||v.phone.includes(q));
});
const selectedVendor = computed(()=>bootstrap.value?.vendors.find(v=>v.id===selectedVendorId.value)||detail.value?.vendor||null);
const bankOptions = computed(()=>bootstrap.value?.bankAccounts||[]);
const productOptions = computed(()=>bootstrap.value?.products||[]);
const payBanks = computed(()=>bankOptions.value.filter(b=>payForm.method==='Mobile Banking'?b.type==='Mobile Banking':payForm.method==='Bank'?b.type==='Bank':true));
const recvBanks = computed(()=>bankOptions.value.filter(b=>recvForm.method==='Mobile Banking'?b.type==='Mobile Banking':recvForm.method==='Bank'?b.type==='Bank':true));
const isBackdated = (date:string)=>!!date&&date<today;
const money = (v:unknown)=>`${currency.value}${Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})}`;
const whole = (v:unknown)=>Number(v||0).toLocaleString(undefined,{maximumFractionDigits:0});
function showSuccess(t:string){message.value='';error.value='';notifySuccess(t)}
function showError(t:string){error.value=t;message.value='';notifyError(t)}
function needsBank(method:string){return method==='Bank'||method==='Mobile Banking'}

function resetOperationForms(){
  formError.value='';
  Object.assign(payForm,{amount:0,method:'Cash',bankAccountId:'',notes:'',date:today,backdatedReason:''});
  Object.assign(retForm,{sourcingId:'',quantity:0,unitCost:0,notes:'',date:today,backdatedReason:''});
  Object.assign(giveForm,{productId:'',quantity:0,unitValue:0,notes:'',date:today,backdatedReason:''});
  Object.assign(recvForm,{amount:0,method:'Cash',bankAccountId:'',notes:'',date:today,backdatedReason:''});
  Object.assign(recvProdForm,{issueId:'',quantity:0,unitValue:0,notes:'',date:today,backdatedReason:''});
}

async function load():Promise<void>{
  loading.value=true;error.value='';
  try{
    bootstrap.value=await getVendorsBootstrap();
    if(selectedVendorId.value&&!bootstrap.value.vendors.some(v=>v.id===selectedVendorId.value)){
      selectedVendorId.value='';detail.value=null;activeView.value='vendors';
    }
  }
  catch(e){showError(e instanceof Error?e.message:'Vendor workspace failed to load.')}
  finally{loading.value=false}
}
async function loadDetail(vendorId=selectedVendorId.value, resetForms=false):Promise<void>{
  if(!vendorId){detail.value=null;return}
  detailLoading.value=true;formError.value='';
  try{
    detail.value=await getVendorDetail(vendorId, ledgerFilters);
    selectedVendorId.value=vendorId;
    if(resetForms)resetOperationForms();
  }catch(e){showError(e instanceof Error?e.message:'Could not load vendor.')}
  finally{detailLoading.value=false}
}
async function refreshDetail():Promise<void>{if(selectedVendorId.value)await loadDetail(selectedVendorId.value,false)}
async function selectVendor(vendorId:string):Promise<void>{
  selectedVendorId.value=vendorId;
  detail.value=null;
  if(vendorId)await loadDetail(vendorId,true);
}
function onVendorSelectEvent(event:Event):void{void selectVendor((event.target as HTMLSelectElement).value)}
async function openWorkspace(v:VendorSummary){closeActions();activeView.value='workspace';await selectVendor(v.id)}
async function openLedger(v:VendorSummary){closeActions();activeView.value='ledger';await selectVendor(v.id)}
function goView(view:VendorView){activeView.value=view;if(view!=='vendors'&&selectedVendorId.value&&!detail.value)void loadDetail(selectedVendorId.value,false)}

function openAdd(){addForm.name='';addForm.phone='';addError.value='';addOpen.value=true}
async function saveVendor(){
  addError.value='';if(!addForm.name.trim()){addError.value='Vendor name is required.';return}
  saving.value=true;
  try{const r=await addVendor({name:addForm.name.trim(),phone:addForm.phone.trim()});addOpen.value=false;showSuccess('Vendor added');await load();selectedVendorId.value=r.id;activeView.value='workspace';await loadDetail(r.id,true)}
  catch(e){addError.value=e instanceof Error?e.message:'Could not add vendor.'}
  finally{saving.value=false}
}
function openEdit(v:VendorSummary|null=selectedVendor.value){
  closeActions();if(!v)return;selectedVendorId.value=v.id;editForm.name=v.name;editForm.phone=v.phone||'';editError.value='';editOpen.value=true;
}
async function saveVendorEdit(){
  if(!selectedVendorId.value)return;editError.value='';if(!editForm.name.trim()){editError.value='Vendor name is required.';return}
  saving.value=true;
  try{await updateVendor(selectedVendorId.value,{name:editForm.name.trim(),phone:editForm.phone.trim()});editOpen.value=false;showSuccess('Vendor details updated');await load();await refreshDetail()}
  catch(e){editError.value=e instanceof Error?e.message:'Could not update vendor.'}
  finally{saving.value=false}
}
async function toggleStatus(v:VendorSummary|null=selectedVendor.value){
  closeActions();if(!v)return;const next=v.status==='Active'?'Inactive':'Active';
  if(!confirm(`${next==='Inactive'?'Deactivate':'Activate'} "${v.name}"?`))return;
  try{await setVendorStatus(v.id,next);showSuccess('Vendor updated');await load();if(v.id===selectedVendorId.value)await refreshDetail()}
  catch(e){showError(e instanceof Error?e.message:'Could not update vendor.')}
}
function openActions(event:MouseEvent,row:VendorSummary){
  event.stopPropagation();const r=(event.currentTarget as HTMLElement).getBoundingClientRect();const width=190,gap=8;
  let left=Math.max(gap,Math.min(r.left,window.innerWidth-width-gap)),top=r.bottom+5;
  if(top+180>window.innerHeight-gap)top=Math.max(gap,r.top-180);
  actionMenu.value={row,top,left,width}
}
function closeActions(){actionMenu.value=null}
function outside(e:Event){const t=e.target as HTMLElement|null;if(!t?.closest('.vendor-action-menu,.vendor-action-trigger'))closeActions()}

const vendorLedgerColumns = [
  { label: 'Date', key: 'date' as const },
  { label: 'Type', key: 'type' as const },
  { label: 'Balance Type', key: 'balanceType' as const },
  { label: 'Reference', key: 'reference' as const },
  { label: 'Debit (খরচ)', value: (r: VendorLedgerRow) => r.debit ? money(r.debit) : '', align: 'right' as const },
  { label: 'Credit (জমা)', value: (r: VendorLedgerRow) => r.credit ? money(r.credit) : '', align: 'right' as const },
  { label: 'Balance', value: (r: VendorLedgerRow) => money(r.balance), align: 'right' as const },
  { label: 'Notes', key: 'notes' as const }
];
function printVendorLedger(): void {
  if (!detail.value) return;
  const rows = sortRows('vendor-ledger', detail.value.ledger);
  const h = detail.value.history;
  printRows({
    title: 'Vendor Ledger',
    subtitle: `${detail.value.vendor.name}${detail.value.vendor.phone ? ` — ${detail.value.vendor.phone}` : ''}`,
    businessHeader: detail.value.printHeader,
    contextLines: [`Date range: ${h.from || 'Beginning'} to ${h.to}`, `Showing ${h.returnedCount} of ${h.matchingCount} matching records · Limit ${h.limit}`],
    columns: vendorLedgerColumns,
    rows,
    footerLines: [
      { label: 'Payable Opening (shown rows)', value: money(detail.value.payableSummary.displayedOpeningBalance) },
      { label: 'Payable Closing (shown rows)', value: money(detail.value.payableSummary.displayedClosingBalance) },
      { label: 'Receivable Opening (shown rows)', value: money(detail.value.receivableSummary.displayedOpeningBalance) },
      { label: 'Receivable Closing (shown rows)', value: money(detail.value.receivableSummary.displayedClosingBalance) },
      { label: 'Current Payable', value: money(detail.value.vendor.currentDue) },
      { label: 'Current Receivable', value: money(detail.value.vendor.currentReceivable) }
    ]
  });
}
function exportVendorLedger(): void {
  if (!detail.value) return;
  exportRowsToCsv({filename:`vendor-ledger-${detail.value.vendor.name}`,columns:vendorLedgerColumns,rows:sortRows('vendor-ledger', detail.value.ledger)});
}

function selectSourcing(){const s=detail.value?.openSourcing.find(x=>x.sourcingId===retForm.sourcingId);if(s){retForm.quantity=s.remainingQty;retForm.unitCost=s.unitCost}}
function selectIssue(){const s=detail.value?.openIssues.find(x=>x.issueId===recvProdForm.issueId);if(s){recvProdForm.quantity=s.remainingQty;recvProdForm.unitValue=s.unitValue}}
function selectProduct(){const p=productOptions.value.find(x=>x.id===giveForm.productId);if(p&&giveForm.quantity>p.currentStock)giveForm.quantity=Math.max(0,Math.floor(p.currentStock))}
function validateBackdate(date:string,reason:string):string{return isBackdated(date)&&!reason.trim()?'Reason for backdating is required.':''}
async function doPay(){
  if(!detail.value)return;formError.value='';if(!(Number(payForm.amount)>0)){formError.value='Enter a valid payment amount.';return}
  if(needsBank(payForm.method)&&!payForm.bankAccountId){formError.value='Choose the bank/mobile account.';return}
  formError.value=validateBackdate(payForm.date,payForm.backdatedReason);if(formError.value)return;
  saving.value=true;try{await payVendor(detail.value.vendor.id,{...payForm,amount:Number(payForm.amount)});showSuccess('Vendor payment saved');await Promise.all([load(),refreshDetail()]);payForm.amount=0;payForm.notes=''}
  catch(e){formError.value=e instanceof Error?e.message:'Payment failed.'}finally{saving.value=false}
}
async function doReturn(){
  if(!detail.value)return;formError.value='';if(!retForm.sourcingId){formError.value='Choose a sourcing transaction.';return}
  if(!(Number(retForm.quantity)>0)){formError.value='Enter a valid quantity.';return}
  formError.value=validateBackdate(retForm.date,retForm.backdatedReason);if(formError.value)return;
  saving.value=true;try{await returnProductsToVendor(detail.value.vendor.id,{...retForm,quantity:Math.round(Number(retForm.quantity)),unitCost:Number(retForm.unitCost)});showSuccess('Products returned to vendor');await Promise.all([load(),refreshDetail()]);retForm.sourcingId='';retForm.quantity=0}
  catch(e){formError.value=e instanceof Error?e.message:'Return failed.'}finally{saving.value=false}
}
async function doGive(){
  if(!detail.value)return;formError.value='';if(!giveForm.productId){formError.value='Choose a product.';return}
  if(!(Number(giveForm.quantity)>0)){formError.value='Enter a valid quantity.';return}
  formError.value=validateBackdate(giveForm.date,giveForm.backdatedReason);if(formError.value)return;
  saving.value=true;try{await giveProductsToVendor(detail.value.vendor.id,{...giveForm,quantity:Math.round(Number(giveForm.quantity)),unitValue:Number(giveForm.unitValue)});showSuccess('Products given to vendor');await Promise.all([load(),refreshDetail()]);giveForm.productId='';giveForm.quantity=0}
  catch(e){formError.value=e instanceof Error?e.message:'Could not give products.'}finally{saving.value=false}
}
async function doReceive(){
  if(!detail.value)return;formError.value='';if(!(Number(recvForm.amount)>0)){formError.value='Enter a valid amount.';return}
  if(needsBank(recvForm.method)&&!recvForm.bankAccountId){formError.value='Choose the bank/mobile account.';return}
  formError.value=validateBackdate(recvForm.date,recvForm.backdatedReason);if(formError.value)return;
  saving.value=true;try{await receiveVendorPayment(detail.value.vendor.id,{...recvForm,amount:Number(recvForm.amount)});showSuccess('Vendor receipt saved');await Promise.all([load(),refreshDetail()]);recvForm.amount=0;recvForm.notes=''}
  catch(e){formError.value=e instanceof Error?e.message:'Receipt failed.'}finally{saving.value=false}
}
async function doReceiveProducts(){
  if(!detail.value)return;formError.value='';if(!recvProdForm.issueId){formError.value='Choose an issue transaction.';return}
  if(!(Number(recvProdForm.quantity)>0)){formError.value='Enter a valid quantity.';return}
  formError.value=validateBackdate(recvProdForm.date,recvProdForm.backdatedReason);if(formError.value)return;
  saving.value=true;try{await receiveProductsFromVendor(detail.value.vendor.id,{...recvProdForm,quantity:Math.round(Number(recvProdForm.quantity)),unitValue:Number(recvProdForm.unitValue)});showSuccess('Products received from vendor');await Promise.all([load(),refreshDetail()]);recvProdForm.issueId='';recvProdForm.quantity=0}
  catch(e){formError.value=e instanceof Error?e.message:'Could not receive products.'}finally{saving.value=false}
}

async function refresh(): Promise<void> {await load();if(selectedVendorId.value)await refreshDetail()}
defineExpose({ refresh });

onMounted(()=>{document.addEventListener('pointerdown',outside);window.addEventListener('resize',closeActions);window.addEventListener('scroll',closeActions,true);void load()})
onBeforeUnmount(()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',closeActions);window.removeEventListener('scroll',closeActions,true)})
</script>

<template>
  <section class="vendor-page">
    <div v-if="message" class="alert success">{{message}}</div>
    <div v-if="error" class="alert danger">{{error}}</div>
    <div v-if="activeView==='workspace'&&bootstrap&&!bootstrap.activeCashSession" class="cash-session-note">Vendor settlement transactions require an open POS Cash Session. <span class="bn-hint" style="display:inline">POS ক্যাশ সেশন চালু করুন।</span></div>

    <div class="vendor-tabs" role="tablist" aria-label="Vendor sections">
      <button class="vendor-tab" :class="{active:activeView==='vendors'}" @click="goView('vendors')">Vendors<span class="bn-hint">ভেন্ডর তালিকা</span></button>
      <button class="vendor-tab" :class="{active:activeView==='workspace'}" @click="goView('workspace')">Vendor Workspace<span class="bn-hint">ভেন্ডর অপারেশন</span></button>
      <button class="vendor-tab" :class="{active:activeView==='ledger'}" @click="goView('ledger')">Vendor Ledger<span class="bn-hint">শুধু হিসাব</span></button>
    </div>

    <template v-if="activeView==='vendors'">
      <div class="toolbar">
        <input v-model="query" class="search-input" placeholder="Search by name or phone..." />
        <div class="toolbar-spacer"></div>
        <button v-if="perm('add')" class="btn btn-primary" @click="openAdd">+ Add Vendor</button>
      </div>
      <div class="card" style="padding:0">
        <div class="table-scroll">
          <table class="vendor-list-table">
            <thead><tr><SortableHeader table-id="vendors" column="name">Vendor</SortableHeader><SortableHeader table-id="vendors" column="phone">Phone</SortableHeader><SortableHeader table-id="vendors" column="currentDue" type="number" class="num">Payable<br><span class="bn-hint" style="display:inline">আপনি দেবেন</span></SortableHeader><SortableHeader table-id="vendors" column="currentReceivable" type="number" class="num">Receivable<br><span class="bn-hint" style="display:inline">তারা দেবে</span></SortableHeader><SortableHeader table-id="vendors" column="status">Status</SortableHeader><th></th></tr></thead>
            <tbody><tr v-for="v in $sortRows('vendors', rows)" :key="v.id"><td data-label="Vendor"><button type="button" class="ledger-name-link" @click="openLedger(v)">{{v.name}}</button></td><td data-label="Phone">{{v.phone||'—'}}</td><td data-label="Payable" class="num mono">{{money(v.currentDue)}}</td><td data-label="Receivable" class="num mono">{{money(v.currentReceivable)}}</td><td data-label="Status"><span class="badge" :class="v.status==='Active'?'badge-success':'badge-danger'">{{v.status}}</span></td><td class="action-cell"><button class="btn btn-sm action-trigger vendor-action-trigger" @click="openActions($event,v)">Actions</button></td></tr></tbody>
          </table>
        </div>
        <div v-if="!loading&&rows.length===0" class="empty-state">No vendors yet.</div>
      </div>
    </template>

    <template v-else>
      <div class="vendor-select-bar card">
        <div class="vendor-select-main">
          <label>Select Vendor <span class="bn-hint">ভেন্ডর নির্বাচন করুন</span></label>
          <select :value="selectedVendorId" @change="onVendorSelectEvent">
            <option value="">Select vendor...</option>
            <option v-for="v in bootstrap?.vendors||[]" :key="v.id" :value="v.id">{{v.name}}{{v.phone?` · ${v.phone}`:''}}</option>
          </select>
        </div>
        <div v-if="selectedVendor" class="vendor-select-actions">
          <span class="badge" :class="selectedVendor.status==='Active'?'badge-success':'badge-danger'">{{selectedVendor.status}}</span>
          <button v-if="perm('edit')" class="btn btn-sm" @click="openEdit()">Edit Vendor</button>
          <button v-if="perm('edit')" class="btn btn-sm" @click="toggleStatus()">{{selectedVendor.status==='Active'?'Deactivate':'Activate'}}</button>
        </div>
      </div>

      <div v-if="!selectedVendorId" class="card vendor-empty-selection">
        <strong>Select a vendor first.</strong>
        <span class="bn-hint">তারপর এই ভেন্ডরের সব অপারেশন ও হিসাব এখানে দেখা যাবে।</span>
      </div>
      <div v-else-if="detailLoading&&!detail" class="card">Loading vendor...</div>

      <template v-else-if="detail">
        <div class="vendor-balance-grid">
          <div class="stat-card"><div class="stat-label">Payable — You Owe</div><div class="stat-value ledger-due-text">{{money(detail.vendor.currentDue)}}</div></div>
          <div class="stat-card"><div class="stat-label">Receivable — They Owe You</div><div class="stat-value ledger-advance-text">{{money(detail.vendor.currentReceivable)}}</div></div>
          <div class="stat-card"><div class="stat-label">Open Sourcing</div><div class="stat-value">{{whole(detail.openSourcing.length)}}</div></div>
          <div class="stat-card"><div class="stat-label">Open Product Issues</div><div class="stat-value">{{whole(detail.openIssues.length)}}</div></div>
        </div>

        <template v-if="activeView==='workspace'">
          <h3 class="section-kicker">Payable Operations — Products Taken From Vendor</h3>
          <div class="vendor-action-grid">
            <div class="card vendor-action-card">
              <h3>Pay Vendor <span class="bn-hint">— ভেন্ডরকে টাকা দিন</span></h3>
              <div class="compact-form-grid">
                <div><label>Amount</label><input v-model.number="payForm.amount" type="number" min="0" step="0.01" /></div>
                <div><label>Method</label><select v-model="payForm.method" @change="payForm.bankAccountId=''"><option>Cash</option><option>Bank</option><option>Mobile Banking</option></select></div>
                <div v-if="needsBank(payForm.method)"><label>Account</label><select v-model="payForm.bankAccountId"><option value="">Select account...</option><option v-for="b in payBanks" :key="b.id" :value="b.id">{{b.name}}</option></select></div>
                <div><label>Payment Date</label><input v-model="payForm.date" type="date" /></div>
                <div class="wide"><label>Note</label><input v-model.trim="payForm.notes" /></div>
                <div v-if="isBackdated(payForm.date)" class="wide"><label>Reason for Backdating *</label><input v-model.trim="payForm.backdatedReason" /></div>
              </div>
              <button v-if="perm('edit')" class="btn btn-primary" :disabled="saving" @click="doPay">Pay Vendor</button>
            </div>

            <div class="card vendor-action-card">
              <h3>Return Products to Vendor <span class="bn-hint">— কনসাইনমেন্ট মাল ফেরত</span></h3>
              <div class="compact-form-grid">
                <div class="wide"><label>Sourcing Transaction</label><select v-model="retForm.sourcingId" @change="selectSourcing"><option value="">Select sourcing...</option><option v-for="s in detail.openSourcing" :key="s.sourcingId" :value="s.sourcingId">{{s.date}} · {{s.productName}} · Remaining {{whole(s.remainingQty)}}</option></select></div>
                <div><label>Quantity</label><input v-model.number="retForm.quantity" type="number" min="1" step="1" /></div>
                <div><label>Unit Cost</label><input v-model.number="retForm.unitCost" type="number" min="0" step="0.01" /></div>
                <div><label>Date</label><input v-model="retForm.date" type="date" /></div>
                <div class="wide"><label>Note</label><input v-model.trim="retForm.notes" /></div>
                <div v-if="isBackdated(retForm.date)" class="wide"><label>Reason for Backdating *</label><input v-model.trim="retForm.backdatedReason" /></div>
              </div>
              <div v-if="detail.openSourcing.length===0" class="empty-inline">No open sourcing transactions to settle.</div>
              <button v-if="perm('edit')" class="btn btn-primary" :disabled="saving||detail.openSourcing.length===0" @click="doReturn">Return Products</button>
            </div>
          </div>

          <h3 class="section-kicker">Receivable Operations — Products Given To Vendor</h3>
          <div class="vendor-action-grid">
            <div class="card vendor-action-card">
              <h3>Give Products to Vendor <span class="bn-hint">— ভেন্ডরকে মাল দিন</span></h3>
              <div class="compact-form-grid">
                <div class="wide"><label>Product</label><ProductSearchSelect v-model="giveForm.productId" :items="productOptions" placeholder="Search product..." aria-label="Search product to give vendor" @select="selectProduct()" /></div>
                <div><label>Quantity</label><input v-model.number="giveForm.quantity" type="number" min="1" step="1" /></div>
                <div><label>Unit Value</label><input v-model.number="giveForm.unitValue" type="number" min="0" step="0.01" /></div>
                <div><label>Date</label><input v-model="giveForm.date" type="date" /></div>
                <div class="wide"><label>Note</label><input v-model.trim="giveForm.notes" /></div>
                <div v-if="isBackdated(giveForm.date)" class="wide"><label>Reason for Backdating *</label><input v-model.trim="giveForm.backdatedReason" /></div>
              </div>
              <button v-if="perm('edit')" class="btn btn-primary" :disabled="saving" @click="doGive">Give Products</button>
            </div>

            <div class="card vendor-action-card">
              <h3>Receive Payment from Vendor <span class="bn-hint">— ভেন্ডরের কাছ থেকে টাকা নিন</span></h3>
              <div class="compact-form-grid">
                <div><label>Amount</label><input v-model.number="recvForm.amount" type="number" min="0" step="0.01" /></div>
                <div><label>Method</label><select v-model="recvForm.method" @change="recvForm.bankAccountId=''"><option>Cash</option><option>Bank</option><option>Mobile Banking</option></select></div>
                <div v-if="needsBank(recvForm.method)"><label>Account</label><select v-model="recvForm.bankAccountId"><option value="">Select account...</option><option v-for="b in recvBanks" :key="b.id" :value="b.id">{{b.name}}</option></select></div>
                <div><label>Date</label><input v-model="recvForm.date" type="date" /></div>
                <div class="wide"><label>Note</label><input v-model.trim="recvForm.notes" /></div>
                <div v-if="isBackdated(recvForm.date)" class="wide"><label>Reason for Backdating *</label><input v-model.trim="recvForm.backdatedReason" /></div>
              </div>
              <button v-if="perm('edit')" class="btn btn-primary" :disabled="saving" @click="doReceive">Receive Payment</button>
            </div>

            <div class="card vendor-action-card">
              <h3>Receive Products Back <span class="bn-hint">— ভেন্ডরের কাছ থেকে মাল ফেরত নিন</span></h3>
              <div class="compact-form-grid">
                <div class="wide"><label>Issue Transaction</label><select v-model="recvProdForm.issueId" @change="selectIssue"><option value="">Select issue...</option><option v-for="s in detail.openIssues" :key="s.issueId" :value="s.issueId">{{s.date}} · {{s.productName}} · Remaining {{whole(s.remainingQty)}}</option></select></div>
                <div><label>Quantity</label><input v-model.number="recvProdForm.quantity" type="number" min="1" step="1" /></div>
                <div><label>Unit Value</label><input v-model.number="recvProdForm.unitValue" type="number" min="0" step="0.01" /></div>
                <div><label>Date</label><input v-model="recvProdForm.date" type="date" /></div>
                <div class="wide"><label>Note</label><input v-model.trim="recvProdForm.notes" /></div>
                <div v-if="isBackdated(recvProdForm.date)" class="wide"><label>Reason for Backdating *</label><input v-model.trim="recvProdForm.backdatedReason" /></div>
              </div>
              <div v-if="detail.openIssues.length===0" class="empty-inline">No open issue transactions to settle.</div>
              <button v-if="perm('edit')" class="btn btn-primary" :disabled="saving||detail.openIssues.length===0" @click="doReceiveProducts">Receive Products</button>
            </div>
          </div>

          <div v-if="formError" class="field-error vendor-form-error">{{formError}}</div>

          <div class="activity-header">
            <div><h3>Vendor Activity</h3><span class="bn-hint">কনসাইনমেন্ট, রিটার্ন ও সেটেলমেন্ট ইতিহাস</span></div>
            <div class="activity-tabs">
              <button class="btn btn-sm" :class="{'btn-primary':activityView==='sourcing'}" @click="activityView='sourcing'">Sourcing</button>
              <button class="btn btn-sm" :class="{'btn-primary':activityView==='returns'}" @click="activityView='returns'">Returns</button>
              <button class="btn btn-sm" :class="{'btn-primary':activityView==='issues'}" @click="activityView='issues'">Given to Vendor</button>
              <button class="btn btn-sm" :class="{'btn-primary':activityView==='received'}" @click="activityView='received'">Received Back</button>
            </div>
          </div>

          <div v-if="activityView==='sourcing'" class="card activity-card">
            <div class="table-scroll"><table class="vendor-history-table"><thead><tr><SortableHeader table-id="vendor-sourcing-history" column="date" type="date">Date</SortableHeader><SortableHeader table-id="vendor-sourcing-history" column="invoiceId">Invoice</SortableHeader><SortableHeader table-id="vendor-sourcing-history" column="productName">Product</SortableHeader><SortableHeader table-id="vendor-sourcing-history" column="quantity" type="number" class="num">Qty</SortableHeader><SortableHeader table-id="vendor-sourcing-history" column="unitCost" type="number" class="num">Unit Cost</SortableHeader><SortableHeader table-id="vendor-sourcing-history" column="totalCost" type="number" class="num">Value</SortableHeader><SortableHeader table-id="vendor-sourcing-history" column="remainingQty" type="number" class="num">Open Qty</SortableHeader><SortableHeader table-id="vendor-sourcing-history" column="status">Status</SortableHeader></tr></thead><tbody><tr v-for="r in $sortRows('vendor-sourcing-history',detail.sourcingHistory)" :key="r.sourcingId"><td>{{r.date}}</td><td class="mono">{{r.invoiceId||'—'}}</td><td>{{r.productName}}</td><td class="num">{{whole(r.quantity)}}</td><td class="num">{{money(r.unitCost)}}</td><td class="num">{{money(r.totalCost)}}</td><td class="num">{{whole(r.remainingQty)}}</td><td><span class="badge" :class="r.status==='Open'?'badge-warning':'badge-success'">{{r.status}}</span></td></tr></tbody></table></div>
            <div v-if="detail.sourcingHistory.length===0" class="empty-state">No vendor sourcing activity.</div>
          </div>

          <div v-else-if="activityView==='returns'" class="card activity-card">
            <div class="table-scroll"><table class="vendor-history-table"><thead><tr><SortableHeader table-id="vendor-return-history" column="date" type="date">Date</SortableHeader><SortableHeader table-id="vendor-return-history" column="sourcingId">Sourcing</SortableHeader><SortableHeader table-id="vendor-return-history" column="productName">Product</SortableHeader><SortableHeader table-id="vendor-return-history" column="quantity" type="number" class="num">Qty</SortableHeader><SortableHeader table-id="vendor-return-history" column="unitCost" type="number" class="num">Unit Cost</SortableHeader><SortableHeader table-id="vendor-return-history" column="totalValue" type="number" class="num">Value</SortableHeader><SortableHeader table-id="vendor-return-history" column="notes">Notes</SortableHeader></tr></thead><tbody><tr v-for="r in $sortRows('vendor-return-history',detail.returnHistory)" :key="r.returnId"><td>{{r.date}}</td><td class="mono">{{r.sourcingId}}</td><td>{{r.productName}}</td><td class="num">{{whole(r.quantity)}}</td><td class="num">{{money(r.unitCost)}}</td><td class="num">{{money(r.totalValue)}}</td><td>{{r.notes||'—'}}</td></tr></tbody></table></div>
            <div v-if="detail.returnHistory.length===0" class="empty-state">No products returned to this vendor.</div>
          </div>

          <div v-else-if="activityView==='issues'" class="card activity-card">
            <div class="table-scroll"><table class="vendor-history-table"><thead><tr><SortableHeader table-id="vendor-issue-history" column="date" type="date">Date</SortableHeader><SortableHeader table-id="vendor-issue-history" column="productName">Product</SortableHeader><SortableHeader table-id="vendor-issue-history" column="quantity" type="number" class="num">Qty</SortableHeader><SortableHeader table-id="vendor-issue-history" column="unitValue" type="number" class="num">Unit Value</SortableHeader><SortableHeader table-id="vendor-issue-history" column="totalValue" type="number" class="num">Value</SortableHeader><SortableHeader table-id="vendor-issue-history" column="remainingQty" type="number" class="num">Open Qty</SortableHeader><SortableHeader table-id="vendor-issue-history" column="status">Status</SortableHeader></tr></thead><tbody><tr v-for="r in $sortRows('vendor-issue-history',detail.issueHistory)" :key="r.issueId"><td>{{r.date}}</td><td>{{r.productName}}</td><td class="num">{{whole(r.quantity)}}</td><td class="num">{{money(r.unitValue)}}</td><td class="num">{{money(r.totalValue)}}</td><td class="num">{{whole(r.remainingQty)}}</td><td><span class="badge" :class="r.status==='Open'?'badge-warning':'badge-success'">{{r.status}}</span></td></tr></tbody></table></div>
            <div v-if="detail.issueHistory.length===0" class="empty-state">No products have been given to this vendor.</div>
          </div>

          <div v-else class="card activity-card">
            <div class="table-scroll"><table class="vendor-history-table"><thead><tr><SortableHeader table-id="vendor-received-history" column="date" type="date">Date</SortableHeader><SortableHeader table-id="vendor-received-history" column="issueId">Issue</SortableHeader><SortableHeader table-id="vendor-received-history" column="productName">Product</SortableHeader><SortableHeader table-id="vendor-received-history" column="quantity" type="number" class="num">Qty</SortableHeader><SortableHeader table-id="vendor-received-history" column="unitValue" type="number" class="num">Unit Value</SortableHeader><SortableHeader table-id="vendor-received-history" column="totalValue" type="number" class="num">Value</SortableHeader><SortableHeader table-id="vendor-received-history" column="notes">Notes</SortableHeader></tr></thead><tbody><tr v-for="r in $sortRows('vendor-received-history',detail.receivedHistory)" :key="r.returnId"><td>{{r.date}}</td><td class="mono">{{r.issueId}}</td><td>{{r.productName}}</td><td class="num">{{whole(r.quantity)}}</td><td class="num">{{money(r.unitValue)}}</td><td class="num">{{money(r.totalValue)}}</td><td>{{r.notes||'—'}}</td></tr></tbody></table></div>
            <div v-if="detail.receivedHistory.length===0" class="empty-state">No products have been received back from this vendor.</div>
          </div>
        </template>

        <template v-else-if="activeView==='ledger'">
          <div class="ledger-toolbar">
            <div><h3>{{detail.vendor.name}} — Vendor Ledger</h3><span class="bn-hint">লেনদেন ও ব্যালেন্স মাত্র</span></div>
            <div class="toolbar-spacer"></div>
            <button class="btn" @click="exportVendorLedger">Export CSV</button><button class="btn" @click="printVendorLedger">Print</button>
          </div>
          <LedgerHistoryControls v-model:from="ledgerFilters.from" v-model:to="ledgerFilters.to" v-model:limit="ledgerFilters.limit" :matching-count="detail.history.matchingCount" :returned-count="detail.history.returnedCount" :has-more="detail.history.hasMore" :loading="detailLoading" @refresh="refreshDetail" />
          <div class="ledger-history-summary"><span>Payable: <strong>{{money(detail.payableSummary.displayedOpeningBalance)}} → {{money(detail.payableSummary.displayedClosingBalance)}}</strong></span><span>Receivable: <strong>{{money(detail.receivableSummary.displayedOpeningBalance)}} → {{money(detail.receivableSummary.displayedClosingBalance)}}</strong></span></div>
          <div class="card" style="padding:0">
            <div class="table-scroll">
              <table class="vendor-ledger-table">
                <thead><tr><SortableHeader table-id="vendor-ledger" column="date" type="date">Date</SortableHeader><SortableHeader table-id="vendor-ledger" column="type">Type</SortableHeader><SortableHeader table-id="vendor-ledger" column="balanceType">Balance Type</SortableHeader><SortableHeader table-id="vendor-ledger" column="reference">Reference</SortableHeader><SortableHeader table-id="vendor-ledger" column="debit" type="number" class="num"><span class="ledger-head">Debit<small>খরচ</small></span></SortableHeader><SortableHeader table-id="vendor-ledger" column="credit" type="number" class="num"><span class="ledger-head">Credit<small>জমা</small></span></SortableHeader><SortableHeader table-id="vendor-ledger" column="balance" type="number" class="num">Balance</SortableHeader><SortableHeader table-id="vendor-ledger" column="notes">Notes</SortableHeader></tr></thead>
                <tbody><tr v-for="l in $sortRows('vendor-ledger', detail.ledger)" :key="l.ledgerId"><td>{{l.date}} <span v-if="l.isBackdated" class="badge badge-warning" :title="l.backdatedReason">⚠</span></td><td>{{l.type}}</td><td><span class="badge" :class="l.balanceType==='Payable'?'badge-warning':'badge-info'">{{l.balanceType}}</span></td><td class="mono">{{l.reference||'—'}}</td><td class="num mono">{{l.debit?money(l.debit):''}}</td><td class="num mono">{{l.credit?money(l.credit):''}}</td><td class="num mono">{{money(l.balance)}}</td><td>{{l.notes||'—'}}</td></tr></tbody>
              </table>
            </div>
            <div v-if="detail.ledger.length===0" class="empty-state">No ledger transactions yet.</div>
          </div>
        </template>
      </template>
    </template>

    <Teleport to="body"><div v-if="actionMenu" class="action-dropdown vendor-action-menu" :style="{position:'fixed',top:actionMenu.top+'px',left:actionMenu.left+'px',width:actionMenu.width+'px',zIndex:'10030'}" @pointerdown.stop>
      <button @click="openWorkspace(actionMenu.row)">Open Workspace</button>
      <button @click="openLedger(actionMenu.row)">Open Ledger</button>
      <button v-if="perm('edit')" @click="openEdit(actionMenu.row)">Edit Vendor</button>
      <button v-if="perm('edit')" @click="toggleStatus(actionMenu.row)">{{actionMenu.row.status==='Active'?'Deactivate':'Activate'}}</button>
    </div></Teleport>

    <Teleport to="body">
      <div v-if="addOpen" class="modal-overlay" @click.self="addOpen=false"><div class="modal">
        <div class="modal-header"><div><h3>Add Vendor</h3><span class="bn-hint">ভেন্ডরের তথ্য</span></div><button class="modal-close" @click="addOpen=false">×</button></div>
        <div class="modal-body"><div class="form-grid"><div class="full"><label>Vendor Name *</label><input v-model.trim="addForm.name" /></div><div><label>Phone</label><input v-model.trim="addForm.phone" /></div></div><div v-if="addError" class="field-error">{{addError}}</div></div>
        <div class="modal-footer"><button class="btn" @click="addOpen=false">Cancel</button><button class="btn btn-primary" :disabled="saving" @click="saveVendor">Save Vendor</button></div>
      </div></div>
    </Teleport>

    <Teleport to="body">
      <div v-if="editOpen" class="modal-overlay" @click.self="editOpen=false"><div class="modal">
        <div class="modal-header"><div><h3>Edit Vendor</h3><span class="bn-hint">ভেন্ডরের তথ্য পরিবর্তন</span></div><button class="modal-close" @click="editOpen=false">×</button></div>
        <div class="modal-body"><div class="form-grid"><div class="full"><label>Vendor Name *</label><input v-model.trim="editForm.name" /></div><div><label>Phone</label><input v-model.trim="editForm.phone" /></div></div><div v-if="editError" class="field-error">{{editError}}</div></div>
        <div class="modal-footer"><button class="btn" @click="editOpen=false">Cancel</button><button class="btn btn-primary" :disabled="saving" @click="saveVendorEdit">Update Vendor</button></div>
      </div></div>
    </Teleport>
  </section>
</template>

<style scoped>
.vendor-page{--vendor-green:#0f8f55;--vendor-green-dark:#087444;--vendor-green-soft:#eefaf4;--vendor-border:#dfe7e3;--vendor-muted:#64748b;display:flex;flex-direction:column;gap:14px;min-width:0}.vendor-page :deep(.btn-primary){background:var(--vendor-green);border-color:var(--vendor-green);color:#fff}.vendor-page :deep(.btn-primary:hover){background:var(--vendor-green-dark);border-color:var(--vendor-green-dark)}
.vendor-tabs{display:flex;gap:28px;overflow-x:auto;margin:0;padding:0 14px;background:transparent;border:0;border-bottom:1px solid #dbe3ee;scrollbar-width:none}.vendor-tabs::-webkit-scrollbar{display:none}.vendor-tab{position:relative;border:0;background:transparent;border-radius:0;padding:10px 0 12px;min-width:max-content;cursor:pointer;font:inherit;font-weight:800;font-size:16px;color:#0f172a;transition:color .15s ease}.vendor-tab:hover{color:#2563eb}.vendor-tab .bn-hint{display:block;font-weight:500;font-size:13px;line-height:1.1;margin-top:1px;color:#64748b}.vendor-tab::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;background:transparent}.vendor-tab.active{color:#2563eb}.vendor-tab.active .bn-hint{color:#64748b}.vendor-tab.active::after{background:#2563eb}
.vendor-list-table{min-width:820px}.vendor-list-table tbody tr{transition:background .15s ease}.vendor-list-table tbody tr:hover{background:#f7fbf9}.vendor-list-table strong{color:#172b21}.vendor-list-table .action-trigger{border-color:#cfe2d7;background:#fff;color:#116a42}.vendor-list-table .action-trigger:hover{background:var(--vendor-green-soft)}
.vendor-select-bar{display:flex;align-items:center;gap:14px;margin:0;padding:15px 16px;border:1px solid #d8e8df;border-radius:14px;background:linear-gradient(135deg,#fff 0%,#f6fcf9 100%);box-shadow:0 2px 8px rgba(15,23,42,.04)}.vendor-select-main{flex:1;min-width:0;max-width:680px}.vendor-select-main label{display:block;font-weight:750;margin-bottom:6px;color:#334155}.vendor-select-main .bn-hint{display:inline;margin-left:5px}.vendor-select-main select{width:100%;min-height:44px;border-color:#cfe2d7;background:#fff}.vendor-select-actions{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.vendor-select-actions .badge{padding:6px 10px;border-radius:999px}.vendor-select-actions .btn{min-height:36px;background:#fff}.vendor-empty-selection{display:flex;flex-direction:column;gap:4px;align-items:flex-start;margin:0;border:1px dashed #c8d9cf;background:#f8fcfa}
.vendor-balance-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0}.vendor-balance-grid :deep(.stat-card){position:relative;overflow:hidden;min-height:92px;padding:14px 15px;border:1px solid var(--vendor-border);border-radius:14px;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.05)}.vendor-balance-grid :deep(.stat-card)::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:#16a34a}.vendor-balance-grid :deep(.stat-card:nth-child(2))::before{background:#0ea5e9}.vendor-balance-grid :deep(.stat-card:nth-child(3))::before{background:#f59e0b}.vendor-balance-grid :deep(.stat-card:nth-child(4))::before{background:#8b5cf6}.vendor-balance-grid :deep(.stat-label){font-size:12px;font-weight:700;color:#64748b;line-height:1.35}.vendor-balance-grid :deep(.stat-value){margin-top:7px;font-size:22px;font-weight:800;color:#172b21;letter-spacing:-.02em}
.section-kicker{display:flex;align-items:center;gap:8px;font-size:12px;margin:4px 0 -4px;color:#496457;text-transform:uppercase;letter-spacing:.04em;font-weight:800}.section-kicker::before{content:"";width:5px;height:18px;border-radius:999px;background:var(--vendor-green)}
.vendor-action-grid{display:grid;grid-template-columns:1fr;gap:14px}.vendor-action-card{position:relative;margin:0;padding:20px 24px;border:1px solid #dfe4ec;border-radius:12px;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.06)}.vendor-action-card::before{display:none}.vendor-action-card h3{font-size:16px;margin:0 0 14px;color:#0f172a}.vendor-action-card h3 .bn-hint{display:inline;margin-left:4px;font-size:13px;font-weight:500;color:#64748b}.vendor-action-card label{font-size:13px;font-weight:700;color:#64748b}.vendor-action-card input,.vendor-action-card select{min-height:46px;background:#fff;border-color:#d9e1ec}.vendor-action-card .btn-primary{min-height:46px;padding-inline:18px}.compact-form-grid{display:grid;grid-template-columns:repeat(6,minmax(110px,1fr));gap:10px;margin-bottom:10px;align-items:end}.compact-form-grid .wide{grid-column:span 2}.empty-inline{font-size:13px;color:#64748b;margin:4px 0 10px;padding:8px 10px;border-radius:8px;background:#f8fafc}.vendor-form-error{margin:0}
.activity-header,.ledger-toolbar{display:flex;align-items:center;gap:12px;margin:2px 0 0;padding:12px 14px;border:1px solid var(--vendor-border);border-radius:12px;background:#fff}.activity-header h3,.ledger-toolbar h3{margin:0;font-size:15px;color:#172b21}.activity-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}.activity-tabs .btn{border-radius:999px}.activity-card{padding:0;margin:0;overflow:hidden}.vendor-history-table{min-width:920px}.vendor-ledger-table{min-width:960px}.ledger-toolbar .btn{background:#fff}.ledger-toolbar .btn:hover{background:var(--vendor-green-soft);color:var(--vendor-green-dark);border-color:#b8d9c7}.vendor-page :deep(.ledger-history-controls){margin:0;background:#fff;border-color:var(--vendor-border)}.vendor-page :deep(.ledger-history-summary){margin:0;padding:0 2px}.vendor-page :deep(.ledger-history-summary strong){color:#173d2b}
@media(max-width:1000px){.vendor-balance-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.compact-form-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.compact-form-grid .wide{grid-column:1/-1}.vendor-select-bar{align-items:stretch;flex-direction:column}.vendor-select-main{max-width:none}.vendor-select-actions{margin-left:0}.activity-header,.ledger-toolbar{align-items:flex-start;flex-wrap:wrap}.activity-tabs{margin-left:0;width:100%;overflow-x:auto;flex-wrap:nowrap;padding-bottom:2px}}
@media(max-width:680px){.vendor-page{gap:10px}.vendor-tabs{gap:22px;padding:0 4px}.vendor-tab{padding:9px 0 11px;font-size:15px}.vendor-tab .bn-hint{font-size:12px}.vendor-select-bar{padding:12px}.vendor-select-actions{width:100%}.vendor-select-actions .btn{flex:1}.vendor-balance-grid{grid-template-columns:1fr 1fr;gap:8px}.vendor-balance-grid :deep(.stat-card){min-height:82px;padding:12px}.vendor-balance-grid :deep(.stat-value){font-size:18px}.compact-form-grid{grid-template-columns:1fr}.compact-form-grid .wide{grid-column:auto}.vendor-action-card{padding:14px}.activity-tabs .btn{min-width:max-content}.ledger-toolbar .toolbar-spacer{display:none}.ledger-toolbar .btn{flex:1}.vendor-list-table{min-width:0;width:100%}.vendor-list-table thead{display:none}.vendor-list-table,.vendor-list-table tbody,.vendor-list-table tr,.vendor-list-table td{display:block;width:100%}.vendor-list-table tbody{padding:8px}.vendor-list-table tbody tr{display:grid;grid-template-columns:1fr 1fr;gap:7px 12px;margin:0 0 8px;padding:12px;border:1px solid var(--vendor-border);border-radius:12px;background:#fff}.vendor-list-table tbody tr:last-child{margin-bottom:0}.vendor-list-table td{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:0!important;border:0!important;text-align:right!important}.vendor-list-table td::before{content:attr(data-label);font-size:11px;font-weight:700;color:#64748b;text-align:left}.vendor-list-table td:first-child{grid-column:1/-1;font-size:15px;text-align:left!important}.vendor-list-table td:first-child::before{display:none}.vendor-list-table .action-cell{grid-column:1/-1}.vendor-list-table .action-cell::before{display:none}.vendor-list-table .action-trigger{width:100%;min-height:38px}.vendor-list-table td:nth-child(2){grid-column:1/-1}}
@media(max-width:430px){.vendor-balance-grid{grid-template-columns:1fr}.vendor-select-actions .badge{width:100%;text-align:center}.vendor-list-table tbody tr{grid-template-columns:1fr}.vendor-list-table td,.vendor-list-table td:nth-child(2),.vendor-list-table td:first-child,.vendor-list-table .action-cell{grid-column:1}.vendor-action-card .btn-primary{width:100%}}
</style>
