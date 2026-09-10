'use client';

import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/AppShell';
import CustomSelect from '@/components/CustomSelect';
import { formatKRW } from '@/lib/helpers';
import { CHANNEL_LABELS } from '@/lib/types/influencer';
import type { DashboardData, WeeklyTaskItem, WeeklyStep } from '@/lib/types/influencer';
import { formatDDay, getDDayStyle, NO_SCHEDULE_STYLE } from '@/lib/dday';
import { colors, typo, spacing, radii, STEP_LABELS } from '@/lib/influencer/styles';
import { KPICard, Card, Section, TabBar, Chip, Btn, Toast, ProgressBar, Empty } from '@/lib/influencer/ui';

/* ── Constants ───────────────────────────────────────── */

const STEP_FILTER_TABS: Array<{ key: string; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'consent', label: '섭외' },
  { key: 'draft', label: '기획안' },
  { key: 'edit', label: '가편집본' },
  { key: 'upload', label: '업로드' },
  { key: 'payment', label: '정산' },
];

const STEP_BTN_LABELS: Record<string, string> = {
  draft: '기획안 받음',
  edit: '가편집본 받음',
  upload: '업로드 확인',
  payment: '지급 완료',
};

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, '0')}(${DAY_NAMES[d.getDay()]})`;
}

function getStatusDisplay(t: WeeklyTaskItem): { text: string; color: string; weight: number } {
  if (t.days_until === null || t.days_until === undefined) return { ...NO_SCHEDULE_STYLE };
  return { text: formatDDay(t.days_until), ...getDDayStyle(t.days_until) };
}

/* ── Table styles ────────────────────────────────────── */

const thStyle: React.CSSProperties = {
  padding: `0 ${spacing.tableCellPx}px`,
  height: 40,
  textAlign: 'left',
  ...typo.tableHeader,
  borderBottom: `1px solid ${colors.border}`,
  verticalAlign: 'middle',
};

const tdStyle: React.CSSProperties = {
  padding: `0 ${spacing.tableCellPx}px`,
  height: spacing.tableRowH,
  ...typo.tableBody,
  borderBottom: `1px solid ${colors.borderLight}`,
  verticalAlign: 'middle',
};

/* ── Receive Modal Types ─────────────────────────────── */

interface ReceiveModal {
  item: WeeklyTaskItem;
  link: string;
  receivedDate: string;
  memo: string;
  processType: 'approved' | 'revision_requested';
  revisionNote: string;
  noLink: boolean;
  saving: boolean;
  error: string | null;
}

/* ══════════════════════════════════════════════════════ */

export default function InfluencerDashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [stepFilter, setStepFilter] = useState('all');
  const [undoToast, setUndoToast] = useState<{ id: string; step: string; name: string } | null>(null);
  const [undoTimer, setUndoTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [modal, setModal] = useState<ReceiveModal | null>(null);

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

  /* ── Handlers ───────────────────────────── */

  function handleCheckStep(item: WeeklyTaskItem) {
    if (item.step === 'draft' || item.step === 'edit' || item.step === 'upload') {
      const kstNow = new Date(Date.now() + 9 * 3600000);
      const dateStr = item.step === 'upload'
        ? kstNow.toISOString().slice(0, 16)
        : kstNow.toISOString().slice(0, 10);
      setModal({
        item, link: '', receivedDate: dateStr, memo: '',
        processType: 'approved', revisionNote: '',
        noLink: false, saving: false, error: null,
      });
    }
  }

  async function handleSaveDeliverable() {
    if (!modal) return;
    const { item, link, receivedDate, memo, processType, revisionNote, noLink } = modal;

    const linkRequired = item.step === 'upload' || !noLink;
    if (linkRequired) {
      if (!link.trim()) {
        setModal({ ...modal, error: item.step === 'upload' ? '업로드 링크를 입력해주세요' : '링크를 입력하거나 "링크 없이 확인함"을 체크해주세요' });
        return;
      }
      try { new URL(link.trim()); } catch {
        setModal({ ...modal, error: '올바른 URL을 입력해주세요' });
        return;
      }
    }

    if (item.step !== 'upload' && processType === 'revision_requested' && !revisionNote.trim()) {
      setModal({ ...modal, error: '수정 요청 사항을 입력해주세요' });
      return;
    }

    setModal({ ...modal, saving: true, error: null });

    try {
      const res = await fetch('/api/influencer/participants/check-step', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participant_id: item.participant_id,
          step: item.step,
          link: (item.step === 'upload' || !noLink) ? link.trim() : undefined,
          memo: item.step !== 'upload' ? (memo.trim() || undefined) : undefined,
          received_at: receivedDate ? new Date(
            item.step === 'upload' ? receivedDate + ':00+09:00' : receivedDate + 'T00:00:00+09:00'
          ).toISOString() : undefined,
          status: item.step === 'upload' ? 'approved' : processType,
          revision_note: item.step !== 'upload' && processType === 'revision_requested' ? revisionNote.trim() : undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '알 수 없는 오류' }));
        setModal({ ...modal, saving: false, error: err.error || '저장에 실패했습니다' });
        return;
      }

      const isRevision = processType === 'revision_requested';
      setModal(null);

      if (isRevision) {
        setData(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            weeklyTasks: prev.weeklyTasks.map(t =>
              t.participant_id === item.participant_id && t.step === item.step
                ? { ...t, deliverable_status: 'revision_requested', deliverable_version: (t.deliverable_version || 0) + 1 }
                : t
            ),
          };
        });
        showToast(item.participant_id, item.step, '_revision_');
      } else {
        setData(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            weeklyTasks: prev.weeklyTasks.filter(t =>
              !(t.participant_id === item.participant_id && t.step === item.step)
            ),
            weeklyTaskSummary: prev.weeklyTaskSummary.map(s =>
              s.step === item.step ? { ...s, count: Math.max(0, s.count - 1) } : s
            ),
          };
        });
        showToast(item.participant_id, item.step, item.display_name);
      }
    } catch {
      setModal({ ...modal, saving: false, error: '네트워크 오류입니다' });
    }
  }

  async function handlePaymentComplete(item: WeeklyTaskItem) {
    if (!confirm(`${item.display_name}님의 지급을 완료 처리하시겠습니까?`)) return;
    try {
      const settlementsRes = await fetch('/api/influencer/settlements');
      const settlements = await settlementsRes.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const settlement = Array.isArray(settlements)
        ? settlements.find((s: any) => s.participant_id === item.participant_id)
        : null;

      if (settlement) {
        await fetch('/api/influencer/settlements', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: settlement.id, payment_status: 'paid' }),
        });
      } else {
        await fetch('/api/influencer/participants', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.participant_id, settlement_status: 'paid' }),
        });
      }

      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          weeklyTasks: prev.weeklyTasks.filter(t =>
            !(t.participant_id === item.participant_id && t.step === item.step)
          ),
          weeklyTaskSummary: prev.weeklyTaskSummary.map(s =>
            s.step === 'payment' ? { ...s, count: Math.max(0, s.count - 1) } : s
          ),
        };
      });
    } catch {
      alert('처리 중 오류가 발생했습니다.');
    }
  }

  function showToast(id: string, step: string, name: string) {
    if (undoTimer) clearTimeout(undoTimer);
    setUndoToast({ id, step, name });
    const timer = setTimeout(() => setUndoToast(null), name === '_revision_' ? 5000 : 8000);
    setUndoTimer(timer);
  }

  async function handleUndo() {
    if (!undoToast) return;
    if (undoTimer) clearTimeout(undoTimer);
    await fetch('/api/influencer/participants/check-step', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participant_id: undoToast.id, step: undoToast.step, undo: true }),
    });
    setUndoToast(null);
    refreshData();
  }

  /* ── Loading ────────────────────────────── */

  if (loading) {
    return (
      <AppShell showFilter={false}>
        <p style={{ color: colors.textMuted, padding: '40px 0' }}>로딩 중...</p>
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
  const dueThisWeek = allTasks.filter(t =>
    t.scheduled_date && t.days_until !== null && t.days_until >= 0 && t.days_until <= 7,
  ).length;
  const blockedCount = allTasks.filter(t => t.is_overdue).length;
  const budgetPct = data.monthlyBudget > 0
    ? Math.round((data.monthlyContractTotal / data.monthlyBudget) * 100) : 0;

  const allCampaigns = data.campaigns ?? [];
  const campaignOptions = [
    { value: 'all', label: '전체 캠페인' },
    ...allCampaigns.map(c => ({ value: c.id, label: c.name })),
  ];
  const filteredCampaigns = campaignFilter === 'all'
    ? allCampaigns
    : allCampaigns.filter(c => c.id === campaignFilter);

  const stepTabs = STEP_FILTER_TABS.map(tab => ({
    ...tab,
    count: tab.key === 'all'
      ? allTasks.length
      : allTasks.filter(t => t.step === tab.key).length,
  }));

  const filteredTasks = stepFilter === 'all'
    ? allTasks
    : allTasks.filter(t => t.step === stepFilter);

  /* ── Render ─────────────────────────────── */

  return (
    <AppShell showFilter={false}>
      <div>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', marginBottom: spacing.gap,
        }}>
          <h1 style={{ ...typo.pageTitle, margin: 0 }}>인플루언서 운영</h1>
          {allCampaigns.length > 1 && (
            <CustomSelect
              value={campaignFilter}
              options={campaignOptions}
              onChange={setCampaignFilter}
              size="md"
            />
          )}
        </div>

        {/* 4 KPI Cards */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
          gap: spacing.gap - 2, marginBottom: spacing.gap,
        }}>
          <KPICard
            label="이번 주 마감"
            value={dueThisWeek}
            unit="건"
            sub={`전체 ${allTasks.length}건`}
          />
          <KPICard
            label="막힌 건"
            value={blockedCount}
            unit="건"
            alert={blockedCount > 0}
            sub={blockedCount > 0
              ? allTasks.filter(t => t.is_overdue).slice(0, 2).map(t => t.display_name).join(' · ')
              : '지연 항목 없음'}
          />
          <KPICard
            label="정산 대기"
            value={data.settlementWaitingCount ?? 0}
            unit="건"
            sub={data.settlementWaitingAmount > 0 ? formatKRW(data.settlementWaitingAmount) : '—'}
          />
          <KPICard label="이번 달 계약액" value={formatKRW(data.monthlyContractTotal ?? 0)}
            sub={data.monthlyBudget > 0
              ? `예산 ${formatKRW(data.monthlyBudget)} · ${budgetPct}%${data.isBudgetFallback ? ' (캠페인 합)' : ''}`
              : `제품 ${formatKRW(data.monthlyContractProductCost)} + 고료 ${formatKRW(data.monthlyContractFee)}`}
          >
            {data.monthlyBudget > 0 && (
              <ProgressBar pct={budgetPct} height={4} style={{ marginTop: 8 }} />
            )}
          </KPICard>
        </div>

        {/* ─── 할 일 ─────────────────────────── */}
        <Section
          title="할 일"
          right={<TabBar tabs={stepTabs} active={stepFilter} onChange={setStepFilter} />}
          style={{ marginBottom: spacing.gap }}
        >
          {filteredTasks.length === 0 ? (
            <div style={{ padding: '32px 0', textAlign: 'center' }}>
              <span style={{ fontSize: 13, color: colors.textMuted }}>
                {stepFilter === 'all' ? '처리할 일이 없습니다' : `${STEP_LABELS[stepFilter] || stepFilter} 항목이 없습니다`}
              </span>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="inf-table" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, width: '20%' }}>인플루언서</th>
                    <th style={{ ...thStyle, width: '20%' }}>캠페인</th>
                    <th style={{ ...thStyle, width: '15%' }}>단계</th>
                    <th style={{ ...thStyle, width: '15%' }}>예정일</th>
                    <th style={{ ...thStyle, width: '15%', textAlign: 'center' }}>상태</th>
                    <th style={{ ...thStyle, width: '15%', textAlign: 'right' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.map((t, i) => {
                    const status = getStatusDisplay(t);
                    return (
                      <tr
                        key={`${t.participant_id}-${t.step}-${i}`}
                        onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                      >
                        <td style={tdStyle}>
                          <div style={{
                            fontWeight: 500, fontSize: 13.5, color: colors.textPrimary,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {t.display_name}
                          </div>
                          {t.channel && (
                            <div style={{ ...typo.meta, color: colors.textMuted, marginTop: 1 }}>
                              {CHANNEL_LABELS[t.channel as keyof typeof CHANNEL_LABELS] || t.channel}
                            </div>
                          )}
                        </td>
                        <td style={{
                          ...tdStyle, overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5,
                        }}>
                          {t.campaign_name}
                        </td>
                        <td style={tdStyle}>
                          <Chip variant={t.is_overdue ? 'coral' : t.step === 'payment' ? 'blue' : 'gray'}>
                            {STEP_LABELS[t.step] || t.step}
                          </Chip>
                        </td>
                        <td style={{
                          ...tdStyle,
                          color: t.is_overdue ? colors.coral : colors.textSecondary,
                        }}>
                          {t.scheduled_date ? formatDateShort(t.scheduled_date) : (
                            <span style={{ color: colors.textMuted }}>—</span>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          {t.step === 'payment' ? (
                            <Chip variant={
                              (t.settlement_status === 'docs_submitted' || t.settlement_status === 'payment_requested')
                                ? 'blue' : 'gray'
                            }>
                              {(t.settlement_status === 'docs_submitted' || t.settlement_status === 'payment_requested')
                                ? '제출 완료'
                                : t.settlement_status === 'docs_requested' ? '정보 대기' : '미발송'}
                            </Chip>
                          ) : (
                            <span style={{
                              color: status.color,
                              fontWeight: status.weight,
                              fontSize: 13,
                            }}>
                              {status.text}
                            </span>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {(t.step === 'draft' || t.step === 'edit' || t.step === 'upload') && (
                            <Btn size="sm" onClick={() => handleCheckStep(t)}>
                              {t.deliverable_status === 'revision_requested'
                                ? `${(t.deliverable_version || 1) + 1}안 받음`
                                : STEP_BTN_LABELS[t.step]}
                            </Btn>
                          )}
                          {t.step === 'payment' && (
                            <Btn size="sm" onClick={() => handlePaymentComplete(t)}>
                              {STEP_BTN_LABELS[t.step]}
                            </Btn>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* ─── 캠페인 진행 ──────────────────── */}
        {filteredCampaigns.length > 0 && (
          <Section title="캠페인 진행" style={{ marginBottom: spacing.gap }}>
            <div style={{
              padding: `${spacing.gap}px ${spacing.cardPadding}px`,
              display: 'flex', flexDirection: 'column', gap: 20,
            }}>
              {filteredCampaigns.map(c => {
                const total = c.participantCount;
                if (total === 0) return null;
                const completed = c.completedCount ?? c.uploadDone;
                const completePct = Math.round((completed / total) * 100);
                const delayed = c.delayedCount ?? 0;

                return (
                  <div key={c.id}>
                    <div style={{
                      display: 'flex', justifyContent: 'space-between',
                      alignItems: 'baseline', marginBottom: 8,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: colors.textPrimary }}>
                          {c.name}
                        </span>
                        {c.month && (
                          <span style={{ ...typo.meta, color: colors.textMuted }}>{c.month}</span>
                        )}
                      </div>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        ...typo.meta, color: colors.textInfo,
                      }}>
                        <span>{total}명</span>
                        <span>완료 {completed}</span>
                        {delayed > 0 && (
                          <span style={{ color: colors.coral, fontWeight: 500 }}>
                            지연 {delayed}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Stack bar */}
                    <div style={{
                      height: 10, borderRadius: 5, background: colors.track,
                      overflow: 'hidden', display: 'flex',
                    }}>
                      {completed > 0 && (
                        <div style={{
                          width: `${completePct}%`, background: colors.mint,
                          height: '100%', transition: 'width 0.3s',
                        }} />
                      )}
                    </div>
                    <div style={{
                      display: 'flex', justifyContent: 'space-between',
                      ...typo.meta, color: colors.textMuted, marginTop: 4,
                    }}>
                      <span>{completePct}% 완료</span>
                      {c.budget > 0 && <span>예산 {formatKRW(c.budget)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Legend */}
            <div style={{
              padding: `8px ${spacing.cardPadding}px 16px`,
              display: 'flex', gap: 16, ...typo.meta, color: colors.textMuted,
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: colors.mint }} />
                완료
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: colors.track }} />
                진행 중
              </span>
            </div>
          </Section>
        )}

        {/* Empty state */}
        {data.activeCampaigns === 0 && data.totalParticipants === 0 && (
          <Card style={{ textAlign: 'center', padding: '60px 24px' }}>
            <p style={{ fontSize: 16, color: colors.textSecondary, marginBottom: 8 }}>
              아직 캠페인이 없습니다
            </p>
            <p style={{ fontSize: 13, color: colors.textMuted }}>
              캠페인 관리에서 첫 캠페인을 만들어보세요
            </p>
          </Card>
        )}

        {/* ─── Receive modal ────────────────── */}
        {modal && renderReceiveModal()}

        {/* ─── Undo toast ───────────────────── */}
        {undoToast && (
          <Toast
            message={
              undoToast.name === '_revision_'
                ? '수정 요청으로 기록했습니다'
                : `${STEP_LABELS[undoToast.step] || undoToast.step} 컨펌 완료`
            }
            action={undoToast.name !== '_revision_'
              ? { label: '실행 취소', onClick: handleUndo }
              : undefined}
          />
        )}
      </div>
    </AppShell>
  );

  /* ── Receive Modal ──────────────────────── */

  function renderReceiveModal() {
    if (!modal) return null;
    const isUpload = modal.item.step === 'upload';
    const isDraftEdit = modal.item.step === 'draft' || modal.item.step === 'edit';

    return (
      <div
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000,
        }}
        onClick={() => { if (!modal.saving) setModal(null); }}
      >
        <div onClick={e => e.stopPropagation()} style={{
          background: colors.surface, borderRadius: radii.card,
          padding: spacing.cardPadding, width: 440,
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        }}>
          <div style={{ ...typo.sectionTitle, marginBottom: 2 }}>
            {isUpload ? '업로드 등록' : `${STEP_LABELS[modal.item.step]} 수령`}
          </div>
          <div style={{ ...typo.body, color: colors.textSecondary, marginBottom: 20 }}>
            {modal.item.display_name} · {modal.item.campaign_name}
          </div>

          {/* Link */}
          <ModalField label={isUpload ? '업로드 링크' : '링크 주소'} required={!(isDraftEdit && modal.noLink)}>
            <input
              type="url"
              placeholder={isUpload ? 'https://www.instagram.com/...' : 'https://docs.google.com/...'}
              value={modal.link}
              onChange={e => setModal({ ...modal, link: e.target.value, error: null })}
              disabled={(isDraftEdit && modal.noLink) || modal.saving}
              autoFocus
              style={inputStyle((isDraftEdit && modal.noLink))}
            />
          </ModalField>

          {/* Date */}
          <ModalField label={isUpload ? '업로드 시간' : '수령일'}>
            <input
              type={isUpload ? 'datetime-local' : 'date'}
              value={modal.receivedDate}
              onChange={e => setModal({ ...modal, receivedDate: e.target.value })}
              disabled={modal.saving}
              style={inputStyle(false)}
            />
          </ModalField>

          {/* Memo (draft/edit) */}
          {isDraftEdit && (
            <ModalField label="메모" optional>
              <textarea
                placeholder="참고사항 입력"
                value={modal.memo}
                onChange={e => setModal({ ...modal, memo: e.target.value })}
                disabled={modal.saving}
                rows={2}
                style={textareaStyle(44)}
              />
            </ModalField>
          )}

          {/* Process type (draft/edit) */}
          {isDraftEdit && (
            <div style={{ marginBottom: 14 }}>
              <label style={fieldLabelStyle}>처리</label>
              <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                  <input type="radio" name="processType" value="approved"
                    checked={modal.processType === 'approved'}
                    onChange={() => setModal({ ...modal, processType: 'approved', error: null })}
                    disabled={modal.saving} style={{ accentColor: colors.accent }} />
                  컨펌 완료
                  <span style={{ ...typo.meta, color: colors.textMuted, marginLeft: 2 }}>이대로 진행</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                  <input type="radio" name="processType" value="revision_requested"
                    checked={modal.processType === 'revision_requested'}
                    onChange={() => setModal({ ...modal, processType: 'revision_requested', error: null })}
                    disabled={modal.saving} style={{ accentColor: colors.accent }} />
                  수정 요청
                  <span style={{ ...typo.meta, color: colors.textMuted, marginLeft: 2 }}>수정을 요청</span>
                </label>
              </div>
            </div>
          )}

          {/* Revision note */}
          {isDraftEdit && modal.processType === 'revision_requested' && (
            <ModalField label="수정 요청 사항" required>
              <textarea
                placeholder="수정 요청 내용을 입력하세요"
                value={modal.revisionNote}
                onChange={e => setModal({ ...modal, revisionNote: e.target.value, error: null })}
                disabled={modal.saving}
                rows={3}
                style={textareaStyle(60)}
              />
            </ModalField>
          )}

          {/* No-link checkbox */}
          {isDraftEdit && (
            <label style={{
              display: 'flex', alignItems: 'center', gap: 6,
              cursor: 'pointer', fontSize: 13, color: colors.textSecondary, marginBottom: 16,
            }}>
              <input type="checkbox" checked={modal.noLink}
                onChange={e => setModal({
                  ...modal, noLink: e.target.checked,
                  link: e.target.checked ? '' : modal.link, error: null,
                })}
                disabled={modal.saving}
                style={{ accentColor: colors.accent, width: 14, height: 14 }} />
              링크 없이 확인함
            </label>
          )}

          {/* Error */}
          {modal.error && (
            <div style={{
              padding: '8px 12px', marginBottom: 12,
              background: colors.coralLight, borderRadius: radii.chip,
              fontSize: 13, color: colors.coral,
            }}>
              {modal.error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Btn size="md" onClick={() => setModal(null)} disabled={modal.saving}>취소</Btn>
            <button
              onClick={handleSaveDeliverable}
              disabled={modal.saving}
              style={{
                height: 36, padding: '0 16px', border: 'none',
                borderRadius: radii.button,
                background: modal.saving ? colors.textMuted : colors.textPrimary,
                fontSize: 13, fontWeight: 500, color: '#fff',
                cursor: modal.saving ? 'not-allowed' : 'pointer',
                fontFamily: 'var(--font)', minWidth: 70,
              }}
            >
              {modal.saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

/* ── Modal form helpers ──────────────────── */

const fieldLabelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 500, color: colors.textSecondary, marginBottom: 4,
};

function inputStyle(disabled: boolean): React.CSSProperties {
  return {
    width: '100%', height: 38, padding: '0 12px',
    border: `1px solid ${colors.border}`, borderRadius: radii.button,
    fontSize: 13, fontFamily: 'var(--font)',
    outline: 'none', boxSizing: 'border-box' as const,
    background: disabled ? colors.surfaceHover : colors.surface,
    color: disabled ? colors.textMuted : colors.textPrimary,
  };
}

function textareaStyle(minH: number): React.CSSProperties {
  return {
    width: '100%', padding: '8px 12px',
    border: `1px solid ${colors.border}`, borderRadius: radii.button,
    fontSize: 13, fontFamily: 'var(--font)',
    outline: 'none', boxSizing: 'border-box' as const,
    resize: 'vertical' as const, minHeight: minH,
  };
}

function ModalField({ label, required, optional, children }: {
  label: string; required?: boolean; optional?: boolean; children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={fieldLabelStyle}>
        {label}
        {required && <span style={{ color: colors.coral, marginLeft: 2 }}>*</span>}
        {optional && <span style={{ fontWeight: 400, color: colors.textMuted, marginLeft: 4 }}>(선택)</span>}
      </label>
      {children}
    </div>
  );
}
