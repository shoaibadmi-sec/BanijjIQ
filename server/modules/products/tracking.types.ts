export type WarrantyPeriodUnit = 'Days' | 'Months' | 'Years';

export type ExpiryBatchInput = {
  quantity?: number;
  expiryDate?: string;
  batchNo?: string;
  serialNumbers?: string[];
};

export type LotTrackingInput = {
  serialNumbers?: string[];
  expiryBatches?: ExpiryBatchInput[];
};
