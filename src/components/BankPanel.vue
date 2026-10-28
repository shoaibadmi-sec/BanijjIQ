<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { notifySuccess, notifyError } from '../utils/notify';
import ModuleTabs from './ModuleTabs.vue';
import LedgerHistoryControls from './LedgerHistoryControls.vue';
import {
  addBankManualEntry,
  createBankAccount,
  getBankAccountsPage,
  getBankLedger,
  getBankLedgerBootstrap,
  getBankTransferHistory,
  reverseBankEntry,
  setBankAccountStatus,
  transferBetweenBankAccounts,
  updateBankAccount
} from '../api';
import { exportRowsToCsv, printRows } from '../utils/tableOutput';
import { sortRows } from '../utils/tableSorting';
import type {
  BankAccountForm,
  BankAccountFull,
  BankLedgerAccount,
  BankLedgerEntry,
  BankLedgerResult,
  BankManualEntryType,
  BankTransferRow
} from '../types';

type TabKey = 'accounts' | 'ledger' | 'manual' | 'transfers';

const props = defineProps<{ openRequest?: { tab?: TabKey; accountId?: string; entryId?: string; date?: string; action?: 'open' | 'reverse'; nonce: number } | null }>();

const today = new Date().toISOString().slice(0, 10);
const activeTab = ref<TabKey>('accounts');
const bankTabs = [
  { key: 'accounts', label: 'Accounts', hint: 'হিসাবের তালিকা' },
  { key: 'ledger', label: 'Ledger', hint: 'লেনদেনের হিসাব' },
  { key: 'manual', label: 'Manual Entry', hint: 'চার্জ, সুদ ইত্যাদি' },
  { key: 'transfers', label: 'Transfers', hint: 'হিসাব বদল' }
] as const;
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const message = ref('');
const currencySymbol = ref('৳');

const accounts = ref<BankAccountFull[]>([]);
const ledgerAccounts = ref<BankLedgerAccount[]>([]);
const entryTypes = ref<BankManualEntryType[]>([]);
const transfers = ref<BankTransferRow[]>([]);
const activeCashSession = ref(false);
const search = ref('');

const modalOpen = ref(false);
const editingId = ref<string | null>(null);
const accountForm = reactive<BankAccountForm>({
  name: '', accountType: 'Bank', bankName: '', accountNumber: '', openingBalance: 0, notes: ''
});
const accountFormError = ref('');

const actionMenu = ref<{ account: BankAccountFull; top: number; left: number; width: number } | null>(null);

const ledgerFilters = reactive({ bankAccountId: '', from: '', to: today, limit: 50 as 50 | 100 | 200 });
const ledger = ref<BankLedgerResult | null>(null);
const ledgerError = ref('');
const reverseTarget = ref<string | null>(null);
const reverseReason = ref('');

const manualForm = reactive({
  bankAccountId: '', entryType: '', amount: 0, date: today, direction: 'credit' as 'debit' | 'credit',
  reference: '', description: '', notes: '', backdatedReason: ''
});
const manualError = ref('');

const transferForm = reactive({ fromAccountId: '', toAccountId: '', amount: 0, notes: '' });
const transferError = ref('');

const filteredAccounts = computed(() => {
  const q = search.value.trim().toLowerCase();
  return accounts.value.filter((a) => !q || a.name.toLowerCase().includes(q) || a.bankName.toLowerCase().includes(q) || a.accountNumber.toLowerCase().includes(q));
});
const activeAccounts = computed(() => accounts.value.filter((a) => a.status === 'Active'));
const manualType = computed(() => entryTypes.value.find((t) => t.key === manualForm.entryType) || null);
const manualIsBackdated = computed(() => !!manualForm.date && manualForm.date < today);
const manualHint = computed(() => {
  const t = manualType.value;
  if (!t) return '';
  let text = t.direction === 'debit' ? 'This will SUBTRACT from the bank account balance.' : t.direction === 'credit' ? 'This will ADD to the bank account balance.' : 'Choose whether this adds to or subtracts from the account.';
  if (t.contra === 'cash') text += ' It also writes the matching Cash Book entry, so a cash session must be open.';
  return text;
});

