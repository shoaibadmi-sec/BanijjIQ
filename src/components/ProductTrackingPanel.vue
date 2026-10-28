<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  completeProductWarrantyClaim,
  correctProductExpiryBatch,
  correctProductSerial,
  createProductWarrantyClaim,
  replaceProductWarrantyClaim,
  createSupplierWarrantyRma,
  getSupplierWarrantyOverview,
  resolveSupplierWarrantyRma,
  getPendingLotTracking,
  getProductTrackingOverview,
  savePendingLotTracking,
  updateProductWarranty
} from '../api';
import type {
  LotTrackingInput,
  ProductTrackingExpiry,
  ProductTrackingOverview,
  ProductTrackingPendingLot,
  ProductTrackingSerial,
  ProductTrackingWarranty,
  ProductTrackingWarrantyClaim,
  SupplierWarrantyOverview,
  SupplierWarrantyRma,
  SupplierWarrantyResolveInput,
  Product
} from '../types';
import ProductTrackingEntry from './ui/ProductTrackingEntry.vue';
import AppDatePicker from './ui/AppDatePicker.vue';
import ExpiryPicker from './ui/ExpiryPicker.vue';
import AppSelect from './ui/AppSelect.vue';
import ProductSearchSelect from './ui/ProductSearchSelect.vue';
import { notifyError, notifySuccess } from '../utils/notify';

const showError = notifyError;
const showSuccess = notifySuccess;
const props = withDefaults(defineProps<{ canEdit?: boolean; canAdd?: boolean }>(), { canEdit: true, canAdd: true });
type Tab = 'pending' | 'serials' | 'expiry' | 'warranty' | 'claims' | 'supplier-rma' | 'replacements';
type ModalKind = '' | 'serial' | 'expiry' | 'warranty' | 'claim-create' | 'claim-complete' | 'claim-replace' | 'rma-send' | 'rma-resolve';

const tab = ref<Tab>('pending');
const loading = ref(false);
const search = ref('');
const serialStatus = ref('All');
const expiryWindow = ref('All');
const warrantyStatus = ref('All');
const claimStatus = ref('All');
const rmaStatus = ref('All');
const data = reactive<ProductTrackingOverview>({ products: [], pending: [], serials: [], expiry: [], warranties: [], claims: [], replacements: [] });
const supplierWarranty = reactive<SupplierWarrantyOverview>({ rmas: [], suppliers: [], bankAccounts: [], products: [] });
const editLot = ref<ProductTrackingPendingLot | null>(null);
const editTracking = ref<LotTrackingInput>({});
const saving = ref(false);
const modalKind = ref<ModalKind>('');
const selectedSerial = ref<ProductTrackingSerial | null>(null);
const selectedExpiry = ref<ProductTrackingExpiry | null>(null);
const selectedWarranty = ref<ProductTrackingWarranty | null>(null);
const selectedClaim = ref<ProductTrackingWarrantyClaim | null>(null);
const selectedRma = ref<SupplierWarrantyRma | null>(null);
const serialForm = reactive({ serialNumber: '', reason: '' });
const expiryForm = reactive({ expiryDate: '', batchNo: '', reason: '' });
const warrantyForm = reactive({ warrantyEndDate: '', status: 'Active' as 'Active' | 'Voided', reason: '' });
const claimCreateForm = reactive({ claimDate: new Date().toISOString().slice(0, 10), issue: '' });
const claimCompleteForm = reactive({ status: 'Resolved' as 'Resolved' | 'Rejected' | 'Cancelled', resolution: '' });
const replacementForm = reactive({ replacementDate: new Date().toISOString().slice(0, 10), replacementSerialId: '', note: '' });
const rmaSendForm = reactive({ supplierId: '', sentDate: new Date().toISOString().slice(0, 10), supplierReference: '', customerHandling: 'Waiting for Supplier', notes: '' });
type RmaReceivedForm = { key:string; productId:string; quantity:number; unitValue:number; tracking:LotTrackingInput };
const rmaReceivedItems = ref<RmaReceivedForm[]>([]);
const rmaResolveForm = reactive<SupplierWarrantyResolveInput>({ resolvedDate:new Date().toISOString().slice(0,10), resolutionType:'Same Item Returned', directToCustomer:false, receivedItems:[], supplierCreditAmount:0, additionalPayableAmount:0, cashRefundAmount:0, refundMethod:'Cash', bankAccountId:'', resolutionNote:'' });

async function refresh() {
  loading.value = true;
  try {
    const [r, sw] = await Promise.all([getProductTrackingOverview(), getSupplierWarrantyOverview()]);
    data.products = r.products;
    data.pending = r.pending;
    data.serials = r.serials;
    data.expiry = r.expiry;
    data.warranties = r.warranties;
    data.claims = r.claims || [];
    data.replacements = r.replacements || [];
    supplierWarranty.rmas = sw.rmas || [];
    supplierWarranty.suppliers = sw.suppliers || [];
    supplierWarranty.bankAccounts = sw.bankAccounts || [];
    supplierWarranty.products = sw.products || [];
  } catch (e) {
    showError(e instanceof Error ? e.message : 'Could not load Product Tracking');
  } finally {
    loading.value = false;
  }
}

