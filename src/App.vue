<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { notifySuccess, notifyError } from './utils/notify';
const PosPanel = defineAsyncComponent(() => import('./components/PosPanel.vue'));
const SalesPanel = defineAsyncComponent(() => import('./components/SalesPanel.vue'));
const CustomersPanel = defineAsyncComponent(() => import('./components/CustomersPanel.vue'));
const ExpensesPanel = defineAsyncComponent(() => import('./components/ExpensesPanel.vue'));
const BankPanel = defineAsyncComponent(() => import('./components/BankPanel.vue'));
const DayBookPanel = defineAsyncComponent(() => import('./components/DayBookPanel.vue'));
const FinancePanel = defineAsyncComponent(() => import('./components/FinancePanel.vue'));
const DashboardPanel = defineAsyncComponent(() => import('./components/DashboardPanel.vue'));
const ReportsPanel = defineAsyncComponent(() => import('./components/ReportsPanel.vue'));
const SettingsPanel = defineAsyncComponent(() => import('./components/SettingsPanel.vue'));
const VendorPanel = defineAsyncComponent(() => import('./components/VendorPanel.vue'));
const PurchasePlannerPanel = defineAsyncComponent(() => import('./components/PurchasePlannerPanel.vue'));
const ProductTrackingPanel = defineAsyncComponent(() => import('./components/ProductTrackingPanel.vue'));
import AppShell from './components/shell/AppShell.vue';
import GlobalToast from './components/shell/GlobalToast.vue';
import LedgerHistoryControls from './components/LedgerHistoryControls.vue';
import AppSelect from './components/ui/AppSelect.vue';
import AppDatePicker from './components/ui/AppDatePicker.vue';
import ProductSearchSelect from './components/ui/ProductSearchSelect.vue';
import ProductTrackingEntry from './components/ui/ProductTrackingEntry.vue';
import type { ShellNavItem } from './components/shell/types';
import {
  addProductCategory,
  addProductBrand,
  addProductUnit,
  getProductCategories,
  getProductBrands,
  getProductUnits,
  updateProductCategory,
  updateProductBrand,
  updateProductUnit,
  addSupplier,
  adjustStock,
  createProduct,
  createPurchase,
  completePurchaseReturn,
  deletePurchase as deletePurchaseApi,
  deleteProduct,
  getBootstrap,
  getMe,
  getProductLots,
  getPurchaseDetail,
  getPurchaseForReturn,
  getPurchaseReturns,
  getPurchases,
  getPurchasePlanOrderConvertData,
  getSetupStatus,
  login,
  logout as logoutApi,
  setToken,
  setupAdmin,
  setProductCategoryStatus,
  setProductBrandStatus,
  setProductStatus,
  setProductUnitStatus,
  updateProduct,
  updatePurchase,
  getSuppliersPage,
  createSupplierFull,
  updateSupplierFull,
  getSupplierDetail,
  setSupplierStatus as setSupplierStatusApi,
  deleteSupplier as deleteSupplierApi,
  paySupplier,
  getSupplierPaymentForEdit,
  updateSupplierPayment,
  deleteSupplierPayment
} from './api';
import type { AuthUser, BankAccount, LookupItem, Product, ProductForm, StockLot, Purchase, PurchaseReturnData, PurchaseReturnRecord, Supplier, SupplierDetail, SupplierForm, SupplierLedgerRow, PosLoadRequest, DayBookOpenSource, DayBookSourceAction, LotTrackingInput } from './types';
import { exportRowsToCsv, printRows } from './utils/tableOutput';
import { ensureTableSort, getTableSortState, setTableSort, sortRows } from './utils/tableSorting';
import { createProductSearchIndex, searchProductIndex } from './utils/productSearch';
import { useLedgerHistory } from './composables/useLedgerHistory';

type ModuleKey = 'dashboard' | 'products' | 'tracking' | 'purchase' | 'suppliers' | 'vendors' | 'customers' | 'pos' | 'sales' | 'expense' | 'bank' | 'daybook' | 'finance' | 'reports' | 'settings';
type RefreshablePanel = { refresh: () => Promise<void> | void };
type ModalName = '' | 'product' | 'stock' | 'lots' | 'manage' | 'purchase' | 'purchase-delete' | 'supplier' | 'supplier-detail' | 'supplier-payment-edit' | 'supplier-delete' | 'supplier-payment-delete';
type ManageMode = 'category' | 'brand' | 'unit';

const activeModule = ref<ModuleKey>('dashboard');
const globalRefreshing = ref(false);
const dashboardPanel = ref<RefreshablePanel | null>(null);
const vendorPanel = ref<RefreshablePanel | null>(null);
const customersPanel = ref<RefreshablePanel | null>(null);
const posPanel = ref<RefreshablePanel | null>(null);
const salesPanel = ref<RefreshablePanel | null>(null);
const expensesPanel = ref<RefreshablePanel | null>(null);
const bankPanel = ref<RefreshablePanel | null>(null);
const reportsPanel = ref<RefreshablePanel | null>(null);
const daybookPanel = ref<RefreshablePanel | null>(null);
const financePanel = ref<RefreshablePanel | null>(null);
const settingsPanel = ref<RefreshablePanel | null>(null);
const productTrackingPanel = ref<RefreshablePanel | null>(null);
const purchasePlannerPanel = ref<{ refresh: () => Promise<void> | void; addProductById: (productId: string) => Promise<void> | void } | null>(null);
const salesOpenRequest = ref<{ invoiceId?: string; returnId?: string; tab: 'sales' | 'newReturn' | 'returnHistory'; action?: 'open' | 'edit' | 'delete' | 'return' | 'receive-payment'; nonce: number } | null>(null);
const customerOpenRequest = ref<{ customerId: string; ledgerId?: string; action?: 'open' | 'edit-payment' | 'delete-payment'; nonce: number } | null>(null);
const expenseOpenRequest = ref<{ expenseId: string; action: 'view' | 'edit' | 'cancel'; nonce: number } | null>(null);
const bankOpenRequest = ref<{ tab?: 'accounts' | 'ledger' | 'manual' | 'transfers'; accountId?: string; entryId?: string; date?: string; action?: 'open' | 'reverse'; nonce: number } | null>(null);
const financeOpenRequest = ref<{ tab?: 'entry' | 'ledger'; financeId?: string; date?: string; action?: 'view' | 'edit' | 'delete'; nonce: number } | null>(null);
const posLoadRequest = ref<PosLoadRequest | null>(null);
const sidebarOpen = ref(false);
const actionMenu = ref<{
  type: 'product' | 'purchase' | 'supplier' | 'supplier-ledger';
  product?: Product;
  purchase?: Purchase;
  supplier?: Supplier;
  supplierLedgerRow?: SupplierLedgerRow;
  top: number;
  left: number;
  width: number;
} | null>(null);
const products = ref<Product[]>([]);
const purchases = ref<Purchase[]>([]);
const purchaseReturns = ref<PurchaseReturnRecord[]>([]);
const suppliers = ref<Supplier[]>([]);
const bankAccounts = ref<BankAccount[]>([]);
const categories = ref<LookupItem[]>([]);
const brands = ref<LookupItem[]>([]);
const units = ref<LookupItem[]>([]);
type ProductLookupManageItem = LookupItem & { status: 'Active' | 'Inactive' };
const productSubtab = ref<'products' | 'lookups'>('products');
const categoryManageItems = ref<ProductLookupManageItem[]>([]);
const brandManageItems = ref<ProductLookupManageItem[]>([]);
const unitManageItems = ref<ProductLookupManageItem[]>([]);
const lookupManageLoading = ref(false);
const categoryManageName = ref('');
const brandManageName = ref('');
const unitManageName = ref('');
const categoryManageSearch = ref('');
const brandManageSearch = ref('');
const unitManageSearch = ref('');
const lookupManageModal = ref<{ kind: ManageMode; mode: 'add' | 'edit'; item: ProductLookupManageItem | null } | null>(null);
const lookupSectionAddMode = ref<ManageMode | null>(null);
const lookupEditingId = ref<string | null>(null);
const lookupEditingKind = ref<ManageMode | null>(null);
const lookupEditingName = ref('');
const quickLookupMode = ref<ManageMode | null>(null);
const quickLookupName = ref('');
const quickLookupSaving = ref(false);
const loading = ref(false);
const saving = ref(false);
const message = ref('');
const error = ref('');
const search = ref('');
const categoryFilter = ref('');
const brandFilter = ref('');
const stockFilter = ref('');
const statusFilter = ref('');
ensureTableSort('products', 'productName', 'asc', 'text');
const productSort = computed({
  get: () => {
    const state = getTableSortState('products');
    if (!state) return 'name-asc';
    if (state.column === 'productName') return `name-${state.direction}`;
    if (state.column === 'brand') return `brand-${state.direction}`;
    if (state.column === 'category') return `category-${state.direction}`;
    if (state.column === 'status') return `status-${state.direction}`;
    if (state.column === 'currentStock') return `stock-${state.direction}`;
    if (state.column === 'stockValue') return `value-${state.direction}`;
    if (state.column === 'purchasePrice') return `purchase-${state.direction}`;
    if (state.column === 'sellingPrice') return `selling-${state.direction}`;
    return 'name-asc';
  },
  set: (value: string) => {
    const map: Record<string, [string, 'asc' | 'desc', 'text' | 'number']> = {
      'name-asc': ['productName', 'asc', 'text'],
      'name-desc': ['productName', 'desc', 'text'],
      'brand-asc': ['brand', 'asc', 'text'],
      'brand-desc': ['brand', 'desc', 'text'],
      'category-asc': ['category', 'asc', 'text'],
      'category-desc': ['category', 'desc', 'text'],
      'status-asc': ['status', 'asc', 'text'],
      'status-desc': ['status', 'desc', 'text'],
      'stock-asc': ['currentStock', 'asc', 'number'],
      'stock-desc': ['currentStock', 'desc', 'number'],
      'value-asc': ['stockValue', 'asc', 'number'],
      'value-desc': ['stockValue', 'desc', 'number'],
      'purchase-asc': ['purchasePrice', 'asc', 'number'],
      'purchase-desc': ['purchasePrice', 'desc', 'number'],
      'selling-asc': ['sellingPrice', 'asc', 'number'],
      'selling-desc': ['sellingPrice', 'desc', 'number']
    };
    const next = map[value] || map['name-asc'];
    setTableSort('products', next[0], next[1], next[2]);
  }
});
const modal = ref<ModalName>('');
const editingId = ref<string | null>(null);
const stockProduct = ref<Product | null>(null);
const lotsProduct = ref<Product | null>(null);
const lots = ref<StockLot[]>([]);
const manageMode = ref<ManageMode>('category');
const manageNewName = ref('');
const manageError = ref('');
const stockDelta = ref<number | null>(null);
const stockNote = ref('');
const formError = ref('');
const stockError = ref('');

const authReady = ref(false);
const authUser = ref<AuthUser | null>(null);
const setupRequired = ref(false);
const authSaving = ref(false);
const authError = ref('');
const loginForm = reactive({ phone: '', password: '' });
const setupForm = reactive({ fullName: 'Admin', phone: '', password: '' });
const setupSecret = ref('');

const todayIso = new Date().toISOString().slice(0, 10);
const purchaseTab = ref<'new' | 'planner' | 'history' | 'return'>('new');
const purchaseSearch = ref('');
const purchaseProductPicker = ref('');
const purchaseCategoryFilter = ref('');
const quickSupplierVisible = ref(false);
const quickSupplierName = ref('');
const purchaseForm = reactive({
  supplierId: '',
  purchasePlanOrderId: '',
  date: todayIso,
  backdatedReason: '',
  discount: 0,
  paidAmount: 0,
  notes: '',
  paymentMethod: 'Cash',
  bankAccountId: '',
  items: [] as Array<{ productId: string; productName: string; qty: number; unitPrice: number; sellingPrice: number | null; tracking: LotTrackingInput }>
});
const purchaseError = ref('');
const plannerProductCreatePending = ref(false);
const purchaseSaving = ref(false);
const purchaseTrackingOpenIndex = ref<number | null>(null);
const selectedPurchase = ref<Purchase | null>(null);
const purchaseEditId = ref<string | null>(null);
const purchaseUpdateReason = ref('');
const purchaseDeleteTarget = ref<Purchase | null>(null);
const purchaseDeleteFromSupplierLedger = ref(false);
const purchaseDeleteReason = ref('');
const returnPurchaseId = ref('');
const returnData = ref<PurchaseReturnData | null>(null);
const returnDate = ref(todayIso);
const returnBackdatedReason = ref('');
const returnRefundMethod = ref<'Cash' | 'Supplier Credit'>('Supplier Credit');
const returnReason = ref('');
const returnNotes = ref('');
const returnError = ref('');
const returnSaving = ref(false);
const supplierSearch = ref('');
const supplierActiveCashSession = ref(false);
const supplierEditingId = ref<string | null>(null);
const supplierDetail = ref<SupplierDetail | null>(null);
const { filters: supplierLedgerFilters } = useLedgerHistory();
const supplierFormError = ref('');
const supplierPaymentError = ref('');
const supplierDeleteTarget = ref<Supplier | null>(null);
const supplierDeleteReason = ref('');
const supplierPaymentDeleteTarget = ref<SupplierLedgerRow | null>(null);
const supplierPaymentDeleteReason = ref('');
const supplierEditingPaymentId = ref<string | null>(null);
const supplierForm = reactive<SupplierForm>({ name: '', phone: '', address: '', openingBalance: 0, notes: '' });
const supplierPaymentForm = reactive({ amount: 0, method: 'Cash', bankAccountId: '', notes: '', date: todayIso, backdatedReason: '' });


const emptyForm: ProductForm = {
  productName: '',
  brand: '',
  category: '',
  unit: '',
  barcode: '',
  purchasePrice: 0,
  sellingPrice: 0,
  currentStock: 0,
  minimumStock: 5,
  preferredSupplierId: '',
  status: 'Active',
  trackSerial: false,
  trackExpiry: false,
  trackWarranty: false,
  warrantyPeriodValue: 12,
  warrantyPeriodUnit: 'Months',
  openingTracking: {},
  stockTracking: {}
};

const form = reactive<ProductForm>({ ...emptyForm });

const categoryNames = computed(() => categories.value.map((c) => c.name));
const categorySelectOptions = computed(() => [{ label: 'No category', value: '' }, ...categoryNames.value.map((name) => ({ label: name, value: name }))]);
const brandNames = computed(() => brands.value.map((b) => b.name));
const brandSelectOptions = computed(() => [{ label: 'No brand', value: '' }, ...brandNames.value.map((name) => ({ label: name, value: name }))]);
const filteredCategoryManageItems = computed(() => {
  const q = categoryManageSearch.value.trim().toLowerCase();
  return q ? categoryManageItems.value.filter((item) => item.name.toLowerCase().includes(q)) : categoryManageItems.value;
});
const filteredBrandManageItems = computed(() => {
  const q = brandManageSearch.value.trim().toLowerCase();
  return q ? brandManageItems.value.filter((item) => item.name.toLowerCase().includes(q)) : brandManageItems.value;
});
const filteredUnitManageItems = computed(() => {
  const q = unitManageSearch.value.trim().toLowerCase();
  return q ? unitManageItems.value.filter((item) => item.name.toLowerCase().includes(q)) : unitManageItems.value;
});
const unitNames = computed(() => units.value.map((u) => u.name));
const unitSelectOptions = computed(() => [{ label: 'No unit', value: '' }, ...unitNames.value.map((name) => ({ label: name, value: name }))]);

function openModal(name: ModalName): void {
  modal.value = name;
}

function closeModal(): void {
  modal.value = '';
  formError.value = '';
  stockError.value = '';
  manageError.value = '';
}



function canViewModule(key: string): boolean {
  if (!authUser.value) return false;
  if (authUser.value.role === 'admin') return true;
  return !!authUser.value.allowedModules?.includes(key);
}
function canOpenSettings(): boolean {
  return canViewModule('settings') || canViewModule('users') || canViewModule('roles');
}

function ensureAllowedModule(): void {
  if (!authUser.value || authUser.value.role === 'admin') return;
  const currentKey = activeModule.value === 'settings' ? 'settings' : activeModule.value;
  if ((currentKey === 'sales' && (canViewModule('sales') || canViewModule('returns'))) ||
      (currentKey === 'settings' && canOpenSettings()) ||
      (currentKey === 'tracking' && canViewModule('products')) ||
      canViewModule(currentKey)) return;
  const candidates = ['dashboard','pos','sales','purchase','suppliers','vendors','products','tracking','customers','bank','expense','finance','daybook','reports','settings'] as const;
  const next = candidates.find(k => k === 'sales' ? (canViewModule('sales') || canViewModule('returns')) : k === 'settings' ? canOpenSettings() : k === 'tracking' ? canViewModule('products') : canViewModule(k));
  if (next) activeModule.value = next;
}

function switchModule(module: ModuleKey): void {
  activeModule.value = module;
  sidebarOpen.value = false;
}

function openSaleInPos(request: PosLoadRequest): void {
  posLoadRequest.value = request;
  activeModule.value = 'pos';
  sidebarOpen.value = false;
}

function positionActionMenu(button: HTMLElement, menuWidth = 190): { top: number; left: number; width: number } {
  const rect = button.getBoundingClientRect();
  const viewportGap = 10;
  const width = Math.max(menuWidth, rect.width);
  let left = rect.left;
  if (left + width > window.innerWidth - viewportGap) {
    left = Math.max(viewportGap, window.innerWidth - width - viewportGap);
  }
  return { top: rect.bottom + 6, left, width };
}

