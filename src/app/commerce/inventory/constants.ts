/* ------------------------------------------------------------------ */
/*  Shared Constants for Inventory Page                                */
/* ------------------------------------------------------------------ */

import type { InboundRequest, InboundProductOption } from './types';

export type Tab = 'rocket' | 'ezadmin' | 'orders' | 'inbound';

export const PRODUCTS = ['클렌징밤', '클렌징폼', '세럼'];

export const PRODUCT_COLORS: Record<string, string> = {
  '클렌징밤': '#9DC3E6',
  '클렌징폼': '#7FCDBB',
  '세럼': '#F2A0A0',
};

export const CHART_COLORS: Record<string, string> = {
  '클렌징밤': '#2563EB',
  '클렌징폼': '#16A34A',
  '세럼': '#D97706',
};

export const ORDER_TYPE_LABELS: Record<string, string> = { production: '생산', transfer: '이관' };
export const DEST_LABELS: Record<string, string> = { easyadmin: '판매자배송 3PL(이지어드민)', rocketgrowth: '로켓그로스' };
export const STATUS_LABELS: Record<string, { text: string; color: string; bg: string }> = {
  ordered: { text: '입고 대기', color: '#A8712A', bg: '#FDF6EC' },
  arrived: { text: '입고 완료', color: '#6E767E', bg: '#F2F4F7' },
  cancelled: { text: '취소', color: '#8A9199', bg: '#F2F4F7' },
};

export const INBOUND_STEP_LABELS = ['이지어드민 발주', '송장번호 입력', '판매개시 확인'];
export const INBOUND_STEP_FIELDS: (keyof InboundRequest)[] = ['ea_ordered_at', 'tracking_entered_at', 'arrived_at'];
export const INBOUND_STEP_API_MAP = [2, 4, 5];

export const WAREHOUSES = ['인천14', '동탄1', '고양1'];

export const REJECT_REASON_LABELS: Record<string, string> = {
  '3pl_error': '3PL 귀책',
  'coupang_reject': '쿠팡 반려',
  'damaged': '파손',
  'other': '기타',
};

export const CANCEL_REASONS = ['반송', '기한초과', '수량변경', '기타'];

export const INBOUND_TYPE_OPTIONS = [
  { value: '3pl_to_rg', label: '3PL → RG 이관' },
  { value: 'rg_inbound', label: 'RG 입고' },
  { value: '3pl_inbound', label: '3PL 입고' },
  { value: 'factory_to_3pl', label: '공장 → 3PL' },
  { value: 'other', label: '기타' },
];

export const INBOUND_SOURCE_OPTIONS = [
  { value: '3pl', label: '판매자배송 3PL' },
  { value: 'factory', label: '공장' },
  { value: 'other', label: '기타' },
];

export const INBOUND_DEST_OPTIONS = [
  { value: 'rocketgrowth', label: '로켓그로스' },
  { value: '3pl', label: '판매자배송 3PL' },
];

export const INBOUND_UNIT_OPTIONS = [
  { value: 'set', label: '세트' },
  { value: 'piece', label: '개' },
  { value: 'box', label: '박스' },
];

export const INBOUND_PRODUCT_OPTIONS: InboundProductOption[] = [
  { value: '90621781347', label: '클렌징밤 단품', vid: '90621781347', product: '클렌징밤', option: '단품', unitCount: 1 },
  { value: '93924698351', label: '클렌징밤 2개 세트', vid: '93924698351', product: '클렌징밤', option: '2개 세트', unitCount: 2 },
  { value: '93924698352', label: '클렌징밤 3개 세트', vid: '93924698352', product: '클렌징밤', option: '3개 세트', unitCount: 3 },
  { value: '91329716230', label: '클렌징밤 4개 세트', vid: '91329716230', product: '클렌징밤', option: '4개 세트', unitCount: 4 },
  { value: '91007861343', label: '클렌징폼 단품', vid: '91007861343', product: '클렌징폼', option: '단품', unitCount: 1 },
  { value: '93943745189', label: '클렌징폼 2개 세트', vid: '93943745189', product: '클렌징폼', option: '2개 세트', unitCount: 2 },
  { value: '93943745188', label: '클렌징폼 3개 세트', vid: '93943745188', product: '클렌징폼', option: '3개 세트', unitCount: 3 },
  { value: '93993063704', label: '세럼 단품', vid: '93993063704', product: '세럼', option: '단품', unitCount: 1 },
];

export const INBOUND_STATUS_BADGE: Record<string, { text: string; color: string; bg: string }> = {
  order_needed: { text: '발주 필요', color: '#B03F3B', bg: '#FBE9E8' },
  tracking_needed: { text: '송장 입력 필요', color: '#A8712A', bg: '#FDF4E7' },
  waiting: { text: '입고 대기', color: '#6E767E', bg: '#F1F3F6' },
  done: { text: '완료', color: '#6E767E', bg: '#F1F3F6' },
  cancelled: { text: '취소', color: '#8A9199', bg: 'transparent' },
};

export const GAUGE_MAX_DAYS = 90;
export const TICK_14 = 14 / GAUGE_MAX_DAYS;
export const TICK_30 = 30 / GAUGE_MAX_DAYS;
export const SAFETY_DAYS: Record<string, number> = { '클렌징밤': 21, '클렌징폼': 21, '세럼': 21 };
export const DEFAULT_SAFETY_DAYS = 21;

/* ------------------------------------------------------------------ */
/*  Utility functions                                                  */
/* ------------------------------------------------------------------ */

export function getSafetyDays(product: string): number {
  return SAFETY_DAYS[product] ?? DEFAULT_SAFETY_DAYS;
}

export function statusLabel(days: number | null, _safetyDays?: number): { text: string; color: string; bg: string } {
  if (days === null) return { text: '판매 없음', color: '#9AA2AA', bg: 'transparent' };
  if (days === 0) return { text: '품절', color: '#D9534F', bg: '#FBE9E8' };
  if (days <= 10) return { text: '긴급', color: '#D9534F', bg: '#FBE9E8' };
  if (days <= 21) return { text: '발주 필요', color: '#A8712A', bg: '#FDF6EC' };
  return { text: '정상', color: '#9AA2AA', bg: 'transparent' };
}

export function gaugeColor(days: number | null, safetyDays: number): string {
  return statusLabel(days, safetyDays).color;
}
