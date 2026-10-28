
export type LedgerRecordLimit = 50 | 100 | 200;

export interface LedgerHistoryMeta {
  from: string;
  to: string;
  limit: LedgerRecordLimit;
  matchingCount: number;
  returnedCount: number;
  hasMore: boolean;
}

export interface LedgerPrintHeader {
  shopName: string;
  shopNameBangla: string;
  address: string;
  phone1: string;
  phone2: string;
  email: string;
  logoDataUri: string;
}

export interface LedgerBalanceSummary {
  rangeOpeningBalance: number;
  rangeClosingBalance: number;
  displayedOpeningBalance: number;
  displayedClosingBalance: number;
  totalDebit: number;
  totalCredit: number;
}

export type WarrantyPeriodUnit = 'Days' | 'Months' | 'Years';
export interface ExpiryBatchInput { quantity?: number; expiryDate?: string; batchNo?: string; serialNumbers?: string[] }
export interface LotTrackingInput { serialNumbers?: string[]; expiryBatches?: ExpiryBatchInput[] }

export type ProductStatus = 'Active' | 'Inactive';

export interface LookupItem {
  id: string;
  name: string;
  symbol?: string;
}

export interface Product {
  productId: string;
  productName: string;
  displayName?: string;
  brand: string;
  category: string;
  unit: string;
  barcode: string;
  purchasePrice?: number;
  sellingPrice: number;
  currentStock: number;
  minimumStock: number;
  stockValue: number;
  status: ProductStatus;
  preferredSupplierId?: string;
  preferredSupplierName?: string;
  createdAt?: string;
  updatedAt?: string;
  trackSerial: boolean;
  trackExpiry: boolean;
  trackWarranty: boolean;
  warrantyPeriodValue: number;
  warrantyPeriodUnit: WarrantyPeriodUnit;
  sellableStock?: number;
  pendingTracking?: number;
  expiredStock?: number;
}

export interface ProductForm {
  productId?: string;
  productName: string;
  brand: string;
  category: string;
  unit: string;
  barcode: string;
  purchasePrice: number;
  sellingPrice: number;
  currentStock: number;
  minimumStock: number;
  preferredSupplierId?: string;
  status: ProductStatus;
  trackSerial: boolean;
  trackExpiry: boolean;
  trackWarranty: boolean;
  warrantyPeriodValue: number;
  warrantyPeriodUnit: WarrantyPeriodUnit;
  openingTracking?: LotTrackingInput;
  stockTracking?: LotTrackingInput;
}

export interface StockMovement {
  movementId: string;
  movementType: string;
  quantityIn: number;
  quantityOut: number;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
}

export interface StockLot {
  lotId: string;
  purchaseId: string | null;
  supplierName: string | null;
  purchaseDate: string;
  purchasePrice: number;
  originalQuantity: number;
  remainingQuantity: number;
}


export type DeleteWindowCode = 'disabled' | 'same' | '1' | '3' | '7' | '15' | '30' | 'unlimited';

export interface ModulePermission {
  view: boolean;
  add: boolean;
  edit: boolean;
  delete: DeleteWindowCode | boolean;
  backdate?: DeleteWindowCode;
}

export type RolePermissions = Record<string, ModulePermission>;

export interface AuthUser {
  userId: string;
  fullName: string;
  phone: string;
  role: 'admin' | string;
  status: ProductStatus;
  allowedModules?: string[] | null;
  permissions?: RolePermissions | null;
}

export interface PurchaseLineInput {
  productId: string;
  name?: string;
  qty: number;
  unitPrice: number;
  sellingPrice?: number | null;
  tracking?: LotTrackingInput;
}

export interface PurchaseForm {
  supplierId: string;
  purchasePlanOrderId?: string;
  quickSupplierName?: string;
  date: string;
  backdatedReason?: string;
  discount: number;
  paidAmount: number;
  notes: string;
  paymentMethod: string;
  bankAccountId?: string;
  items: PurchaseLineInput[];
}

export interface PurchaseItem {
  productId: string;
  productName: string;
  quantity: number;
  purchasePrice: number;
  unitPrice?: number;
  lineTotal: number;
}

export interface Purchase {
  purchaseId: string;
  purchaseDate: string;
  supplierId: string;
  supplierName: string;
  subtotal: number;
  discount: number;
  grandTotal: number;
  paidAmount: number;
  dueAmount: number;
  paymentStatus: string;
  returnedAmount: number;
  paymentMethod: string;
  note: string;
  status: string;
  createdAt: string;
  items: PurchaseItem[];
  bankAccountId?: string;
  bankAccountName?: string;
  editable?: boolean;
  purchasePlanOrderId?: string;
}

