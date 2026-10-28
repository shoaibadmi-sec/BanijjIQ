<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import ModuleTabs from './ModuleTabs.vue';
import {
  getReportsBootstrap,
  getSalesReport,
  getPurchaseReport,
  getStockReport,
  getCashBankReport,
  getProfitReport,
  getBalanceSheetReport
} from '../api';
import type {
  ReportsBootstrap, SalesReport, PurchaseReport, StockReport,
  CashBankReport, ProfitReport, BalanceSheetReport
} from '../types';

type TabKey = 'sales' | 'purchase' | 'stock' | 'cashbank' | 'profit' | 'balancesheet';
const tabs = [
  { key: 'sales', label: 'Sales', hint: 'বিক্রির রিপোর্ট' },
  { key: 'purchase', label: 'Purchase', hint: 'কেনার রিপোর্ট' },
  { key: 'stock', label: 'Stock & Valuation', hint: 'মালের হিসাব' },
  { key: 'cashbank', label: 'Cash & Bank', hint: 'ক্যাশ ও ব্যাংক' },
  { key: 'profit', label: 'Profit', hint: 'লাভের হিসাব' },
  { key: 'balancesheet', label: 'Balance Sheet', hint: 'সম্পদ ও দেনার হিসাব' }
] as const;

const activeTab = ref<TabKey>('sales');
const bootstrap = ref<ReportsBootstrap | null>(null);
const loading = ref(false);
const error = ref('');
const filters = reactive({ from: '', to: '' });
const sales = ref<SalesReport | null>(null);
const purchase = ref<PurchaseReport | null>(null);
const stock = ref<StockReport | null>(null);
const cashbank = ref<CashBankReport | null>(null);
const profit = ref<ProfitReport | null>(null);
const balanceSheet = ref<BalanceSheetReport | null>(null);

const currency = computed(() => bootstrap.value?.currencySymbol || '৳');
function money(v: unknown): string { return `${currency.value}${Number(v || 0).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:2})}`; }
function qty(v: unknown): string { return Number(v || 0).toLocaleString(undefined,{maximumFractionDigits:4}); }
function pct(v: unknown): string { return `${Number(v || 0).toFixed(1)}%`; }

async function loadBootstrap(): Promise<void> {
  const d = await getReportsBootstrap();
  bootstrap.value = d;
  filters.from ||= d.defaultFrom;
  filters.to ||= d.defaultTo;
}

async function loadActive(): Promise<void> {
  loading.value = true; error.value = '';
  try {
    const range = { from: filters.from, to: filters.to };
    if (activeTab.value === 'sales') sales.value = await getSalesReport(range);
    else if (activeTab.value === 'purchase') purchase.value = await getPurchaseReport(range);
    else if (activeTab.value === 'stock') stock.value = await getStockReport();
    else if (activeTab.value === 'cashbank') cashbank.value = await getCashBankReport(range);
    else if (activeTab.value === 'profit') profit.value = await getProfitReport(range);
    else balanceSheet.value = await getBalanceSheetReport();
  } catch (e) { error.value = e instanceof Error ? e.message : 'Report failed to load.'; }
  finally { loading.value = false; }
}

async function run(): Promise<void> { await loadActive(); }
function todayRange(): void { if (!bootstrap.value) return; filters.from = bootstrap.value.defaultTo; filters.to = bootstrap.value.defaultTo; void loadActive(); }
function monthRange(): void { if (!bootstrap.value) return; filters.from = bootstrap.value.defaultFrom; filters.to = bootstrap.value.defaultTo; void loadActive(); }
function printReport(): void { document.body.classList.add('printing-reports'); window.print(); setTimeout(()=>document.body.classList.remove('printing-reports'),100); }

async function refresh(): Promise<void> {
  await loadBootstrap();
  await loadActive();
}
defineExpose({ refresh });

watch(activeTab, () => void loadActive());
onMounted(async () => { try { await loadBootstrap(); await loadActive(); } catch (e) { error.value = e instanceof Error ? e.message : 'Reports failed to load.'; } });
</script>

