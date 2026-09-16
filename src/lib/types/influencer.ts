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

export type SettlementDocStatus = 'none' | 'not_sent' | 'docs_requested' | 'docs_submitted' | 'payment_waiting' | 'payment_requested' | 'paid' | 'expired';

export const SETTLEMENT_DOC_STATUS_LABELS: Record<string, string> = {
  none: '미발송',
  not_sent: '미발송',
  docs_requested: '제출 대기',
  docs_submitted: '확인 필요',
  payment_waiting: '지급 대기',
  payment_requested: '지급 대기',
  paid: '지급 완료',
  expired: '만료',
};

/**
 * 정산 상태 판정 단일 함수.
 * 캠페인 정산 탭 · 대시보드 · 할 일 목록이 모두 이 함수를 호출해야 합니다.
 */
export function getSettlementDisplayStatus(
  settlementStatus: string | null | undefined,
  hasPublishedUrl: boolean,
): { label: string; color: string; nextAction: string | null } {
  switch (settlementStatus) {
    case 'paid':
      return { label: '지급 완료', color: '#22C55E', nextAction: null };
    case 'payment_waiting':
    case 'payment_requested':
      return { label: '지급 대기', color: '#A8712A', nextAction: 'mark_paid' };
    case 'docs_submitted':
      return { label: '확인 필요', color: '#D97706', nextAction: 'confirm' };
    case 'docs_requested':
      return { label: '정보 대기', color: '#9AA2AA', nextAction: null };
    case 'expired':
      return { label: '만료', color: '#DC2626', nextAction: 'resend' };
    default:
      if (!hasPublishedUrl) return { label: '—', color: '#C4CAD1', nextAction: null };
      return { label: '미발송', color: '#9AA2AA', nextAction: 'send_link' };
  }
}

/** 유효한 정산 상태 전환 */
const VALID_SETTLEMENT_TRANSITIONS: Record<string, string[]> = {
  'none': ['docs_requested'],
  'not_sent': ['docs_requested'],
  'docs_requested': ['docs_submitted', 'not_sent'],
  'docs_submitted': ['payment_waiting', 'docs_requested'], // 확인 완료 또는 수정 요청
  'payment_waiting': ['paid'],
  'paid': [],
  'expired': ['docs_requested'],
};

export function isValidSettlementTransition(from: string, to: string): boolean {
  const allowed = VALID_SETTLEMENT_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

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
  if (!p.settlement_status || p.settlement_status === 'none' || p.settlement_status === 'not_sent' || p.settlement_status === 'docs_requested') {
    return 'info_waiting';
  }
  // 정산 정보 회수됨 (확인 필요) → 정산 대기
  if (p.settlement_status === 'docs_submitted') {
    return 'payment_waiting';
  }
  // 확인 완료, 미지급 → 정산 대기
  if (p.settlement_status === 'payment_waiting' || p.settlement_status === 'payment_requested') {
    return 'payment_waiting';
  }
  // 지급 완료
  if (p.settlement_status === 'paid') return 'paid';
  return 'not_applicable';
}

export type PaymentStatus = 'waiting' | 'confirmed' | 'requested' | 'paid' | 'on_hold';

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  waiting: '확인 필요',
  confirmed: '지급 대기',
  requested: '지급 대기',
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

export type ContentFormat = 'reels' | 'feed' | 'story' | 'shorts' | 'video' | 'other';

export const CONTENT_FORMAT_LABELS: Record<ContentFormat, string> = {
  reels: '릴스',
  feed: '피드',
  story: '스토리',
  shorts: '숏츠',
  video: '영상',
  other: '기타',
};

export interface ContentFormatEntry {
  format: ContentFormat;
  count: number;
  custom_label?: string;
}

