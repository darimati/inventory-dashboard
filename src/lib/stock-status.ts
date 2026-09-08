/**
 * Shared stock status calculation — used by home page, inventory tab, and today's checks.
 * Single source of truth for status thresholds and labels.
 */

export type StockStatus = 'oos' | 'order_needed' | 'transfer_review' | 'normal' | 'no_sales';

export const SAFETY_DAYS = 21;

export function calcDailyAvg(sales30d: number): number {
  return Math.round((sales30d / 30) * 10) / 10;
}

export function calcDaysLeft(stock: number, dailyAvg: number): number | null {
  if (dailyAvg <= 0) return null;
  return Math.round(stock / dailyAvg);
}

export function calcStockStatus(
  stock: number,
  sales30d: number,
  daysLeft: number | null,
): StockStatus {
  if (stock === 0) return 'oos';
  if (sales30d === 0) return 'no_sales';
  if (daysLeft !== null) {
    if (daysLeft <= SAFETY_DAYS) return 'order_needed';
    if (daysLeft <= Math.round(SAFETY_DAYS * 1.5)) return 'transfer_review';
    return 'normal';
  }
  return 'normal';
}

export function statusLabel(status: StockStatus): { text: string; color: string } {
  switch (status) {
    case 'oos': return { text: '품절', color: '#D9534F' };
    case 'order_needed': return { text: '발주 필요', color: '#D9534F' };
    case 'transfer_review': return { text: '이관 검토', color: '#E09B3D' };
    case 'normal': return { text: '정상', color: '#8E959D' };
    case 'no_sales': return { text: '판매 없음', color: '#9AA2AA' };
  }
}
