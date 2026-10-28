export type DayBookDeleteAction = '' | 'sale' | 'purchase' | 'expense' | 'customer-payment' | 'supplier-payment' | 'bank-reverse';

export type DayBookRowOut = {
  ts: string; date: string; time: string; referenceNo: string; module: string; transactionType: string;
  party: string; description: string; paymentMethod: string; cashIn: number; cashOut: number;
  bankIn: number; bankOut: number; amount: number; runningCashBalance: number | null;
  createdBy: string; status: string; isDeleted: boolean; deletedBy: string; deleteReason: string;
  isBackdated: boolean; backdatedDays: number; backdatedReason: string; sourceModule: string;
  sourceId: string; openId: string; deleteAction: DayBookDeleteAction; deleteId: string; canEdit: boolean;
};

export type DashboardProfitResult = {
  totals: { netProfit:number; grossProfit:number; cogs:number; expenses:number; grossMarginPercent:number };
  coverage: { invoicesInRange:number; invoicesMissingLotData:number };
  byProduct: Array<{ name:string; qtySold:number; revenue:number; profit:number }>;
  expenseByCategory: Array<{ label:string; entries:number; amount:number }>;
};

export type ReportRange = { from: string; to: string };
