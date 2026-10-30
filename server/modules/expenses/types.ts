export type ExpenseInput = {
  clientRequestId?: string;
  date?: string;
  categoryId?: string;
  payeeId?: string;
  amount?: number;
  paymentMethod?: string;
  bankAccountId?: string;
  description?: string;
  referenceNo?: string;
  notes?: string;
  backdatedReason?: string;
};