function text(...v: unknown[]) { return v.map(x => String(x ?? '')).join(' ').toLocaleLowerCase(); }
const q = computed(() => search.value.trim().toLocaleLowerCase());
function productLabel(row: { productName: string; brand?: string }) { return row.brand ? `${row.brand} ${row.productName}` : row.productName; }
function todayIso() { return new Date().toISOString().slice(0, 10); }
function daysUntil(date: string) {
  if (!date) return Number.POSITIVE_INFINITY;
  return Math.ceil((new Date(`${date}T00:00:00Z`).getTime() - new Date(`${todayIso()}T00:00:00Z`).getTime()) / 86400000);
}
function dateState(date: string) {
  const days = daysUntil(date);
  if (days < 0) return 'Expired';
  if (days === 0) return 'Expires today';
  if (days <= 30) return `${days}d left`;
  if (days <= 60) return `${days}d left`;
  if (days <= 90) return `${days}d left`;
  return 'Valid';
}
function warrantyState(row: ProductTrackingWarranty) {
  if (row.status === 'Voided') return 'Voided';
  if (Number(row.openClaimCount || 0) > 0 || row.status === 'Claimed') return 'Claimed';
  if (row.warrantyEndDate < todayIso() || row.status === 'Expired') return 'Expired';
  return 'Active';
}
function expiryMatchesWindow(row: ProductTrackingExpiry) {
  const days = daysUntil(row.expiryDate);
  if (expiryWindow.value === 'Expired') return days < 0;
  if (expiryWindow.value === '30') return days >= 0 && days <= 30;
  if (expiryWindow.value === '60') return days > 30 && days <= 60;
  if (expiryWindow.value === '90') return days > 60 && days <= 90;
  if (expiryWindow.value === 'Safe') return days > 90;
  return true;
}
const pendingRows = computed(() => data.pending.filter(x => !q.value || text(x.productName, x.brand, x.sourceType, x.sourceRef, x.lotId).includes(q.value)));
const serialRows = computed(() => data.serials.filter(x => (serialStatus.value === 'All' || x.status === serialStatus.value) && (!q.value || text(x.serialNumber, x.productName, x.brand, x.invoiceId, x.status).includes(q.value))));
const expiryRows = computed(() => data.expiry.filter(x => expiryMatchesWindow(x) && (!q.value || text(x.productName, x.brand, x.batchNo, x.expiryDate, x.lotId).includes(q.value))));
const warrantyRows = computed(() => data.warranties.filter(x => (warrantyStatus.value === 'All' || warrantyState(x) === warrantyStatus.value) && (!q.value || text(x.productName, x.customerName, x.customerPhone, x.serialNumber, x.invoiceId, warrantyState(x)).includes(q.value))));
const claimRows = computed(() => data.claims.filter(x => (claimStatus.value === 'All' || x.status === claimStatus.value) && (!q.value || text(x.productName, x.customerName, x.customerPhone, x.serialNumber, x.invoiceId, x.issue, x.resolution, x.status).includes(q.value))));
const replacementRows = computed(() => data.replacements.filter(x => !q.value || text(x.productName, x.customerName, x.customerPhone, x.invoiceId, x.originalSerialNumber, x.replacementSerialNumber, x.note, x.createdBy).includes(q.value)));
const supplierRmaRows = computed(() => supplierWarranty.rmas.filter(x => (rmaStatus.value === 'All' || x.status === rmaStatus.value) && (!q.value || text(x.rmaNo,x.supplierName,x.productName,x.serialNumber,x.customerName,x.customerPhone,x.invoiceId,x.supplierReference,x.status,x.resolutionType,x.resolutionNote).includes(q.value))));
const supplierRmaAtSupplier = computed(() => supplierWarranty.rmas.filter(x => x.status === 'At Supplier').length);
const supplierOptions = computed(() => supplierWarranty.suppliers.map(x => ({ label:`${x.name}${Number(x.currentDue||0) ? ` · Due ${Number(x.currentDue||0).toLocaleString()}` : ''}`, value:x.id })));
const bankOptions = computed(() => supplierWarranty.bankAccounts.map(x => ({ label:x.name, value:x.id })));
function claimHasOpenRma(claimId:string) { return supplierWarranty.rmas.some(x => x.claimId === claimId && x.status === 'At Supplier'); }
function claimHasOwnReplacement(claimId:string) { return data.replacements.some(x => x.claimId === claimId); }
function rmaProduct(productId:string): Product | undefined { return supplierWarranty.products.find(x => x.productId === productId); }
function receivedProductLabel(item:RmaReceivedForm) { const p=rmaProduct(item.productId); return p ? (p.brand ? `${p.brand} ${p.productName}` : p.productName) : 'Select product'; }
function onReceivedProductSelect(item:RmaReceivedForm, product:any) { item.productId = product?.productId || ''; item.unitValue = Number(product?.purchasePrice || 0); item.tracking = {}; }
function resetReceivedItems(productId='') {
  const product = supplierWarranty.products.find((row:any) => row.productId === productId);
  rmaReceivedItems.value = productId ? [{ key:crypto.randomUUID(), productId, quantity:1, unitValue:Number(product?.purchasePrice||0), tracking:{} }] : [];
}
function addReceivedItem() { rmaReceivedItems.value.push({ key:crypto.randomUUID(), productId:'', quantity:1, unitValue:0, tracking:{} }); }
function removeReceivedItem(key:string) { rmaReceivedItems.value = rmaReceivedItems.value.filter(x => x.key !== key); }
const replacementSerialOptions = computed(() => {
  if (!selectedClaim.value) return [];
  const date = replacementForm.replacementDate || todayIso();
  return data.serials
    .filter(x => x.productId === selectedClaim.value!.productId && x.status === 'In Stock' && (!x.expiryDate || x.expiryDate >= date))
    .map(x => ({ label: `${x.serialNumber}${x.expiryDate ? ` · exp ${x.expiryDate}` : ''}`, value: x.serialId }));
});
const pendingQty = computed(() => data.pending.reduce((n, x) => n + Number(x.remainingQuantity || 0), 0));
const serialInStock = computed(() => data.serials.filter(x => x.status === 'In Stock').length);
const expiry30Qty = computed(() => data.expiry.filter(x => Number(x.remainingQuantity || 0) > 0 && daysUntil(x.expiryDate) >= 0 && daysUntil(x.expiryDate) <= 30).reduce((n, x) => n + Number(x.remainingQuantity || 0), 0));
const openClaims = computed(() => data.claims.filter(x => x.status === 'Open').length);
const expiredQty = computed(() => data.expiry.filter(x => daysUntil(x.expiryDate) < 0).reduce((n, x) => n + Number(x.remainingQuantity || 0), 0));

async function openPending(row: ProductTrackingPendingLot) {
  try {
    const r = await getPendingLotTracking(row.lotId);
    editLot.value = row;
    editTracking.value = r.tracking || {};
  } catch (e) { showError(e instanceof Error ? e.message : 'Could not load tracking entry'); }
}
function closePending() { editLot.value = null; editTracking.value = {}; }
async function savePending() {
  if (!editLot.value) return;
  saving.value = true;
  try {
    const r = await savePendingLotTracking(editLot.value.lotId, editTracking.value);
    showSuccess(r.status === 'Ready' ? 'Tracking complete. Stock is now ready to sell.' : 'Tracking saved. Remaining quantity is still pending.');
    closePending();
    await refresh();
  } catch (e) { showError(e instanceof Error ? e.message : 'Could not save tracking'); }
  finally { saving.value = false; }
}

