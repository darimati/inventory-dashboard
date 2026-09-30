'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { formatKRW } from '@/lib/helpers';
import { isPaidCollab, formatCampaignName } from '@/lib/types/influencer';
import type { DashboardData, WeeklyTaskItem } from '@/lib/types/influencer';
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
const ROW_H = 44;
const VISIBLE_COUNT = 10;
const SECTION_GAP = 24;

/* 유가 6-column grid: 인플루언서|채널|캠페인|단계|마감|고료 */
const PAID_GRID = '1.4fr 0.8fr 1.6fr 0.9fr 0.7fr 1fr';

/* 무가 5-column grid: 인플루언서|채널|캠페인|단계|마감 */
const FREE_GRID = '1.6fr 0.9fr 1.8fr 1fr 0.8fr';

/* 지급 예정 4-column grid */
const PAYMENT_GRID = 'minmax(0,1fr) minmax(0,120px) minmax(0,120px) minmax(0,140px)';

const COL_HDR: React.CSSProperties = {
  fontSize: 13, color: colors.textSecondary,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

const KPI_NUM: React.CSSProperties = {
  fontSize: 32, fontWeight: 700, letterSpacing: '-0.03em',
  fontVariantNumeric: 'tabular-nums',
};

/* card base */
const CARD_BASE: React.CSSProperties = {
  background: colors.surface,
  border: `0.5px solid ${colors.border}`,
  borderRadius: radii.card,
  padding: '20px 24px',
};

/* text cell overflow guard */
const CELL_CLIP: React.CSSProperties = {
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

/* ── Card wrapper ──────────────────────────────────── */

function DashCard({ title, summary, right, children, style }: {
  title: string;
  summary?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ ...CARD_BASE, minHeight: 120, ...style }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr auto',
        alignItems: 'baseline', marginBottom: 16,
      }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: colors.textPrimary }}>
          {title}
        </span>
        {summary != null && (
          <span style={{ fontSize: 13, color: colors.textSecondary }}>{summary}</span>
        )}
        {right}
      </div>
      {children}
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────── */

/** D-day text */
function dDayText(daysUntil: number | null | undefined): string {
  if (daysUntil === null || daysUntil === undefined) return '—';
  if (daysUntil === 0) return 'D-day';
  if (daysUntil < 0) return `D+${Math.abs(daysUntil)}`;
  return `D-${daysUntil}`;
}

/** D-day style — urgency-based colors only
 *  무가: 주황(amber) 까지만, 빨강 없음
 *  유가: 지연/D-day만 빨강, D-1~3은 주황
 *  fontWeight: 항상 400 */
function dDayStyle(daysUntil: number | null | undefined, isPaid = true): React.CSSProperties {
  if (daysUntil === null || daysUntil === undefined)
    return { color: colors.textSecondary, fontWeight: 400 };
  if (daysUntil <= 0) return { color: isPaid ? colors.coralDark : colors.amber, fontWeight: 400 };
  if (daysUntil <= 3) return { color: colors.amber, fontWeight: 400 };
  return { color: colors.textPrimary, fontWeight: 400 };
}

/** Format date as MM/DD — handles both YYYY-MM-DD and ISO datetime */
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const dateStr = d.includes('T') ? d.slice(0, 10) : d;
  const dt = new Date(dateStr + 'T00:00:00');
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

