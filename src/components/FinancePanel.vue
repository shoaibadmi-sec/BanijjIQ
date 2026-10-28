<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { notifySuccess, notifyError } from '../utils/notify';
import ModuleTabs from './ModuleTabs.vue';
import LedgerHistoryControls from './LedgerHistoryControls.vue';
import {
  addFinancePerson,
  addFinanceTransaction,
  deleteFinanceTransaction,
  getFinanceBootstrap,
  getFinanceLedger,
  getFinanceTransactionForEdit,
  setFinancePersonStatus,
  updateFinancePerson,
  updateFinanceTransaction
} from '../api';
import type { FinanceBootstrap, FinanceForm, FinanceLedgerResult, FinanceLedgerRow, FinancePerson } from '../types';
import { exportRowsToCsv, printRows } from '../utils/tableOutput';
import { sortRows } from '../utils/tableSorting';

type TabKey = 'entry' | 'ledger';
const props = defineProps<{ openRequest?: { tab?: TabKey; financeId?: string; date?: string; action?: 'view' | 'edit' | 'delete'; nonce: number } | null }>();

const today = new Date().toISOString().slice(0, 10);
const activeTab = ref<TabKey>('entry');
const tabs = [
  { key: 'entry', label: 'Capital & Loans', hint: 'মূলধন ও ঋণ' },
  { key: 'ledger', label: 'Finance Ledger', hint: 'ফাইন্যান্স লেজার' }
] as const;

const bootstrap = ref<FinanceBootstrap | null>(null);
const ledgerRows = ref<FinanceLedgerRow[]>([]);
const ledgerResult = ref<(FinanceLedgerResult & { ok: true }) | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const message = ref('');
const currencySymbol = computed(() => bootstrap.value?.currencySymbol || '৳');
const ownerCapital = ref(0);
const outstandingLoan = ref(0);

const form = reactive<FinanceForm>({
  date: today, transactionType: '', personId: '', paymentMethod: 'Cash', bankAccountId: '', amount: 0,
  referenceNo: '', notes: '', backdatedReason: ''
});
const formError = ref('');
const quickPersonOpen = ref(false);
const quickPerson = reactive({ name: '', personType: 'Owner' as 'Owner' | 'Lender' });

const manageOpen = ref(false);
const manageForm = reactive({ name: '', personType: 'Owner' as 'Owner' | 'Lender', description: '' });
const manageEditingId = ref<string | null>(null);
const manageEditForm = reactive({ name: '', personType: 'Owner' as 'Owner' | 'Lender', description: '' });
const manageError = ref('');

const filters = reactive({ dateFrom: '', dateTo: today, transactionType: '', personId: '', query: '', limit: 50 as 50 | 100 | 200 });
let filterTimer: ReturnType<typeof setTimeout> | null = null;

const viewRow = ref<FinanceLedgerRow | null>(null);
const editingId = ref<string | null>(null);
const editForm = reactive<FinanceForm>({
  date: today, transactionType: '', personId: '', paymentMethod: 'Cash', bankAccountId: '', amount: 0,
  referenceNo: '', notes: '', backdatedReason: ''
});
const editError = ref('');
const deleteTarget = ref<FinanceLedgerRow | null>(null);
const deleteReason = ref('');
const actionMenu = ref<{ row: FinanceLedgerRow; top: number; left: number; width: number } | null>(null);

const transactionTypes = computed(() => bootstrap.value?.transactionTypes || []);
const personsAll = computed(() => bootstrap.value?.personsAll || []);
const activePersons = computed(() => bootstrap.value?.persons || []);
const activeBankAccounts = computed(() => bootstrap.value?.bankAccounts || []);
const selectedType = computed(() => transactionTypes.value.find(t => t.key === form.transactionType));
const editType = computed(() => transactionTypes.value.find(t => t.key === editForm.transactionType));
const formIsBackdated = computed(() => !!form.date && form.date < today);
const editIsBackdated = computed(() => !!editForm.date && editForm.date < today);
const needsAccount = (method: string) => method === 'Bank' || method === 'Mobile Banking';
const desiredPersonType = (type: string): 'Owner' | 'Lender' => type.includes('Loan') ? 'Lender' : 'Owner';
const entryPersons = computed(() => activePersons.value.filter(p => !form.transactionType || p.type === desiredPersonType(form.transactionType)));
const editPersons = computed(() => personsAll.value.filter(p => p.type === desiredPersonType(editForm.transactionType)));
const formAccounts = computed(() => activeBankAccounts.value.filter(a => form.paymentMethod === 'Mobile Banking' ? a.type === 'Mobile Banking' : form.paymentMethod === 'Bank' ? a.type === 'Bank' : true));
const editAccounts = computed(() => activeBankAccounts.value.filter(a => editForm.paymentMethod === 'Mobile Banking' ? a.type === 'Mobile Banking' : editForm.paymentMethod === 'Bank' ? a.type === 'Bank' : true));
const entryHint = computed(() => {
  const t = selectedType.value;
  if (!t) return '';
  return t.direction === 'in'
    ? `This increases the selected Cash/Bank/Mobile Banking account and ${t.key.includes('Loan') ? 'the Outstanding Loan.' : 'Owner Capital.'}`
    : `This decreases the selected Cash/Bank/Mobile Banking account and ${t.key.includes('Loan') ? 'the Outstanding Loan.' : 'Owner Capital.'}`;
});

