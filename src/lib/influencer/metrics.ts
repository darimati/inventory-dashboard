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
  // 섭외 단계: 동의서 미수집
  if (!skip.skipConsent && p.consent_status !== 'agreed') return 'consent';
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

/* ── Participant Progress — SINGLE SOURCE OF TRUTH ─────── */

export interface StepInfo {
  done: boolean;
  date: string | null;
  url?: string | null;
}

export interface ParticipantProgress {
  consent: StepInfo;
  proposal: StepInfo;
  roughCut: StepInfo;
  upload: StepInfo;
  settlement: { status: string | null; dueDate: string | null };
  currentStage: 'consent' | 'proposal' | 'roughCut' | 'upload' | 'settlement' | 'complete';
}

/**
 * 참여자의 전체 진행 상황을 반환합니다.
 * 대시보드·캠페인 관리·참여자 상세·캘린더가 모두 이 함수를 사용합니다.
 *
 * @param p - inf_participants 행 (Record 형태)
 * @param deliverables - dlv:{pid}:{step} 값 맵 (key: 'draft'|'edit'|'upload')
 * @param skip - 캠페인별 단계 스킵 설정
 */
export function getParticipantProgress(
  p: Record<string, unknown>,
  deliverables: Record<string, Record<string, unknown>>,
  skip: SkipConfig,
): ParticipantProgress {
  const consent: StepInfo = skip.skipConsent
    ? { done: true, date: null }
    : { done: p.consent_status === 'agreed', date: (p.consent_agreed_at as string) ?? null };

  const proposal: StepInfo = skip.skipDraft
    ? { done: true, date: null, url: null }
    : {
        done: !!p.draft_received_at,
        date: (p.draft_received_at as string) ?? null,
        url: (deliverables.draft?.link_url as string) ?? null,
      };

  const roughCut: StepInfo = skip.skipEdit
    ? { done: true, date: null, url: null }
    : {
        done: !!p.edit_received_at,
        date: (p.edit_received_at as string) ?? null,
        url: (deliverables.edit?.link_url as string) ?? (deliverables.edit?.file_url as string) ?? null,
      };

  const upload: StepInfo = {
    done: !!p.uploaded_at,
    date: (p.uploaded_at as string) ?? null,
    url: (p.published_url as string) ?? (deliverables.upload?.link_url as string) ?? null,
  };

  const hasFee = (Number(p.fee) || 0) > 0;
  const settlement = {
    status: (p.settlement_status as string) ?? null,
    dueDate: (p.planned_payment_date as string) ?? null,
  };

  let currentStage: ParticipantProgress['currentStage'] = 'complete';
  if (!consent.done) currentStage = 'consent';
  else if (!proposal.done) currentStage = 'proposal';
  else if (!roughCut.done) currentStage = 'roughCut';
  else if (!upload.done) currentStage = 'upload';
  else if (hasFee && settlement.status !== 'paid') currentStage = 'settlement';

  return { consent, proposal, roughCut, upload, settlement, currentStage };
}

/* ── Tax Calculation — SINGLE SOURCE OF TRUTH ─────────── */

export interface TaxBreakdown {
  incomeTax: number;
  localTax: number;
  totalTax: number;
  netAmount: number;
  vat?: number;
}

/**
 * 세금 계산 (단일 소스)
 *   사업소득: 소득세 = floor(고료 × 0.03), 지방소득세 = floor(소득세 × 0.1)
 *   세금계산서: 부가세 별도 (고료에서 차감 안 함)
 *   면세계산서/간이과세자: 세금 없음
 */
export function calcTaxBreakdown(grossAmount: number, taxType: string): TaxBreakdown {
  if (taxType === 'business_income') {
    const incomeTax = Math.floor(grossAmount * 0.03);
    const localTax = Math.floor(incomeTax * 0.1);
    const totalTax = incomeTax + localTax;
    return { incomeTax, localTax, totalTax, netAmount: grossAmount - totalTax };
  }
  if (taxType === 'tax_invoice') {
    const vat = Math.round(grossAmount * 0.1);
    return { incomeTax: 0, localTax: 0, totalTax: 0, netAmount: grossAmount, vat };
  }
  // tax_exempt_invoice, simplified_business
  return { incomeTax: 0, localTax: 0, totalTax: 0, netAmount: grossAmount };
}

/* ── Campaign Amounts — 집계 단일 소스 ────────────────── */

export interface CampaignAmounts {
  budget: number;
  allocated: number;   // 배정 (유가 참여자 fee 합)
  paid: number;        // 지급 완료
  pending: number;     // 미지급 (확인필요 + 지급대기)
  remaining: number;   // 잔여 (budget - allocated)
}

/**
 * 캠페인별 금액 집계
 * 제외: is_archived 참여자, 취소 상태
 * 캠페인 헤더, 정산 관리, 대시보드 모두 이 함수를 사용한다.
 * 화면에서 직접 SUM 돌리지 않는다.
 */