export type PurchasePlannerPriority = 'Critical' | 'High' | 'Medium' | 'Low';
export type PurchasePlannerScope = 'ALL' | 'SUPPLIER';

export interface PurchasePlannerRow {
  productId: string;
  productName: string;
  displayName?: string;
  brand?: string;
  category: string;
  unit: string;
  barcode?: string;
  currentStock: number;
  reorderLevel: number;
  recentSalesQty: number;
  salesVelocity: number;
  stockCoverDays: number | null;
  pendingOrderQty: number;
  lastPurchaseCost: number;
  sellingPrice: number;
  preferredSupplierId: string;
  preferredSupplierName: string;
  lastSupplierId: string;
  lastSupplierName: string;
  supplierId: string;
  supplierName: string;
  priority: PurchasePlannerPriority;
  suggestedQty: number;
  plannedQty: number;
  plannedInvestment: number;
  expectedSalesValue: number;
  expectedGrossProfit: number;
  marginPercent: number;
  isNewProduct: boolean;
  included: boolean;
}

export interface PurchasePlannerTotals {
  totalInvestment: number;
  expectedSalesValue: number;
  expectedGrossProfit: number;
  marginPercent: number;
  criticalCount: number;
  highCount: number;
}

export interface PurchasePlanSummary {
  planId: string;
  planNo: string;
  planDate: string;
  scope: PurchasePlannerScope;
  scopeSupplierId: string;
  salesWindowDays: number;
  targetCoverDays: number;
  budgetAmount: number;
  status: string;
  totalInvestment: number;
  expectedSalesValue: number;
  expectedGrossProfit: number;
  marginPercent: number;
  notes: string;
  createdAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  rejectionReason?: string;
  itemCount: number;
  totalQty: number;
}

export interface PurchasePlanOrderSummary {
  orderId: string;
  orderNo: string;
  planId: string;
  supplierId: string;
  supplierName: string;
  orderDate: string;
  status: string;
  convertedPurchaseId?: string;
  createdAt?: string;
  itemCount: number;
  totalQty: number;
}

export interface SupplierPurchaseOrder {
  orderId: string;
  orderNo: string;
  planId: string;
  supplierId: string;
  supplierName: string;
  orderDate: string;
  status: string;
  convertedPurchaseId?: string;
  items: Array<{ productId: string; productName: string; quantity: number }>;
  shop: {
    shopName: string;
    shopNameBangla: string;
    description: string;
    address: string;
    phone1: string;
    phone2: string;
    email: string;
    logo: string;
  };
}

export interface PurchaseReturnDataItem {
  productId: string;
  productName: string;
  unitPrice: number;
  boughtQty: number;
  previouslyReturnedQty: number;
  availableQty: number;
  returnQty?: number;
  trackSerial?: boolean;
  trackExpiry?: boolean;
  trackWarranty?: boolean;
  availableSerials?: string[];
  serialNumbers?: string[];
}

export interface PurchaseReturnData {
  purchaseId: string;
  purchaseDate: string;
  supplierId: string;
  supplierName: string;
  grandTotal: number;
  paidAmount: number;
  dueAmount: number;
  previouslyReturnedAmount: number;
  netPurchase: number;
  items: PurchaseReturnDataItem[];
}

export interface PurchaseReturnRecord {
  returnId: string;
  returnDate: string;
  purchaseId: string;
  supplierName: string;
  totalReturnAmount: number;
  refundMethod: string;
  reason: string;
  notes: string;
  createdAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  openingBalance?: number;
  currentDue?: number;
  notes?: string;
  status?: ProductStatus;
  createdAt?: string;
}

export interface SupplierLedgerRow {
  ledgerId: string;
  date: string;
  supplierId: string;
  supplierName: string;
  type: string;
  reference: string;
  debit: number;
  credit: number;
  balance: number;
  notes: string;
  paymentMethod: string;
  bankAccountId?: string;
  createdAt?: string;
}

export interface SupplierDetail {
  supplier: Supplier;
  ledger: SupplierLedgerRow[];
  history: LedgerHistoryMeta;
  summary: LedgerBalanceSummary;
  printHeader: LedgerPrintHeader;
}

export interface SupplierForm {
  name: string;
  phone: string;
  address: string;
  openingBalance: number;
  notes: string;
}

