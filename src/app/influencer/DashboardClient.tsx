'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { formatKRW } from '@/lib/helpers';
import { isPaidCollab, formatCampaignName, CHANNEL_LABELS } from '@/lib/types/influencer';
import type { DashboardData, WeeklyTaskItem, DashboardCampaignSummary, RecentUploadItem } from '@/lib/types/influencer';
import { colors, radii, STEP_LABELS } from '@/lib/influencer/styles';
import { Empty } from '@/lib/influencer/ui';

/* ── Types ───────────────────────────────────────────── */

interface CalendarEvent {
  id: string;
  type: string;
  date: string;
  title: string;
  campaign_name: string;
  participant_id: string;
  campaign_id: string;
  is_confirmed: boolean;
  is_completed: boolean;
  is_overdue: boolean;
  channel: string | null;
  memo?: string | null;
  schedule_id?: string;
}

/* ── Constants ───────────────────────────────────────── */

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'] as const;
const ROW_H = 38;
const SECTION_GAP = 24;
const CARD_GAP = 16;

/* ── Color system [G] ─────────────────────────────────── */

const STEP_DOT: Record<string, string> = {
  consent: '#B8D4E8',
  draft: '#8FAEE0',
  edit: '#7FC4CE',
  upload: '#86C9A8',
  payment: '#F0B86E',
};

const SETTLE_DOT: Record<string, string> = {
  docs_requested: '#F0B86E',
  docs_submitted: '#7FC4CE',
  payment_waiting: '#8FAEE0',
  payment_requested: '#8FAEE0',
  paid: '#86C9A8',
};

const CHANNEL_DOT: Record<string, string> = {
  instagram: '#E8A0B4',
  threads: '#C3A9DE',
  tiktok: '#8FAEE0',
  youtube: '#F0B86E',
  blog: '#CDD2D8',
  other: '#CDD2D8',
};

/* Calendar event colors */
const CAL_COLORS: Record<string, { bar: string; bg: string }> = {
  draft: { bar: '#8FAEE0', bg: '#EAF0FA' },
  edit: { bar: '#7FC4CE', bg: '#E8F4F6' },
  upload: { bar: '#86C9A8', bg: '#E9F6EF' },
  payment: { bar: '#F0B86E', bg: '#FBF1E3' },
  consent: { bar: '#CDD2D8', bg: '#F4F5F7' },
};

/* Campaign progress bar colors (same as step dots) */
const BAR_COLORS: Record<string, string> = {
  consent: '#CDD2D8',
  draft: '#8FAEE0',
  edit: '#7FC4CE',
  upload: '#86C9A8',
  payment: '#F0B86E',
};

/* Settlement status labels */
const SETTLE_LABELS: Record<string, string> = {
  docs_requested: '정보 대기',
  docs_submitted: '확인 필요',
  payment_waiting: '지급 대기',
  payment_requested: '지급 대기',
  paid: '지급 완료',
};

/* ── Styles ──────────────────────────────────────────── */

const CARD_BASE: React.CSSProperties = {
  background: colors.surface,
  border: `0.5px solid ${colors.border}`,
  borderRadius: radii.card,
  padding: '20px 24px',
};

const COL_HDR: React.CSSProperties = {
  fontSize: 13, color: colors.textSecondary,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

const KPI_NUM: React.CSSProperties = {
  fontSize: 32, fontWeight: 700, letterSpacing: '-0.03em',
  fontVariantNumeric: 'tabular-nums',
};

const CELL_CLIP: React.CSSProperties = {
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

/* dot + text helpers */
const dotWrap: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7 };
const dotS = (c: string): React.CSSProperties => ({ width: 7, height: 7, borderRadius: '50%', background: c, flex: 'none' });
const dotTxt: React.CSSProperties = { fontSize: 12, fontWeight: 400, color: colors.textPrimary, whiteSpace: 'nowrap' };

/* ── Card wrapper ──────────────────────────────────── */

function DashCard({ title, right, children, style }: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ ...CARD_BASE, ...style }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'baseline', marginBottom: 16,
      }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: colors.textPrimary }}>
          {title}
        </span>
        {right}
      </div>
      {children}
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────── */

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const dateStr = d.includes('T') ? d.slice(0, 10) : d;
  const dt = new Date(dateStr + 'T00:00:00');
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

