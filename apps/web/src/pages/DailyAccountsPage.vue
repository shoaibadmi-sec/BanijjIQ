<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import Button from 'primevue/button';
import Card from 'primevue/card';
import Checkbox from 'primevue/checkbox';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import DatePicker from 'primevue/datepicker';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { useToast } from 'primevue/usetoast';
import AssignmentDialog from '../components/AssignmentDialog.vue';
import CloseAssignmentDialog from '../components/CloseAssignmentDialog.vue';
import ReceiptDialog from '../components/ReceiptDialog.vue';
import ExpenseDialog from '../components/ExpenseDialog.vue';
import { useRoute } from 'vue-router';
import { ApiError } from '../services/api';
import {
  correctDailyAccount,
  getDailyAccount,
  getDailyAccountHistory,
  getDailyWorkspace,
  postDailyAccounts,
  voidDailyAccount,
  type DailyAccount,
  type DailyWorkspace,
  type DailyWorkspaceVehicle,
  type GarageChargeType
} from '../services/dailyAccounts';
import { getAssignments, getDrivers, type Assignment, type Driver } from '../services/drivers';
import { getVehicle, getVehicles, updateVehicle, type Vehicle, type VehicleStatus } from '../services/vehicles';
import type { Receipt, ReceiptPayerType } from '../services/receipts';
import { getExpenseSummary, type Expense } from '../services/expenses';
import { getCashSummary } from '../services/cash';
import { dhakaToday, formatDateOnly } from '../utils/dateOnly';

type EditableVehicle = DailyWorkspaceVehicle & {
  sessionKey: string;
  selected: boolean;
  ownerRentTaka: number;
  chargeType: GarageChargeType;
};

const toast = useToast();
const route = useRoute();
const workspace = ref<DailyWorkspace | null>(null);
const rows = ref<EditableVehicle[]>([]);
const loading = ref(false);
const posting = ref(false);
const error = ref('');
const search = ref(typeof route.query.q === 'string' ? route.query.q : '');
const businessDate = ref<Date>(dhakaToday());
let searchTimer: ReturnType<typeof setTimeout> | null = null;

const actionVisible = ref(false);
const actionRow = ref<EditableVehicle | null>(null);
const assignmentVisible = ref(false);
const assignmentVehicleId = ref('');
const assignmentDrivers = ref<Driver[]>([]);
const assignmentVehicles = ref<Vehicle[]>([]);
const assignmentLoading = ref(false);
const closeAssignmentVisible = ref(false);
const closeAssignmentTarget = ref<Assignment | null>(null);
const receiptVisible = ref(false);
const receiptPayerType = ref<ReceiptPayerType>('DRIVER');
const receiptPayerId = ref('');
const receiptBusinessDate = ref('');
const receiptVehicleId = ref('');
const receiptDailyAccountId = ref('');
const vehicleStatusVisible = ref(false);
const vehicleStatusTarget = ref<EditableVehicle | null>(null);
const vehicleStatusValue = ref<VehicleStatus>('RUNNING');
const vehicleStatusSaving = ref(false);
const expenseVisible = ref(false);
const expenseTotalPoisha = ref(0);
const expenseCount = ref(0);
const receiptCashInPoisha = ref(0);

const mobileDialogVisible = ref(false);
const mobileRow = ref<EditableVehicle | null>(null);
const mobileRentTaka = ref(0);
const mobileChargeType = ref<GarageChargeType>('SITTING');
const mobileSaving = ref(false);

const detailVisible = ref(false);
const detailLoading = ref(false);
const detail = ref<DailyAccount | null>(null);
const history = ref<DailyAccount[]>([]);
const editingDetail = ref(false);
const detailRentTaka = ref(0);
const detailChargeType = ref<GarageChargeType>('SITTING');
const detailSaving = ref(false);
const voidConfirmVisible = ref(false);
const voiding = ref(false);

const vehicleStatusOptions = [
  { label: 'চলছে', value: 'RUNNING' as const },
  { label: 'বসে আছে', value: 'SITTING' as const },
  { label: 'মেরামত', value: 'MAINTENANCE' as const },
  { label: 'বন্ধ', value: 'INACTIVE' as const }
];

const chargeOptions = [
  { label: 'FULL', value: 'FULL' as const },
  { label: 'HALF', value: 'HALF' as const },
  { label: 'SITTING', value: 'SITTING' as const }
];

const selectedCount = computed(() => rows.value.filter((row) => row.selected && row.eligible && !row.posted && !row.requires_session_review).length);
const postedCount = computed(() => rows.value.filter((row) => row.posted).length);
const pendingCount = computed(() => rows.value.filter((row) => row.eligible && !row.posted).length);
const unpaidPostedCount = computed(() => rows.value.filter((row) => {
  if (!row.posted) return false;
  const total = row.posted.owner_rent_poisha + row.posted.garage_charge_poisha;
  const paid = row.posted.owner_rent_paid_poisha + row.posted.garage_charge_paid_poisha;
  return total > 0 && paid < total;
}).length);
const currentBusinessDate = computed(() => formatDateOnly(businessDate.value));
const isToday = computed(() => currentBusinessDate.value === formatDateOnly(dhakaToday()));
const vehicleCount = computed(() => new Set(rows.value.map((row) => row.vehicle_id)).size);
const assignedCount = computed(() => new Set(rows.value.filter((row) => row.driver_id).map((row) => row.driver_id)).size);
const driverlessCount = computed(() => new Set(rows.value.filter((row) => !row.driver_id && row.vehicle_status !== 'INACTIVE').map((row) => row.vehicle_id)).size);

function collectionState(row: DailyWorkspaceVehicle): 'UNPOSTED' | 'UNPAID' | 'PARTIAL' | 'PAID' {
  if (!row.posted) return 'UNPOSTED';
  const total = row.posted.owner_rent_poisha + row.posted.garage_charge_poisha;
  const paid = row.posted.owner_rent_paid_poisha + row.posted.garage_charge_paid_poisha;
  if (total <= 0 || paid <= 0) return 'UNPAID';
  if (paid >= total) return 'PAID';
  return 'PARTIAL';
}

