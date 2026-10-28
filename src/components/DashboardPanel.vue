<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { getDashboardStats } from '../api';
import type { DashboardStats } from '../types';

const loading = ref(false);
const error = ref('');
const stats = ref<DashboardStats | null>(null);

const currency = computed(() => stats.value?.currencySymbol || '৳');

function money(value: unknown): string {
  return `${currency.value}${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function quantity(value: unknown): string {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    stats.value = await getDashboardStats();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Dashboard failed to load.';
  } finally {
    loading.value = false;
  }
}

defineExpose({ refresh: load });

onMounted(() => void load());
</script>

<template>
  <section class="dashboard-page">
    <div class="dashboard-toolbar">
      <div>
        <h2>Dashboard</h2>
        <span class="bn-hint">আজকের অবস্থা</span>
      </div>
    </div>

    <div v-if="error" class="alert danger">{{ error }}</div>

    <template v-if="stats">
      <div class="dashboard-stat-grid">
        <div class="dashboard-stat-card"><span>Today's Sales</span><strong>{{ money(stats.todaySalesTotal) }}</strong><small>{{ stats.todaySalesCount }} invoices</small></div>
        <div class="dashboard-stat-card"><span>Today's Profit</span><strong>{{ money(stats.todayProfit) }}</strong></div>
        <div class="dashboard-stat-card"><span>Today's Expenses</span><strong>{{ money(stats.todayExpenseTotal) }}</strong></div>
        <div class="dashboard-stat-card"><span>Cash Balance</span><strong>{{ money(stats.cashBalance) }}</strong></div>
        <div class="dashboard-stat-card"><span>Total Bank Balance</span><strong>{{ money(stats.totalBankBalance) }}</strong></div>
        <div class="dashboard-stat-card"><span>Total Balance</span><strong>{{ money(stats.totalBalance) }}</strong><small>Cash + Bank</small></div>
        <div class="dashboard-stat-card"><span>Due Receivable</span><strong>{{ money(stats.dueReceivable) }}</strong></div>
        <div class="dashboard-stat-card"><span>Supplier Payable</span><strong>{{ money(stats.supplierPayable) }}</strong></div>
        <div class="dashboard-stat-card"><span>Inventory Value</span><strong>{{ money(stats.inventoryValue) }}</strong></div>
        <div class="dashboard-stat-card"><span>Low Stock Items</span><strong>{{ stats.lowStockCount }}</strong></div>
        <div class="dashboard-stat-card"><span>Owner Capital</span><strong>{{ money(stats.ownerCapital) }}</strong></div>
        <div class="dashboard-stat-card"><span>Outstanding Loan</span><strong>{{ money(stats.outstandingLoan) }}</strong></div>
      </div>

      <div class="card dashboard-section-card">
        <div class="dashboard-section-title"><strong>This Month</strong><span class="bn-hint">এই মাসের হিসাব</span></div>
        <div class="dashboard-month-grid">
          <div class="mini-stat"><span>Sales</span><strong>{{ money(stats.monthSalesTotal) }}</strong></div>
          <div class="mini-stat"><span>Gross Profit</span><strong>{{ money(stats.monthGrossProfit) }}</strong></div>
          <div class="mini-stat"><span>Gross Margin</span><strong>{{ Number(stats.monthGrossMarginPercent || 0).toFixed(1) }}%</strong></div>
          <div class="mini-stat"><span>Expenses</span><strong>{{ money(stats.monthExpenseTotal) }}</strong></div>
          <div class="mini-stat"><span>Net Profit</span><strong>{{ money(stats.monthProfit) }}</strong></div>
        </div>
      </div>

      <div v-if="stats.profitCoverageWarning > 0" class="card dashboard-warning">
        <strong>Profit figures are optimistic <span class="bn-hint" style="display:inline;">— লাভ পুরোপুরি সঠিক নয়</span></strong>
        <p><b>{{ stats.profitCoverageWarning }}</b> of <b>{{ stats.profitCoverageTotal }}</b> invoices this month have no FIFO lot-cost data, so those invoices contribute revenue without complete cost coverage.</p>
      </div>

      <div v-if="stats.activityAvailable" class="card dashboard-section-card">
        <div class="dashboard-section-title"><strong>Recent Activity</strong><span class="bn-hint">সাম্প্রতিক লেনদেন</span></div>
        <div class="table-scroll">
          <table class="dashboard-table">
            <thead><tr><SortableHeader table-id="dashboard-activity" column="date" type="date">When</SortableHeader><SortableHeader table-id="dashboard-activity" column="module">Module</SortableHeader><SortableHeader table-id="dashboard-activity" column="transactionType">Type</SortableHeader><SortableHeader table-id="dashboard-activity" column="referenceNo">Reference</SortableHeader><SortableHeader table-id="dashboard-activity" column="party">Party</SortableHeader><SortableHeader table-id="dashboard-activity" column="cashIn" type="number" class="num">In</SortableHeader><SortableHeader table-id="dashboard-activity" column="cashOut" type="number" class="num">Out</SortableHeader></tr></thead>
            <tbody>
              <tr v-for="row in $sortRows('dashboard-activity', stats.activity)" :key="`${row.referenceNo}-${row.date}-${row.time}`">
                <td class="mono">{{ row.date }}<span v-if="row.time"> {{ row.time.slice(0,5) }}</span></td>
                <td>{{ row.module }} <span v-if="row.isBackdated" class="badge badge-warning">backdated</span></td>
                <td>{{ row.transactionType }}</td><td class="mono">{{ row.referenceNo }}</td><td>{{ row.party }}</td>
                <td class="num mono">{{ row.cashIn ? money(row.cashIn) : '' }}</td><td class="num mono">{{ row.cashOut ? money(row.cashOut) : '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="stats.activity.length === 0" class="empty-state">No transactions in the last 7 days.</div>
      </div>

      <div class="dashboard-two-column">
        <div class="card dashboard-section-card">
          <div class="dashboard-section-title"><strong>Top Products This Month</strong><span class="bn-hint">বেশি বিক্রি হওয়া মাল</span></div>
          <div class="table-scroll"><table class="dashboard-table"><thead><tr><SortableHeader table-id="dashboard-top-products" column="name">Product</SortableHeader><SortableHeader table-id="dashboard-top-products" column="qtySold" type="number" class="num">Sold</SortableHeader><SortableHeader table-id="dashboard-top-products" column="revenue" type="number" class="num">Revenue</SortableHeader><SortableHeader table-id="dashboard-top-products" column="profit" type="number" class="num">Profit</SortableHeader></tr></thead><tbody><tr v-for="p in $sortRows('dashboard-top-products', stats.topProducts)" :key="p.name"><td>{{ p.name }}</td><td class="num mono">{{ quantity(p.qtySold) }}</td><td class="num mono">{{ money(p.revenue) }}</td><td class="num mono">{{ money(p.profit) }}</td></tr></tbody></table></div>
          <div v-if="stats.topProducts.length === 0" class="empty-state">No sales yet this month.</div>
        </div>

        <div class="card dashboard-section-card">
          <div class="dashboard-section-title"><strong>Expenses This Month</strong><span class="bn-hint">এই মাসের খরচ</span></div>
          <div class="table-scroll"><table class="dashboard-table"><thead><tr><SortableHeader table-id="dashboard-expenses" column="label">Category</SortableHeader><SortableHeader table-id="dashboard-expenses" column="entries" type="number" class="num">Entries</SortableHeader><SortableHeader table-id="dashboard-expenses" column="amount" type="number" class="num">Amount</SortableHeader></tr></thead><tbody><tr v-for="e in $sortRows('dashboard-expenses', stats.expenseByCategory)" :key="e.label"><td>{{ e.label }}</td><td class="num mono">{{ e.entries }}</td><td class="num mono">{{ money(e.amount) }}</td></tr></tbody></table></div>
          <div v-if="stats.expenseByCategory.length === 0" class="empty-state">No expenses recorded this month.</div>
        </div>
      </div>

      <div class="dashboard-two-column">
        <div class="card dashboard-section-card">
          <div class="dashboard-section-title"><strong>Top Outstanding Customers</strong><span class="bn-hint">বেশি বাকি আছে যাদের</span></div>
          <div class="table-scroll"><table class="dashboard-table"><thead><tr><SortableHeader table-id="dashboard-debtors" column="name">Customer</SortableHeader><SortableHeader table-id="dashboard-debtors" column="phone">Phone</SortableHeader><SortableHeader table-id="dashboard-debtors" column="due" type="number" class="num">Due</SortableHeader></tr></thead><tbody><tr v-for="c in $sortRows('dashboard-debtors', stats.topDebtors)" :key="`${c.name}-${c.phone}`"><td>{{ c.name }}</td><td>{{ c.phone }}</td><td class="num mono">{{ money(c.due) }}</td></tr></tbody></table></div>
          <div v-if="stats.topDebtors.length === 0" class="empty-state">Nobody owes anything right now.</div>
        </div>

        <div class="card dashboard-section-card">
          <div class="dashboard-section-title"><strong>Bank Balances</strong><span class="bn-hint">ব্যাংকে কত আছে</span></div>
          <div class="table-scroll"><table class="dashboard-table"><thead><tr><SortableHeader table-id="dashboard-bank" column="name">Account</SortableHeader><SortableHeader table-id="dashboard-bank" column="balance" type="number" class="num">Balance</SortableHeader></tr></thead><tbody><tr v-for="b in $sortRows('dashboard-bank', stats.bankAccounts)" :key="b.id"><td>{{ b.name }}</td><td class="num mono">{{ money(b.balance) }}</td></tr></tbody></table></div>
          <div v-if="stats.bankAccounts.length === 0" class="empty-state">No active bank accounts yet.</div>
        </div>
      </div>

      <div class="card dashboard-section-card">
        <div class="dashboard-section-title"><strong>Low Stock</strong><span class="bn-hint">মাল কমে গেছে</span></div>
        <div class="table-scroll"><table class="dashboard-table"><thead><tr><SortableHeader table-id="dashboard-low-stock" column="name">Product</SortableHeader><SortableHeader table-id="dashboard-low-stock" column="stock" type="number" class="num">Stock</SortableHeader><SortableHeader table-id="dashboard-low-stock" column="min" type="number" class="num">Minimum</SortableHeader></tr></thead><tbody><tr v-for="p in $sortRows('dashboard-low-stock', stats.lowStockItems)" :key="p.name"><td>{{ p.name }}</td><td class="num mono">{{ quantity(p.stock) }}</td><td class="num mono">{{ quantity(p.min) }}</td></tr></tbody></table></div>
        <div v-if="stats.lowStockItems.length === 0" class="empty-state">Nothing is low on stock right now.</div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.dashboard-page{display:flex;flex-direction:column;gap:14px}.dashboard-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px}.dashboard-toolbar h2{margin:0;font-size:18px}.dashboard-stat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.dashboard-stat-card,.mini-stat{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:13px 14px;min-width:0}.dashboard-stat-card span,.mini-stat span{display:block;color:#64748b;font-size:12px;font-weight:700}.dashboard-stat-card strong,.mini-stat strong{display:block;margin-top:5px;font-size:20px;line-height:1.2;color:#0f172a;overflow-wrap:anywhere}.dashboard-stat-card small{display:block;margin-top:4px;color:#94a3b8}.dashboard-section-card{margin:0}.dashboard-section-title{display:flex;align-items:baseline;gap:8px;margin-bottom:10px}.dashboard-section-title strong{font-size:14px}.dashboard-month-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.mini-stat strong{font-size:17px}.dashboard-warning{border-left:3px solid #b7791f}.dashboard-warning p{margin:6px 0 0;color:#64748b;font-size:12px;line-height:1.5}.dashboard-two-column{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.dashboard-table{min-width:520px}.dashboard-table th,.dashboard-table td{white-space:nowrap}.dashboard-table td:first-child,.dashboard-table th:first-child{white-space:normal}.num{text-align:right}
@media(max-width:1100px){.dashboard-stat-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.dashboard-month-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:820px){.dashboard-stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dashboard-two-column{grid-template-columns:1fr}.dashboard-month-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:520px){.dashboard-page{gap:10px}.dashboard-stat-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.dashboard-stat-card{padding:11px 12px}.dashboard-stat-card strong{font-size:17px}.dashboard-month-grid{grid-template-columns:1fr 1fr}.mini-stat{padding:10px 11px}.mini-stat strong{font-size:15px}.dashboard-toolbar h2{font-size:16px}}
</style>
