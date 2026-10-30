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
  unitQuantities?: Record<string,number>;
  unitProfileRevision?: number;
  priceUnit?: string;
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
  clientRequestId?: string;
  items?: Array<{ productId?: string; qty?: number; quantity?: number; unitPrice?: number; returnPrice?: number; name?: string; serialNumbers?: string[]; unitQuantities?: Record<string,number> }>;
};