function workPriority(row: DailyWorkspaceVehicle): number {
  if (!row.posted && row.blocker_code === 'DRIVER_REQUIRED_OR_SET_SITTING') return 0;
  if (!row.posted && row.eligible) return 1;
  const state = collectionState(row);
  if (state === 'UNPAID') return 2;
  if (state === 'PARTIAL') return 3;
  if (!row.posted) return 4;
  return 5;
}

const sortedRows = computed(() =>
  rows.value
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const priority = workPriority(left.row) - workPriority(right.row);
      if (priority !== 0) return priority;
      return left.index - right.index;
    })
    .map(({ row }) => row)
);

function money(poisha: number): string {
  return `৳ ${(poisha / 100).toLocaleString('en-BD', { maximumFractionDigits: 0 })}`;
}

function chargeAmount(row: Pick<EditableVehicle, 'chargeType'>): number {
  return workspace.value?.rates[row.chargeType] ?? 0;
}

function payerLabel(row: DailyWorkspaceVehicle): string {
  if (row.payer_type === 'DRIVER') return row.driver_name || 'Driver';
  if (row.payer_type === 'OWNER') return row.owner_name;
  return '—';
}

function sessionTimeLabel(row: DailyWorkspaceVehicle): string {
  if (!row.assignment_start_time) return '';
  const start = row.assignment_start_time.slice(0, 5);
  const end = row.assignment_end_time ? row.assignment_end_time.slice(0, 5) : 'চলমান';
  return `${start}–${end}`;
}

function sessionReviewText(row: DailyWorkspaceVehicle): string {
  if (!row.requires_session_review) return '';
  return `একই দিনে ${row.same_day_session_count}টি Driver session`;
}

function statusSeverity(row: DailyWorkspaceVehicle): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
  const state = collectionState(row);
  if (state === 'PAID') return 'success';
  if (state === 'PARTIAL') return 'warn';
  if (row.posted) return 'info';
  if (!row.eligible) return 'warn';
  if (row.default_garage_charge_type === 'SITTING') return 'warn';
  return 'secondary';
}

function vehicleStatusLabel(status: DailyWorkspaceVehicle['vehicle_status'] | VehicleStatus): string {
  const labels: Record<VehicleStatus, string> = {
    RUNNING: 'চলছে',
    SITTING: 'বসে আছে',
    MAINTENANCE: 'মেরামত',
    INACTIVE: 'বন্ধ'
  };
  return labels[status];
}

function rowStatus(row: DailyWorkspaceVehicle): string {
  const state = collectionState(row);
  if (state === 'PAID') return 'জমা হয়েছে';
  if (state === 'PARTIAL') return 'আংশিক জমা';
  if (row.posted) return 'হিসাব হয়েছে';
  if (row.blocker_code === 'DRIVER_REQUIRED_OR_SET_SITTING') return 'Driver নেই';
  if (!row.eligible) return 'আজ হিসাব নয়';
  return 'হিসাব হয়নি';
}

function errorMessage(errorValue: unknown): string {
  if (!(errorValue instanceof ApiError)) return 'Server-এর সাথে যোগাযোগ করা যায়নি।';
  const messages: Record<string, string> = {
    BUSINESS_DATE_INVALID: 'তারিখ সঠিক নয়।',
    BUSINESS_DATE_FUTURE_NOT_ALLOWED: 'ভবিষ্যতের তারিখে হিসাব করা যাবে না।',
    DAILY_ACCOUNT_ALREADY_POSTED: 'এই গাড়ির এই দিনের হিসাব আগেই করা হয়েছে।',
    DRIVER_REQUIRED_OR_SET_SITTING: 'Driver নেই। গাড়ি Sitting করুন অথবা Driver assign করুন।',
    VEHICLE_NOT_BILLABLE: 'Maintenance/Inactive গাড়ির দৈনিক হিসাব করা যাবে না।',
    OWNER_RENT_INVALID: 'মালিকের ভাড়ার পরিমাণ ঠিক করুন।',
    DAILY_ACCOUNT_NO_CHANGE: 'কোনো পরিবর্তন করা হয়নি।',
    DAILY_ACCOUNT_NOT_FOUND_OR_INACTIVE: 'এই হিসাবটি আর active নেই। Page refresh করুন।',
    DAILY_ACCOUNT_CHANGED: 'এই হিসাব অন্য জায়গা থেকে পরিবর্তিত হয়েছে। Page refresh করে আবার চেষ্টা করুন।',
    DAILY_ACCOUNT_JOURNAL_MISSING: 'হিসাবের accounting history অসম্পূর্ণ। Support প্রয়োজন।',
    DAILY_ACCOUNT_HAS_RECEIPTS: 'এই হিসাবের টাকা জমা নেওয়া হয়েছে। আগে জমা Edit/Delete করে তারপর হিসাব পরিবর্তন করুন।',
    GARAGE_CHARGE_INVALID: 'Garage টাকার পরিমাণ ঠিক করুন।',
    SAME_DAY_MULTIPLE_SESSIONS_REVIEW_REQUIRED: 'একই গাড়িতে একই দিনে একাধিক Driver session আছে। ভুল করে দুইবার full charge না দিতে প্রতিটি session আলাদা করে হিসাব করুন।'
  };
  return messages[errorValue.code] ?? 'তথ্য যাচাই করে আবার চেষ্টা করুন।';
}

function resultErrorMessage(code: string | undefined): string {
  if (code === 'SAME_DAY_MULTIPLE_SESSIONS_REVIEW_REQUIRED') {
    return 'একই গাড়ির একাধিক Driver session bulk Post করা যাবে না। প্রতিটি session খুলে amount দেখে আলাদা করে Post করুন।';
  }
  if (code === 'DUPLICATE_SESSION_IN_REQUEST') return 'একই Driver session দুইবার selected হয়েছে।';
  return 'নির্বাচিত গাড়িগুলোর তথ্য আবার দেখুন।';
}

