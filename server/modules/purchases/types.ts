import type { LotTrackingInput } from '../products/tracking.types.js';

export type PurchaseLineInput = {
  productId?: string;
  name?: string;
  qty?: number;
  quantity?: number;
  unitPrice?: number;
  purchasePrice?: number;
  sellingPrice?: number;
  tracking?: LotTrackingInput;
};

export type PurchaseInput = {
  purchaseId?: string;
  purchasePlanOrderId?: string;
  reason?: string;
  supplierId?: string;
  supplierName?: string;
  quickSupplierName?: string;
  date?: string;
  purchaseDate?: string;
  backdatedReason?: string;
  discount?: number;
  paidAmount?: number;
  notes?: string;
  note?: string;
  paymentMethod?: string;
  bankAccountId?: string;
  items?: PurchaseLineInput[];
};

export type PurchaseReturnInput = {
  purchaseId?: string;
  date?: string;
  backdatedReason?: string;
  refundMethod?: 'Cash' | 'Supplier Credit';
  reason?: string;
  notes?: string;
  items?: Array<{ productId?: string; qty?: number; quantity?: number; unitPrice?: number; returnPrice?: number; name?: string; serialNumbers?: string[] }>;
};
