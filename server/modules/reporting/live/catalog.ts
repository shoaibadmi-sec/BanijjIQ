import type { LiveReportKey, ReportStatus } from './types.js';

export type CatalogReport = { id: LiveReportKey; en: string; bn: string; group: string; status: ReportStatus; reason: string };
export const liveReportCatalog: CatalogReport[] = [
 {id:'sales',en:'Sales register',bn:'বিক্রির হিসাব',group:'sales',status:'needs-review',reason:'Recorded invoice totals; returns and FIFO profit are not yet reconciled.'},
 {id:'purchase',en:'Purchases',bn:'ক্রয় হিসাব',group:'purchase',status:'unavailable',reason:'Purchase posting reconciliation depends on Phase 4 acceptance.'},
 {id:'stock',en:'Stock',bn:'স্টক',group:'stock',status:'needs-review',reason:'Current FIFO lot valuation, not historical stock; mismatches withhold unsafe totals.'},
 {id:'receivables',en:'Customer dues',bn:'গ্রাহকের বাকি',group:'people',status:'needs-review',reason:'Current due balances reconciled per customer ID; invoice aging unavailable.'},
 {id:'payables',en:'Supplier dues',bn:'সরবরাহকারীর দেনা',group:'people',status:'needs-review',reason:'Current supplier ledger balance by supplier ID; invoice aging unavailable.'},
 {id:'profit',en:'Invoice-cohort profitability',bn:'বিক্রয় চালানভিত্তিক লাভ',group:'sales',status:'needs-review',reason:'Invoice-date cohort profitability only, not a full general-ledger Profit & Loss statement.'},
 {id:'product-profit',en:'Product gross profit',bn:'পণ্যভিত্তিক মোট লাভ',group:'sales',status:'unavailable',reason:'Product-level FIFO allocations, line discounts and return costs are not yet reconciled; invoice-cohort totals cannot certify individual product margins.'},
 {id:'profit-loss',en:'Profit & Loss statement',bn:'লাভ-ক্ষতির বিবরণী',group:'money',status:'unavailable',reason:'Full ledger balances and posted adjustments are required for a Profit & Loss statement. Invoice-cohort profitability is not a substitute.'},
 {id:'cash',en:'Cash & bank',bn:'ক্যাশ ও ব্যাংক',group:'money',status:'needs-review',reason:'Posted cash/bank movements, internal transfers and current ledger balances, subject to reconciliation.'},
 {id:'bank',en:'Bank book',bn:'ব্যাংক খাতা',group:'money',status:'needs-review',reason:'Recorded bank movements; current balance is not historical.'},
 {id:'finance',en:'Finance movements',bn:'আর্থিক লেনদেন',group:'money',status:'needs-review',reason:'Owner capital and loans are not sales revenue or profit.'},
 {id:'expenses',en:'Expenses',bn:'খরচ',group:'money',status:'needs-review',reason:'Operating expenses are reconciled to money-book postings where available.'},
 {id:'audit',en:'Business audit',bn:'ব্যবসা পর্যালোচনা',group:'controls',status:'unavailable',reason:'Business Audit remains in development.'}
];