function rebuildRows(data: DailyWorkspace): void {
  workspace.value = data;
  rows.value = data.vehicles.map((vehicle) => ({
    ...vehicle,
    sessionKey: `${vehicle.vehicle_id}:${vehicle.assignment_id || 'driverless'}`,
    selected: false,
    ownerRentTaka: Math.trunc(vehicle.default_owner_rent_poisha / 100),
    chargeType: vehicle.default_garage_charge_type
  }));
}

async function loadCashForDate(): Promise<void> {
  try {
    const summary = await getCashSummary(currentBusinessDate.value);
    receiptCashInPoisha.value = summary.receipt_cash_in_poisha;
  } catch {
    receiptCashInPoisha.value = 0;
  }
}

async function loadExpenseForDate(): Promise<void> {
  try {
    const summary = await getExpenseSummary(currentBusinessDate.value);
    expenseTotalPoisha.value = summary.total_poisha;
    expenseCount.value = summary.count;
  } catch {
    expenseTotalPoisha.value = 0;
    expenseCount.value = 0;
  }
}

async function loadWorkspace(): Promise<void> {
  const date = currentBusinessDate.value;
  if (!date) return;
  loading.value = true;
  error.value = '';
  try {
    rebuildRows(await getDailyWorkspace(date, search.value));
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

function newOperationId(): string {
  return crypto.randomUUID();
}

async function postSelected(): Promise<void> {
  const selected = rows.value.filter((row) => row.selected && row.eligible && !row.posted && !row.requires_session_review);
  if (!selected.length || posting.value) return;
  if (!navigator.onLine) {
    toast.add({ severity: 'warn', summary: 'ইন্টারনেট নেই', detail: 'হিসাব Save করতে internet লাগবে।', life: 3500 });
    return;
  }

  posting.value = true;
  try {
    const result = await postDailyAccounts(
      currentBusinessDate.value,
      selected.map((row) => ({
        vehicle_id: row.vehicle_id,
        assignment_id: row.assignment_id,
        owner_rent_poisha: Math.max(0, Math.trunc(row.ownerRentTaka || 0)) * 100,
        garage_charge_type: row.chargeType,
        operation_id: newOperationId()
      }))
    );

    if (result.posted.length) {
      toast.add({
        severity: 'success',
        summary: `${result.posted.length}টি হিসাব Save হয়েছে`,
        detail: result.errors.length ? `${result.errors.length}টি Save হয়নি।` : 'নির্বাচিত হিসাব সফলভাবে Posted হয়েছে।',
        life: 3500
      });
    }
    if (result.errors.length && !result.posted.length) {
      toast.add({ severity: 'error', summary: 'Save হয়নি', detail: resultErrorMessage(result.errors[0]?.error_code), life: 4500 });
    }
    await loadWorkspace();
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Save হয়নি', detail: errorMessage(err), life: 4500 });
  } finally {
    posting.value = false;
  }
}

function openMobile(row: EditableVehicle): void {
  if (row.posted) {
    void openDetail(row.posted.id);
    return;
  }
  if (!row.eligible) return;
  mobileRow.value = row;
  mobileRentTaka.value = Math.trunc(row.default_owner_rent_poisha / 100);
  mobileChargeType.value = row.default_garage_charge_type;
  mobileDialogVisible.value = true;
}

async function saveMobile(): Promise<void> {
  const row = mobileRow.value;
  if (!row || mobileSaving.value) return;
  if (!navigator.onLine) {
    toast.add({ severity: 'warn', summary: 'ইন্টারনেট নেই', detail: 'হিসাব Save করতে internet লাগবে।', life: 3500 });
    return;
  }
  mobileSaving.value = true;
  try {
    const result = await postDailyAccounts(currentBusinessDate.value, [{
      vehicle_id: row.vehicle_id,
      assignment_id: row.assignment_id,
      owner_rent_poisha: Math.max(0, Math.trunc(mobileRentTaka.value || 0)) * 100,
      garage_charge_type: mobileChargeType.value,
      operation_id: newOperationId()
    }]);
    if (result.posted.length) {
      toast.add({ severity: 'success', summary: 'হিসাব Save হয়েছে', detail: row.vehicle_no, life: 3000 });
      mobileDialogVisible.value = false;
      await loadWorkspace();
    } else {
      toast.add({ severity: 'error', summary: 'Save হয়নি', detail: 'গাড়ির তথ্য আবার দেখুন।', life: 4000 });
    }
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Save হয়নি', detail: errorMessage(err), life: 4500 });
  } finally {
    mobileSaving.value = false;
  }
}

async function openDetail(accountId: string): Promise<void> {
  detailVisible.value = true;
  detailLoading.value = true;
  editingDetail.value = false;
  detail.value = null;
  history.value = [];
  try {
    const account = await getDailyAccount(accountId);
    detail.value = account;
    detailRentTaka.value = Math.trunc(account.owner_rent_poisha / 100);
    detailChargeType.value = account.garage_charge_type;
    history.value = await getDailyAccountHistory(account.vehicle_id, account.business_date, account.assignment_id);
  } catch (err) {
    toast.add({ severity: 'error', summary: 'হিসাব খোলা যায়নি', detail: errorMessage(err), life: 4000 });
    detailVisible.value = false;
  } finally {
    detailLoading.value = false;
  }
}

async function saveCorrection(): Promise<void> {
  if (!detail.value || detailSaving.value) return;
  detailSaving.value = true;
  try {
    const corrected = await correctDailyAccount(detail.value.id, {
      owner_rent_poisha: Math.max(0, Math.trunc(detailRentTaka.value || 0)) * 100,
      garage_charge_type: detailChargeType.value,
      operation_id: newOperationId(),
      reason: 'User edit'
    });
    toast.add({ severity: 'success', summary: 'হিসাব Update হয়েছে', detail: `${corrected.vehicle_no} • Version ${corrected.version_no}`, life: 3500 });
    editingDetail.value = false;
    await loadWorkspace();
    await openDetail(corrected.id);
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Update হয়নি', detail: errorMessage(err), life: 4500 });
  } finally {
    detailSaving.value = false;
  }
}

async function confirmVoid(): Promise<void> {
  if (!detail.value || voiding.value) return;
  voiding.value = true;
  try {
    await voidDailyAccount(detail.value.id, { operation_id: newOperationId(), reason: 'User delete' });
    toast.add({ severity: 'success', summary: 'Delete হয়েছে', detail: 'Normal daily list থেকে হিসাবটি সরানো হয়েছে। History রাখা হয়েছে।', life: 3500 });
    voidConfirmVisible.value = false;
    detailVisible.value = false;
    await loadWorkspace();
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Delete হয়নি', detail: errorMessage(err), life: 4500 });
  } finally {
    voiding.value = false;
  }
}

function resetDetailEdit(): void {
  if (!detail.value) return;
  detailRentTaka.value = Math.trunc(detail.value.owner_rent_poisha / 100);
  detailChargeType.value = detail.value.garage_charge_type;
  editingDetail.value = false;
}

function openActions(row: EditableVehicle): void {
  actionRow.value = row;
  actionVisible.value = true;
}

function openAccountFromActions(row: EditableVehicle): void {
  actionVisible.value = false;
  if (row.posted) {
    void openDetail(row.posted.id);
    return;
  }
  if (!row.eligible) return;
  mobileRow.value = row;
  mobileRentTaka.value = Math.trunc(row.default_owner_rent_poisha / 100);
  mobileChargeType.value = row.default_garage_charge_type;
  mobileDialogVisible.value = true;
}

async function ensureAssignmentChoices(): Promise<void> {
  if (assignmentLoading.value) return;
  assignmentLoading.value = true;
  try {
    const [driverRows, vehicleRows] = await Promise.all([getDrivers(), getVehicles()]);
    assignmentDrivers.value = driverRows;
    assignmentVehicles.value = vehicleRows;
  } finally {
    assignmentLoading.value = false;
  }
}

async function openAssignFromActions(row: EditableVehicle): Promise<void> {
  if (!isToday.value) {
    toast.add({ severity: 'info', summary: 'আজকের কাজ', detail: 'Driver Assign বর্তমান দিনের workspace থেকে করুন।', life: 3000 });
    return;
  }
  actionVisible.value = false;
  try {
    await ensureAssignmentChoices();
    assignmentVehicleId.value = row.vehicle_id;
    assignmentVisible.value = true;
  } catch {
    toast.add({ severity: 'error', summary: 'Assignment লোড হয়নি', detail: 'Driver/গাড়ির তালিকা আবার চেষ্টা করুন।', life: 3500 });
  }
}

function openVehicleStatusFromActions(row: EditableVehicle): void {
  if (!isToday.value) {
    toast.add({ severity: 'info', summary: 'আজকের কাজ', detail: 'Vehicle Status শুধু আজকের live workspace থেকে পরিবর্তন করুন।', life: 3000 });
    return;
  }
  if (row.driver_id) {
    toast.add({ severity: 'warn', summary: 'Driver আছে', detail: 'Status পরিবর্তনের আগে Driver ছাড়ান।', life: 3200 });
    return;
  }
  actionVisible.value = false;
  vehicleStatusTarget.value = row;
  vehicleStatusValue.value = row.vehicle_status;
  vehicleStatusVisible.value = true;
}

async function saveVehicleStatus(): Promise<void> {
  const target = vehicleStatusTarget.value;
  if (!target || vehicleStatusSaving.value) return;
  if (!navigator.onLine) {
    toast.add({ severity: 'warn', summary: 'ইন্টারনেট নেই', detail: 'Status Save করতে internet লাগবে।', life: 3500 });
    return;
  }

  vehicleStatusSaving.value = true;
  try {
    const current = await getVehicle(target.vehicle_id);
    if (current.current_driver_id) {
      toast.add({ severity: 'warn', summary: 'Driver আছে', detail: 'এই গাড়িতে এখন Driver assign আছে। আগে Driver ছাড়ান।', life: 3800 });
      vehicleStatusVisible.value = false;
      await loadWorkspace();
      return;
    }

    await updateVehicle(current.id, {
      vehicle_no: current.vehicle_no,
      owner_id: current.owner_id,
      vehicle_type_id: current.vehicle_type_id,
      status: vehicleStatusValue.value,
      note: current.note
    });

    toast.add({
      severity: 'success',
      summary: 'Status পরিবর্তন হয়েছে',
      detail: `${current.vehicle_no} • ${vehicleStatusLabel(vehicleStatusValue.value)}`,
      life: 3000
    });
    vehicleStatusVisible.value = false;
    await loadWorkspace();
  } catch (err) {
    const detail = err instanceof ApiError && err.code === 'VEHICLE_NOT_FOUND'
      ? 'গাড়িটি পাওয়া যায়নি। Page refresh করুন।'
      : 'Vehicle Status Save হয়নি। আবার চেষ্টা করুন।';
    toast.add({ severity: 'error', summary: 'Status পরিবর্তন হয়নি', detail, life: 4000 });
  } finally {
    vehicleStatusSaving.value = false;
  }
}

async function openReleaseFromActions(row: EditableVehicle): Promise<void> {
  if (!row.assignment_id || !isToday.value) return;
  actionVisible.value = false;
  try {
    const history = await getAssignments({ vehicleId: row.vehicle_id });
    const assignment = history.find((item) => item.id === row.assignment_id && item.active)
      ?? history.find((item) => item.vehicle_id === row.vehicle_id && item.active)
      ?? null;
    if (!assignment) {
      toast.add({ severity: 'info', summary: 'Active Driver নেই', detail: 'Page refresh করে আবার চেষ্টা করুন।', life: 2800 });
      await loadWorkspace();
      return;
    }
    closeAssignmentTarget.value = assignment;
    closeAssignmentVisible.value = true;
  } catch {
    toast.add({ severity: 'error', summary: 'Driver history পাওয়া যায়নি', detail: 'আবার চেষ্টা করুন।', life: 3500 });
  }
}

function openReceiptFromActions(row: EditableVehicle): void {
  if (!row.posted) return;
  const payerId = row.payer_type === 'DRIVER' ? row.driver_id : row.owner_id;
  if (!payerId || !row.payer_type) return;
  actionVisible.value = false;
  receiptPayerType.value = row.payer_type;
  receiptPayerId.value = payerId;
  receiptBusinessDate.value = currentBusinessDate.value;
  receiptVehicleId.value = row.vehicle_id;
  receiptDailyAccountId.value = row.posted.id;
  receiptVisible.value = true;
}

async function refreshAfterOperation(): Promise<void> {
  assignmentVisible.value = false;
  closeAssignmentVisible.value = false;
  receiptVisible.value = false;
  actionVisible.value = false;
  await loadWorkspace();
}

function onReceiptSaved(_receipt: Receipt): void {
  receiptVisible.value = false;
  actionVisible.value = false;
  void Promise.all([loadWorkspace(), loadCashForDate()]);
}

function openExpense(): void {
  expenseVisible.value = true;
}

function onExpenseSaved(_expense: Expense): void {
  expenseVisible.value = false;
  void loadExpenseForDate();
}

function onExpenseDeleted(_expense: Expense): void {
  expenseVisible.value = false;
  void loadExpenseForDate();
}

watch(businessDate, () => {
  void loadWorkspace();
  void Promise.all([loadExpenseForDate(), loadCashForDate()]);
});
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void loadWorkspace(), 300);
});