export interface SupplierPaymentForm {
  amount: number;
  method: string;
  bankAccountId?: string;
  notes: string;
  date: string;
  backdatedReason?: string;
}

export interface BankAccount {
  id: string;
  name: string;
  accountType?: string;
}

export interface PosProduct {
  unitSymbol?: string;
  id: string;
  name: string;
  productName: string;
  brand: string;
  category: string;
  unit: string;
  barcode: string;
  purchasePrice: number;
  sellingPrice: number;
  stock: number;
  minimumStock: number;
  totalStock?: number;
  pendingTracking?: number;
  expiredStock?: number;
  trackSerial: boolean;
  trackExpiry: boolean;
  trackWarranty: boolean;
  warrantyPeriodValue: number;
  warrantyPeriodUnit: WarrantyPeriodUnit;
}

export interface PosCustomer {
  id: string;
  name: string;
  phone: string;
  fatherName: string;
  address: string;
  currentDue: number;
}

export interface PosVendor {
  id: string;
  name: string;
  phone: string;
  currentDue: number;
  status: string;
}

export interface CashSessionSummary {
  sessionId: string;
  openedAt: string;
  openingCash: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
}

export interface PosCartLine {
  unitSymbol?: string;
  purchasePrice?: number;
  unit?: string;
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  stock: number;
  vendorId?: string;
  vendorUnitCost?: number | null;
  fulfillmentMode?: 'own' | 'vendor' | 'negative';
  trackSerial?: boolean;
  trackExpiry?: boolean;
  trackWarranty?: boolean;
  serialNumbers?: string[];
}

export interface PosInvoiceItem {
  productId: string;
  productName: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  lineTotal: number;
}

export interface PosInvoice {
  invoiceId: string;
  date: string;
  customerName: string;
  customerPhone: string;
  customerFatherName?: string;
  customerAddress?: string;
  subtotal: number;
  discount: number;
  grandTotal: number;
  paidAmount: number;
  dueAmount: number;
  paymentStatus: string;
  paymentMethod: string;
  items: PosInvoiceItem[];
}

export interface SalesListRow {
  invoiceId: string;
  date: string;
  time: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  grandTotal: number;
  paidAmount: number;
  dueAmount: number;
  returnedAmount: number;
  netSale: number;
  paymentStatus: string;
  returnStatus: 'No Return' | 'Partially Returned' | 'Fully Returned' | string;
  editable: boolean;
}

