export type BankAccountInput = {
  name?: string;
  accountType?: string;
  bankName?: string;
  accountNumber?: string;
  openingBalance?: number;
  notes?: string;
};

export type BankManualInput = {
  bankAccountId?: string;
  entryType?: string;
  amount?: number;
  date?: string;
  direction?: 'debit' | 'credit';
  reference?: string;
  description?: string;
  notes?: string;
  backdatedReason?: string;
};

export type BankTransferInput = { fromAccountId?: string; toAccountId?: string; amount?: number; notes?: string; clientRequestId?: string };

export type FinancePersonInput = { name?: string; personType?: 'Owner' | 'Lender'; phone?: string; notes?: string; status?: string };

export type FinanceInput = {
  date?: string; transactionType?: string; personId?: string; paymentMethod?: string; bankAccountId?: string;
  amount?: number; referenceNo?: string; notes?: string; backdatedReason?: string;
};

export type FinanceTxType = { key: string; label: string; account: 'capital' | 'loan'; direction: 'in' | 'out' };