onMounted(async () => {
  await Promise.all([loadWorkspace(), loadExpenseForDate(), loadCashForDate()]);
  const accountId = typeof route.query.account === 'string' ? route.query.account : '';
  if (accountId) await openDetail(accountId);
});
</script>

<template>
  <section class="daily-page">
    <div class="today-garage-heading">
      <div>
        <span class="today-garage-kicker">Daily Operations</span>
        <h1>আজকের গ্যারেজ</h1>
        <p>আজ কোন গাড়িতে Driver আছে, কার হিসাব হয়েছে এবং কোথায় কাজ বাকি আছে এক জায়গা থেকে দেখুন।</p>
      </div>
      <Button label="খরচ যোগ করুন" icon="pi pi-wallet" severity="secondary" outlined @click="openExpense" />
    </div>

    <div class="daily-toolbar">
      <div class="daily-date-field">
        <label for="daily-business-date">তারিখ</label>
        <DatePicker
          input-id="daily-business-date"
          v-model="businessDate"
          date-format="dd/mm/yy"
          show-icon
          :manual-input="false"
          :max-date="dhakaToday()"
          fluid
        />
      </div>

      <div class="daily-search-field">
        <label for="daily-search">খুঁজুন</label>
        <span class="p-input-icon-left daily-search-wrap">
          <i class="pi pi-search" />
          <InputText id="daily-search" v-model="search" placeholder="গাড়ি / Driver / মালিক" fluid />
        </span>
      </div>

      <div class="daily-toolbar-action desktop-daily-only">
        <Button
          :label="selectedCount ? `${selectedCount}টি Post করুন` : 'Post Selected'"
          icon="pi pi-check"
          :disabled="selectedCount === 0 || posting"
          :loading="posting"
          @click="postSelected"
        />
      </div>
    </div>

    <div v-if="workspace" class="today-garage-summary">
      <div class="today-summary-card"><span>গাড়ি</span><strong>{{ vehicleCount }}</strong></div>
      <div class="today-summary-card success"><span>Driver</span><strong>{{ assignedCount }}</strong></div>
      <div class="today-summary-card warn"><span>Driver নেই</span><strong>{{ driverlessCount }}</strong></div>
      <div class="today-summary-card teal"><span>হিসাব হয়েছে</span><strong>{{ postedCount }}</strong></div>
      <div class="today-summary-card amber"><span>হিসাব হয়নি</span><strong>{{ pendingCount }}</strong></div>
      <div class="today-summary-card deposit"><span>জমা</span><strong>{{ money(receiptCashInPoisha) }}</strong></div>
      <div class="today-summary-card unpaid"><span>জমা হয়নি</span><strong>{{ unpaidPostedCount }}</strong></div>
      <div class="today-summary-card expense"><span>খরচ <small v-if="expenseCount">({{ expenseCount }})</small></span><strong>{{ money(expenseTotalPoisha) }}</strong></div>
      <span class="daily-rate-note">FULL {{ money(workspace.rates.FULL) }} • HALF {{ money(workspace.rates.HALF) }} • SITTING {{ money(workspace.rates.SITTING) }}</span>
    </div>

    <Card v-if="error" class="home-error-card">
      <template #content>
        <div class="simple-state danger-state">
          <i class="pi pi-exclamation-triangle" />
          <div>
            <strong>আজকের গ্যারেজ লোড হয়নি</strong>
            <span>{{ error }}</span>
          </div>
          <Button label="Retry" icon="pi pi-refresh" severity="secondary" outlined @click="loadWorkspace" />
        </div>
      </template>
    </Card>

    <div v-else class="desktop-daily-only daily-table-wrap">
      <DataTable :value="sortedRows" :loading="loading" data-key="sessionKey" size="small" striped-rows>
        <template #empty>
          <div class="daily-empty">এই তারিখে হিসাব করার গাড়ি পাওয়া যায়নি।</div>
        </template>

        <Column header-style="width:3rem">
          <template #body="{ data }">
            <Checkbox v-model="data.selected" binary :disabled="!data.eligible || !!data.posted || data.requires_session_review" />
          </template>
        </Column>

        <Column header="গাড়ি">
          <template #body="{ data }">
            <div class="daily-identity-cell">
              <strong>{{ data.vehicle_no }}</strong>
              <small>{{ data.vehicle_type_name }}</small>
            </div>
          </template>
        </Column>

        <Column header="মালিক">
          <template #body="{ data }">
            <div class="daily-identity-cell">
              <strong>{{ data.owner_name }}</strong>
              <small>{{ data.owner_phone }}</small>
            </div>
          </template>
        </Column>

        <Column header="দেবে">
          <template #body="{ data }">
            <div class="daily-identity-cell">
              <strong>{{ payerLabel(data) }}</strong>
              <small v-if="data.payer_type === 'DRIVER'">Driver • {{ sessionTimeLabel(data) }}</small>
              <small v-if="data.requires_session_review" class="daily-session-warning"><i class="pi pi-exclamation-triangle" /> {{ sessionReviewText(data) }}</small>
              <small v-else-if="data.payer_type === 'OWNER'">Owner</small>
              <small v-else class="text-warning">Driver assign করুন</small>
            </div>
          </template>
        </Column>

        <Column header="মালিকের ভাড়া">
          <template #body="{ data }">
            <span v-if="data.posted">{{ money(data.posted.owner_rent_poisha) }}</span>
            <InputNumber
              v-else
              v-model="data.ownerRentTaka"
              prefix="৳ "
              :min="0"
              :max-fraction-digits="0"
              :use-grouping="false"
              inputmode="numeric"
              :disabled="!data.eligible || data.payer_type === 'OWNER'"
              class="daily-money-input"
            />
          </template>
        </Column>

        <Column header="Charge">
          <template #body="{ data }">
            <Tag v-if="data.posted" :value="data.posted.garage_charge_type" :severity="data.posted.garage_charge_type === 'SITTING' ? 'warn' : 'success'" />
            <Select
              v-else
              v-model="data.chargeType"
              :options="chargeOptions"
              option-label="label"
              option-value="value"
              :disabled="!data.eligible || data.payer_type === 'OWNER'"
              class="daily-charge-select"
            />
          </template>
        </Column>

        <Column header="Garage">
          <template #body="{ data }">
            <strong>{{ data.posted ? money(data.posted.garage_charge_poisha) : money(chargeAmount(data)) }}</strong>
          </template>
        </Column>

        <Column header="Status">
          <template #body="{ data }">
            <Tag :value="rowStatus(data)" :severity="statusSeverity(data)" rounded />
          </template>
        </Column>

        <Column header="কাজ" header-style="width:7rem">
          <template #body="{ data }">
            <Button
              label="কাজ করুন"
              icon="pi pi-bolt"
              severity="secondary"
              outlined
              size="small"
              @click="openActions(data)"
            />
          </template>
        </Column>
      </DataTable>

      <div v-if="selectedCount" class="daily-sticky-post">
        <span>{{ selectedCount }}টি গাড়ি selected</span>
        <Button :label="`${selectedCount}টি Post করুন`" icon="pi pi-check" :loading="posting" @click="postSelected" />
      </div>
    </div>

    <div class="mobile-daily-only daily-mobile-list">
      <div v-if="loading" class="daily-empty">লোড হচ্ছে...</div>
      <div v-else-if="!rows.length" class="daily-empty">এই তারিখে কোনো গাড়ি পাওয়া যায়নি।</div>

      <article v-for="row in sortedRows" :key="`${row.vehicle_id}:${row.assignment_id || 'driverless'}`" class="daily-mobile-card">
        <div class="daily-mobile-card-head">
          <div>
            <strong>{{ row.vehicle_no }}</strong>
            <small>{{ row.vehicle_type_name }}</small>
          </div>
          <Tag :value="rowStatus(row)" :severity="statusSeverity(row)" rounded />
        </div>

        <div class="daily-mobile-meta">
          <span><i class="pi pi-user" /> মালিক: <strong>{{ row.owner_name }}</strong></span>
          <span><i class="pi pi-id-card" /> দেবে: <strong>{{ payerLabel(row) }}</strong></span>
          <span v-if="row.assignment_start_time"><i class="pi pi-clock" /> Session: <strong>{{ row.assignment_start_time.slice(0, 5) }}{{ row.assignment_end_time ? `–${row.assignment_end_time.slice(0, 5)}` : '' }}</strong></span>
          <span v-if="row.requires_session_review" class="daily-session-warning"><i class="pi pi-exclamation-triangle" /> {{ sessionReviewText(row) }} • amount আলাদা করে দেখুন</span>
          <span v-if="row.posted"><i class="pi pi-wallet" /> মোট: <strong>{{ money(row.posted.owner_rent_poisha + row.posted.garage_charge_poisha) }}</strong></span>
          <span v-else-if="row.eligible"><i class="pi pi-wallet" /> Default: <strong>{{ money(row.default_owner_rent_poisha + row.default_garage_charge_poisha) }}</strong></span>
          <span v-else class="text-warning"><i class="pi pi-exclamation-triangle" /> Driver assign করুন অথবা গাড়ি Sitting করুন</span>
        </div>

        <Button
          label="কাজ করুন"
          icon="pi pi-bolt"
          icon-pos="right"
          :severity="row.posted ? 'secondary' : undefined"
          :outlined="!!row.posted"
          fluid
          @click="openActions(row)"
        />
      </article>
    </div>

    <Dialog v-model:visible="actionVisible" modal header="আজকের কাজ" class="today-action-dialog" :draggable="false">
      <div v-if="actionRow" class="today-action-body">
        <div class="daily-dialog-identity">
          <div>
            <strong>{{ actionRow.vehicle_no }}</strong>
            <span>{{ actionRow.vehicle_type_name }}</span>
          </div>
          <Tag :value="rowStatus(actionRow)" :severity="statusSeverity(actionRow)" rounded />
        </div>

        <div class="daily-context-box">
          <span>মালিক <strong>{{ actionRow.owner_name }}</strong></span>
          <span>Driver <strong>{{ actionRow.driver_name || 'নেই' }}</strong></span>
          <span>গাড়ির Status <strong>{{ vehicleStatusLabel(actionRow.vehicle_status) }}</strong></span>
          <span>তারিখ <strong>{{ currentBusinessDate }}</strong></span>
        </div>

        <div v-if="actionRow.requires_session_review" class="today-action-note warn daily-session-review-note">
          <i class="pi pi-exclamation-triangle" />
          এই গাড়িতে আজ {{ actionRow.same_day_session_count }}টি Driver session আছে। ভুল করে Full হিসাব দুইবার দেবেন না। এই Driver-এর session time ও amount দেখে আলাদা করে হিসাব করুন।
        </div>

        <div v-if="actionRow.posted" class="today-action-money">
          <div><span>মালিকের ভাড়া</span><strong>{{ money(actionRow.posted.owner_rent_poisha) }}</strong></div>
          <div><span>গ্যারেজ</span><strong>{{ money(actionRow.posted.garage_charge_poisha) }}</strong></div>
        </div>

        <div class="today-action-buttons">
          <Button
            v-if="!actionRow.driver_id && isToday"
            label="Driver Assign"
            icon="pi pi-user-plus"
            @click="openAssignFromActions(actionRow)"
          />
          <Button
            v-if="!actionRow.driver_id && isToday"
            label="Vehicle Status পরিবর্তন"
            icon="pi pi-sync"
            severity="secondary"
            outlined
            @click="openVehicleStatusFromActions(actionRow)"
          />
          <Button
            v-if="!actionRow.posted && actionRow.eligible"
            :label="actionRow.payer_type === 'OWNER' ? 'Sitting হিসাব করুন' : 'আজকের হিসাব করুন'"
            icon="pi pi-calendar-plus"
            @click="openAccountFromActions(actionRow)"
          />
          <Button
            v-if="actionRow.posted"
            label="জমা নিন"
            icon="pi pi-wallet"
            @click="openReceiptFromActions(actionRow)"
          />
          <Button
            v-if="actionRow.posted"
            label="হিসাব দেখুন"
            icon="pi pi-eye"
            severity="secondary"
            outlined
            @click="openAccountFromActions(actionRow)"
          />
          <Button
            v-if="actionRow.assignment_id && actionRow.driver_id && isToday"
            label="Driver ছাড়ান"
            icon="pi pi-sign-out"
            severity="secondary"
            outlined
            @click="openReleaseFromActions(actionRow)"
          />
        </div>

        <div v-if="!isToday" class="today-action-note">পুরনো তারিখ দেখা হচ্ছে। Driver Assign/ছাড়ানোর live action শুধু আজকের তারিখে পাওয়া যাবে।</div>
        <div v-else-if="!actionRow.eligible && !actionRow.posted && !actionRow.driver_id" class="today-action-note warn">এই গাড়িতে Driver নেই। Driver Assign করুন অথবা Vehicle Status ‘বসে আছে’ করুন।</div>
      </div>
    </Dialog>

    <Dialog v-model:visible="vehicleStatusVisible" modal header="গাড়ির Status পরিবর্তন" class="small-confirm-dialog" :draggable="false">
      <div v-if="vehicleStatusTarget" class="daily-form-stack">
        <div class="daily-dialog-identity">
          <div>
            <strong>{{ vehicleStatusTarget.vehicle_no }}</strong>
            <span>{{ vehicleStatusTarget.vehicle_type_name }}</span>
          </div>
          <Tag :value="vehicleStatusLabel(vehicleStatusTarget.vehicle_status)" severity="secondary" rounded />
        </div>

        <div class="form-field">
          <label for="today-vehicle-status">নতুন Status</label>
          <Select
            input-id="today-vehicle-status"
            v-model="vehicleStatusValue"
            :options="vehicleStatusOptions"
            option-label="label"
            option-value="value"
            fluid
          />
        </div>

        <div v-if="vehicleStatusValue === 'SITTING'" class="today-action-note">
          Driver না থাকলে Sitting হিসাব Owner-এর নামে হবে।
        </div>
        <div v-else-if="vehicleStatusValue === 'MAINTENANCE' || vehicleStatusValue === 'INACTIVE'" class="today-action-note">
          এই Status-এ আজকের দৈনিক bill তৈরি হবে না।
        </div>
        <div v-else-if="vehicleStatusValue === 'RUNNING'" class="today-action-note warn">
          Driver ছাড়া গাড়ি ‘চলছে’ রাখলে আজকের হিসাব করা যাবে না। Driver Assign করুন।
        </div>

        <div class="daily-dialog-actions">
          <Button label="বাতিল" severity="secondary" outlined @click="vehicleStatusVisible = false" />
          <Button label="Save করুন" icon="pi pi-check" :loading="vehicleStatusSaving" @click="saveVehicleStatus" />
        </div>
      </div>
    </Dialog>

    <AssignmentDialog
      v-model:visible="assignmentVisible"
      :drivers="assignmentDrivers"
      :vehicles="assignmentVehicles"
      :initial-vehicle-id="assignmentVehicleId"
      :lock-vehicle="true"
      @saved="refreshAfterOperation"
    />

    <CloseAssignmentDialog
      v-model:visible="closeAssignmentVisible"
      :assignment="closeAssignmentTarget"
      @closed="refreshAfterOperation"
    />

    <ReceiptDialog
      v-model:visible="receiptVisible"
      :initial-payer-type="receiptPayerType"
      :initial-payer-id="receiptPayerId"
      :initial-business-date="receiptBusinessDate"
      :initial-vehicle-id="receiptVehicleId"
      :initial-daily-account-id="receiptDailyAccountId"
      :lock-payer="true"
      @saved="onReceiptSaved"
    />

    <ExpenseDialog
      v-model:visible="expenseVisible"
      :initial-business-date="currentBusinessDate"
      @saved="onExpenseSaved"
      @deleted="onExpenseDeleted"
    />

    <Dialog v-model:visible="mobileDialogVisible" modal header="আজকের হিসাব" class="daily-mobile-dialog">
      <div v-if="mobileRow" class="daily-form-stack">
        <div class="daily-dialog-identity">
          <div>
            <strong>{{ mobileRow.vehicle_no }}</strong>
            <span>{{ mobileRow.vehicle_type_name }}</span>
          </div>
          <Tag :value="mobileRow.payer_type === 'OWNER' ? 'Owner দেবে' : 'Driver দেবে'" :severity="mobileRow.payer_type === 'OWNER' ? 'warn' : 'success'" />
        </div>

        <div class="daily-context-box">
          <span>মালিক <strong>{{ mobileRow.owner_name }}</strong></span>
          <span>{{ mobileRow.payer_type === 'DRIVER' ? 'Driver' : 'Payer' }} <strong>{{ payerLabel(mobileRow) }}</strong></span>
          <span v-if="mobileRow.assignment_start_time">Session <strong>{{ sessionTimeLabel(mobileRow) }}</strong></span>
          <span>তারিখ <strong>{{ currentBusinessDate }}</strong></span>
        </div>

        <div v-if="mobileRow.requires_session_review" class="today-action-note warn daily-session-review-note">
          <i class="pi pi-exclamation-triangle" /> একই গাড়িতে আজ {{ mobileRow.same_day_session_count }}টি Driver session। এই Driver-এর amount confirm করে Save করুন।
        </div>

        <div class="form-field">
          <label for="mobile-owner-rent">মালিকের ভাড়া</label>
          <InputNumber
            input-id="mobile-owner-rent"
            v-model="mobileRentTaka"
            prefix="৳ "
            :min="0"
            :max-fraction-digits="0"
            :use-grouping="false"
            inputmode="numeric"
            :disabled="mobileRow.payer_type === 'OWNER'"
            fluid
          />
        </div>

        <div class="form-field">
          <label for="mobile-charge-type">Garage Charge</label>
          <Select
            input-id="mobile-charge-type"
            v-model="mobileChargeType"
            :options="chargeOptions"
            option-label="label"
            option-value="value"
            :disabled="mobileRow.payer_type === 'OWNER'"
            fluid
          />
        </div>

        <div class="daily-total-box">
          <span>Garage</span>
          <strong>{{ money(workspace?.rates[mobileChargeType] ?? 0) }}</strong>
        </div>

        <Button label="Save করুন" icon="pi pi-check" :loading="mobileSaving" fluid @click="saveMobile" />
      </div>
    </Dialog>

    <Dialog v-model:visible="detailVisible" modal header="হিসাব" class="daily-detail-dialog">
      <div v-if="detailLoading" class="daily-empty">লোড হচ্ছে...</div>
      <div v-else-if="detail" class="daily-form-stack">
        <div class="daily-dialog-identity">
          <div>
            <strong>{{ detail.vehicle_no }}</strong>
            <span>{{ detail.business_date }} • Version {{ detail.version_no }}</span>
          </div>
          <Tag :value="detail.status" :severity="detail.status === 'POSTED' ? 'success' : 'secondary'" />
        </div>

        <div class="daily-context-box">
          <span>মালিক <strong>{{ detail.owner_name }}</strong></span>
          <span>{{ detail.payer_type === 'DRIVER' ? 'Driver' : 'Payer' }} <strong>{{ detail.payer_name }}</strong></span>
        </div>

        <template v-if="editingDetail && detail.status === 'POSTED'">
          <div class="form-field">
            <label for="detail-rent">মালিকের ভাড়া</label>
            <InputNumber
              input-id="detail-rent"
              v-model="detailRentTaka"
              prefix="৳ "
              :min="0"
              :max-fraction-digits="0"
              :use-grouping="false"
              inputmode="numeric"
              :disabled="detail.payer_type === 'OWNER'"
              fluid
            />
          </div>
          <div class="form-field">
            <label for="detail-charge-type">Garage Charge</label>
            <Select
              input-id="detail-charge-type"
              v-model="detailChargeType"
              :options="chargeOptions"
              option-label="label"
              option-value="value"
              :disabled="detail.payer_type === 'OWNER'"
              fluid
            />
          </div>
          <div class="daily-dialog-actions">
            <Button label="বাতিল" severity="secondary" outlined @click="resetDetailEdit" />
            <Button label="Update" icon="pi pi-check" :loading="detailSaving" @click="saveCorrection" />
          </div>
        </template>

        <template v-else>
          <div class="daily-detail-money-grid">
            <div><span>মালিকের ভাড়া</span><strong>{{ money(detail.owner_rent_poisha) }}</strong></div>
            <div><span>{{ detail.garage_charge_type }}</span><strong>{{ money(detail.garage_charge_poisha) }}</strong></div>
          </div>

          <div v-if="detail.status === 'POSTED'" class="daily-dialog-actions">
            <Button label="Edit" icon="pi pi-pencil" severity="secondary" outlined @click="editingDetail = true" />
            <Button label="Delete" icon="pi pi-trash" severity="danger" outlined @click="voidConfirmVisible = true" />
          </div>
        </template>

        <div v-if="history.length > 1" class="daily-history-list">
          <strong>History</strong>
          <div v-for="item in history" :key="item.id" class="daily-history-row">
            <span>Version {{ item.version_no }} • {{ item.status }}</span>
            <span>{{ money(item.owner_rent_poisha + item.garage_charge_poisha) }}</span>
          </div>
        </div>
      </div>
    </Dialog>

    <Dialog v-model:visible="voidConfirmVisible" modal header="Delete করবেন?" class="small-confirm-dialog">
      <p>এই হিসাব normal list থেকে সরবে, কিন্তু database/history থেকে hard delete হবে না।</p>
      <div class="daily-dialog-actions">
        <Button label="না" severity="secondary" outlined @click="voidConfirmVisible = false" />
        <Button label="Delete" icon="pi pi-trash" severity="danger" :loading="voiding" @click="confirmVoid" />
      </div>
    </Dialog>
  </section>
</template>
