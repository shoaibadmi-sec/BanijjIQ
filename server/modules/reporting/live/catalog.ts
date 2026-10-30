import type { LiveReportKey, ReportStatus } from './types.js';

export type CatalogReport = { id: LiveReportKey; en: string; bn: string; group: string; status: ReportStatus; reason: string };
export const liveReportCatalog: CatalogReport[] = [
 {id:'sales',en:'Sales register',bn:'বিক্রির হিসাব',group:'sales',status:'needs-review',reason:'Recorded invoice totals; returns and FIFO profit are not yet reconciled.'},
 {id:'purchase',en:'Purchases',bn:'ক্রয় হিসাব',group:'purchase',status:'unavailable',reason:'Purchase posting reconciliation depends on Phase 4 acceptance.'},
 {id:'stock',en:'Stock',bn:'স্টক',group:'stock',status:'needs-review',reason:'Current FIFO lot valuation, not historical stock; mismatches withhold unsafe totals.'},
 {id:'receivables',en:'Customer dues',bn:'গ্রাহকের বাকি',group:'people',status:'needs-review',reason:'Current due balances reconciled per customer ID; invoice aging unavailable.'},
 {id:'payables',en:'Supplier dues',bn:'সরবরাহকারীর দেনা',group:'people',status:'needs-review',reason:'Current supplier ledger balance by supplier ID; invoice aging unavailable.'},
 {id:'profit',en:'Profit',bn:'লাভ',group:'sales',status:'needs-review',reason:'Profit appears only when original FIFO allocation and return reversal evidence are complete.'},
 {id:'cash',en:'Cash & bank',bn:'ক্যাশ ও ব্যাংক',group:'money',status:'unavailable',reason:'Cash/bank transfer reconciliation is pending.'},
 {id:'expenses',en:'Expenses',bn:'খরচ',group:'money',status:'unavailable',reason:'Expense reconciliation is pending.'},
 {id:'audit',en:'Business audit',bn:'ব্যবসা পর্যালোচনা',group:'controls',status:'unavailable',reason:'Business Audit remains in development.'}
];
