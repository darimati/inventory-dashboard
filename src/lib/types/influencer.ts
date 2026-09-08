/* ------------------------------------------------------------------ */
/*  HEEDA Influencer Operations — TypeScript Types  v3                */
/* ------------------------------------------------------------------ */

export type CollabType = 'free_seeding' | 'free_collab' | 'fixed_fee' | 'fixed_fee_rs';

export const COLLAB_TYPE_LABELS: Record<CollabType, string> = {
  free_seeding: '무가시딩',
  free_collab: '무가협업',
  fixed_fee: '고정고료',
  fixed_fee_rs: '고정고료+RS',
};

export function isPaidCollab(t: CollabType | string | null | undefined): boolean {
  return t === 'fixed_fee' || t === 'fixed_fee_rs';
}

export function isUnpaidCollab(t: CollabType | string | null | undefined): boolean {
  return t === 'free_seeding' || t === 'free_collab';
}

export type CampaignStatus = 'preparing' | 'active' | 'completed' | 'cancelled';

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  preparing: '준비 중',
  active: '진행 중',
  completed: '완료',
  cancelled: '취소',
};

export type ParticipantStatus =
  | 'pending'
  | 'product_sent'
  | 'content_submitted'
  | 'published'
  | 'completed'
  | 'cancelled';

export const PARTICIPANT_STATUS_LABELS: Record<ParticipantStatus, string> = {
  pending: '대기',
  product_sent: '제품 발송',
  content_submitted: '콘텐츠 제출',
  published: '게시 완료',
  completed: '완료',
  cancelled: '취소',
};

export type ConsentStatus = 'not_sent' | 'sent' | 'agreed' | 'expired';

export const CONSENT_STATUS_LABELS: Record<ConsentStatus, string> = {
  not_sent: '미발송',
  sent: '발송',
  agreed: '회수완료',
  expired: '만료',
};

export type SettlementDocStatus = 'none' | 'docs_requested' | 'docs_submitted' | 'payment_requested' | 'paid';

export const SETTLEMENT_DOC_STATUS_LABELS: Record<SettlementDocStatus, string> = {
  none: '없음',
  docs_requested: '발송',
  docs_submitted: '정보 제출',
  payment_requested: '지급 요청',
  paid: '지급 완료',
};

/* ---- Settlement Stage (single-source display status) ---- */

export type SettlementStage =
  | 'not_applicable'   // 해당없음 — 무가 (fee = 0)
  | 'waiting'          // 대기 — 유가, 업로드 미확인
  | 'info_waiting'     // 정산정보 대기 — 업로드 확인, 정산 정보 미회수
  | 'payment_waiting'  // 정산 대기 — 정산 정보 회수됨, 미지급
  | 'paid';            // 지급 완료

export const SETTLEMENT_STAGE_LABELS: Record<SettlementStage, string> = {
  not_applicable: '해당없음',
  waiting: '대기',
  info_waiting: '정산정보 대기',
  payment_waiting: '정산 대기',
  paid: '지급 완료',
};

export function getSettlementStatus(p: {
  fee?: number;
  published_url?: string | null;
  settlement_status?: string;
}): SettlementStage {
  // 무가 (fee = 0) → 해당없음
  if ((p.fee || 0) === 0) return 'not_applicable';
  // 유가이나 업로드 미확인 → 대기
  if (!p.published_url) return 'waiting';
  // 업로드 확인, 정산 정보 미회수 → 정산정보 대기
  if (!p.settlement_status || p.settlement_status === 'none' || p.settlement_status === 'docs_requested') {
    return 'info_waiting';
  }
  // 정산 정보 회수됨, 미지급 → 정산 대기
  if (p.settlement_status === 'docs_submitted' || p.settlement_status === 'payment_requested') {
    return 'payment_waiting';
  }
  // 지급 완료
  if (p.settlement_status === 'paid') return 'paid';
  return 'not_applicable';
}

export type PaymentStatus = 'waiting' | 'requested' | 'paid' | 'on_hold';

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  waiting: '정산 대기',
  requested: '요청',
  paid: '지급 완료',
  on_hold: '보류',
};

export type TaxType = 'business_income' | 'tax_invoice' | 'tax_exempt_invoice' | 'simplified_business';

export const TAX_TYPE_LABELS: Record<TaxType, string> = {
  business_income: '사업소득',
  tax_invoice: '세금계산서',
  tax_exempt_invoice: '계산서',
  simplified_business: '간이과세자',
};

export type Channel = 'instagram' | 'youtube' | 'tiktok' | 'blog' | 'other';

export const CHANNEL_LABELS: Record<Channel, string> = {
  instagram: '인스타그램',
  youtube: '유튜브',
  tiktok: '틱톡',
  blog: '블로그',
  other: '기타',
};

/* ---- Content Formats (v3) ---- */

export type ContentFormat = 'reels' | 'feed' | 'story' | 'shorts' | 'video';

export const CONTENT_FORMAT_LABELS: Record<ContentFormat, string> = {
  reels: '릴스',
  feed: '피드',
  story: '스토리',
  shorts: '숏츠',
  video: '영상',
};

export interface ContentFormatEntry {
  format: ContentFormat;
  count: number;
}

export function formatContentFormats(formats: ContentFormatEntry[]): string {
  if (!formats || formats.length === 0) return '';
  return formats
    .map(f => `${CONTENT_FORMAT_LABELS[f.format] ?? f.format} ${f.count}건`)
    .join(' + ');
}

/* ---- Product types (v3) ---- */

