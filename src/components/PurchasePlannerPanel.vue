<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { notifySuccess, notifyInfo } from '../utils/notify';
import SortableHeader from './SortableHeader.vue';
import SupplierPurchaseOrderView from './SupplierPurchaseOrder.vue';
import ProductSearchSelect from './ui/ProductSearchSelect.vue';
import { createProductSearchIndex, normalizeProductSearchText, searchProductIndex } from '../utils/productSearch';
import {
  analyzePurchasePlanner,
  approvePurchasePlan,
  deletePurchasePlan,
  getPurchasePlan,
  getPurchasePlanOrder,
  getPurchasePlanOrders,
  getPurchasePlans,
  rejectPurchasePlan,
  savePurchasePlan,
  updatePurchasePlan
} from '../api';
import type {
  PurchasePlanOrderSummary,
  PurchasePlanSummary,
  PurchasePlannerRow,
  PurchasePlannerScope,
  Supplier,
  SupplierPurchaseOrder
} from '../types';

const emit = defineEmits<{
  createProduct: [preferredSupplierId: string];
  convertOrder: [orderId: string];
}>();

type PlannerView = 'planner' | 'plans' | 'orders';
const view = ref<PlannerView>('planner');
const params = reactive({
  scope: 'ALL' as PurchasePlannerScope,
  supplierId: '',
  salesWindowDays: 30,
  targetCoverDays: 30,
  budgetAmount: 0,
  planDate: new Date().toISOString().slice(0, 10),
  notes: ''
});
const rows = ref<PurchasePlannerRow[]>([]);
const suppliers = ref<Supplier[]>([]);
const plans = ref<PurchasePlanSummary[]>([]);
const orders = ref<PurchasePlanOrderSummary[]>([]);
const selectedPlan = ref<PurchasePlanSummary | null>(null);
const selectedPlanItems = ref<PurchasePlannerRow[]>([]);
const selectedOrder = ref<SupplierPurchaseOrder | null>(null);
const plannerSearch = ref('');
const manualProductId = ref('');
const loading = ref(false);
const saving = ref(false);
const approving = ref('');
const editingPlanId = ref('');
const editingPlanNo = ref('');
const planActionMode = ref<'reject' | 'delete' | null>(null);
const planActionTarget = ref<PurchasePlanSummary | null>(null);
const planActionReason = ref('');
const planActionError = ref('');
const planActionSaving = ref(false);
const error = ref('');
const message = ref('');

function announce(text: string, type: 'success' | 'info' = 'success'): void {
  message.value = '';
  if (type === 'info') notifyInfo(text); else notifySuccess(text);
}

