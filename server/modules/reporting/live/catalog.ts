import type { LiveReportKey, ReportStatus } from './types.js';

export type CatalogReport = { id: LiveReportKey; en: string; bn: string; group: string; status: ReportStatus; reason: string };
export const liveReportCatalog: CatalogReport[] = [
 {id:'sales',en:'Sales register',bn:'বিক্রির হিসাব',group:'sales',status:'needs-review',reason:'Recorded invoice totals; returns and FIFO profit are not yet reconciled.'},
 {id:'purchase',en:'Purchases',bn:'ক্রয় হিসাব',group:'purchase',status:'unavailable',reason:'Purchase posting reconciliation depends on Phase 4 acceptance.'},
 {id:'stock',en:'Stock',bn:'স্টক',group:'stock',status:'unavailable',reason:'Full lot and master-stock reconciliation is pending.'},
 {id:'receivables',en:'Customer dues',bn:'গ্রাহকের বাকি',group:'people',status:'unavailable',reason:'Ledger-level aging validation is pending.'},
 {id:'payables',en:'Supplier dues',bn:'সরবরাহকারীর দেনা',group:'people',status:'unavailable',reason:'Phase 4 supplier settlement acceptance is pending.'},
 {id:'profit',en:'Profit',bn:'লাভ',group:'sales',status:'unavailable',reason:'FIFO reversals and Store Credit reconciliation are pending.'},
 {id:'cash',en:'Cash & bank',bn:'ক্যাশ ও ব্যাংক',group:'money',status:'unavailable',reason:'Cash/bank transfer reconciliation is pending.'},
 {id:'expenses',en:'Expenses',bn:'খরচ',group:'money',status:'unavailable',reason:'Expense reconciliation is pending.'},
 {id:'audit',en:'Business audit',bn:'ব্যবসা পর্যালোচনা',group:'controls',status:'unavailable',reason:'Business Audit remains in development.'}
];