export function formatContentFormats(formats: ContentFormatEntry[]): string {
  if (!formats || formats.length === 0) return '';
  return formats
    .map(f => {
      const label = f.format === 'other' && f.custom_label
        ? f.custom_label
        : (CONTENT_FORMAT_LABELS[f.format] ?? f.format);
      return `${label} ${f.count}건`;
    })
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

/* ---- Submission / Deliverable constants ---- */

export const REVIEW_CATEGORIES = [
  '광고 표기 추가 필요',
  '제품명 오기재',
  '자막 수정 필요',
  '썸네일 변경 필요',
  '컷 편집 수정 필요',
  '기타',
] as const;

export const FINAL_CONTENT_TYPES: Record<string, string> = {
  instagram_reels: '인스타그램 릴스',
  instagram_feed: '인스타그램 피드',
  instagram_story: '인스타그램 스토리',
  youtube_shorts: '유튜브 숏츠',
  youtube_video: '유튜브 영상',
  tiktok: '틱톡',
  blog: '블로그',
  other: '기타',
};

export const DELIVERABLE_STATUS_LABELS: Record<string, string> = {
  approved: '컨펌 완료',
  revision_requested: '수정 요청',
};

/* ---- Submission Assets (v4) ---- */

export type SubmissionStage = 'proposal' | 'rough_cut' | 'final_upload';
export type SubmissionStatus = 'received' | 'approved' | 'revision_requested';
export type ReviewAction = 'received' | 'approved' | 'revision_requested' | 'link_updated';

export const SUBMISSION_STAGE_LABELS: Record<SubmissionStage, string> = {
  proposal: '기획안',
  rough_cut: '가편집본',
  final_upload: '업로드',
};

export const SUBMISSION_STATUS_LABELS: Record<string, string> = {
  not_received: '미수령',
  received: '확인 필요',
  approved: '확인 완료',
  revision_requested: '수정본 대기',
};

export const SUBMISSION_STATUS_COLORS: Record<string, string> = {
  not_received: '#8A9199',
  received: '#A8712A',
  approved: '#2F7355',
  revision_requested: '#A8712A',
  revision_overdue: '#B03F3B',
};

export const SUBMISSION_BG_COLORS: Record<string, string> = {
  received: '#FDF4E7',
  revision_overdue: '#FBE9E8',
};

export interface SubmissionAsset {
  id: string;
  participant_id: string;
  stage: SubmissionStage;
  version: number;
  external_url: string | null;
  file_path: string | null;
  original_filename: string | null;
  mime_type: string | null;
  file_size: number | null;
  content_type: string | null;
  status: SubmissionStatus;
  received_at: string;
  created_at: string;
  updated_at: string;
  reviews?: SubmissionReview[];
}

export interface SubmissionReview {
  id: string;
  asset_id: string;
  action: ReviewAction;
  reason: string | null;
  memo: string | null;
  created_at: string;
}

/** Compute display status for a submission stage */
export function getSubmissionDisplayStatus(
  assets: SubmissionAsset[] | undefined,
  stage: SubmissionStage,
): { status: string; latestAsset?: SubmissionAsset; daysSinceRevision?: number } {
  if (!assets || assets.length === 0) return { status: 'not_received' };
  const stageAssets = assets.filter(a => a.stage === stage);
  if (stageAssets.length === 0) return { status: 'not_received' };

  // For proposal/final_upload: single record (latest)
  // For rough_cut: latest version
  const sorted = [...stageAssets].sort((a, b) => b.version - a.version);
  const latest = sorted[0];

  if (latest.status === 'approved') return { status: 'approved', latestAsset: latest };
  if (latest.status === 'revision_requested') {
    // Calculate days since revision was requested
    const lastRevision = latest.reviews
      ?.filter(r => r.action === 'revision_requested')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    const daysSince = lastRevision
      ? Math.floor((Date.now() - new Date(lastRevision.created_at).getTime()) / 86400000)
      : 0;
    return { status: 'revision_requested', latestAsset: latest, daysSinceRevision: daysSince };
  }

  return { status: 'received', latestAsset: latest };
}

/** Compute "다음 액션" label for a participant */
export function getNextSubmissionAction(
  assets: SubmissionAsset[] | undefined,
): string | null {
  const proposal = getSubmissionDisplayStatus(assets, 'proposal');
  if (proposal.status === 'not_received') return '기획안 요청';
  if (proposal.status === 'received') return '기획안 확인';
  if (proposal.status === 'revision_requested') return '수정본 대기';

  const roughCut = getSubmissionDisplayStatus(assets, 'rough_cut');
  if (roughCut.status === 'not_received') return '가편집본 요청';
  if (roughCut.status === 'received') return '가편집본 확인';
  if (roughCut.status === 'revision_requested') return '수정본 대기';

  const finalUpload = getSubmissionDisplayStatus(assets, 'final_upload');
  if (finalUpload.status === 'not_received') return '업로드 확인';
  if (finalUpload.status === 'received') return '업로드 확인';

  return null; // all done
}

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
  /** per-step participant counts (for stack bar) */
  stepCounts: Partial<Record<WeeklyStep, number>>;
  /** completed participants (유가: paid, 무가: uploaded) */
  completedCount: number;
  /** participants with overdue schedule */
  delayedCount: number;
}

export interface DashboardChecklist {
  type: string;
  label: string;
  count: number;
}

/* ---- Schedule Date (shared between calendar + dashboard) ---- */

export type WeeklyStep = 'consent' | 'draft' | 'edit' | 'upload' | 'payment';

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
 *
 * @deprecated getParticipantStep() in lib/influencer/metrics.ts 사용 권장.
 *             skip_* 캠페인 컬럼 기반으로 동작합니다.
 */
export function getCurrentStep(
  p: { [k: string]: unknown },
  isFree: boolean,
): WeeklyStep {
  if (!isFree) {
    if (!p.draft_received_at) return 'draft';
    if (!p.edit_received_at) return 'edit';
  }
  if (!p.uploaded_at) return 'upload';
  if (!isFree && p.settlement_status !== 'paid') return 'payment';

  return 'payment';
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
  fee?: number;
  settlement_token?: string | null;
  settlement_status?: string | null;
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
  // 배정 예정 (업로드 확인 완료 · 미지급, 세전)
  monthlyConfirmedFee: number;
  annualConfirmedFee: number;
  // 예산
  monthlyBudget: number;
  isBudgetFallback: boolean; // true = 캠페인 예산 합 기준
  annualBudget: number;
  // 제품별 배정
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