function openProductActions(event: MouseEvent, product: Product): void {
  event.stopPropagation();
  const button = event.currentTarget as HTMLElement;
  if (actionMenu.value?.type === 'product' && actionMenu.value.product?.productId === product.productId) {
    actionMenu.value = null;
    return;
  }
  actionMenu.value = { type: 'product', product, ...positionActionMenu(button) };
}

function openPurchaseActions(event: MouseEvent, purchase: Purchase): void {
  event.stopPropagation();
  const button = event.currentTarget as HTMLElement;
  if (actionMenu.value?.type === 'purchase' && actionMenu.value.purchase?.purchaseId === purchase.purchaseId) {
    actionMenu.value = null;
    return;
  }
  actionMenu.value = { type: 'purchase', purchase, ...positionActionMenu(button) };
}

function openSupplierActions(event: MouseEvent, supplier: Supplier): void {
  event.stopPropagation();
  const button = event.currentTarget as HTMLElement;
  if (actionMenu.value?.type === 'supplier' && actionMenu.value.supplier?.id === supplier.id) {
    actionMenu.value = null;
    return;
  }
  actionMenu.value = { type: 'supplier', supplier, ...positionActionMenu(button) };
}

function openSupplierLedgerActions(event: MouseEvent, row: SupplierLedgerRow): void {
  event.stopPropagation();
  const button = event.currentTarget as HTMLElement;
  if (actionMenu.value?.type === 'supplier-ledger' && actionMenu.value.supplierLedgerRow?.ledgerId === row.ledgerId) {
    actionMenu.value = null;
    return;
  }
  actionMenu.value = { type: 'supplier-ledger', supplierLedgerRow: row, ...positionActionMenu(button) };
}

function closeActionMenu(): void {
  actionMenu.value = null;
}

function runAction(run: () => void | Promise<void>): void {
  const result = run();
  closeActionMenu();
  void result;
}

function handleGlobalPointer(event: Event): void {
  const target = event.target as HTMLElement | null;
  if (!target?.closest('.action-dropdown, .action-trigger')) closeActionMenu();
}

function handleViewportChange(): void {
  closeActionMenu();
}

function showSuccess(text: string): void {
  message.value = '';
  error.value = '';
  notifySuccess(text);
}

function showError(text: string): void {
  error.value = text;
  message.value = '';
  notifyError(text);
}

function formatMoney(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatQty(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatDateShort(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value || '');
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function resetFormForAdd(): void {
  quickLookupMode.value = null;
  quickLookupName.value = '';
  editingId.value = null;
  Object.assign(form, { ...emptyForm });
  formError.value = '';
}

function openAddProduct(): void {
  plannerProductCreatePending.value = false;
  resetFormForAdd();
  openModal('product');
}

function openAddProductFromPlanner(preferredSupplierId = ''): void {
  plannerProductCreatePending.value = true;
  resetFormForAdd();
  // A newly planned product has no proven demand yet. Do not make it Critical
  // merely because the normal Product form defaults minimum stock to 5.
  form.minimumStock = 0;
  form.currentStock = 0;
  form.preferredSupplierId = preferredSupplierId || '';
  openModal('product');
}

function openEditProduct(product: Product): void {
  quickLookupMode.value = null;
  quickLookupName.value = '';
  editingId.value = product.productId;
  Object.assign(form, {
    productId: product.productId,
    productName: product.productName,
    brand: product.brand || '',
    category: product.category || '',
    unit: product.unit || '',
    barcode: product.barcode || '',
    purchasePrice: Number(product.purchasePrice || 0),
    sellingPrice: Number(product.sellingPrice || 0),
    currentStock: Math.max(0, Math.round(Number(product.currentStock || 0))),
    minimumStock: Math.max(0, Math.round(Number(product.minimumStock || 0))),
    preferredSupplierId: product.preferredSupplierId || '',
    status: product.status,
    trackSerial: !!product.trackSerial,
    trackExpiry: !!product.trackExpiry,
    trackWarranty: !!product.trackWarranty,
    warrantyPeriodValue: Math.max(0, Math.round(Number(product.warrantyPeriodValue || 0))),
    warrantyPeriodUnit: product.warrantyPeriodUnit || 'Months',
    openingTracking: {},
    stockTracking: {}
  });
  formError.value = '';
  openModal('product');
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await getBootstrap();
    products.value = data.products;
    categories.value = data.categories;
    brands.value = data.brands;
    units.value = data.units;
    suppliers.value = data.suppliers;
    bankAccounts.value = data.bankAccounts;
    const purchaseData = await getPurchases().catch(() => ({ ok: true as const, purchases: [] }));
    purchases.value = purchaseData.purchases;
    const returnDataList = await getPurchaseReturns().catch(() => ({ ok: true as const, returns: [] }));
    purchaseReturns.value = returnDataList.returns;
    const supplierData = await getSuppliersPage().catch(() => null);
    if (supplierData) {
      suppliers.value = supplierData.suppliers;
      bankAccounts.value = supplierData.bankAccounts;
      supplierActiveCashSession.value = supplierData.activeCashSession;
    }
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Failed to load products');
  } finally {
    loading.value = false;
  }
}

async function refreshActiveModule(): Promise<void> {
  if (globalRefreshing.value) return;
  globalRefreshing.value = true;
  error.value = '';
  try {
    const panelByModule: Partial<Record<ModuleKey, RefreshablePanel | null>> = {
      dashboard: dashboardPanel.value,
      vendors: vendorPanel.value,
      customers: customersPanel.value,
      pos: posPanel.value,
      sales: salesPanel.value,
      expense: expensesPanel.value,
      bank: bankPanel.value,
      reports: reportsPanel.value,
      daybook: daybookPanel.value,
      finance: financePanel.value,
      settings: settingsPanel.value,
      tracking: productTrackingPanel.value
    };

    const panel = panelByModule[activeModule.value];
    if (panel?.refresh) {
      await panel.refresh();
    } else if (activeModule.value === 'purchase' && purchaseTab.value === 'planner') {
      await purchasePlannerPanel.value?.refresh();
    } else if (activeModule.value === 'products' || activeModule.value === 'purchase' || activeModule.value === 'suppliers') {
      // These legacy pages still live directly in App.vue and share bootstrap state.
      await load();
    } else {
      showError('Nothing to refresh on this page.');
      return;
    }
    showSuccess('Refreshed.');
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Could not refresh this page.');
  } finally {
    globalRefreshing.value = false;
  }
}

async function saveProduct(): Promise<void> {
  saving.value = true;
  formError.value = '';
  try {
    const payload: ProductForm = {
      ...form,
      purchasePrice: Number(form.purchasePrice || 0),
      sellingPrice: Number(form.sellingPrice || 0),
      currentStock: Math.max(0, Math.round(Number(form.currentStock || 0))),
      minimumStock: Math.max(0, Math.round(Number(form.minimumStock || 0))),
      preferredSupplierId: String(form.preferredSupplierId || ''),
      barcode: String(form.barcode || '').trim(),
    };
    let createdProductId = '';
    if (editingId.value) {
      await updateProduct(editingId.value, payload);
    } else {
      const result = await createProduct(payload);
      createdProductId = result.productId;
    }
    const returnToPlanner = plannerProductCreatePending.value && Boolean(createdProductId);
    plannerProductCreatePending.value = false;
    closeModal();
    showSuccess('Product saved');
    await load();
    if (returnToPlanner && createdProductId) {
      purchaseTab.value = 'planner';
      await purchasePlannerPanel.value?.addProductById(createdProductId);
    }
  } catch (err) {
    formError.value = err instanceof Error ? err.message : 'Save failed';
  } finally {
    saving.value = false;
  }
}

function openStock(product: Product): void {
  stockProduct.value = product;
  stockDelta.value = null;
  stockNote.value = '';
  stockError.value = '';
  openModal('stock');
}

async function saveStockAdjustment(): Promise<void> {
  if (!stockProduct.value) return;
  stockError.value = '';
  const delta = Math.round(Number(stockDelta.value || 0));
  if (!Number.isFinite(delta) || delta === 0) {
    stockError.value = 'Enter a positive or negative stock adjustment.';
    return;
  }
  try {
    await adjustStock(stockProduct.value.productId, delta, stockNote.value.trim());
    closeModal();
    showSuccess('Stock updated');
    await load();
  } catch (err) {
    stockError.value = err instanceof Error ? err.message : 'Stock update failed';
  }
}

async function openLots(product: Product): Promise<void> {
  lotsProduct.value = product;
  lots.value = [];
  try {
    const data = await getProductLots(product.productId);
    lots.value = data.lots;
    openModal('lots');
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Could not load lots');
  }
}

async function toggleStatus(product: Product): Promise<void> {
  const next = product.status === 'Active' ? 'Inactive' : 'Active';
  if (!confirm(`${next === 'Inactive' ? 'Deactivate' : 'Activate'} "${product.productName}"?`)) return;
  try {
    await setProductStatus(product.productId, next);
    showSuccess(`Product ${next.toLowerCase()}`);
    await load();
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Status update failed');
  }
}

async function removeProduct(product: Product): Promise<void> {
  if (!confirm(`Delete product "${product.productName}"?`)) return;
  try {
    await deleteProduct(product.productId);
    showSuccess('Product deleted');
    await load();
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Delete failed');
  }
}

function openManage(mode: ManageMode): void {
  manageMode.value = mode;
  manageNewName.value = '';
  manageError.value = '';
  openModal('manage');
}

const manageItems = computed(() => manageMode.value === 'category' ? categories.value : manageMode.value === 'brand' ? brands.value : units.value);

async function addLookup(): Promise<void> {
  const name = manageNewName.value.trim();
  manageError.value = '';
  if (!name) return;
  try {
    if (manageMode.value === 'category') {
      const item = await addProductCategory(name);
      categories.value.push({ id: item.id, name: item.name });
    } else if (manageMode.value === 'brand') {
      const item = await addProductBrand(name);
      brands.value.push({ id: item.id, name: item.name });
    } else {
      const item = await addProductUnit(name);
      units.value.push({ id: item.id, name: item.name });
    }
    manageNewName.value = '';
    showSuccess(`${manageMode.value === 'category' ? 'Category' : manageMode.value === 'brand' ? 'Brand' : 'Unit'} added`);
  } catch (err) {
    manageError.value = err instanceof Error ? err.message : 'Add failed';
  }
}

async function removeLookup(item: LookupItem): Promise<void> {
  if (!confirm(`Remove "${item.name}" from the ${manageMode.value} list? Products already using it keep their current value.`)) return;
  try {
    if (manageMode.value === 'category') {
      await setProductCategoryStatus(item.id, 'Inactive');
      categories.value = categories.value.filter((c) => c.id !== item.id);
    } else if (manageMode.value === 'brand') {
      await setProductBrandStatus(item.id, 'Inactive');
      brands.value = brands.value.filter((b) => b.id !== item.id);
    } else {
      await setProductUnitStatus(item.id, 'Inactive');
      units.value = units.value.filter((u) => u.id !== item.id);
    }
    showSuccess(`${manageMode.value === 'category' ? 'Category' : manageMode.value === 'brand' ? 'Brand' : 'Unit'} removed`);
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Remove failed');
  }
}

async function loadProductLookupManagement(): Promise<void> {
  lookupManageLoading.value = true;
  try {
    const [categoryData, brandData, unitData] = await Promise.all([getProductCategories(), getProductBrands(), getProductUnits()]);
    categoryManageItems.value = categoryData.items;
    brandManageItems.value = brandData.items;
    unitManageItems.value = unitData.items;
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Could not load categories, brands and units.');
  } finally {
    lookupManageLoading.value = false;
  }
}

async function setProductSubtab(tab: 'products' | 'lookups'): Promise<void> {
  productSubtab.value = tab;
  categoryManageName.value = '';
  brandManageName.value = '';
  unitManageName.value = '';
  lookupSectionAddMode.value = null;
  lookupEditingId.value = null;
  lookupEditingKind.value = null;
  if (tab === 'lookups') await loadProductLookupManagement();
}

async function addLookupFromSection(kind: ManageMode): Promise<void> {
  const nameRef = kind === 'category' ? categoryManageName : kind === 'brand' ? brandManageName : unitManageName;
  const name = nameRef.value.trim();
  if (!name) return;
  try {
    if (kind === 'category') await addProductCategory(name);
    else if (kind === 'brand') await addProductBrand(name);
    else await addProductUnit(name);
    nameRef.value = '';
    lookupSectionAddMode.value = null;
    lookupManageModal.value = null;
    await load();
    await loadProductLookupManagement();
    showSuccess(`${kind === 'category' ? 'Category' : kind === 'brand' ? 'Brand' : 'Unit'} added.`);
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Could not add item.');
  }
}

function openLookupSectionAdd(kind: ManageMode): void {
  lookupSectionAddMode.value = null;
  lookupManageModal.value = { kind, mode: 'add', item: null };
  if (kind === 'category') categoryManageName.value = '';
  else if (kind === 'brand') brandManageName.value = '';
  else unitManageName.value = '';
}

function closeLookupSectionAdd(kind: ManageMode): void {
  if (lookupSectionAddMode.value === kind) lookupSectionAddMode.value = null;
  if (kind === 'category') categoryManageName.value = '';
  else if (kind === 'brand') brandManageName.value = '';
  else unitManageName.value = '';
}

function beginLookupEdit(kind: ManageMode, item: ProductLookupManageItem): void {
  lookupEditingKind.value = kind;
  lookupEditingId.value = item.id;
  lookupEditingName.value = item.name;
  lookupManageModal.value = { kind, mode: 'edit', item };
}

function closeLookupManageModal(): void {
  lookupManageModal.value = null;
  lookupEditingId.value = null;
  lookupEditingKind.value = null;
  lookupEditingName.value = '';
  categoryManageName.value = '';
  brandManageName.value = '';
  unitManageName.value = '';
}

async function saveLookupManageModal(): Promise<void> {
  const state = lookupManageModal.value;
  if (!state) return;
  if (state.mode === 'add') {
    await addLookupFromSection(state.kind);
    return;
  }
  if (state.item) await saveLookupEdit(state.kind, state.item);
  lookupManageModal.value = null;
}

async function saveLookupEdit(kind: ManageMode, item: ProductLookupManageItem): Promise<void> {
  const name = lookupEditingName.value.trim();
  if (!name) return;
  try {
    if (kind === 'category') await updateProductCategory(item.id, name);
    else if (kind === 'brand') await updateProductBrand(item.id, name);
    else await updateProductUnit(item.id, name);
    lookupEditingId.value = null;
    lookupEditingKind.value = null;
    lookupManageModal.value = null;
    await load();
    await loadProductLookupManagement();
    showSuccess(`${kind === 'category' ? 'Category' : kind === 'brand' ? 'Brand' : 'Unit'} updated.`);
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Could not update item.');
  }
}

async function toggleLookupStatus(kind: ManageMode, item: ProductLookupManageItem): Promise<void> {
  const next = item.status === 'Active' ? 'Inactive' : 'Active';
  try {
    if (kind === 'category') await setProductCategoryStatus(item.id, next);
    else if (kind === 'brand') await setProductBrandStatus(item.id, next);
    else await setProductUnitStatus(item.id, next);
    await load();
    await loadProductLookupManagement();
    showSuccess(`${kind === 'category' ? 'Category' : kind === 'brand' ? 'Brand' : 'Unit'} ${next === 'Active' ? 'activated' : 'deactivated'}.`);
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Could not update status.');
  }
}

function openQuickLookup(kind: ManageMode): void {
  quickLookupMode.value = quickLookupMode.value === kind ? null : kind;
  quickLookupName.value = '';
}

async function saveQuickLookup(kind: ManageMode): Promise<void> {
  const name = quickLookupName.value.trim();
  if (!name || quickLookupSaving.value) return;
  quickLookupSaving.value = true;
  try {
    if (kind === 'category') {
      const item = await addProductCategory(name);
      categories.value.push({ id: item.id, name: item.name });
      form.category = item.name;
    } else if (kind === 'brand') {
      const item = await addProductBrand(name);
      brands.value.push({ id: item.id, name: item.name });
      form.brand = item.name;
    } else {
      const item = await addProductUnit(name);
      units.value.push({ id: item.id, name: item.name });
      form.unit = item.name;
    }
    quickLookupMode.value = null;
    quickLookupName.value = '';
    showSuccess(`${kind === 'category' ? 'Category' : kind === 'brand' ? 'Brand' : 'Unit'} added and selected.`);
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Could not add item.');
  } finally {
    quickLookupSaving.value = false;
  }
}

const productSearchIndex = computed(() => createProductSearchIndex(products.value));
const filteredProducts = computed(() => {
  const eligible = productSearchIndex.value.filter(({ product: p }) => {
    const qty = Number(p.currentStock || 0);
    const min = Number(p.minimumStock || 0);
    const stockOk = !stockFilter.value
      || (stockFilter.value === 'in' && qty > min)
      || (stockFilter.value === 'low' && qty > 0 && qty <= min)
      || (stockFilter.value === 'out' && qty === 0)
      || (stockFilter.value === 'negative' && qty < 0);
    return (!categoryFilter.value || p.category === categoryFilter.value)
      && (!brandFilter.value || p.brand === brandFilter.value)
      && (!statusFilter.value || p.status === statusFilter.value)
      && stockOk;
  });

  if (!search.value.trim()) return sortRows('products', eligible.map((entry) => entry.product));

  // Relevance is primary while searching. Existing table sorting remains as a
  // deterministic tie-breaker for products with the same relevance score.
  const ranked = searchProductIndex(eligible, search.value);
  const output: Product[] = [];
  for (let index = 0; index < ranked.length;) {
    const score = ranked[index].score;
    const tied: Product[] = [];
    while (index < ranked.length && ranked[index].score === score) {
      tied.push(ranked[index].product);
      index += 1;
    }
    output.push(...sortRows('products', tied));
  }
  return output;
});

const lotsTotalQty = computed(() => lots.value.reduce((sum, l) => sum + Number(l.remainingQuantity || 0), 0));
const lotsTotalValue = computed(() => lots.value.reduce((sum, l) => sum + Number(l.remainingQuantity || 0) * Number(l.purchasePrice || 0), 0));

const productOptions = computed(() => products.value.filter((p) => p.status === 'Active'));
const filteredPurchaseProducts = computed(() => productOptions.value.filter((p) => !purchaseCategoryFilter.value || p.category === purchaseCategoryFilter.value));
const purchaseSubtotal = computed(() => purchaseForm.items.reduce((sum, line) => sum + Number(line.qty || 0) * Number(line.unitPrice || 0), 0));
const purchaseGrandTotal = computed(() => Math.max(0, purchaseSubtotal.value - Number(purchaseForm.discount || 0)));
const purchaseDueAmount = computed(() => Math.max(0, purchaseGrandTotal.value - Number(purchaseForm.paidAmount || 0)));
const filteredPurchases = computed(() => {
  const q = purchaseSearch.value.trim().toLowerCase();
  if (!q) return purchases.value;
  return purchases.value.filter((p) => `${p.purchaseId} ${p.supplierName} ${p.paymentStatus}`.toLowerCase().includes(q));
});

function selectedProductName(productId: string): string {
  const product = products.value.find((p) => p.productId === productId);
  return product ? (product.displayName || product.productName) : productId;
}

function addSelectedPurchaseLine(): void {
  const product = products.value.find((p) => p.productId === purchaseProductPicker.value);
  if (!product) {
    purchaseError.value = 'Pick a product first.';
    return;
  }
  purchaseForm.items.push({
    productId: product.productId,
    productName: product.displayName || product.productName,
    qty: 1,
    unitPrice: Number(product.purchasePrice || 0),
    sellingPrice: Number(product.sellingPrice || 0),
    tracking: {}
  });
  purchaseProductPicker.value = '';
  purchaseError.value = '';
}

function fillPurchaseFormFromPurchase(purchase: Purchase): void {
  purchaseForm.purchasePlanOrderId = '';
  purchaseForm.supplierId = purchase.supplierId || '';
  purchaseForm.date = purchase.purchaseDate || todayIso;
  purchaseForm.backdatedReason = '';
  purchaseForm.discount = Number(purchase.discount || 0);
  purchaseForm.paidAmount = Number(purchase.paidAmount || 0);
  purchaseForm.notes = purchase.note || '';
  purchaseForm.paymentMethod = purchase.paymentMethod || 'Cash';
  purchaseForm.bankAccountId = purchase.bankAccountId || '';
  purchaseForm.items.splice(0, purchaseForm.items.length, ...purchase.items.map((item) => ({
    productId: item.productId,
    productName: item.productName,
    qty: Math.max(1, Math.round(Number(item.quantity || 0))),
    unitPrice: Number(item.unitPrice ?? item.purchasePrice ?? 0),
    sellingPrice: null,
    tracking: {}
  })));
}

async function editPurchase(purchase: Purchase): Promise<void> {
  try {
    const detail = await getPurchaseDetail(purchase.purchaseId);
    fillPurchaseFormFromPurchase(detail.purchase);
    purchaseEditId.value = purchase.purchaseId;
    purchaseUpdateReason.value = '';
    purchaseError.value = '';
    purchaseTab.value = 'new';
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Could not load purchase for update');
  }
}

function openDeletePurchase(purchase: Purchase): void {
  purchaseDeleteFromSupplierLedger.value = false;
  purchaseDeleteTarget.value = purchase;
  purchaseDeleteReason.value = '';
  openModal('purchase-delete');
}

async function openSupplierLedgerPurchaseDelete(row: SupplierLedgerRow): Promise<void> {
  const purchaseId = String(row.reference || '').trim();
  if (!purchaseId || !['Purchase', 'Purchase Update'].includes(row.type)) return;
  try {
    const existing = purchases.value.find((p) => p.purchaseId === purchaseId);
    const purchase = existing || (await getPurchaseDetail(purchaseId)).purchase;
    purchaseDeleteFromSupplierLedger.value = true;
    purchaseDeleteTarget.value = purchase;
    purchaseDeleteReason.value = '';
    openModal('purchase-delete');
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Could not open purchase for deletion');
  }
}

async function confirmDeletePurchase(): Promise<void> {
  if (!purchaseDeleteTarget.value) return;
  if (!purchaseDeleteReason.value.trim()) { purchaseError.value = 'Enter delete reason.'; return; }
  const reopenSupplier = purchaseDeleteFromSupplierLedger.value ? supplierDetail.value?.supplier || null : null;
  try {
    await deletePurchaseApi(purchaseDeleteTarget.value.purchaseId, purchaseDeleteReason.value.trim());
    closeModal();
    purchaseDeleteFromSupplierLedger.value = false;
    showSuccess('Purchase deleted');
    await load();
    if (reopenSupplier) await openSupplierDetail(reopenSupplier);
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Purchase delete failed');
  }
}

function addPurchaseLine(): void {
  purchaseForm.items.push({ productId: '', productName: '', qty: 1, unitPrice: 0, sellingPrice: null, tracking: {} });
}

function removePurchaseLine(index: number): void {
  purchaseForm.items.splice(index, 1);
}

function resetPurchaseForm(): void {
  purchaseForm.purchasePlanOrderId = '';
  purchaseForm.supplierId = '';
  purchaseForm.date = new Date().toISOString().slice(0, 10);
  purchaseForm.backdatedReason = '';
  purchaseForm.discount = 0;
  purchaseForm.paidAmount = 0;
  purchaseForm.notes = '';
  purchaseForm.paymentMethod = 'Cash';
  purchaseForm.bankAccountId = '';
  purchaseForm.items.splice(0, purchaseForm.items.length);
  purchaseProductPicker.value = '';
  purchaseCategoryFilter.value = '';
  quickSupplierVisible.value = false;
  quickSupplierName.value = '';
  purchaseError.value = '';
  purchaseEditId.value = null;
  purchaseUpdateReason.value = '';
  purchaseTrackingOpenIndex.value = null;
}

async function saveQuickSupplier(): Promise<void> {
  const name = quickSupplierName.value.trim();
  if (!name) return;
  try {
    const result = await addSupplier(name);
    suppliers.value.push({ id: result.id, name: result.name, currentDue: 0 });
    purchaseForm.supplierId = result.id;
    quickSupplierName.value = '';
    quickSupplierVisible.value = false;
    showSuccess('Supplier added');
  } catch (err) {
    purchaseError.value = err instanceof Error ? err.message : 'Supplier add failed';
  }
}

function onLineProductChange(index: number): void {
  const line = purchaseForm.items[index];
  const product = products.value.find((p) => p.productId === line.productId);
  line.tracking = {};
  if (!product) return;
  line.productName = product.displayName || product.productName;
  if (!line.unitPrice) line.unitPrice = Number(product.purchasePrice || 0);
  if (line.sellingPrice === null) line.sellingPrice = Number(product.sellingPrice || 0);
}

function purchaseLineProduct(line: { productId: string }): Product | undefined {
  return products.value.find((p) => p.productId === line.productId);
}

function purchaseLineNeedsTracking(line: { productId: string }): boolean {
  const product = purchaseLineProduct(line);
  return !!(product?.trackSerial || product?.trackExpiry);
}

function purchaseTrackingSummary(line: { productId: string; qty: number; tracking: LotTrackingInput }): string {
  const product = purchaseLineProduct(line);
  if (!product || (!product.trackSerial && !product.trackExpiry)) return '';
  const tracking = line.tracking || {};
  const serialCount = product.trackExpiry
    ? (tracking.expiryBatches || []).reduce((n, batch) => n + (batch.serialNumbers?.length || 0), 0)
    : (tracking.serialNumbers?.length || 0);
  const expiryQty = (tracking.expiryBatches || []).reduce((n, batch) => n + Number(product.trackSerial ? (batch.serialNumbers?.length || 0) : (batch.quantity || 0)), 0);
  const assigned = product.trackSerial ? serialCount : expiryQty;
  const qty = Math.max(0, Math.round(Number(line.qty || 0)));
  return assigned >= qty && qty > 0 ? `Tracking complete ${assigned}/${qty}` : `Tracking pending ${assigned}/${qty}`;
}

function viewPurchase(purchase: Purchase): void {
  selectedPurchase.value = purchase;
  openModal('purchase');
}

async function savePurchase(): Promise<void> {
  purchaseSaving.value = true;
  purchaseError.value = '';
  try {
    const payload = {
      purchasePlanOrderId: purchaseForm.purchasePlanOrderId || undefined,
      supplierId: purchaseForm.supplierId,
      date: purchaseForm.date,
      backdatedReason: purchaseForm.backdatedReason,
      discount: Number(purchaseForm.discount || 0),
      paidAmount: Number(purchaseForm.paidAmount || 0),
      notes: purchaseForm.notes.trim(),
      paymentMethod: purchaseForm.paymentMethod,
      bankAccountId: purchaseForm.bankAccountId,
      items: purchaseForm.items.map((line) => ({
        productId: line.productId,
        name: line.productName,
        qty: Math.max(1, Math.round(Number(line.qty || 0))),
        unitPrice: Number(line.unitPrice || 0),
        sellingPrice: line.sellingPrice === null ? undefined : Number(line.sellingPrice || 0),
        tracking: line.tracking || {}
      }))
    };
    if (purchaseEditId.value) {
      await updatePurchase(purchaseEditId.value, { ...payload, reason: purchaseUpdateReason.value.trim() });
      showSuccess('Purchase updated');
    } else {
      await createPurchase(payload);
      showSuccess('Purchase completed');
    }
    resetPurchaseForm();
    purchaseTab.value = 'history';
    await load();
  } catch (err) {
    purchaseError.value = err instanceof Error ? err.message : 'Purchase save failed';
  } finally {
    purchaseSaving.value = false;
  }
}


async function convertPlannerOrderToPurchase(orderId: string): Promise<void> {
  purchaseError.value = '';
  try {
    const result = await getPurchasePlanOrderConvertData(orderId);
    resetPurchaseForm();
    purchaseForm.purchasePlanOrderId = result.purchase.purchasePlanOrderId;
    purchaseForm.supplierId = result.purchase.supplierId;
    purchaseForm.notes = `From Supplier Purchase Order ${result.purchase.orderNo}`;
    purchaseForm.items.splice(0, purchaseForm.items.length, ...result.purchase.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      qty: Math.max(1, Math.round(Number(item.quantity || 0))),
      unitPrice: Number(item.unitPrice || 0),
      sellingPrice: Number(item.sellingPrice || 0),
      tracking: {}
    })));
    purchaseTab.value = 'new';
    showSuccess(`${result.purchase.orderNo} loaded into New Purchase. Stock/accounting will change only after Complete Purchase.`);
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Could not load supplier order into Purchase.');
  }
}

