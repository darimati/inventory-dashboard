/**
 * HEEDA Influencer — 지표 함수 단일 소스
 *
 * 모든 지표 계산은 이 파일에서만 수행합니다.
 * dashboard API, DashboardClient, ManageClient 등은
 * 이 파일의 함수만 사용합니다.
 */

import type { WeeklyStep } from '@/lib/types/influencer';

/* ── Skip Configuration ─────────────────────────────────── */

export interface SkipConfig {
  skipConsent: boolean;
  skipDraft: boolean;
  skipEdit: boolean;
}

/**
 * 캠페인의 skip 설정을 결정합니다.
 * skip_* 컬럼이 명시적으로 설정되어 있으면 그 값을 사용하고,
 * null/undefined이면 collab_type 기본값을 적용합니다.
 *
 * 기본값: free_seeding/free_collab → draft+edit 스킵
 *         fixed_fee/fixed_fee_rs → 스킵 없음
 */
export function getSkipConfig(campaign: {
  skip_consent?: boolean | null;
  skip_draft?: boolean | null;
  skip_edit?: boolean | null;
  collab_type?: string | null;
}): SkipConfig {
  const isFree = campaign.collab_type === 'free_seeding' || campaign.collab_type === 'free_collab';

  return {
    skipConsent: campaign.skip_consent ?? false,
    skipDraft: campaign.skip_draft ?? isFree,
    skipEdit: campaign.skip_edit ?? isFree,
  };
}

/* ── Participant Step ────────────────────────────────────── */

/**
 * 참여자의 현재 진행 단계를 결정합니다.
 * getCurrentStep()의 개선 버전 — skip 설정을 캠페인에서 가져옵니다.
 *
 * @returns 첫 번째 미완료 단계 (draft → edit → upload → payment)
 */
export function getParticipantStep(
  p: { [k: string]: unknown },
  skip: SkipConfig,
): WeeklyStep {
  if (!skip.skipDraft && !p.draft_received_at) return 'draft';
  if (!skip.skipEdit && !p.edit_received_at) return 'edit';
  if (!p.uploaded_at) return 'upload';

  // 유가 참여자: 지급 대기
  const hasFee = (Number(p.fee) || 0) > 0;
  if (hasFee) return 'payment';

  // 무가 참여자: upload 완료 = 최종 단계
  return 'payment';
}

/**
 * 참여자가 완료 상태인지 판단합니다.
 *
 * 완료 조건 (E-2):
 *   유가: inf_settlements.payment_status = 'paid'
 *   무가: upload 확인 완료 (uploaded_at 존재)
 *
 * @param settlementPaid - inf_settlements에서 조회한 지급 완료 여부
 */
export function isParticipantCompleted(
  p: { fee?: number; uploaded_at?: unknown },
  settlementPaid: boolean,
): boolean {
  const hasFee = (Number(p.fee) || 0) > 0;

  if (hasFee) {
    // 유가: inf_settlements.payment_status = 'paid'
    return settlementPaid;
  }

  // 무가: upload 확인 완료
  return !!p.uploaded_at;
}

/**
 * "완료" 판단 (간소 버전, 목록 표시용)
 * inf_participants.settlement_status를 사용 (inf_settlements에서 동기화됨)
 */
export function isParticipantCompletedSimple(
  p: { fee?: number; uploaded_at?: unknown; settlement_status?: string },
): boolean {
  const hasFee = (Number(p.fee) || 0) > 0;

  if (hasFee) {
    return p.settlement_status === 'paid';
  }

  return !!p.uploaded_at;
}

/* ── Settlement KPI ──────────────────────────────────────── */

/**
 * 정산 KPI 금액 계산 (E-4):
 *   주 지표: gross_amount (세전)
 *   부 지표: net_amount (세후)
 */
export function calcSettlementAmount(
  settlement: { gross_amount?: number; net_amount?: number },
  mode: 'gross' | 'net' = 'gross',
): number {
  if (mode === 'net') {
    return Number(settlement.net_amount) || Number(settlement.gross_amount) || 0;
  }
  return Number(settlement.gross_amount) || 0;
}

/**
 * 정산 합계 계산
 */
export function sumSettlements(
  settlements: Array<{ gross_amount?: number; net_amount?: number }>,
  mode: 'gross' | 'net' = 'gross',
): number {
  return settlements.reduce((sum, s) => sum + calcSettlementAmount(s, mode), 0);
}

/* ── Budget ──────────────────────────────────────────────── */

/**
 * 월간 예산 (E-5):
 *   inf_settings.default_budget.monthly > 0 이면 사용
 *   없으면 active 캠페인 budget 합산, "캠페인 예산 합 기준" 표시
 */
export function getMonthlyBudget(
  settingsBudget: number,
  campaignBudgetSum: number,
): { amount: number; isFallback: boolean } {
  if (settingsBudget > 0) {
    return { amount: settingsBudget, isFallback: false };
  }
  return { amount: campaignBudgetSum, isFallback: campaignBudgetSum > 0 };
}

/* ── Product Execution ───────────────────────────────────── */

/**
 * 제품별 집행 현황 (fee > 0인 참여자만 포함)
 */
export function calcProductExecution(
  participants: Array<{ product?: unknown; fee?: number }>,
): Record<string, { count: number; fee: number }> {
  const result: Record<string, { count: number; fee: number }> = {};

  for (const p of participants) {
    const fee = Number(p.fee) || 0;
    if (fee <= 0) continue; // fee=0 제외

    const key = (p.product as string) || '기타';
    if (!result[key]) {
      result[key] = { count: 0, fee: 0 };
    }
    result[key].count += 1;
    result[key].fee += fee;
  }

  return result;
}
