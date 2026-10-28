export type CustomerInput = {
  name?: string;
  phone?: string;
  fatherName?: string;
  address?: string;
  openingBalance?: number;
  notes?: string;
};

export type CustomerPaymentInput = {
  amount?: number;
  method?: string;
  bankAccountId?: string;
  date?: string;
  notes?: string;
  backdatedReason?: string;
};