async function loadPurchaseForReturn(): Promise<void> {
  returnError.value = '';
  returnData.value = null;
  if (!returnPurchaseId.value) return;
  try {
    const result = await getPurchaseForReturn(returnPurchaseId.value);
    result.purchase.items.forEach((item) => { item.returnQty = 0; });
    returnData.value = result.purchase;
  } catch (err) {
    returnError.value = err instanceof Error ? err.message : 'Could not load purchase for return';
  }
}

function startReturnFromPurchase(purchase: Purchase): void {
  returnPurchaseId.value = purchase.purchaseId;
  returnDate.value = todayIso;
  returnBackdatedReason.value = '';
  returnRefundMethod.value = 'Supplier Credit';
  returnReason.value = '';
  returnNotes.value = '';
  purchaseTab.value = 'return';
  void loadPurchaseForReturn();
}

const returnTotal = computed(() => {
  if (!returnData.value) return 0;
  return returnData.value.items.reduce((sum, item) => sum + Number(item.returnQty || 0) * Number(item.unitPrice || 0), 0);
});

async function savePurchaseReturn(): Promise<void> {
  if (!returnData.value) return;
  returnSaving.value = true;
  returnError.value = '';
  try {
    const items = returnData.value.items
      .filter((item) => Number(item.returnQty || 0) > 0)
      .map((item) => ({
        productId: item.productId,
        qty: Math.min(
          Math.max(0, Math.floor(Number(item.availableQty || 0))),
          Math.max(0, Math.round(Number(item.returnQty || 0)))
        ),
        unitPrice: Number(item.unitPrice || 0),
        serialNumbers: item.trackSerial ? (item.serialNumbers || []).slice(0, Math.max(0, Math.round(Number(item.returnQty || 0)))) : undefined
      }))
      .filter((item) => item.qty > 0);
    const finalReason = returnReason.value.trim() || returnNotes.value.trim();
    await completePurchaseReturn({
      purchaseId: returnData.value.purchaseId,
      date: returnDate.value,
      backdatedReason: returnBackdatedReason.value,
      refundMethod: returnRefundMethod.value,
      reason: finalReason,
      notes: returnNotes.value.trim(),
      items
    });
    showSuccess('Purchase return completed');
    returnData.value = null;
    returnPurchaseId.value = '';
    returnReason.value = '';
    await load();
  } catch (err) {
    returnError.value = err instanceof Error ? err.message : 'Purchase return failed';
  } finally {
    returnSaving.value = false;
  }
}




const filteredSuppliers = computed(() => {
  const q = supplierSearch.value.trim().toLowerCase();
  return suppliers.value.filter((s) => !q || s.name.toLowerCase().includes(q) || String(s.phone || '').toLowerCase().includes(q));
});

const supplierPaymentNeedsBank = computed(() => supplierPaymentForm.method === 'Bank' || supplierPaymentForm.method === 'Mobile Banking');
const supplierPaymentIsBackdated = computed(() => !!supplierPaymentForm.date && supplierPaymentForm.date < todayIso);
const moduleTitle = computed(() => activeModule.value === 'dashboard' ? 'Dashboard' : activeModule.value === 'products' ? 'Products' : activeModule.value === 'tracking' ? 'Product Tracking' : activeModule.value === 'purchase' ? 'Purchase' : activeModule.value === 'suppliers' ? 'Suppliers' : activeModule.value === 'vendors' ? 'Vendors' : activeModule.value === 'customers' ? 'Customers' : activeModule.value === 'sales' ? 'Sales' : activeModule.value === 'expense' ? 'Expenses' : activeModule.value === 'bank' ? 'Bank Accounts' : activeModule.value === 'daybook' ? 'Day Book' : activeModule.value === 'finance' ? 'Finance' : activeModule.value === 'reports' ? 'Reports' : activeModule.value === 'settings' ? 'Settings' : 'POS');
const moduleHint = computed(() => activeModule.value === 'dashboard' ? 'আজকের অবস্থা' : activeModule.value === 'products' ? 'পণ্য, ক্যাটাগরি, ইউনিট ও স্টক' : activeModule.value === 'tracking' ? 'সিরিয়াল, এক্সপায়ারি ও ওয়ারেন্টি' : activeModule.value === 'purchase' ? 'পণ্য ক্রয় ও স্টক ইন' : activeModule.value === 'suppliers' ? 'সাপ্লায়ার, বাকি ও লেজার' : activeModule.value === 'vendors' ? 'ভেন্ডর, কনসাইনমেন্ট ও দুইমুখী হিসাব' : activeModule.value === 'customers' ? 'কাস্টমার, বাকি ও লেজার' : activeModule.value === 'sales' ? 'বিক্রির ইনভয়েস, পেমেন্ট ও রিটার্ন' : activeModule.value === 'expense' ? 'খরচ, তালিকা, ক্যাটাগরি ও পেয়ি লেজার' : activeModule.value === 'bank' ? 'ব্যাংক হিসাব, লেজার ও ট্রান্সফার' : activeModule.value === 'daybook' ? 'সব দৈনিক লেনদেন এক জায়গায়' : activeModule.value === 'finance' ? 'মূলধন, ঋণ ও ফাইন্যান্স লেজার' : activeModule.value === 'reports' ? 'বিক্রি, ক্রয়, স্টক, ক্যাশ, লাভ ও ব্যালেন্স' : activeModule.value === 'settings' ? 'দোকান, ইনভয়েস ও সিস্টেম সেটিং' : 'বিক্রয়, ক্যাশ সেশন ও ইনভয়েস');

const shellNavItems = computed<ShellNavItem[]>(() => {
  const items: Array<ShellNavItem | null> = [
    canViewModule('dashboard') ? { key: 'dashboard', label: 'Dashboard', hint: 'আজকের অবস্থা', icon: '📊' } : null,
    canViewModule('products') ? { key: 'products', label: 'Products', hint: 'পণ্য তালিকা', icon: '📦' } : null,
    canViewModule('products') ? { key: 'tracking', label: 'Product Tracking', hint: 'সিরিয়াল ও এক্সপায়ারি', icon: '🔎' } : null,
    canViewModule('purchase') ? { key: 'purchase', label: 'Purchase', hint: 'ক্রয় এন্ট্রি', icon: '🛒' } : null,
    canViewModule('suppliers') ? { key: 'suppliers', label: 'Suppliers', hint: 'সাপ্লায়ার', icon: '🚚' } : null,
    canViewModule('vendors') ? { key: 'vendors', label: 'Vendors', hint: 'ভেন্ডর ও কনসাইনমেন্ট', icon: '🤝' } : null,
    canViewModule('customers') ? { key: 'customers', label: 'Customers', hint: 'কাস্টমার', icon: '👥' } : null,
    canViewModule('pos') ? { key: 'pos', label: 'POS', hint: 'বিক্রয়', icon: '🧾' } : null,
    (canViewModule('sales') || canViewModule('returns')) ? { key: 'sales', label: 'Sales', hint: 'বিক্রির তালিকা', icon: '📄' } : null,
    canViewModule('expense') ? { key: 'expense', label: 'Expenses', hint: 'খরচ', icon: '💸' } : null,
    canViewModule('bank') ? { key: 'bank', label: 'Bank Accounts', hint: 'ব্যাংক হিসাব', icon: '🏦' } : null,
    canViewModule('reports') ? { key: 'reports', label: 'Reports', hint: 'ব্যবসার রিপোর্ট', icon: '📈' } : null,
    canViewModule('daybook') ? { key: 'daybook', label: 'Day Book', hint: 'দৈনিক লেনদেন', icon: '📒' } : null,
    canViewModule('finance') ? { key: 'finance', label: 'Finance', hint: 'মূলধন ও ঋণ', icon: '💼' } : null,
    canOpenSettings() ? { key: 'settings', label: 'Settings', hint: 'দোকানের সেটিং', icon: '⚙️' } : null
  ];
  return items.filter((item): item is ShellNavItem => item !== null);
});