function money(v: unknown): string {
  return `${currencySymbol.value}${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
function showSuccess(text: string): void { message.value = ''; error.value = ''; notifySuccess(text); }
function showError(text: string): void { error.value = text; message.value = ''; notifyError(text); }

async function loadBootstrap(): Promise<void> {
  const d = await getFinanceBootstrap();
  bootstrap.value = d;
  ownerCapital.value = d.ownerCapital;
  outstandingLoan.value = d.outstandingLoan;
  if (!form.date) form.date = d.today || today;
}
async function loadLedger(): Promise<void> {
  const d = await getFinanceLedger(filters);
  ledgerRows.value = d.rows;
  ledgerResult.value = d;
  ownerCapital.value = d.ownerCapital;
  outstandingLoan.value = d.outstandingLoan;
}
async function loadAll(): Promise<void> {
  loading.value = true; error.value = '';
  try { await loadBootstrap(); if (activeTab.value === 'ledger') await loadLedger(); }
  catch (e) { showError(e instanceof Error ? e.message : 'Finance module failed to load.'); }
  finally { loading.value = false; }
}

function resetEntry(): void {
  Object.assign(form, { date: today, transactionType: '', personId: '', paymentMethod: 'Cash', bankAccountId: '', amount: 0, referenceNo: '', notes: '', backdatedReason: '' });
  formError.value = '';
}
async function saveEntry(): Promise<void> {
  formError.value = '';
  if (!bootstrap.value?.activeCashSession) { formError.value = 'Start the POS Cash Session before posting a finance transaction.'; return; }
  if (!form.transactionType) { formError.value = 'Choose a transaction type.'; return; }
  if (!form.personId) { formError.value = 'Choose the owner or lender.'; return; }
  if (!(Number(form.amount) > 0)) { formError.value = 'Enter a valid amount.'; return; }
  if (needsAccount(form.paymentMethod) && !form.bankAccountId) { formError.value = 'Choose the bank/mobile banking account.'; return; }
  if (formIsBackdated.value && !(form.backdatedReason || '').trim()) { formError.value = 'Reason for backdating is required.'; return; }
  saving.value = true;
  try {
    const d = await addFinanceTransaction({ ...form, amount: Number(form.amount) });
    ownerCapital.value = d.ownerCapital; outstandingLoan.value = d.outstandingLoan;
    showSuccess('Finance transaction saved'); resetEntry(); await loadBootstrap();
  } catch (e) { formError.value = e instanceof Error ? e.message : 'Could not save finance transaction.'; }
  finally { saving.value = false; }
}

watch(() => form.transactionType, (v) => {
  const want = desiredPersonType(v || '');
  if (form.personId && !activePersons.value.some(p => p.id === form.personId && p.type === want)) form.personId = '';
  quickPerson.personType = want;
});
watch(() => form.paymentMethod, () => { form.bankAccountId = ''; });
watch(() => editForm.paymentMethod, () => { editForm.bankAccountId = ''; });

async function saveQuickPerson(): Promise<void> {
  const name = quickPerson.name.trim(); if (!name) return;
  try {
    const r = await addFinancePerson({ name, personType: quickPerson.personType });
    await loadBootstrap(); form.personId = r.id; quickPerson.name = ''; quickPersonOpen.value = false; showSuccess('Person added');
  } catch (e) { formError.value = e instanceof Error ? e.message : 'Could not add person.'; }
}
async function addManagedPerson(): Promise<void> {
  manageError.value = '';
  if (!manageForm.name.trim()) { manageError.value = 'Person name is required.'; return; }
  try { await addFinancePerson({ name: manageForm.name.trim(), personType: manageForm.personType, notes: manageForm.description.trim() }); manageForm.name = ''; manageForm.description = ''; await loadBootstrap(); }
  catch (e) { manageError.value = e instanceof Error ? e.message : 'Could not add person.'; }
}
function beginEditPerson(p: FinancePerson): void {
  manageEditingId.value = p.id;
  manageEditForm.name = p.name;
  manageEditForm.personType = p.type;
  manageEditForm.description = p.notes || '';
  manageError.value = '';
}
function cancelEditPerson(): void {
  manageEditingId.value = null;
  manageEditForm.name = '';
  manageEditForm.description = '';
}
async function saveEditedPerson(p: FinancePerson): Promise<void> {
  manageError.value = '';
  if (!manageEditForm.name.trim()) { manageError.value = 'Person name is required.'; return; }
  try {
    await updateFinancePerson(p.id, { name: manageEditForm.name.trim(), personType: manageEditForm.personType, notes: manageEditForm.description.trim() });
    cancelEditPerson();
    await loadBootstrap();
    showSuccess('Owner / lender updated');
  } catch (e) { manageError.value = e instanceof Error ? e.message : 'Could not update person.'; }
}

async function togglePerson(p: FinancePerson): Promise<void> {
  try { await setFinancePersonStatus(p.id, p.status === 'Active' ? 'Inactive' : 'Active'); await loadBootstrap(); }
  catch (e) { manageError.value = e instanceof Error ? e.message : 'Could not update person.'; }
}

function scheduleLedgerLoad(): void {
  if (filterTimer) clearTimeout(filterTimer);
  filterTimer = setTimeout(() => void loadLedger(), 250);
}
watch(() => [filters.transactionType, filters.personId], () => { if (activeTab.value === 'ledger') void loadLedger(); });
watch(() => filters.query, () => { if (activeTab.value === 'ledger') scheduleLedgerLoad(); });
watch(activeTab, (tab) => { if (tab === 'ledger') void loadLedger(); });

function openActions(event: MouseEvent, row: FinanceLedgerRow): void {
  event.stopPropagation();
  const button = event.currentTarget as HTMLElement;
  const r = button.getBoundingClientRect(); const width = 170; const gap = 8;
  let left = Math.min(r.left, window.innerWidth - width - gap); left = Math.max(gap, left);
  let top = r.bottom + 5;
  if (top + 150 > window.innerHeight - gap) top = Math.max(gap, r.top - 150);
  actionMenu.value = { row, top, left, width };
}
function closeActions(): void { actionMenu.value = null; }
function outsideClick(e: Event): void { const t = e.target as HTMLElement | null; if (!t?.closest('.finance-action-menu,.finance-action-trigger')) closeActions(); }

function openView(row: FinanceLedgerRow): void { closeActions(); viewRow.value = row; }
async function openEdit(row: FinanceLedgerRow): Promise<void> {
  closeActions(); editError.value = '';
  try {
    const d = await getFinanceTransactionForEdit(row.financeId);
    editingId.value = row.financeId;
    Object.assign(editForm, d.transaction);
    viewRow.value = null;
  } catch (e) { showError(e instanceof Error ? e.message : 'Could not load transaction.'); }
}
async function saveEdit(): Promise<void> {
  editError.value = '';
  if (!editingId.value) return;
  if (!editForm.transactionType || !editForm.personId || !(Number(editForm.amount) > 0)) { editError.value = 'Complete all required fields.'; return; }
  if (needsAccount(editForm.paymentMethod) && !editForm.bankAccountId) { editError.value = 'Choose the bank/mobile account.'; return; }
  if (editIsBackdated.value && !(editForm.backdatedReason || '').trim()) { editError.value = 'Reason for backdating is required.'; return; }
  saving.value = true;
  try {
    const d = await updateFinanceTransaction(editingId.value, { ...editForm, amount: Number(editForm.amount) });
    ownerCapital.value = d.ownerCapital; outstandingLoan.value = d.outstandingLoan; editingId.value = null;
    showSuccess('Finance transaction updated'); await Promise.all([loadBootstrap(), loadLedger()]);
  } catch (e) { editError.value = e instanceof Error ? e.message : 'Update failed.'; }
  finally { saving.value = false; }
}
function askDelete(row: FinanceLedgerRow): void { closeActions(); deleteTarget.value = row; deleteReason.value = ''; }
async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value) return;
  if (!deleteReason.value.trim()) { showError('Enter a reason for deleting this transaction.'); return; }
  saving.value = true;
  try {
    const d = await deleteFinanceTransaction(deleteTarget.value.financeId, deleteReason.value.trim());
    ownerCapital.value = d.ownerCapital; outstandingLoan.value = d.outstandingLoan; deleteTarget.value = null;
    showSuccess('Finance transaction deleted and money movement reversed'); await Promise.all([loadBootstrap(), loadLedger()]);
  } catch (e) { showError(e instanceof Error ? e.message : 'Delete failed.'); }
  finally { saving.value = false; }
}

const financeLedgerColumns = [
  { label: 'Date', key: 'date' as const },
  { label: 'Finance ID', key: 'financeId' as const },
  { label: 'Type', key: 'transactionTypeLabel' as const },
  { label: 'Person', key: 'person' as const },
  { label: 'Method', key: 'paymentMethod' as const },
  { label: 'Debit (খরচ)', value: (r: FinanceLedgerRow) => r.debit ? money(r.debit) : '', align: 'right' as const },
  { label: 'Credit (জমা)', value: (r: FinanceLedgerRow) => r.credit ? money(r.credit) : '', align: 'right' as const },
  { label: 'Balance', value: (r: FinanceLedgerRow) => money(r.balance), align: 'right' as const },
  { label: 'Reference', key: 'referenceNo' as const },
  { label: 'By', key: 'createdBy' as const }
];
function printLedger(): void {
  if (!ledgerResult.value) return;
  const rows = sortRows('finance-ledger', ledgerRows.value);
  const h = ledgerResult.value.history;
  printRows({
    title: 'Finance Ledger',
    subtitle: 'Owner Capital & Loan Transactions',
    businessHeader: ledgerResult.value.printHeader,
    contextLines: [`Date range: ${h.from || 'Beginning'} to ${h.to}`, `Showing ${h.returnedCount} of ${h.matchingCount} matching records · Limit ${h.limit}`],
    columns: financeLedgerColumns,
    rows,
    footerLines: [
      { label: 'Capital Opening (shown rows)', value: money(ledgerResult.value.capitalSummary.openingBalance) },
      { label: 'Capital Closing (shown rows)', value: money(ledgerResult.value.capitalSummary.closingBalance) },
      { label: 'Loan Opening (shown rows)', value: money(ledgerResult.value.loanSummary.openingBalance) },
      { label: 'Loan Closing (shown rows)', value: money(ledgerResult.value.loanSummary.closingBalance) },
      { label: 'Current Owner Capital', value: money(ownerCapital.value) },
      { label: 'Current Outstanding Loan', value: money(outstandingLoan.value) }
    ]
  });
}
function exportLedger(): void {
  exportRowsToCsv({
    filename: `finance-ledger-${filters.dateFrom || 'beginning'}-${filters.dateTo || today}`,
    columns: financeLedgerColumns,
    rows: sortRows('finance-ledger', ledgerRows.value)
  });
}

watch(() => props.openRequest?.nonce, async () => {
  const req = props.openRequest; if (!req) return;
  activeTab.value = req.tab || 'ledger';
  if (req.date) { filters.dateFrom = req.date; filters.dateTo = req.date; filters.limit = 200; }
  if (activeTab.value === 'ledger') await loadLedger();
  if (req.financeId) {
    const row = ledgerRows.value.find(r => r.financeId === req.financeId);
    if (!row) { showError('Finance transaction was not found in the selected date range.'); return; }
    if (req.action === 'edit') await openEdit(row);
    else if (req.action === 'delete') askDelete(row);
    else openView(row);
  }
});

async function refresh(): Promise<void> {
  await loadBootstrap();
  if (activeTab.value === 'ledger') await loadLedger();
}
defineExpose({ refresh });

onMounted(() => { document.addEventListener('pointerdown', outsideClick); window.addEventListener('resize', closeActions); window.addEventListener('scroll', closeActions, true); void loadAll(); });
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outsideClick); window.removeEventListener('resize', closeActions); window.removeEventListener('scroll', closeActions, true); if (filterTimer) clearTimeout(filterTimer); });
</script>

<template>
  <section class="finance-page">
    <ModuleTabs v-model="activeTab" :tabs="tabs" aria-label="Finance sections" />

    <div v-if="message" class="alert success">{{ message }}</div>
    <div v-if="error" class="alert danger">{{ error }}</div>
    <div v-if="bootstrap && !bootstrap.activeCashSession" class="cash-session-note">Finance money postings follow the original SherERP rule and require an open POS Cash Session. <span class="bn-hint" style="display:inline;">POS ক্যাশ সেশন চালু করুন।</span></div>

    <div class="stat-grid finance-stats">
      <div class="stat-card"><div class="stat-label">Owner Capital</div><div class="stat-value">{{ money(ownerCapital) }}</div></div>
      <div class="stat-card"><div class="stat-label">Outstanding Loan</div><div class="stat-value">{{ money(outstandingLoan) }}</div></div>
      <div v-if="activeTab === 'ledger'" class="stat-card"><div class="stat-label">Entries Shown</div><div class="stat-value">{{ ledgerRows.length }}</div></div>
    </div>

    <div v-if="activeTab === 'entry'" class="card">
      <div class="form-grid">
        <div><label>Date *</label><input v-model="form.date" type="date" /></div>
        <div v-if="formIsBackdated"><label>Reason for Backdating *</label><input v-model.trim="form.backdatedReason" placeholder="Why is this dated in the past?" /></div>
        <div><label>Transaction Type *</label><select v-model="form.transactionType"><option value="">Select type...</option><option v-for="t in transactionTypes" :key="t.key" :value="t.key">{{ t.label }}</option></select></div>
        <div>
          <label>{{ form.transactionType.includes('Loan') ? 'Lender *' : 'Owner *' }}</label>
          <div class="inline-field-actions"><select v-model="form.personId"><option value="">Select person...</option><option v-for="p in entryPersons" :key="p.id" :value="p.id">{{ p.name }}</option></select><button class="btn" type="button" @click="quickPersonOpen=!quickPersonOpen">+ New</button><button class="btn" type="button" @click="manageOpen=true">Manage</button></div>
          <div v-if="quickPersonOpen" class="inline-quick-row"><input v-model.trim="quickPerson.name" placeholder="Name" /><select v-model="quickPerson.personType"><option>Owner</option><option>Lender</option></select><button class="btn btn-primary" type="button" @click="saveQuickPerson">Save</button></div>
        </div>
        <div><label>Payment Method *</label><select v-model="form.paymentMethod"><option>Cash</option><option>Bank</option><option>Mobile Banking</option></select></div>
        <div v-if="needsAccount(form.paymentMethod)"><label>{{ form.paymentMethod === 'Mobile Banking' ? 'Mobile Banking Account *' : 'Bank Account *' }}</label><select v-model="form.bankAccountId"><option value="">Select account...</option><option v-for="a in formAccounts" :key="a.id" :value="a.id">{{ a.name }}</option></select></div>
        <div><label>Amount *</label><input v-model.number="form.amount" type="number" min="0" step="0.01" /></div>
        <div><label>Reference No.</label><input v-model.trim="form.referenceNo" placeholder="Optional" /></div>
        <div class="full"><label>Notes</label><input v-model.trim="form.notes" placeholder="Optional" /></div>
      </div>
      <p class="finance-hint">{{ entryHint }}</p>
      <div v-if="formError" class="field-error">{{ formError }}</div>
      <div class="form-actions"><button class="btn btn-primary" :disabled="saving" @click="saveEntry">{{ saving ? 'Saving...' : 'Save Transaction' }}</button></div>
    </div>

    <div v-else>
      <div class="toolbar finance-filterbar">
        <select v-model="filters.transactionType"><option value="">All transaction types</option><option v-for="t in transactionTypes" :key="t.key" :value="t.key">{{ t.label }}</option></select>
        <select v-model="filters.personId"><option value="">All people</option><option v-for="p in personsAll" :key="p.id" :value="p.id">{{ p.name }}</option></select>
        <input v-model.trim="filters.query" class="search-input" placeholder="Search ID, reference, notes..." />
        <div class="toolbar-spacer"></div>
        <button class="btn" @click="exportLedger">Export</button><button class="btn" @click="printLedger">Print</button>
      </div>
      <LedgerHistoryControls v-model:from="filters.dateFrom" v-model:to="filters.dateTo" v-model:limit="filters.limit" :matching-count="ledgerResult?.history.matchingCount || 0" :returned-count="ledgerResult?.history.returnedCount || 0" :has-more="ledgerResult?.history.hasMore || false" :loading="loading" @refresh="loadLedger" />
      <div class="card" style="padding:0;">
        <div class="table-scroll">
          <table class="responsive-table finance-ledger-table">
            <thead><tr><SortableHeader table-id="finance-ledger" column="date" type="date">Date</SortableHeader><SortableHeader table-id="finance-ledger" column="financeId">Finance ID</SortableHeader><SortableHeader table-id="finance-ledger" column="transactionTypeLabel">Type</SortableHeader><SortableHeader table-id="finance-ledger" column="person">Person</SortableHeader><SortableHeader table-id="finance-ledger" column="paymentMethod">Method</SortableHeader><SortableHeader table-id="finance-ledger" column="debit" type="number" class="num">Debit<br><span class="bn-hint" style="display:inline;">খরচ</span></SortableHeader><SortableHeader table-id="finance-ledger" column="credit" type="number" class="num">Credit<br><span class="bn-hint" style="display:inline;">জমা</span></SortableHeader><SortableHeader table-id="finance-ledger" column="balance" type="number" class="num">Balance</SortableHeader><SortableHeader table-id="finance-ledger" column="createdBy">By</SortableHeader><th></th></tr></thead>
            <tbody>
              <tr v-for="r in $sortRows('finance-ledger', ledgerRows)" :key="r.financeId">
                <td>{{ r.date }} <span v-if="r.isBackdated" class="badge badge-warning" :title="r.backdatedReason">⚠</span></td><td class="mono">{{ r.financeId }}</td><td>{{ r.transactionTypeLabel }}</td><td>{{ r.person }}</td><td>{{ r.paymentMethod }}</td>
                <td class="num"><span v-if="r.debit" class="finance-money-out" title="Money out / টাকা বের হয়েছে" aria-label="Money out">↓ {{ money(r.debit) }}</span></td><td class="num"><span v-if="r.credit" class="finance-money-in" title="Money in / টাকা জমা হয়েছে" aria-label="Money in">↑ {{ money(r.credit) }}</span></td><td class="num mono">{{ money(r.balance) }}</td><td>{{ r.createdBy }}</td>
                <td class="action-cell"><button class="btn btn-sm action-trigger finance-action-trigger" @click="openActions($event,r)">Actions</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="!loading && ledgerRows.length===0" class="empty-state">No finance transactions match these filters.</div>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="actionMenu" class="action-dropdown finance-action-menu" :style="{position:'fixed',top:actionMenu.top+'px',left:actionMenu.left+'px',width:actionMenu.width+'px',zIndex:'10020'}" @pointerdown.stop>
        <button @click="openView(actionMenu.row)">View</button><button @click="openEdit(actionMenu.row)">Edit</button><div class="action-separator"></div><button class="danger" @click="askDelete(actionMenu.row)">Delete</button>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="manageOpen" class="modal-overlay finance-person-overlay" @click.self="manageOpen=false">
        <div class="modal finance-person-modal"><div class="modal-header"><h3>Manage Owners / Lenders <span class="bn-hint" style="display:inline;">— মালিক ও ঋণদাতার তালিকা</span></h3><button class="modal-close" @click="manageOpen=false">×</button></div>
          <div class="modal-body">
            <div class="finance-person-add">
              <div><label>Name *</label><input v-model.trim="manageForm.name" placeholder="Owner / lender name" /></div>
              <div><label>Type *</label><select v-model="manageForm.personType"><option>Owner</option><option>Lender</option></select></div>
              <div class="finance-person-description"><label>Description</label><input v-model.trim="manageForm.description" placeholder="Optional description" /></div>
              <button class="btn btn-primary" @click="addManagedPerson">Add</button>
            </div>
            <div v-if="manageError" class="field-error">{{ manageError }}</div>
            <div class="table-scroll"><table class="finance-person-table"><thead><tr><SortableHeader table-id="finance-persons" column="name">Name</SortableHeader><SortableHeader table-id="finance-persons" column="type">Type</SortableHeader><th>Description</th><SortableHeader table-id="finance-persons" column="status">Status</SortableHeader><th>Actions</th></tr></thead><tbody>
              <tr v-for="p in $sortRows('finance-persons', personsAll)" :key="p.id">
                <template v-if="manageEditingId===p.id">
                  <td><input v-model.trim="manageEditForm.name" /></td>
                  <td><select v-model="manageEditForm.personType"><option>Owner</option><option>Lender</option></select></td>
                  <td><input v-model.trim="manageEditForm.description" placeholder="Optional description" /></td>
                  <td><span class="badge" :class="p.status==='Active'?'badge-success':'badge-danger'">{{ p.status }}</span></td>
                  <td class="finance-person-row-actions"><button class="btn btn-sm btn-primary" @click="saveEditedPerson(p)">Save</button><button class="btn btn-sm" @click="cancelEditPerson">Cancel</button></td>
                </template>
                <template v-else>
                  <td>{{ p.name }}</td><td>{{ p.type }}</td><td>{{ p.notes || '—' }}</td><td><span class="badge" :class="p.status==='Active'?'badge-success':'badge-danger'">{{ p.status }}</span></td>
                  <td class="finance-person-row-actions"><button class="btn btn-sm" @click="beginEditPerson(p)">Edit</button><button class="btn btn-sm" @click="togglePerson(p)">{{ p.status==='Active'?'Deactivate':'Activate' }}</button></td>
                </template>
              </tr>
            </tbody></table></div>
          </div><div class="modal-footer"><button class="btn" @click="manageOpen=false">Close</button></div></div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="viewRow" class="modal-overlay" @click.self="viewRow=null"><div class="modal"><div class="modal-header"><h3>Finance Transaction <span class="mono">{{ viewRow.financeId }}</span></h3><button class="modal-close" @click="viewRow=null">×</button></div><div class="modal-body"><div class="form-grid detail-grid"><div><label>Date</label><div>{{ viewRow.date }}</div></div><div><label>Transaction Type</label><div>{{ viewRow.transactionTypeLabel }}</div></div><div><label>Person</label><div>{{ viewRow.person }}</div></div><div><label>Payment Method</label><div>{{ viewRow.paymentMethod }}</div></div><div v-if="needsAccount(viewRow.paymentMethod)"><label>Account</label><div>{{ viewRow.bankAccountName || '—' }}</div></div><div><label>Amount</label><div class="mono">{{ money(viewRow.amount) }}</div></div><div><label>Balance After</label><div class="mono">{{ money(viewRow.balance) }}</div></div><div><label>Reference No.</label><div>{{ viewRow.referenceNo || '—' }}</div></div><div><label>Created By</label><div>{{ viewRow.createdBy || '—' }}</div></div><div class="full"><label>Notes</label><div>{{ viewRow.notes || '—' }}</div></div></div></div><div class="modal-footer"><button class="btn" @click="viewRow=null">Close</button><button class="btn btn-primary" @click="openEdit(viewRow)">Edit</button></div></div></div>
    </Teleport>

    <Teleport to="body">
      <div v-if="editingId" class="modal-overlay" @click.self="editingId=null"><div class="modal"><div class="modal-header"><h3>Edit Finance Transaction <span class="mono">{{ editingId }}</span></h3><button class="modal-close" @click="editingId=null">×</button></div><div class="modal-body"><div class="form-grid"><div><label>Date *</label><input v-model="editForm.date" type="date" /></div><div v-if="editIsBackdated"><label>Backdated Reason *</label><input v-model.trim="editForm.backdatedReason" /></div><div><label>Transaction Type *</label><select v-model="editForm.transactionType"><option v-for="t in transactionTypes" :key="t.key" :value="t.key">{{ t.label }}</option></select></div><div><label>{{ editForm.transactionType.includes('Loan')?'Lender *':'Owner *' }}</label><select v-model="editForm.personId"><option value="">Select person...</option><option v-for="p in editPersons" :key="p.id" :value="p.id">{{ p.name }}{{ p.status==='Inactive'?' (inactive)':'' }}</option></select></div><div><label>Payment Method *</label><select v-model="editForm.paymentMethod"><option>Cash</option><option>Bank</option><option>Mobile Banking</option></select></div><div v-if="needsAccount(editForm.paymentMethod)"><label>Account *</label><select v-model="editForm.bankAccountId"><option value="">Select account...</option><option v-for="a in editAccounts" :key="a.id" :value="a.id">{{ a.name }}</option></select></div><div><label>Amount *</label><input v-model.number="editForm.amount" type="number" min="0" step="0.01" /></div><div><label>Reference No.</label><input v-model.trim="editForm.referenceNo" /></div><div class="full"><label>Notes</label><input v-model.trim="editForm.notes" /></div></div><div v-if="editError" class="field-error">{{ editError }}</div></div><div class="modal-footer"><button class="btn" @click="editingId=null">Cancel</button><button class="btn btn-primary" :disabled="saving" @click="saveEdit">Save Changes</button></div></div></div>
    </Teleport>

    <Teleport to="body"><div v-if="deleteTarget" class="modal-overlay" @click.self="deleteTarget=null"><div class="modal modal-sm"><div class="modal-header"><h3>Delete Finance Transaction</h3><button class="modal-close" @click="deleteTarget=null">×</button></div><div class="modal-body"><p><strong>{{ deleteTarget.financeId }}</strong> — {{ deleteTarget.transactionTypeLabel }} · {{ money(deleteTarget.amount) }}</p><label>Reason *</label><input v-model.trim="deleteReason" placeholder="Why is this transaction being deleted?" /></div><div class="modal-footer"><button class="btn" @click="deleteTarget=null">Cancel</button><button class="btn btn-danger" :disabled="saving" @click="confirmDelete">Delete & Reverse</button></div></div></div></Teleport>
  </section>
</template>


<style scoped>
.finance-stats{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:12px;
  margin:14px 0 16px;
}
.finance-stats .stat-card{
  background:#fff;
  border:1px solid #dbe3ef;
  border-radius:12px;
  padding:14px 16px;
  min-width:0;
  box-shadow:0 1px 2px rgba(15,23,42,.04);
}
.finance-stats .stat-label{
  margin-bottom:6px;
  color:var(--color-text-muted,#64748b);
  font-size:12px;
  font-weight:700;
  line-height:1.2;
  text-transform:uppercase;
  letter-spacing:.02em;
}
.finance-stats .stat-value{
  color:var(--color-text,#0f172a);
  font-size:22px;
  font-weight:800;
  line-height:1.2;
  overflow-wrap:anywhere;
}
.finance-hint{font-size:12px;color:var(--color-text-muted,#64748b);margin:10px 0 0}
.inline-field-actions{display:flex;gap:8px;align-items:center}
.inline-field-actions select{flex:1;min-width:0}
.inline-quick-row{
  display:grid;
  grid-template-columns:minmax(180px,1fr) 140px auto;
  gap:8px;
  align-items:center;
  margin-top:8px;
  width:100%;
}
.inline-quick-row input,.inline-quick-row select{
  width:100%;
  min-width:0;
  box-sizing:border-box;
}
.inline-quick-row .btn{white-space:nowrap}
.finance-filterbar input[type=date]{max-width:150px}
.finance-filterbar select{max-width:190px}
.form-actions{display:flex;justify-content:flex-end;margin-top:14px}
.detail-grid>div{min-height:46px}
.finance-ledger-table{min-width:980px}

.finance-person-add{display:grid;grid-template-columns:minmax(220px,1.35fr) minmax(150px,.7fr) minmax(260px,1.45fr) auto;gap:10px;align-items:end;margin-bottom:14px}
.finance-person-add>div{min-width:0}
.finance-person-add label{display:block;margin-bottom:6px}
.finance-person-add input,.finance-person-add select{width:100%}
.finance-person-add>.btn{min-height:46px;padding-inline:20px}
.finance-person-overlay{
  padding:20px;
  box-sizing:border-box;
}
.finance-person-modal{
  width:min(900px,calc(100vw - 40px));
  max-width:900px;
  min-width:0;
  margin:0 auto;
  overflow:hidden;
  box-sizing:border-box;
}
.finance-person-modal .modal-header,
.finance-person-modal .modal-body,
.finance-person-modal .modal-footer{
  width:100%;
  min-width:0;
  box-sizing:border-box;
}
.finance-person-modal .modal-body{
  overflow-x:hidden;
}
.finance-person-modal .table-scroll{
  width:100%;
  max-width:100%;
  min-width:0;
  overflow-x:hidden;
}
.finance-person-table{
  width:100%;
  max-width:100%;
  min-width:0;
  table-layout:fixed;
}
.finance-person-table th,
.finance-person-table td{
  min-width:0;
  box-sizing:border-box;
  vertical-align:middle;
}
.finance-person-table th:nth-child(1),
.finance-person-table td:nth-child(1){width:22%}
.finance-person-table th:nth-child(2),
.finance-person-table td:nth-child(2){width:15%}
.finance-person-table th:nth-child(3),
.finance-person-table td:nth-child(3){width:28%}
.finance-person-table th:nth-child(4),
.finance-person-table td:nth-child(4){width:13%}
.finance-person-table th:nth-child(5),
.finance-person-table td:nth-child(5){width:22%}
.finance-person-table input,
.finance-person-table select{
  width:100%;
  max-width:100%;
  min-width:0;
  box-sizing:border-box;
}
.finance-person-table td:not(.finance-person-row-actions){
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.finance-person-row-actions{
  display:flex;
  align-items:center;
  gap:6px;
  flex-wrap:nowrap;
  white-space:nowrap;
}
.finance-person-row-actions .btn{
  min-width:max-content;
  padding-inline:10px;
}

@media(max-width:900px){
  .finance-person-add{grid-template-columns:minmax(0,1fr) 180px}
  .finance-person-description{grid-column:1/2}
  .finance-person-add>.btn{grid-column:2/3}
  .finance-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
}

@media(max-width:700px){
  .finance-person-overlay{padding:10px}
  .finance-person-modal{
    width:100%;
    max-width:100%;
  }
  .finance-person-modal .table-scroll{
    overflow-x:visible;
  }
  .finance-person-table,
  .finance-person-table tbody,
  .finance-person-table tr,
  .finance-person-table td{
    display:block;
    width:100%!important;
  }
  .finance-person-table thead{display:none}
  .finance-person-table tr{
    border:1px solid #dbe3ef;
    border-radius:10px;
    padding:10px 12px;
    margin-bottom:10px;
    background:#fff;
  }
  .finance-person-table td{
    border:0;
    padding:5px 0;
    overflow:visible!important;
    text-overflow:clip!important;
    white-space:normal!important;
  }
  .finance-person-row-actions{
    padding-top:8px!important;
    flex-wrap:wrap;
  }
  .finance-person-add{grid-template-columns:1fr}
  .finance-person-description,.finance-person-add>.btn{grid-column:auto}
  .finance-person-add>.btn{width:100%}
  .inline-field-actions{align-items:stretch}
  .inline-field-actions .btn{padding-inline:9px}
  .inline-quick-row{grid-template-columns:minmax(0,1fr) 120px auto}
  .inline-quick-row input{min-width:0}
  .finance-filterbar{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .finance-filterbar>*{max-width:none!important;width:100%}
  .finance-filterbar .search-input{grid-column:1/-1}
  .finance-filterbar .toolbar-spacer{display:none}
}

@media(max-width:520px){
  .inline-quick-row{grid-template-columns:1fr}
  .inline-quick-row .btn{width:100%}
  .finance-stats{grid-template-columns:1fr;gap:8px;margin:10px 0 14px}
  .finance-stats .stat-card{padding:12px 14px}
  .finance-stats .stat-value{font-size:20px}
}
.finance-money-out { color: #b42318; font-weight: 600; white-space: nowrap; }
.finance-money-in { color: #087a4b; font-weight: 600; white-space: nowrap; }
</style>