export interface InfluencerProduct {
  name: string;
  unit_cost: number;
}

export interface ProductSetItem {
  product: string;
  quantity: number;
}

export interface ProductSet {
  name: string;
  items: ProductSetItem[];
}

export interface ProvidedProduct {
  product: string;
  quantity: number;
  unit_cost: number;
}

export function calcProductCost(products: ProvidedProduct[]): number {
  if (!products || products.length === 0) return 0;
  return products.reduce((sum, p) => sum + (p.quantity ?? 0) * (p.unit_cost ?? 0), 0);
}

export function formatProvidedProducts(products: ProvidedProduct[], setName?: string | null): string {
  if (!products || products.length === 0) return '-';
  const items = products.map(p => p.product).join(' · ');
  return setName ? `${setName} (${items})` : items;
}

/* ---- Constants ---- */

export const KOREAN_BANKS = [
  'KB국민은행', '신한은행', '하나은행', '우리은행', 'SC제일은행',
  'IBK기업은행', 'NH농협은행', '수협은행', '대구은행', '부산은행',
  '광주은행', '전북은행', '경남은행', '제주은행',
  '케이뱅크', '카카오뱅크', '토스뱅크',
  '새마을금고', '신협', '우체국', 'KDB산업은행',
] as const;

/* ---- Dashboard (v3) ---- */

export interface DashboardCampaignSummary {
  id: string;
  name: string;
  month: string | null;
  status: CampaignStatus;
  budget: number;
  participantCount: number;
  consentAgreed: number;
  uploadDone: number;
  totalFee: number;
  totalProductCost: number;
}

export interface DashboardChecklist {
  type: string;
  label: string;
  count: number;
}

/* ---- Schedule Date (shared between calendar + dashboard) ---- */

export type WeeklyStep = 'draft' | 'edit' | 'upload' | 'performance' | 'payment';

export interface ScheduleDate {
  date: string | null;  // YYYY-MM-DD
  isConfirmed: boolean;
}

/**
 * Determine the effective date for a participant's step.
 * Uses draft_date / edit_date / upload_date (single field per stage).
 * Falls back to planned_* for legacy data.
 */
export function getScheduleDate(
  p: { [k: string]: unknown },
  stage: 'draft' | 'edit' | 'upload',
): ScheduleDate {
  // New canonical field: draft_date / edit_date / upload_date
  const canonicalKey = `${stage}_date`;
  const canonical = (p[canonicalKey] as string) || null;
  if (canonical) return { date: canonical, isConfirmed: true };
  // Legacy fallback: planned_* → confirmed_*
  const plannedKey = `planned_${stage}_date`;
  const planned = (p[plannedKey] as string) || null;
  if (planned) return { date: planned, isConfirmed: true };
  const confirmedKey = `confirmed_${stage}_date`;
  const confirmed = (p[confirmedKey] as string) || null;
  if (confirmed) return { date: confirmed, isConfirmed: true };
  return { date: null, isConfirmed: false };
}

/**
 * Determine the current step for a participant (sequential progression).
 * Returns the first incomplete step.
 * 일정 유무와 무관하게 첫 미완료 단계를 반환합니다.
 * 무가 participants skip draft/edit/payment.
 */
export function getCurrentStep(
  p: { [k: string]: unknown },
  isFree: boolean,
): WeeklyStep {
  // Sequential step progression — no "unscheduled" gate
  if (!isFree) {
    if (!p.draft_received_at) return 'draft';
    if (!p.edit_received_at) return 'edit';
  }
  if (!p.uploaded_at) return 'upload';
  // Performance: only for paid participants, after upload
  if (!isFree && p.settlement_status !== 'paid') return 'payment';

  return 'payment'; // all done
}

export interface WeeklyTaskItem {
  participant_id: string;
  campaign_id: string;
  display_name: string;
  channel: string | null;
  campaign_name: string;
  step: WeeklyStep;
  scheduled_date: string | null;
  is_confirmed: boolean;
  is_overdue: boolean;
  overdue_days: number;
  days_until: number | null; // D-N
  deliverable_status?: string | null; // 'approved' | 'revision_requested'
  deliverable_version?: number;
}

export interface WeeklyTaskSummary {
  step: WeeklyStep;
  count: number;
  overdue_count: number;
  subtitle: string; // "마예진 09/04 · 이예림 09/11" or "—"
}

export interface DashboardData {
  activeCampaigns: number;
  totalParticipants: number;
  pendingConsent: number;
  pendingSettlement: number;
  // 계약 총액 (모든 참여 확정 고료, 세전)
  monthlyContractTotal: number;
  monthlyContractFee: number;
  monthlyContractProductCost: number;
  annualContractTotal: number;
  annualContractFee: number;
  annualContractProductCost: number;
  // 집행 예정 (업로드 확인 완료 · 미지급, 세전)
  monthlyConfirmedFee: number;
  annualConfirmedFee: number;
  // 예산
  monthlyBudget: number;
  annualBudget: number;
  // 제품별 집행
  productExecution: Record<string, { count: number; fee: number }>;
  campaigns: DashboardCampaignSummary[];
  // 정산 지표 (실제 지급 레코드 기반)
  settlementWaitingCount: number;
  settlementWaitingAmount: number;
  monthlyPaidAmount: number;
  monthlyPaidCount: number;
  annualPaidAmount: number;
  todayChecklist: DashboardChecklist[];
  weeklyTasks: WeeklyTaskItem[];
  weeklyTaskSummary: WeeklyTaskSummary[];
}