export interface SaleDetailItem {
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface SaleDetail {
  invoiceId: string;
  date: string;
  time: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  subtotal: number;
  discount: number;
  grandTotal: number;
  paidAmount: number;
  dueAmount: number;
  returnedAmount: number;
  netSale: number;
  paymentStatus: string;
  paymentMethod: string;
  items: SaleDetailItem[];
}

export interface SaleUpdateData {
  invoiceId: string;
  date: string;
  time: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerFatherName?: string;
  discount: number;
  paidAmount: number;
  paymentMethod: string;
  bankAccountId: string;
  items: Array<{
    productId: string;
    name: string;
    qty: number;
    unitPrice: number;
    vendorId?: string;
    vendorName?: string;
    vendorUnitCost?: number;
    vendorQty?: number;
  }>;
}

export interface SaleReturnDataItem {
  productId: string;
  name: string;
  soldQty: number;
  vendorQty: number;
  previouslyReturnedQty: number;
  availableQty: number;
  unitPrice: number;
  returnQty?: number;
  trackSerial?: boolean;
  trackExpiry?: boolean;
  trackWarranty?: boolean;
  availableSerials?: string[];
  serialNumbers?: string[];
}

export interface SaleReturnData {
  invoiceId: string;
  date: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  grandTotal: number;
  paidAmount: number;
  dueAmount: number;
  previouslyReturnedAmount: number;
  netSale: number;
  items: SaleReturnDataItem[];
}

export interface ProductTrackingPendingLot { lotId:string; productId:string; productName:string; brand:string; sourceType:string; sourceRef:string; originalQuantity:number; remainingQuantity:number; createdAt:string; trackSerial:boolean; trackExpiry:boolean }
export interface ProductTrackingSerial { serialId:string; serialNumber:string; productId:string; productName:string; brand:string; lotId:string; status:string; invoiceId:string; expiryDate?:string; createdAt:string }
export interface ProductTrackingExpiry { expiryBatchId:string; productId:string; productName:string; brand:string; lotId:string; batchNo:string; expiryDate:string; originalQuantity:number; remainingQuantity:number; createdAt:string }
export interface ProductTrackingWarranty { warrantyId:string; invoiceId:string; saleDate:string; productId:string; productName:string; customerName:string; customerPhone:string; serialNumber:string; quantity:number; remainingQuantity?:number; warrantyEndDate:string; status:string; openClaimCount?:number; createdAt:string }
export interface ProductTrackingWarrantyClaim { claimId:string; warrantyId:string; claimDate:string; issue:string; resolution:string; status:string; createdBy:string; createdAt:string; updatedAt:string; invoiceId:string; productId:string; productName:string; customerName:string; customerPhone:string; serialNumber:string; warrantyEndDate:string }
export interface ProductTrackingWarrantyReplacement { replacementId:string; claimId:string; warrantyId:string; replacementDate:string; productId:string; invoiceId:string; originalSerialId:string; originalSerialNumber:string; replacementSerialId:string; replacementSerialNumber:string; note:string; createdBy:string; createdAt:string; productName:string; customerName:string; customerPhone:string }
export interface SupplierWarrantyRmaReceivedItem { receivedItemId:string; rmaId:string; productId:string; productName:string; quantity:number; unitValue:number; destination:'Inventory'|'Customer'|string; lotId:string; trackingStatus:string; createdAt:string }
export interface SupplierWarrantyRmaFinancial { financialId:string; rmaId:string; financialType:'Supplier Credit'|'Additional Payable'|'Cash Refund'|string; amount:number; paymentMethod:string; bankAccountId:string; supplierLedgerId:string; createdAt:string }
export interface SupplierWarrantyRma { rmaId:string; rmaNo:string; supplierId:string; supplierName:string; claimId:string; warrantyId:string; productId:string; productName:string; serialNumber:string; quantity:number; customerHandling:string; sentDate:string; supplierReference:string; status:string; notes:string; resolutionType:string; resolvedDate:string; resolutionNote:string; createdBy:string; resolvedBy:string; createdAt:string; customerName:string; customerPhone:string; invoiceId:string; receivedItems:SupplierWarrantyRmaReceivedItem[]; financials:SupplierWarrantyRmaFinancial[] }
export interface SupplierWarrantyOverview { rmas:SupplierWarrantyRma[]; suppliers:Array<{id:string;name:string;currentDue:number}>; bankAccounts:Array<{id:string;name:string;type:string;currentBalance:number}>; products:Product[] }
export interface SupplierWarrantyReceivedInput { productId:string; quantity:number; unitValue:number; tracking?:LotTrackingInput }
export interface SupplierWarrantyResolveInput { resolvedDate:string; resolutionType:'Same Item Returned'|'Replacement Same Product'|'Settlement'|'Warranty Rejected'; directToCustomer:boolean; receivedItems:SupplierWarrantyReceivedInput[]; supplierCreditAmount:number; additionalPayableAmount:number; cashRefundAmount:number; refundMethod:'Cash'|'Bank'|'Mobile Banking'; bankAccountId:string; resolutionNote:string }
export interface ProductTrackingOverview { products:Array<Product & {physical:number;sellable:number;pending:number;expired:number}>; pending:ProductTrackingPendingLot[]; serials:ProductTrackingSerial[]; expiry:ProductTrackingExpiry[]; warranties:ProductTrackingWarranty[]; claims:ProductTrackingWarrantyClaim[]; replacements:ProductTrackingWarrantyReplacement[] }

export interface SalesReturnRecord {
  returnId: string;
  returnDate: string;
  invoiceId: string;
  customerName: string;
  customerPhone: string;
  refundMethod: string;
  totalReturnAmount: number;
  reason: string;
  notes: string;
  processedBy: string;
  isBackdated: boolean;
  backdatedReason: string;
  createdAt: string;
}

export interface SalesReturnSearchResult {
  invoiceId: string;
  date: string;
  customerName: string;
  customerPhone: string;
  grandTotal: number;
  paymentStatus: string;
  returnStatus: string;
}

export interface SalesReturnDetailItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface SalesReturnDetail {
  header: SalesReturnRecord;
  items: SalesReturnDetailItem[];
}

export interface PosLoadRequest {
  invoiceId: string;
  mode: 'duplicate' | 'update';
  reason?: string;
  nonce: number;
}

export interface CustomerRow {
  id: string;
  name: string;
  fatherName: string;
  phone: string;
  address: string;
  openingBalance: number;
  currentDue: number;
  notes: string;
  status: ProductStatus;
  createdAt?: string;
}

export interface CustomerLedgerRow {
  ledgerId: string;
  date: string;
  customerId: string;
  customerName: string;
  type: string;
  reference: string;
  debit: number;
  credit: number;
  balance: number;
  notes: string;
  paymentMethod: string;
  bankAccountId?: string;
  createdAt?: string;
}

export interface CustomerDetail {
  customer: CustomerRow;
  ledger: CustomerLedgerRow[];
  history: LedgerHistoryMeta;
  summary: LedgerBalanceSummary;
  printHeader: LedgerPrintHeader;
}

export interface CustomerForm {
  name: string;
  fatherName: string;
  phone: string;
  address: string;
  openingBalance: number;
  notes: string;
}

export interface CustomerPaymentForm {
  amount: number;
  method: string;
  bankAccountId?: string;
  notes: string;
  date: string;
  backdatedReason?: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  description: string;
  status: 'Active' | 'Inactive';
}

export interface ExpenseForm {
  date: string;
  categoryId: string;
  payeeId?: string;
  amount: number;
  paymentMethod: 'Cash' | 'Bank' | 'Mobile Banking' | 'Other' | string;
  bankAccountId?: string;
  description: string;
  referenceNo: string;
  notes: string;
  backdatedReason?: string;
}

export interface ExpenseRow {
  expenseId: string;
  date: string;
  categoryId: string;
  category: string;
  payeeId?: string;
  payeeName?: string;
  amount: number;
  paymentMethod: string;
  bankAccountId?: string;
  bankAccountName?: string;
  description: string;
  referenceNo: string;
  notes: string;
  status: 'Active' | 'Cancelled' | string;
  isBackdated: boolean;
  backdatedDays: number;
  backdatedReason: string;
  createdBy?: string;
  createdAt?: string;
}


export interface ExpensePayee {
  id: string;
  name: string;
  phone: string;
  address: string;
  notes: string;
  status: 'Active' | 'Inactive' | string;
  transactionCount: number;
  totalPaid: number;
}

export interface ExpensePayeeForm {
  name: string;
  phone: string;
  address: string;
  notes: string;
}

export interface ExpensePayeeLedgerRow {
  expenseId: string;
  date: string;
  createdAt: string;
  category: string;
  description: string;
  paymentMethod: string;
  amount: number;
  netAmount: number;
  runningPaid: number;
  status: string;
}

export interface ExpensePayeeLedgerResult {
  payee: ExpensePayee;
  ledger: ExpensePayeeLedgerRow[];
  totalPaid: number;
  transactionCount: number;
  periodPaid: number;
  cumulativePaid: number;
  history: LedgerHistoryMeta;
  printHeader: LedgerPrintHeader;
}

export interface BankAccountFull {
  id: string;
  name: string;
  accountType: 'Bank' | 'Mobile Banking' | string;
  bankName: string;
  accountNumber: string;
  openingBalance: number;
  currentBalance: number;
  notes: string;
  status: 'Active' | 'Inactive' | string;
  createdAt?: string;
}

export interface BankAccountForm {
  name: string;
  accountType: 'Bank' | 'Mobile Banking';
  bankName: string;
  accountNumber: string;
  openingBalance: number;
  notes: string;
}

export interface BankLedgerAccount {
  id: string;
  name: string;
  bankName: string;
  currentBalance: number;
  type: 'Bank' | 'Mobile Banking' | string;
}

export interface BankManualEntryType {
  key: string;
  label: string;
  direction: 'debit' | 'credit' | 'either';
  contra: 'cash' | null;
}

export interface BankLedgerEntry {
  entryId: string;
  date: string;
  type: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  notes: string;
  createdBy: string;
  createdAt: string;
  status: string;
  reversalOf: string;
  isBackdated: boolean;
  backdatedDays: number;
  backdatedReason: string;
}

export interface BankLedgerResult {
  account: {
    id: string;
    name: string;
    bankName: string;
    accountNumber: string;
    openingBalance: number;
    currentBalance: number;
  };
  range: { from: string; to: string };
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  entries: BankLedgerEntry[];
  entryCount: number;
  history: LedgerHistoryMeta;
  summary: LedgerBalanceSummary;
  printHeader: LedgerPrintHeader;
  integrity: {
    computedBalance: number;
    storedBalance: number;
    drift: number;
    balanced: boolean;
    hasOpeningRow: boolean;
  };
}

export interface BankTransferRow {
  transferId: string;
  date: string;
  fromAccountId: string;
  fromAccountName: string;
  toAccountId: string;
  toAccountName: string;
  amount: number;
  notes: string;
  createdBy: string;
  createdAt: string;
}

export interface DayBookTotals {
  cashIn: number;
  cashOut: number;
  bankIn: number;
  bankOut: number;
  netCash: number;
  netBank: number;
}

export type DayBookDeleteAction = '' | 'sale' | 'purchase' | 'expense' | 'customer-payment' | 'supplier-payment' | 'bank-reverse';

export interface DayBookRow {
  ts: string;
  date: string;
  time: string;
  referenceNo: string;
  module: string;
  transactionType: string;
  party: string;
  description: string;
  paymentMethod: string;
  cashIn: number;
  cashOut: number;
  bankIn: number;
  bankOut: number;
  amount: number;
  runningCashBalance: number | null;
  createdBy: string;
  status: string;
  isDeleted: boolean;
  deletedBy: string;
  deleteReason: string;
  isBackdated: boolean;
  backdatedDays: number;
  backdatedReason: string;
  sourceModule: string;
  sourceId: string;
  openId: string;
  deleteAction: DayBookDeleteAction;
  deleteId: string;
  canEdit: boolean;
}

export interface DayBookBootstrap {
  currencySymbol: string;
  editableDays: number;
  modules: string[];
  isAdmin: boolean;
}

export interface DayBookResult {
  rows: DayBookRow[];
  totals: DayBookTotals;
  isAdmin: boolean;
  count: number;
}

export type DayBookSourceAction = 'open' | 'edit' | 'delete' | 'return' | 'receive-payment' | 'cancel' | 'reverse';

export interface DayBookOpenSource {
  sourceModule: string;
  sourceId: string;
  openId: string;
  sourceDate: string;
  action: DayBookSourceAction;
  nonce: number;
}


export type FinancePersonType = 'Owner' | 'Lender';
export interface FinancePerson { id: string; name: string; type: FinancePersonType; status: 'Active' | 'Inactive'; phone?: string; notes?: string; }
export interface FinanceTransactionType { key: string; label: string; direction: 'in' | 'out'; account?: 'capital' | 'loan'; }
export interface FinanceBootstrap {
  transactionTypes: FinanceTransactionType[];
  paymentMethods: string[];
  bankAccounts: Array<{ id: string; name: string; type: 'Bank' | 'Mobile Banking'; currentBalance: number }>;
  persons: FinancePerson[];
  personsAll: FinancePerson[];
  ownerCapital: number;
  outstandingLoan: number;
  currencySymbol: string;
  today: string;
  activeCashSession: boolean;
}
export interface FinanceForm {
  date: string;
  transactionType: string;
  personId: string;
  paymentMethod: string;
  bankAccountId?: string;
  amount: number;
  referenceNo?: string;
  notes?: string;
  backdatedReason?: string;
}
export interface FinanceLedgerRow {
  financeId: string;
  date: string;
  transactionType: string;
  transactionTypeLabel: string;
  account: 'capital' | 'loan' | '';
  personId: string;
  person: string;
  paymentMethod: string;
  bankAccountId: string;
  bankAccountName: string;
  amount: number;
  debit: number;
  credit: number;
  balance: number;
  referenceNo: string;
  notes: string;
  createdBy: string;
  createdAt: string;
  isBackdated: boolean;
  backdatedDays: number;
  backdatedReason: string;
}
export interface FinanceLedgerAccountSummary {
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
}
export interface FinanceLedgerResult {
  rows: FinanceLedgerRow[];
  ownerCapital: number;
  outstandingLoan: number;
  transactionTypes: FinanceTransactionType[];
  currencySymbol: string;
  history: LedgerHistoryMeta;
  capitalSummary: FinanceLedgerAccountSummary;
  loanSummary: FinanceLedgerAccountSummary;
  printHeader: LedgerPrintHeader;
}

export interface DashboardActivityRow {
  date: string;
  time: string;
  module: string;
  transactionType: string;
  referenceNo: string;
  party: string;
  cashIn: number;
  cashOut: number;
  status: string;
  isBackdated: boolean;
}

export interface DashboardStats {
  todaySalesTotal: number;
  todaySalesCount: number;
  todayExpenseTotal: number;
  monthSalesTotal: number;
  todayProfit: number;
  todayGrossProfit: number;
  todayCogs: number;
  monthProfit: number;
  monthGrossProfit: number;
  monthExpenseTotal: number;
  monthGrossMarginPercent: number;
  profitCoverageWarning: number;
  profitCoverageTotal: number;
  expenseByCategory: Array<{ label: string; entries: number; amount: number }>;
  topProducts: Array<{ name: string; qtySold: number; revenue: number; profit: number }>;
  topDebtors: Array<{ name: string; phone: string; due: number }>;
  activity: DashboardActivityRow[];
  activityAvailable: boolean;
  cashBalance: number;
  bankAccounts: Array<{ id: string; name: string; balance: number }>;
  totalBankBalance: number;
  totalBalance: number;
  dueReceivable: number;
  supplierPayable: number;
  inventoryValue: number;
  lowStockCount: number;
  lowStockItems: Array<{ name: string; stock: number; min: number }>;
  activeSession: null | { sessionId: string; openedAt: string; openingCash: number };
  currencySymbol: string;
  ownerCapital: number;
  outstandingLoan: number;
}

export interface ReportsBootstrap {
  reportTypes: Array<{ key: string; label: string }>;
  currencySymbol: string;
  shopName: string;
  defaultFrom: string;
  defaultTo: string;
}
export interface SalesReport {
  range:{from:string;to:string};
  totals:{invoices:number;grossSales:number;discount:number;returned:number;netSales:number;paid:number;due:number};
  byDay:Array<{label:string;invoices:number;gross:number;returned:number;net:number}>;
  byPaymentType:Array<{label:string;invoices:number;gross:number;net:number}>;
  topCustomers:Array<{label:string;invoices:number;gross:number;net:number}>;
}
export interface PurchaseReport {
  range:{from:string;to:string};
  totals:{purchases:number;grossPurchases:number;discount:number;returned:number;netPurchases:number;paid:number;due:number};
  byDay:Array<{label:string;purchases:number;gross:number;returned:number;net:number}>;
  topSuppliers:Array<{label:string;purchases:number;gross:number;net:number;due:number}>;
}
export interface StockReportProduct { productId:string;name:string;category:string;unit:string;stock:number;minStock:number;purchasePrice:number;sellingPrice:number;lotQuantity:number;lotValue:number;retailValue:number;status:string;lotMismatch:boolean; }
export interface StockReport {
  totals:{products:number;activeProducts:number;inventoryValue:number;retailValue:number;potentialMargin:number;lowStockCount:number;outOfStockCount:number;mismatchCount:number};
  byCategory:Array<{label:string;products:number;stock:number;value:number}>;
  products:StockReportProduct[];
  lowStock:StockReportProduct[];
}
export interface CashBankReport {
  range:{from:string;to:string};
  cash:{opening:number;inflow:number;outflow:number;closing:number;entries:number;byType:Array<{label:string;entries:number;inflow:number;outflow:number;net:number}>};
  banks:Array<{id:string;name:string;bankName:string;opening:number;inflow:number;outflow:number;closing:number;entries:number;currentBalance:number}>;
  bankTotals:{opening:number;inflow:number;outflow:number;closing:number};
  combined:{opening:number;closing:number};
}
export interface ProfitProductRow { productId:string;label:string;qtySold:number;qtyReturned:number;revenue:number;cost:number;profit:number; }
export interface ProfitReport {
  range:{from:string;to:string};
  totals:{invoices:number;grossSales:number;discount:number;returned:number;netRevenue:number;cogs:number;grossProfit:number;grossMarginPercent:number;expenses:number;netProfit:number;netMarginPercent:number};
  coverage:{invoicesInRange:number;invoicesWithLotData:number;invoicesMissingLotData:number;missingSample:Array<{invoiceId:string;date:string;grandTotal:number}>};
  byProduct:ProfitProductRow[];
  topProducts:ProfitProductRow[];
  lossMakers:ProfitProductRow[];
  expenseByCategory:Array<{label:string;entries:number;amount:number}>;
}
export interface BalanceSheetReport {
  asOf:string;
  assets:{cash:number;bank:number;mobileBanking:number;inventory:number;total:number};
  liabilities:{outstandingLoan:number;total:number};
  equity:{ownerCapital:number;total:number};
}


export interface SettingsBankAccount {
  id: string;
  name: string;
}
export interface SettingsBootstrap {
  settings: Record<string, string>;
  bankAccounts: SettingsBankAccount[];
}
export interface InvoiceDesignBootstrap {
  settings: Record<string, string>;
  logoDataUri: string;
}


export interface ManagedUser {
  id: string;
  name: string;
  mobile: string;
  role: string;
  roleLabel: string;
  status: 'Active' | 'Inactive';
  createdBy: string;
  createdAt: string;
  lastLogin: string;
}

export interface ManagedRoleOption {
  name: string;
  label: string;
}

export interface UsersBootstrap {
  users: ManagedUser[];
  roles: ManagedRoleOption[];
  canAssignAdministrator: boolean;
}

export interface PermissionModuleOption {
  key: string;
  label: string;
}

export interface DeleteWindowOption {
  key: DeleteWindowCode;
  label: string;
}

export interface ManagedRole {
  id: string;
  name: string;
  allowedModules: string[];
  permissions: RolePermissions;
  status: 'Active' | 'Inactive';
  createdAt: string;
}

export interface RolesBootstrap {
  roles: ManagedRole[];
  moduleOptions: PermissionModuleOption[];
  deleteWindowOptions: DeleteWindowOption[];
}


export interface VendorSummary {
  id: string;
  name: string;
  phone: string;
  currentDue: number;
  currentReceivable: number;
  status: 'Active' | 'Inactive';
}
export interface VendorBankAccount {
  id: string;
  name: string;
  type: string;
}
export interface VendorProductOption {
  id: string;
  name: string;
  productName: string;
  brand: string;
  category: string;
  unit: string;
  barcode: string;
  currentStock: number;
}
export interface VendorBootstrap {
  vendors: VendorSummary[];
  bankAccounts: VendorBankAccount[];
  products: VendorProductOption[];
  currencySymbol: string;
  activeCashSession: boolean;
}
export interface VendorLedgerRow {
  ledgerId: string;
  date: string;
  type: string;
  balanceType: 'Payable' | 'Receivable';
  reference: string;
  debit: number;
  credit: number;
  balance: number;
  notes: string;
  paymentMethod: string;
  isBackdated: boolean;
  backdatedReason: string;
  createdBy: string;
}
export interface VendorOpenSourcing {
  sourcingId: string;
  date: string;
  invoiceId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitCost: number;
  returnedQty: number;
  remainingQty: number;
}
export interface VendorOpenIssue {
  issueId: string;
  date: string;
  productId: string;
  productName: string;
  quantity: number;
  unitValue: number;
  returnedQty: number;
  remainingQty: number;
}
export interface VendorSourcingHistoryRow extends VendorOpenSourcing {
  totalCost: number;
  status: 'Open' | 'Settled';
  createdBy: string;
  createdAt: string;
}
export interface VendorReturnHistoryRow {
  returnId: string;
  date: string;
  sourcingId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitCost: number;
  totalValue: number;
  notes: string;
  createdBy: string;
  createdAt: string;
}
export interface VendorIssueHistoryRow extends VendorOpenIssue {
  totalValue: number;
  status: 'Open' | 'Settled';
  notes: string;
  createdBy: string;
  createdAt: string;
}
export interface VendorReturnReceivedHistoryRow {
  returnId: string;
  date: string;
  issueId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitValue: number;
  totalValue: number;
  notes: string;
  createdBy: string;
  createdAt: string;
}
export interface VendorDetail {
  vendor: VendorSummary;
  ledger: VendorLedgerRow[];
  history: LedgerHistoryMeta;
  payableSummary: LedgerBalanceSummary;
  receivableSummary: LedgerBalanceSummary;
  printHeader: LedgerPrintHeader;
  openSourcing: VendorOpenSourcing[];
  openIssues: VendorOpenIssue[];
  sourcingHistory: VendorSourcingHistoryRow[];
  returnHistory: VendorReturnHistoryRow[];
  issueHistory: VendorIssueHistoryRow[];
  receivedHistory: VendorReturnReceivedHistoryRow[];
}


export interface SystemOverview {
  tableCount: number;
  totalRows: number;
  activeUsers: number;
  activeSessions: number;
  auditEntries: number;
  tableRows: Array<{ table: string; rows: number }>;
  lastAuditAt: string;
}

export interface SystemBackupFile {
  format: 'SherERP-D1-Backup';
  version: 1;
  createdAt: string;
  app: 'SherERP';
  tables: Record<string, Array<Record<string, unknown>>>;
}

export interface AuditLogRow {
  id: number;
  userId: string;
  userName: string;
  action: string;
  entityType: string;
  entityId: string;
  note: string;
  createdAt: string;
}

export interface AuditLogResult {
  rows: AuditLogRow[];
  total: number;
}