<template>
  <section class="reports-page">
    <div class="toolbar report-toolbar">
      <label>From</label><input v-model="filters.from" type="date" />
      <label>To</label><input v-model="filters.to" type="date" />
      <button class="btn btn-primary" :disabled="loading" @click="run">{{ loading ? 'Loading...' : 'Run' }}</button>
      <div class="toolbar-spacer"></div>
      <button class="btn" @click="todayRange">Today</button>
      <button class="btn" @click="monthRange">This Month</button>
      <button class="btn" @click="printReport">Print</button>
    </div>

    <ModuleTabs v-model="activeTab" :tabs="tabs" aria-label="Report sections" />
    <div v-if="error" class="alert danger">{{ error }}</div>
    <div class="report-print-heading"><h2>{{ bootstrap?.shopName || 'SherERP' }}</h2><div>{{ tabs.find(t=>t.key===activeTab)?.label }} · {{ filters.from }} to {{ filters.to }}</div></div>

    <template v-if="activeTab==='sales' && sales">
      <div class="stat-grid report-stats">
        <div class="stat-card"><div class="stat-label">Invoices</div><div class="stat-value">{{ sales.totals.invoices }}</div></div>
        <div class="stat-card"><div class="stat-label">Gross Sales</div><div class="stat-value">{{ money(sales.totals.grossSales) }}</div></div>
        <div class="stat-card"><div class="stat-label">Returns</div><div class="stat-value">{{ money(sales.totals.returned) }}</div></div>
        <div class="stat-card"><div class="stat-label">Net Sales</div><div class="stat-value">{{ money(sales.totals.netSales) }}</div></div>
        <div class="stat-card"><div class="stat-label">Collected</div><div class="stat-value">{{ money(sales.totals.paid) }}</div></div>
        <div class="stat-card"><div class="stat-label">Outstanding Due</div><div class="stat-value">{{ money(sales.totals.due) }}</div></div>
      </div>
      <div class="report-grid-two">
        <div class="card"><h3>Day by Day <span class="bn-hint">— দিনের হিসাব</span></h3><div class="table-scroll"><table><thead><tr><SortableHeader table-id="report-sales-day" column="label" type="date">Date</SortableHeader><SortableHeader table-id="report-sales-day" column="invoices" type="number" class="num">Invoices</SortableHeader><SortableHeader table-id="report-sales-day" column="gross" type="number" class="num">Gross</SortableHeader><SortableHeader table-id="report-sales-day" column="returned" type="number" class="num">Returns</SortableHeader><SortableHeader table-id="report-sales-day" column="net" type="number" class="num">Net</SortableHeader></tr></thead><tbody><tr v-for="r in $sortRows('report-sales-day', sales.byDay)" :key="r.label"><td>{{ r.label }}</td><td class="num">{{ r.invoices }}</td><td class="num">{{ money(r.gross) }}</td><td class="num">{{ money(r.returned) }}</td><td class="num">{{ money(r.net) }}</td></tr></tbody></table></div></div>
        <div class="card"><h3>By Payment Type <span class="bn-hint">— পেমেন্ট অনুযায়ী</span></h3><div class="table-scroll"><table><thead><tr><SortableHeader table-id="report-sales-payment" column="label">Payment Type</SortableHeader><SortableHeader table-id="report-sales-payment" column="invoices" type="number" class="num">Invoices</SortableHeader><SortableHeader table-id="report-sales-payment" column="gross" type="number" class="num">Gross</SortableHeader><SortableHeader table-id="report-sales-payment" column="net" type="number" class="num">Net</SortableHeader></tr></thead><tbody><tr v-for="r in $sortRows('report-sales-payment', sales.byPaymentType)" :key="r.label"><td>{{ r.label }}</td><td class="num">{{ r.invoices }}</td><td class="num">{{ money(r.gross) }}</td><td class="num">{{ money(r.net) }}</td></tr></tbody></table></div></div>
      </div>
      <div class="card"><h3>Top Customers <span class="bn-hint">— বেশি কেনা কাস্টমার</span></h3><div class="table-scroll"><table><thead><tr><SortableHeader table-id="report-sales-customers" column="label">Customer</SortableHeader><SortableHeader table-id="report-sales-customers" column="invoices" type="number" class="num">Invoices</SortableHeader><SortableHeader table-id="report-sales-customers" column="net" type="number" class="num">Net</SortableHeader></tr></thead><tbody><tr v-for="r in $sortRows('report-sales-customers', sales.topCustomers)" :key="r.label"><td>{{ r.label }}</td><td class="num">{{ r.invoices }}</td><td class="num">{{ money(r.net) }}</td></tr></tbody></table></div></div>
    </template>

    <template v-if="activeTab==='purchase' && purchase">
      <div class="stat-grid report-stats">
        <div class="stat-card"><div class="stat-label">Purchases</div><div class="stat-value">{{ purchase.totals.purchases }}</div></div>
        <div class="stat-card"><div class="stat-label">Gross Purchases</div><div class="stat-value">{{ money(purchase.totals.grossPurchases) }}</div></div>
        <div class="stat-card"><div class="stat-label">Returns</div><div class="stat-value">{{ money(purchase.totals.returned) }}</div></div>
        <div class="stat-card"><div class="stat-label">Net Purchases</div><div class="stat-value">{{ money(purchase.totals.netPurchases) }}</div></div>
        <div class="stat-card"><div class="stat-label">Paid</div><div class="stat-value">{{ money(purchase.totals.paid) }}</div></div>
        <div class="stat-card"><div class="stat-label">Outstanding Due</div><div class="stat-value">{{ money(purchase.totals.due) }}</div></div>
      </div>
      <div class="report-grid-two">
        <div class="card"><h3>Day by Day <span class="bn-hint">— দিনের হিসাব</span></h3><div class="table-scroll"><table><thead><tr><SortableHeader table-id="report-purchase-day" column="label" type="date">Date</SortableHeader><SortableHeader table-id="report-purchase-day" column="purchases" type="number" class="num">Purchases</SortableHeader><SortableHeader table-id="report-purchase-day" column="gross" type="number" class="num">Gross</SortableHeader><SortableHeader table-id="report-purchase-day" column="returned" type="number" class="num">Returns</SortableHeader><SortableHeader table-id="report-purchase-day" column="net" type="number" class="num">Net</SortableHeader></tr></thead><tbody><tr v-for="r in $sortRows('report-purchase-day', purchase.byDay)" :key="r.label"><td>{{ r.label }}</td><td class="num">{{ r.purchases }}</td><td class="num">{{ money(r.gross) }}</td><td class="num">{{ money(r.returned) }}</td><td class="num">{{ money(r.net) }}</td></tr></tbody></table></div></div>
        <div class="card"><h3>Top Suppliers <span class="bn-hint">— বেশি কেনা হয় যাদের থেকে</span></h3><div class="table-scroll"><table><thead><tr><SortableHeader table-id="report-purchase-suppliers" column="label">Supplier</SortableHeader><SortableHeader table-id="report-purchase-suppliers" column="purchases" type="number" class="num">Purchases</SortableHeader><SortableHeader table-id="report-purchase-suppliers" column="net" type="number" class="num">Net</SortableHeader><SortableHeader table-id="report-purchase-suppliers" column="due" type="number" class="num">Due</SortableHeader></tr></thead><tbody><tr v-for="r in $sortRows('report-purchase-suppliers', purchase.topSuppliers)" :key="r.label"><td>{{ r.label }}</td><td class="num">{{ r.purchases }}</td><td class="num">{{ money(r.net) }}</td><td class="num">{{ money(r.due) }}</td></tr></tbody></table></div></div>
      </div>
    </template>

    <template v-if="activeTab==='stock' && stock">
      <p class="report-note">Current snapshot. The date range does not apply to Stock & Valuation.</p>
      <div class="stat-grid report-stats">
        <div class="stat-card"><div class="stat-label">Active Products</div><div class="stat-value">{{ stock.totals.activeProducts }}</div></div>
        <div class="stat-card"><div class="stat-label">Inventory Value</div><div class="stat-value">{{ money(stock.totals.inventoryValue) }}</div></div>
        <div class="stat-card"><div class="stat-label">Retail Value</div><div class="stat-value">{{ money(stock.totals.retailValue) }}</div></div>
        <div class="stat-card"><div class="stat-label">Potential Margin</div><div class="stat-value">{{ money(stock.totals.potentialMargin) }}</div></div>
        <div class="stat-card"><div class="stat-label">Low Stock</div><div class="stat-value">{{ stock.totals.lowStockCount }}</div></div>
        <div class="stat-card"><div class="stat-label">Out of Stock</div><div class="stat-value">{{ stock.totals.outOfStockCount }}</div></div>
      </div>
      <div v-if="stock.totals.mismatchCount" class="card report-warning"><h3>Stock / lot ledger mismatch <span class="bn-hint">— মালের হিসাব মিলছে না</span></h3><div class="table-scroll"><table><thead><tr><SortableHeader table-id="report-stock-mismatch" column="name">Product</SortableHeader><SortableHeader table-id="report-stock-mismatch" column="stock" type="number" class="num">Current Stock</SortableHeader><SortableHeader table-id="report-stock-mismatch" column="lotQuantity" type="number" class="num">Lot Total</SortableHeader><SortableHeader table-id="report-stock-mismatch" column="@diff:stock,lotQuantity" type="number" class="num">Difference</SortableHeader></tr></thead><tbody><tr v-for="p in $sortRows('report-stock-mismatch', stock.products.filter(x=>x.lotMismatch))" :key="p.productId"><td>{{ p.name }}</td><td class="num">{{ qty(p.stock) }}</td><td class="num">{{ qty(p.lotQuantity) }}</td><td class="num">{{ qty(p.stock-p.lotQuantity) }}</td></tr></tbody></table></div></div>
      <div class="report-grid-two"><div class="card"><h3>By Category</h3><div class="table-scroll"><table><thead><tr><SortableHeader table-id="report-stock-category" column="label">Category</SortableHeader><SortableHeader table-id="report-stock-category" column="products" type="number" class="num">Products</SortableHeader><SortableHeader table-id="report-stock-category" column="stock" type="number" class="num">Units</SortableHeader><SortableHeader table-id="report-stock-category" column="value" type="number" class="num">Value</SortableHeader></tr></thead><tbody><tr v-for="r in $sortRows('report-stock-category', stock.byCategory)" :key="r.label"><td>{{ r.label }}</td><td class="num">{{ r.products }}</td><td class="num">{{ qty(r.stock) }}</td><td class="num">{{ money(r.value) }}</td></tr></tbody></table></div></div>
      <div class="card"><h3>Products by Value</h3><div class="table-scroll"><table><thead><tr><SortableHeader table-id="report-stock-products" column="name">Product</SortableHeader><SortableHeader table-id="report-stock-products" column="category">Category</SortableHeader><SortableHeader table-id="report-stock-products" column="stock" type="number" class="num">Stock</SortableHeader><SortableHeader table-id="report-stock-products" column="minStock" type="number" class="num">Min</SortableHeader><SortableHeader table-id="report-stock-products" column="lotValue" type="number" class="num">Value</SortableHeader><SortableHeader table-id="report-stock-products" column="status">Status</SortableHeader></tr></thead><tbody><tr v-for="p in $sortRows('report-stock-products', stock.products)" :key="p.productId"><td>{{ p.name }}</td><td>{{ p.category }}</td><td class="num">{{ qty(p.stock) }}</td><td class="num">{{ qty(p.minStock) }}</td><td class="num">{{ money(p.lotValue) }}</td><td><span class="badge" :class="p.status==='Inactive'?'badge-danger':p.stock<=0?'badge-danger':p.stock<=p.minStock?'badge-warning':'badge-success'">{{ p.status==='Inactive'?'Inactive':p.stock<=0?'Out':p.stock<=p.minStock?'Low':'OK' }}</span></td></tr></tbody></table></div></div></div>
    </template>

    <template v-if="activeTab==='cashbank' && cashbank">
      <div class="stat-grid report-stats">
        <div class="stat-card"><div class="stat-label">Cash Opening</div><div class="stat-value">{{ money(cashbank.cash.opening) }}</div></div>
        <div class="stat-card"><div class="stat-label">Cash In</div><div class="stat-value">{{ money(cashbank.cash.inflow) }}</div></div>
        <div class="stat-card"><div class="stat-label">Cash Out</div><div class="stat-value">{{ money(cashbank.cash.outflow) }}</div></div>
        <div class="stat-card"><div class="stat-label">Cash Closing</div><div class="stat-value">{{ money(cashbank.cash.closing) }}</div></div>
        <div class="stat-card"><div class="stat-label">Combined Opening</div><div class="stat-value">{{ money(cashbank.combined.opening) }}</div></div>
        <div class="stat-card"><div class="stat-label">Combined Closing</div><div class="stat-value">{{ money(cashbank.combined.closing) }}</div></div>
      </div>
      <div class="report-grid-two"><div class="card"><h3>Cash Movement by Type</h3><div class="table-scroll"><table><thead><tr><SortableHeader table-id="report-cash-type" column="label">Type</SortableHeader><SortableHeader table-id="report-cash-type" column="entries" type="number" class="num">Entries</SortableHeader><SortableHeader table-id="report-cash-type" column="inflow" type="number" class="num">In</SortableHeader><SortableHeader table-id="report-cash-type" column="outflow" type="number" class="num">Out</SortableHeader><SortableHeader table-id="report-cash-type" column="net" type="number" class="num">Net</SortableHeader></tr></thead><tbody><tr v-for="r in $sortRows('report-cash-type', cashbank.cash.byType)" :key="r.label"><td>{{ r.label }}</td><td class="num">{{ r.entries }}</td><td class="num">{{ money(r.inflow) }}</td><td class="num">{{ money(r.outflow) }}</td><td class="num">{{ money(r.net) }}</td></tr></tbody></table></div></div>
      <div class="card"><h3>Bank Accounts</h3><div class="table-scroll"><table><thead><tr><SortableHeader table-id="report-bank-accounts" column="name">Account</SortableHeader><SortableHeader table-id="report-bank-accounts" column="bankName">Bank</SortableHeader><SortableHeader table-id="report-bank-accounts" column="opening" type="number" class="num">Opening</SortableHeader><SortableHeader table-id="report-bank-accounts" column="inflow" type="number" class="num">In</SortableHeader><SortableHeader table-id="report-bank-accounts" column="outflow" type="number" class="num">Out</SortableHeader><SortableHeader table-id="report-bank-accounts" column="closing" type="number" class="num">Closing</SortableHeader></tr></thead><tbody><tr v-for="b in $sortRows('report-bank-accounts', cashbank.banks)" :key="b.id"><td>{{ b.name }}</td><td>{{ b.bankName }}</td><td class="num">{{ money(b.opening) }}</td><td class="num">{{ money(b.inflow) }}</td><td class="num">{{ money(b.outflow) }}</td><td class="num">{{ money(b.closing) }}</td></tr></tbody></table></div></div></div>
    </template>

    <template v-if="activeTab==='profit' && profit">
      <div v-if="profit.coverage.invoicesMissingLotData>0" class="card report-warning"><h3>Profit is overstated for this range <span class="bn-hint">— লাভ পুরোপুরি সঠিক নয়</span></h3><p>{{ profit.coverage.invoicesMissingLotData }} of {{ profit.coverage.invoicesInRange }} invoices have incomplete lot-cost coverage.</p></div>
      <div class="stat-grid report-stats">
        <div class="stat-card"><div class="stat-label">Net Revenue</div><div class="stat-value">{{ money(profit.totals.netRevenue) }}</div></div>
        <div class="stat-card"><div class="stat-label">Cost of Goods Sold</div><div class="stat-value">{{ money(profit.totals.cogs) }}</div></div>
        <div class="stat-card"><div class="stat-label">Gross Profit</div><div class="stat-value">{{ money(profit.totals.grossProfit) }}</div></div>
        <div class="stat-card"><div class="stat-label">Gross Margin</div><div class="stat-value">{{ pct(profit.totals.grossMarginPercent) }}</div></div>
        <div class="stat-card"><div class="stat-label">Expenses</div><div class="stat-value">{{ money(profit.totals.expenses) }}</div></div>
        <div class="stat-card"><div class="stat-label">Net Profit</div><div class="stat-value">{{ money(profit.totals.netProfit) }}</div></div>
      </div>
      <div class="report-grid-two"><div class="card"><h3>Most Profitable Products</h3><div class="table-scroll"><table><thead><tr><SortableHeader table-id="report-profit-products" column="label">Product</SortableHeader><SortableHeader table-id="report-profit-products" column="qtySold" type="number" class="num">Sold</SortableHeader><SortableHeader table-id="report-profit-products" column="qtyReturned" type="number" class="num">Returned</SortableHeader><SortableHeader table-id="report-profit-products" column="revenue" type="number" class="num">Revenue</SortableHeader><SortableHeader table-id="report-profit-products" column="cost" type="number" class="num">Cost</SortableHeader><SortableHeader table-id="report-profit-products" column="profit" type="number" class="num">Profit</SortableHeader></tr></thead><tbody><tr v-for="p in $sortRows('report-profit-products', profit.topProducts)" :key="p.productId"><td>{{ p.label }}</td><td class="num">{{ qty(p.qtySold) }}</td><td class="num">{{ qty(p.qtyReturned) }}</td><td class="num">{{ money(p.revenue) }}</td><td class="num">{{ money(p.cost) }}</td><td class="num">{{ money(p.profit) }}</td></tr></tbody></table></div></div>
      <div class="card"><h3>Expenses by Category</h3><div class="table-scroll"><table><thead><tr><SortableHeader table-id="report-profit-expenses" column="label">Category</SortableHeader><SortableHeader table-id="report-profit-expenses" column="entries" type="number" class="num">Entries</SortableHeader><SortableHeader table-id="report-profit-expenses" column="amount" type="number" class="num">Amount</SortableHeader></tr></thead><tbody><tr v-for="e in $sortRows('report-profit-expenses', profit.expenseByCategory)" :key="e.label"><td>{{ e.label }}</td><td class="num">{{ e.entries }}</td><td class="num">{{ money(e.amount) }}</td></tr></tbody></table></div></div></div>
      <div v-if="profit.lossMakers.length" class="card report-loss"><h3>Sold at a Loss <span class="bn-hint">— লোকসানে বিক্রি হয়েছে</span></h3><div class="table-scroll"><table><thead><tr><SortableHeader table-id="report-loss-makers" column="label">Product</SortableHeader><SortableHeader table-id="report-loss-makers" column="qtySold" type="number" class="num">Sold</SortableHeader><SortableHeader table-id="report-loss-makers" column="revenue" type="number" class="num">Revenue</SortableHeader><SortableHeader table-id="report-loss-makers" column="cost" type="number" class="num">Cost</SortableHeader><SortableHeader table-id="report-loss-makers" column="@abs:profit" type="number" class="num">Loss</SortableHeader></tr></thead><tbody><tr v-for="p in $sortRows('report-loss-makers', profit.lossMakers)" :key="p.productId"><td>{{ p.label }}</td><td class="num">{{ qty(p.qtySold) }}</td><td class="num">{{ money(p.revenue) }}</td><td class="num">{{ money(p.cost) }}</td><td class="num dangerText">{{ money(Math.abs(p.profit)) }}</td></tr></tbody></table></div></div>
    </template>

    <template v-if="activeTab==='balancesheet' && balanceSheet">
      <p class="report-note">Snapshot as of <strong>{{ balanceSheet.asOf }}</strong>. Date range does not apply to this tab.</p>
      <div class="balance-grid">
        <div class="card"><h3>Assets <span class="bn-hint">— সম্পদ</span></h3><div class="totals-row"><span>Cash</span><strong>{{ money(balanceSheet.assets.cash) }}</strong></div><div class="totals-row"><span>Bank</span><strong>{{ money(balanceSheet.assets.bank) }}</strong></div><div class="totals-row"><span>Mobile Banking</span><strong>{{ money(balanceSheet.assets.mobileBanking) }}</strong></div><div class="totals-row"><span>Inventory</span><strong>{{ money(balanceSheet.assets.inventory) }}</strong></div><div class="totals-row grand"><span>Total Assets</span><strong>{{ money(balanceSheet.assets.total) }}</strong></div></div>
        <div class="card"><h3>Liabilities <span class="bn-hint">— দেনা</span></h3><div class="totals-row"><span>Outstanding Loan</span><strong>{{ money(balanceSheet.liabilities.outstandingLoan) }}</strong></div><div class="totals-row grand"><span>Total Liabilities</span><strong>{{ money(balanceSheet.liabilities.total) }}</strong></div></div>
        <div class="card"><h3>Owner Equity <span class="bn-hint">— মালিকের মূলধন</span></h3><div class="totals-row"><span>Owner Capital</span><strong>{{ money(balanceSheet.equity.ownerCapital) }}</strong></div><div class="totals-row grand"><span>Total Owner Equity</span><strong>{{ money(balanceSheet.equity.total) }}</strong></div></div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.report-toolbar{margin-bottom:6px}.report-toolbar label{font-size:12px;color:var(--color-text-muted,#64748b)}.report-toolbar input{width:auto;max-width:150px}.report-print-heading{display:none}.report-stats{margin:14px 0 16px}.report-stats .stat-card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:14px 16px}.report-stats .stat-label{font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase}.report-stats .stat-value{font-size:20px;font-weight:800;margin-top:5px}.report-grid-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:14px}.card{margin-bottom:14px}.card h3{font-size:14px;margin:0 0 10px}.report-note{font-size:12px;color:#64748b;margin:8px 0 12px}.report-warning{border-left:3px solid #d97706}.report-loss{border-left:3px solid #dc2626}.balance-grid{display:grid;grid-template-columns:2fr 1fr 1fr;gap:14px}.totals-row{display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-bottom:1px solid #eef2f7}.totals-row.grand{font-size:16px;border-top:2px solid #dbe3ef;border-bottom:0;margin-top:6px;padding-top:12px}.num{text-align:right}.dangerText{color:#dc2626}
@media(max-width:900px){.report-grid-two,.balance-grid{grid-template-columns:1fr}.report-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:640px){.report-toolbar{display:grid;grid-template-columns:auto 1fr auto 1fr;gap:8px;align-items:center}.report-toolbar input{width:100%;max-width:none}.report-toolbar .btn{width:100%}.report-toolbar .toolbar-spacer{display:none}.report-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.report-stats .stat-card{padding:11px 12px}.report-stats .stat-value{font-size:17px}}
</style>
<style>
@media print{
  body.printing-reports .sidebar,body.printing-reports .topbar,body.printing-reports .sidebar-scrim,body.printing-reports .reports-page>.toolbar,body.printing-reports .reports-page>.module-tabs{display:none!important}
  body.printing-reports .main{margin:0!important}.reports-page .report-print-heading{display:block!important}.reports-page .card{break-inside:avoid;box-shadow:none!important}.reports-page .table-scroll{overflow:visible!important}
}
</style>
