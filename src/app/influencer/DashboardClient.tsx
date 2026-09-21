'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { formatKRW } from '@/lib/helpers';
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
const STEP_ORDER = ['consent', 'draft', 'edit', 'upload', 'payment'] as const;
const TOTAL_STEPS = STEP_ORDER.length;
const ROW_H = 44;
const VISIBLE_COUNT = 10;
const SECTION_GAP = 24;

/* §1 — 인플루언서 현황 5-column grid */
const TABLE_GRID = 'minmax(0,120px) minmax(0,140px) minmax(0,1fr) minmax(0,80px) minmax(0,110px)';

/* §4 — 지급 예정 4-column grid */
const PAYMENT_GRID = 'minmax(0,1fr) minmax(0,120px) minmax(0,120px) minmax(0,140px)';

const COL_HDR: React.CSSProperties = {
  fontSize: 13, color: colors.textSecondary,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

const KPI_NUM: React.CSSProperties = {
  fontSize: 32, fontWeight: 700, letterSpacing: '-0.03em',
  fontVariantNumeric: 'tabular-nums',
};

/* §2 — 6-label visual stepper */
const VISUAL_LABELS = ['섭외', '동의서', '기획안', '가편집본', '업로드', '정산'] as const;
const STEP_TO_VISUAL: Record<string, number> = {
  consent: 0, draft: 2, edit: 3, upload: 4, payment: 5,
};

/* Weekly schedule grid — [3] */
const WEEK_GRID = 'minmax(0,56px) 1fr';

/* §8 — card base */
const CARD_BASE: React.CSSProperties = {
  background: colors.surface,
  border: `0.5px solid ${colors.border}`,
  borderRadius: radii.card,
  padding: '20px 24px',
};

/* §8 — text cell overflow guard for §9 layout stability */
const CELL_CLIP: React.CSSProperties = {
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

/* ── Card wrapper (dashboard-only, §8) ──────────────── */

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

/** §5 — D-day text */
function dDayText(daysUntil: number | null | undefined): string {
  if (daysUntil === null || daysUntil === undefined) return '—';
  if (daysUntil === 0) return 'D-day';
  if (daysUntil < 0) return `D+${Math.abs(daysUntil)}`;
  return `D-${daysUntil}`;
}

/** §5 — D-day style */
function dDayStyle(daysUntil: number | null | undefined): React.CSSProperties {
  if (daysUntil === null || daysUntil === undefined)
    return { color: colors.textSecondary, fontWeight: 400 };
  if (daysUntil <= 0) return { color: colors.coralDark, fontWeight: 600 };
  if (daysUntil <= 3) return { color: colors.amber, fontWeight: 600 };
  return { color: colors.textPrimary, fontWeight: 400 };
}

/** Format date as MM/DD */
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

/** §2 — step cell (6-label visual stepper with connecting lines) */
function renderStepCell(step: string) {
  const cur = STEP_TO_VISUAL[step] ?? -1;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, minWidth: 0 }}>
      {VISUAL_LABELS.map((label, i) => {
        const clr = i < cur ? colors.textSecondary
          : i === cur ? colors.seg1
          : colors.textDisabled;
        return (
          <span key={i} style={{ display: 'contents' }}>
            {i > 0 && (
              <span style={{ width: 6, height: 1, flex: 'none', background: colors.border }} />
            )}
            <span style={{ fontSize: 12, fontWeight: i === cur ? 600 : 400, color: clr, flex: 'none' }}>
              {label}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** §3 — strip "캠페인" suffix from campaign name */
function shortCampName(name: string): string {
  return name.replace(/\s*캠페인\s*$/g, '').trim();
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
  const [showAll, setShowAll] = useState(false);

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

  /* ── Calendar derived (must be before early returns — Rules of Hooks) */
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
  const visibleTasks = showAll ? sortedTasks : sortedTasks.slice(0, VISIBLE_COUNT);
  const hiddenCount = sortedTasks.length - VISIBLE_COUNT;

  const allCampaigns = data.campaigns ?? [];
  const overdueCount = allTasks.filter(t => t.is_overdue).length;
  const completedTotal = allCampaigns.reduce((s, c) => s + (c.completedCount ?? 0), 0);

  /* KPI values */
  const kpi2Sub = overdueCount === 0
    ? '지연 항목 없음'
    : allTasks.filter(t => t.is_overdue).slice(0, 3).map(t => t.display_name).join(' · ')
      + (overdueCount > 3 ? ` 외 ${overdueCount - 3}건` : '');

  /* Payment participants + upload date map */
  const paymentTasks = allTasks.filter(t => t.step === 'payment');
  const uploadDateMap = new Map<string, string>();
  for (const e of calEvents) {
    if (e.type === 'upload') uploadDateMap.set(e.participant_id, e.date);
  }
  const paymentDays = calEvents.filter(e => e.type === 'payment');
  const paymentDateLabel = paymentDays.length > 0
    ? (() => { const d = new Date(paymentDays[0].date + 'T00:00:00'); return `지급일 ${d.getMonth() + 1}/${d.getDate()}`; })()
    : '';

  /* This week's events (Mon–Sun) */
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
  const weekEvents = calEvents
    .filter(e => e.date >= weekStartStr && e.date <= weekEndStr)
    .sort((a, b) => a.date.localeCompare(b.date));
  const weekRangeLabel = `${weekStartD.getMonth() + 1}/${weekStartD.getDate()} – ${weekEndD.getMonth() + 1}/${weekEndD.getDate()}`;

  /* ── Row click navigation (§6) ──────────── */

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
      {/* §9 — responsive breakpoints */}
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

        {/* ══ 1단: KPI row (§1, §0-1) ═══════════ */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
          gap: 16, marginBottom: SECTION_GAP,
        }}>
          {/* 이번 주 마감 */}
          <div style={CARD_BASE}>
            <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 4 }}>
              이번 주 마감
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
              <span style={{ ...KPI_NUM, color: colors.textPrimary }}>
                {allTasks.length}
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
              이번 달 예정 {formatKRW(data.settlementWaitingAmount ?? 0)}
            </div>
          </div>
        </div>

        {/* ══ 2단: 인플루언서 현황 — 풀폭 (§2) ══ */}
        <div style={{ marginBottom: SECTION_GAP }}>
          <DashCard
            title="인플루언서 현황"
            summary={`진행 ${allTasks.length} · 완료 ${completedTotal}`}
          >
            {allTasks.length === 0 ? (
              <div style={{ padding: '16px 0', fontSize: 13, color: colors.textSecondary }}>
                진행 중인 인플루언서가 없습니다
              </div>
            ) : (
              <>
                {/* Column header — 5 cols */}
                <div style={{
                  display: 'grid', gridTemplateColumns: TABLE_GRID, gap: 24,
                  height: 36, alignItems: 'center',
                  borderBottom: `0.5px solid ${colors.borderLight}`,
                  minWidth: 0,
                }}>
                  <span style={COL_HDR}>인플루언서</span>
                  <span style={COL_HDR}>캠페인</span>
                  <span style={{ ...COL_HDR, textAlign: 'center' }}>단계</span>
                  <span style={{ ...COL_HDR, textAlign: 'center' }}>마감</span>
                  <span style={{ ...COL_HDR, textAlign: 'center' }}>고료</span>
                </div>

                {/* Data rows — 5 cols */}
                {visibleTasks.map((t, i) => {
                  const isLast = i === visibleTasks.length - 1 && hiddenCount <= 0;
                  const hasFee = (t.fee ?? 0) > 0;
                  return (
                    <div
                      key={`${t.participant_id}-${t.step}-${i}`}
                      onClick={() => handleRowClick(t)}
                      style={{
                        display: 'grid', gridTemplateColumns: TABLE_GRID, gap: 24,
                        height: ROW_H, alignItems: 'center',
                        borderBottom: isLast ? 'none' : `0.5px solid ${colors.borderLight}`,
                        cursor: 'pointer',
                        minWidth: 0,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = colors.surfaceHover; }}
                      onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                    >
                      <span style={{ ...CELL_CLIP, fontSize: 14, fontWeight: 600, color: colors.textPrimary }}>
                        {t.display_name}
                      </span>
                      <span style={{ ...CELL_CLIP, fontSize: 13, color: colors.textSecondary }}>
                        {shortCampName(t.campaign_name)}
                      </span>
                      {renderStepCell(t.step)}
                      <span style={{
                        fontSize: 13, textAlign: 'center',
                        fontVariantNumeric: 'tabular-nums',
                        ...dDayStyle(t.days_until),
                      }}>
                        {dDayText(t.days_until)}
                      </span>
                      <span style={{
                        fontSize: 13, textAlign: 'center',
                        fontVariantNumeric: 'tabular-nums',
                        color: hasFee ? colors.textPrimary : colors.textSecondary,
                      }}>
                        {hasFee ? formatKRW(t.fee!) : '무가'}
                      </span>
                    </div>
                  );
                })}

                {/* 더 보기 */}
                {!showAll && hiddenCount > 0 && (
                  <div style={{
                    paddingTop: 12, textAlign: 'center',
                    borderTop: `0.5px solid ${colors.borderLight}`,
                  }}>
                    <button
                      onClick={() => setShowAll(true)}
                      style={{
                        background: 'none', border: 'none',
                        color: colors.textSecondary, fontSize: 13, fontWeight: 500,
                        cursor: 'pointer', fontFamily: 'var(--font)',
                      }}
                    >
                      더 보기 ({hiddenCount}명)
                    </button>
                  </div>
                )}
              </>
            )}
          </DashCard>
        </div>

        {/* ══ 3단: 지급 예정 / 이번 주 일정 (1fr 1fr) ══ */}
        <div className="dash-row2" style={{ marginBottom: SECTION_GAP }}>
          {/* ── 이번 달 지급 예정 ────────────── */}
          <DashCard title="이번 달 지급 예정" summary={paymentDateLabel}>
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
                  <span style={{ ...COL_HDR, textAlign: 'center' }}>금액</span>
                </div>
                {paymentTasks.map((t, i) => {
                  const isLast = i === paymentTasks.length - 1;
                  const upDate = uploadDateMap.get(t.participant_id);
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
                        {fmtDate(t.scheduled_date)}
                      </span>
                      <span style={{ fontSize: 13, color: colors.textPrimary, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                        {formatKRW(t.fee ?? 0)}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </DashCard>

          {/* ── 이번 주 일정 [3] ────────────── */}
          <DashCard
            title="이번 주 일정"
            right={<span style={{ fontSize: 13, color: colors.textSecondary, fontVariantNumeric: 'tabular-nums' }}>{weekRangeLabel}</span>}
          >
            {weekEvents.length === 0 ? (
              <div style={{ padding: '16px 0', fontSize: 13, color: colors.textSecondary }}>
                이번 주 일정 없음
              </div>
            ) : (() => {
              const WEEK_TYPE_COLORS: Record<string, { bar: string; bg: string; text: string }> = {
                draft:   { bar: '#7BAEDB', bg: '#E8F2FB', text: '#2E5A80' },
                edit:    { bar: '#6BC0AC', bg: '#E4F5F0', text: '#2A6B5C' },
                upload:  { bar: '#4A7DB5', bg: '#E6EEF9', text: '#244C77' },
                payment: { bar: colors.mint, bg: '#E6F5ED', text: '#2A6B4A' },
                custom:  { bar: '#9AA2AA', bg: '#F1F3F6', text: '#4A4F55' },
              };
              const grouped = new Map<string, typeof weekEvents>();
              for (const ev of weekEvents) {
                const list = grouped.get(ev.date) || [];
                list.push(ev);
                grouped.set(ev.date, list);
              }
              const sortedDates = [...grouped.keys()].sort();
              return (
                <div>
                  {sortedDates.map((dateKey, di) => {
                    const evs = grouped.get(dateKey)!;
                    const evD = new Date(dateKey + 'T00:00:00');
                    const diff = Math.round((evD.getTime() - todayD.getTime()) / 86400000);
                    const isToday = diff === 0;
                    return (
                      <div key={dateKey} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 12,
                        padding: '8px 0',
                        borderBottom: di < sortedDates.length - 1 ? `0.5px solid ${colors.borderLight}` : 'none',
                      }}>
                        <span style={{
                          fontSize: 13, color: isToday ? colors.textPrimary : colors.textSecondary,
                          fontWeight: isToday ? 600 : 400,
                          fontVariantNumeric: 'tabular-nums',
                          minWidth: 56, flexShrink: 0,
                          lineHeight: '26px',
                        }}>
                          {DAY_NAMES[evD.getDay()]} {evD.getMonth() + 1}/{evD.getDate()}
                        </span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1, minWidth: 0 }}>
                          {evs.map((ev, j) => {
                            const wtc = WEEK_TYPE_COLORS[ev.type] || WEEK_TYPE_COLORS.custom;
                            const isOverdue = diff <= 0 && ev.type !== 'payment';
                            const barColor = isOverdue ? '#E85D4A' : wtc.bar;
                            const bgColor = isOverdue ? '#FFF0EE' : wtc.bg;
                            const textColor = isOverdue ? '#C0392B' : wtc.text;
                            return (
                              <span key={`${ev.id}-${j}`} style={{
                                fontSize: 12, fontWeight: isOverdue ? 600 : 400,
                                borderLeft: `3px solid ${barColor}`,
                                background: bgColor,
                                color: textColor,
                                borderRadius: 4,
                                padding: '2px 8px 2px 6px',
                                lineHeight: '22px',
                                whiteSpace: 'nowrap',
                                opacity: ev.is_completed ? 0.55 : 1,
                              }}>
                                {ev.title} · {STEP_LABELS[ev.type] || ev.type}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </DashCard>
        </div>

        {/* ══ 4단: 이번 달 일정 — 풀폭 (§1) ═══════ */}
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
                            지급일 · {paymentEvents.length}건
                          </div>
                        )}
                        {normalEvents.slice(0, isPaymentDay ? 2 : 3).map((ev, j) => {
                          const CAL_TYPE_COLORS: Record<string, { bar: string; bg: string; text: string }> = {
                            draft:  { bar: '#7BAEDB', bg: '#E8F2FB', text: '#2E5A80' },
                            edit:   { bar: '#6BC0AC', bg: '#E4F5F0', text: '#2A6B5C' },
                            upload: { bar: '#4A7DB5', bg: '#E6EEF9', text: '#244C77' },
                            custom: { bar: '#9AA2AA', bg: '#F1F3F6', text: '#4A4F55' },
                          };
                          const tc = CAL_TYPE_COLORS[ev.type] || CAL_TYPE_COLORS.custom;
                          const barColor = ev.is_overdue ? '#E85D4A' : tc.bar;
                          const bgColor = ev.is_overdue ? '#FFF0EE' : tc.bg;
                          const textColor = ev.is_overdue ? '#C0392B' : tc.text;
                          const borderStyle = ev.is_confirmed === false ? 'dashed' : 'solid';
                          return (
                            <div key={j} style={{
                              fontSize: 12, lineHeight: '20px',
                              borderLeft: `3px ${borderStyle} ${barColor}`,
                              background: bgColor,
                              color: textColor,
                              borderRadius: 4,
                              paddingLeft: 5, paddingRight: 4,
                              marginBottom: 1,
                              opacity: ev.is_completed ? 0.55 : 1,
                              ...CELL_CLIP,
                            }}>
                              {ev.title} · {STEP_LABELS[ev.type] || ev.type}
                            </div>
                          );
                        })}
                        {normalEvents.length > (isPaymentDay ? 2 : 3) && (
                          <div style={{ fontSize: 12, color: colors.textSecondary }}>
                            +{normalEvents.length - (isPaymentDay ? 2 : 3)}
                          </div>
                        )}
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