function closeActionModal() {
  modalKind.value = '';
  selectedSerial.value = null;
  selectedExpiry.value = null;
  selectedWarranty.value = null;
  selectedClaim.value = null;
  selectedRma.value = null;
  rmaReceivedItems.value = [];
}
function openSerialCorrection(row: ProductTrackingSerial) {
  selectedSerial.value = row;
  serialForm.serialNumber = row.serialNumber;
  serialForm.reason = '';
  modalKind.value = 'serial';
}
function openExpiryCorrection(row: ProductTrackingExpiry) {
  selectedExpiry.value = row;
  expiryForm.expiryDate = row.expiryDate;
  expiryForm.batchNo = row.batchNo || '';
  expiryForm.reason = '';
  modalKind.value = 'expiry';
}
function openWarrantyManage(row: ProductTrackingWarranty) {
  selectedWarranty.value = row;
  warrantyForm.warrantyEndDate = row.warrantyEndDate;
  warrantyForm.status = row.status === 'Voided' ? 'Voided' : 'Active';
  warrantyForm.reason = '';
  modalKind.value = 'warranty';
}
function openClaimCreate(row: ProductTrackingWarranty) {
  selectedWarranty.value = row;
  claimCreateForm.claimDate = todayIso();
  claimCreateForm.issue = '';
  modalKind.value = 'claim-create';
}
function openClaimComplete(row: ProductTrackingWarrantyClaim) {
  selectedClaim.value = row;
  claimCompleteForm.status = 'Resolved';
  claimCompleteForm.resolution = '';
  modalKind.value = 'claim-complete';
}
function openClaimReplacement(row: ProductTrackingWarrantyClaim) {
  selectedClaim.value = row;
  replacementForm.replacementDate = todayIso();
  replacementForm.replacementSerialId = '';
  replacementForm.note = '';
  modalKind.value = 'claim-replace';
}
function openSupplierRma(row: ProductTrackingWarrantyClaim) {
  selectedClaim.value = row;
  const replaced = claimHasOwnReplacement(row.claimId);
  rmaSendForm.supplierId = rmaProduct(row.productId)?.preferredSupplierId || '';
  rmaSendForm.sentDate = todayIso();
  rmaSendForm.supplierReference = '';
  rmaSendForm.customerHandling = replaced ? 'Already Replaced from Our Stock' : 'Waiting for Supplier';
  rmaSendForm.notes = row.issue || '';
  modalKind.value = 'rma-send';
}
function openRmaResolve(row: SupplierWarrantyRma) {
  selectedRma.value = row;
  rmaResolveForm.resolvedDate = todayIso();
  rmaResolveForm.resolutionType = 'Same Item Returned';
  rmaResolveForm.directToCustomer = false;
  rmaResolveForm.supplierCreditAmount = 0;
  rmaResolveForm.additionalPayableAmount = 0;
  rmaResolveForm.cashRefundAmount = 0;
  rmaResolveForm.refundMethod = 'Cash';
  rmaResolveForm.bankAccountId = '';
  rmaResolveForm.resolutionNote = '';
  rmaReceivedItems.value = [];
  modalKind.value = 'rma-resolve';
}
function onRmaResolutionTypeChange() {
  if (!selectedRma.value) return;
  rmaResolveForm.directToCustomer = false;
  if (rmaResolveForm.resolutionType === 'Replacement Same Product') resetReceivedItems(selectedRma.value.productId);
  else if (rmaResolveForm.resolutionType === 'Settlement') resetReceivedItems('');
  else rmaReceivedItems.value = [];
}
async function saveSupplierRmaSend() {
  if (!selectedClaim.value) return;
  if (!rmaSendForm.supplierId) { showError('Choose the supplier receiving this warranty item.'); return; }
  await createSupplierWarrantyRma({ claimId:selectedClaim.value.claimId, ...rmaSendForm });
  showSuccess('Warranty item sent to supplier.');
  tab.value = 'supplier-rma';
}
async function saveSupplierRmaResolve() {
  if (!selectedRma.value) return;
  const receivedItems = rmaReceivedItems.value.map(x => ({ productId:x.productId, quantity:Number(x.quantity||0), unitValue:Number(x.unitValue||0), tracking:x.tracking }));
  if (rmaResolveForm.resolutionType === 'Replacement Same Product' && (!receivedItems.length || !receivedItems[0].productId)) {
    showError('Enter the replacement product received from supplier.'); return;
  }
  if (selectedRma.value.customerHandling === 'Waiting for Supplier' && rmaResolveForm.resolutionType === 'Replacement Same Product' && !rmaResolveForm.directToCustomer) {
    showError('Customer is still waiting. Send this replacement directly to the customer, or replace the customer from your own stock first.'); return;
  }
  if (selectedRma.value.customerHandling === 'Waiting for Supplier' && rmaResolveForm.resolutionType === 'Settlement') {
    showError('Customer is still waiting. First replace the customer from your own stock from the Warranty Claims tab, then resolve this supplier settlement.'); return;
  }
  await resolveSupplierWarrantyRma(selectedRma.value.rmaId, { ...rmaResolveForm, receivedItems });
  showSuccess('Supplier warranty RMA resolved.');
  tab.value = 'supplier-rma';
}
async function saveAction() {
  saving.value = true;
  try {
    if (modalKind.value === 'serial' && selectedSerial.value) {
      await correctProductSerial(selectedSerial.value.serialId, serialForm.serialNumber, serialForm.reason);
      showSuccess('Serial / IMEI corrected.');
    } else if (modalKind.value === 'expiry' && selectedExpiry.value) {
      await correctProductExpiryBatch(selectedExpiry.value.expiryBatchId, expiryForm.expiryDate, expiryForm.batchNo, expiryForm.reason);
      showSuccess('Expiry batch corrected.');
    } else if (modalKind.value === 'warranty' && selectedWarranty.value) {
      await updateProductWarranty(selectedWarranty.value.warrantyId, { ...warrantyForm });
      showSuccess('Warranty updated.');
    } else if (modalKind.value === 'claim-create' && selectedWarranty.value) {
      await createProductWarrantyClaim(selectedWarranty.value.warrantyId, { ...claimCreateForm });
      showSuccess('Warranty claim opened.');
      tab.value = 'claims';
    } else if (modalKind.value === 'claim-complete' && selectedClaim.value) {
      await completeProductWarrantyClaim(selectedClaim.value.claimId, { ...claimCompleteForm });
      showSuccess('Warranty claim updated.');
    } else if (modalKind.value === 'claim-replace' && selectedClaim.value) {
      await replaceProductWarrantyClaim(selectedClaim.value.claimId, { ...replacementForm });
      showSuccess('Warranty replacement completed. Defective serial moved to Warranty Hold.');
      tab.value = 'replacements';
    }
    else if (modalKind.value === 'rma-send' && selectedClaim.value) {
      await saveSupplierRmaSend();
    } else if (modalKind.value === 'rma-resolve' && selectedRma.value) {
      await saveSupplierRmaResolve();
    }
    closeActionModal();
    await refresh();
  } catch (e) { showError(e instanceof Error ? e.message : 'Could not save tracking change'); }
  finally { saving.value = false; }
}
function canOpenClaim(row: ProductTrackingWarranty) { return warrantyState(row) === 'Active'; }
function statusBadge(status: string) {
  if (['Active','In Stock','Resolved'].includes(status)) return 'badge-success';
  if (['Sold','Claimed','Open'].includes(status)) return 'badge-info';
  if (['Warranty Hold','Warranty at Supplier','At Supplier','Warranty Settled'].includes(status)) return 'badge-warning';
  if (['Expired','Voided','Rejected','Warranty Rejected'].includes(status)) return 'badge-danger';
  return 'badge-warning';
}