function formatMoney(value: unknown): string {
  const n = Number(value || 0);
  return `৳${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function formatNumber(value: unknown, digits = 2): string {
  const n = Number(value || 0);
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}
function whole(value: unknown): number {
  const n = Math.round(Number(value || 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function investment(row: PurchasePlannerRow): number { return whole(row.plannedQty) * Number(row.lastPurchaseCost || 0); }
function salesValue(row: PurchasePlannerRow): number { return whole(row.plannedQty) * Number(row.sellingPrice || 0); }
function grossProfit(row: PurchasePlannerRow): number { return salesValue(row) - investment(row); }
function margin(row: PurchasePlannerRow): number { const sales = salesValue(row); return sales > 0 ? (grossProfit(row) / sales) * 100 : 0; }

const includedRows = computed(() => rows.value.filter((row) => row.included && whole(row.plannedQty) > 0));
const totals = computed(() => {
  const totalInvestment = includedRows.value.reduce((sum, row) => sum + investment(row), 0);
  const expectedSalesValue = includedRows.value.reduce((sum, row) => sum + salesValue(row), 0);
  const expectedGrossProfit = expectedSalesValue - totalInvestment;
  const marginPercent = expectedSalesValue > 0 ? (expectedGrossProfit / expectedSalesValue) * 100 : 0;
  return {
    criticalCount: rows.value.filter((row) => row.priority === 'Critical').length,
    highCount: rows.value.filter((row) => row.priority === 'High').length,
    totalInvestment,
    expectedSalesValue,
    expectedGrossProfit,
    marginPercent,
    budgetRemaining: Number(params.budgetAmount || 0) > 0 ? Number(params.budgetAmount || 0) - totalInvestment : null
  };
});

const plannerProductSearchIndex = computed(() => createProductSearchIndex(rows.value));
const visibleRows = computed(() => {
  const q = normalizeProductSearchText(plannerSearch.value);
  if (!q) return rows.value;
  const ranked = searchProductIndex(plannerProductSearchIndex.value, q).map((result) => result.product);
  const seen = new Set(ranked.map((row) => row.productId));
  // Preserve the planner's previous ability to search supplier/priority while
  // product fields use the shared smart-search ranking.
  for (const row of rows.value) {
    if (seen.has(row.productId)) continue;
    const extra = normalizeProductSearchText(`${row.supplierName} ${row.priority}`);
    if (extra.includes(q)) ranked.push(row);
  }
  return ranked;
});
const manualProductOptions = computed(() => rows.value.filter((row) => !row.included || whole(row.plannedQty) === 0));

const selectedPlanGroups = computed(() => {
  const map = new Map<string, PurchasePlannerRow[]>();
  for (const item of selectedPlanItems.value.filter((row) => Boolean(row.included) && whole(row.plannedQty) > 0)) {
    const key = item.supplierName || 'Unassigned Supplier';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return Array.from(map.entries()).map(([supplierName, items]) => ({ supplierName, items }));
});

function clearNotices(): void { error.value = ''; message.value = ''; }
function supplierName(id: string): string { return suppliers.value.find((supplier) => supplier.id === id)?.name || ''; }
function onSupplierChange(row: PurchasePlannerRow): void { row.supplierName = supplierName(row.supplierId); }
function normalizePlannedQty(row: PurchasePlannerRow): void { row.plannedQty = whole(row.plannedQty); if (row.plannedQty > 0) row.included = true; }

async function analyze(options: { preserveManual?: boolean } = {}): Promise<void> {
  clearNotices();
  if (params.scope === 'SUPPLIER' && !params.supplierId) {
    error.value = 'Choose a supplier for supplier-wise planning.';
    return;
  }
  loading.value = true;
  const previous = options.preserveManual
    ? new Map(rows.value.map((row) => [row.productId, { supplierId: row.supplierId, included: row.included, plannedQty: row.plannedQty }]))
    : null;
  try {
    const result = await analyzePurchasePlanner({
      scope: params.scope,
      supplierId: params.supplierId,
      salesWindowDays: params.salesWindowDays,
      targetCoverDays: params.targetCoverDays,
      budgetAmount: params.budgetAmount
    });
    suppliers.value = result.suppliers;
    rows.value = result.rows.map((row) => {
      const manual = previous?.get(row.productId);
      if (!manual) return { ...row, plannedQty: whole(row.plannedQty) };
      const supplierId = manual.supplierId || row.supplierId;
      return {
        ...row,
        supplierId,
        supplierName: supplierName(supplierId) || row.supplierName,
        included: manual.included,
        plannedQty: whole(manual.plannedQty)
      };
    });
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not analyze inventory.';
  } finally {
    loading.value = false;
  }
}

async function autoFitBudget(): Promise<void> {
  if (Number(params.budgetAmount || 0) <= 0) {
    error.value = 'Enter a purchase budget before Auto Fit Budget.';
    return;
  }
  // Server owns the deterministic priority allocation. Preserve supplier choices,
  // but accept the server-calculated planned quantities for the budget fit.
  const supplierOverrides = new Map(rows.value.map((row) => [row.productId, row.supplierId]));
  clearNotices();
  loading.value = true;
  try {
    const result = await analyzePurchasePlanner({
      scope: params.scope,
      supplierId: params.supplierId,
      salesWindowDays: params.salesWindowDays,
      targetCoverDays: params.targetCoverDays,
      budgetAmount: params.budgetAmount
    });
    suppliers.value = result.suppliers;
    rows.value = result.rows.map((row) => {
      const supplierId = supplierOverrides.get(row.productId) || row.supplierId;
      return { ...row, supplierId, supplierName: supplierName(supplierId) || row.supplierName, plannedQty: whole(row.plannedQty), included: whole(row.plannedQty) > 0 };
    });
    announce('Budget fitted by priority, stock cover and sales velocity. You can still edit quantities manually.', 'info');
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not fit budget.';
  } finally { loading.value = false; }
}

function addExistingProduct(): void {
  const row = rows.value.find((item) => item.productId === manualProductId.value);
  if (!row) return;
  row.included = true;
  if (row.plannedQty <= 0 && row.suggestedQty > 0) row.plannedQty = row.suggestedQty;
  plannerSearch.value = row.productName;
  manualProductId.value = '';
  announce(`${row.productName} added to the plan. Enter Planned Qty if needed.`, 'info');
}

async function savePlan(): Promise<void> {
  clearNotices();
  const items = rows.value
    .filter((row) => row.included || whole(row.plannedQty) > 0)
    .map((row) => ({ productId: row.productId, supplierId: row.supplierId, plannedQty: whole(row.plannedQty), included: row.included }));
  if (!items.some((item) => item.included && item.plannedQty > 0)) {
    error.value = 'Enter Planned Qty for at least one included product.';
    return;
  }
  const missingCost = rows.value.find((row) => row.included && whole(row.plannedQty) > 0 && Number(row.lastPurchaseCost || 0) <= 0);
  if (missingCost) {
    error.value = `Set a valid purchase price/cost for ${missingCost.productName} before saving the plan.`;
    return;
  }
  saving.value = true;
  try {
    const payload = {
      scope: params.scope,
      supplierId: params.supplierId,
      salesWindowDays: params.salesWindowDays,
      targetCoverDays: params.targetCoverDays,
      budgetAmount: params.budgetAmount,
      planDate: params.planDate,
      notes: params.notes,
      items
    };
    const result = editingPlanId.value
      ? await updatePurchasePlan(editingPlanId.value, payload)
      : await savePurchasePlan(payload);
    announce(editingPlanId.value
      ? `Purchase Plan ${result.planNo} updated. No stock or accounting entries were created.`
      : `Purchase Plan ${result.planNo} saved. No stock or accounting entries were created.`);
    const updatedPlanId = result.planId;
    editingPlanId.value = '';
    editingPlanNo.value = '';
    await loadPlans();
    view.value = 'plans';
    const updated = plans.value.find((plan) => plan.planId === updatedPlanId);
    if (updated) await openPlan(updated);
  } catch (err) {
    error.value = err instanceof Error ? err.message : editingPlanId.value ? 'Could not update purchase plan.' : 'Could not save purchase plan.';
  } finally { saving.value = false; }
}

async function loadPlans(): Promise<void> {
  try { plans.value = (await getPurchasePlans()).plans; }
  catch (err) { error.value = err instanceof Error ? err.message : 'Could not load saved plans.'; }
}
async function loadOrders(): Promise<void> {
  try { orders.value = (await getPurchasePlanOrders()).orders; }
  catch (err) { error.value = err instanceof Error ? err.message : 'Could not load supplier orders.'; }
}
async function openPlan(plan: PurchasePlanSummary): Promise<void> {
  clearNotices();
  try {
    const result = await getPurchasePlan(plan.planId);
    selectedPlan.value = result.plan;
    selectedPlanItems.value = result.items.map((item) => ({ ...item, included: Boolean(item.included), isNewProduct: Boolean(item.isNewProduct) }));
  } catch (err) { error.value = err instanceof Error ? err.message : 'Could not open plan.'; }
}
async function editPlan(plan: PurchasePlanSummary): Promise<void> {
  clearNotices();
  if (plan.status !== 'Draft') { error.value = 'Only Draft purchase plans can be updated.'; return; }
  loading.value = true;
  try {
    const saved = await getPurchasePlan(plan.planId);
    params.scope = saved.plan.scope;
    params.supplierId = saved.plan.scopeSupplierId || '';
    params.salesWindowDays = Number(saved.plan.salesWindowDays || 30);
    params.targetCoverDays = Number(saved.plan.targetCoverDays || 30);
    params.budgetAmount = Number(saved.plan.budgetAmount || 0);
    params.planDate = saved.plan.planDate;
    params.notes = saved.plan.notes || '';

    const current = await analyzePurchasePlanner({
      scope: params.scope,
      supplierId: params.supplierId,
      salesWindowDays: params.salesWindowDays,
      targetCoverDays: params.targetCoverDays,
      budgetAmount: 0
    });
    suppliers.value = current.suppliers;
    const savedMap = new Map(saved.items.map((item) => [item.productId, item]));
    const merged = current.rows.map((row) => {
      const prior = savedMap.get(row.productId);
      if (!prior) return { ...row, included: false, plannedQty: 0 };
      savedMap.delete(row.productId);
      const supplierId = prior.supplierId || row.supplierId;
      return {
        ...row,
        supplierId,
        supplierName: supplierName(supplierId) || prior.supplierName || row.supplierName,
        included: Boolean(prior.included),
        plannedQty: whole(prior.plannedQty)
      };
    });
    for (const prior of savedMap.values()) {
      merged.push({ ...prior, included: Boolean(prior.included), plannedQty: whole(prior.plannedQty), isNewProduct: Boolean(prior.isNewProduct) });
    }
    rows.value = merged;
    plannerSearch.value = '';
    editingPlanId.value = saved.plan.planId;
    editingPlanNo.value = saved.plan.planNo;
    selectedPlan.value = null;
    selectedPlanItems.value = [];
    view.value = 'planner';
    announce(`Editing ${saved.plan.planNo}. Current stock and sales analysis has been refreshed; saved quantities and supplier choices were preserved.`, 'info');
  } catch (err) { error.value = err instanceof Error ? err.message : 'Could not load purchase plan for editing.'; }
  finally { loading.value = false; }
}

async function cancelEdit(): Promise<void> {
  editingPlanId.value = '';
  editingPlanNo.value = '';
  params.notes = '';
  clearNotices();
  await analyze();
}

function askPlanAction(plan: PurchasePlanSummary, mode: 'reject' | 'delete'): void {
  planActionTarget.value = plan;
  planActionMode.value = mode;
  planActionReason.value = '';
  planActionError.value = '';
  clearNotices();
}

function closePlanAction(): void {
  if (planActionSaving.value) return;
  planActionMode.value = null;
  planActionTarget.value = null;
  planActionReason.value = '';
  planActionError.value = '';
}

async function confirmPlanAction(): Promise<void> {
  if (!planActionTarget.value || !planActionMode.value) return;
  if (!planActionReason.value.trim()) { planActionError.value = `Enter a reason for ${planActionMode.value === 'reject' ? 'rejecting' : 'deleting'} this plan.`; return; }
  planActionError.value = '';
  planActionSaving.value = true;
  const target = planActionTarget.value;
  const mode = planActionMode.value;
  try {
    if (mode === 'reject') {
      await rejectPurchasePlan(target.planId, planActionReason.value.trim());
      announce(`${target.planNo} rejected. Any unconverted supplier orders from this plan were cancelled.`, 'info');
    } else {
      await deletePurchasePlan(target.planId, planActionReason.value.trim());
      announce(`${target.planNo} deleted.`);
    }
    closePlanAction();
    if (selectedPlan.value?.planId === target.planId) { selectedPlan.value = null; selectedPlanItems.value = []; }
    await Promise.all([loadPlans(), loadOrders()]);
  } catch (err) {
    planActionError.value = err instanceof Error ? err.message : `Could not ${mode} purchase plan.`;
  } finally {
    planActionSaving.value = false;
    if (!planActionError.value) closePlanAction();
  }
}
async function approve(planId: string): Promise<void> {
  clearNotices();
  approving.value = planId;
  try {
    const result = await approvePurchasePlan(planId);
    announce(`${result.orders.length} supplier purchase order(s) created. Inventory and accounting remain unchanged.`);
    await Promise.all([loadPlans(), loadOrders()]);
    if (selectedPlan.value?.planId === planId) await openPlan(plans.value.find((p) => p.planId === planId) || selectedPlan.value);
  } catch (err) { error.value = err instanceof Error ? err.message : 'Could not approve plan.'; }
  finally { approving.value = ''; }
}
async function openOrder(orderId: string): Promise<void> {
  clearNotices();
  try { selectedOrder.value = (await getPurchasePlanOrder(orderId)).order; }
  catch (err) { error.value = err instanceof Error ? err.message : 'Could not open supplier order.'; }
}
function convertOrder(orderId: string): void {
  selectedOrder.value = null;
  emit('convertOrder', orderId);
}

async function refresh(): Promise<void> {
  if (view.value === 'planner') await analyze({ preserveManual: true });
  else if (view.value === 'plans') await loadPlans();
  else await loadOrders();
}

async function addProductById(productId: string): Promise<void> {
  const previous = new Map(rows.value.map((row) => [row.productId, { supplierId: row.supplierId, included: row.included, plannedQty: row.plannedQty }]));
  await analyze();
  for (const row of rows.value) {
    const old = previous.get(row.productId);
    if (old) Object.assign(row, old, { supplierName: supplierName(old.supplierId) || row.supplierName });
  }
  const added = rows.value.find((row) => row.productId === productId);
  if (added) {
    added.included = true;
    added.plannedQty = 0;
    plannerSearch.value = added.productName;
    announce(`${added.productName} created and added. It has no invented sales history; enter the planned quantity manually.`);
  } else {
    announce('Product created. Re-run Inventory-wide planning if it is outside the current supplier scope.', 'info');
  }
}

defineExpose({ refresh, addProductById });

onMounted(async () => {
  await Promise.all([analyze(), loadPlans(), loadOrders()]);
});
</script>

<template>
  <div class="purchase-planner">
    <div class="planner-subtabs">
      <button class="btn" :class="{ 'btn-primary': view === 'planner' }" @click="view = 'planner'">Planner</button>
      <button class="btn" :class="{ 'btn-primary': view === 'plans' }" @click="view = 'plans'; loadPlans()">Saved Plans</button>
      <button class="btn" :class="{ 'btn-primary': view === 'orders' }" @click="view = 'orders'; loadOrders()">Supplier Orders</button>
    </div>

    <div v-if="message" class="success-banner planner-notice">{{ message }}</div>
    <div v-if="error" class="field-error planner-notice">{{ error }}</div>

    <template v-if="view === 'planner'">
      <div v-if="editingPlanId" class="card planner-edit-banner"><div><strong>Updating {{ editingPlanNo }}</strong><span>Only Draft plans can be changed. Saving updates the same plan number.</span></div><button class="btn btn-sm" @click="cancelEdit">Cancel Update</button></div>
      <div class="card planner-controls">
        <div class="form-grid planner-control-grid">
          <div>
            <label>Planning Scope</label>
            <select v-model="params.scope" @change="params.scope === 'ALL' && (params.supplierId = '')">
              <option value="ALL">All Inventory</option>
              <option value="SUPPLIER">Supplier-wise</option>
            </select>
          </div>
          <div v-if="params.scope === 'SUPPLIER'">
            <label>Supplier</label>
            <select v-model="params.supplierId">
              <option value="">Select supplier...</option>
              <option v-for="supplier in suppliers" :key="supplier.id" :value="supplier.id">{{ supplier.name }}</option>
            </select>
          </div>
          <div>
            <label>Sales History</label>
            <select v-model.number="params.salesWindowDays">
              <option :value="7">7 days</option><option :value="14">14 days</option><option :value="30">30 days</option><option :value="60">60 days</option><option :value="90">90 days</option>
            </select>
          </div>
          <div>
            <label>Target Stock Cover</label>
            <input v-model.number="params.targetCoverDays" type="number" min="1" max="365" step="1" data-integer="true" />
          </div>
          <div>
            <label>Purchase Budget <span class="bn-hint" style="display:inline;">— optional</span></label>
            <input v-model.number="params.budgetAmount" type="number" min="0" step="0.01" placeholder="0 = no budget" />
          </div>
          <div>
            <label>Plan Date</label>
            <input v-model="params.planDate" type="date" />
          </div>
        </div>
        <div class="planner-control-actions">
          <button class="btn btn-primary" :disabled="loading" @click="analyze()">{{ loading ? 'Analyzing...' : 'Analyze Stock' }}</button>
          <button class="btn" :disabled="loading" @click="autoFitBudget">Auto Fit Budget</button>
          <button class="btn" @click="emit('createProduct', params.scope === 'SUPPLIER' ? params.supplierId : '')">+ Add New Product</button>
        </div>
      </div>

      <div class="planner-summary-grid">
        <div class="card planner-stat"><span>Critical</span><strong>{{ totals.criticalCount }}</strong></div>
        <div class="card planner-stat"><span>High Priority</span><strong>{{ totals.highCount }}</strong></div>
        <div class="card planner-stat"><span>Planned Investment</span><strong>{{ formatMoney(totals.totalInvestment) }}</strong></div>
        <div class="card planner-stat"><span>Expected Sales</span><strong>{{ formatMoney(totals.expectedSalesValue) }}</strong></div>
        <div class="card planner-stat"><span>Expected Gross Profit</span><strong>{{ formatMoney(totals.expectedGrossProfit) }}</strong></div>
        <div class="card planner-stat"><span>Margin</span><strong>{{ formatNumber(totals.marginPercent) }}%</strong></div>
        <div v-if="totals.budgetRemaining !== null" class="card planner-stat" :class="{ 'planner-over-budget': totals.budgetRemaining < 0 }"><span>Budget Remaining</span><strong>{{ formatMoney(totals.budgetRemaining) }}</strong></div>
      </div>

      <div class="card planner-add-existing">
        <div>
          <label>Add Existing Product</label>
          <ProductSearchSelect
            v-model="manualProductId"
            :items="manualProductOptions"
            placeholder="Search any product, including zero stock..."
            aria-label="Search product to add to purchase plan"
          />
        </div>
        <button class="btn" :disabled="!manualProductId" @click="addExistingProduct">+ Add Product</button>
        <div class="planner-search-wrap"><label>Search Plan</label><input v-model="plannerSearch" type="search" placeholder="Product / supplier / priority..." /></div>
      </div>

      <div class="card planner-table-card" style="padding:0;">
        <div class="table-scroll" data-global-hscroll>
          <table class="responsive-table purchase-planner-table">
            <thead><tr>
              <th>Use</th>
              <SortableHeader table-id="purchase-planner" column="priority">Priority</SortableHeader>
              <SortableHeader table-id="purchase-planner" column="productName">Product</SortableHeader>
              <SortableHeader table-id="purchase-planner" column="supplierName">Supplier</SortableHeader>
              <SortableHeader table-id="purchase-planner" column="currentStock" type="number" class="num">Stock</SortableHeader>
              <SortableHeader table-id="purchase-planner" column="reorderLevel" type="number" class="num">Reorder</SortableHeader>
              <SortableHeader table-id="purchase-planner" column="salesVelocity" type="number" class="num">Sales/Day</SortableHeader>
              <SortableHeader table-id="purchase-planner" column="stockCoverDays" type="number" class="num">Cover Days</SortableHeader>
              <SortableHeader table-id="purchase-planner" column="pendingOrderQty" type="number" class="num">Pending PO</SortableHeader>
              <SortableHeader table-id="purchase-planner" column="lastPurchaseCost" type="number" class="num">Last Cost</SortableHeader>
              <SortableHeader table-id="purchase-planner" column="sellingPrice" type="number" class="num">Sell Price</SortableHeader>
              <SortableHeader table-id="purchase-planner" column="suggestedQty" type="number" class="num">Suggested</SortableHeader>
              <th class="num">Planned Qty</th>
              <th class="num">Investment</th>
              <th class="num">Expected Sales</th>
              <th class="num">Profit</th>
              <th class="num">Margin</th>
            </tr></thead>
            <tbody>
              <tr v-if="visibleRows.length === 0"><td colspan="17">No products match this planning scope.</td></tr>
              <tr v-for="row in $sortRows('purchase-planner', visibleRows)" :key="row.productId" :class="{ 'planner-row-excluded': !row.included }">
                <td data-label="Use"><input v-model="row.included" type="checkbox" /></td>
                <td data-label="Priority"><span class="planner-priority" :class="`priority-${row.priority.toLowerCase()}`">{{ row.priority }}</span><span v-if="row.isNewProduct" class="planner-new-badge">NEW</span></td>
                <td data-label="Product"><strong>{{ row.displayName || row.productName }}</strong><span class="bn-hint">{{ row.category }} · {{ row.unit }}</span></td>
                <td data-label="Supplier"><select v-model="row.supplierId" @change="onSupplierChange(row)"><option value="">Unassigned</option><option v-for="supplier in suppliers" :key="supplier.id" :value="supplier.id">{{ supplier.name }}</option></select></td>
                <td data-label="Stock" class="num mono">{{ formatNumber(row.currentStock, 0) }}</td>
                <td data-label="Reorder" class="num mono">{{ formatNumber(row.reorderLevel, 0) }}</td>
                <td data-label="Sales/Day" class="num mono">{{ formatNumber(row.salesVelocity) }}</td>
                <td data-label="Cover Days" class="num mono">{{ row.stockCoverDays == null ? 'No recent sales' : formatNumber(row.stockCoverDays, 1) }}</td>
                <td data-label="Pending PO" class="num mono">{{ formatNumber(row.pendingOrderQty, 0) }}</td>
                <td data-label="Last Cost" class="num mono"><span :class="{ 'planner-cost-missing': row.lastPurchaseCost <= 0 }">{{ row.lastPurchaseCost > 0 ? formatMoney(row.lastPurchaseCost) : 'Cost Required' }}</span></td>
                <td data-label="Sell Price" class="num mono">{{ formatMoney(row.sellingPrice) }}</td>
                <td data-label="Suggested" class="num mono"><strong>{{ row.suggestedQty }}</strong></td>
                <td data-label="Planned Qty" class="num"><input v-model.number="row.plannedQty" type="number" min="0" step="1" data-integer="true" @change="normalizePlannedQty(row)" /></td>
                <td data-label="Investment" class="num mono">{{ formatMoney(investment(row)) }}</td>
                <td data-label="Expected Sales" class="num mono">{{ formatMoney(salesValue(row)) }}</td>
                <td data-label="Profit" class="num mono" :class="{ negative: grossProfit(row) < 0 }">{{ formatMoney(grossProfit(row)) }}</td>
                <td data-label="Margin" class="num mono">{{ formatNumber(margin(row)) }}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card planner-save-card">
        <div style="flex:1;min-width:220px;"><label>Plan Notes</label><input v-model.trim="params.notes" type="text" placeholder="Optional planning note" /></div>
        <div v-if="totals.budgetRemaining !== null && totals.budgetRemaining < 0" class="planner-budget-warning">Plan exceeds budget by {{ formatMoney(Math.abs(totals.budgetRemaining)) }}. Quantities will not be changed automatically.</div>
        <button class="btn btn-primary btn-lg" :disabled="saving" @click="savePlan">{{ saving ? (editingPlanId ? 'Updating...' : 'Saving...') : (editingPlanId ? 'Update Purchase Plan' : 'Save Purchase Plan') }}</button>
      </div>
    </template>

    <template v-else-if="view === 'plans'">
      <div class="toolbar"><div class="section-title">Saved Purchase Plans</div></div>
      <div class="card" style="padding:0;"><div class="table-scroll"><table class="responsive-table">
        <thead><tr><SortableHeader table-id="purchase-plans" column="planNo">Plan No</SortableHeader><SortableHeader table-id="purchase-plans" column="planDate" type="date">Date</SortableHeader><SortableHeader table-id="purchase-plans" column="status">Status</SortableHeader><SortableHeader table-id="purchase-plans" column="itemCount" type="number" class="num">Items</SortableHeader><SortableHeader table-id="purchase-plans" column="totalInvestment" type="number" class="num">Investment</SortableHeader><SortableHeader table-id="purchase-plans" column="expectedGrossProfit" type="number" class="num">Expected Profit</SortableHeader><th>Actions</th></tr></thead>
        <tbody><tr v-if="plans.length === 0"><td colspan="7">No saved plans yet.</td></tr><tr v-for="plan in $sortRows('purchase-plans', plans)" :key="plan.planId"><td class="mono"><strong>{{ plan.planNo }}</strong></td><td>{{ plan.planDate }}</td><td><span class="badge" :class="plan.status === 'Rejected' ? 'badge-danger' : plan.status === 'Draft' ? 'badge-warning' : 'badge-success'">{{ plan.status }}</span></td><td class="num mono">{{ plan.itemCount }}</td><td class="num mono">{{ formatMoney(plan.totalInvestment) }}</td><td class="num mono">{{ formatMoney(plan.expectedGrossProfit) }}</td><td class="row-actions"><button class="btn btn-sm" @click="openPlan(plan)">View</button><button v-if="plan.status === 'Draft'" class="btn btn-sm" @click="editPlan(plan)">Update</button><button v-if="plan.status === 'Draft'" class="btn btn-sm btn-primary" :disabled="approving === plan.planId" @click="approve(plan.planId)">{{ approving === plan.planId ? 'Approving...' : 'Approve' }}</button><button v-if="plan.status === 'Draft' || plan.status === 'Approved'" class="btn btn-sm" @click="askPlanAction(plan, 'reject')">Reject</button><button v-if="plan.status === 'Draft' || plan.status === 'Rejected'" class="btn btn-sm btn-danger" @click="askPlanAction(plan, 'delete')">Delete</button></td></tr></tbody>
      </table></div></div>

      <div v-if="selectedPlan" class="card planner-saved-detail">
        <div class="planner-detail-head"><div><h3>{{ selectedPlan.planNo }}</h3><span class="bn-hint">{{ selectedPlan.planDate }} · {{ selectedPlan.status }}</span></div><button class="btn btn-sm" @click="selectedPlan = null; selectedPlanItems = []">Close</button></div>
        <div class="planner-summary-inline"><span>Investment <strong>{{ formatMoney(selectedPlan.totalInvestment) }}</strong></span><span>Expected Sales <strong>{{ formatMoney(selectedPlan.expectedSalesValue) }}</strong></span><span>Profit <strong>{{ formatMoney(selectedPlan.expectedGrossProfit) }}</strong></span><span>Margin <strong>{{ formatNumber(selectedPlan.marginPercent) }}%</strong></span></div>
        <div v-if="selectedPlan.status === 'Rejected' && selectedPlan.rejectionReason" class="planner-rejection-note"><strong>Rejected:</strong> {{ selectedPlan.rejectionReason }}</div>
        <div v-for="group in selectedPlanGroups" :key="group.supplierName" class="planner-supplier-group">
          <h4>{{ group.supplierName }}</h4>
          <div class="table-scroll"><table><thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Cost</th><th class="num">Investment</th></tr></thead><tbody><tr v-for="item in group.items" :key="item.productId"><td>{{ item.productName }}</td><td class="num mono">{{ item.plannedQty }}</td><td class="num mono">{{ formatMoney(item.lastPurchaseCost) }}</td><td class="num mono">{{ formatMoney(item.plannedInvestment) }}</td></tr></tbody></table></div>
        </div>
        <div class="planner-detail-actions"><button v-if="selectedPlan.status === 'Draft'" class="btn" @click="editPlan(selectedPlan)">Update Plan</button><button v-if="selectedPlan.status === 'Draft'" class="btn btn-primary" :disabled="approving === selectedPlan.planId" @click="approve(selectedPlan.planId)">Approve & Create Supplier Orders</button><button v-if="selectedPlan.status === 'Draft' || selectedPlan.status === 'Approved'" class="btn" @click="askPlanAction(selectedPlan, 'reject')">Reject Plan</button><button v-if="selectedPlan.status === 'Draft' || selectedPlan.status === 'Rejected'" class="btn btn-danger" @click="askPlanAction(selectedPlan, 'delete')">Delete Plan</button></div>
      </div>
    </template>

    <template v-else>
      <div class="toolbar"><div class="section-title">Supplier Purchase Orders</div></div>
      <div class="card" style="padding:0;"><div class="table-scroll"><table class="responsive-table">
        <thead><tr><SortableHeader table-id="purchase-plan-orders" column="orderNo">Order No</SortableHeader><SortableHeader table-id="purchase-plan-orders" column="orderDate" type="date">Date</SortableHeader><SortableHeader table-id="purchase-plan-orders" column="supplierName">Supplier</SortableHeader><SortableHeader table-id="purchase-plan-orders" column="itemCount" type="number" class="num">Items</SortableHeader><SortableHeader table-id="purchase-plan-orders" column="totalQty" type="number" class="num">Qty</SortableHeader><SortableHeader table-id="purchase-plan-orders" column="status">Status</SortableHeader><th>Purchase</th><th>Actions</th></tr></thead>
        <tbody><tr v-if="orders.length === 0"><td colspan="8">No supplier orders yet.</td></tr><tr v-for="order in $sortRows('purchase-plan-orders', orders)" :key="order.orderId"><td class="mono"><strong>{{ order.orderNo }}</strong></td><td>{{ order.orderDate }}</td><td>{{ order.supplierName }}</td><td class="num mono">{{ order.itemCount }}</td><td class="num mono">{{ order.totalQty }}</td><td><span class="badge" :class="order.status === 'Open' ? 'badge-warning' : order.status === 'Cancelled' ? 'badge-danger' : 'badge-success'">{{ order.status }}</span></td><td class="mono">{{ order.convertedPurchaseId || '—' }}</td><td class="row-actions"><button class="btn btn-sm" @click="openOrder(order.orderId)">View / Output</button><button v-if="order.status === 'Open'" class="btn btn-sm btn-primary" @click="emit('convertOrder', order.orderId)">Convert</button></td></tr></tbody>
      </table></div></div>
    </template>

    <Teleport to="body">
      <div v-if="planActionMode && planActionTarget" class="modal-overlay" @click.self="closePlanAction">
        <div class="modal modal-sm">
          <div class="modal-header"><h3>{{ planActionMode === 'reject' ? 'Reject Purchase Plan' : 'Delete Purchase Plan' }}</h3><button class="modal-close" @click="closePlanAction">×</button></div>
          <div class="modal-body">
            <p><strong>{{ planActionTarget.planNo }}</strong> · {{ planActionTarget.status }}</p>
            <p v-if="planActionMode === 'reject' && planActionTarget.status === 'Approved'" class="bn-hint">Rejecting an approved plan cancels its unconverted Supplier Purchase Orders. A plan with any converted Purchase cannot be rejected.</p>
            <p v-if="planActionMode === 'delete'" class="bn-hint">Only Draft or Rejected plans can be deleted. Plans linked to an actual Purchase are protected.</p>
            <label>Reason *</label>
            <textarea v-model.trim="planActionReason" rows="3" :placeholder="planActionMode === 'reject' ? 'Why is this plan being rejected?' : 'Why is this plan being deleted?'"></textarea>
            <div v-if="planActionError" class="field-error">{{ planActionError }}</div>
          </div>
          <div class="modal-footer"><button class="btn" :disabled="planActionSaving" @click="closePlanAction">Cancel</button><button class="btn btn-danger" :disabled="planActionSaving" @click="confirmPlanAction">{{ planActionSaving ? 'Please wait...' : (planActionMode === 'reject' ? 'Reject Plan' : 'Delete Plan') }}</button></div>
        </div>
      </div>
    </Teleport>

    <SupplierPurchaseOrderView v-if="selectedOrder" :order="selectedOrder" @close="selectedOrder = null" @convert="convertOrder" />
  </div>
</template>

<style scoped>
.purchase-planner{display:grid;gap:14px}.planner-edit-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;border-color:#f59e0b}.planner-edit-banner>div{display:grid;gap:3px}.planner-edit-banner span{font-size:12px;color:var(--color-text-muted)}.planner-subtabs{display:flex;gap:8px;flex-wrap:wrap}.planner-notice{margin:0}.planner-controls{display:grid;gap:14px}.planner-control-grid{grid-template-columns:repeat(3,minmax(160px,1fr))}.planner-control-actions{display:flex;gap:8px;flex-wrap:wrap}.planner-summary-grid{display:grid;grid-template-columns:repeat(6,minmax(140px,1fr));gap:10px}.planner-stat{padding:14px;display:grid;gap:5px}.planner-stat span{font-size:12px;color:var(--color-text-muted)}.planner-stat strong{font-size:18px}.planner-over-budget{border-color:#dc2626}.planner-over-budget strong{color:#dc2626}.planner-add-existing{display:flex;align-items:end;gap:10px;flex-wrap:wrap}.planner-add-existing>div{min-width:240px;flex:1}.planner-search-wrap{margin-left:auto}.purchase-planner-table{min-width:1900px}.purchase-planner-table select{min-width:160px}.purchase-planner-table input[type=number]{width:86px;text-align:right}.purchase-planner-table input[type=checkbox]{width:18px;height:18px}.planner-row-excluded{opacity:.58}.planner-priority{display:inline-flex;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:800}.priority-critical{background:#fee2e2;color:#991b1b}.priority-high{background:#ffedd5;color:#9a3412}.priority-medium{background:#fef3c7;color:#92400e}.priority-low{background:#e2e8f0;color:#475569}.planner-new-badge{display:inline-flex;margin-left:5px;padding:2px 5px;border-radius:5px;font-size:9px;font-weight:800;background:#dbeafe;color:#1d4ed8}.planner-cost-missing,.negative{color:#dc2626;font-weight:700}.planner-save-card{display:flex;gap:12px;align-items:end;flex-wrap:wrap}.planner-budget-warning{color:#b91c1c;font-size:12px;max-width:360px}.planner-detail-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.planner-detail-head h3{margin:0}.planner-rejection-note{margin-top:10px;padding:10px 12px;border-radius:8px;background:#fee2e2;color:#991b1b}.planner-detail-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:12px}.planner-summary-inline{display:flex;gap:18px;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--color-border)}.planner-supplier-group{margin-top:16px}.planner-supplier-group h4{margin:0 0 8px}@media(max-width:1100px){.planner-control-grid{grid-template-columns:repeat(2,minmax(160px,1fr))}.planner-summary-grid{grid-template-columns:repeat(3,minmax(140px,1fr))}}@media(max-width:680px){.planner-control-grid{grid-template-columns:1fr}.planner-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.planner-save-card>.btn{width:100%}.planner-add-existing>*{width:100%}.planner-add-existing>div{min-width:0}.planner-search-wrap{margin-left:0}}
</style>
