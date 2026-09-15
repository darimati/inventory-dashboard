/**
 * D-day 계산 및 표시 유틸리티
 * KST(UTC+9) 자정 기준으로 일수 차이를 계산하고 통일된 D-day 표기를 반환합니다.
 *
 * 표기 규칙:
 *   diffDays > 0  → "D-N"   (예정일이 미래)
 *   diffDays === 0 → "D-day" (오늘)
 *   diffDays < 0  → "D+N"   (예정일이 지남)
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 두 날짜 사이의 일수 차이를 KST 자정 기준으로 계산합니다.
 * @param from - 기준일 (Date 객체 또는 'YYYY-MM-DD' 문자열). 생략 시 현재 시각 (KST 기준 오늘).
 * @param to - 대상일 (Date 객체 또는 'YYYY-MM-DD' 문자열)
 * @returns to - from 일수 (양수: to가 미래, 음수: to가 과거)
 */
export function daysBetween(from: Date | string | null | undefined, to: Date | string | null | undefined): number {
  const toKstMidnight = (d: Date | string): number => {
    if (typeof d === 'string') {
      // 'YYYY-MM-DD' 문자열 → 해당 날짜의 KST 자정 = UTC 전날 15:00
      const dateStr = d.slice(0, 10);
      return new Date(dateStr + 'T00:00:00+09:00').getTime();
    }
    // Date 객체 → KST 시각으로 변환 후 자정으로 내림
    const kst = new Date(d.getTime() + KST_OFFSET_MS);
    const dateStr = kst.toISOString().slice(0, 10);
    return new Date(dateStr + 'T00:00:00+09:00').getTime();
  };

  const fromMs = from ? toKstMidnight(from) : toKstMidnight(new Date());
  const toMs = to ? toKstMidnight(to) : toKstMidnight(new Date());

  return Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
}

/**
 * 일수 차이를 D-day 표기 문자열로 변환합니다.
 * @param diffDays - daysBetween() 결과값
 * @returns "D-7", "D-day", "3일 경과" 등
 */
export function formatDDay(diffDays: number): string {
  if (diffDays > 0) return `D-${diffDays}`;
  if (diffDays === 0) return 'D-day';
  return `${Math.abs(diffDays)}일 경과`;
}

/**
 * D-day 표기에 맞는 색상과 font-weight를 반환합니다.
 *
 * 색상 규칙:
 *   D+N (지남)    → #B03F3B / 550
 *   D-day (오늘)  → #B03F3B / 550
 *   D-1 ~ D-3     → #A8712A / 500
 *   D-4 이상       → #565D64 / 450
 *   일정 없음      → "—" / #8A9199
 */
export function getDDayStyle(diffDays: number): { color: string; weight: number } {
  if (diffDays <= 0) return { color: '#B03F3B', weight: 550 };
  if (diffDays <= 3) return { color: '#A8712A', weight: 500 };
  return { color: '#565D64', weight: 450 };
}

/**
 * 일정이 없을 때 사용할 기본 스타일
 */
export const NO_SCHEDULE_STYLE = {
  text: '—',
  color: '#8A9199',
  weight: 450,
} as const;