function handleShellModuleSelect(module: string): void {
  switchModule(module as ModuleKey);
}

function hasClientModulePermission(moduleKey: string, action: 'view' | 'add' | 'edit' | 'delete'): boolean {
  if (!authUser.value) return false;
  if (authUser.value.role === 'admin') return true;
  const permission = authUser.value.permissions?.[moduleKey];
  if (!permission) return false;
  if (action === 'delete') return permission.delete !== false && permission.delete !== 'disabled';
  return !!permission[action];
}

function canDayBookSourceAction(sourceModule: string, action: DayBookSourceAction, _sourceDate = ''): boolean {
  switch (sourceModule) {
    case 'Sales':
      if (action === 'return') return hasClientModulePermission('returns', 'view') && hasClientModulePermission('returns', 'add');
      if (action === 'edit' || action === 'receive-payment') return hasClientModulePermission('sales', 'view') && hasClientModulePermission('sales', 'edit');
      if (action === 'delete') return hasClientModulePermission('sales', 'view') && hasClientModulePermission('sales', 'delete');
      return hasClientModulePermission('sales', 'view');
    case 'Sales Return': return hasClientModulePermission('returns', 'view');
    case 'Purchase':
      if (action === 'return') return hasClientModulePermission('purchase', 'view') && hasClientModulePermission('purchase', 'add');
      if (action === 'edit') return hasClientModulePermission('purchase', 'view') && hasClientModulePermission('purchase', 'edit');
      if (action === 'delete') return hasClientModulePermission('purchase', 'view') && hasClientModulePermission('purchase', 'delete');
      return hasClientModulePermission('purchase', 'view');
    case 'Purchase Return': return hasClientModulePermission('purchase', 'view');
    case 'Customer Payment':
      if (action === 'edit') return hasClientModulePermission('customers', 'view') && hasClientModulePermission('customers', 'edit');
      if (action === 'delete') return hasClientModulePermission('customers', 'view') && hasClientModulePermission('customers', 'delete');
      return hasClientModulePermission('customers', 'view');
    case 'Supplier Payment':
      if (action === 'edit') return hasClientModulePermission('suppliers', 'view') && hasClientModulePermission('suppliers', 'edit');
      if (action === 'delete') return hasClientModulePermission('suppliers', 'view') && hasClientModulePermission('suppliers', 'delete');
      return hasClientModulePermission('suppliers', 'view');
    case 'Expense':
      if (action === 'edit' || action === 'cancel') return hasClientModulePermission('expense', 'view') && hasClientModulePermission('expense', 'edit');
      return hasClientModulePermission('expense', 'view');
    case 'Bank':
      if (action === 'reverse') return hasClientModulePermission('bank', 'view') && hasClientModulePermission('bank', 'edit');
      return hasClientModulePermission('bank', 'view');
    case 'Bank Transfer': return hasClientModulePermission('bank', 'view');
    case 'Finance':
      if (action === 'edit') return hasClientModulePermission('finance', 'view') && hasClientModulePermission('finance', 'edit');
      if (action === 'delete') return hasClientModulePermission('finance', 'view') && hasClientModulePermission('finance', 'delete');
      return hasClientModulePermission('finance', 'view');
    case 'Stock Adjustment': return hasClientModulePermission('products', 'view');
    case 'Supplier Warranty': return hasClientModulePermission('products', 'view');
    default: return false;
  }
}

function canOpenDayBookSource(payload: DayBookOpenSource): boolean {
  const allowed = canDayBookSourceAction(payload.sourceModule, payload.action, payload.sourceDate);
  if (!allowed) showError('You do not have permission to run this action in the source module.');
  return allowed;
}

async function handleDayBookOpenSource(payload: DayBookOpenSource): Promise<void> {
  sidebarOpen.value = false;
  if (!canOpenDayBookSource(payload)) return;

  if (payload.sourceModule === 'Sales') {
    salesOpenRequest.value = {
      invoiceId: payload.sourceId,
      tab: payload.action === 'return' ? 'newReturn' : 'sales',
      action: payload.action === 'open' ? 'open' : payload.action as 'edit' | 'delete' | 'return' | 'receive-payment',
      nonce: Date.now()
    };
    activeModule.value = 'sales';
    return;
  }
  if (payload.sourceModule === 'Sales Return') {
    salesOpenRequest.value = { returnId: payload.sourceId, tab: 'returnHistory', action: 'open', nonce: Date.now() };
    activeModule.value = 'sales';
    return;
  }
  if (payload.sourceModule === 'Purchase') {
    activeModule.value = 'purchase';
    purchaseTab.value = 'history';
    try {
      const detail = await getPurchaseDetail(payload.sourceId);
      const purchase = detail.purchase;
      if (payload.action === 'edit') await editPurchase(purchase);
      else if (payload.action === 'delete') openDeletePurchase(purchase);
      else if (payload.action === 'return') startReturnFromPurchase(purchase);
      else viewPurchase(purchase);
    } catch (err) { showError(err instanceof Error ? err.message : 'Could not open purchase.'); }
    return;
  }
  if (payload.sourceModule === 'Purchase Return') {
    activeModule.value = 'purchase';
    purchaseTab.value = 'return';
    returnPurchaseId.value = payload.openId || '';
    if (returnPurchaseId.value) await loadPurchaseForReturn();
    return;
  }
  if (payload.sourceModule === 'Customer Payment') {
    activeModule.value = 'customers';
    if (payload.openId) {
      customerOpenRequest.value = {
        customerId: payload.openId,
        ledgerId: payload.sourceId,
        action: payload.action === 'edit' ? 'edit-payment' : payload.action === 'delete' ? 'delete-payment' : 'open',
        nonce: Date.now()
      };
    }
    return;
  }
  if (payload.sourceModule === 'Supplier Payment') {
    activeModule.value = 'suppliers';
    try {
      let supplier = suppliers.value.find((s) => s.id === payload.openId);
      if (!supplier) { await load(); supplier = suppliers.value.find((s) => s.id === payload.openId); }
      if (!supplier) { showError('Supplier was not found.'); return; }
      await openSupplierDetail(supplier);
      if (payload.action === 'edit' || payload.action === 'delete') {
        const row = { ledgerId: payload.sourceId, type: 'Payment' } as SupplierLedgerRow;
        if (payload.action === 'edit') await openEditSupplierPayment(row);
        else openDeleteSupplierPayment(row);
      }
    } catch (err) { showError(err instanceof Error ? err.message : 'Could not open supplier payment.'); }
    return;
  }
  if (payload.sourceModule === 'Expense') {
    activeModule.value = 'expense';
    expenseOpenRequest.value = {
      expenseId: payload.sourceId,
      action: payload.action === 'edit' ? 'edit' : payload.action === 'cancel' ? 'cancel' : 'view',
      nonce: Date.now()
    };
    return;
  }
  if (payload.sourceModule === 'Bank') {
    activeModule.value = 'bank';
    bankOpenRequest.value = {
      tab: 'ledger',
      accountId: payload.openId || '',
      entryId: payload.sourceId,
      date: payload.sourceDate,
      action: payload.action === 'reverse' ? 'reverse' : 'open',
      nonce: Date.now()
    };
    return;
  }
  if (payload.sourceModule === 'Bank Transfer') {
    activeModule.value = 'bank';
    bankOpenRequest.value = { tab: 'transfers', action: 'open', nonce: Date.now() };
    return;
  }
  if (payload.sourceModule === 'Finance') {
    activeModule.value = 'finance';
    financeOpenRequest.value = {
      tab: 'ledger',
      financeId: payload.sourceId,
      date: payload.sourceDate,
      action: payload.action === 'edit' ? 'edit' : payload.action === 'delete' ? 'delete' : 'view',
      nonce: Date.now()
    };
    return;
  }
  if (payload.sourceModule === 'Stock Adjustment') {
    activeModule.value = 'products';
    search.value = payload.sourceId;
    return;
  }
  if (payload.sourceModule === 'Supplier Warranty') {
    activeModule.value = 'tracking';
  }
}

function resetSupplierForm(): void {
  supplierEditingId.value = null;
  Object.assign(supplierForm, { name: '', phone: '', address: '', openingBalance: 0, notes: '' });
  supplierFormError.value = '';
}

function openAddSupplier(): void {
  resetSupplierForm();
  openModal('supplier');
}

function openEditSupplier(supplier: Supplier): void {
  supplierEditingId.value = supplier.id;
  Object.assign(supplierForm, {
    name: supplier.name,
    phone: supplier.phone || '',
    address: supplier.address || '',
    openingBalance: Number(supplier.openingBalance || 0),
    notes: supplier.notes || ''
  });
  supplierFormError.value = '';
  openModal('supplier');
}

async function saveSupplier(): Promise<void> {
  supplierFormError.value = '';
  try {
    const payload: SupplierForm = {
      name: supplierForm.name.trim(), phone: supplierForm.phone.trim(), address: supplierForm.address.trim(),
      openingBalance: Number(supplierForm.openingBalance || 0), notes: supplierForm.notes.trim()
    };
    if (supplierEditingId.value) await updateSupplierFull(supplierEditingId.value, payload);
    else await createSupplierFull(payload);
    closeModal();
    showSuccess('Supplier saved');
    await load();
  } catch (err) {
    supplierFormError.value = err instanceof Error ? err.message : 'Supplier save failed';
  }
}

async function openSupplierDetail(supplier: Supplier): Promise<void> {
  try {
    const detail = await getSupplierDetail(supplier.id, supplierLedgerFilters);
    supplierDetail.value = detail;
    Object.assign(supplierPaymentForm, { amount: 0, method: 'Cash', bankAccountId: '', notes: '', date: todayIso, backdatedReason: '' });
    supplierPaymentError.value = '';
    openModal('supplier-detail');
  } catch (err) { showError(err instanceof Error ? err.message : 'Failed to load supplier'); }
}

const supplierLedgerColumns = [
  { label: 'Date', value: (r: SupplierLedgerRow) => formatDateShort(r.date) },
  { label: 'Type', key: 'type' as const },
  { label: 'Reference', key: 'reference' as const },
  { label: 'Debit (খরচ)', value: (r: SupplierLedgerRow) => r.debit ? formatMoney(r.debit) : '', align: 'right' as const },
  { label: 'Credit (জমা)', value: (r: SupplierLedgerRow) => r.credit ? formatMoney(r.credit) : '', align: 'right' as const },
  { label: 'Balance', value: (r: SupplierLedgerRow) => r.balance > 0 ? `Due ${formatMoney(r.balance)}` : r.balance < 0 ? `Advance ${formatMoney(Math.abs(r.balance))}` : `Settled ${formatMoney(0)}`, align: 'right' as const },
  { label: 'Notes', key: 'notes' as const }
];
function printSupplierLedger(): void {
  if (!supplierDetail.value) return;
  const rows = sortRows('supplier-ledger', supplierDetail.value.ledger);
  const h = supplierDetail.value.history;
  const s = supplierDetail.value.summary;
  printRows({
    title: 'Supplier Ledger',
    subtitle: `${supplierDetail.value.supplier.name}${supplierDetail.value.supplier.phone ? ` — ${supplierDetail.value.supplier.phone}` : ''}`,
    businessHeader: supplierDetail.value.printHeader,
    contextLines: [`Date range: ${h.from || 'Beginning'} to ${h.to}`, `Showing ${h.returnedCount} of ${h.matchingCount} matching records · Limit ${h.limit}`],
    columns: supplierLedgerColumns,
    rows,
    footerLines: [
      { label: 'Opening Balance (shown rows)', value: formatMoney(s.displayedOpeningBalance) },
      { label: 'Total Debit (shown rows)', value: formatMoney(s.totalDebit) },
      { label: 'Total Credit (shown rows)', value: formatMoney(s.totalCredit) },
      { label: 'Closing Balance (shown rows)', value: formatMoney(s.displayedClosingBalance) },
      { label: 'Current Due', value: formatMoney(supplierDetail.value.supplier.currentDue) }
    ]
  });
}
function exportSupplierLedger(): void {
  if (!supplierDetail.value) return;
  exportRowsToCsv({
    filename: `supplier-ledger-${supplierDetail.value.supplier.name}`,
    columns: supplierLedgerColumns,
    rows: sortRows('supplier-ledger', supplierDetail.value.ledger)
  });
}

async function toggleSupplierStatus(supplier: Supplier): Promise<void> {
  const next = supplier.status === 'Active' ? 'Inactive' : 'Active';
  if (!confirm(`${next === 'Inactive' ? 'Deactivate' : 'Activate'} "${supplier.name}"?`)) return;
  try { await setSupplierStatusApi(supplier.id, next); showSuccess('Supplier updated'); await load(); }
  catch (err) { showError(err instanceof Error ? err.message : 'Supplier update failed'); }
}

function openDeleteSupplier(supplier: Supplier): void {
  supplierDeleteTarget.value = supplier;
  supplierDeleteReason.value = '';
  openModal('supplier-delete');
}

async function confirmDeleteSupplier(): Promise<void> {
  if (!supplierDeleteTarget.value) return;
  try {
    await deleteSupplierApi(supplierDeleteTarget.value.id, supplierDeleteReason.value.trim());
    closeModal(); supplierDeleteTarget.value = null; showSuccess('Supplier deleted'); await load();
  } catch (err) { showError(err instanceof Error ? err.message : 'Supplier delete failed'); }
}

async function recordSupplierPayment(): Promise<void> {
  if (!supplierDetail.value) return;
  supplierPaymentError.value = '';
  try {
    await paySupplier(supplierDetail.value.supplier.id, {
      amount: Number(supplierPaymentForm.amount || 0), method: supplierPaymentForm.method,
      bankAccountId: supplierPaymentForm.bankAccountId, notes: supplierPaymentForm.notes.trim(),
      date: supplierPaymentForm.date || todayIso, backdatedReason: supplierPaymentForm.backdatedReason.trim()
    });
    showSuccess('Payment recorded');
    await load();
    await openSupplierDetail(supplierDetail.value.supplier);
  } catch (err) { supplierPaymentError.value = err instanceof Error ? err.message : 'Payment failed'; }
}

async function openEditSupplierPayment(row: SupplierLedgerRow): Promise<void> {
  try {
    const result = await getSupplierPaymentForEdit(row.ledgerId);
    supplierEditingPaymentId.value = row.ledgerId;
    Object.assign(supplierPaymentForm, {
      amount: Number(result.payment.amount || 0), method: result.payment.method || 'Cash', bankAccountId: result.payment.bankAccountId || '',
      notes: result.payment.notes || '', date: result.payment.date || todayIso, backdatedReason: ''
    });
    supplierPaymentError.value = '';
    openModal('supplier-payment-edit');
  } catch (err) { showError(err instanceof Error ? err.message : 'Payment load failed'); }
}

async function saveSupplierPaymentEdit(): Promise<void> {
  if (!supplierEditingPaymentId.value) return;
  supplierPaymentError.value = '';
  try {
    await updateSupplierPayment(supplierEditingPaymentId.value, {
      amount: Number(supplierPaymentForm.amount || 0), method: supplierPaymentForm.method,
      bankAccountId: supplierPaymentForm.bankAccountId, notes: supplierPaymentForm.notes.trim(), date: supplierPaymentForm.date || todayIso
    });
    closeModal(); showSuccess('Payment updated'); await load();
    if (supplierDetail.value) await openSupplierDetail(supplierDetail.value.supplier);
  } catch (err) { supplierPaymentError.value = err instanceof Error ? err.message : 'Payment update failed'; }
}

function openDeleteSupplierPayment(row: SupplierLedgerRow): void {
  supplierPaymentDeleteTarget.value = row;
  supplierPaymentDeleteReason.value = '';
  openModal('supplier-payment-delete');
}

async function confirmDeleteSupplierPayment(): Promise<void> {
  if (!supplierPaymentDeleteTarget.value) return;
  try {
    const supplier = supplierDetail.value?.supplier;
    await deleteSupplierPayment(supplierPaymentDeleteTarget.value.ledgerId, supplierPaymentDeleteReason.value.trim());
    closeModal(); showSuccess('Payment deleted'); await load();
    if (supplier) await openSupplierDetail(supplier);
  } catch (err) { showError(err instanceof Error ? err.message : 'Payment delete failed'); }
}

async function initAuth(): Promise<void> {
  authReady.value = false;
  authError.value = '';
  try {
    const setup = await getSetupStatus();
    setupRequired.value = setup.setupRequired;
    const current = await getMe().catch(() => ({ ok: true as const, user: null }));
    authUser.value = current.user;
    ensureAllowedModule();
    if (authUser.value) await load();
  } catch (err) {
    authError.value = err instanceof Error ? err.message : 'Authentication check failed';
  } finally {
    authReady.value = true;
  }
}

