<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { getDayBookBootstrap, getDayBookTransactions } from '../api';
import type { DayBookOpenSource, DayBookRow, DayBookSourceAction, DayBookTotals } from '../types';
import { exportRowsToCsv, printRows } from '../utils/tableOutput';

const props = defineProps<{ canSourceAction?: (sourceModule: string, action: DayBookSourceAction, sourceDate: string) => boolean }>();
const emit = defineEmits<{ (e: 'open-source', payload: DayBookOpenSource): void }>();

const today = () => new Date().toISOString().slice(0, 10);
const loading = ref(false);
const error = ref('');
const message = ref('');
const rows = ref<DayBookRow[]>([]);
const totals = ref<DayBookTotals>({ cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0, netCash: 0, netBank: 0 });
const modules = ref<string[]>([]);
const currencySymbol = ref('৳');
const isAdmin = ref(false);
const selected = ref<DayBookRow | null>(null);
const modal = ref<'' | 'view'>('');
const actionMenu = ref<{ row: DayBookRow; top: number; left: number; width: number } | null>(null);

const filters = reactive({
  dateFrom: today(),
  dateTo: today(),
  module: '',
  paymentMethod: '',
  query: '',
  backdatedOnly: false,
  includeDeleted: false
});

const entryCount = computed(() => rows.value.length);


function money(value: unknown): string {
  return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function flash(text: string): void {
  message.value = text;
  error.value = '';
  setTimeout(() => { if (message.value === text) message.value = ''; }, 2400);
}
function fail(err: unknown): void {
  error.value = err instanceof Error ? err.message : String(err);
}
function statusClass(status: string): string {
  const s = String(status || '').toLowerCase();
  if (s.includes('cancel') || s.includes('delete') || s === 'due' || s.includes('reversed')) return 'badge-danger';
  if (s.includes('partial')) return 'badge-warning';
  return 'badge-success';
}
function closeMenu(): void { actionMenu.value = null; }
function positionMenu(button: HTMLElement, menuWidth = 190): { top: number; left: number; width: number } {
  const rect = button.getBoundingClientRect();
  const width = Math.max(menuWidth, rect.width);
  const gap = 6;
  const estimatedHeight = 190;
  let left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
  let top = rect.bottom + gap;
  if (top + estimatedHeight > window.innerHeight - 8) top = Math.max(8, rect.top - estimatedHeight - gap);
  return { top, left, width };
}
function toggleActions(event: MouseEvent, row: DayBookRow): void {
  event.stopPropagation();
  if (actionMenu.value?.row.referenceNo === row.referenceNo && actionMenu.value?.row.module === row.module) { closeMenu(); return; }
  actionMenu.value = { row, ...positionMenu(event.currentTarget as HTMLElement) };
}
function outsidePointer(event: PointerEvent): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest('.daybook-action-menu') || target?.closest('.daybook-action-trigger')) return;
  closeMenu();
}

async function bootstrap(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const b = await getDayBookBootstrap();
    modules.value = b.modules;
    currencySymbol.value = b.currencySymbol || '৳';
    isAdmin.value = b.isAdmin;
    await fetchRows();
  } catch (err) { fail(err); }
  finally { loading.value = false; }
}

async function fetchRows(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const r = await getDayBookTransactions({ ...filters });
    rows.value = r.rows;
    totals.value = r.totals;
    isAdmin.value = r.isAdmin;
  } catch (err) { fail(err); }
  finally { loading.value = false; }
}

function setToday(): void {
  const d = today();
  filters.dateFrom = d;
  filters.dateTo = d;
  void fetchRows();
}