function money(value: unknown): string {
  return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function showSuccess(text: string): void { message.value = ''; error.value = ''; notifySuccess(text); }
function showError(text: string): void { error.value = text; message.value = ''; notifyError(text); }

async function loadAccounts(): Promise<void> {
  const d = await getBankAccountsPage();
  accounts.value = d.bankAccounts;
  currencySymbol.value = d.currencySymbol || '৳';
}
async function loadBankBootstrap(): Promise<void> {
  const d = await getBankLedgerBootstrap();
  ledgerAccounts.value = d.accounts;
  entryTypes.value = d.entryTypes;
  activeCashSession.value = d.activeCashSession;
  currencySymbol.value = d.currencySymbol || currencySymbol.value;
  if (!ledgerFilters.bankAccountId && d.accounts.length === 1) ledgerFilters.bankAccountId = d.accounts[0].id;
  if (!manualForm.bankAccountId && d.accounts.length === 1) manualForm.bankAccountId = d.accounts[0].id;
}
async function loadTransfers(): Promise<void> {
  const d = await getBankTransferHistory();
  transfers.value = d.transfers;
}
async function loadAll(): Promise<void> {
  loading.value = true; error.value = '';
  try { await Promise.all([loadAccounts(), loadBankBootstrap(), loadTransfers()]); }
  catch (e) { showError(e instanceof Error ? e.message : 'Failed to load bank module'); }
  finally { loading.value = false; }
}

function setBankTab(value: string): void { switchTab(value as TabKey); }
function switchTab(tab: TabKey): void {
  activeTab.value = tab;
  actionMenu.value = null;
  if (tab === 'ledger' && ledgerFilters.bankAccountId) void loadLedger();
}

function openAdd(): void {
  editingId.value = null;
  Object.assign(accountForm, { name: '', accountType: 'Bank', bankName: '', accountNumber: '', openingBalance: 0, notes: '' });
  accountFormError.value = '';
  modalOpen.value = true;
}
function openEdit(account: BankAccountFull): void {
  editingId.value = account.id;
  Object.assign(accountForm, {
    name: account.name, accountType: account.accountType === 'Mobile Banking' ? 'Mobile Banking' : 'Bank',
    bankName: account.bankName, accountNumber: account.accountNumber,
    openingBalance: account.openingBalance, notes: account.notes
  });
  accountFormError.value = '';
  modalOpen.value = true;
}
async function saveAccount(): Promise<void> {
  accountFormError.value = '';
  if (!accountForm.name.trim()) { accountFormError.value = 'Account name is required.'; return; }
  saving.value = true;
  try {
    const payload: BankAccountForm = {
      name: accountForm.name.trim(), accountType: accountForm.accountType,
      bankName: accountForm.bankName.trim(), accountNumber: accountForm.accountNumber.trim(),
      openingBalance: Number(accountForm.openingBalance || 0), notes: accountForm.notes.trim()
    };
    if (editingId.value) await updateBankAccount(editingId.value, payload); else await createBankAccount(payload);
    modalOpen.value = false; showSuccess('Bank account saved'); await loadAll();
  } catch (e) { accountFormError.value = e instanceof Error ? e.message : 'Could not save bank account'; }
  finally { saving.value = false; }
}
async function toggleStatus(account: BankAccountFull): Promise<void> {
  const next = account.status === 'Active' ? 'Inactive' : 'Active';
  if (!confirm(`${next === 'Inactive' ? 'Deactivate' : 'Activate'} "${account.name}"?`)) return;
  try { await setBankAccountStatus(account.id, next); showSuccess('Bank account updated'); await loadAll(); }
  catch (e) { showError(e instanceof Error ? e.message : 'Could not update account'); }
}
function openLedgerFor(account: BankAccountFull): void {
  ledgerFilters.bankAccountId = account.id; activeTab.value = 'ledger'; actionMenu.value = null; void loadLedger();
}
function openActions(event: MouseEvent, account: BankAccountFull): void {
  event.stopPropagation();
  const btn = event.currentTarget as HTMLElement;
  const rect = btn.getBoundingClientRect(); const width = 190; let left = rect.left;
  if (left + width > window.innerWidth - 10) left = Math.max(10, window.innerWidth - width - 10);
  actionMenu.value = { account, top: rect.bottom + 6, left, width };
}

async function loadLedger(): Promise<void> {
  ledgerError.value = '';
  if (!ledgerFilters.bankAccountId) { ledger.value = null; return; }
  try {
    const d = await getBankLedger({ ...ledgerFilters });
    ledger.value = d;
  } catch (e) { ledgerError.value = e instanceof Error ? e.message : 'Failed to load ledger'; }
}
function askReverse(entryId: string): void { reverseTarget.value = entryId; reverseReason.value = ''; }
async function confirmReverse(): Promise<void> {
  if (!reverseTarget.value) return;
  if (!reverseReason.value.trim()) { ledgerError.value = 'A reason is required to reverse an entry.'; return; }
  try {
    await reverseBankEntry(reverseTarget.value, reverseReason.value.trim());
    reverseTarget.value = null; reverseReason.value = ''; showSuccess('Entry reversed'); await Promise.all([loadLedger(), loadAccounts()]);
  } catch (e) { ledgerError.value = e instanceof Error ? e.message : 'Could not reverse entry'; }
}

async function saveManual(): Promise<void> {
  manualError.value = '';
  if (!manualForm.bankAccountId) { manualError.value = 'Choose a bank account.'; return; }
  if (!manualForm.entryType) { manualError.value = 'Choose an entry type.'; return; }
  if (Number(manualForm.amount) <= 0) { manualError.value = 'Enter a valid amount greater than zero.'; return; }
  if (manualIsBackdated.value && !manualForm.backdatedReason.trim()) { manualError.value = 'A reason is required when dating this entry in the past.'; return; }
  saving.value = true;
  try {
    await addBankManualEntry({
      bankAccountId: manualForm.bankAccountId, entryType: manualForm.entryType, amount: Number(manualForm.amount),
      date: manualForm.date, direction: manualForm.direction, reference: manualForm.reference.trim(),
      description: manualForm.description.trim(), notes: manualForm.notes.trim(), backdatedReason: manualForm.backdatedReason.trim()
    });
    Object.assign(manualForm, { amount: 0, reference: '', description: '', notes: '', backdatedReason: '' });
    showSuccess('Bank entry recorded'); await loadAll();
    if (ledgerFilters.bankAccountId === manualForm.bankAccountId) await loadLedger();
  } catch (e) { manualError.value = e instanceof Error ? e.message : 'Could not record bank entry'; }
  finally { saving.value = false; }
}

async function saveTransfer(): Promise<void> {
  transferError.value = '';
  if (!transferForm.fromAccountId || !transferForm.toAccountId) { transferError.value = 'Choose both a from and to account.'; return; }
  if (transferForm.fromAccountId === transferForm.toAccountId) { transferError.value = 'Choose two different bank accounts.'; return; }
  if (Number(transferForm.amount) <= 0) { transferError.value = 'Enter a valid transfer amount.'; return; }
  saving.value = true;
  try {
    await transferBetweenBankAccounts({ ...transferForm, amount: Number(transferForm.amount), notes: transferForm.notes.trim() });
    Object.assign(transferForm, { amount: 0, notes: '' });
    showSuccess('Transfer recorded'); await loadAll();
  } catch (e) { transferError.value = e instanceof Error ? e.message : 'Could not record transfer'; }
  finally { saving.value = false; }
}

const bankLedgerColumns = [
  { label: 'Date', key: 'date' as const },
  { label: 'Entry', key: 'entryId' as const },
  { label: 'Type', key: 'type' as const },
  { label: 'Reference', key: 'reference' as const },
  { label: 'Description', key: 'description' as const },
  { label: 'Out (খরচ)', value: (r: BankLedgerEntry) => r.debit ? money(r.debit) : '', align: 'right' as const },
  { label: 'In (জমা)', value: (r: BankLedgerEntry) => r.credit ? money(r.credit) : '', align: 'right' as const },
  { label: 'Balance', value: (r: BankLedgerEntry) => money(r.balance), align: 'right' as const },
  { label: 'By', key: 'createdBy' as const }
];
function printLedger(): void {
  if (!ledger.value) { ledgerError.value = 'Show a ledger first.'; return; }
  const rows = sortRows('bank-ledger', ledger.value.entries);
  const h = ledger.value.history;
  printRows({
    title: 'Bank Ledger',
    subtitle: `${ledger.value.account.name}${ledger.value.account.bankName ? ` — ${ledger.value.account.bankName}` : ''}`,
    businessHeader: ledger.value.printHeader,
    contextLines: [`Date range: ${h.from || 'Beginning'} to ${h.to}`, `Showing ${h.returnedCount} of ${h.matchingCount} matching records · Limit ${h.limit}`],
    columns: bankLedgerColumns,
    rows,
    footerLines: [
      { label: 'Opening Balance (shown rows)', value: money(ledger.value.openingBalance) },
      { label: 'Money In (shown rows)', value: money(ledger.value.totalCredit) },
      { label: 'Money Out (shown rows)', value: money(ledger.value.totalDebit) },
      { label: 'Closing Balance (shown rows)', value: money(ledger.value.closingBalance) }
    ]
  });
}
function exportLedger(): void {
  if (!ledger.value) { ledgerError.value = 'Show a ledger first.'; return; }
  exportRowsToCsv({
    filename: `bank-ledger-${ledger.value.account.name}-${ledger.value.history.from || 'beginning'}-${ledger.value.history.to}`,
    columns: bankLedgerColumns,
    rows: sortRows('bank-ledger', ledger.value.entries)
  });
}

function closeActions(): void { actionMenu.value = null; }


watch(() => props.openRequest?.nonce, async () => {
  const req = props.openRequest;
  if (!req) return;
  const targetTab = req.tab || 'accounts';
  activeTab.value = targetTab;
  try {
    if (!accounts.value.length) await loadAll();
    if (targetTab === 'ledger' && req.accountId) {
      ledgerFilters.bankAccountId = req.accountId;
      if (req.date) { ledgerFilters.from = req.date; ledgerFilters.to = req.date; ledgerFilters.limit = 200; }
      await loadLedger();
      if (req.entryId && req.action === 'reverse') {
        const entry = ledger.value?.entries.find(item => item.entryId === req.entryId);
        if (!entry) { ledgerError.value = 'Bank entry was not found in the selected account/date.'; return; }
        if (entry.status === 'Reversed' || entry.reversalOf) { ledgerError.value = 'This bank entry cannot be reversed.'; return; }
        askReverse(entry.entryId);
      }
    } else if (targetTab === 'transfers') {
      await loadTransfers();
    }
  } catch (e) { showError(e instanceof Error ? e.message : 'Could not open bank record'); }
});

async function refresh(): Promise<void> {
  await loadAll();
  if (activeTab.value === 'ledger' && ledgerFilters.bankAccountId) await loadLedger();
  else if (activeTab.value === 'transfers') await loadTransfers();
}
defineExpose({ refresh });

onMounted(() => {
  void loadAll();
  document.addEventListener('click', closeActions);
  window.addEventListener('resize', closeActions);
  window.addEventListener('scroll', closeActions, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', closeActions);
  window.removeEventListener('resize', closeActions);
  window.removeEventListener('scroll', closeActions, true);
});
</script>

<template>
  <div class="bank-page">
    <div v-if="message" class="toast success">{{ message }}</div>
    <div v-if="error" class="toast error">{{ error }}</div>

    <ModuleTabs
      :model-value="activeTab"
      :tabs="bankTabs"
      aria-label="Bank sections"
      @update:model-value="setBankTab"
    />

    <section v-if="activeTab === 'accounts'">
      <div class="toolbar bank-toolbar">
        <input v-model="search" class="search-input" type="text" placeholder="Search by account or bank name..." />
        <div class="toolbar-spacer"></div>
        <button class="btn btn-primary" @click="openAdd">+ Add Bank Account</button>
      </div>
      <div class="card compact-card">
        <div class="table-scroll">
          <table class="bank-table">
            <thead><tr><SortableHeader table-id="bank-accounts" column="name">Account Name</SortableHeader><SortableHeader table-id="bank-accounts" column="accountType">Type</SortableHeader><SortableHeader table-id="bank-accounts" column="bankName">Bank Name</SortableHeader><SortableHeader table-id="bank-accounts" column="accountNumber">Account Number</SortableHeader><SortableHeader table-id="bank-accounts" column="openingBalance" type="number" class="num">Opening</SortableHeader><SortableHeader table-id="bank-accounts" column="currentBalance" type="number" class="num">Current</SortableHeader><SortableHeader table-id="bank-accounts" column="status">Status</SortableHeader><th></th></tr></thead>
            <tbody>
              <tr v-if="loading"><td colspan="8">Loading...</td></tr>
              <tr v-for="a in $sortRows('bank-accounts', filteredAccounts)" :key="a.id">
                <td><strong>{{ a.name }}</strong></td>
                <td><span v-if="a.accountType === 'Mobile Banking'" class="badge badge-warning">Mobile Banking</span><span v-else>Bank</span></td>
                <td>{{ a.bankName }}</td><td class="mono">{{ a.accountNumber }}</td>
                <td class="num mono">{{ money(a.openingBalance) }}</td><td class="num mono"><strong>{{ money(a.currentBalance) }}</strong></td>
                <td><span class="badge" :class="a.status === 'Active' ? 'badge-success' : 'badge-danger'">{{ a.status }}</span></td>
                <td><button class="btn btn-sm action-trigger" @click="openActions($event, a)">Actions</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="!loading && !filteredAccounts.length" class="empty-state">No bank accounts yet.</div>
      </div>
    </section>

    <section v-else-if="activeTab === 'ledger'">
      <div class="toolbar bank-ledger-toolbar">
        <select v-model="ledgerFilters.bankAccountId" @change="loadLedger"><option value="">Select account...</option><option v-for="a in ledgerAccounts" :key="a.id" :value="a.id">{{ a.name }}{{ a.bankName ? ` — ${a.bankName}` : '' }}{{ a.type === 'Mobile Banking' ? ' (Mobile Banking)' : '' }}</option></select>
        <div class="toolbar-spacer"></div><button class="btn" @click="exportLedger">Export CSV</button><button class="btn" @click="printLedger">Print</button>
      </div>
      <LedgerHistoryControls v-model:from="ledgerFilters.from" v-model:to="ledgerFilters.to" v-model:limit="ledgerFilters.limit" :matching-count="ledger?.history.matchingCount || 0" :returned-count="ledger?.history.returnedCount || 0" :has-more="ledger?.history.hasMore || false" :loading="loading" @refresh="loadLedger" />
      <div v-if="ledgerError" class="field-error visible">{{ ledgerError }}</div>
      <div v-if="ledger && !ledger.integrity.balanced" class="card bank-alert danger-alert">
        <strong>Ledger does not reconcile — হিসাব মিলছে না</strong>
        <div>Computed {{ money(ledger.integrity.computedBalance) }}, stored {{ money(ledger.integrity.storedBalance) }}, difference {{ money(ledger.integrity.drift) }}.</div>
      </div>
      <div v-if="ledger && !ledger.integrity.hasOpeningRow" class="card bank-alert warning-alert">
        <strong>No opening balance entry — শুরুর ব্যালেন্স নেই</strong>
        <div>The statement starts from the Opening Balance stored on the account. Balances remain valid, but there is no separate opening ledger row.</div>
      </div>
      <div v-if="ledger" class="bank-stats">
        <div class="stat-card"><span>Opening Balance</span><strong>{{ money(ledger.openingBalance) }}</strong></div>
        <div class="stat-card"><span>Money In / জমা</span><strong>{{ money(ledger.totalCredit) }}</strong></div>
        <div class="stat-card"><span>Money Out / খরচ</span><strong>{{ money(ledger.totalDebit) }}</strong></div>
        <div class="stat-card"><span>Closing Balance</span><strong>{{ money(ledger.closingBalance) }}</strong></div>
      </div>
      <div class="card compact-card">
        <div class="table-scroll">
          <table class="bank-ledger-table"><thead><tr><SortableHeader table-id="bank-ledger" column="date" type="date">Date</SortableHeader><SortableHeader table-id="bank-ledger" column="entryId">Entry</SortableHeader><SortableHeader table-id="bank-ledger" column="type">Type</SortableHeader><SortableHeader table-id="bank-ledger" column="reference">Reference</SortableHeader><SortableHeader table-id="bank-ledger" column="description">Description</SortableHeader><SortableHeader table-id="bank-ledger" column="debit" type="number" class="num"><span class="ledger-head">Out<small>খরচ</small></span></SortableHeader><SortableHeader table-id="bank-ledger" column="credit" type="number" class="num"><span class="ledger-head">In<small>জমা</small></span></SortableHeader><SortableHeader table-id="bank-ledger" column="balance" type="number" class="num">Balance</SortableHeader><SortableHeader table-id="bank-ledger" column="createdBy">By</SortableHeader><th></th></tr></thead>
            <tbody><tr v-for="e in $sortRows('bank-ledger', ledger?.entries || [])" :key="e.entryId">
              <td class="mono">{{ e.date }}</td><td class="mono">{{ e.entryId }}</td>
              <td>{{ e.type }} <span v-if="e.status === 'Reversed'" class="badge badge-danger">reversed</span> <span v-if="e.reversalOf" class="badge badge-warning">reversal</span> <span v-if="e.isBackdated" class="badge badge-warning">backdated</span></td>
              <td class="mono">{{ e.reference }}</td><td>{{ e.description }}<div v-if="e.notes" class="bn-hint">{{ e.notes }}</div></td>
              <td class="num mono">{{ e.debit ? money(e.debit) : '' }}</td><td class="num mono">{{ e.credit ? money(e.credit) : '' }}</td><td class="num mono">{{ money(e.balance) }}</td><td>{{ e.createdBy }}</td>
              <td><button v-if="e.status !== 'Reversed' && !e.reversalOf" class="btn btn-sm" @click="askReverse(e.entryId)">Reverse</button></td>
            </tr></tbody>
          </table>
        </div>
        <div v-if="ledger && !ledger.entries.length" class="empty-state">No entries for this account in this date range.</div>
      </div>
    </section>

    <section v-else-if="activeTab === 'manual'">
      <div class="card bank-form-card">
        <h3>Record a Bank Entry <span class="bn-hint">— ব্যাংকে এন্ট্রি করুন</span></h3>
        <p class="muted-copy">For money that moves through the bank without a sale, purchase or payment behind it: charges, interest, bounced cheques, or cash moved between the drawer and bank.</p>
        <div v-if="!activeCashSession" class="cash-session-note">An open POS Cash Session is required for manual bank entries. <span class="bn-hint">POS থেকে Start Day করুন।</span></div>
        <div class="form-grid">
          <div><label>Bank Account *</label><select v-model="manualForm.bankAccountId"><option value="">Select account...</option><option v-for="a in ledgerAccounts" :key="a.id" :value="a.id">{{ a.name }}</option></select></div>
          <div><label>Entry Type *</label><select v-model="manualForm.entryType"><option value="">Select type...</option><option v-for="t in entryTypes" :key="t.key" :value="t.key">{{ t.label }}</option></select></div>
          <div><label>Amount *</label><input v-model.number="manualForm.amount" type="number" min="0" step="0.01" /></div>
          <div><label>Date</label><input v-model="manualForm.date" type="date" /></div>
          <div v-if="manualType?.direction === 'either'"><label>Direction *</label><select v-model="manualForm.direction"><option value="credit">Adds to the account</option><option value="debit">Subtracts from the account</option></select></div>
          <div><label>Reference</label><input v-model="manualForm.reference" type="text" placeholder="Cheque no, advice no..." /></div>
          <div class="full"><label>Description</label><input v-model="manualForm.description" type="text" placeholder="Defaults to the entry type" /></div>
          <div class="full"><label>Notes</label><input v-model="manualForm.notes" type="text" /></div>
          <div v-if="manualIsBackdated" class="full"><label>Reason for backdating *</label><input v-model="manualForm.backdatedReason" type="text" /></div>
        </div>
        <p class="manual-hint">{{ manualHint }}</p><div v-if="manualError" class="field-error visible">{{ manualError }}</div>
        <button class="btn btn-primary" :disabled="saving" @click="saveManual">Record Entry</button>
      </div>
      <div class="card correction-card"><strong>How corrections work — ভুল ঠিক করার নিয়ম</strong><p>Posted entries are never edited or deleted. Use Reverse in Ledger to create an equal and opposite linked entry.</p></div>
    </section>

    <section v-else>
      <div class="card bank-form-card">
        <h3>Transfer Between Accounts <span class="bn-hint">— এক হিসাব থেকে অন্য হিসাবে</span></h3>
        <div v-if="!activeCashSession" class="cash-session-note">An open POS Cash Session is required for a transfer.</div>
        <div class="form-grid">
          <div><label>From Account *</label><select v-model="transferForm.fromAccountId"><option value="">Select account...</option><option v-for="a in activeAccounts" :key="a.id" :value="a.id">{{ a.name }}</option></select></div>
          <div><label>To Account *</label><select v-model="transferForm.toAccountId"><option value="">Select account...</option><option v-for="a in activeAccounts" :key="a.id" :value="a.id">{{ a.name }}</option></select></div>
          <div><label>Amount *</label><input v-model.number="transferForm.amount" type="number" min="0" step="0.01" /></div>
          <div class="full"><label>Notes</label><input v-model="transferForm.notes" type="text" /></div>
        </div>
        <div v-if="transferError" class="field-error visible">{{ transferError }}</div>
        <button class="btn btn-primary" :disabled="saving" @click="saveTransfer">Transfer</button>
      </div>
      <div class="card compact-card transfer-history"><h3>Transfer History <span class="bn-hint">— আগের হিসাব বদলের তালিকা</span></h3><div class="table-scroll"><table><thead><tr><SortableHeader table-id="bank-transfers" column="date" type="date">Date</SortableHeader><SortableHeader table-id="bank-transfers" column="fromAccountName">From</SortableHeader><SortableHeader table-id="bank-transfers" column="toAccountName">To</SortableHeader><SortableHeader table-id="bank-transfers" column="amount" type="number" class="num">Amount</SortableHeader><SortableHeader table-id="bank-transfers" column="notes">Notes</SortableHeader></tr></thead><tbody><tr v-for="t in $sortRows('bank-transfers', transfers)" :key="t.transferId"><td>{{ t.date }}</td><td>{{ t.fromAccountName }}</td><td>{{ t.toAccountName }}</td><td class="num mono">{{ money(t.amount) }}</td><td>{{ t.notes }}</td></tr></tbody></table></div><div v-if="!transfers.length" class="empty-state">No transfers yet.</div></div>
    </section>

    <Teleport to="body">
      <div v-if="actionMenu" class="bank-action-menu" :style="{ top: `${actionMenu.top}px`, left: `${actionMenu.left}px`, width: `${actionMenu.width}px` }" @click.stop>
        <button @click="openLedgerFor(actionMenu.account)">Ledger</button>
        <button @click="openEdit(actionMenu.account); actionMenu=null">Edit</button>
        <button @click="toggleStatus(actionMenu.account); actionMenu=null">{{ actionMenu.account.status === 'Active' ? 'Deactivate' : 'Activate' }}</button>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="modalOpen" class="modal-overlay" @click.self="modalOpen=false">
        <div class="modal bank-modal"><div class="modal-header"><div><h3>{{ editingId ? 'Edit Bank Account' : 'Add Bank Account' }}</h3><span class="bn-hint">ব্যাংক হিসাবের তথ্য</span></div><button class="modal-close" @click="modalOpen=false">✕</button></div>
          <div class="modal-body"><div class="form-grid">
            <div class="full"><label>Account Name *</label><input v-model="accountForm.name" type="text" placeholder="e.g. Main Account" /></div>
            <div><label>Account Type *</label><select v-model="accountForm.accountType"><option value="Bank">Bank</option><option value="Mobile Banking">Mobile Banking</option></select></div>
            <div><label>Bank Name</label><input v-model="accountForm.bankName" type="text" placeholder="Bank, bKash, Nagad, Rocket..." /></div>
            <div><label>Account Number</label><input v-model="accountForm.accountNumber" type="text" /></div>
            <div><label>Opening Balance</label><input v-model.number="accountForm.openingBalance" type="number" min="0" step="0.01" :disabled="!!editingId" /></div>
            <div class="full"><label>Notes</label><input v-model="accountForm.notes" type="text" /></div>
          </div><div v-if="accountFormError" class="field-error visible">{{ accountFormError }}</div></div>
          <div class="modal-footer"><button class="btn" @click="modalOpen=false">Cancel</button><button class="btn btn-primary" :disabled="saving" @click="saveAccount">Save Bank Account</button></div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="reverseTarget" class="modal-overlay" @click.self="reverseTarget=null">
        <div class="modal small-modal"><div class="modal-header"><h3>Reverse {{ reverseTarget }}</h3><button class="modal-close" @click="reverseTarget=null">✕</button></div><div class="modal-body"><label>Reason *</label><input v-model="reverseReason" type="text" placeholder="Why is this entry being reversed?" /></div><div class="modal-footer"><button class="btn" @click="reverseTarget=null">Cancel</button><button class="btn btn-danger" @click="confirmReverse">Reverse Entry</button></div></div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.bank-page{min-width:0;display:grid;gap:10px}.compact-card{padding:0}.bank-toolbar,.bank-ledger-toolbar{gap:8px;align-items:center}.bank-ledger-toolbar label{font-size:12px;color:var(--color-text-muted)}.bank-ledger-toolbar select{min-width:190px}.bank-table,.bank-ledger-table{min-width:920px}.bank-stats{display:grid;grid-template-columns:repeat(4,minmax(140px,1fr));gap:10px;margin:12px 0}.bank-stats .stat-card{padding:12px 14px;border:1px solid var(--color-border);border-radius:10px;background:var(--color-surface)}.bank-stats span{display:block;font-size:11px;color:var(--color-text-muted);text-transform:uppercase;font-weight:700}.bank-stats strong{display:block;margin-top:4px;font-size:18px}.bank-alert{padding:12px 14px;margin:10px 0;font-size:12px}.danger-alert{border-left:3px solid #dc2626}.warning-alert{border-left:3px solid #d97706}.bank-form-card{max-width:900px}.bank-form-card h3,.transfer-history h3{margin:0 0 8px;font-size:14px}.muted-copy,.manual-hint,.correction-card p{font-size:12px;color:var(--color-text-muted)}.manual-hint{margin:10px 0}.correction-card{max-width:900px;margin-top:14px}.transfer-history{margin-top:14px}.transfer-history h3{padding:14px 14px 0}.field-error.visible{display:block;margin-top:8px}.bank-action-menu{position:fixed;z-index:9999;background:#fff;border:1px solid #dfe5ee;border-radius:10px;box-shadow:0 10px 30px rgba(30,41,59,.18);padding:6px}.bank-action-menu button{display:block;width:100%;border:0;background:transparent;text-align:left;padding:9px 12px;border-radius:7px;font:inherit;cursor:pointer}.bank-action-menu button:hover{background:#eef5f5}.bank-modal{max-width:620px}.small-modal{max-width:460px}.cash-session-note{padding:9px 11px;border:1px solid #f3d7a7;background:#fff9ed;border-radius:8px;font-size:12px;margin-bottom:12px}
@media(max-width:760px){.bank-toolbar{display:grid;grid-template-columns:1fr auto}.bank-toolbar .search-input{min-width:0}.bank-ledger-toolbar{display:grid;grid-template-columns:1fr 1fr}.bank-ledger-toolbar select{min-width:0;grid-column:1/-1}.bank-ledger-toolbar .toolbar-spacer{display:none}.bank-stats{grid-template-columns:1fr 1fr}.bank-form-card{padding:14px}.bank-action-menu{max-width:calc(100vw - 20px)}}
</style>
