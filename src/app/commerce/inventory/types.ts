/* ------------------------------------------------------------------ */
/*  Shared Types for Inventory Page                                    */
/* ------------------------------------------------------------------ */

export interface RocketItem {
  product: string; option: string; spec: string; vendorItemId: string;
  stock: number; unitCount: number; unitStock: number;
  sales30d: number; sales7d: number;
  dailyAvg: number; dailyAvg7: number; dailyAvg30: number;
  salesBasis: '7d' | '30d' | null;
  daysLeft: number | null; snapshotAt: string;
}

export interface EzadminItem {
  product: string; option: string; spec: string; productCode: string; productName: string;
  availableStock: number; normalStock: number; defectiveStock: number;
  shipping: number; incoming: number; updatedAt: string;
  variant: 'domestic' | 'export';
  variantType: 'domestic' | 'japan' | 'export';
  stockType: 'finished' | 'submaterial';
  note: string;
  mapped: boolean;
}

export interface AlertItem {
  product: string; option: string; stock: number; dailyAvg: number; daysLeft: number; location: string;
}

export interface SnapshotPoint { date: string; product: string; rocketStock: number; ezadminStock: number; }

export interface PurchaseOrder {
  id: string; order_number: string; order_type: 'production' | 'transfer';
  destination: 'easyadmin' | 'rocketgrowth'; status: 'ordered' | 'arrived' | 'cancelled';
  ordered_at: string; expected_at: string | null; arrived_at: string | null;
  memo: string | null; created_at: string; created_by: string | null;
  purchase_order_items: PurchaseOrderItem[];
}

export interface PurchaseOrderItem {
  id: string; purchase_order_id: string; product: string; quantity: number; arrived_quantity: number;
}

export interface ProductSummary {
  product: string; spec: string; color: string;
  rocketStock: number; ezadminTotal: number; ezadminDomestic: number;
  ezadminJapan: number; ezadminExport: number; ezadminExportWorkable: number;
  shippingQty: number; incomingQty: number; availableStock: number;
  dailyAvg: number; dailyAvg7: number; dailyAvg30: number;
  salesBasis: '7d' | '30d' | null;
  daysLeft: number | null; oosOptions: number; noSalesOptions: number;
  primarySkuCode: string | null; primarySkuStock: number; nonPrimarySkuStock: number;
  inboundShippedQty: number; inboundDeadline: string | null;
}

export interface InboundRequest {
  id: string;
  product: string;
  option: string | null;
  quantity: number;
  status: 'created' | 'ea_ordered' | 'shipped' | 'arrived' | 'rejected' | 'cancelled';
  warehouse: string | null;
  ea_ordered_at: string | null;
  shipped_at: string | null;
  tracking_number: string | null;
  tracking_entered_at: string | null;
  arrived_at: string | null;
  rejected_at: string | null;
  reject_reason: '3pl_error' | 'coupang_reject' | 'damaged' | 'other' | null;
  reject_memo: string | null;
  reshipped_from_id: string | null;
  coupang_deadline: string | null;
  coupang_inbound_id: string | null;
  vendor_item_id: string | null;
  memo: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
}

export interface InventoryThresholds {
  transferSafetyDays: number;
  transferTargetDays: number;
  orderTargetDays: number;
  transferLeadTime: number;
  productionLeadTime: number;
}

export interface ProductNotice {
  type: string;
  message: string;
  resumeDate?: string;
}

export interface ActionItem {
  product: string;
  spec: string;
  color: string;
  type: 'warning' | 'info';
  reason: string;
  detail: string;
  basis?: string;
  recommendedQty?: number;
  expectedArrival?: string;
  showOrderButton?: boolean;
  buttonType?: 'order' | 'inbound' | 'coupang' | 'settings' | null;
  inboundProduct?: string;
  inboundQty?: number;
}

export interface InboundProductOption {
  value: string;
  label: string;
  vid: string;
  product: string;
  option: string;
  unitCount: number;
}

/** SKU 상태 */
export type SkuStatus = 'critical' | 'warning' | 'shortage' | 'transfer_ok' | 'stable';

/** 옵션 레벨 행 (통합 테이블용) */
export interface OptionRow {
  product: string;
  option: string;
  vendorItemId: string;
  unitStock: number;
  daysLeft30: number | null;
  dailyAvg30: number;
  sales30d: number;
  ezDomesticStock: number;
  status: SkuStatus;
  actionLabel: string;
  transferable: boolean;
}

export interface Props {
  rocketItems: RocketItem[];
  ezadminItems: EzadminItem[];
  alerts: AlertItem[];
  snapshots: SnapshotPoint[];
  purchaseOrders: PurchaseOrder[];
  incomingMap: Record<string, { rocket: number; ezadmin: number }>;
  leadTimes: { production: number; transfer: number };
  inventoryThresholds: InventoryThresholds;
  productNotices: Record<string, ProductNotice>;
  productSummaries: ProductSummary[];
  serverInboundRequests: any[];
  primarySkus: Record<string, string>;
  summary: {
    rocketTotal: number; rocketInStock: number; rocketOOS: number; rocketCount: number;
    ezadminTotal: number; ezadminDomesticTotal: number; ezadminInStock: number; ezadminOOS: number; ezadminCount: number;
  };
}