const daybookColumns = [
  { label: 'Date', key: 'date' as const },
  { label: 'Time', key: 'time' as const },
  { label: 'Reference', key: 'referenceNo' as const },
  { label: 'Module', key: 'module' as const },
  { label: 'Transaction', key: 'transactionType' as const },
  { label: 'Party', key: 'party' as const },
  { label: 'Description', key: 'description' as const },
  { label: 'Method', key: 'paymentMethod' as const },
  { label: 'Cash In', value: (r: DayBookRow) => r.cashIn ? `${currencySymbol.value}${money(r.cashIn)}` : '', align: 'right' as const },
  { label: 'Cash Out', value: (r: DayBookRow) => r.cashOut ? `${currencySymbol.value}${money(r.cashOut)}` : '', align: 'right' as const },
  { label: 'Bank In', value: (r: DayBookRow) => r.bankIn ? `${currencySymbol.value}${money(r.bankIn)}` : '', align: 'right' as const },
  { label: 'Bank Out', value: (r: DayBookRow) => r.bankOut ? `${currencySymbol.value}${money(r.bankOut)}` : '', align: 'right' as const },
  { label: 'Status', key: 'status' as const },
  { label: 'By', key: 'createdBy' as const }
];
function printDaybook(): void {
  printRows({
    title: 'Day Book',
    subtitle: `${filters.dateFrom} to ${filters.dateTo}`,
    columns: daybookColumns,
    rows: rows.value,
    footerLines: [
      { label: 'Cash In', value: `${currencySymbol.value}${money(totals.value.cashIn)}` },
      { label: 'Cash Out', value: `${currencySymbol.value}${money(totals.value.cashOut)}` },
      { label: 'Bank In', value: `${currencySymbol.value}${money(totals.value.bankIn)}` },
      { label: 'Bank Out', value: `${currencySymbol.value}${money(totals.value.bankOut)}` },
      { label: 'Net Cash', value: `${currencySymbol.value}${money(totals.value.netCash)}` },
      { label: 'Net Bank', value: `${currencySymbol.value}${money(totals.value.netBank)}` }
    ]
  });
}
function exportDaybook(): void {
  exportRowsToCsv({
    filename: `daybook-${filters.dateFrom}-${filters.dateTo}`,
    columns: daybookColumns,
    rows: rows.value
  });
}
function openView(row: DayBookRow): void {
  closeMenu();
  selected.value = row;
  modal.value = 'view';
}
type DetailAction = { action: DayBookSourceAction; label: string; danger?: boolean };

function detailActions(row: DayBookRow): DetailAction[] {
  if (row.isDeleted) return [];
  const actions: DetailAction[] = [];
  switch (row.sourceModule) {
    case 'Sales': {
      if (row.canEdit) actions.push({ action: 'edit', label: 'Edit / Update' });
      actions.push({ action: 'return', label: 'Sales Return' });
      const status = String(row.status || '').toLowerCase();
      if (status.includes('due') || status.includes('partial') || status.includes('unpaid')) {
        actions.push({ action: 'receive-payment', label: 'Receive Payment' });
      }
      if (row.deleteAction === 'sale') actions.push({ action: 'delete', label: 'Delete', danger: true });
      break;
    }
    case 'Purchase':
      actions.push({ action: 'edit', label: 'Edit / Update' });
      actions.push({ action: 'return', label: 'Purchase Return' });
      if (row.deleteAction === 'purchase') actions.push({ action: 'delete', label: 'Delete', danger: true });
      break;
    case 'Customer Payment':
      if (row.deleteAction === 'customer-payment') {
        actions.push({ action: 'edit', label: 'Edit Payment' });
        actions.push({ action: 'delete', label: 'Delete Payment', danger: true });
      }
      break;
    case 'Supplier Payment':
      if (row.deleteAction === 'supplier-payment') {
        actions.push({ action: 'edit', label: 'Edit Payment' });
        actions.push({ action: 'delete', label: 'Delete Payment', danger: true });
      }
      break;
    case 'Expense':
      if (String(row.status || '').toLowerCase() === 'active') {
        if (row.canEdit) actions.push({ action: 'edit', label: 'Edit' });
        if (row.deleteAction === 'expense') actions.push({ action: 'cancel', label: 'Delete Expense', danger: true });
      }
      break;
    case 'Bank':
      if (row.deleteAction === 'bank-reverse') actions.push({ action: 'reverse', label: 'Reverse', danger: true });
      break;
    case 'Finance':
      actions.push({ action: 'edit', label: 'Edit' });
      actions.push({ action: 'delete', label: 'Delete', danger: true });
      break;
  }
  return actions;
}

function canDispatch(row: DayBookRow, action: DayBookSourceAction): boolean {
  return props.canSourceAction ? props.canSourceAction(row.sourceModule, action, row.date) : true;
}

const selectedDetailActions = computed(() => selected.value ? detailActions(selected.value).filter(item => canDispatch(selected.value!, item.action)) : []);

function openOriginal(row: DayBookRow, action: DayBookSourceAction = 'open'): void {
  if (!canDispatch(row, action)) return;
  closeMenu();
  modal.value = '';
  emit('open-source', {
    sourceModule: row.sourceModule,
    sourceId: row.sourceId,
    openId: row.openId,
    sourceDate: row.date,
    action,
    nonce: Date.now()
  });
}