defineExpose({ refresh });
onMounted(refresh);
</script>

<template>
  <div class="tracking-page module-page">
    <div class="tracking-summary">
      <button type="button" @click="tab='pending'"><span>Pending Tracking</span><strong>{{ pendingQty }}</strong><small>{{ data.pending.length }} stock lot(s)</small></button>
      <button type="button" @click="tab='serials'"><span>Serial / IMEI</span><strong>{{ serialInStock }}</strong><small>currently in stock</small></button>
      <button type="button" @click="tab='expiry';expiryWindow='30'"><span>Expiring ≤30 Days</span><strong>{{ expiry30Qty }}</strong><small>{{ expiredQty }} already expired</small></button>
      <button type="button" @click="tab='claims';claimStatus='Open'"><span>Open Warranty Claims</span><strong>{{ openClaims }}</strong><small>need attention</small></button>
      <button type="button" @click="tab='supplier-rma';rmaStatus='At Supplier'"><span>At Supplier Warranty</span><strong>{{ supplierRmaAtSupplier }}</strong><small>RMA awaiting supplier</small></button>
    </div>

    <div class="card tracking-card">
      <div class="tracking-tabs">
        <button :class="{active:tab==='pending'}" @click="tab='pending'">Pending <span>{{ data.pending.length }}</span></button>
        <button :class="{active:tab==='serials'}" @click="tab='serials'">Serial / IMEI</button>
        <button :class="{active:tab==='expiry'}" @click="tab='expiry'">Expiry</button>
        <button :class="{active:tab==='warranty'}" @click="tab='warranty'">Warranty</button>
        <button :class="{active:tab==='claims'}" @click="tab='claims'">Claims <span>{{ openClaims }}</span></button>
        <button :class="{active:tab==='supplier-rma'}" @click="tab='supplier-rma'">Supplier Warranty <span>{{ supplierRmaAtSupplier }}</span></button>
        <button :class="{active:tab==='replacements'}" @click="tab='replacements'">Replacements <span>{{ data.replacements.length }}</span></button>
      </div>

      <div class="tracking-toolbar">
        <div><h3>{{ tab==='pending'?'Pending Tracking':tab==='serials'?'Serial / IMEI':tab==='expiry'?'Expiry':tab==='warranty'?'Warranty':tab==='claims'?'Warranty Claims':tab==='supplier-rma'?'Supplier Warranty / RMA':'Warranty Replacements' }}</h3><span class="bn-hint">{{ tab==='pending'?'অসম্পূর্ণ ট্র্যাকিং সম্পূর্ণ করুন':tab==='expiry'?'এক্সপায়ারি ঝুঁকি দেখুন':tab==='claims'?'ওয়ারেন্টি ক্লেইম পরিচালনা করুন':tab==='supplier-rma'?'সাপ্লায়ার ওয়ারেন্টি পাঠানো ও সেটেলমেন্ট':tab==='replacements'?'রিপ্লেসমেন্ট সিরিয়াল ইতিহাস':'পণ্যের ট্র্যাকিং তথ্য' }}</span></div>
        <div class="tracking-tools">
          <select v-if="tab==='serials'" v-model="serialStatus"><option>All</option><option>In Stock</option><option>Sold</option><option>Returned</option><option>Warranty Hold</option><option>Warranty at Supplier</option><option>Warranty Settled</option><option>Warranty Rejected</option></select>
          <select v-if="tab==='expiry'" v-model="expiryWindow"><option value="All">All expiry</option><option value="Expired">Expired</option><option value="30">0–30 days</option><option value="60">31–60 days</option><option value="90">61–90 days</option><option value="Safe">More than 90 days</option></select>
          <select v-if="tab==='warranty'" v-model="warrantyStatus"><option>All</option><option>Active</option><option>Claimed</option><option>Expired</option><option>Voided</option></select>
          <select v-if="tab==='claims'" v-model="claimStatus"><option>All</option><option>Open</option><option>Resolved</option><option>Rejected</option><option>Cancelled</option></select>
          <select v-if="tab==='supplier-rma'" v-model="rmaStatus"><option>All</option><option>At Supplier</option><option>Resolved</option><option>Rejected</option></select>
          <input v-model.trim="search" type="search" placeholder="Search product, serial, invoice, customer..." />
          <button v-if="search" type="button" class="btn btn-sm" @click="search=''">Clear</button>
        </div>
      </div>
      <div v-if="loading" class="empty-state">Loading tracking data...</div>

      <div v-else-if="tab==='pending'" class="table-scroll"><table><thead><tr><th>Product</th><th>Source</th><th class="num">Qty</th><th>Missing</th><th></th></tr></thead><tbody><tr v-for="row in pendingRows" :key="row.lotId"><td><strong>{{ productLabel(row) }}</strong><br><small class="mono">{{ row.lotId }}</small></td><td>{{ row.sourceType }}<br><small class="mono">{{ row.sourceRef }}</small></td><td class="num mono">{{ row.remainingQuantity }}</td><td><span class="badge badge-warning">{{ [row.trackSerial?'Serial / IMEI':'',row.trackExpiry?'Expiry':''].filter(Boolean).join(' + ') }}</span></td><td class="action-cell"><button v-if="props.canEdit" class="btn btn-primary btn-sm" @click="openPending(row)">Add Tracking</button></td></tr></tbody></table><div v-if="!pendingRows.length" class="empty-state">No pending tracking. All tracked stock is complete.</div></div>

      <div v-else-if="tab==='serials'" class="table-scroll"><table><thead><tr><th>Serial / IMEI</th><th>Product</th><th>Status</th><th>Expiry</th><th>Invoice</th><th></th></tr></thead><tbody><tr v-for="row in serialRows" :key="row.serialId"><td class="mono"><strong>{{ row.serialNumber }}</strong></td><td>{{ productLabel(row) }}</td><td><span class="badge" :class="statusBadge(row.status)">{{ row.status }}</span></td><td>{{ row.expiryDate||'-' }}</td><td class="mono">{{ row.invoiceId||'-' }}</td><td class="action-cell"><button v-if="props.canEdit" class="btn btn-sm" @click="openSerialCorrection(row)">Correct</button></td></tr></tbody></table><div v-if="!serialRows.length" class="empty-state">No serial records match this filter.</div></div>

      <div v-else-if="tab==='expiry'" class="table-scroll"><table><thead><tr><th>Product</th><th>Batch</th><th>Expiry</th><th>Status</th><th class="num">Remaining</th><th></th></tr></thead><tbody><tr v-for="row in expiryRows" :key="row.expiryBatchId"><td>{{ productLabel(row) }}</td><td class="mono">{{ row.batchNo||'-' }}</td><td>{{ row.expiryDate }}</td><td><span class="badge" :class="dateState(row.expiryDate)==='Expired'?'badge-danger':dateState(row.expiryDate).includes('left')||dateState(row.expiryDate)==='Expires today'?'badge-warning':'badge-success'">{{ dateState(row.expiryDate) }}</span></td><td class="num mono">{{ row.remainingQuantity }}</td><td class="action-cell"><button v-if="props.canEdit" class="btn btn-sm" @click="openExpiryCorrection(row)">Correct</button></td></tr></tbody></table><div v-if="!expiryRows.length" class="empty-state">No expiry batches match this filter.</div></div>

      <div v-else-if="tab==='warranty'" class="table-scroll"><table><thead><tr><th>Product</th><th>Customer</th><th>Serial</th><th>Invoice</th><th>Warranty Until</th><th>Status</th><th></th></tr></thead><tbody><tr v-for="row in warrantyRows" :key="row.warrantyId"><td>{{ row.productName }}</td><td>{{ row.customerName||'-' }}<br><small>{{ row.customerPhone }}</small></td><td class="mono">{{ row.serialNumber||'-' }}</td><td class="mono">{{ row.invoiceId }}</td><td>{{ row.warrantyEndDate }}</td><td><span class="badge" :class="statusBadge(warrantyState(row))">{{ warrantyState(row) }}</span></td><td class="action-cell warranty-actions"><button v-if="props.canEdit" class="btn btn-sm" @click="openWarrantyManage(row)">Manage</button><button v-if="props.canAdd && canOpenClaim(row)" class="btn btn-primary btn-sm" @click="openClaimCreate(row)">New Claim</button></td></tr></tbody></table><div v-if="!warrantyRows.length" class="empty-state">No warranty records match this filter.</div></div>

      <div v-else-if="tab==='claims'" class="table-scroll"><table><thead><tr><th>Date</th><th>Product</th><th>Customer</th><th>Serial</th><th>Issue</th><th>Status</th><th></th></tr></thead><tbody><tr v-for="row in claimRows" :key="row.claimId"><td>{{ row.claimDate }}</td><td>{{ row.productName }}<br><small class="mono">{{ row.invoiceId }}</small></td><td>{{ row.customerName||'-' }}<br><small>{{ row.customerPhone }}</small></td><td class="mono">{{ row.serialNumber||'-' }}</td><td><strong>{{ row.issue }}</strong><br><small v-if="row.resolution">{{ row.resolution }}</small></td><td><span class="badge" :class="statusBadge(row.status)">{{ row.status }}</span></td><td class="action-cell claim-actions"><button v-if="props.canEdit && !claimHasOpenRma(row.claimId) && (row.status==='Open' || claimHasOwnReplacement(row.claimId))" class="btn btn-sm" @click="openSupplierRma(row)">Send to Supplier</button><button v-if="props.canEdit && row.status==='Open' && row.serialNumber" class="btn btn-primary btn-sm" @click="openClaimReplacement(row)">Replace Unit</button><button v-if="props.canEdit && row.status==='Open'" class="btn btn-sm" @click="openClaimComplete(row)">Complete</button></td></tr></tbody></table><div v-if="!claimRows.length" class="empty-state">No warranty claims match this filter.</div></div>

      <div v-else-if="tab==='supplier-rma'" class="table-scroll"><table><thead><tr><th>RMA</th><th>Supplier</th><th>Product / Serial</th><th>Customer</th><th>Sent</th><th>Status</th><th>Settlement</th><th></th></tr></thead><tbody><tr v-for="row in supplierRmaRows" :key="row.rmaId"><td><strong class="mono">{{ row.rmaNo }}</strong><br><small>{{ row.supplierReference||'-' }}</small></td><td>{{ row.supplierName }}</td><td><strong>{{ row.productName }}</strong><br><small class="mono">{{ row.serialNumber||'Non-serialized' }}</small></td><td>{{ row.customerName||'-' }}<br><small>{{ row.customerPhone }}</small></td><td>{{ row.sentDate }}<br><small>{{ row.customerHandling }}</small></td><td><span class="badge" :class="statusBadge(row.status)">{{ row.status }}</span></td><td><strong v-if="row.resolutionType">{{ row.resolutionType }}</strong><span v-else>-</span><br><small v-if="row.financials.length">{{ row.financials.map(x=>`${x.financialType}: ${Number(x.amount).toLocaleString()}`).join(' · ') }}</small><small v-else-if="row.receivedItems.length">{{ row.receivedItems.map(x=>`${x.productName} × ${x.quantity}`).join(' · ') }}</small></td><td class="action-cell"><button v-if="props.canEdit && row.status==='At Supplier'" class="btn btn-primary btn-sm" @click="openRmaResolve(row)">Resolve</button></td></tr></tbody></table><div v-if="!supplierRmaRows.length" class="empty-state">No supplier warranty RMA matches this filter.</div></div>

      <div v-else-if="tab==='replacements'" class="table-scroll"><table><thead><tr><th>Date</th><th>Product</th><th>Customer</th><th>Invoice</th><th>Defective Serial</th><th>Replacement Serial</th><th>By</th></tr></thead><tbody><tr v-for="row in replacementRows" :key="row.replacementId"><td>{{ row.replacementDate }}</td><td>{{ row.productName }}</td><td>{{ row.customerName||'-' }}<br><small>{{ row.customerPhone }}</small></td><td class="mono">{{ row.invoiceId }}</td><td class="mono"><span class="badge badge-warning">{{ row.originalSerialNumber }}</span></td><td class="mono"><span class="badge badge-success">{{ row.replacementSerialNumber }}</span></td><td>{{ row.createdBy||'-' }}<br><small v-if="row.note">{{ row.note }}</small></td></tr></tbody></table><div v-if="!replacementRows.length" class="empty-state">No warranty replacements match this search.</div></div>
    </div>

    <div v-if="editLot" class="modal-overlay" @click.self="closePending">
      <div class="modal modal-lg tracking-modal">
        <div class="modal-header"><div><h3>Complete Product Tracking</h3><span class="bn-hint">{{ productLabel(editLot) }} — {{ editLot.sourceType }} {{ editLot.sourceRef }}</span></div><button class="modal-close" @click="closePending">✕</button></div>
        <div class="modal-body"><ProductTrackingEntry v-model="editTracking" :product-name="productLabel(editLot)" :quantity="Number(editLot.remainingQuantity||0)" :track-serial="!!editLot.trackSerial" :track-expiry="!!editLot.trackExpiry" /></div>
        <div class="modal-footer"><button class="btn" @click="closePending">Cancel</button><button class="btn btn-primary" :disabled="saving" @click="savePending">{{ saving?'Saving...':'Save Tracking' }}</button></div>
      </div>
    </div>

    <div v-if="modalKind" class="modal-overlay" @click.self="closeActionModal">
      <div class="modal tracking-action-modal" :class="{ 'modal-lg': modalKind==='rma-resolve' }">
        <div class="modal-header"><h3>{{ modalKind==='serial'?'Correct Serial / IMEI':modalKind==='expiry'?'Correct Expiry Batch':modalKind==='warranty'?'Manage Warranty':modalKind==='claim-create'?'Open Warranty Claim':modalKind==='claim-replace'?'Replace Warranty Unit':modalKind==='rma-send'?'Send Warranty to Supplier':modalKind==='rma-resolve'?'Resolve Supplier Warranty / RMA':'Complete Warranty Claim' }}</h3><button class="modal-close" @click="closeActionModal">✕</button></div>
        <div class="modal-body tracking-action-form">
          <template v-if="modalKind==='serial'">
            <label>Current Serial / IMEI<input :value="selectedSerial?.serialNumber" disabled /></label>
            <label>Correct Serial / IMEI<input v-model.trim="serialForm.serialNumber" type="text" /></label>
            <label>Reason<textarea v-model.trim="serialForm.reason" rows="3" placeholder="Why is this serial being corrected?"></textarea></label>
            <div class="tracking-note is-pending">This is a correction for the same physical item. Related sale/warranty references will be updated too.</div>
          </template>
          <template v-else-if="modalKind==='expiry'">
            <label>Expiry Month<ExpiryPicker v-model="expiryForm.expiryDate" /></label>
            <label>Batch No. <small>(optional)</small><input v-model.trim="expiryForm.batchNo" type="text" /></label>
            <label>Reason<textarea v-model.trim="expiryForm.reason" rows="3" placeholder="Why is this batch/expiry being corrected?"></textarea></label>
          </template>
          <template v-else-if="modalKind==='warranty'">
            <label>Warranty Until<AppDatePicker v-model="warrantyForm.warrantyEndDate" /></label>
            <label>Status<select v-model="warrantyForm.status"><option value="Active">Active</option><option value="Voided">Voided</option></select></label>
            <label>Reason<textarea v-model.trim="warrantyForm.reason" rows="3" placeholder="Extension, correction, or void reason"></textarea></label>
          </template>
          <template v-else-if="modalKind==='claim-create'">
            <div class="tracking-reference"><strong>{{ selectedWarranty?.productName }}</strong><span>{{ selectedWarranty?.customerName }} · {{ selectedWarranty?.serialNumber || selectedWarranty?.invoiceId }}</span></div>
            <label>Claim Date<AppDatePicker v-model="claimCreateForm.claimDate" /></label>
            <label>Issue<textarea v-model.trim="claimCreateForm.issue" rows="4" placeholder="Describe the customer's warranty issue"></textarea></label>
          </template>
          <template v-else-if="modalKind==='claim-complete'">
            <div class="tracking-reference"><strong>{{ selectedClaim?.productName }}</strong><span>{{ selectedClaim?.issue }}</span></div>
            <label>Result<select v-model="claimCompleteForm.status"><option value="Resolved">Resolved</option><option value="Rejected">Rejected</option><option value="Cancelled">Cancelled</option></select></label>
            <label>Resolution / Note<textarea v-model.trim="claimCompleteForm.resolution" rows="4" placeholder="What was done or why was it rejected/cancelled?"></textarea></label>
          </template>
          <template v-else-if="modalKind==='claim-replace'">
            <div class="tracking-reference"><strong>{{ selectedClaim?.productName }}</strong><span>Defective: {{ selectedClaim?.serialNumber }} · {{ selectedClaim?.invoiceId }}</span></div>
            <label>Replacement Date<AppDatePicker v-model="replacementForm.replacementDate" /></label>
            <label>Replacement Serial / IMEI<div class="tracking-select-shell"><AppSelect v-model="replacementForm.replacementSerialId" :options="replacementSerialOptions" placeholder="Select available serial..." aria-label="Replacement Serial / IMEI" /></div></label>
            <div v-if="!replacementSerialOptions.length" class="tracking-note is-pending">No ready Serial / IMEI is available for this product. Receive/complete tracked stock first.</div>
            <label>Note <small>(optional)</small><textarea v-model.trim="replacementForm.note" rows="3" placeholder="Replacement note"></textarea></label>
            <div class="tracking-note replacement-note">The defective serial will move to <strong>Warranty Hold</strong>. The selected replacement serial will leave sellable stock and inherit the existing warranty end date. No sale/payment entry is created.</div>
          </template>
          <template v-else-if="modalKind==='rma-send'">
            <div class="tracking-reference"><strong>{{ selectedClaim?.productName }}</strong><span>{{ selectedClaim?.customerName || 'Customer' }} · {{ selectedClaim?.serialNumber || 'Non-serialized' }} · {{ selectedClaim?.invoiceId }}</span></div>
            <label>Supplier<div class="tracking-select-shell"><AppSelect v-model="rmaSendForm.supplierId" :options="supplierOptions" placeholder="Select supplier..." aria-label="Supplier" /></div></label>
            <label>Sent Date<AppDatePicker v-model="rmaSendForm.sentDate" /></label>
            <label>Customer Handling<input :value="rmaSendForm.customerHandling" disabled /></label>
            <label>Supplier RMA / Reference <small>(optional)</small><input v-model.trim="rmaSendForm.supplierReference" type="text" placeholder="Supplier reference, challan, RMA no." /></label>
            <label>Notes <small>(optional)</small><textarea v-model.trim="rmaSendForm.notes" rows="3" placeholder="Issue / warranty note"></textarea></label>
            <div class="tracking-note replacement-note">Sending to supplier changes only the warranty item location/status. If the defective unit is currently in <strong>Warranty Hold</strong>, it leaves on-hand stock until the supplier sends something back.</div>
          </template>
          <template v-else-if="modalKind==='rma-resolve'">
            <div class="tracking-reference"><strong>{{ selectedRma?.rmaNo }} · {{ selectedRma?.supplierName }}</strong><span>{{ selectedRma?.productName }} · {{ selectedRma?.serialNumber || 'Non-serialized' }} · {{ selectedRma?.customerHandling }}</span></div>
            <div class="rma-grid-2">
              <label>Resolution Date<AppDatePicker v-model="rmaResolveForm.resolvedDate" /></label>
              <label>Supplier Result<select v-model="rmaResolveForm.resolutionType" @change="onRmaResolutionTypeChange"><option value="Same Item Returned">Same Item Returned / Repaired</option><option value="Replacement Same Product">Replacement Same Product</option><option value="Settlement">Different Product / Mixed Settlement</option><option value="Warranty Rejected">Warranty Rejected / Same Item As-Is</option></select></label>
            </div>
            <label v-if="rmaResolveForm.resolutionType==='Replacement Same Product' && selectedRma?.customerHandling==='Waiting for Supplier'" class="rma-check"><input v-model="rmaResolveForm.directToCustomer" type="checkbox" /> Send supplier replacement directly to customer</label>
            <div v-if="selectedRma?.customerHandling==='Waiting for Supplier' && rmaResolveForm.resolutionType==='Settlement'" class="tracking-note is-pending">Customer is still waiting. Cancel this dialog, go to Warranty Claims and use <strong>Replace Unit</strong> from your own stock. The open supplier RMA will automatically switch to “Already Replaced from Our Stock”, then you can return here and settle by product/credit/refund.</div>

            <section v-if="rmaResolveForm.resolutionType==='Replacement Same Product' || rmaResolveForm.resolutionType==='Settlement'" class="rma-section">
              <div class="rma-section-head"><div><strong>Products Received from Supplier</strong><small>Inventory receipts reuse normal stock lot + Serial/Expiry tracking.</small></div><button v-if="rmaResolveForm.resolutionType==='Settlement'" type="button" class="btn btn-sm" @click="addReceivedItem">+ Add Product</button></div>
              <div v-if="!rmaReceivedItems.length" class="tracking-note is-pending">No product received. You can settle using supplier credit/refund only, or add a product.</div>
              <div v-for="item in rmaReceivedItems" :key="item.key" class="rma-item-card">
                <div class="rma-item-top">
                  <label>Product<ProductSearchSelect v-model="item.productId" :items="supplierWarranty.products" :show-stock="false" :disabled="rmaResolveForm.resolutionType==='Replacement Same Product'" placeholder="Search received product..." @select="onReceivedProductSelect(item,$event)" /></label>
                  <label>Qty<input v-model.number="item.quantity" type="number" min="1" step="1" /></label>
                  <label>Agreed Value / Unit<input v-model.number="item.unitValue" type="number" min="0" step="0.01" /></label>
                  <button v-if="rmaResolveForm.resolutionType==='Settlement'" type="button" class="btn btn-sm" @click="removeReceivedItem(item.key)">Remove</button>
                </div>
                <ProductTrackingEntry v-if="item.productId && (rmaProduct(item.productId)?.trackSerial || rmaProduct(item.productId)?.trackExpiry)" v-model="item.tracking" :product-name="receivedProductLabel(item)" :quantity="Number(item.quantity||0)" :track-serial="!!rmaProduct(item.productId)?.trackSerial" :track-expiry="!!rmaProduct(item.productId)?.trackExpiry" />
              </div>
            </section>

            <section class="rma-section">
              <div class="rma-section-head"><div><strong>Financial Settlement</strong><small>Only enter the parts actually agreed with the supplier.</small></div></div>
              <div class="rma-grid-3">
                <label>Supplier Credit<input v-model.number="rmaResolveForm.supplierCreditAmount" type="number" min="0" step="0.01" /><small>Reduces supplier due.</small></label>
                <label>Additional Payable<input v-model.number="rmaResolveForm.additionalPayableAmount" type="number" min="0" step="0.01" /><small>Increases supplier due.</small></label>
                <label>Cash / Bank Refund<input v-model.number="rmaResolveForm.cashRefundAmount" type="number" min="0" step="0.01" /><small>Money received now.</small></label>
              </div>
              <div v-if="Number(rmaResolveForm.cashRefundAmount||0)>0" class="rma-grid-2">
                <label>Refund Method<select v-model="rmaResolveForm.refundMethod"><option value="Cash">Cash</option><option value="Bank">Bank</option><option value="Mobile Banking">Mobile Banking</option></select></label>
                <label v-if="rmaResolveForm.refundMethod!=='Cash'">Account<div class="tracking-select-shell"><AppSelect v-model="rmaResolveForm.bankAccountId" :options="bankOptions" placeholder="Select account..." aria-label="Refund account" /></div></label>
              </div>
            </section>
            <label>Resolution Note<textarea v-model.trim="rmaResolveForm.resolutionNote" rows="4" placeholder="What did supplier return/replace/credit, and any warranty decision?"></textarea></label>
            <div class="tracking-note replacement-note">Supplier credit and additional payable post to the existing Supplier Ledger. Cash/Bank refund posts only to the money book. Product receipts post through warranty stock lots, not as a fake Purchase.</div>
          </template>
        </div>
        <div class="modal-footer"><button class="btn" @click="closeActionModal">Cancel</button><button class="btn btn-primary" :disabled="saving || (modalKind==='claim-replace' && !replacementForm.replacementSerialId) || (modalKind==='rma-send' && !rmaSendForm.supplierId)" @click="saveAction">{{ saving?'Saving...':modalKind==='claim-replace'?'Complete Replacement':modalKind==='rma-send'?'Send to Supplier':modalKind==='rma-resolve'?'Resolve RMA':'Save' }}</button></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tracking-page{display:grid;gap:16px}.tracking-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}.tracking-summary>button{font:inherit;text-align:left;padding:14px 16px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-surface);display:grid;gap:3px;cursor:pointer;transition:transform .15s ease,border-color .15s ease}.tracking-summary>button:hover{transform:translateY(-1px);border-color:var(--color-primary)}.tracking-summary span,.tracking-summary small{font-size:12px;color:var(--color-text-muted)}.tracking-summary strong{font-size:24px;color:var(--color-text)}.tracking-card{overflow:hidden}.tracking-tabs{display:flex;gap:4px;border-bottom:1px solid var(--color-border);overflow:auto}.tracking-tabs button{border:0;background:transparent;padding:13px 14px;font-weight:700;color:var(--color-text-muted);cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}.tracking-tabs button.active{color:var(--color-primary);border-color:var(--color-primary)}.tracking-tabs button span{margin-left:5px;font-size:11px}.tracking-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px}.tracking-toolbar h3{margin:0}.tracking-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}.tracking-tools input{min-width:280px}.tracking-tools select{min-width:150px}.tracking-card .table-scroll{border-top:1px solid var(--color-border)}.warranty-actions,.claim-actions{display:flex;gap:6px;justify-content:flex-end}.tracking-select-shell{height:40px;border:1px solid var(--color-border);border-radius:8px;background:var(--color-surface)}.replacement-note{background:color-mix(in srgb,var(--color-primary) 7%,var(--color-surface));color:var(--color-text)}.tracking-action-modal{width:min(560px,calc(100vw - 28px))}.tracking-action-form{display:grid;gap:14px}.tracking-action-form>label{display:grid;gap:6px;font-weight:600}.tracking-action-form label small{font-weight:400;color:var(--color-text-muted)}.tracking-action-form textarea{width:100%;resize:vertical}.tracking-reference{display:grid;gap:3px;padding:10px 12px;border:1px solid var(--color-border);border-radius:9px;background:var(--color-surface-muted,#f8fafc)}.tracking-reference span{font-size:12px;color:var(--color-text-muted)}.tracking-action-form .tracking-note{font-size:13px;padding:10px 12px;border-radius:9px}.tracking-action-form .tracking-note.is-pending{background:#fffbeb;color:#92400e}@media(max-width:900px){.tracking-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.tracking-toolbar{align-items:stretch;flex-direction:column}.tracking-tools{justify-content:flex-start}.tracking-tools input{min-width:0;flex:1}}.rma-grid-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.rma-grid-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.rma-check{display:flex!important;align-items:center;gap:9px;padding:10px 12px;border:1px solid var(--color-border);border-radius:9px}.rma-check input{width:auto;margin:0}.rma-section{display:grid;gap:10px;padding:12px;border:1px solid var(--color-border);border-radius:10px;background:color-mix(in srgb,var(--color-surface) 94%,var(--color-bg))}.rma-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.rma-section-head>div{display:grid;gap:2px}.rma-section-head small{color:var(--color-text-muted);font-size:11px}.rma-item-card{display:grid;gap:10px;padding:10px;border:1px solid var(--color-border);border-radius:9px;background:var(--color-surface)}.rma-item-top{display:grid;grid-template-columns:minmax(220px,2fr) minmax(80px,.55fr) minmax(120px,.8fr) auto;gap:8px;align-items:end}.rma-item-top>label{display:grid;gap:5px;margin:0}.rma-item-top .btn{align-self:end;min-height:40px}.tracking-action-modal.modal-lg{width:min(980px,calc(100vw - 28px))}.tracking-action-modal.modal-lg .modal-body{max-height:min(72vh,760px);overflow:auto}
@media(max-width:900px){.rma-grid-3{grid-template-columns:1fr}.rma-item-top{grid-template-columns:1fr 1fr}.rma-item-top>label:first-child{grid-column:1/-1}}
@media(max-width:600px){.tracking-summary{grid-template-columns:1fr 1fr}.tracking-summary>button{padding:10px}.tracking-summary strong{font-size:20px}.tracking-tools{display:grid;grid-template-columns:1fr auto}.tracking-tools select{min-width:0}.tracking-tools input{grid-column:1/-1;width:100%}.warranty-actions,.claim-actions{flex-direction:column}.rma-grid-2{grid-template-columns:1fr}.rma-item-top{grid-template-columns:1fr}.rma-item-top>label:first-child{grid-column:auto}.rma-section-head{align-items:flex-start;flex-direction:column}}
</style>
