import type { LotTrackingInput, WarrantyPeriodUnit } from './tracking.types.js';

export type ProductInput = {
  productName?: string;
  brand?: string;
  category?: string;
  unit?: string;
  barcode?: string;
  purchasePrice?: number;
  sellingPrice?: number;
  minimumStock?: number;
  currentStock?: number;
  status?: 'Active' | 'Inactive';
  preferredSupplierId?: string;
  trackSerial?: boolean;
  trackExpiry?: boolean;
  trackWarranty?: boolean;
  warrantyPeriodValue?: number;
  warrantyPeriodUnit?: WarrantyPeriodUnit;
  openingTracking?: LotTrackingInput;
  stockTracking?: LotTrackingInput;
};

export type ProductRow = {
  product_id: string;
  product_name: string;
  brand: string;
  category: string;
  unit: string;
  barcode?: string;
  purchase_price: number;
  selling_price: number;
  current_stock: number;
  minimum_stock: number;
  status: string;
  is_deleted: number;
  created_at: string;
  updated_at: string;
  preferred_supplier_id?: string;
  track_serial: number;
  track_expiry: number;
  track_warranty: number;
  warranty_period_value: number;
  warranty_period_unit: WarrantyPeriodUnit | string;
};