function dDayText(daysUntil: number | null | undefined): string {
  if (daysUntil === null || daysUntil === undefined) return '—';
  if (daysUntil === 0) return 'D-day';
  if (daysUntil < 0) return `D+${Math.abs(daysUntil)}`;
  return `D-${daysUntil}`;
}

/* ── Calendar grid builder ───────────────────────────── */

interface CalCell {
  day: number | null;
  dateStr: string;
  events: CalendarEvent[];
}

function buildCalGrid(year: number, month: number, events: CalendarEvent[]): CalCell[][] {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const startDow = first.getDay();
  const daysInMonth = last.getDate();

  const byDate = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    const arr = byDate.get(ev.date);
    if (arr) arr.push(ev); else byDate.set(ev.date, [ev]);
  }

  const weeks: CalCell[][] = [];
  let week: CalCell[] = [];
  for (let i = 0; i < startDow; i++) week.push({ day: null, dateStr: '', events: [] });
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    week.push({ day: d, dateStr: ds, events: byDate.get(ds) ?? [] });
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  while (week.length > 0 && week.length < 7) week.push({ day: null, dateStr: '', events: [] });
  if (week.length > 0) weeks.push(week);
  return weeks;
}

/* ══════════════════════════════════════════════════════ */

export default function InfluencerDashboardClient() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  /* expand toggles */
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [showAllPayment, setShowAllPayment] = useState(false);
  const [showAllUploads, setShowAllUploads] = useState(false);
  const [showAllCampaigns, setShowAllCampaigns] = useState(false);

  /* task filter */
  const [taskFilter, setTaskFilter] = useState('전체');

  /* calendar state */
  const [calMonth, setCalMonth] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [calEvents, setCalEvents] = useState<CalendarEvent[]>([]);

  /* ── Data fetch ─────────────────────────── */

  const refreshData = useCallback(() => {
    fetch('/api/influencer/dashboard')
      .then(r => r.json())
      .then(d => { if (d && typeof d.activeCampaigns === 'number') setData(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/influencer/dashboard')
      .then(r => r.json())
      .then(d => { if (d && typeof d.activeCampaigns === 'number') setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refreshData]);

  /* ── Calendar fetch ─────────────────────── */

  useEffect(() => {
    const [y, m] = calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const lastDate = new Date(y, m, 0);
    const startD = new Date(first); startD.setDate(startD.getDate() - 7);
    const endD = new Date(lastDate); endD.setDate(endD.getDate() + 7);
    const pad = (n: number) => String(n).padStart(2, '0');
    const start = `${startD.getFullYear()}-${pad(startD.getMonth() + 1)}-${pad(startD.getDate())}`;
    const end = `${endD.getFullYear()}-${pad(endD.getMonth() + 1)}-${pad(endD.getDate())}`;
    fetch(`/api/influencer/calendar?start=${start}&end=${end}`)
      .then(r => r.json())
      .then(d => { setCalEvents(Array.isArray(d?.events) ? d.events : []); })
      .catch(() => {});
  }, [calMonth]);

  /* ── Calendar derived ─────────────────── */
  const [calY, calM] = calMonth.split('-').map(Number);
  const calGrid = useMemo(() => buildCalGrid(calY, calM, calEvents), [calY, calM, calEvents]);
  const todayStr = useMemo(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  }, []);

  /* ── Loading / Error ────────────────────── */

  if (loading) {
    return (
      <AppShell showFilter={false}>
        <p style={{ color: colors.textSecondary, padding: '40px 0' }}>로딩 중...</p>
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell showFilter={false}>
        <Empty message="데이터를 불러올 수 없습니다" action={{ label: '새로고침', onClick: refreshData }} />
      </AppShell>
    );
  }

  /* ── Derived data ───────────────────────── */

  const allTasks = data.weeklyTasks ?? [];

  /* This week range (Mon–Sun) */
  const todayD = new Date();
  const dow = todayD.getDay();
  const monOff = dow === 0 ? -6 : 1 - dow;
  const weekStartD = new Date(todayD);
  weekStartD.setDate(todayD.getDate() + monOff);
  const weekEndD = new Date(weekStartD);
  weekEndD.setDate(weekStartD.getDate() + 6);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const weekStartStr = `${weekStartD.getFullYear()}-${pad2(weekStartD.getMonth() + 1)}-${pad2(weekStartD.getDate())}`;
  const weekEndStr = `${weekEndD.getFullYear()}-${pad2(weekEndD.getMonth() + 1)}-${pad2(weekEndD.getDate())}`;

  /* KPI: 이번 주 마감 */
  const thisWeekTasks = allTasks.filter(t =>
    t.step !== 'payment' &&
    t.scheduled_date && t.scheduled_date >= weekStartStr && t.scheduled_date <= weekEndStr
  );
  const draftCount = thisWeekTasks.filter(t => t.step === 'draft').length;
  const editCount = thisWeekTasks.filter(t => t.step === 'edit').length;
  const uploadCount = thisWeekTasks.filter(t => t.step === 'upload').length;
  const kpi1Sub = [
    draftCount > 0 ? `기획안 ${draftCount}건` : '',
    editCount > 0 ? `가편집본 ${editCount}건` : '',
    uploadCount > 0 ? `업로드 ${uploadCount}건` : '',
  ].filter(Boolean).join(', ') || '마감 항목 없음';

  /* KPI: 지연 */
  const overdueCount = allTasks.filter(t => t.is_overdue && t.step !== 'payment').length;
  const kpi2Sub = overdueCount === 0 ? '지연 항목 없음' : '';

  /* KPI: 누적 지급액 — 미지급 금액은 지급 예정 합계와 일치 */

  /* ── [C] 이번 주 할 일 ─────────────────── */
  const weekTasksAll = allTasks.filter(t =>
    t.step !== 'payment' && (
      t.is_overdue ||
      (t.scheduled_date && t.scheduled_date >= weekStartStr && t.scheduled_date <= weekEndStr)
    )
  ).sort((a, b) => {
    if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1;
    return (a.scheduled_date || '9999').localeCompare(b.scheduled_date || '9999');
  });

  const taskFilterOptions = ['upload', 'edit', 'draft'] as const;
  const taskCounts: Record<string, number> = { '전체': weekTasksAll.length };
  for (const s of taskFilterOptions) taskCounts[STEP_LABELS[s]] = weekTasksAll.filter(t => t.step === s).length;

  const filteredTasks = taskFilter === '전체'
    ? weekTasksAll
    : weekTasksAll.filter(t => STEP_LABELS[t.step] === taskFilter);
  const TASK_VISIBLE = 6;
  const visibleTasks = showAllTasks ? filteredTasks : filteredTasks.slice(0, TASK_VISIBLE);
  const hiddenTaskCount = filteredTasks.length - TASK_VISIBLE;
  const afterWeekCount = allTasks.filter(t =>
    t.step !== 'payment' && !t.is_overdue &&
    t.scheduled_date && t.scheduled_date > weekEndStr
  ).length;

  /* ── [D] 캠페인 진행 ─────────────────── */
  const activeCampaigns = (data.campaigns ?? []).filter(c => c.status === 'active');

  /* Find nearest deadline per campaign from weeklyTasks */
  const campaignDeadlines = new Map<string, string>();
  for (const t of allTasks) {
    if (t.scheduled_date && t.step !== 'payment') {
      const cur = campaignDeadlines.get(t.campaign_id);
      if (!cur || t.scheduled_date < cur) campaignDeadlines.set(t.campaign_id, t.scheduled_date);
    }
  }

  const sortedCampaigns = [...activeCampaigns].sort((a, b) => {
    const da = campaignDeadlines.get(a.id) || '9999';
    const db = campaignDeadlines.get(b.id) || '9999';
    return da.localeCompare(db);
  });

  const CAMPAIGN_VISIBLE = 5;
  const visibleCampaigns = showAllCampaigns ? sortedCampaigns : sortedCampaigns.slice(0, CAMPAIGN_VISIBLE);
  const hiddenCampaignCount = sortedCampaigns.length - CAMPAIGN_VISIBLE;

  const barStepOrder: Array<'consent' | 'draft' | 'edit' | 'upload' | 'payment'> = ['consent', 'draft', 'edit', 'upload', 'payment'];

  /* ── [E] 지급 예정 ─────────────────── */
  const paymentPending = allTasks.filter(t =>
    isPaidCollab(t.collab_type) &&
    ['docs_requested', 'docs_submitted', 'payment_waiting', 'payment_requested'].includes(t.settlement_status || '')
  );
  const paymentTotal = paymentPending.reduce((s, t) => s + (t.fee ?? 0), 0);

  /* Status breakdown for stacked bar */
  const statusGroups = ['docs_requested', 'docs_submitted', 'payment_waiting'] as const;
  const statusAmounts: Record<string, number> = {};
  for (const s of statusGroups) {
    statusAmounts[s] = paymentPending.filter(t => t.settlement_status === s || (s === 'payment_waiting' && t.settlement_status === 'payment_requested')).reduce((sum, t) => sum + (t.fee ?? 0), 0);
  }

  const PAYMENT_VISIBLE = 4;
  const visiblePayments = showAllPayment ? paymentPending : paymentPending.slice(0, PAYMENT_VISIBLE);
  const hiddenPaymentCount = paymentPending.length - PAYMENT_VISIBLE;

  /* ── [F] 최근 업로드 콘텐츠 ─────────── */
  const recentUploads = data.recentUploads ?? [];
  const thisMonthStart = `${todayD.getFullYear()}-${pad2(todayD.getMonth() + 1)}-01`;
  const thisMonthUploads = recentUploads.filter(u => u.uploaded_at >= thisMonthStart).length;
  const UPLOAD_VISIBLE = 6;
  const visibleUploads = showAllUploads ? recentUploads : recentUploads.slice(0, UPLOAD_VISIBLE);
  const hiddenUploadCount = recentUploads.length - UPLOAD_VISIBLE;

  /* ── Row click navigation ──────────── */

  function handleRowClick(t: WeeklyTaskItem) {
    if (t.step === 'payment') {
      router.push('/influencer/settlements');
    } else {
      router.push(`/influencer/manage?campaign=${t.campaign_id}&open=${t.participant_id}`);
    }
  }

  /* toggle button helper */
  const toggleBtn = (show: boolean, count: number, onToggle: () => void, unit = '명') => (
    count > 0 ? (
      <div style={{ paddingTop: 8, textAlign: 'center' }}>
        <button
          onClick={onToggle}
          style={{
            background: 'none', border: 'none',
            color: colors.textSecondary, fontSize: 13, fontWeight: 500,
            cursor: 'pointer', fontFamily: 'var(--font)',
          }}
        >
          {show ? '접기' : `더 보기 (${count}${unit})`}
        </button>
      </div>
    ) : null
  );

  /* ── Render ─────────────────────────────── */

  return (
    <AppShell showFilter={false}>
      <style>{`
        .dash-row2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: ${CARD_GAP}px;
          align-items: stretch;
        }
        @media (max-width: 860px) {
          .dash-row2 { grid-template-columns: 1fr; }
        }
      `}</style>

      <div style={{ maxWidth: 'none' }}>
        {/* ── Page title ─────────────────────── */}
        <h1 style={{
          fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em',
          margin: 0, marginBottom: SECTION_GAP,
        }}>
          인플루언서 운영
        </h1>

        {/* ══ 1단: KPI row (3개) ═══════════ */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
          gap: CARD_GAP, marginBottom: SECTION_GAP,
        }}>
          {/* 이번 주 마감 */}
          <div style={CARD_BASE}>
            <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 4 }}>
              이번 주 마감
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
              <span style={{ ...KPI_NUM, color: '#4A7BC4' }}>
                {thisWeekTasks.length}
              </span>
              <span style={{ fontSize: 13, color: colors.textSecondary, fontWeight: 400 }}>건</span>
            </div>
            <div style={{ fontSize: 13, color: colors.textSecondary }}>{kpi1Sub}</div>
          </div>

          {/* 지연 */}
          <div style={CARD_BASE}>
            <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 4 }}>
              지연
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
              <span style={{
                ...KPI_NUM,
                color: overdueCount > 0 ? '#C08030' : colors.textPrimary,
              }}>
                {overdueCount}
              </span>
              <span style={{ fontSize: 13, color: colors.textSecondary, fontWeight: 400 }}>건</span>
            </div>
            <div style={{ fontSize: 13, color: colors.textSecondary }}>
              {kpi2Sub || `지연 항목 없음`}
            </div>
          </div>

          {/* 누적 지급액 */}
          <div style={CARD_BASE}>
            <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 4 }}>
              누적 지급액
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
              <span style={{ ...KPI_NUM, color: '#3F8F6C' }}>
                {new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(Math.round(data.annualPaidAmount ?? 0))}
              </span>
              <span style={{ fontSize: 13, color: colors.textSecondary, fontWeight: 400 }}>원</span>
            </div>
            <div style={{ fontSize: 13, color: colors.textSecondary }}>
              미지급 {formatKRW(paymentTotal)}
            </div>
          </div>
        </div>

        {/* ══ 2단: 이번 주 할 일 / 캠페인 진행 ═══════════ */}
        <div className="dash-row2" style={{ marginBottom: SECTION_GAP }}>

          {/* ── [C] 이번 주 할 일 ────────────── */}
          <DashCard
            title="이번 주 할 일"
            right={
              <span style={{ fontSize: 13, color: colors.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
                {weekStartD.getMonth() + 1}/{weekStartD.getDate()} – {weekEndD.getMonth() + 1}/{weekEndD.getDate()}, {weekTasksAll.length}건
              </span>
            }
          >
            {/* Filter chips */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {[...taskFilterOptions.map(s => STEP_LABELS[s]), '전체'].map(label => {
                const isActive = taskFilter === label;
                const cnt = taskCounts[label] ?? 0;
                return (
                  <button
                    key={label}
                    onClick={() => setTaskFilter(label)}
                    style={{
                      padding: '4px 12px', borderRadius: 999, border: 'none',
                      fontSize: 12, fontWeight: 400, cursor: 'pointer',
                      fontFamily: 'var(--font)',
                      background: isActive ? colors.borderLight : 'transparent',
                      color: isActive ? colors.textPrimary : colors.textSecondary,
                    }}
                  >
                    {label} {cnt}
                  </button>
                );
              })}
            </div>

            {/* Column header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1.3fr 1.4fr 1fr 0.7fr', gap: 12,
              height: ROW_H, alignItems: 'center',
              borderBottom: `0.5px solid ${colors.borderLight}`,
            }}>
              <span style={COL_HDR}>인플루언서</span>
              <span style={COL_HDR}>캠페인</span>
              <span style={COL_HDR}>단계</span>
              <span style={{ ...COL_HDR, textAlign: 'center' }}>마감</span>
            </div>

            {filteredTasks.length === 0 ? (
              <div style={{ height: ROW_H * 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: colors.textSecondary }}>
                이번 주 할 일이 없습니다
              </div>
            ) : (
              <>
                {visibleTasks.map((t, i) => {
                  const isLast = i === visibleTasks.length - 1 && hiddenTaskCount <= 0;
                  return (
                    <div
                      key={`${t.participant_id}-${t.step}-${i}`}
                      onClick={() => handleRowClick(t)}
                      style={{
                        display: 'grid', gridTemplateColumns: '1.3fr 1.4fr 1fr 0.7fr', gap: 12,
                        height: ROW_H, alignItems: 'center',
                        borderBottom: isLast ? 'none' : `0.5px solid ${colors.borderLight}`,
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = colors.surfaceHover; }}
                      onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                    >
                      <span style={{ ...CELL_CLIP, fontSize: 13, color: colors.textPrimary }}>{t.display_name}</span>
                      <span style={{ ...CELL_CLIP, fontSize: 13, color: colors.textSecondary }}>{formatCampaignName(t.campaign_name)}</span>
                      <span style={dotWrap}>
                        <span style={dotS(STEP_DOT[t.step] || '#CDD2D8')} />
                        <span style={dotTxt}>{STEP_LABELS[t.step] || t.step}</span>
                      </span>
                      <span style={{
                        fontSize: 13, textAlign: 'center', fontVariantNumeric: 'tabular-nums',
                        color: t.is_overdue ? '#C08030' : colors.textPrimary, fontWeight: 400,
                      }}>
                        {t.scheduled_date ? fmtDate(t.scheduled_date) : '—'}
                      </span>
                    </div>
                  );
                })}
                {toggleBtn(showAllTasks, hiddenTaskCount, () => setShowAllTasks(!showAllTasks), '건')}
              </>
            )}

            {afterWeekCount > 0 && (
              <div style={{ paddingTop: 8, fontSize: 12, color: colors.textSecondary, textAlign: 'center' }}>
                이번 주 이후 {afterWeekCount}건
              </div>
            )}
          </DashCard>

          {/* ── [D] 캠페인 진행 ────────────── */}
          <DashCard title="캠페인 진행">
            {sortedCampaigns.length === 0 ? (
              <div style={{ height: ROW_H * 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: colors.textSecondary }}>
                진행 중인 캠페인이 없습니다
              </div>
            ) : (
              <>
                {visibleCampaigns.map((c, ci) => {
                  const totalActive = barStepOrder.reduce((s, step) => s + (c.stepCounts[step] || 0), 0) + c.completedCount;
                  const nearestDate = campaignDeadlines.get(c.id);
                  return (
                    <div key={c.id} style={{
                      marginBottom: ci < visibleCampaigns.length - 1 ? 16 : 0,
                    }}>
                      {/* Campaign name + meta */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: colors.textPrimary, ...CELL_CLIP, maxWidth: '60%' }}>
                          {formatCampaignName(c.name)}
                        </span>
                        <span style={{ fontSize: 12, color: colors.textSecondary, whiteSpace: 'nowrap' }}>
                          {c.participantCount}명{nearestDate ? `, 마감 ${fmtDate(nearestDate)}` : ''}
                        </span>
                      </div>

                      {/* Stacked bar */}
                      {totalActive > 0 && (
                        <div style={{ display: 'flex', gap: 2, height: 8, borderRadius: 4, overflow: 'hidden' }}>
                          {barStepOrder.map(step => {
                            const cnt = c.stepCounts[step] || 0;
                            if (cnt === 0) return null;
                            const pct = (cnt / totalActive) * 100;
                            return (
                              <div key={step} style={{
                                width: `${pct}%`, minWidth: 4,
                                background: BAR_COLORS[step],
                                borderRadius: 4,
                              }} />
                            );
                          })}
                          {c.completedCount > 0 && (
                            <div style={{
                              width: `${(c.completedCount / totalActive) * 100}%`, minWidth: 4,
                              background: colors.borderLight,
                              borderRadius: 4,
                            }} />
                          )}
                        </div>
                      )}

                      {/* Step count caption */}
                      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                        {barStepOrder.map(step => {
                          const cnt = c.stepCounts[step] || 0;
                          if (cnt === 0) return null;
                          return (
                            <span key={step} style={{ fontSize: 11, color: colors.textSecondary }}>
                              {STEP_LABELS[step]} {cnt}
                            </span>
                          );
                        })}
                        {c.completedCount > 0 && (
                          <span style={{ fontSize: 11, color: colors.textSecondary }}>완료 {c.completedCount}</span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {toggleBtn(showAllCampaigns, hiddenCampaignCount, () => setShowAllCampaigns(!showAllCampaigns), '개')}

                {/* Legend */}
                <div style={{
                  display: 'flex', gap: 12, marginTop: 16,
                  paddingTop: 12, borderTop: `0.5px solid ${colors.borderLight}`,
                }}>
                  {barStepOrder.map(step => (
                    <span key={step} style={dotWrap}>
                      <span style={dotS(BAR_COLORS[step])} />
                      <span style={{ fontSize: 11, color: colors.textSecondary }}>{STEP_LABELS[step]}</span>
                    </span>
                  ))}
                  <span style={dotWrap}>
                    <span style={dotS(colors.borderLight)} />
                    <span style={{ fontSize: 11, color: colors.textSecondary }}>완료</span>
                  </span>
                </div>
              </>
            )}
          </DashCard>
        </div>

        {/* ══ 3단: 지급 예정 / 최근 업로드 콘텐츠 ═══════════ */}
        <div className="dash-row2" style={{ marginBottom: SECTION_GAP }}>

          {/* ── [E] 지급 예정 ────────────── */}
          <DashCard title="지급 예정">
            {paymentPending.length === 0 ? (
              <div style={{ height: ROW_H * 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: colors.textSecondary }}>
                지급 예정 인플루언서가 없습니다
              </div>
            ) : (
              <>
                {/* Summary: total amount */}
                <div style={{ fontSize: 22, fontWeight: 500, color: colors.textPrimary, marginBottom: 8, fontVariantNumeric: 'tabular-nums' }}>
                  {formatKRW(paymentTotal)}
                </div>

                {/* Stacked bar */}
                {paymentTotal > 0 && (
                  <div style={{ display: 'flex', gap: 2, height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                    {statusGroups.map(s => {
                      const amt = statusAmounts[s] || 0;
                      if (amt === 0) return null;
                      const pct = (amt / paymentTotal) * 100;
                      return (
                        <div key={s} style={{
                          width: `${pct}%`, minWidth: 4,
                          background: SETTLE_DOT[s],
                          borderRadius: 4,
                        }} />
                      );
                    })}
                  </div>
                )}

                {/* Legend */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                  {statusGroups.map(s => {
                    const amt = statusAmounts[s] || 0;
                    if (amt === 0) return null;
                    return (
                      <span key={s} style={dotWrap}>
                        <span style={dotS(SETTLE_DOT[s])} />
                        <span style={{ fontSize: 11, color: colors.textSecondary }}>{SETTLE_LABELS[s]} {formatKRW(amt)}</span>
                      </span>
                    );
                  })}
                </div>

                {/* Column header */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '1.3fr 1.2fr 1.1fr', gap: 12,
                  height: ROW_H, alignItems: 'center',
                  borderBottom: `0.5px solid ${colors.borderLight}`,
                }}>
                  <span style={COL_HDR}>인플루언서</span>
                  <span style={COL_HDR}>정산 상태</span>
                  <span style={{ ...COL_HDR, textAlign: 'right' }}>금액</span>
                </div>

                {visiblePayments.map((t, i) => {
                  const isLast = i === visiblePayments.length - 1 && hiddenPaymentCount <= 0;
                  return (
                    <div key={`${t.participant_id}-${i}`} style={{
                      display: 'grid', gridTemplateColumns: '1.3fr 1.2fr 1.1fr', gap: 12,
                      height: ROW_H, alignItems: 'center',
                      borderBottom: isLast ? 'none' : `0.5px solid ${colors.borderLight}`,
                    }}>
                      <span style={{ ...CELL_CLIP, fontSize: 13, color: colors.textPrimary }}>{t.display_name}</span>
                      <span style={dotWrap}>
                        <span style={dotS(SETTLE_DOT[t.settlement_status || ''] || '#CDD2D8')} />
                        <span style={dotTxt}>{SETTLE_LABELS[t.settlement_status || ''] || t.settlement_status || '—'}</span>
                      </span>
                      <span style={{ fontSize: 13, color: colors.textPrimary, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {formatKRW(t.fee ?? 0)}
                      </span>
                    </div>
                  );
                })}

                {toggleBtn(showAllPayment, hiddenPaymentCount, () => setShowAllPayment(!showAllPayment))}
              </>
            )}
          </DashCard>

          {/* ── [F] 최근 업로드 콘텐츠 ────────────── */}
          <DashCard
            title="최근 업로드 콘텐츠"
            right={
              <span style={{ fontSize: 13, color: colors.textSecondary }}>
                이번 달 {thisMonthUploads}건
              </span>
            }
          >
            {recentUploads.length === 0 ? (
              <div style={{ height: ROW_H * 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: colors.textSecondary }}>
                업로드된 콘텐츠가 없습니다
              </div>
            ) : (
              <>
                {/* Column header */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '1.6fr 1.2fr 0.9fr 0.8fr', gap: 12,
                  height: ROW_H, alignItems: 'center',
                  borderBottom: `0.5px solid ${colors.borderLight}`,
                }}>
                  <span style={COL_HDR}>인플루언서</span>
                  <span style={COL_HDR}>채널</span>
                  <span style={{ ...COL_HDR, textAlign: 'center' }}>업로드일</span>
                  <span style={{ ...COL_HDR, textAlign: 'center' }}>콘텐츠</span>
                </div>

                {visibleUploads.map((u, i) => {
                  const isLast = i === visibleUploads.length - 1 && hiddenUploadCount <= 0;
                  const chLabel = CHANNEL_LABELS[u.channel as keyof typeof CHANNEL_LABELS] || u.channel || '—';
                  const chDot = CHANNEL_DOT[u.channel || ''] || '#CDD2D8';
                  return (
                    <div key={`${u.participant_id}-${i}`} style={{
                      display: 'grid', gridTemplateColumns: '1.6fr 1.2fr 0.9fr 0.8fr', gap: 12,
                      height: ROW_H, alignItems: 'center',
                      borderBottom: isLast ? 'none' : `0.5px solid ${colors.borderLight}`,
                    }}>
                      <span style={{ ...CELL_CLIP, fontSize: 13, color: colors.textPrimary }}>{u.display_name}</span>
                      <span style={dotWrap}>
                        <span style={dotS(chDot)} />
                        <span style={dotTxt}>{chLabel}</span>
                      </span>
                      <span style={{ fontSize: 13, color: colors.textSecondary, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtDate(u.uploaded_at)}
                      </span>
                      <span style={{ textAlign: 'center' }}>
                        {u.published_url ? (
                          <a
                            href={u.published_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: colors.textPrimary, textDecoration: 'none', fontSize: 12, borderBottom: '1px solid #C9CED4', paddingBottom: 1 }}
                          >
                            보기
                          </a>
                        ) : (
                          <span style={{ fontSize: 12, color: colors.textSecondary }}>—</span>
                        )}
                      </span>
                    </div>
                  );
                })}

                {toggleBtn(showAllUploads, hiddenUploadCount, () => setShowAllUploads(!showAllUploads), '건')}
              </>
            )}
          </DashCard>
        </div>

        {/* ══ 4단: 이번 달 일정 — 풀폭 ══ */}
        <DashCard
          title="이번 달 일정"
          right={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => {
                const d = new Date(calY, calM - 2, 1);
                setCalMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
              }} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 15, color: colors.textSecondary, padding: '2px 6px',
                fontFamily: 'var(--font)',
              }}>&lt;</button>
              <span style={{ fontSize: 13, color: colors.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
                {calMonth}
              </span>
              <button onClick={() => {
                const d = new Date(calY, calM, 1);
                setCalMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
              }} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 15, color: colors.textSecondary, padding: '2px 6px',
                fontFamily: 'var(--font)',
              }}>&gt;</button>
            </div>
          }
        >
          {/* Day headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
            borderBottom: `0.5px solid ${colors.borderLight}`,
          }}>
            {DAY_NAMES.map(d => (
              <div key={d} style={{
                textAlign: 'center', fontSize: 13, color: colors.textSecondary,
                padding: '8px 0',
              }}>
                {d}
              </div>
            ))}
          </div>

          {/* Weeks */}
          {calGrid.map((week, wi) => (
            <div key={wi} style={{
              display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
              borderBottom: wi < calGrid.length - 1 ? `0.5px solid ${colors.borderLight}` : 'none',
            }}>
              {week.map((cell, ci) => {
                const isToday = cell.dateStr === todayStr;
                return (
                  <div key={ci} style={{
                    height: 58, padding: '3px 4px',
                    background: isToday ? colors.borderLight : 'transparent',
                    borderRight: ci < 6 ? `0.5px solid ${colors.borderLight}` : 'none',
                    overflow: 'hidden',
                  }}>
                    {cell.day !== null && (
                      <>
                        <div style={{
                          fontSize: 12, fontWeight: isToday ? 600 : 400,
                          color: isToday ? colors.textPrimary : colors.textSecondary,
                          marginBottom: 1,
                        }}>
                          {cell.day}
                        </div>
                        {(() => {
                          const grouped = new Map<string, string[]>();
                          for (const ev of cell.events) {
                            const list = grouped.get(ev.type) || [];
                            list.push(ev.title);
                            grouped.set(ev.type, list);
                          }
                          const types = [...grouped.keys()];
                          const maxShow = 3;
                          const visible = types.slice(0, maxShow);
                          const hiddenEvents = types.slice(maxShow).reduce((s, t) => s + (grouped.get(t)?.length || 0), 0);
                          return (
                            <>
                              {visible.map((type, j) => {
                                const names = grouped.get(type)!;
                                const cal = CAL_COLORS[type] || { bar: '#CDD2D8', bg: '#F4F5F7' };
                                const display = names.length > 1 ? `${names[0]} 외 ${names.length - 1}` : names[0];
                                return (
                                  <div key={j} style={{
                                    fontSize: 10, lineHeight: '14px',
                                    borderLeft: `2px solid ${cal.bar}`,
                                    background: cal.bg,
                                    padding: '0 3px',
                                    marginBottom: 1,
                                    borderRadius: 2,
                                    ...CELL_CLIP,
                                    color: colors.textPrimary,
                                  }}>
                                    {display}
                                  </div>
                                );
                              })}
                              {hiddenEvents > 0 && (
                                <div style={{ fontSize: 10, color: colors.textSecondary }}>외 {hiddenEvents}</div>
                              )}
                            </>
                          );
                        })()}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </DashCard>

        {/* Empty state */}
        {data.activeCampaigns === 0 && data.totalParticipants === 0 && allTasks.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 24px' }}>
            <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 8 }}>
              아직 캠페인이 없습니다
            </p>
            <p style={{ fontSize: 13, color: colors.textSecondary }}>
              캠페인 관리에서 첫 캠페인을 만들어보세요
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
