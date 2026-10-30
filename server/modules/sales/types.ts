export type PosSaleLineInput = { productId?: string; name?: string; qty?: number; unitPrice?: number; vendorId?: string; vendorUnitCost?: number; fulfillmentMode?: 'own' | 'vendor' | 'negative'; serialNumbers?: string[]; unitQuantities?: Record<string,number>; unitProfileRevision?: number };
export type PosSaleTenderInput = { method:'Cash'|'Bank'|'Mobile Banking'|'Store Credit'; amountCents:number; bankAccountId?:string; allocationId?:string };
export type PosSaleInput = {
  clientRequestId?: string;
  customerId?: string; customerName?: string; customerPhone?: string; customerAddress?: string; customerFatherName?: string;
  date?: string; backdatedReason?: string; discount?: number; paymentType?: 'Cash' | 'Due' | 'Partial'; paidAmount?: number;
  paymentMethod?: string; bankAccountId?: string; tenders?: PosSaleTenderInput[]; items?: PosSaleLineInput[];
};

