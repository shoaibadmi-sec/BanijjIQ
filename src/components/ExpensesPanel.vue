<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import ModuleTabs from './ModuleTabs.vue';
import LedgerHistoryControls from './LedgerHistoryControls.vue';
import {
  addExpense,
  addExpenseCategory,
  addExpensePayee,
  cancelExpense,
  getExpenseBootstrap,
  getExpenseCategories,
  getExpenseDetail,
  getExpensePayeeLedger,
  getExpensePayees,
  getExpenses,
  setExpenseCategoryStatus,
  setExpensePayeeStatus,
  updateExpense,
  updateExpenseCategory,
  updateExpensePayee
} from '../api';
import { exportRowsToCsv, printRows } from '../utils/tableOutput';
import { sortRows } from '../utils/tableSorting';
import { useLedgerHistory } from '../composables/useLedgerHistory';
import type {
  BankAccount,
  ExpenseCategory,
  ExpenseForm,
  ExpensePayee,
  ExpensePayeeForm,
  ExpensePayeeLedgerResult,
  ExpenseRow
} from '../types';

type ExpenseTab = 'add' | 'list' | 'categories' | 'payees';
type ModalName = '' | 'view' | 'edit' | 'cancel' | 'category' | 'payee';

type ActionMenu = {
  kind: 'expense' | 'category' | 'payee';
  id: string;
  top: number;
  left: number;
  width: number;
};

const props = defineProps<{ openRequest?: { expenseId: string; action: 'view' | 'edit' | 'cancel'; nonce: number } | null }>();

const today = () => new Date().toISOString().slice(0, 10);
const activeTab = ref<ExpenseTab>('add');
const expenseTabs = [
  { key: 'add', label: 'Add Expense', hint: 'খরচ লিখুন' },
  { key: 'list', label: 'Expense List', hint: 'খরচের তালিকা' },
  { key: 'categories', label: 'Categories', hint: 'খরচের ধরন' },
  { key: 'payees', label: 'Payee Ledger', hint: 'পেয়ি লেজার' }
] as const;
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const message = ref('');
const currencySymbol = ref('৳');
const activeCashSession = ref(false);
const categories = ref<ExpenseCategory[]>([]);
const payees = ref<ExpensePayee[]>([]);
const bankAccounts = ref<BankAccount[]>([]);
const expenses = ref<ExpenseRow[]>([]);

const form = reactive<ExpenseForm>({
  date: today(), categoryId: '', payeeId: '', amount: 0, paymentMethod: 'Cash', bankAccountId: '',
  description: '', referenceNo: '', notes: '', backdatedReason: ''
});
const quickCategoryVisible = ref(false);
const quickCategoryName = ref('');

const search = ref('');
const dateFrom = ref('');
const dateTo = ref('');
const categoryFilter = ref('');
const paymentFilter = ref('');
const payeeFilter = ref('');

const modal = ref<ModalName>('');
const selectedExpense = ref<ExpenseRow | null>(null);
const detail = ref<ExpenseRow | null>(null);
const cancelReason = ref('');
const editForm = reactive<ExpenseForm>({
  date: today(), categoryId: '', payeeId: '', amount: 0, paymentMethod: 'Cash', bankAccountId: '',
  description: '', referenceNo: '', notes: '', backdatedReason: ''
});

const editingCategoryId = ref('');
const categoryForm = reactive({ name: '', description: '' });
const editingPayeeId = ref('');
const payeeForm = reactive<ExpensePayeeForm>({ name: '', phone: '', address: '', notes: '' });
const selectPayeeAfterSave = ref(false);
const selectedPayeeLedger = ref<ExpensePayeeLedgerResult | null>(null);
const { filters: ledgerFilters, reset: resetLedgerFilters } = useLedgerHistory();

const actionMenu = ref<ActionMenu | null>(null);

const activeCategories = computed(() => categories.value.filter(c => c.status === 'Active'));
const activePayees = computed(() => payees.value.filter(p => p.status === 'Active'));
const formNeedsBank = computed(() => form.paymentMethod === 'Bank' || form.paymentMethod === 'Mobile Banking');
const editNeedsBank = computed(() => editForm.paymentMethod === 'Bank' || editForm.paymentMethod === 'Mobile Banking');
const formBackdated = computed(() => !!form.date && form.date < today());

const filteredExpenses = computed(() => {
  const q = search.value.trim().toLowerCase();
  return expenses.value.filter(e => {
    if (q && !(`${e.expenseId} ${e.description} ${e.category} ${e.payeeName || ''} ${e.referenceNo}`.toLowerCase().includes(q))) return false;
    if (dateFrom.value && e.date < dateFrom.value) return false;
    if (dateTo.value && e.date > dateTo.value) return false;
    if (categoryFilter.value && e.categoryId !== categoryFilter.value) return false;
    if (payeeFilter.value && e.payeeId !== payeeFilter.value) return false;
    if (paymentFilter.value && e.paymentMethod !== paymentFilter.value) return false;
    return true;
  });
});