async function submitSetup(): Promise<void> {
  authSaving.value = true;
  authError.value = '';
  try {
    const result = await setupAdmin({
      fullName: setupForm.fullName.trim() || 'Admin',
      phone: setupForm.phone.trim(),
      password: setupForm.password
    }, setupSecret.value.trim());
    setupSecret.value = '';
    setToken(result.token);
    authUser.value = result.user;
    ensureAllowedModule();
    setupRequired.value = false;
    await load();
  } catch (err) {
    authError.value = err instanceof Error ? err.message : 'Setup failed';
  } finally {
    authSaving.value = false;
  }
}

async function submitLogin(): Promise<void> {
  authSaving.value = true;
  authError.value = '';
  try {
    const result = await login({ phone: loginForm.phone.trim(), password: loginForm.password });
    setToken(result.token);
    authUser.value = result.user;
    ensureAllowedModule();
    await load();
  } catch (err) {
    authError.value = err instanceof Error ? err.message : 'Login failed';
  } finally {
    authSaving.value = false;
  }
}

async function signOut(): Promise<void> {
  try {
    await logoutApi();
  } catch {
    // ignore network/logout failures and clear local session anyway
  }
  authUser.value = null;
  products.value = [];
}

onMounted(() => {
  void initAuth();
  document.addEventListener('click', handleGlobalPointer);
  window.addEventListener('scroll', handleViewportChange, true);
  window.addEventListener('resize', handleViewportChange);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleGlobalPointer);
  window.removeEventListener('scroll', handleViewportChange, true);
  window.removeEventListener('resize', handleViewportChange);
});
</script>

