/**
 * 공통 유틸리티
 */
import { format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';

const KR = 'ko-KR';

export function formatKRW(amount: number): string {
  return new Intl.NumberFormat(KR, { maximumFractionDigits: 0 }).format(Math.round(amount)) + '원';
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(KR).format(n);
}

export function formatCompact(n: number): string {
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 10_000)}만`;
  return formatNumber(Math.round(n));
}

/** Chart Y-axis label formatter */
export function formatChartAxis(n: number): string {
  if (n === 0) return '0';
  if (Math.abs(n) < 10_000) return formatNumber(Math.round(n));
  const man = Math.round(n / 10_000);
  if (man >= 1000) return `${formatNumber(man)}만`;
  return `${man}만`;
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  try {
    return format(parseISO(dateStr), 'yyyy.MM.dd');
  } catch {
    return dateStr;
  }
}

export function formatDateShort(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'M/d');
  } catch {
    return dateStr;
  }
}

/** 한국 시간 기준 오늘 날짜 */
export function getToday(): string {
  const kst = new Date(Date.now() + 9 * 3_600_000);
  return kst.toISOString().slice(0, 10);
}

export function getDaysAgo(n: number): string {
  const kst = new Date(Date.now() + 9 * 3_600_000);
  kst.setUTCDate(kst.getUTCDate() - n);
  return kst.toISOString().slice(0, 10);
}

export function getThisMonthRange(): [string, string] {
  const kst = new Date(Date.now() + 9 * 3_600_000);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth(); // 0-indexed
  const startStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const todayStr = kst.toISOString().slice(0, 10);
  return [startStr, todayStr];
}

export function getLastMonthRange(): [string, string] {
  const kst = new Date(Date.now() + 9 * 3_600_000);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth(); // 0-indexed, current month
  // last month
  const lmDate = new Date(Date.UTC(year, month - 1, 1));
  const lmYear = lmDate.getUTCFullYear();
  const lmMonth = lmDate.getUTCMonth();
  const lastDay = new Date(Date.UTC(lmYear, lmMonth + 1, 0)).getUTCDate();
  const startStr = `${lmYear}-${String(lmMonth + 1).padStart(2, '0')}-01`;
  const endStr = `${lmYear}-${String(lmMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return [startStr, endStr];
}

/** 지난달 동일 기간 (1일 ~ 오늘 날짜에 해당하는 일) */
export function getLastMonthSamePeriodRange(): [string, string] {
  const kst = new Date(Date.now() + 9 * 3_600_000);
  const todayDay = kst.getUTCDate();
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth(); // 0-indexed
  // last month start
  const lmDate = new Date(Date.UTC(year, month - 1, 1));
  const lmYear = lmDate.getUTCFullYear();
  const lmMonth = lmDate.getUTCMonth();
  const lastDayOfLastMonth = new Date(Date.UTC(lmYear, lmMonth + 1, 0)).getUTCDate();
  const compareDay = Math.min(todayDay, lastDayOfLastMonth);
  const startStr = `${lmYear}-${String(lmMonth + 1).padStart(2, '0')}-01`;
  const endStr = `${lmYear}-${String(lmMonth + 1).padStart(2, '0')}-${String(compareDay).padStart(2, '0')}`;
  return [startStr, endStr];
}

export function formatMonthKR(dateStr: string): string {
  try {
    return format(parseISO(dateStr + '-01'), 'yyyy년 M월', { locale: ko });
  } catch {
    return dateStr;
  }
}

/** 기간 프리셋 */
export type PeriodPreset = 'today' | '7d' | '30d' | 'this_month' | 'all' | 'custom';

export function getPeriodRange(preset: PeriodPreset, customFrom?: string, customTo?: string): [string, string] {
  switch (preset) {
    case 'today': {
      const t = getToday();
      return [t, t];
    }
    case '7d': return [getDaysAgo(6), getToday()];
    case '30d': return [getDaysAgo(29), getToday()];
    case 'this_month': return getThisMonthRange();
    case 'all': return ['2020-01-01', getToday()];
    case 'custom': return [customFrom ?? getToday(), customTo ?? getToday()];
  }
}

export function periodLabel(preset: PeriodPreset): string {
  switch (preset) {
    case 'today': return '오늘';
    case '7d': return '7일';
    case '30d': return '30일';
    case 'this_month': return '이번 달';
    case 'all': return '전체';
    case 'custom': return '직접 선택';
  }
}

/** 비교 기간 데이터 커버리지 확인 */
export function isComparisonValid(compFrom: string, compTo: string, dataStartDate: string | null): boolean {
  if (!dataStartDate) return false;
  return compFrom >= dataStartDate;
}

/**
 * 선택 기간과 동일 길이의 직전 기간을 계산합니다.
 * 예: 8/1~8/31 (31일) → 7/1~7/31
 *     8/24~8/31 (8일) → 8/16~8/23
 */
export function getPreviousPeriodRange(fromDate: string, toDate: string): [string, string] {
  const startMs = new Date(fromDate).getTime();
  const endMs = new Date(toDate).getTime();
  const durationMs = endMs - startMs + 86_400_000; // include both endpoints
  const prevEndMs = startMs - 86_400_000; // day before fromDate
  const prevStartMs = prevEndMs - durationMs + 86_400_000;
  return [
    new Date(prevStartMs).toISOString().slice(0, 10),
    new Date(prevEndMs).toISOString().slice(0, 10),
  ];
}

/**
 * 비교 기간이 유효하지 않은 이유를 반환합니다.
 * null이면 유효함.
 */
export function getComparisonInvalidReason(
  compFrom: string,
  compTo: string,
  dataStartDate: string | null,
  compDataDayCount: number,
): string | null {
  if (!dataStartDate) return '데이터 미적재';
  if (compFrom < dataStartDate) {
    return `데이터 ${formatDateShort(dataStartDate)}부터 적재 — 비교 구간 시작일(${formatDateShort(compFrom)}) 이전`;
  }
  const compDays = Math.max(
    1,
    Math.round((new Date(compTo).getTime() - new Date(compFrom).getTime()) / 86_400_000) + 1,
  );
  const coverage = compDataDayCount / compDays;
  if (coverage < 0.3) {
    return `비교 구간 데이터 ${Math.round(coverage * 100)}% 적재 (30% 미만)`;
  }
  return null;
}

/** Returns a caveat string if coverage is incomplete but usable (30-99%) */
export function getComparisonCaveat(
  compFrom: string,
  compTo: string,
  compDataDayCount: number,
): string | null {
  const compDays = Math.max(
    1,
    Math.round((new Date(compTo).getTime() - new Date(compFrom).getTime()) / 86_400_000) + 1,
  );
  const coverage = compDataDayCount / compDays;
  if (coverage < 1.0 && coverage >= 0.3) return `${Math.round(coverage * 100)}% 적재`;
  return null;
}