function runMenuAction(action: 'view' | 'open'): void {
  const row = actionMenu.value?.row;
  if (!row) return;
  if (action === 'view') openView(row);
  else openOriginal(row, 'open');
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSearch(): void {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void fetchRows(), 300);
}

defineExpose({ refresh: bootstrap });

onMounted(() => {
  void bootstrap();
  document.addEventListener('pointerdown', outsidePointer);
  window.addEventListener('scroll', closeMenu, true);
  window.addEventListener('resize', closeMenu);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outsidePointer);
  window.removeEventListener('scroll', closeMenu, true);
  window.removeEventListener('resize', closeMenu);
  if (searchTimer) clearTimeout(searchTimer);
});
</script>

<template>
  <div class="daybook-page">
    <div v-if="message" class="toast success">{{ message }}</div>
    <div v-if="error" class="toast error">{{ error }}</div>

    <div class="daybook-toolbar">
      <label><span>Date From</span><input v-model="filters.dateFrom" type="date" @change="fetchRows"></label>
      <label><span>Date To</span><input v-model="filters.dateTo" type="date" @change="fetchRows"></label>
      <label><span>Module</span><select v-model="filters.module" @change="fetchRows"><option value="">All modules</option><option v-for="m in modules" :key="m" :value="m">{{ m }}</option></select></label>
      <label><span>Method</span><select v-model="filters.paymentMethod" @change="fetchRows"><option value="">All methods</option><option>Cash</option><option>Bank</option><option>Mobile Banking</option><option>Store Credit</option><option>Supplier Credit</option></select></label>
      <label class="daybook-search"><span>Search</span><input v-model="filters.query" type="search" placeholder="Reference, party, description..." @input="scheduleSearch"></label>
      <label class="daybook-check"><input v-model="filters.backdatedOnly" type="checkbox" @change="fetchRows"><span>Backdated only</span></label>
      <label v-if="isAdmin" class="daybook-check"><input v-model="filters.includeDeleted" type="checkbox" @change="fetchRows"><span>Show deleted</span></label>
      <div class="daybook-toolbar-actions"><button class="btn" @click="setToday">Today</button><button class="btn" @click="exportDaybook">Export CSV</button><button class="btn" @click="printDaybook">Print</button><button class="btn" :disabled="loading" @click="fetchRows">Refresh</button></div>
    </div>

    <div class="daybook-stats">
      <div><span>Cash In</span><strong class="positive">{{ currencySymbol }}{{ money(totals.cashIn) }}</strong></div>
      <div><span>Cash Out</span><strong class="negative">{{ currencySymbol }}{{ money(totals.cashOut) }}</strong></div>
      <div><span>Net Cash</span><strong>{{ currencySymbol }}{{ money(totals.netCash) }}</strong></div>
      <div><span>Bank In</span><strong class="positive">{{ currencySymbol }}{{ money(totals.bankIn) }}</strong></div>
      <div><span>Bank Out</span><strong class="negative">{{ currencySymbol }}{{ money(totals.bankOut) }}</strong></div>
      <div><span>Entries</span><strong>{{ entryCount }}</strong></div>
    </div>

    <div class="daybook-table-wrap">
      <table class="daybook-table">
        <thead><tr>
          <SortableHeader table-id="daybook" column="time">Time</SortableHeader><SortableHeader table-id="daybook" column="date" type="date">Date</SortableHeader><SortableHeader table-id="daybook" column="referenceNo">Reference</SortableHeader><SortableHeader table-id="daybook" column="module">Module</SortableHeader><SortableHeader table-id="daybook" column="transactionType">Type</SortableHeader><SortableHeader table-id="daybook" column="party">Party</SortableHeader><SortableHeader table-id="daybook" column="description">Description</SortableHeader><SortableHeader table-id="daybook" column="paymentMethod">Method</SortableHeader>
          <SortableHeader table-id="daybook" column="cashIn" type="number" class="num">Cash In<br><small>জমা</small></SortableHeader><SortableHeader table-id="daybook" column="cashOut" type="number" class="num">Cash Out<br><small>খরচ</small></SortableHeader><SortableHeader table-id="daybook" column="bankIn" type="number" class="num">Bank In<br><small>জমা</small></SortableHeader><SortableHeader table-id="daybook" column="bankOut" type="number" class="num">Bank Out<br><small>খরচ</small></SortableHeader><SortableHeader table-id="daybook" column="runningCashBalance" type="number" class="num">Cash Balance</SortableHeader><SortableHeader table-id="daybook" column="createdBy">By</SortableHeader><SortableHeader table-id="daybook" column="status">Status</SortableHeader><th></th>
        </tr></thead>
        <tbody>
          <tr v-if="loading"><td colspan="16" class="empty">Loading Day Book...</td></tr>
          <tr v-for="row in $sortRows('daybook', rows)" :key="`${row.module}-${row.referenceNo}-${row.sourceId}`" :class="{ deleted: row.isDeleted }">
            <td class="mono">{{ row.time }}</td>
            <td><span>{{ row.date }}</span><span v-if="row.isBackdated" class="backdated" :title="row.backdatedReason || ''">⚠ Backdated</span></td>
            <td class="mono">{{ row.referenceNo }}</td><td>{{ row.module }}</td><td>{{ row.transactionType }}</td><td>{{ row.party || '—' }}</td><td class="description-cell">{{ row.description || '—' }}</td><td>{{ row.paymentMethod || '—' }}</td>
            <td class="num positive mono">{{ row.cashIn ? money(row.cashIn) : '' }}</td><td class="num negative mono">{{ row.cashOut ? money(row.cashOut) : '' }}</td><td class="num positive mono">{{ row.bankIn ? money(row.bankIn) : '' }}</td><td class="num negative mono">{{ row.bankOut ? money(row.bankOut) : '' }}</td>
            <td class="num mono">{{ row.runningCashBalance == null ? '—' : money(row.runningCashBalance) }}</td><td>{{ row.createdBy || '—' }}</td><td><span class="badge" :class="statusClass(row.status)">{{ row.status || 'Active' }}</span></td>
            <td><button class="btn btn-sm action-trigger daybook-action-trigger" @click="toggleActions($event,row)">Actions</button></td>
          </tr>
          <tr v-if="!loading && rows.length===0"><td colspan="16" class="empty">No transactions match these filters.</td></tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div v-if="actionMenu" class="daybook-action-menu" :style="{top:actionMenu.top+'px',left:actionMenu.left+'px',width:actionMenu.width+'px'}" @pointerdown.stop>
        <button @click="runMenuAction('view')">View</button>
        <button v-if="canDispatch(actionMenu.row, 'open')" @click="runMenuAction('open')">Open Original</button>
      </div>
    </Teleport>

    <div v-if="modal==='view' && selected" class="modal-overlay">
      <div class="modal modal-lg">
        <div class="modal-header"><div><h3>Transaction <span class="mono">{{ selected.referenceNo }}</span></h3><span class="bn-hint">লেনদেনের বিস্তারিত</span></div><button class="modal-close" @click="modal=''">✕</button></div>
        <div class="modal-body">
          <div class="daybook-detail-grid">
            <div><label>Date / Time</label><strong>{{ selected.date }} {{ selected.time }}</strong></div><div><label>Module</label><strong>{{ selected.module }}</strong></div><div><label>Type</label><strong>{{ selected.transactionType }}</strong></div><div><label>Party</label><strong>{{ selected.party || '—' }}</strong></div>
            <div><label>Payment Method</label><strong>{{ selected.paymentMethod || '—' }}</strong></div><div><label>Status</label><strong>{{ selected.status }}</strong></div><div><label>Cash In</label><strong>{{ currencySymbol }}{{ money(selected.cashIn) }}</strong></div><div><label>Cash Out</label><strong>{{ currencySymbol }}{{ money(selected.cashOut) }}</strong></div>
            <div><label>Bank In</label><strong>{{ currencySymbol }}{{ money(selected.bankIn) }}</strong></div><div><label>Bank Out</label><strong>{{ currencySymbol }}{{ money(selected.bankOut) }}</strong></div><div><label>Running Cash</label><strong>{{ selected.runningCashBalance==null?'—':currencySymbol+money(selected.runningCashBalance) }}</strong></div><div><label>Created By</label><strong>{{ selected.createdBy || '—' }}</strong></div>
            <div class="full"><label>Description</label><span>{{ selected.description || '—' }}</span></div>
            <div v-if="selected.isBackdated" class="full backdated-note"><label>Backdated</label><span>{{ selected.backdatedDays }} day(s) late{{ selected.backdatedReason ? ' — '+selected.backdatedReason : '' }}</span></div>
          </div>
        </div>
        <div class="modal-footer daybook-detail-actions">
          <button class="btn" @click="modal=''">Close</button>
          <button
            v-for="item in selectedDetailActions"
            :key="item.action"
            class="btn"
            :class="item.danger ? 'btn-danger' : ''"
            @click="openOriginal(selected, item.action)"
          >{{ item.label }}</button>
          <button v-if="canDispatch(selected, 'open')" class="btn btn-primary" @click="openOriginal(selected,'open')">Open Original</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.daybook-page{display:grid;gap:10px}.daybook-toolbar{display:grid;grid-template-columns:142px 142px 170px 170px minmax(230px,1fr) auto auto auto;gap:7px;align-items:end}.daybook-toolbar label{display:grid;gap:4px;font-size:11px;color:var(--color-text-muted)}.daybook-toolbar input,.daybook-toolbar select{min-height:36px}.daybook-check{display:flex!important;align-items:center;gap:6px!important;min-height:36px;white-space:nowrap}.daybook-check input{width:auto;min-height:auto}.daybook-toolbar-actions{display:flex;gap:6px}.daybook-stats{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:8px}.daybook-stats>div{background:#fff;border:1px solid var(--color-border);border-radius:9px;padding:9px 11px;display:grid;gap:2px}.daybook-stats span{font-size:10px;text-transform:uppercase;color:var(--color-text-muted);font-weight:700}.daybook-stats strong{font-size:15px}.positive{color:var(--color-success)!important}.negative{color:var(--color-danger)!important}.daybook-table-wrap{overflow:auto;border:1px solid var(--color-border);border-radius:9px;background:#fff;-webkit-overflow-scrolling:touch}.daybook-table{width:100%;border-collapse:collapse;white-space:nowrap}.daybook-table th,.daybook-table td{padding:7px 8px;border-bottom:1px solid var(--color-border);font-size:12px}.daybook-table th{font-size:10px;text-transform:uppercase;color:var(--color-text-muted);text-align:left;position:sticky;top:0;background:#fff;z-index:1}.daybook-table th small{font-size:9px;text-transform:none;font-weight:500}.daybook-table .num{text-align:right}.description-cell{max-width:260px;overflow:hidden;text-overflow:ellipsis}.daybook-table tr.deleted{opacity:.58;text-decoration:line-through}.backdated{display:inline-flex;margin-left:5px;border-radius:999px;background:#fff4dc;color:#9a5a00;padding:2px 5px;font-size:9px;font-weight:700}.empty{text-align:center!important;padding:28px!important;color:var(--color-text-muted)}.daybook-action-menu{position:fixed;z-index:10050;padding:6px;background:#fff;border:1px solid #dfe5ee;border-radius:10px;box-shadow:0 10px 28px rgba(15,23,42,.16);display:grid}.daybook-action-menu button{border:0;background:transparent;border-radius:7px;padding:10px 11px;text-align:left;font:inherit;color:#273247;cursor:pointer}.daybook-action-menu button:hover{background:#eef4ff}.daybook-action-menu .danger{color:#e11d48}.daybook-action-menu .danger:hover{background:#fff0f3}.daybook-detail-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.daybook-detail-grid>div{display:grid;gap:3px}.daybook-detail-grid label{font-size:10px;text-transform:uppercase;color:var(--color-text-muted);font-weight:700}.daybook-detail-grid .full{grid-column:1/-1}.daybook-detail-actions{flex-wrap:wrap}.backdated-note{background:#fff8e7;border:1px solid #f4d38a;border-radius:8px;padding:9px}
@media(max-width:1180px){.daybook-toolbar{grid-template-columns:repeat(4,1fr)}.daybook-search{grid-column:span 2}.daybook-stats{grid-template-columns:repeat(3,1fr)}.daybook-detail-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:650px){.daybook-toolbar{grid-template-columns:1fr 1fr}.daybook-search{grid-column:1/-1}.daybook-toolbar-actions{grid-column:1/-1}.daybook-toolbar-actions .btn{flex:1}.daybook-stats{grid-template-columns:repeat(2,1fr)}.daybook-table th,.daybook-table td{padding:6px 7px}.daybook-detail-grid{grid-template-columns:1fr}.daybook-detail-grid .full{grid-column:auto}}
</style>