/** Fallback payment date: upload ≤15th → same month 15, >15th → next month 15 */
function calcFallbackPaymentDate(uploadedAt: string | null | undefined): string | null {
  if (!uploadedAt) return null;
  const d = new Date(uploadedAt);
  if (isNaN(d.getTime())) return null;
  const day = d.getDate();
  if (day <= 15) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`;
  }
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 15);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-15`;
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
  const [showAllPaid, setShowAllPaid] = useState(false);
  const [showAllFree, setShowAllFree] = useState(false);

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

  /* ── Calendar derived (before early returns — Rules of Hooks) */
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
  const sortedTasks = [...allTasks].sort((a, b) => {
    if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1;
    return (a.days_until ?? 999) - (b.days_until ?? 999);
  });

  /* Split into paid / free */
  const paidTasks = sortedTasks.filter(t => isPaidCollab(t.collab_type));
  const freeTasks = sortedTasks.filter(t => !isPaidCollab(t.collab_type));

  const visiblePaidTasks = showAllPaid ? paidTasks : paidTasks.slice(0, VISIBLE_COUNT);
  const hiddenPaidCount = paidTasks.length - VISIBLE_COUNT;
  const visibleFreeTasks = showAllFree ? freeTasks : freeTasks.slice(0, VISIBLE_COUNT);
  const hiddenFreeCount = freeTasks.length - VISIBLE_COUNT;

  const overdueCount = allTasks.filter(t => t.is_overdue).length;

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

  /* KPI "이번 주 마감" — this week only */
  const thisWeekTasks = allTasks.filter(t =>
    t.scheduled_date && t.scheduled_date >= weekStartStr && t.scheduled_date <= weekEndStr
  );

  /* KPI "지연" sub-text: "유가 n건, 무가 n건" */
  const paidOverdue = allTasks.filter(t => t.is_overdue && isPaidCollab(t.collab_type)).length;
  const freeOverdue = allTasks.filter(t => t.is_overdue && !isPaidCollab(t.collab_type)).length;
  const kpi2Sub = overdueCount === 0
    ? '지연 항목 없음'
    : `유가 ${paidOverdue}건, 무가 ${freeOverdue}건`;

  /* Payment tasks + upload date map */
  const paymentTasks = allTasks.filter(t => t.step === 'payment');
  const uploadDateMap = new Map<string, string>();
  for (const e of calEvents) {
    if (e.type === 'upload') uploadDateMap.set(e.participant_id, e.date);
  }
  const paymentDays = calEvents.filter(e => e.type === 'payment');
  const paymentDateLabel = paymentDays.length > 0
    ? (() => { const d = new Date(paymentDays[0].date + 'T00:00:00'); return `지급일 ${d.getMonth() + 1}/${d.getDate()}`; })()
    : '';

  /* ── Row click navigation ──────────── */

  function handleRowClick(t: WeeklyTaskItem) {
    if (t.step === 'payment') {
      router.push('/influencer/settlements');
    } else {
      router.push(`/influencer/manage?campaign=${t.campaign_id}&open=${t.participant_id}`);
    }
  }

  /* ── Render ─────────────────────────────── */

  return (
    <AppShell showFilter={false}>
      <style>{`
        .dash-row2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          align-items: stretch;
        }
        @media (max-width: 860px) {
          .dash-row2 {
            grid-template-columns: 1fr;
          }
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
          gap: 16, marginBottom: SECTION_GAP,
        }}>
          {/* 이번 주 마감 — this week dates only */}
          <div style={CARD_BASE}>
            <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 4 }}>
              이번 주 마감
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
              <span style={{ ...KPI_NUM, color: colors.textPrimary }}>
                {thisWeekTasks.length}
              </span>
              <span style={{ fontSize: 13, color: colors.textSecondary }}>건</span>
            </div>
          </div>

          {/* 지연 */}
          <div style={CARD_BASE}>
            <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 4 }}>
              지연
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
              <span style={{
                ...KPI_NUM,
                color: overdueCount > 0 ? colors.coralDark : colors.textPrimary,
              }}>
                {overdueCount}
              </span>
              <span style={{ fontSize: 13, color: colors.textSecondary }}>건</span>
            </div>
            <div style={{ fontSize: 13, color: colors.textSecondary }}>{kpi2Sub}</div>
          </div>

          {/* 누적 지급액 */}
          <div style={CARD_BASE}>
            <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 4 }}>
              누적 지급액
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
              <span style={{ ...KPI_NUM, color: colors.textPrimary }}>
                {new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(Math.round(data.annualPaidAmount ?? 0))}
              </span>
              <span style={{ fontSize: 13, color: colors.textSecondary }}>원</span>
            </div>
            <div style={{ fontSize: 13, color: colors.textSecondary }}>
              미지급 합계 {formatKRW(data.settlementWaitingAmount ?? 0)}
            </div>
          </div>
        </div>

        {/* ══ 2단: 지급 예정 / 이번 주 일정 (1fr 1fr, align-items: start) ══ */}
        <div className="dash-row2" style={{ marginBottom: SECTION_GAP }}>
          {/* ── 지급 예정 ────────────── */}
          <DashCard title="지급 예정" summary={paymentDateLabel}>
            {paymentTasks.length === 0 ? (
              <div style={{ padding: '16px 0', fontSize: 13, color: colors.textSecondary }}>
                지급 예정 인플루언서가 없습니다
              </div>
            ) : (
              <>
                <div style={{
                  display: 'grid', gridTemplateColumns: PAYMENT_GRID, gap: 24,
                  height: 36, alignItems: 'center',
                  borderBottom: `0.5px solid ${colors.borderLight}`,
                  minWidth: 0,
                }}>
                  <span style={COL_HDR}>인플루언서</span>
                  <span style={{ ...COL_HDR, textAlign: 'center' }}>업로드일</span>
                  <span style={{ ...COL_HDR, textAlign: 'center' }}>지급일</span>
                  <span style={{ ...COL_HDR, textAlign: 'right' }}>금액</span>
                </div>
                {paymentTasks.map((t, i) => {
                  const isLast = i === paymentTasks.length - 1;
                  const upDate = uploadDateMap.get(t.participant_id) || t.uploaded_at || null;
                  const payDate = t.scheduled_date || calcFallbackPaymentDate(upDate);
                  return (
                    <div key={t.participant_id} style={{
                      display: 'grid', gridTemplateColumns: PAYMENT_GRID, gap: 24,
                      height: ROW_H, alignItems: 'center',
                      borderBottom: isLast ? 'none' : `0.5px solid ${colors.borderLight}`,
                      minWidth: 0,
                    }}>
                      <span style={{ ...CELL_CLIP, fontSize: 13, color: colors.textPrimary }}>
                        {t.display_name}
                      </span>
                      <span style={{ fontSize: 13, color: colors.textSecondary, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtDate(upDate)}
                      </span>
                      <span style={{ fontSize: 13, color: colors.textPrimary, textAlign: 'center', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtDate(payDate)}
                      </span>
                      <span style={{ fontSize: 13, color: colors.textPrimary, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {formatKRW(t.fee ?? 0)}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </DashCard>

          {/* ── 업로드 일정 ────────────── */}
          <DashCard
            title="업로드 일정"
            right={<span style={{ fontSize: 13, color: colors.textSecondary, fontVariantNumeric: 'tabular-nums' }}>{weekStartD.getMonth() + 1}/{weekStartD.getDate()} – {weekEndD.getMonth() + 1}/{weekEndD.getDate()}</span>}
          >
            {(() => {
              const uploadEvents = calEvents
                .filter(e => e.type === 'upload' && !e.is_completed && e.date >= weekStartStr && e.date <= weekEndStr)
                .sort((a, b) => a.date.localeCompare(b.date));
              if (uploadEvents.length === 0) {
                return (
                  <div style={{ padding: '16px 0', fontSize: 13, color: colors.textSecondary }}>
                    이번 주 업로드 일정 없음
                  </div>
                );
              }
              const byDate = new Map<string, string[]>();
              for (const ev of uploadEvents) {
                const list = byDate.get(ev.date) || [];
                list.push(ev.title);
                byDate.set(ev.date, list);
              }
              const dates = [...byDate.keys()].sort();
              return (
                <div>
                  {dates.map((dateKey, i) => {
                    const evD = new Date(dateKey + 'T00:00:00');
                    const dateLabel = `${evD.getMonth() + 1}/${evD.getDate()}(${DAY_NAMES[evD.getDay()]})`;
                    const names = byDate.get(dateKey)!;
                    const isLast = i === dates.length - 1;
                    return (
                      <div key={dateKey} style={{
                        display: 'grid', gridTemplateColumns: '0.8fr 3fr',
                        gap: 14, height: 38, alignItems: 'center',
                        borderBottom: isLast ? 'none' : `0.5px solid ${colors.borderLight}`,
                      }}>
                        <span style={{
                          fontSize: 13, color: colors.textSecondary,
                          fontVariantNumeric: 'tabular-nums',
                        }}>
                          {dateLabel}
                        </span>
                        <span style={{ ...CELL_CLIP, fontSize: 13, color: colors.textPrimary }}>
                          {names.join(', ')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </DashCard>
        </div>

        {/* ══ 3단: 유가 현황 — 풀폭 ══ */}
        <div style={{ marginBottom: SECTION_GAP }}>
          <DashCard
            title="유가 현황"
            right={
              <span style={{ fontSize: 13, color: colors.textSecondary }}>
                진행 {paidTasks.length}건
              </span>
            }
          >
            {paidTasks.length === 0 ? (
              <div style={{ padding: '16px 0', fontSize: 13, color: colors.textSecondary }}>
                진행 중인 유가 인플루언서가 없습니다
              </div>
            ) : (
              <>
                {/* Column header — 6 cols */}
                <div style={{
                  display: 'grid', gridTemplateColumns: PAID_GRID, gap: 12,
                  height: 36, alignItems: 'center',
                  borderBottom: `0.5px solid ${colors.borderLight}`,
                  minWidth: 0,
                }}>
                  <span style={COL_HDR}>인플루언서</span>
                  <span style={COL_HDR}>채널</span>
                  <span style={COL_HDR}>캠페인</span>
                  <span style={COL_HDR}>단계</span>
                  <span style={{ ...COL_HDR, textAlign: 'center' }}>마감</span>
                  <span style={{ ...COL_HDR, textAlign: 'right' }}>고료</span>
                </div>

                {/* Data rows */}
                {visiblePaidTasks.map((t, i) => {
                  const isLast = i === visiblePaidTasks.length - 1 && hiddenPaidCount <= 0;
                  return (
                    <div
                      key={`${t.participant_id}-${t.step}-${i}`}
                      onClick={() => handleRowClick(t)}
                      style={{
                        display: 'grid', gridTemplateColumns: PAID_GRID, gap: 12,
                        height: ROW_H, alignItems: 'center',
                        borderBottom: isLast ? 'none' : `0.5px solid ${colors.borderLight}`,
                        cursor: 'pointer', minWidth: 0,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = colors.surfaceHover; }}
                      onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                    >
                      <span style={{ ...CELL_CLIP, fontSize: 14, fontWeight: 400, color: colors.textPrimary }}>
                        {t.display_name}
                      </span>
                      <span style={{ ...CELL_CLIP, fontSize: 12, color: colors.textSecondary }}>
                        {t.campaign_channel}
                      </span>
                      <span style={{ ...CELL_CLIP, fontSize: 13, color: colors.textSecondary }}>
                        {formatCampaignName(t.campaign_name)}
                      </span>
                      <span style={{ ...CELL_CLIP, fontSize: 12, fontWeight: 400, color: colors.textSecondary }}>
                        {STEP_LABELS[t.step] || t.step}
                      </span>
                      <span style={{
                        fontSize: 13, textAlign: 'center',
                        fontVariantNumeric: 'tabular-nums',
                        ...dDayStyle(t.days_until),
                      }}>
                        {dDayText(t.days_until)}
                      </span>
                      <span style={{
                        fontSize: 13, textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        color: colors.textPrimary,
                      }}>
                        {formatKRW(t.fee ?? 0)}
                      </span>
                    </div>
                  );
                })}

                {/* 더 보기 / 접기 */}
                {hiddenPaidCount > 0 && (
                  <div style={{
                    paddingTop: 12, textAlign: 'center',
                    borderTop: `0.5px solid ${colors.borderLight}`,
                  }}>
                    <button
                      onClick={() => setShowAllPaid(!showAllPaid)}
                      style={{
                        background: 'none', border: 'none',
                        color: colors.textSecondary, fontSize: 13, fontWeight: 500,
                        cursor: 'pointer', fontFamily: 'var(--font)',
                      }}
                    >
                      {showAllPaid ? '접기' : `더 보기 (${hiddenPaidCount}명)`}
                    </button>
                  </div>
                )}
              </>
            )}
          </DashCard>
        </div>

        {/* ══ 4단: 무가 현황 — 풀폭 ══ */}
        <div style={{ marginBottom: SECTION_GAP }}>
          <DashCard
            title="무가 현황"
            right={
              <span style={{ fontSize: 13, color: colors.textSecondary }}>
                진행 {freeTasks.length}건
              </span>
            }
          >
            {freeTasks.length === 0 ? (
              <div style={{ padding: '16px 0', fontSize: 13, color: colors.textSecondary }}>
                진행 중인 무가 인플루언서가 없습니다
              </div>
            ) : (
              <>
                {/* Column header — 5 cols */}
                <div style={{
                  display: 'grid', gridTemplateColumns: FREE_GRID, gap: 12,
                  height: 36, alignItems: 'center',
                  borderBottom: `0.5px solid ${colors.borderLight}`,
                  minWidth: 0,
                }}>
                  <span style={COL_HDR}>인플루언서</span>
                  <span style={COL_HDR}>채널</span>
                  <span style={COL_HDR}>캠페인</span>
                  <span style={COL_HDR}>단계</span>
                  <span style={{ ...COL_HDR, textAlign: 'center' }}>마감</span>
                </div>

                {/* Data rows */}
                {visibleFreeTasks.map((t, i) => {
                  const isLast = i === visibleFreeTasks.length - 1 && hiddenFreeCount <= 0;
                  return (
                    <div
                      key={`${t.participant_id}-${t.step}-${i}`}
                      onClick={() => handleRowClick(t)}
                      style={{
                        display: 'grid', gridTemplateColumns: FREE_GRID, gap: 12,
                        height: ROW_H, alignItems: 'center',
                        borderBottom: isLast ? 'none' : `0.5px solid ${colors.borderLight}`,
                        cursor: 'pointer', minWidth: 0,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = colors.surfaceHover; }}
                      onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                    >
                      <span style={{ ...CELL_CLIP, fontSize: 14, fontWeight: 400, color: colors.textPrimary }}>
                        {t.display_name}
                      </span>
                      <span style={{ ...CELL_CLIP, fontSize: 12, color: colors.textSecondary }}>
                        {t.campaign_channel}
                      </span>
                      <span style={{ ...CELL_CLIP, fontSize: 13, color: colors.textSecondary }}>
                        {formatCampaignName(t.campaign_name)}
                      </span>
                      <span style={{ ...CELL_CLIP, fontSize: 12, fontWeight: 400, color: colors.textSecondary }}>
                        {STEP_LABELS[t.step] || t.step}
                      </span>
                      <span style={{
                        fontSize: 13, textAlign: 'center',
                        fontVariantNumeric: 'tabular-nums',
                        ...dDayStyle(t.days_until, false),
                      }}>
                        {dDayText(t.days_until)}
                      </span>
                    </div>
                  );
                })}

                {/* 더 보기 / 접기 */}
                {hiddenFreeCount > 0 && (
                  <div style={{
                    paddingTop: 12, textAlign: 'center',
                    borderTop: `0.5px solid ${colors.borderLight}`,
                  }}>
                    <button
                      onClick={() => setShowAllFree(!showAllFree)}
                      style={{
                        background: 'none', border: 'none',
                        color: colors.textSecondary, fontSize: 13, fontWeight: 500,
                        cursor: 'pointer', fontFamily: 'var(--font)',
                      }}
                    >
                      {showAllFree ? '접기' : `더 보기 (${hiddenFreeCount}명)`}
                    </button>
                  </div>
                )}
              </>
            )}
          </DashCard>
        </div>

        {/* ══ 5단: 이번 달 일정 — 풀폭 ══ */}
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
                const isPaymentDay = cell.events.some(e => e.type === 'payment');
                const normalEvents = cell.events.filter(e => e.type !== 'payment');
                const paymentEvents = cell.events.filter(e => e.type === 'payment');
                return (
                  <div key={ci} style={{
                    height: 88, padding: '4px 6px',
                    background: isToday ? colors.borderLight : 'transparent',
                    borderRight: ci < 6 ? `0.5px solid ${colors.borderLight}` : 'none',
                    overflow: 'hidden',
                  }}>
                    {cell.day !== null && (
                      <>
                        <div style={{
                          fontSize: 13, fontWeight: isToday ? 600 : 400,
                          color: isToday ? colors.textPrimary : colors.textSecondary,
                          marginBottom: 2,
                        }}>
                          {cell.day}
                        </div>
                        {isPaymentDay && (
                          <div style={{
                            fontSize: 12, lineHeight: '16px', color: colors.mint,
                            ...CELL_CLIP,
                          }}>
                            지급일 {paymentEvents.length}건
                          </div>
                        )}
                        {(() => {
                          const stepOrder = ['draft', 'edit', 'upload', 'payment'];
                          const grouped = new Map<string, string[]>();
                          for (const ev of normalEvents) {
                            const list = grouped.get(ev.type) || [];
                            list.push(ev.title);
                            grouped.set(ev.type, list);
                          }
                          const sortedTypes = stepOrder.filter(s => grouped.has(s));
                          for (const key of grouped.keys()) {
                            if (!sortedTypes.includes(key)) sortedTypes.push(key);
                          }
                          const maxLines = isPaymentDay ? 2 : 3;
                          const visibleTypes = sortedTypes.slice(0, maxLines);
                          const hiddenCount = sortedTypes.length > maxLines
                            ? sortedTypes.slice(maxLines).reduce((s, t) => s + (grouped.get(t)?.length || 0), 0)
                            : 0;
                          return (
                            <>
                              {visibleTypes.map((type, j) => {
                                const names = grouped.get(type)!;
                                const display = names.length > 2
                                  ? `${names.slice(0, 2).join(', ')} 외 ${names.length - 2}`
                                  : names.join(', ');
                                return (
                                  <div key={j} style={{ lineHeight: '18px', ...CELL_CLIP }}>
                                    <span style={{ fontSize: 11, color: colors.textSecondary }}>{STEP_LABELS[type] || type}</span>
                                    <span style={{ fontSize: 11, color: colors.textPrimary, marginLeft: 6 }}>{display}</span>
                                  </div>
                                );
                              })}
                              {hiddenCount > 0 && (
                                <div style={{ fontSize: 11, color: colors.textSecondary }}>+{hiddenCount}</div>
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