export function getCampaignAmounts(
  campaign: { budget?: number },
  participants: Array<{
    fee?: number;
    is_archived?: boolean;
    collab_type?: string | null;
    settlement_status?: string;
  }>,
  settlements: Array<{
    participant_id?: string;
    payment_status?: string;
    net_amount?: number;
    gross_amount?: number;
  }>,
): CampaignAmounts {
  const budget = Number(campaign.budget) || 0;

  // 활성 유가 참여자만 (보관/삭제 제외)
  const active = participants.filter(p => !p.is_archived);
  const allocated = active.reduce((sum, p) => sum + (Number(p.fee) || 0), 0);

  const paidSettlements = settlements.filter(s => s.payment_status === 'paid');
  const paid = paidSettlements.reduce((sum, s) => sum + (Number(s.net_amount) || Number(s.gross_amount) || 0), 0);

  const pendingSettlements = settlements.filter(s => s.payment_status !== 'paid');
  const pending = pendingSettlements.reduce((sum, s) => sum + (Number(s.net_amount) || Number(s.gross_amount) || 0), 0);

  return { budget, allocated, paid, pending, remaining: budget - allocated };
}

/* ── Monthly Amounts — 월간 집계 단일 소스 ────────────── */

export interface MonthlyAmounts {
  allocated: number;      // 고료 합
  paid: number;           // 지급 완료 실지급액
  pending: number;        // 미지급 실지급액
  withholding: {
    incomeTax: number;    // 소득세 합
    localTax: number;     // 지방소득세 합
    total: number;
  };
  count: number;
}

/**
 * 월간 금액 집계
 * 월간 집계, 대시보드 모두 이 함수를 사용한다.
 */
export function getMonthlyAmounts(
  settlements: Array<{
    gross_amount?: number;
    net_amount?: number;
    income_tax_amount?: number;
    local_tax_amount?: number;
    payment_status?: string;
  }>,
): MonthlyAmounts {
  let allocated = 0, paid = 0, pending = 0;
  let incomeTax = 0, localTax = 0;

  for (const s of settlements) {
    const gross = Number(s.gross_amount) || 0;
    const net = Number(s.net_amount) || gross;
    allocated += gross;
    incomeTax += Number(s.income_tax_amount) || 0;
    localTax += Number(s.local_tax_amount) || 0;

    if (s.payment_status === 'paid') {
      paid += net;
    } else {
      pending += net;
    }
  }

  return {
    allocated,
    paid,
    pending,
    withholding: { incomeTax, localTax, total: incomeTax + localTax },
    count: settlements.length,
  };
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
 * 제품별 배정 현황 (fee > 0인 참여자만 포함)
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

/* ── Settlement Message Template ─────────────────────────── */

/**
 * KakaoTalk/DM용 정산 안내 메시지 생성
 */
export function generateSettlementMessage(params: {
  participantName: string;
  fee: number;
  paymentDate: string;
  settlementLink: string;
}): string {
  const feeStr = params.fee.toLocaleString('ko-KR');
  return `[HEEDA 정산 안내]
안녕하세요, ${params.participantName}님!
콘텐츠 확인이 완료되어 정산 안내드립니다.

■ 고료: ${feeStr}원
■ 지급 예정일: ${params.paymentDate}
■ 세금: 3.3% 원천징수 후 지급

아래 링크에서 정산 정보를 입력해주세요.
${params.settlementLink}

* 링크 유효기간: 30일`;
}

/* ── Slack Format Copy ───────────────────────────────────── */

/**
 * Slack 형식 단건 복사
 */
export function formatSlackSettlement(row: {
  participant_name: string;
  tax_type: string;
  gross_amount: number;
  net_amount: number;
  bank_name?: string;
  bank_holder?: string;
}): string {
  const taxLabels: Record<string, string> = {
    business_income: '사업소득',
    tax_invoice: '세금계산서',
    tax_exempt_invoice: '계산서',
    simplified_business: '간이과세자',
  };
  const grossStr = (row.gross_amount || 0).toLocaleString('ko-KR');
  const netStr = (row.net_amount || 0).toLocaleString('ko-KR');
  const bank = row.bank_name && row.bank_holder ? ` | ${row.bank_name} ${row.bank_holder}` : '';
  return `[정산] ${row.participant_name} | ${taxLabels[row.tax_type] || row.tax_type} | ${grossStr}→${netStr}${bank}`;
}

/**
 * Slack 형식 다건 복사
 */
export function formatSlackSettlements(rows: Parameters<typeof formatSlackSettlement>[0][]): string {
  return rows.map(formatSlackSettlement).join('\n');
}

/**
 * Slack 형식 월간 집계
 */
export function formatSlackMonthly(month: string, amounts: MonthlyAmounts): string {
  return `[정산 월간 집계] ${month}
총 고료: ${amounts.allocated.toLocaleString('ko-KR')}원 (${amounts.count}건)
소득세: ${amounts.withholding.incomeTax.toLocaleString('ko-KR')}원 / 지방소득세: ${amounts.withholding.localTax.toLocaleString('ko-KR')}원
실지급 합계: ${amounts.paid.toLocaleString('ko-KR')}원`;
}
