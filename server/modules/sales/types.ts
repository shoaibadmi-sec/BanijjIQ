export type PosSaleLineInput = { productId?: string; name?: string; qty?: number; unitPrice?: number; unitBreakdown?: { unit:string; count:number }[]; vendorId?: string; vendorUnitCost?: number; fulfillmentMode?: 'own' | 'vendor' | 'negative'; serialNumbers?: string[] };
export type PosSaleInput = {
  customerId?: string; customerName?: string; customerPhone?: string; customerAddress?: string; customerFatherName?: string;
  date?: string; backdatedReason?: string; discount?: number; paymentType?: 'Cash' | 'Due' | 'Partial'; paidAmount?: number;
  paymentMethod?: string; bankAccountId?: string; items?: PosSaleLineInput[];
};