const filteredCategories = computed(() => {
  const q = search.value.trim().toLowerCase();
  return categories.value.filter(c => !q || c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
});

const filteredPayees = computed(() => {
  const q = search.value.trim().toLowerCase();
  return payees.value.filter(p => !q || `${p.name} ${p.phone} ${p.address}`.toLowerCase().includes(q));
});

const filteredPayeeLedger = computed(() => selectedPayeeLedger.value?.ledger || []);

const menuExpense = computed(() => actionMenu.value?.kind === 'expense' ? expenses.value.find(x => x.expenseId === actionMenu.value?.id) || null : null);
const menuCategory = computed(() => actionMenu.value?.kind === 'category' ? categories.value.find(x => x.id === actionMenu.value?.id) || null : null);
const menuPayee = computed(() => actionMenu.value?.kind === 'payee' ? payees.value.find(x => x.id === actionMenu.value?.id) || null : null);

function money(v: number) { return `${currencySymbol.value}${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function statusClass(status: string) { return status === 'Active' ? 'badge active' : 'badge cancelled'; }
function flash(text: string) { message.value = text; error.value = ''; setTimeout(() => { if (message.value === text) message.value = ''; }, 2400); }

async function bootstrap() {
  loading.value = true; error.value = '';
  try {
    const [b, list, cats, payeeList] = await Promise.all([getExpenseBootstrap(), getExpenses(), getExpenseCategories(), getExpensePayees()]);
    currencySymbol.value = b.currencySymbol || '৳';
    activeCashSession.value = b.activeCashSession;
    bankAccounts.value = b.bankAccounts;
    expenses.value = list.expenses;
    categories.value = cats.categories;
    payees.value = payeeList.payees;
  } catch (e) { error.value = e instanceof Error ? e.message : 'Failed to load expenses.'; }
  finally { loading.value = false; }
}

async function refreshCurrent() {
  if (activeTab.value === 'categories') {
    categories.value = (await getExpenseCategories()).categories;
  } else if (activeTab.value === 'payees') {
    payees.value = (await getExpensePayees()).payees;
    if (selectedPayeeLedger.value) selectedPayeeLedger.value = await getExpensePayeeLedger(selectedPayeeLedger.value.payee.id, ledgerFilters);
  } else if (activeTab.value === 'list') {
    expenses.value = (await getExpenses()).expenses;
  } else {
    const [b, c, p] = await Promise.all([getExpenseBootstrap(), getExpenseCategories(), getExpensePayees()]);
    activeCashSession.value = b.activeCashSession; bankAccounts.value = b.bankAccounts; categories.value = c.categories; payees.value = p.payees;
  }
}

function setExpenseTab(value: string): void { switchTab(value as ExpenseTab); }
function switchTab(tab: ExpenseTab) {
  activeTab.value = tab;
  search.value = '';
  error.value = '';
  message.value = '';
  closeActionMenu();
  if (tab !== 'payees') selectedPayeeLedger.value = null;
  void refreshCurrent();
}

async function saveExpense() {
  error.value = ''; message.value = '';
  if (!activeCashSession.value) { error.value = 'No active cash session. Start your day from POS before recording an expense.'; return; }
  if (!form.categoryId) { error.value = 'Choose an expense category.'; return; }
  if (!(form.amount > 0)) { error.value = 'Enter a valid expense amount.'; return; }
  if (formNeedsBank.value && !form.bankAccountId) { error.value = 'Select a bank/mobile banking account.'; return; }
  if (formBackdated.value && !(form.backdatedReason ?? '').trim()) { error.value = 'A reason is required when dating an expense in the past.'; return; }
  saving.value = true;
  try {
    await addExpense({ ...form });
    flash('Expense saved.');
    Object.assign(form, { date: today(), categoryId: form.categoryId, payeeId: '', amount: 0, paymentMethod: 'Cash', bankAccountId: '', description: '', referenceNo: '', notes: '', backdatedReason: '' });
    expenses.value = (await getExpenses()).expenses;
    payees.value = (await getExpensePayees()).payees;
  } catch (e) { error.value = e instanceof Error ? e.message : 'Could not save expense.'; }
  finally { saving.value = false; }
}

async function quickAddCategory() {
  const name = quickCategoryName.value.trim(); if (!name) return;
  try {
    const r = await addExpenseCategory({ name, description: '' });
    categories.value = (await getExpenseCategories()).categories;
    form.categoryId = r.id; quickCategoryName.value = ''; quickCategoryVisible.value = false;
  } catch (e) { error.value = e instanceof Error ? e.message : 'Could not add category.'; }
}

function positionMenu(btn: HTMLElement, width = 180) {
  const r = btn.getBoundingClientRect(); const gap = 8;
  let left = r.right - width;
  left = Math.max(gap, Math.min(left, window.innerWidth - width - gap));
  const below = window.innerHeight - r.bottom;
  const top = below > 190 ? r.bottom + 5 : Math.max(gap, r.top - 180);
  return { top, left, width };
}
function openExpenseMenu(ev: MouseEvent, row: ExpenseRow) {
  ev.stopPropagation(); const btn = ev.currentTarget as HTMLElement;
  actionMenu.value = actionMenu.value?.kind === 'expense' && actionMenu.value.id === row.expenseId ? null : { kind: 'expense', id: row.expenseId, ...positionMenu(btn) };
}
function openCategoryMenu(ev: MouseEvent, row: ExpenseCategory) {
  ev.stopPropagation(); const btn = ev.currentTarget as HTMLElement;
  actionMenu.value = actionMenu.value?.kind === 'category' && actionMenu.value.id === row.id ? null : { kind: 'category', id: row.id, ...positionMenu(btn, 165) };
}
function openPayeeMenu(ev: MouseEvent, row: ExpensePayee) {
  ev.stopPropagation(); const btn = ev.currentTarget as HTMLElement;
  actionMenu.value = actionMenu.value?.kind === 'payee' && actionMenu.value.id === row.id ? null : { kind: 'payee', id: row.id, ...positionMenu(btn, 175) };
}
function closeActionMenu() { actionMenu.value = null; }

async function viewExpense(id: string) {
  closeActionMenu(); error.value = '';
  try { detail.value = (await getExpenseDetail(id)).expense; modal.value = 'view'; }
  catch (e) { error.value = e instanceof Error ? e.message : 'Could not open expense.'; }
}
async function editExpense(id: string) {
  closeActionMenu(); error.value = '';
  try {
    const r = await getExpenseDetail(id); selectedExpense.value = r.expense;
    Object.assign(editForm, {
      date: r.expense.date, categoryId: r.expense.categoryId, payeeId: r.expense.payeeId || '', amount: r.expense.amount,
      paymentMethod: r.expense.paymentMethod, bankAccountId: r.expense.bankAccountId || '', description: r.expense.description || '',
      referenceNo: r.expense.referenceNo || '', notes: r.expense.notes || '', backdatedReason: ''
    });
    modal.value = 'edit';
  } catch (e) { error.value = e instanceof Error ? e.message : 'Could not edit expense.'; }
}
async function saveEdit() {
  if (!selectedExpense.value) return;
  error.value = '';
  if (!(editForm.amount > 0)) { error.value = 'Enter a valid expense amount.'; return; }
  if (!editForm.categoryId) { error.value = 'Choose an expense category.'; return; }
  if (editNeedsBank.value && !editForm.bankAccountId) { error.value = 'Select a bank/mobile banking account.'; return; }
  saving.value = true;
  try { await updateExpense(selectedExpense.value.expenseId, { ...editForm }); modal.value = ''; await bootstrap(); flash('Expense updated.'); }
  catch (e) { error.value = e instanceof Error ? e.message : 'Could not update expense.'; }
  finally { saving.value = false; }
}
function askCancel(row: ExpenseRow) { closeActionMenu(); selectedExpense.value = row; cancelReason.value = ''; modal.value = 'cancel'; }
async function confirmCancel() {
  if (!selectedExpense.value || !cancelReason.value.trim()) { error.value = 'A reason is required to delete an expense.'; return; }
  saving.value = true; error.value = '';
  try { await cancelExpense(selectedExpense.value.expenseId, cancelReason.value.trim()); modal.value = ''; await bootstrap(); flash('Expense deleted.'); }
  catch (e) { error.value = e instanceof Error ? e.message : 'Could not delete expense.'; }
  finally { saving.value = false; }
}

function addCategoryModal() { editingCategoryId.value = ''; Object.assign(categoryForm, { name: '', description: '' }); modal.value = 'category'; }
function editCategoryModal(row: ExpenseCategory) { closeActionMenu(); editingCategoryId.value = row.id; Object.assign(categoryForm, { name: row.name, description: row.description }); modal.value = 'category'; }
async function saveCategory() {
  error.value = ''; if (!categoryForm.name.trim()) { error.value = 'Category name is required.'; return; }
  saving.value = true;
  try {
    if (editingCategoryId.value) await updateExpenseCategory(editingCategoryId.value, { ...categoryForm });
    else await addExpenseCategory({ ...categoryForm });
    modal.value = ''; categories.value = (await getExpenseCategories()).categories; flash('Category saved.');
  } catch (e) { error.value = e instanceof Error ? e.message : 'Could not save category.'; }
  finally { saving.value = false; }
}
async function toggleCategory(row: ExpenseCategory) {
  closeActionMenu();
  try { await setExpenseCategoryStatus(row.id, row.status === 'Active' ? 'Inactive' : 'Active'); categories.value = (await getExpenseCategories()).categories; }
  catch (e) { error.value = e instanceof Error ? e.message : 'Could not update category.'; }
}

function addPayeeModal(selectAfterSave = false) {
  editingPayeeId.value = ''; selectPayeeAfterSave.value = selectAfterSave;
  Object.assign(payeeForm, { name: '', phone: '', address: '', notes: '' }); modal.value = 'payee';
}
function editPayeeModal(row: ExpensePayee) {
  closeActionMenu(); editingPayeeId.value = row.id; selectPayeeAfterSave.value = false;
  Object.assign(payeeForm, { name: row.name, phone: row.phone || '', address: row.address || '', notes: row.notes || '' }); modal.value = 'payee';
}
async function savePayee() {
  error.value = ''; if (!payeeForm.name.trim()) { error.value = 'Payee name is required.'; return; }
  saving.value = true;
  try {
    let savedId = editingPayeeId.value;
    if (editingPayeeId.value) await updateExpensePayee(editingPayeeId.value, { ...payeeForm });
    else savedId = (await addExpensePayee({ ...payeeForm })).id;
    payees.value = (await getExpensePayees()).payees;
    if (selectPayeeAfterSave.value) form.payeeId = savedId;
    modal.value = ''; flash('Payee saved.');
  } catch (e) { error.value = e instanceof Error ? e.message : 'Could not save payee.'; }
  finally { saving.value = false; }
}
async function togglePayee(row: ExpensePayee) {
  closeActionMenu();
  try { await setExpensePayeeStatus(row.id, row.status === 'Active' ? 'Inactive' : 'Active'); payees.value = (await getExpensePayees()).payees; }
  catch (e) { error.value = e instanceof Error ? e.message : 'Could not update payee.'; }
}
async function openPayeeLedger(row: ExpensePayee, resetFilters = true) {
  closeActionMenu(); error.value = ''; if (resetFilters) resetLedgerFilters();
  try { selectedPayeeLedger.value = await getExpensePayeeLedger(row.id, ledgerFilters); }
  catch (e) { error.value = e instanceof Error ? e.message : 'Could not load payee ledger.'; }
}

const payeeLedgerColumns = [
  { label: 'Date', key: 'date' as const },
  { label: 'Expense ID', key: 'expenseId' as const },
  { label: 'Category', key: 'category' as const },
  { label: 'Description', key: 'description' as const },
  { label: 'Payment', key: 'paymentMethod' as const },
  { label: 'Original', value: (r: ExpensePayeeLedgerResult['ledger'][number]) => money(r.amount), align: 'right' as const },
  { label: 'Net Paid', value: (r: ExpensePayeeLedgerResult['ledger'][number]) => money(r.netAmount), align: 'right' as const },
  { label: 'Running Paid', value: (r: ExpensePayeeLedgerResult['ledger'][number]) => money(r.runningPaid), align: 'right' as const },
  { label: 'Status', key: 'status' as const }
];
function printPayeeLedger(): void {
  if (!selectedPayeeLedger.value) return;
  const rows = sortRows('expense-payee-ledger', filteredPayeeLedger.value);
  const h = selectedPayeeLedger.value.history;
  printRows({
    title: 'Expense Payee Ledger',
    subtitle: selectedPayeeLedger.value.payee.name,
    businessHeader: selectedPayeeLedger.value.printHeader,
    contextLines: [`Date range: ${h.from || 'Beginning'} to ${h.to}`, `Showing ${h.returnedCount} of ${h.matchingCount} matching records · Limit ${h.limit}`],
    columns: payeeLedgerColumns,
    rows,
    footerLines: [
      { label: 'Paid in shown rows', value: money(selectedPayeeLedger.value.periodPaid) },
      { label: 'Cumulative Paid', value: money(selectedPayeeLedger.value.cumulativePaid) },
      { label: 'Transactions Shown', value: rows.length }
    ]
  });
}
function exportPayeeLedger(): void {
  if (!selectedPayeeLedger.value) return;
  exportRowsToCsv({
    filename: `expense-ledger-${selectedPayeeLedger.value.payee.name}-${ledgerFilters.from || 'beginning'}-${ledgerFilters.to}`,
    columns: payeeLedgerColumns,
    rows: sortRows('expense-payee-ledger', filteredPayeeLedger.value)
  });
}

function onDocClick() { closeActionMenu(); }
function onViewportChange() { closeActionMenu(); }

watch(() => props.openRequest?.nonce, async () => {
  const req = props.openRequest;
  if (!req?.expenseId) return;
  activeTab.value = 'list';
  try {
    if (!expenses.value.length) await bootstrap();
    if (req.action === 'edit') await editExpense(req.expenseId);
    else if (req.action === 'cancel') {
      const r = await getExpenseDetail(req.expenseId);
      if (String(r.expense.status || '').toLowerCase() !== 'active') {
        error.value = 'Only an active expense can be deleted.';
        return;
      }
      askCancel(r.expense);
    } else await viewExpense(req.expenseId);
  } catch (e) { error.value = e instanceof Error ? e.message : 'Could not open expense'; }
});

async function refresh(): Promise<void> {
  await refreshCurrent();
}
defineExpose({ refresh });

onMounted(() => { void bootstrap(); document.addEventListener('click', onDocClick); window.addEventListener('resize', onViewportChange); window.addEventListener('scroll', onViewportChange, true); });
onBeforeUnmount(() => { document.removeEventListener('click', onDocClick); window.removeEventListener('resize', onViewportChange); window.removeEventListener('scroll', onViewportChange, true); });
</script>

<template>
  <section class="expense-module">
    <ModuleTabs
      :model-value="activeTab"
      :tabs="expenseTabs"
      aria-label="Expense sections"
      @update:model-value="setExpenseTab"
    />

    <div v-if="error" class="notice error">{{ error }}</div>
    <div v-if="message" class="notice success">{{ message }}</div>
    <div v-if="loading" class="notice">Loading...</div>

    <template v-if="activeTab === 'add'">
      <div class="session-warning" v-if="!activeCashSession">Start your POS cash session before adding an expense. <span>খরচ এন্ট্রি করতে আগে POS cash session চালু করুন।</span></div>
      <div class="card expense-card">
        <h3>Add Expense <span class="bn">— নতুন খরচ লিখুন</span></h3>
        <div class="expense-form-grid">
          <div><label>Expense Date *<span>খরচের তারিখ</span></label><input v-model="form.date" type="date"></div>
          <div v-if="formBackdated"><label>Reason for Backdating *<span>পুরনো তারিখ কেন</span></label><input v-model.trim="form.backdatedReason" type="text" placeholder="Why is this dated in the past?"></div>
          <div><label>Expense Category *<span>খরচের ধরন</span></label><div class="inline-field"><select v-model="form.categoryId"><option value="">Select category...</option><option v-for="c in activeCategories" :key="c.id" :value="c.id">{{ c.name }}</option></select><button class="btn" type="button" @click="quickCategoryVisible=!quickCategoryVisible">+ New</button></div><div v-if="quickCategoryVisible" class="quick-add"><input v-model.trim="quickCategoryName" placeholder="New category name" @keyup.enter="quickAddCategory"><button class="btn btn-primary" @click="quickAddCategory">Save</button></div></div>
          <div><label>Payee <span>যাকে টাকা দেওয়া হয়েছে — ঐচ্ছিক</span></label><div class="inline-field"><select v-model="form.payeeId"><option value="">No payee / General expense</option><option v-for="p in activePayees" :key="p.id" :value="p.id">{{ p.name }}{{ p.phone ? ` — ${p.phone}` : '' }}</option></select><button class="btn" type="button" @click="addPayeeModal(true)">+ New</button></div></div>
          <div><label>Payment Method *<span>টাকা দেওয়ার মাধ্যম</span></label><select v-model="form.paymentMethod"><option>Cash</option><option>Bank</option><option>Mobile Banking</option><option>Other</option></select></div>
          <div v-if="formNeedsBank"><label>{{ form.paymentMethod === 'Mobile Banking' ? 'Mobile Banking Account *' : 'Bank Account *' }}<span>ব্যাংক/মোবাইল হিসাব</span></label><select v-model="form.bankAccountId"><option value="">Select account...</option><option v-for="b in bankAccounts" :key="b.id" :value="b.id">{{ b.name }}</option></select></div>
          <div><label>Amount *<span>পরিমাণ</span></label><input v-model.number="form.amount" type="number" min="0" step="0.01"></div>
          <div><label>Reference No.<span>রেফারেন্স নম্বর</span></label><input v-model.trim="form.referenceNo" placeholder="Optional"></div>
          <div class="full"><label>Description / Remarks<span>বিবরণ</span></label><input v-model.trim="form.description" placeholder="What is this expense for?"></div>
          <div class="full"><label>Notes<span>মন্তব্য</span></label><input v-model.trim="form.notes" placeholder="Optional"></div>
        </div>
        <div class="form-actions"><button class="btn btn-primary" :disabled="saving" @click="saveExpense">{{ saving ? 'Saving...' : 'Save Expense' }}</button></div>
      </div>
    </template>

    <template v-else-if="activeTab === 'list'">
      <div class="expense-toolbar">
        <input v-model="search" class="search-input" placeholder="Search expense #, payee or description...">
        <input v-model="dateFrom" type="date"><input v-model="dateTo" type="date">
        <select v-model="categoryFilter"><option value="">All categories</option><option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option></select>
        <select v-model="payeeFilter"><option value="">All payees</option><option v-for="p in payees" :key="p.id" :value="p.id">{{ p.name }}</option></select>
        <select v-model="paymentFilter"><option value="">All payment methods</option><option>Cash</option><option>Bank</option><option>Mobile Banking</option><option>Other</option></select>
        <button class="btn" @click="refreshCurrent">Refresh</button>
      </div>
      <div class="card table-card"><div class="table-scroll"><table class="expense-table"><thead><tr><SortableHeader table-id="expense-list" column="date" type="date">Date</SortableHeader><SortableHeader table-id="expense-list" column="expenseId">Expense ID</SortableHeader><SortableHeader table-id="expense-list" column="category">Category</SortableHeader><SortableHeader table-id="expense-list" column="payeeName">Payee</SortableHeader><SortableHeader table-id="expense-list" column="description">Description</SortableHeader><SortableHeader table-id="expense-list" column="amount" type="number" class="num">Amount</SortableHeader><SortableHeader table-id="expense-list" column="paymentMethod">Payment</SortableHeader><SortableHeader table-id="expense-list" column="status">Status</SortableHeader><th></th></tr></thead><tbody>
        <tr v-for="e in $sortRows('expense-list', filteredExpenses)" :key="e.expenseId"><td>{{ e.date }}</td><td class="mono">{{ e.expenseId }}</td><td>{{ e.category }}</td><td>{{ e.payeeName || '—' }}</td><td class="description-cell">{{ e.description || '—' }}</td><td class="num mono">{{ money(e.amount) }}</td><td>{{ e.paymentMethod }}</td><td><span :class="statusClass(e.status)">{{ e.status }}</span></td><td><button class="btn action-btn action-trigger" @click="openExpenseMenu($event,e)">Actions</button></td></tr>
      </tbody></table></div><div class="empty" v-if="!filteredExpenses.length">No expenses match these filters.</div></div>
    </template>

    <template v-else-if="activeTab === 'categories'">
      <div class="expense-toolbar"><input v-model="search" class="search-input" placeholder="Search categories..."><span class="toolbar-spacer"></span><button class="btn btn-primary" @click="addCategoryModal">+ Add Category</button></div>
      <div class="card table-card"><div class="table-scroll"><table class="expense-table"><thead><tr><SortableHeader table-id="expense-categories" column="name">Category</SortableHeader><SortableHeader table-id="expense-categories" column="description">Description</SortableHeader><SortableHeader table-id="expense-categories" column="status">Status</SortableHeader><th></th></tr></thead><tbody>
        <tr v-for="c in $sortRows('expense-categories', filteredCategories)" :key="c.id"><td><strong>{{ c.name }}</strong></td><td>{{ c.description || '—' }}</td><td><span :class="statusClass(c.status)">{{ c.status }}</span></td><td><button class="btn action-btn action-trigger" @click="openCategoryMenu($event,c)">Actions</button></td></tr>
      </tbody></table></div><div class="empty" v-if="!filteredCategories.length">No expense categories yet.</div></div>
    </template>

    <template v-else>
      <template v-if="!selectedPayeeLedger">
        <div class="expense-toolbar"><input v-model="search" class="search-input" placeholder="Search payee by name or phone..."><span class="toolbar-spacer"></span><button class="btn btn-primary" @click="addPayeeModal(false)">+ Add Payee</button></div>
        <div class="card table-card"><div class="table-scroll"><table class="expense-table"><thead><tr><SortableHeader table-id="expense-payees" column="name">Payee</SortableHeader><SortableHeader table-id="expense-payees" column="phone">Phone</SortableHeader><SortableHeader table-id="expense-payees" column="address">Address</SortableHeader><SortableHeader table-id="expense-payees" column="transactionCount" type="number" class="num">Transactions</SortableHeader><SortableHeader table-id="expense-payees" column="totalPaid" type="number" class="num">Total Paid</SortableHeader><SortableHeader table-id="expense-payees" column="status">Status</SortableHeader><th></th></tr></thead><tbody>
          <tr v-for="p in $sortRows('expense-payees', filteredPayees)" :key="p.id"><td><strong>{{ p.name }}</strong></td><td>{{ p.phone || '—' }}</td><td>{{ p.address || '—' }}</td><td class="num mono">{{ p.transactionCount }}</td><td class="num mono">{{ money(p.totalPaid) }}</td><td><span :class="statusClass(p.status)">{{ p.status }}</span></td><td><button class="btn action-btn action-trigger" @click="openPayeeMenu($event,p)">Actions</button></td></tr>
        </tbody></table></div><div class="empty" v-if="!filteredPayees.length">No payees yet. Add a payee when you need person/entity-wise expense history.</div></div>
      </template>

      <template v-else>
        <div class="payee-ledger-head">
          <button class="btn" @click="selectedPayeeLedger=null">← Payees</button>
          <div><strong>{{ selectedPayeeLedger.payee.name }}</strong><span>{{ selectedPayeeLedger.payee.phone || 'No phone' }}<template v-if="selectedPayeeLedger.payee.address"> · {{ selectedPayeeLedger.payee.address }}</template></span></div>
          <div class="ledger-summary"><span>Total Paid</span><strong>{{ money(selectedPayeeLedger.totalPaid) }}</strong></div>
          <div class="ledger-summary"><span>Transactions</span><strong>{{ selectedPayeeLedger.transactionCount }}</strong></div>
        </div>
        <LedgerHistoryControls v-model:from="ledgerFilters.from" v-model:to="ledgerFilters.to" v-model:limit="ledgerFilters.limit" :matching-count="selectedPayeeLedger.history.matchingCount" :returned-count="selectedPayeeLedger.history.returnedCount" :has-more="selectedPayeeLedger.history.hasMore" :loading="loading" @refresh="openPayeeLedger(selectedPayeeLedger.payee, false)" />
        <div class="expense-toolbar ledger-toolbar"><span class="toolbar-spacer"></span><button class="btn" @click="exportPayeeLedger">Export CSV</button><button class="btn" @click="printPayeeLedger">Print</button><button class="btn" @click="openPayeeLedger(selectedPayeeLedger.payee, false)">Refresh</button></div>
        <div class="card table-card"><div class="table-scroll"><table class="expense-table"><thead><tr><SortableHeader table-id="expense-payee-ledger" column="date" type="date">Date</SortableHeader><SortableHeader table-id="expense-payee-ledger" column="expenseId">Expense ID</SortableHeader><SortableHeader table-id="expense-payee-ledger" column="category">Category</SortableHeader><SortableHeader table-id="expense-payee-ledger" column="description">Description</SortableHeader><SortableHeader table-id="expense-payee-ledger" column="paymentMethod">Payment</SortableHeader><SortableHeader table-id="expense-payee-ledger" column="amount" type="number" class="num">Original</SortableHeader><SortableHeader table-id="expense-payee-ledger" column="netAmount" type="number" class="num">Net Paid</SortableHeader><SortableHeader table-id="expense-payee-ledger" column="runningPaid" type="number" class="num">Running Paid</SortableHeader><SortableHeader table-id="expense-payee-ledger" column="status">Status</SortableHeader></tr></thead><tbody>
          <tr v-for="row in $sortRows('expense-payee-ledger', filteredPayeeLedger)" :key="row.expenseId"><td>{{ row.date }}</td><td class="mono">{{ row.expenseId }}</td><td>{{ row.category }}</td><td class="description-cell">{{ row.description || '—' }}</td><td>{{ row.paymentMethod }}</td><td class="num mono">{{ money(row.amount) }}</td><td class="num mono">{{ money(row.netAmount) }}</td><td class="num mono"><strong>{{ money(row.runningPaid) }}</strong></td><td><span :class="statusClass(row.status)">{{ row.status }}</span></td></tr>
        </tbody></table></div><div class="empty" v-if="!filteredPayeeLedger.length">No expense transactions in this range.</div></div>
      </template>
    </template>

    <Teleport to="body">
      <div v-if="actionMenu" class="expense-action-menu" :style="{top:actionMenu.top+'px',left:actionMenu.left+'px',width:actionMenu.width+'px'}" @click.stop>
        <template v-if="actionMenu.kind==='expense'">
          <button @click="viewExpense(actionMenu.id)">View</button>
          <button :disabled="menuExpense?.status==='Cancelled'" @click="editExpense(actionMenu.id)">Edit</button>
          <button class="danger" :disabled="menuExpense?.status==='Cancelled' || !menuExpense" @click="menuExpense && askCancel(menuExpense)">Delete Expense</button>
        </template>
        <template v-else-if="actionMenu.kind==='category'">
          <button :disabled="!menuCategory" @click="menuCategory && editCategoryModal(menuCategory)">Edit</button>
          <button :disabled="!menuCategory" @click="menuCategory && toggleCategory(menuCategory)">{{ menuCategory?.status==='Active' ? 'Deactivate' : 'Activate' }}</button>
        </template>
        <template v-else>
          <button :disabled="!menuPayee" @click="menuPayee && openPayeeLedger(menuPayee)">View Ledger</button>
          <button :disabled="!menuPayee" @click="menuPayee && editPayeeModal(menuPayee)">Edit</button>
          <button :disabled="!menuPayee" @click="menuPayee && togglePayee(menuPayee)">{{ menuPayee?.status==='Active' ? 'Deactivate' : 'Activate' }}</button>
        </template>
      </div>
    </Teleport>

    <div class="modal-overlay" v-if="modal==='view' && detail"><div class="modal compact-modal"><div class="modal-header"><div><h3>Expense {{ detail.expenseId }}</h3><span class="bn">খরচের বিস্তারিত</span></div><button class="modal-close" @click="modal=''">✕</button></div><div class="modal-body detail-grid"><div><label>Date</label><b>{{ detail.date }}</b></div><div><label>Status</label><span :class="statusClass(detail.status)">{{ detail.status }}</span></div><div><label>Category</label><b>{{ detail.category }}</b></div><div><label>Payee</label><b>{{ detail.payeeName || '—' }}</b></div><div><label>Amount</label><b>{{ money(detail.amount) }}</b></div><div><label>Payment</label><b>{{ detail.paymentMethod }}</b></div><div><label>Account</label><b>{{ detail.bankAccountName || '—' }}</b></div><div><label>Reference</label><div>{{ detail.referenceNo || '—' }}</div></div><div class="full"><label>Description</label><div>{{ detail.description || '—' }}</div></div><div class="full"><label>Notes</label><div>{{ detail.notes || '—' }}</div></div><div class="full" v-if="detail.isBackdated"><label>Backdated Reason</label><div>{{ detail.backdatedReason }}</div></div></div><div class="modal-footer"><button class="btn" @click="modal=''">Close</button></div></div></div>

    <div class="modal-overlay" v-if="modal==='edit' && selectedExpense"><div class="modal"><div class="modal-header"><div><h3>Edit Expense</h3><span class="bn">খরচ ঠিক করুন</span></div><button class="modal-close" @click="modal=''">✕</button></div><div class="modal-body"><div class="expense-form-grid"><div><label>Date *</label><input v-model="editForm.date" type="date"></div><div><label>Category *</label><select v-model="editForm.categoryId"><option value="">Select...</option><option v-for="c in activeCategories" :key="c.id" :value="c.id">{{ c.name }}</option></select></div><div><label>Payee</label><select v-model="editForm.payeeId"><option value="">No payee / General expense</option><option v-for="p in payees" :key="p.id" :value="p.id" :disabled="p.status !== 'Active' && p.id !== editForm.payeeId">{{ p.name }}{{ p.status !== 'Active' ? ' — Inactive' : '' }}</option></select></div><div><label>Amount *</label><input v-model.number="editForm.amount" type="number" min="0" step="0.01"></div><div><label>Payment Method *</label><select v-model="editForm.paymentMethod"><option>Cash</option><option>Bank</option><option>Mobile Banking</option><option>Other</option></select></div><div v-if="editNeedsBank"><label>Account *</label><select v-model="editForm.bankAccountId"><option value="">Select...</option><option v-for="b in bankAccounts" :key="b.id" :value="b.id">{{ b.name }}</option></select></div><div><label>Reference No.</label><input v-model.trim="editForm.referenceNo"></div><div class="full"><label>Description</label><input v-model.trim="editForm.description"></div><div class="full"><label>Notes</label><input v-model.trim="editForm.notes"></div></div></div><div class="modal-footer"><button class="btn" @click="modal=''">Cancel</button><button class="btn btn-primary" :disabled="saving" @click="saveEdit">Save Changes</button></div></div></div>

    <div class="modal-overlay" v-if="modal==='cancel' && selectedExpense"><div class="modal compact-modal"><div class="modal-header"><h3>Delete Expense</h3><button class="modal-close" @click="modal=''">✕</button></div><div class="modal-body"><p>Expense <b>{{ selectedExpense.expenseId }}</b> will be removed from normal views. Its Cash/Bank movement will be safely reversed and the deletion will remain available in audit/Show deleted views.</p><label>Reason *</label><input v-model.trim="cancelReason" placeholder="Required"></div><div class="modal-footer"><button class="btn" @click="modal=''">Back</button><button class="btn btn-danger" :disabled="saving" @click="confirmCancel">Delete Expense</button></div></div></div>

    <div class="modal-overlay" v-if="modal==='category'"><div class="modal compact-modal"><div class="modal-header"><div><h3>{{ editingCategoryId ? 'Edit Category' : 'Add Category' }}</h3><span class="bn">খরচের ধরন</span></div><button class="modal-close" @click="modal=''">✕</button></div><div class="modal-body"><label>Category Name *</label><input v-model.trim="categoryForm.name" placeholder="e.g. Rent, Salary, Electricity"><label>Description</label><input v-model.trim="categoryForm.description" placeholder="Optional"></div><div class="modal-footer"><button class="btn" @click="modal=''">Cancel</button><button class="btn btn-primary" :disabled="saving" @click="saveCategory">Save Category</button></div></div></div>

    <div class="modal-overlay" v-if="modal==='payee'"><div class="modal compact-modal"><div class="modal-header"><div><h3>{{ editingPayeeId ? 'Edit Payee' : 'Add Payee' }}</h3><span class="bn">যাকে খরচের টাকা দেওয়া হয়</span></div><button class="modal-close" @click="modal=''">✕</button></div><div class="modal-body payee-form"><label>Payee Name *<span>নাম</span></label><input v-model.trim="payeeForm.name" placeholder="e.g. Belal, Landlord, Courier"><label>Phone<span>ফোন</span></label><input v-model.trim="payeeForm.phone" placeholder="Optional"><label>Address<span>ঠিকানা</span></label><input v-model.trim="payeeForm.address" placeholder="Optional"><label>Notes<span>মন্তব্য</span></label><input v-model.trim="payeeForm.notes" placeholder="Optional"></div><div class="modal-footer"><button class="btn" @click="modal=''">Cancel</button><button class="btn btn-primary" :disabled="saving" @click="savePayee">Save Payee</button></div></div></div>
  </section>
</template>

<style scoped>
.expense-module{min-width:0;display:grid;gap:10px}
.notice,.session-warning{padding:9px 11px;border-radius:8px;background:#eef4ff;font-size:13px}.notice.error{background:#feecec;color:#b42318}.notice.success{background:#ecfdf3;color:#027a48}.session-warning{background:#fff7e6;color:#8a4b00}.session-warning span{display:block;font-size:12px;opacity:.8}.expense-card{padding:16px}.expense-card h3{font-size:15px;margin:0 0 14px}.bn,label span{display:block;color:#6b7280;font-size:11px;font-weight:400;margin-top:2px}.expense-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.expense-form-grid .full{grid-column:1/-1}.expense-form-grid label,.modal-body label{font-size:12px;font-weight:700;color:#374151;display:block;margin-bottom:5px}.expense-form-grid input,.expense-form-grid select,.modal-body input,.modal-body select,.expense-toolbar input,.expense-toolbar select{width:100%;min-height:38px;border:1px solid #dbe2ea;border-radius:8px;padding:7px 10px;background:#fff}.inline-field,.quick-add{display:flex;gap:7px}.inline-field select,.quick-add input{flex:1;min-width:0}.quick-add{margin-top:7px}.form-actions{display:flex;justify-content:flex-end;margin-top:14px}.expense-toolbar{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.expense-toolbar .search-input{min-width:220px;flex:1}.expense-toolbar input[type=date]{max-width:145px}.expense-toolbar select{max-width:175px}.toolbar-spacer{flex:1}.table-card{padding:0;overflow:visible}.table-scroll{overflow-x:auto;overflow-y:visible;-webkit-overflow-scrolling:touch}.expense-table{width:100%;border-collapse:collapse;white-space:nowrap}.expense-table th,.expense-table td{padding:8px 9px;border-bottom:1px solid #e7ebf0;font-size:12px;text-align:left}.expense-table th{font-size:10px;text-transform:uppercase;color:#64748b;letter-spacing:.03em}.expense-table .num{text-align:right}.description-cell{max-width:260px;overflow:hidden;text-overflow:ellipsis}.mono{font-variant-numeric:tabular-nums}.badge{display:inline-block;padding:3px 8px;border-radius:999px;font-size:10px}.badge.active{background:#dcfce7;color:#15803d}.badge.cancelled{background:#fee2e2;color:#b91c1c}.action-btn{min-width:84px;padding:6px 9px}.empty{padding:24px;text-align:center;color:#64748b}.expense-action-menu{position:fixed;z-index:10050;background:#fff;border:1px solid #e2e8f0;border-radius:9px;box-shadow:0 12px 30px rgba(15,23,42,.18);padding:5px}.expense-action-menu button{display:block;width:100%;border:0;background:transparent;text-align:left;padding:9px 11px;border-radius:6px;font-size:13px;cursor:pointer}.expense-action-menu button:hover{background:#f1f5f9}.expense-action-menu button.danger{color:#dc2626;border-top:1px solid #eef2f7;margin-top:3px;border-radius:0 0 6px 6px}.expense-action-menu button:disabled{opacity:.4;cursor:not-allowed}.compact-modal{max-width:560px}.detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.detail-grid .full{grid-column:1/-1}.detail-grid label{display:block;font-size:11px;color:#64748b;text-transform:uppercase;margin-bottom:3px}.payee-form{display:grid;gap:10px}.payee-ledger-head{display:flex;align-items:center;gap:12px;border:1px solid var(--color-border);background:#fff;border-radius:9px;padding:10px 12px}.payee-ledger-head>div:nth-child(2){flex:1;min-width:0}.payee-ledger-head>div:nth-child(2)>span{display:block;font-size:11px;color:var(--color-text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ledger-summary{min-width:105px;text-align:right}.ledger-summary span{display:block;font-size:10px;color:var(--color-text-muted)}.ledger-summary strong{font-variant-numeric:tabular-nums}.ledger-toolbar{justify-content:flex-end}
@media(max-width:760px){.expense-form-grid,.detail-grid{grid-template-columns:1fr}.expense-form-grid .full,.detail-grid .full{grid-column:auto}.expense-toolbar{display:grid;grid-template-columns:1fr 1fr}.expense-toolbar .search-input,.expense-toolbar .toolbar-spacer{grid-column:1/-1}.expense-toolbar input[type=date],.expense-toolbar select{max-width:none}.expense-table th,.expense-table td{padding:7px 8px;font-size:11px}.expense-card{padding:12px}.form-actions .btn{width:100%}.payee-ledger-head{display:grid;grid-template-columns:auto 1fr}.payee-ledger-head>div:nth-child(2){min-width:0}.ledger-summary{text-align:left;min-width:0}.ledger-toolbar{grid-template-columns:1fr 1fr}.ledger-toolbar .toolbar-spacer{display:none}}
</style>
