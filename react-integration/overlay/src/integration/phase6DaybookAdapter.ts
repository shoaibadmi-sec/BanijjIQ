import type {UnifiedTransaction,TransactionSource,TransactionStatus} from '../types/transactions';
import type {LiveDaybookEntry} from './banijjApi';

/** The Daybook is a sourced, read-only journal. Never fabricate postings from UI fixtures. */
const sourceTypes:Record<string,TransactionSource>={
 'Sales':'sale','Sales Return':'sale-return',
 'Purchase':'purchase','Purchase Return':'purchase-return',
 'Supplier Payment':'supplier-payment','Supplier Warranty':'purchase',
 'Customer Payment':'customer-payment','Expense':'expense',
 'Finance':'finance','Bank':'finance','Bank Transfer':'transfer',
 'Stock Adjustment':'stock-adjustment'
};
const sourceRoutes:Record<TransactionSource,string>={
 'sale':'sales','sale-return':'sales','purchase':'purchases',
 'purchase-return':'purchases','supplier-payment':'purchases',
 'customer-payment':'parties','expense':'expenses','finance':'finance',
 'transfer':'finance','cheque':'finance','receipt-voucher':'finance',
 'payment-voucher':'finance','adjustment':'daybook','opening':'finance',
 'stock-adjustment':'products'
};
const postedStatus=(status:string):TransactionStatus=>
 status==='Posted'||status==='Deleted'||status==='Reversed'||status==='Draft'
  ? status : 'Draft';

export function toUnifiedDaybookRow(row:LiveDaybookEntry):UnifiedTransaction {
 const source=sourceTypes[row.sourceModule]??'adjustment';
 const status=postedStatus(row.status);
 const transactionDate=row.date;
 const createdAt=row.ts || transactionDate+'T'+(row.time||'00:00')+':00';
 const incoming=row.cashIn+row.bankIn;
 const outgoing=row.cashOut+row.bankOut;
 const internal=source==='transfer'||source==='opening';
 const reference=row.referenceNo||row.sourceId;
 return {
  id:row.sourceModule+':'+row.sourceId+':'+row.ts,
  source,sourceId:row.sourceId,reference,
  type:row.transactionType||row.module||row.sourceModule,
  party:row.party||undefined,details:row.description,
  amount:row.amount,moneyIn:incoming,moneyOut:outgoing,
  accounts:row.paymentMethod?[row.paymentMethod]:[],
  transactionDate,createdAt,postedBy:row.createdBy||'—',
  status,countsTowardCashflow:!internal&&status==='Posted',
  sourceRoute:'/app/'+sourceRoutes[source]+'?sourceId='+encodeURIComponent(row.openId||row.sourceId),
  ...(row.deletedBy?{deletedBy:row.deletedBy,deleteReason:row.deleteReason}:{}),
  ...(row.paymentMethod?{paymentBreakdown:[{label:row.paymentMethod,amount:row.amount}]}:{})
 };
}
