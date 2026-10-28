export type PurchasePlannerScope = 'ALL' | 'SUPPLIER';
export type PurchasePlannerPriority = 'Critical' | 'High' | 'Medium' | 'Low';

export type PurchasePlannerAnalysisInput = {
  scope?: PurchasePlannerScope;
  supplierId?: string;
  salesWindowDays?: number;
  targetCoverDays?: number;
  budgetAmount?: number;
};

export type PurchasePlannerManualItem = {
  productId?: string;
  supplierId?: string;
  plannedQty?: number;
  included?: boolean;
};

export type PurchasePlanSaveInput = PurchasePlannerAnalysisInput & {
  planDate?: string;
  notes?: string;
  items?: PurchasePlannerManualItem[];
};

export type PurchasePlanActionInput = {
  reason?: string;
};