<template>
  <GlobalToast />
  <div id="app">
    <div v-if="!authReady" class="startup-page" role="status" aria-live="polite" aria-label="Loading SherERP">
      <div class="startup-glow startup-glow-one" aria-hidden="true"></div>
      <div class="startup-glow startup-glow-two" aria-hidden="true"></div>

      <div class="startup-loader">
        <div class="startup-logo" aria-hidden="true">SE</div>
        <div class="startup-brand">
          <h1>SherERP</h1>
          <p class="startup-tagline">ব্যবসার সহজ সমাধান</p>
        </div>

        <div class="startup-progress" aria-hidden="true">
          <span></span>
        </div>

        <div class="startup-status">
          <span>Loading</span>
          <span class="startup-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        </div>
        <p class="startup-wait">অনুগ্রহ করে অপেক্ষা করুন</p>
      </div>
    </div>

    <div v-else-if="!authUser" class="auth-page">
      <div class="auth-card">
        <div class="logo-mark auth-logo">SE</div>
        <h2>{{ setupRequired ? 'Initial Admin Setup' : 'Login to SherERP' }}</h2>
        <p class="bn-hint">{{ setupRequired ? 'প্রথম অ্যাডমিন ইউজার তৈরি করুন' : 'মোবাইল নম্বর ও পাসওয়ার্ড দিন' }}</p>

        <div v-if="setupRequired" class="auth-form">
          <label>Full Name<br><span class="bn-hint" style="display:inline;">নাম</span></label>
          <input v-model.trim="setupForm.fullName" type="text" placeholder="Admin name" />
          <label>Phone Number *<br><span class="bn-hint" style="display:inline;">মোবাইল নম্বর</span></label>
          <input v-model.trim="setupForm.phone" type="text" placeholder="01XXXXXXXXX" />
          <label>Password *<br><span class="bn-hint" style="display:inline;">পাসওয়ার্ড</span></label>
          <input v-model="setupForm.password" type="password" placeholder="Minimum 6 characters" />
          <label>Setup Secret *<br><span class="bn-hint" style="display:inline;">Cloudflare-এ সেট করা নিরাপত্তা কোড</span></label>
          <input v-model="setupSecret" type="password" autocomplete="off" placeholder="Enter the SETUP_SECRET from Cloudflare" @keyup.enter="submitSetup" />
          <p class="bn-hint">For first-time setup only. Enter the secret configured in your Cloudflare Worker settings; it is not saved in the browser.</p>
          <button class="btn btn-primary auth-submit" :disabled="authSaving || !setupSecret.trim()" @click="submitSetup">{{ authSaving ? 'Creating...' : 'Create Admin' }}</button>
        </div>

        <div v-else class="auth-form">
          <label>Phone Number<br><span class="bn-hint" style="display:inline;">মোবাইল নম্বর</span></label>
          <input v-model.trim="loginForm.phone" type="text" placeholder="01XXXXXXXXX" />
          <label>Password<br><span class="bn-hint" style="display:inline;">পাসওয়ার্ড</span></label>
          <input v-model="loginForm.password" type="password" placeholder="Password" @keyup.enter="submitLogin" />
          <button class="btn btn-primary auth-submit" :disabled="authSaving" @click="submitLogin">{{ authSaving ? 'Logging in...' : 'Login' }}</button>
        </div>

        <div class="field-error" v-if="authError">{{ authError }}</div>
        <p class="auth-note">Security note: password is stored as PBKDF2 hash in D1, not plain text.</p>
      </div>
    </div>

    <template v-else>
    <AppShell
      :nav-items="shellNavItems"
      :active-module="activeModule"
      :sidebar-open="sidebarOpen"
      :module-title="moduleTitle"
      :module-hint="moduleHint"
      :user-name="authUser.fullName"
      :user-role="authUser.role === 'admin' ? 'Administrator' : authUser.role"
      :loading="loading || globalRefreshing"
      @update:sidebar-open="sidebarOpen = $event"
      @select-module="handleShellModuleSelect"
      @logout="signOut"
      @refresh="refreshActiveModule"
    >
        <div v-if="message" class="toast success">{{ message }}</div>
        <div v-if="error" class="toast error">{{ error }}</div>

        <div v-if="activeModule === 'products'" class="product-page-shell">
          <div class="module-inline-tabs product-inline-tabs">
            <button type="button" :class="{ active: productSubtab === 'products' }" @click="setProductSubtab('products')">Products<span>পণ্য তালিকা</span></button>
            <button type="button" :class="{ active: productSubtab === 'lookups' }" @click="setProductSubtab('lookups')">Category, Brand & Unit<span>ধরন, ব্র্যান্ড ও একক</span></button>
          </div>

          <template v-if="productSubtab === 'products'">
            <div class="toolbar product-filterbar">
              <div class="product-search-field">
                <span class="product-search-icon" aria-hidden="true">⌕</span>
                <input class="search-input" v-model="search" type="search" aria-label="Search products" placeholder="Search name, brand, category, barcode or unit..." />
                <button v-if="search" class="product-search-clear" type="button" aria-label="Clear product search" @click="search = ''">×</button>
              </div>
              <select v-model="categoryFilter" aria-label="Filter by category"><option value="">All categories</option><option v-for="c in categoryNames" :key="c" :value="c">{{ c }}</option></select>
              <select v-model="brandFilter" aria-label="Filter by brand"><option value="">All brands</option><option v-for="b in brandNames" :key="b" :value="b">{{ b }}</option></select>
              <select v-model="stockFilter" aria-label="Filter by stock"><option value="">All stock</option><option value="in">In stock</option><option value="low">Low stock</option><option value="out">Out of stock</option><option value="negative">Negative stock</option></select>
              <select v-model="statusFilter" aria-label="Filter by status"><option value="">All status</option><option value="Active">Active</option><option value="Inactive">Inactive</option></select>
              <select v-model="productSort" aria-label="Sort products"><option value="name-asc">Name A–Z</option><option value="name-desc">Name Z–A</option><option value="brand-asc">Brand A–Z</option><option value="brand-desc">Brand Z–A</option><option value="category-asc">Category A–Z</option><option value="category-desc">Category Z–A</option><option value="status-asc">Status A–Z</option><option value="status-desc">Status Z–A</option><option value="stock-desc">Stock Qty: High → Low</option><option value="stock-asc">Stock Qty: Low → High</option><option value="value-desc">Stock Value: High → Low</option><option value="value-asc">Stock Value: Low → High</option><option value="purchase-desc">Purchase Price: High → Low</option><option value="purchase-asc">Purchase Price: Low → High</option><option value="selling-desc">Selling Price: High → Low</option><option value="selling-asc">Selling Price: Low → High</option></select>
              <div class="toolbar-spacer"></div>
              <span class="product-result-count" aria-live="polite">{{ filteredProducts.length }} products</span>
              <button class="btn btn-primary" @click="openAddProduct">+ Add Product</button>
            </div>
            <div class="card product-list-card">
              <div class="table-scroll products-desktop-table"><table class="responsive-table product-table"><thead><tr><SortableHeader table-id="products" column="productName">Product</SortableHeader><SortableHeader table-id="products" column="brand">Brand</SortableHeader><SortableHeader table-id="products" column="category">Category</SortableHeader><SortableHeader table-id="products" column="purchasePrice" type="number" class="num">Purchase Price</SortableHeader><SortableHeader table-id="products" column="sellingPrice" type="number" class="num">Selling Price</SortableHeader><SortableHeader table-id="products" column="currentStock" type="number" class="num">Stock Qty</SortableHeader><SortableHeader table-id="products" column="stockValue" type="number" class="num">Stock Value</SortableHeader><SortableHeader table-id="products" column="status">Status</SortableHeader><th></th></tr></thead><tbody>
                <tr v-if="loading"><td colspan="9">Loading products...</td></tr>
                <tr v-for="product in filteredProducts" :key="product.productId"><td data-label="Product" class="primary-cell"><strong>{{ product.displayName || product.productName }}</strong><br><span class="bn-hint mono">{{ product.productId }}</span></td><td data-label="Brand">{{ product.brand || '-' }}</td><td data-label="Category">{{ product.category || '-' }}</td><td data-label="Purchase" class="num mono">{{ formatMoney(product.purchasePrice) }}</td><td data-label="Selling" class="num mono">{{ formatMoney(product.sellingPrice) }}</td><td data-label="Stock" class="num mono" :class="{ dangerText: Number(product.currentStock) === 0, warningText: Number(product.currentStock) > 0 && Number(product.currentStock) <= Number(product.minimumStock) }">{{ formatQty(product.currentStock) }}</td><td data-label="Stock Value" class="num mono">{{ formatMoney(product.stockValue) }}</td><td data-label="Status"><span class="badge" :class="product.status === 'Active' ? 'badge-success' : 'badge-danger'">{{ product.status }}</span></td><td data-label="Actions" class="row-actions action-cell"><button class="btn btn-sm action-trigger" @click="openProductActions($event, product)">Actions</button></td></tr>
              </tbody></table></div>
              <div class="products-mobile-list" v-if="!loading && filteredProducts.length > 0" role="list" aria-label="Products">
                <div v-for="product in filteredProducts" :key="product.productId" class="products-mobile-item" role="listitem" :class="{ 'is-inactive': product.status !== 'Active' }">
                  <div class="products-mobile-primary">
                    <strong class="products-mobile-name">{{ product.displayName || product.productName }}</strong>
                    <span class="products-mobile-meta">{{ product.brand || 'No brand' }} · {{ product.category || 'Uncategorised' }}</span>
                    <span class="products-mobile-code">{{ product.productId }}</span>
                  </div>
                  <div class="products-mobile-prices">
                    <strong>{{ formatMoney(product.sellingPrice) }}</strong>
                    <span class="products-mobile-price-label">Selling price</span>
                  </div>
                  <div class="products-mobile-footer">
                    <span class="products-mobile-stock" :class="{ 'stock-empty': Number(product.currentStock) <= 0, 'stock-low': Number(product.currentStock) > 0 && Number(product.currentStock) <= Number(product.minimumStock) }">Stock: {{ formatQty(product.currentStock) }}</span>
                    <span class="badge" :class="product.status === 'Active' ? 'badge-success' : 'badge-danger'">{{ product.status }}</span>
                    <button type="button" class="products-mobile-action" :aria-label="'Actions for ' + (product.displayName || product.productName)" @click="openProductActions($event, product)">⋯</button>
                  </div>
                </div>
              </div>
              <div v-if="loading" class="products-mobile-loading" role="status">Loading products...</div>
              <div class="empty-state" v-if="!loading && filteredProducts.length === 0">No products yet. Click "Add Product".</div>
            </div>
          </template>

          <template v-else>
            <section class="lookup-hub lookup-management-page">
              <div class="lookup-hub-head">
                <div>
                  <h3>Category, Brand & Unit</h3>
                  <span class="bn-hint">পণ্যের ধরন, ব্র্যান্ড ও একক এক জায়গা থেকে পরিচালনা করুন</span>
                </div>
              </div>

              <div class="lookup-management-grid">
                <section class="lookup-management-panel">
                  <div class="lookup-management-title">
                    <div><h4>Product Categories</h4><span class="bn-hint">পণ্যের ধরন পরিচালনা করুন</span></div>
                  </div>
                  <div class="lookup-management-toolbar">
                    <input v-model="categoryManageSearch" class="search-input" type="search" placeholder="Search categories..." />
                    <button type="button" class="btn btn-primary" @click="openLookupSectionAdd('category')">+ Add Category</button>
                  </div>
                  <div class="table-scroll lookup-table-wrap">
                    <table class="lookup-management-table">
                      <thead><tr><th>Category</th><th>Status</th><th class="lookup-actions-head">Actions</th></tr></thead>
                      <tbody>
                        <tr v-if="lookupManageLoading"><td colspan="3" class="empty-state">Loading categories...</td></tr>
                        <tr v-for="item in filteredCategoryManageItems" :key="item.id">
                          <td><strong>{{ item.name }}</strong></td>
                          <td><span class="badge" :class="item.status === 'Active' ? 'badge-success' : 'badge-danger'">{{ item.status }}</span></td>
                          <td class="lookup-table-actions"><button class="btn btn-sm" @click="beginLookupEdit('category', item)">Edit</button><button class="btn btn-sm" @click="toggleLookupStatus('category', item)">{{ item.status === 'Active' ? 'Deactivate' : 'Activate' }}</button></td>
                        </tr>
                        <tr v-if="!lookupManageLoading && filteredCategoryManageItems.length === 0"><td colspan="3" class="empty-state">{{ categoryManageSearch ? 'No matching categories.' : 'No categories yet.' }}</td></tr>
                      </tbody>
                    </table>
                  </div>
                </section>

                <section class="lookup-management-panel">
                  <div class="lookup-management-title">
                    <div><h4>Product Brands</h4><span class="bn-hint">পণ্যের ব্র্যান্ড পরিচালনা করুন</span></div>
                  </div>
                  <div class="lookup-management-toolbar">
                    <input v-model="brandManageSearch" class="search-input" type="search" placeholder="Search brands..." />
                    <button type="button" class="btn btn-primary" @click="openLookupSectionAdd('brand')">+ Add Brand</button>
                  </div>
                  <div class="table-scroll lookup-table-wrap">
                    <table class="lookup-management-table">
                      <thead><tr><th>Brand</th><th>Status</th><th class="lookup-actions-head">Actions</th></tr></thead>
                      <tbody>
                        <tr v-if="lookupManageLoading"><td colspan="3" class="empty-state">Loading brands...</td></tr>
                        <tr v-for="item in filteredBrandManageItems" :key="item.id">
                          <td><strong>{{ item.name }}</strong></td>
                          <td><span class="badge" :class="item.status === 'Active' ? 'badge-success' : 'badge-danger'">{{ item.status }}</span></td>
                          <td class="lookup-table-actions"><button class="btn btn-sm" @click="beginLookupEdit('brand', item)">Edit</button><button class="btn btn-sm" @click="toggleLookupStatus('brand', item)">{{ item.status === 'Active' ? 'Deactivate' : 'Activate' }}</button></td>
                        </tr>
                        <tr v-if="!lookupManageLoading && filteredBrandManageItems.length === 0"><td colspan="3" class="empty-state">{{ brandManageSearch ? 'No matching brands.' : 'No brands yet.' }}</td></tr>
                      </tbody>
                    </table>
                  </div>
                </section>

                <section class="lookup-management-panel">
                  <div class="lookup-management-title">
                    <div><h4>Product Units</h4><span class="bn-hint">পণ্যের একক পরিচালনা করুন</span></div>
                  </div>
                  <div class="lookup-management-toolbar">
                    <input v-model="unitManageSearch" class="search-input" type="search" placeholder="Search units..." />
                    <button type="button" class="btn btn-primary" @click="openLookupSectionAdd('unit')">+ Add Unit</button>
                  </div>
                  <div class="table-scroll lookup-table-wrap">
                    <table class="lookup-management-table">
                      <thead><tr><th>Unit</th><th>Status</th><th class="lookup-actions-head">Actions</th></tr></thead>
                      <tbody>
                        <tr v-if="lookupManageLoading"><td colspan="3" class="empty-state">Loading units...</td></tr>
                        <tr v-for="item in filteredUnitManageItems" :key="item.id">
                          <td><strong>{{ item.name }}</strong></td>
                          <td><span class="badge" :class="item.status === 'Active' ? 'badge-success' : 'badge-danger'">{{ item.status }}</span></td>
                          <td class="lookup-table-actions"><button class="btn btn-sm" @click="beginLookupEdit('unit', item)">Edit</button><button class="btn btn-sm" @click="toggleLookupStatus('unit', item)">{{ item.status === 'Active' ? 'Deactivate' : 'Activate' }}</button></td>
                        </tr>
                        <tr v-if="!lookupManageLoading && filteredUnitManageItems.length === 0"><td colspan="3" class="empty-state">{{ unitManageSearch ? 'No matching units.' : 'No units yet.' }}</td></tr>
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </section>
          </template>
        </div>

        <DashboardPanel v-if="activeModule === 'dashboard'" ref="dashboardPanel" />
        <ProductTrackingPanel v-if="activeModule === 'tracking'" ref="productTrackingPanel" :can-edit="hasClientModulePermission('products','edit')" :can-add="hasClientModulePermission('products','add')" />
        <VendorPanel v-if="activeModule === 'vendors'" ref="vendorPanel" :auth-user="authUser" />
        <CustomersPanel v-if="activeModule === 'customers'" ref="customersPanel" :open-request="customerOpenRequest" />
        <PosPanel v-if="activeModule === 'pos'" ref="posPanel" :load-request="posLoadRequest" @update-finished="posLoadRequest=null" />
        <SalesPanel v-if="activeModule === 'sales'" ref="salesPanel" :open-request="salesOpenRequest" @open-pos="openSaleInPos" />
        <ExpensesPanel v-if="activeModule === 'expense'" ref="expensesPanel" :open-request="expenseOpenRequest" />
        <BankPanel v-if="activeModule === 'bank'" ref="bankPanel" :open-request="bankOpenRequest" />
        <ReportsPanel v-if="activeModule === 'reports'" ref="reportsPanel" />
        <DayBookPanel v-if="activeModule === 'daybook'" ref="daybookPanel" :can-source-action="canDayBookSourceAction" @open-source="handleDayBookOpenSource" />
        <FinancePanel v-if="activeModule === 'finance'" ref="financePanel" :open-request="financeOpenRequest" />
        <SettingsPanel v-if="activeModule === 'settings'" ref="settingsPanel" :auth-user="authUser" />

        <div v-if="activeModule === 'suppliers'" class="supplier-page">
          <div class="toolbar supplier-toolbar">
            <input class="search-input" v-model="supplierSearch" type="text" placeholder="Search by name or phone..." />
            <div class="toolbar-spacer"></div>
            <button class="btn btn-primary" @click="openAddSupplier">+ Add Supplier</button>
          </div>
          <div class="cash-session-note" v-if="!supplierActiveCashSession">Supplier payments follow the original SherERP rule and require an open POS cash session. <span class="bn-hint" style="display:inline;">POS চালু হলে পেমেন্ট করা যাবে।</span></div>
          <div class="card supplier-list-card" style="padding:0;">
            <div class="table-scroll">
              <table class="responsive-table supplier-table">
                <thead><tr><SortableHeader table-id="suppliers" column="name">Supplier</SortableHeader><SortableHeader table-id="suppliers" column="phone">Phone</SortableHeader><SortableHeader table-id="suppliers" column="address">Address</SortableHeader><SortableHeader table-id="suppliers" column="currentDue" type="number" class="num">Current Due</SortableHeader><SortableHeader table-id="suppliers" column="status">Status</SortableHeader><th></th></tr></thead>
                <tbody>
                  <tr v-for="supplier in $sortRows('suppliers', filteredSuppliers)" :key="supplier.id">
                    <td class="primary-cell"><button type="button" class="ledger-name-link" @click="openSupplierDetail(supplier)">{{ supplier.name }}</button></td>
                    <td>{{ supplier.phone || '' }}</td><td>{{ supplier.address || '' }}</td>
                    <td class="num mono"><span v-if="Number(supplier.currentDue||0) > 0" class="badge badge-danger">Due {{ formatMoney(supplier.currentDue) }}</span><span v-else-if="Number(supplier.currentDue||0) < 0" class="badge badge-success">Advance {{ formatMoney(Math.abs(Number(supplier.currentDue||0))) }}</span><span v-else class="badge badge-success">Settled {{ formatMoney(0) }}</span></td>
                    <td><span class="badge" :class="supplier.status === 'Active' ? 'badge-success' : 'badge-danger'">{{ supplier.status || 'Active' }}</span></td>
                    <td class="action-cell"><button class="btn btn-sm action-trigger" @click="openSupplierActions($event, supplier)">Actions</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="empty-state" v-if="filteredSuppliers.length === 0">No suppliers yet.</div>
          </div>
        </div>

        <div v-if="activeModule === 'purchase'" class="purchase-page legacy-purchase">
          <div class="tabs legacy-tabs">
            <button class="tab-btn" :class="{ active: purchaseTab === 'new' }" @click="purchaseTab = 'new'">New Purchase<span class="bn-hint">নতুন মাল কেনা</span></button>
            <button class="tab-btn" :class="{ active: purchaseTab === 'planner' }" @click="purchaseTab = 'planner'">Purchase Planner<span class="bn-hint">কী কী কিনবেন</span></button>
            <button class="tab-btn" :class="{ active: purchaseTab === 'history' }" @click="purchaseTab = 'history'">Purchase Invoice<span class="bn-hint">কেনার তালিকা</span></button>
            <button class="tab-btn" :class="{ active: purchaseTab === 'return' }" @click="purchaseTab = 'return'">Purchase Return<span class="bn-hint">কেনা মাল ফেরত</span></button>
          </div>

          <div v-if="purchaseTab === 'new'" class="tab-panel">
            <div class="card">
              <div v-if="purchaseForm.purchasePlanOrderId" class="success-banner" style="margin-bottom:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <strong>Supplier Order {{ purchaseForm.purchasePlanOrderId }} loaded.</strong>
                <span>Review received quantity, cost and payment, then Complete Purchase to post stock/accounting.</span>
                <button type="button" class="btn btn-sm" style="margin-left:auto;" @click="resetPurchaseForm">Cancel Conversion</button>
              </div>
              <div class="form-grid" style="margin-bottom:16px;">
                <div>
                  <label>Supplier * <span class="bn-hint" style="display:inline;">— সাপ্লায়ার</span></label>
                  <div style="display:flex; gap:8px;">
                    <select v-model="purchaseForm.supplierId" style="flex:1;" :disabled="Boolean(purchaseForm.purchasePlanOrderId)">
                      <option value="">Select supplier...</option>
                      <option v-for="supplier in suppliers" :key="supplier.id" :value="supplier.id">{{ supplier.name }}</option>
                    </select>
                    <button type="button" class="btn" :disabled="Boolean(purchaseForm.purchasePlanOrderId)" @click="quickSupplierVisible = !quickSupplierVisible">+ New</button>
                  </div>
                  <div v-if="quickSupplierVisible" style="display:flex; gap:8px; margin-top:8px;">
                    <input v-model.trim="quickSupplierName" type="text" placeholder="New supplier name" style="flex:1;" />
                    <button type="button" class="btn btn-primary" @click="saveQuickSupplier">Save</button>
                  </div>
                </div>
                <div>
                  <label>Purchase Date <span class="bn-hint" style="display:inline;">— কেনার তারিখ</span></label>
                  <AppDatePicker v-model="purchaseForm.date" aria-label="Purchase date" />
                </div>
                <div v-if="purchaseForm.date < todayIso">
                  <label>Reason for Backdating * <span class="bn-hint" style="display:inline;">— পুরনো তারিখের কারণ</span></label>
                  <input v-model.trim="purchaseForm.backdatedReason" type="text" placeholder="Why is this dated in the past?" />
                </div>
              </div>

              <label>Add Product <span class="bn-hint" style="display:inline;">— মাল যোগ করুন</span></label>
              <div class="combo-row">
                <div class="combo-wrap">
                  <ProductSearchSelect
                    v-model="purchaseProductPicker"
                    :items="filteredPurchaseProducts"
                    placeholder="Search any product..."
                    aria-label="Search purchase product"
                  />
                </div>
                <select v-model="purchaseCategoryFilter" style="flex:0 0 150px;">
                  <option value="">All categories</option>
                  <option v-for="category in categoryNames" :key="category" :value="category">{{ category }}</option>
                </select>
                <button type="button" class="btn" @click="addSelectedPurchaseLine">+ Add Line</button>
              </div>

              <div class="table-scroll">
                <table id="purLinesTable">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th class="num">Qty</th>
                      <th class="num">Unit Price</th>
                      <th class="num">Line Total</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <template v-for="(line, index) in purchaseForm.items" :key="index">
                      <tr>
                        <td>
                          <select v-model="line.productId" @change="onLineProductChange(index)">
                            <option value="">Select product...</option>
                            <option v-for="product in productOptions" :key="product.productId" :value="product.productId">{{ product.displayName || product.productName }}</option>
                          </select>
                          <span class="bn-hint">{{ selectedProductName(line.productId) }}</span>
                          <div v-if="purchaseLineNeedsTracking(line)" class="purchase-tracking-summary">
                            <span class="badge" :class="purchaseTrackingSummary(line).startsWith('Tracking complete')?'badge-success':'badge-warning'">{{ purchaseTrackingSummary(line) }}</span>
                            <button type="button" class="btn btn-sm" @click="purchaseTrackingOpenIndex = purchaseTrackingOpenIndex===index ? null : index">{{ purchaseTrackingOpenIndex===index?'Hide Tracking':'Add Tracking' }}</button>
                          </div>
                        </td>
                        <td class="num"><input v-model.number="line.qty" type="number" min="1" step="1" data-integer="true" style="width:90px; text-align:right;" /></td>
                        <td class="num"><input v-model.number="line.unitPrice" type="number" min="0" step="0.01" style="width:110px; text-align:right;" /></td>
                        <td class="num mono">{{ formatMoney(Number(line.qty || 0) * Number(line.unitPrice || 0)) }}</td>
                        <td class="row-actions"><button class="btn btn-sm btn-danger" @click="removePurchaseLine(index)">Remove</button></td>
                      </tr>
                      <tr v-if="purchaseTrackingOpenIndex===index && purchaseLineNeedsTracking(line)" class="purchase-tracking-row">
                        <td colspan="5">
                          <ProductTrackingEntry v-model="line.tracking" :product-name="line.productName" :quantity="Math.max(1,Math.round(Number(line.qty||1)))" :track-serial="!!purchaseLineProduct(line)?.trackSerial" :track-expiry="!!purchaseLineProduct(line)?.trackExpiry" />
                          <div class="tracking-note">You may leave this incomplete. The received quantity will be posted as <strong>Pending Tracking</strong> and will not be sellable until completed.</div>
                        </td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>
              <div class="empty-state" v-if="purchaseForm.items.length === 0">No lines yet — pick a product above.</div>

              <div class="purchase-bottom-grid">
                <div class="form-grid purchase-notes">
                  <div class="full">
                    <label>Notes <span class="bn-hint" style="display:inline;">— নোট</span></label>
                    <input v-model.trim="purchaseForm.notes" type="text" placeholder="Optional" />
                  </div>
                  <div>
                    <label>Payment Method * <span class="bn-hint" style="display:inline;">— কীভাবে টাকা দিলেন</span></label>
                    <select v-model="purchaseForm.paymentMethod">
                      <option value="Cash">Cash</option>
                      <option value="Bank">Bank</option>
                      <option value="Mobile Banking">Mobile Banking</option>
                    </select>
                  </div>
                  <div v-if="purchaseForm.paymentMethod === 'Bank' || purchaseForm.paymentMethod === 'Mobile Banking'">
                    <label>Bank Account * <span class="bn-hint" style="display:inline;">— ব্যাংক হিসাব</span></label>
                    <select v-model="purchaseForm.bankAccountId">
                      <option value="">Select bank account...</option>
                      <option v-for="account in bankAccounts" :key="account.id" :value="account.id">{{ account.name }}</option>
                    </select>
                  </div>
                </div>

                <div class="purchase-totals">
                  <div class="totals-row"><span>Subtotal <span class="bn-hint" style="display:inline;">— মোট টাকা</span></span><span class="v">{{ formatMoney(purchaseSubtotal) }}</span></div>
                  <div class="totals-row"><span>Discount <span class="bn-hint" style="display:inline;">— ডিস্কাউন্ট</span></span><input v-model.number="purchaseForm.discount" type="number" min="0" step="0.01" /></div>
                  <div class="totals-row grand"><span>Grand Total <span class="bn-hint" style="display:inline;">— সর্বমোট টাকা</span></span><span class="v">{{ formatMoney(purchaseGrandTotal) }}</span></div>
                  <div class="totals-row"><span>Paid Now <span class="bn-hint" style="display:inline;">— এখন কত দিলেন</span></span><input v-model.number="purchaseForm.paidAmount" type="number" min="0" step="0.01" /></div>
                  <div class="totals-row"><span>Due to Supplier <span class="bn-hint" style="display:inline;">— সাপ্লায়ারকে বাকি</span></span><span class="v">{{ formatMoney(purchaseDueAmount) }}</span></div>
                </div>
              </div>

              <div v-if="purchaseEditId" class="form-grid" style="margin-top:12px;"><div class="full"><label>Update Reason * <span class="bn-hint" style="display:inline;">— কেন পরিবর্তন করছেন</span></label><input v-model.trim="purchaseUpdateReason" type="text" placeholder="Reason required for purchase update" /></div></div>
              <div class="field-error" v-if="purchaseError">{{ purchaseError }}</div>
              <div style="text-align:right; margin-top:14px;">
                <button class="btn btn-primary btn-lg" :disabled="purchaseSaving" @click="savePurchase">{{ purchaseSaving ? 'Saving...' : (purchaseEditId ? 'Update Purchase' : 'Complete Purchase') }}</button>
              </div>
            </div>
          </div>

          <div v-if="purchaseTab === 'planner'" class="tab-panel">
            <PurchasePlannerPanel
              ref="purchasePlannerPanel"
              @create-product="openAddProductFromPlanner"
              @convert-order="convertPlannerOrderToPurchase"
            />
          </div>

          <div v-if="purchaseTab === 'history'" class="tab-panel">
            <div class="toolbar">
              <input class="search-input" v-model="purchaseSearch" type="text" placeholder="Search purchase #, supplier..." />
            </div>
            <div class="card" style="padding:0;">
              <div class="table-scroll">
                <table class="responsive-table purchase-history-table">
                  <thead>
                    <tr><SortableHeader table-id="purchase-history" column="purchaseId">Purchase ID</SortableHeader><SortableHeader table-id="purchase-history" column="purchaseDate" type="date">Date</SortableHeader><SortableHeader table-id="purchase-history" column="supplierName">Supplier</SortableHeader><SortableHeader table-id="purchase-history" column="grandTotal" type="number" class="num">Total</SortableHeader><SortableHeader table-id="purchase-history" column="paidAmount" type="number" class="num">Paid</SortableHeader><SortableHeader table-id="purchase-history" column="dueAmount" type="number" class="num">Due</SortableHeader><SortableHeader table-id="purchase-history" column="returnedAmount" type="number" class="num">Returned</SortableHeader><SortableHeader table-id="purchase-history" column="paymentStatus">Status</SortableHeader><th></th></tr>
                  </thead>
                  <tbody>
                    <tr v-if="filteredPurchases.length === 0"><td colspan="9">No purchases recorded yet.</td></tr>
                    <tr v-for="purchase in $sortRows('purchase-history', filteredPurchases)" :key="purchase.purchaseId">
                      <td data-label="Purchase ID" class="mono primary-cell"><strong>{{ purchase.purchaseId }}</strong></td>
                      <td data-label="Date">{{ formatDateShort(purchase.purchaseDate) }}</td>
                      <td data-label="Supplier">{{ purchase.supplierName }}</td>
                      <td data-label="Total" class="num mono">{{ formatMoney(purchase.grandTotal) }}</td>
                      <td data-label="Paid" class="num mono">{{ formatMoney(purchase.paidAmount) }}</td>
                      <td data-label="Due" class="num mono">{{ formatMoney(purchase.dueAmount) }}</td>
                      <td data-label="Returned" class="num mono">{{ formatMoney(purchase.returnedAmount) }}</td>
                      <td data-label="Status"><span class="badge" :class="purchase.dueAmount > 0 ? 'badge-danger' : 'badge-success'">{{ purchase.paymentStatus || purchase.status }}</span></td>
                      <td data-label="Actions" class="row-actions action-cell">
                        <button class="btn btn-sm action-trigger" @click="openPurchaseActions($event, purchase)">Actions</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div v-if="purchaseTab === 'return'" class="tab-panel">
            <div class="card">
              <h3>Purchase Return <span class="bn-hint" style="display:inline;">— কেনা মাল ফেরত</span></h3>
              <div class="form-grid" style="margin-top:12px;">
                <div>
                  <label>Purchase Invoice * <span class="bn-hint" style="display:inline;">— কেনার ইনভয়েস</span></label>
                  <select v-model="returnPurchaseId" @change="loadPurchaseForReturn">
                    <option value="">Select purchase...</option>
                    <option v-for="purchase in purchases" :key="purchase.purchaseId" :value="purchase.purchaseId">{{ purchase.purchaseId }} — {{ purchase.supplierName }} — {{ formatMoney(purchase.grandTotal) }}</option>
                  </select>
                </div>
                <div>
                  <label>Return Date <span class="bn-hint" style="display:inline;">— ফেরতের তারিখ</span></label>
                  <AppDatePicker v-model="returnDate" aria-label="Purchase return date" />
                </div>
                <div v-if="returnDate < todayIso">
                  <label>Backdated Reason * <span class="bn-hint" style="display:inline;">— পুরনো তারিখের কারণ</span></label>
                  <input v-model.trim="returnBackdatedReason" type="text" />
                </div>
                <div>
                  <label>Refund Method * <span class="bn-hint" style="display:inline;">— টাকা ফেরত / ক্রেডিট</span></label>
                  <select v-model="returnRefundMethod"><option value="Supplier Credit">Supplier Credit</option><option value="Cash">Cash Refund</option></select>
                </div>
                <div class="full">
                  <label>Return Reason * <span class="bn-hint" style="display:inline;">— ফেরতের কারণ</span></label>
                  <input v-model.trim="returnReason" type="text" placeholder="Example: damaged / wrong item / supplier return" />
                  <span class="bn-hint">Required. If empty, Notes will be used as the reason.</span>
                </div>
              </div>

              <div v-if="returnData" style="margin-top:14px;">
                <div class="summary-strip">
                  <span><strong>{{ returnData.purchaseId }}</strong></span>
                  <span>{{ returnData.supplierName }}</span>
                  <span>Grand: {{ formatMoney(returnData.grandTotal) }}</span>
                  <span>Already returned: {{ formatMoney(returnData.previouslyReturnedAmount) }}</span>
                </div>
                <div class="table-scroll">
                  <table>
                    <thead><tr><th>Product</th><th class="num">Bought</th><th class="num">Returned</th><th class="num">Available</th><th class="num">Return Qty</th><th class="num">Price</th><th class="num">Line Total</th></tr></thead>
                    <tbody>
                      <tr v-for="item in returnData.items" :key="item.productId">
                        <td>{{ item.productName }}</td>
                        <td class="num mono">{{ item.boughtQty }}</td>
                        <td class="num mono">{{ item.previouslyReturnedQty }}</td>
                        <td class="num mono">{{ item.availableQty }}</td>
                        <td class="num">
                          <input v-model.number="item.returnQty" type="number" min="0" :max="Math.floor(Number(item.availableQty || 0))" step="1" data-integer="true" style="width:90px; text-align:right;" />
                          <div v-if="item.trackSerial && Number(item.returnQty||0)>0" class="return-serial-picker">
                            <label v-for="serial in item.availableSerials||[]" :key="serial" class="serial-check"><input v-model="item.serialNumbers" type="checkbox" :value="serial" :disabled="!(item.serialNumbers||[]).includes(serial) && (item.serialNumbers||[]).length>=Math.round(Number(item.returnQty||0))" /> <span class="mono">{{serial}}</span></label>
                            <small>{{(item.serialNumbers||[]).length}} / {{Math.round(Number(item.returnQty||0))}} selected</small>
                          </div>
                        </td>
                        <td class="num mono">{{ formatMoney(item.unitPrice) }}</td>
                        <td class="num mono">{{ formatMoney(Number(item.returnQty || 0) * Number(item.unitPrice || 0)) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div class="purchase-totals" style="margin-left:auto; margin-top:12px; max-width:360px;">
                  <div class="totals-row grand"><span>Total Return</span><span class="v">{{ formatMoney(returnTotal) }}</span></div>
                </div>
                <div class="form-grid" style="margin-top:12px;"><div class="full"><label>Notes <span class="bn-hint" style="display:inline;">— নোট</span></label><input v-model.trim="returnNotes" type="text" placeholder="Optional details. If reason is blank, this will be used as reason." /></div></div>
                <div class="field-error" v-if="returnError">{{ returnError }}</div>
                <div style="text-align:right; margin-top:14px;"><button class="btn btn-primary btn-lg" :disabled="returnSaving" @click="savePurchaseReturn">{{ returnSaving ? 'Saving...' : 'Complete Purchase Return' }}</button></div>
              </div>

              <div class="section-title" style="margin-top:18px;">Return History <span class="bn-hint" style="display:inline;">— ফেরতের ইতিহাস</span></div>
              <div class="table-scroll"><table><thead><tr><SortableHeader table-id="purchase-returns" column="returnId">Return ID</SortableHeader><SortableHeader table-id="purchase-returns" column="returnDate" type="date">Date</SortableHeader><SortableHeader table-id="purchase-returns" column="purchaseId">Purchase</SortableHeader><SortableHeader table-id="purchase-returns" column="supplierName">Supplier</SortableHeader><SortableHeader table-id="purchase-returns" column="totalReturnAmount" type="number" class="num">Amount</SortableHeader><SortableHeader table-id="purchase-returns" column="refundMethod">Method</SortableHeader><SortableHeader table-id="purchase-returns" column="reason">Reason</SortableHeader></tr></thead><tbody><tr v-for="ret in $sortRows('purchase-returns', purchaseReturns)" :key="ret.returnId"><td class="mono">{{ ret.returnId }}</td><td>{{ formatDateShort(ret.returnDate) }}</td><td class="mono">{{ ret.purchaseId }}</td><td>{{ ret.supplierName }}</td><td class="num mono">{{ formatMoney(ret.totalReturnAmount) }}</td><td>{{ ret.refundMethod }}</td><td>{{ ret.reason }}</td></tr></tbody></table></div>
            </div>
          </div>
        </div>
    </AppShell>

    <div
      v-if="actionMenu"
      class="action-dropdown"
      :style="{ top: `${actionMenu.top}px`, left: `${actionMenu.left}px`, width: `${actionMenu.width}px` }"
      @click.stop
    >
      <template v-if="actionMenu.type === 'product' && actionMenu.product">
        <button @click="runAction(() => openEditProduct(actionMenu!.product!))">Edit</button>
        <button @click="runAction(() => openStock(actionMenu!.product!))">Stock</button>
        <button @click="runAction(() => openLots(actionMenu!.product!))">Lots</button>
        <button @click="runAction(() => toggleStatus(actionMenu!.product!))">{{ actionMenu.product.status === 'Active' ? 'Deactivate' : 'Activate' }}</button>
        <div class="action-dropdown-separator"></div>
        <button class="danger" @click="runAction(() => removeProduct(actionMenu!.product!))">Delete</button>
      </template>
      <template v-else-if="actionMenu.type === 'purchase' && actionMenu.purchase">
        <button @click="runAction(() => viewPurchase(actionMenu!.purchase!))">View</button>
        <button @click="runAction(() => editPurchase(actionMenu!.purchase!))">Edit</button>
        <button @click="runAction(() => startReturnFromPurchase(actionMenu!.purchase!))">Return</button>
        <div class="action-dropdown-separator"></div>
        <button class="danger" @click="runAction(() => openDeletePurchase(actionMenu!.purchase!))">Delete</button>
      </template>
      <template v-else-if="actionMenu.type === 'supplier' && actionMenu.supplier">
        <button @click="runAction(() => openSupplierDetail(actionMenu!.supplier!))">View</button>
        <button @click="runAction(() => openEditSupplier(actionMenu!.supplier!))">Edit</button>
        <button @click="runAction(() => toggleSupplierStatus(actionMenu!.supplier!))">{{ actionMenu.supplier.status === 'Active' ? 'Deactivate' : 'Activate' }}</button>
        <div class="action-dropdown-separator"></div>
        <button class="danger" @click="runAction(() => openDeleteSupplier(actionMenu!.supplier!))">Delete</button>
      </template>
      <template v-else-if="actionMenu.type === 'supplier-ledger' && actionMenu.supplierLedgerRow">
        <template v-if="actionMenu.supplierLedgerRow.type === 'Payment'">
          <button @click="runAction(() => openEditSupplierPayment(actionMenu!.supplierLedgerRow!))">Edit Payment</button>
          <div class="action-dropdown-separator"></div>
          <button class="danger" @click="runAction(() => openDeleteSupplierPayment(actionMenu!.supplierLedgerRow!))">Delete Payment</button>
        </template>
        <template v-else-if="actionMenu.supplierLedgerRow.type === 'Purchase' || actionMenu.supplierLedgerRow.type === 'Purchase Update'">
          <button class="danger" @click="runAction(() => openSupplierLedgerPurchaseDelete(actionMenu!.supplierLedgerRow!))">Delete Purchase</button>
        </template>
      </template>
    </div>

    <div class="modal-overlay" v-if="lookupManageModal" @click.self="closeLookupManageModal">
      <div class="modal lookup-manage-modal">
        <div class="modal-header">
          <div>
            <h3>{{ lookupManageModal.mode === 'add' ? 'Add' : 'Edit' }} {{ lookupManageModal.kind === 'category' ? 'Category' : lookupManageModal.kind === 'brand' ? 'Brand' : 'Unit' }}</h3>
            <span class="bn-hint">{{ lookupManageModal.kind === 'category' ? 'পণ্যের ধরন' : lookupManageModal.kind === 'brand' ? 'পণ্যের ব্র্যান্ড' : 'পণ্যের একক' }}</span>
          </div>
          <button type="button" class="modal-close" @click="closeLookupManageModal">✕</button>
        </div>
        <div class="modal-body">
          <label>{{ lookupManageModal.kind === 'category' ? 'Category Name' : lookupManageModal.kind === 'brand' ? 'Brand Name' : 'Unit Name' }} *</label>
          <input
            v-if="lookupManageModal.mode === 'add' && lookupManageModal.kind === 'category'"
            v-model.trim="categoryManageName"
            autofocus
            placeholder="e.g. Pipe, Electrical, Grocery"
            @keyup.enter="saveLookupManageModal"
            @keyup.esc="closeLookupManageModal"
          />
          <input
            v-else-if="lookupManageModal.mode === 'add' && lookupManageModal.kind === 'brand'"
            v-model.trim="brandManageName"
            autofocus
            placeholder="e.g. ACI, RFL, Samsung"
            @keyup.enter="saveLookupManageModal"
            @keyup.esc="closeLookupManageModal"
          />
          <input
            v-else-if="lookupManageModal.mode === 'add'"
            v-model.trim="unitManageName"
            autofocus
            placeholder="e.g. PCS, Feet, Kg"
            @keyup.enter="saveLookupManageModal"
            @keyup.esc="closeLookupManageModal"
          />
          <input
            v-else
            v-model.trim="lookupEditingName"
            autofocus
            :placeholder="lookupManageModal.kind === 'category' ? 'Category name' : lookupManageModal.kind === 'brand' ? 'Brand name' : 'Unit name'"
            @keyup.enter="saveLookupManageModal"
            @keyup.esc="closeLookupManageModal"
          />
        </div>
        <div class="modal-footer">
          <button type="button" class="btn" @click="closeLookupManageModal">Cancel</button>
          <button type="button" class="btn btn-primary" @click="saveLookupManageModal">Save {{ lookupManageModal.kind === 'category' ? 'Category' : lookupManageModal.kind === 'brand' ? 'Brand' : 'Unit' }}</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" v-if="modal === 'product'">
      <div class="modal">
        <div class="modal-header">
          <div><h3>{{ editingId ? 'Edit Product' : 'Add Product' }}</h3><span class="bn-hint">পণ্যের তথ্য</span></div>
          <button class="modal-close" @click="closeModal">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <div class="full">
              <label>Product Name *<br><span class="bn-hint" style="display:inline;">পণ্যের নাম</span></label>
              <input v-model.trim="form.productName" type="text" placeholder="e.g. PVC Pipe 1&quot;" />
            </div>
            <div class="quick-lookup-field">
              <label>Brand (optional)<br><span class="bn-hint" style="display:inline;">ব্র্যান্ড</span></label>
              <div class="select-plus-control"><AppSelect v-model="form.brand" :options="brandSelectOptions" placeholder="No brand" aria-label="Brand" /><button type="button" class="select-plus-button" aria-label="Quick add brand" title="Quick add brand" @click="openQuickLookup('brand')">+</button></div>
              <div class="quick-lookup-inline" v-if="quickLookupMode === 'brand'"><input v-model.trim="quickLookupName" placeholder="Type new brand" autofocus @keyup.enter="saveQuickLookup('brand')" /><button type="button" class="btn btn-primary" :disabled="quickLookupSaving" @click="saveQuickLookup('brand')">Add</button></div>
            </div>
            <div class="quick-lookup-field">
              <label>Category<br><span class="bn-hint" style="display:inline;">ধরন</span></label>
              <div class="select-plus-control"><AppSelect v-model="form.category" :options="categorySelectOptions" placeholder="No category" aria-label="Category" /><button type="button" class="select-plus-button" aria-label="Quick add category" title="Quick add category" @click="openQuickLookup('category')">+</button></div>
              <div class="quick-lookup-inline" v-if="quickLookupMode === 'category'"><input v-model.trim="quickLookupName" placeholder="Type new category" autofocus @keyup.enter="saveQuickLookup('category')" /><button type="button" class="btn btn-primary" :disabled="quickLookupSaving" @click="saveQuickLookup('category')">Add</button></div>
            </div>
            <div class="quick-lookup-field">
              <label>Unit<br><span class="bn-hint" style="display:inline;">একক</span></label>
              <div class="select-plus-control"><AppSelect v-model="form.unit" :options="unitSelectOptions" placeholder="No unit" aria-label="Unit" /><button type="button" class="select-plus-button" aria-label="Quick add unit" title="Quick add unit" @click="openQuickLookup('unit')">+</button></div>
              <div class="quick-lookup-inline" v-if="quickLookupMode === 'unit'"><input v-model.trim="quickLookupName" placeholder="Type new unit" autofocus @keyup.enter="saveQuickLookup('unit')" /><button type="button" class="btn btn-primary" :disabled="quickLookupSaving" @click="saveQuickLookup('unit')">Add</button></div>
            </div>
            <div>
              <label>Barcode (optional)<br><span class="bn-hint" style="display:inline;">বারকোড (ঐচ্ছিক)</span></label>
              <input v-model.trim="form.barcode" type="text" />
            </div>
            <div class="full">
              <label>Preferred Supplier (optional)<br><span class="bn-hint" style="display:inline;">সাধারণত যে সাপ্লায়ার থেকে কিনেন</span></label>
              <select v-model="form.preferredSupplierId">
                <option value="">No preferred supplier</option>
                <option v-for="supplier in suppliers" :key="supplier.id" :value="supplier.id">{{ supplier.name }}</option>
              </select>
            </div>
            <div>
              <label>Purchase Price *<br><span class="bn-hint" style="display:inline;">কেনা দাম</span></label>
              <input v-model.number="form.purchasePrice" type="number" min="0" step="0.01" />
            </div>
            <div>
              <label>Selling Price *<br><span class="bn-hint" style="display:inline;">বিক্রির দাম</span></label>
              <input v-model.number="form.sellingPrice" type="number" min="0" step="0.01" />
            </div>
            <div>
              <label>Opening / Current Stock *<br><span class="bn-hint" style="display:inline;">শুরুর/বর্তমান মজুদ</span></label>
              <input v-model.number="form.currentStock" type="number" min="0" step="1" />
            </div>
            <div>
              <label>Minimum Stock *<br><span class="bn-hint" style="display:inline;">সর্বনিম্ন মজুদ</span></label>
              <input v-model.number="form.minimumStock" type="number" min="0" step="1" />
            </div>

            <div class="full product-tracking-settings">
              <div class="section-title">Product Tracking <span class="bn-hint" style="display:inline;">— সিরিয়াল, এক্সপায়ারি ও ওয়ারেন্টি</span></div>
              <div class="tracking-toggle-grid">
                <label class="tracking-toggle"><input v-model="form.trackSerial" type="checkbox" /> <span><strong>Serial / IMEI</strong><small>Each physical unit has a unique serial/IMEI.</small></span></label>
                <label class="tracking-toggle"><input v-model="form.trackExpiry" type="checkbox" /> <span><strong>Expiry</strong><small>Stock is managed by expiry batch/lot.</small></span></label>
                <label class="tracking-toggle"><input v-model="form.trackWarranty" type="checkbox" /> <span><strong>Warranty</strong><small>Customer warranty starts from sale date.</small></span></label>
              </div>
              <div v-if="form.trackWarranty" class="warranty-period-row">
                <label>Default Warranty Period</label>
                <input v-model.number="form.warrantyPeriodValue" type="number" min="0" step="1" />
                <select v-model="form.warrantyPeriodUnit"><option>Days</option><option>Months</option><option>Years</option></select>
              </div>
              <div v-if="!editingId && Number(form.currentStock||0)>0 && (form.trackSerial || form.trackExpiry)" class="opening-tracking-box">
                <div class="tracking-inline-head"><strong>Opening Stock Tracking</strong><span class="bn-hint">Optional now. Missing quantity will stay Pending Tracking and cannot be sold until completed.</span></div>
                <ProductTrackingEntry v-model="form.openingTracking" :product-name="[form.brand,form.productName].filter(Boolean).join(' ')" :quantity="Math.max(0,Math.round(Number(form.currentStock||0)))" :track-serial="form.trackSerial" :track-expiry="form.trackExpiry" />
              </div>
              <div v-else-if="editingId && (form.trackSerial || form.trackExpiry)" class="tracking-note">Existing or newly added untracked quantity will appear in <strong>Product Tracking → Pending</strong> until serial/expiry information is completed.</div>
            </div>
          </div>
          <div class="field-error" v-if="formError">{{ formError }}</div>
        </div>
        <div class="modal-footer">
          <button class="btn" @click="closeModal">Cancel</button>
          <button class="btn btn-primary" @click="saveProduct" :disabled="saving">{{ saving ? 'Saving...' : 'Save Product' }}</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" v-if="modal === 'stock'">
      <div class="modal">
        <div class="modal-header">
          <h3>Adjust Stock <span class="bn-hint" style="display:inline;">— স্টক ঠিক করুন</span> — <span>{{ stockProduct?.productName }}</span></h3>
          <button class="modal-close" @click="closeModal">✕</button>
        </div>
        <div class="modal-body">
          <p style="color:var(--color-text-muted); font-size:13px;">Current stock: <strong>{{ formatQty(stockProduct?.currentStock) }}</strong>. Use a positive number to add stock, negative to remove.</p>
          <label>Adjustment</label>
          <input v-model.number="stockDelta" type="number" step="1" placeholder="e.g. 10 or -3" />
          <div style="height:10px;"></div>
          <label>Note</label>
          <input v-model.trim="stockNote" type="text" placeholder="Reason for adjustment" />
          <div class="field-error" v-if="stockError">{{ stockError }}</div>
        </div>
        <div class="modal-footer">
          <button class="btn" @click="closeModal">Cancel</button>
          <button class="btn btn-primary" @click="saveStockAdjustment">Save Adjustment</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" v-if="modal === 'lots'">
      <div class="modal modal-lg">
        <div class="modal-header">
          <h3>Stock Lots <span class="bn-hint" style="display:inline;">— কোন চালানের পণ্য</span> — <span>{{ lotsProduct?.productName }}</span></h3>
          <button class="modal-close" @click="closeModal">✕</button>
        </div>
        <div class="modal-body">
          <p style="color:var(--color-text-muted); font-size:13px;">Total remaining: <strong>{{ formatQty(lotsTotalQty) }}</strong> — Total stock value: <strong>{{ formatMoney(lotsTotalValue) }}</strong></p>
          <div class="table-scroll">
            <table>
              <thead><tr><SortableHeader table-id="stock-lots" column="lotId">Lot ID</SortableHeader><SortableHeader table-id="stock-lots" column="purchaseId">Source</SortableHeader><SortableHeader table-id="stock-lots" column="supplierName">Supplier</SortableHeader><SortableHeader table-id="stock-lots" column="purchaseDate" type="date">Date</SortableHeader><SortableHeader table-id="stock-lots" column="purchasePrice" type="number" class="num">Purchase Price</SortableHeader><SortableHeader table-id="stock-lots" column="originalQuantity" type="number" class="num">Original Qty</SortableHeader><SortableHeader table-id="stock-lots" column="remainingQuantity" type="number" class="num">Remaining Qty</SortableHeader><SortableHeader table-id="stock-lots" column="@mul:remainingQuantity,purchasePrice" type="number" class="num">Value</SortableHeader><th>Status</th></tr></thead>
              <tbody>
                <tr v-for="l in $sortRows('stock-lots', lots)" :key="l.lotId">
                  <td class="mono">{{ l.lotId }}</td><td class="mono">{{ l.purchaseId || '' }}</td><td>{{ l.supplierName || 'Unattributed' }}</td><td>{{ formatDateShort(l.purchaseDate) }}</td>
                  <td class="num mono">{{ formatMoney(l.purchasePrice) }}</td><td class="num mono">{{ l.originalQuantity }}</td><td class="num mono">{{ l.remainingQuantity }}</td><td class="num mono">{{ formatMoney(Number(l.remainingQuantity) * Number(l.purchasePrice)) }}</td>
                  <td><span class="badge" :class="Number(l.remainingQuantity) > 0 ? 'badge-success' : 'badge-danger'">{{ Number(l.remainingQuantity) > 0 ? 'Active' : 'Depleted' }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="empty-state" v-if="lots.length === 0">No lots recorded for this product yet.</div>
        </div>
        <div class="modal-footer"><button class="btn" @click="closeModal">Close</button></div>
      </div>
    </div>

    <div class="modal-overlay" v-if="modal === 'purchase' && selectedPurchase">
      <div class="modal modal-lg">
        <div class="modal-header">
          <h3>Purchase <span class="bn-hint" style="display:inline;">— কেনার বিস্তারিত</span> <span class="mono">{{ selectedPurchase.purchaseId }}</span></h3>
          <button class="modal-close" @click="closeModal">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-grid" style="margin-bottom:14px;">
            <div><label>Supplier <span class="bn-hint" style="display:inline;">— সাপ্লায়ার</span></label><div>{{ selectedPurchase.supplierName }}</div></div>
            <div><label>Date <span class="bn-hint" style="display:inline;">— তারিখ</span></label><div>{{ formatDateShort(selectedPurchase.purchaseDate) }}</div></div>
            <div><label>Payment Method <span class="bn-hint" style="display:inline;">— কীভাবে টাকা দিলেন</span></label><div>{{ selectedPurchase.paymentMethod || '-' }}</div></div>
            <div class="full"><label>Notes <span class="bn-hint" style="display:inline;">— নোট</span></label><div>{{ selectedPurchase.note || '-' }}</div></div>
          </div>
          <div class="table-scroll">
            <table>
              <thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Line Total</th></tr></thead>
              <tbody>
                <tr v-for="item in selectedPurchase.items" :key="`${selectedPurchase.purchaseId}-${item.productId}`">
                  <td>{{ item.productName }}</td><td class="num mono">{{ item.quantity }}</td><td class="num mono">{{ formatMoney(item.purchasePrice || item.unitPrice || 0) }}</td><td class="num mono">{{ formatMoney(item.lineTotal) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="purchase-totals modal-totals">
            <div class="totals-row"><span>Subtotal <span class="bn-hint" style="display:inline;">— মোট টাকা</span></span><span class="v">{{ formatMoney(selectedPurchase.subtotal) }}</span></div>
            <div class="totals-row"><span>Discount <span class="bn-hint" style="display:inline;">— ডিস্কাউন্ট</span></span><span class="v">{{ formatMoney(selectedPurchase.discount) }}</span></div>
            <div class="totals-row grand"><span>Grand Total <span class="bn-hint" style="display:inline;">— সর্বমোট টাকা</span></span><span class="v">{{ formatMoney(selectedPurchase.grandTotal) }}</span></div>
            <div class="totals-row"><span>Paid <span class="bn-hint" style="display:inline;">— কত দিলেন</span></span><span class="v">{{ formatMoney(selectedPurchase.paidAmount) }}</span></div>
            <div class="totals-row"><span>Due <span class="bn-hint" style="display:inline;">— বাকি</span></span><span class="v">{{ formatMoney(selectedPurchase.dueAmount) }}</span></div>
            <div class="totals-row"><span>Returned <span class="bn-hint" style="display:inline;">— ফেরত দেওয়া</span></span><span class="v">{{ formatMoney(selectedPurchase.returnedAmount) }}</span></div>
            <div class="totals-row grand"><span>Net Purchase <span class="bn-hint" style="display:inline;">— প্রকৃত কেনা</span></span><span class="v">{{ formatMoney(Number(selectedPurchase.grandTotal || 0) - Number(selectedPurchase.returnedAmount || 0)) }}</span></div>
          </div>
        </div>
        <div class="modal-footer"><button class="btn" @click="closeModal">Close</button></div>
      </div>
    </div>


    <div class="modal-overlay" v-if="modal === 'supplier'">
      <div class="modal">
        <div class="modal-header"><div><h3>{{ supplierEditingId ? 'Edit Supplier' : 'Add Supplier' }}</h3><span class="bn-hint">সাপ্লায়ারের তথ্য</span></div><button class="modal-close" @click="closeModal">✕</button></div>
        <div class="modal-body">
          <div class="form-grid">
            <div class="full"><label>Supplier Name *</label><input v-model.trim="supplierForm.name" type="text" /></div>
            <div><label>Phone</label><input v-model.trim="supplierForm.phone" type="text" /></div>
            <div><label>Opening Balance (Amount Owed)</label><input v-model.number="supplierForm.openingBalance" type="number" min="0" step="0.01" :disabled="!!supplierEditingId" /></div>
            <div class="full"><label>Address</label><input v-model.trim="supplierForm.address" type="text" /></div>
            <div class="full"><label>Notes</label><input v-model.trim="supplierForm.notes" type="text" /></div>
          </div>
          <div class="field-error" v-if="supplierFormError">{{ supplierFormError }}</div>
        </div>
        <div class="modal-footer"><button class="btn" @click="closeModal">Cancel</button><button class="btn btn-primary" @click="saveSupplier">Save Supplier</button></div>
      </div>
    </div>

    <div class="modal-overlay" v-if="modal === 'supplier-detail' && supplierDetail">
      <div class="modal modal-lg supplier-detail-modal">
        <div class="modal-header"><div><h3>{{ supplierDetail.supplier.name }}</h3><span class="bn-hint">সাপ্লায়ারের বাকি ও হিসাব</span></div><button class="modal-close" @click="closeModal">✕</button></div>
        <div class="modal-body">
          <div class="supplier-pay-row">
            <div class="supplier-current-balance">
              <div class="stat-label">Current Balance</div>
              <div v-if="Number(supplierDetail.supplier.currentDue||0) > 0" class="ledger-balance-status is-due">Due {{ formatMoney(supplierDetail.supplier.currentDue) }}</div>
              <div v-else-if="Number(supplierDetail.supplier.currentDue||0) < 0" class="ledger-balance-status is-advance">Advance {{ formatMoney(Math.abs(Number(supplierDetail.supplier.currentDue||0))) }}</div>
              <div v-else class="ledger-balance-status is-settled">Settled {{ formatMoney(0) }}</div>
            </div>
            <div><label>Pay Supplier</label><input v-model.number="supplierPaymentForm.amount" type="number" min="0" step="0.01" placeholder="Amount" /></div>
            <div><label>Payment Method</label><select v-model="supplierPaymentForm.method"><option>Cash</option><option>Bank</option><option>Mobile Banking</option></select></div>
            <div v-if="supplierPaymentNeedsBank"><label>{{ supplierPaymentForm.method === 'Mobile Banking' ? 'Mobile Banking Account *' : 'Bank Account *' }}</label><select v-model="supplierPaymentForm.bankAccountId"><option value="">Select account...</option><option v-for="b in bankAccounts" :key="b.id" :value="b.id">{{ b.name }}</option></select></div>
            <div><label>Note</label><input v-model.trim="supplierPaymentForm.notes" type="text" placeholder="Optional" /></div>
            <div><label>Payment Date</label><AppDatePicker v-model="supplierPaymentForm.date" aria-label="Supplier payment date" /></div>
            <button class="btn btn-primary supplier-pay-button" :disabled="!supplierActiveCashSession" @click="recordSupplierPayment">Pay</button>
            <div class="supplier-backdate" v-if="supplierPaymentIsBackdated"><label>Reason for Backdating *</label><input v-model.trim="supplierPaymentForm.backdatedReason" type="text" placeholder="Why is this dated in the past?" /></div>
          </div>
          <div class="field-error" v-if="supplierPaymentError">{{ supplierPaymentError }}</div>
          <h3 class="supplier-ledger-title">Ledger <span class="bn-hint" style="display:inline;">— সাপ্লায়ারের বাকি হিসাব</span></h3>
          <LedgerHistoryControls v-model:from="supplierLedgerFilters.from" v-model:to="supplierLedgerFilters.to" v-model:limit="supplierLedgerFilters.limit" :matching-count="supplierDetail.history.matchingCount" :returned-count="supplierDetail.history.returnedCount" :has-more="supplierDetail.history.hasMore" :loading="loading" @refresh="openSupplierDetail(supplierDetail.supplier)" />
          <div class="ledger-history-summary"><span>Opening: <strong>{{ formatMoney(supplierDetail.summary.displayedOpeningBalance) }}</strong></span><span>Debit / খরচ: <strong>{{ formatMoney(supplierDetail.summary.totalDebit) }}</strong></span><span>Credit / জমা: <strong>{{ formatMoney(supplierDetail.summary.totalCredit) }}</strong></span><span>Closing: <strong>{{ formatMoney(supplierDetail.summary.displayedClosingBalance) }}</strong></span></div>
          <div class="table-scroll"><table class="responsive-table supplier-ledger-table"><thead><tr><SortableHeader table-id="supplier-ledger" column="date" type="date">Date</SortableHeader><SortableHeader table-id="supplier-ledger" column="type">Type</SortableHeader><SortableHeader table-id="supplier-ledger" column="reference">Reference</SortableHeader><SortableHeader table-id="supplier-ledger" column="debit" type="number" class="num">Debit<br><span class="bn-hint" style="display:inline;">খরচ</span></SortableHeader><SortableHeader table-id="supplier-ledger" column="credit" type="number" class="num">Credit<br><span class="bn-hint" style="display:inline;">জমা</span></SortableHeader><SortableHeader table-id="supplier-ledger" column="balance" type="number" class="num">Balance</SortableHeader><th></th></tr></thead><tbody>
            <tr v-for="row in $sortRows('supplier-ledger', supplierDetail.ledger)" :key="row.ledgerId"><td>{{ formatDateShort(row.date) }}</td><td>{{ row.type }}</td><td class="mono">{{ row.reference }}</td><td class="num mono">{{ formatMoney(row.debit) }}</td><td class="num mono">{{ formatMoney(row.credit) }}</td><td class="num mono"><span v-if="Number(row.balance)>0" class="ledger-balance-pill is-due">Due {{ formatMoney(row.balance) }}</span><span v-else-if="Number(row.balance)<0" class="ledger-balance-pill is-advance">Advance {{ formatMoney(Math.abs(Number(row.balance))) }}</span><span v-else class="ledger-balance-pill is-settled">Settled {{ formatMoney(0) }}</span></td><td class="supplier-ledger-actions"><button v-if="row.type === 'Payment' || row.type === 'Purchase' || row.type === 'Purchase Update'" class="btn btn-sm action-trigger" @click="openSupplierLedgerActions($event, row)">Actions</button></td></tr>
          </tbody></table></div>
          <div class="empty-state" v-if="supplierDetail.ledger.length === 0">No transactions yet.</div>
        </div>
        <div class="modal-footer"><button class="btn" @click="exportSupplierLedger">Export CSV</button><button class="btn" @click="printSupplierLedger">Print</button><button class="btn" @click="closeModal">Close</button></div>
      </div>
    </div>

    <div class="modal-overlay" v-if="modal === 'supplier-payment-edit'">
      <div class="modal"><div class="modal-header"><h3>Edit Payment <span class="bn-hint" style="display:inline;">— খরচ ঠিক করুন</span></h3><button class="modal-close" @click="closeModal">✕</button></div><div class="modal-body"><div class="form-grid">
        <div><label>Date *</label><AppDatePicker v-model="supplierPaymentForm.date" aria-label="Supplier payment date" /></div><div><label>Amount *</label><input v-model.number="supplierPaymentForm.amount" type="number" min="0" step="0.01" /></div><div><label>Payment Method</label><select v-model="supplierPaymentForm.method"><option>Cash</option><option>Bank</option><option>Mobile Banking</option><option>Other</option></select></div><div v-if="supplierPaymentNeedsBank"><label>Bank Account *</label><select v-model="supplierPaymentForm.bankAccountId"><option value="">Select account...</option><option v-for="b in bankAccounts" :key="b.id" :value="b.id">{{ b.name }}</option></select></div><div class="full"><label>Note</label><input v-model.trim="supplierPaymentForm.notes" type="text" /></div>
      </div><div class="field-error" v-if="supplierPaymentError">{{ supplierPaymentError }}</div></div><div class="modal-footer"><button class="btn" @click="closeModal">Cancel</button><button class="btn btn-primary" @click="saveSupplierPaymentEdit">Save Changes</button></div></div>
    </div>

    <div class="modal-overlay" v-if="modal === 'supplier-delete' && supplierDeleteTarget"><div class="modal modal-sm"><div class="modal-header"><div><h3>Delete Supplier</h3><span class="bn-hint">{{ supplierDeleteTarget.name }}</span></div><button class="modal-close" @click="closeModal">✕</button></div><div class="modal-body"><p>Deletion is blocked when the supplier has a balance or purchase history. Use Deactivate instead.</p><label>Delete Reason *</label><input v-model.trim="supplierDeleteReason" type="text" /></div><div class="modal-footer"><button class="btn" @click="closeModal">Cancel</button><button class="btn btn-danger" @click="confirmDeleteSupplier">Delete</button></div></div></div>

    <div class="modal-overlay" v-if="modal === 'supplier-payment-delete' && supplierPaymentDeleteTarget"><div class="modal modal-sm"><div class="modal-header"><h3>Delete Payment</h3><button class="modal-close" @click="closeModal">✕</button></div><div class="modal-body"><label>Delete Reason *</label><input v-model.trim="supplierPaymentDeleteReason" type="text" /></div><div class="modal-footer"><button class="btn" @click="closeModal">Cancel</button><button class="btn btn-danger" @click="confirmDeleteSupplierPayment">Delete Payment</button></div></div></div>

    <div class="modal-overlay" v-if="modal === 'manage'">
      <div class="modal">
        <div class="modal-header">
          <div><h3>{{ manageMode === 'category' ? 'Manage Categories' : 'Manage Units' }}</h3><span class="bn-hint">যোগ বা বাদ দিন</span></div>
          <button class="modal-close" @click="closeModal">✕</button>
        </div>
        <div class="modal-body">
          <div style="display:flex; gap:8px;">
            <input v-model.trim="manageNewName" type="text" placeholder="New name" style="flex:1;" @keyup.enter="addLookup" />
            <button type="button" class="btn btn-primary" @click="addLookup">Add</button>
          </div>
          <div class="field-error" v-if="manageError">{{ manageError }}</div>
          <div style="height:12px;"></div>
          <table>
            <thead><tr><SortableHeader table-id="lookup-manage" column="name">Name</SortableHeader><th></th></tr></thead>
            <tbody>
              <tr v-for="item in $sortRows('lookup-manage', manageItems)" :key="item.id"><td>{{ item.name }}</td><td style="text-align:right;"><button class="btn btn-danger" @click="removeLookup(item)">Delete</button></td></tr>
            </tbody>
          </table>
          <div class="empty-state" v-if="manageItems.length === 0">None yet — add one above.</div>
        </div>
        <div class="modal-footer"><button class="btn" @click="closeModal">Close</button></div>
      </div>
    </div>
    </template>

    <div class="modal-overlay" v-if="modal === 'purchase-delete' && purchaseDeleteTarget">
      <div class="modal modal-sm">
        <div class="modal-header">
          <div><h3>Delete Purchase <span class="bn-hint" style="display:inline;">— কেনা ডিলিট</span></h3><span class="bn-hint">{{ purchaseDeleteTarget.purchaseId }}</span></div>
          <button class="modal-close" @click="closeModal">✕</button>
        </div>
        <div class="modal-body">
          <p>This follows the old SherERP rule: purchase can be deleted only if its stock is still unsold and no return exists.</p>
          <label>Delete Reason * <span class="bn-hint" style="display:inline;">— ডিলিট করার কারণ</span></label>
          <input v-model.trim="purchaseDeleteReason" type="text" placeholder="Required" />
        </div>
        <div class="modal-footer"><button class="btn" @click="closeModal">Cancel</button><button class="btn btn-danger" @click="confirmDeletePurchase">Delete Purchase</button></div>
      </div>
    </div>

  </div>
</template>
