'use client';

import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/AppShell';
import CustomSelect from '@/components/CustomSelect';
import { formatKRW } from '@/lib/helpers';
import { CAMPAIGN_STATUS_LABELS, type CampaignStatus, CHANNEL_LABELS } from '@/lib/types/influencer';
import type { DashboardData, WeeklyTaskItem, WeeklyStep } from '@/lib/types/influencer';
import { formatDDay, getDDayStyle, NO_SCHEDULE_STYLE } from '@/lib/dday';

const STEP_LABELS: Record<WeeklyStep, string> = {
  draft: '기획안 대기',
  edit: '가편집본 대기',
  upload: '업로드 대기',
  performance: '성과 입력',
  payment: '지급 대기',
};

const STEP_COLORS: Record<WeeklyStep, string> = {
  draft: '#9DC3E6',
  edit: '#7FCDBB',
  upload: '#4A7DB5',
  performance: '#C4CAD1',
  payment: '#9B8FC7',
};

const STEP_BTN_LABELS: Record<string, string> = {
  draft: '기획안 받음',
  edit: '가편집본 받음',
  upload: '업로드 확인',
  performance: '성과 입력',
  payment: '지급 완료',
};

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function formatDateFull(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const day = DAY_NAMES[d.getDay()];
  return `${y}-${m}-${dd} (${day})`;
}

function getWeekRange(): { start: Date; end: Date; label: string } {
  const now = new Date();
  const end = new Date(now.getTime() + 7 * 86400000);
  return {
    start: now,
    end,
    label: `${now.getMonth() + 1}/${now.getDate()}(${DAY_NAMES[now.getDay()]}) ~ ${end.getMonth() + 1}/${end.getDate()}(${DAY_NAMES[end.getDay()]})`,
  };
}

function getStatusDisplay(t: WeeklyTaskItem): { text: string; color: string; weight: number } {
  if (t.days_until === null || t.days_until === undefined) return { ...NO_SCHEDULE_STYLE };
  const text = formatDDay(t.days_until);
  const style = getDDayStyle(t.days_until);
  return { text, ...style };
}

interface ReceiveModal {
  item: WeeklyTaskItem;
  link: string;
  receivedDate: string; // YYYY-MM-DD
  memo: string;
  processType: 'approved' | 'revision_requested';
  revisionNote: string;
  noLink: boolean;
  saving: boolean;
  error: string | null;
}

export default function InfluencerDashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [weeklyFilter, setWeeklyFilter] = useState<string | null>(null);
  const [undoToast, setUndoToast] = useState<{ id: string; step: string; name: string } | null>(null);
  const [undoTimer, setUndoTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [modal, setModal] = useState<ReceiveModal | null>(null);

  const refreshData = useCallback(() => {
    fetch('/api/influencer/dashboard')
      .then((r) => r.json())
      .then((d) => {
        if (d && typeof d.activeCampaigns === 'number') setData(d);
      })
      .catch(() => {});
  }, []);

  function handleCheckStep(item: WeeklyTaskItem) {
    if (item.step === 'draft' || item.step === 'edit' || item.step === 'upload') {
      // KST now as default date
      const kstNow = new Date(Date.now() + 9 * 3600000);
      const dateStr = item.step === 'upload'
        ? kstNow.toISOString().slice(0, 16) // YYYY-MM-DDTHH:MM for datetime-local
        : kstNow.toISOString().slice(0, 10); // YYYY-MM-DD for date
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

    // Validate link
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

    // Validate revision note when revision_requested (draft/edit only)
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
        setModal({ ...modal, saving: false, error: err.error || '저장에 실패했습니다. 다시 시도해주세요' });
        return;
      }

      const isRevision = processType === 'revision_requested';
      setModal(null);

      if (isRevision) {
        // Revision: stay on same step, update deliverable_status in local data
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
        // Toast for revision
        if (undoTimer) clearTimeout(undoTimer);
        setUndoToast({ id: item.participant_id, step: item.step, name: '_revision_' });
        const timer = setTimeout(() => setUndoToast(null), 5000);
        setUndoTimer(timer);
      } else {
        // Approved: remove from task list
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
        // Undo toast for approved
        if (undoTimer) clearTimeout(undoTimer);
        setUndoToast({ id: item.participant_id, step: item.step, name: item.display_name });
        const timer = setTimeout(() => setUndoToast(null), 8000);
        setUndoTimer(timer);
      }
    } catch {
      setModal({ ...modal, saving: false, error: '네트워크 오류입니다. 다시 시도해주세요' });
    }
  }

  async function handlePaymentComplete(item: WeeklyTaskItem) {
    if (!confirm(`${item.display_name}님의 지급을 완료 처리하시겠습니까?`)) return;

    try {
      // 1. Find settlement record by participant_id
      const settlementsRes = await fetch('/api/influencer/settlements');
      const settlements = await settlementsRes.json();
      const settlement = Array.isArray(settlements)
        ? settlements.find((s: any) => s.participant_id === item.participant_id)
        : null;

      if (settlement) {
        // 2. Mark settlement as paid (syncs participant settlement_status too)
        await fetch('/api/influencer/settlements', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: settlement.id, payment_status: 'paid' }),
        });
      } else {
        // No settlement record — update participant directly
        await fetch('/api/influencer/participants', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.participant_id, settlement_status: 'paid' }),
        });
      }

      // 3. Remove from task list
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
      alert('처리 중 오류가 발생했습니다. 다시 시도해주세요.');
    }
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

  useEffect(() => {
    fetch('/api/influencer/dashboard')
      .then((r) => r.json())
      .then((d) => {
        if (d && typeof d.activeCampaigns === 'number') {
          setData(d);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refreshData]);

  const sectionStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: 'var(--card-border)',
    borderRadius: 'var(--card-radius)',
    padding: '20px 24px',
  };

  const thStyle: React.CSSProperties = {
    padding: '8px 12px',
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 450,
    color: 'var(--text-info)',
    borderBottom: '1px solid var(--border)',
  };

  const tdStyle: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: 13,
    borderBottom: '1px solid var(--border)',
    color: 'var(--text-primary)',
  };

  const campaignStatusBadge = (status: CampaignStatus) => (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      fontSize: 11, fontWeight: 500, color: '#8E959D', background: '#F2F4F7',
    }}>{CAMPAIGN_STATUS_LABELS[status]}</span>
  );

  if (loading) {
    return (
      <AppShell showFilter={false}>
        <p style={{ color: 'var(--text-muted)', padding: '40px 0' }}>로딩 중...</p>
      </AppShell>
    );
  }

  const d: DashboardData = data ?? {
    activeCampaigns: 0,
    totalParticipants: 0,
    pendingConsent: 0,
    pendingSettlement: 0,
    monthlyContractTotal: 0,
    monthlyContractFee: 0,
    monthlyContractProductCost: 0,
    annualContractTotal: 0,
    annualContractFee: 0,
    annualContractProductCost: 0,
    monthlyConfirmedFee: 0,
    annualConfirmedFee: 0,
    monthlyBudget: 0,
    isBudgetFallback: false,
    annualBudget: 0,
    productExecution: {},
    campaigns: [],
    settlementWaitingCount: 0,
    settlementWaitingAmount: 0,
    monthlyPaidAmount: 0,
    monthlyPaidCount: 0,
    annualPaidAmount: 0,
    todayChecklist: [],
    weeklyTasks: [],
    weeklyTaskSummary: [],
  };

  const budgetPct = d.monthlyBudget > 0
    ? Math.min(100, Math.round((d.monthlyContractTotal / d.monthlyBudget) * 100))
    : 0;

  const productRows = Object.entries(d.productExecution ?? {}).sort(
    (a, b) => b[1].fee - a[1].fee,
  );

  const allCampaigns = d.campaigns ?? [];
  const campaigns = campaignFilter === 'all'
    ? allCampaigns
    : allCampaigns.filter((c) => c.id === campaignFilter);

  const campaignOptions = [
    { value: 'all', label: '전체 캠페인' },
    ...allCampaigns.map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <AppShell showFilter={false}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>인플루언서 운영</h1>
          {allCampaigns.length > 1 && (
            <CustomSelect
              value={campaignFilter}
              options={campaignOptions}
              onChange={setCampaignFilter}
              size="md"
            />
          )}
        </div>

        {/* KPI Cards — 5-column grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 14 }}>
          <div style={{ ...sectionStyle, height: 130, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12, fontWeight: 450, color: 'var(--text-info)' }}>진행 중 캠페인</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{d.activeCampaigns}</div>
            <div style={{ fontSize: 12, color: 'var(--text-info)' }}>전체 {allCampaigns.length}</div>
          </div>
          <div style={{ ...sectionStyle, height: 130, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12, fontWeight: 450, color: 'var(--text-info)' }}>전체 참여자</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{d.totalParticipants}<span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-info)', marginLeft: 2 }}>명</span></div>
            <div style={{ fontSize: 12, color: 'var(--text-info)' }}>동의서 미수집 {d.pendingConsent}</div>
          </div>
          <div style={{ ...sectionStyle, height: 130, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12, fontWeight: 450, color: 'var(--text-info)' }}>정산 대기</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{d.settlementWaitingCount}<span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-info)', marginLeft: 2 }}>건</span></div>
            <div style={{ fontSize: 12, color: 'var(--text-info)' }}>{d.settlementWaitingAmount > 0 ? formatKRW(d.settlementWaitingAmount) : '-'}</div>
          </div>
          <div style={{ ...sectionStyle, height: 130, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12, fontWeight: 450, color: 'var(--text-info)' }}>이번 달 계약</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{formatKRW(d.monthlyContractTotal)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-info)' }}>
              {d.monthlyBudget > 0
                ? `예산 ${formatKRW(d.monthlyBudget)} · ${budgetPct}%${d.isBudgetFallback ? ' (캠페인 예산 합 기준)' : ''}`
                : '제품 ' + formatKRW(d.monthlyContractProductCost) + ' + 고료 ' + formatKRW(d.monthlyContractFee)}
            </div>
          </div>
          <div style={{ ...sectionStyle, height: 130, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12, fontWeight: 450, color: 'var(--text-info)' }}>이번 달 지급</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{formatKRW(d.monthlyPaidAmount)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-info)' }}>{d.monthlyPaidCount}건 · {new Date().getFullYear()}년 {new Date().getMonth() + 1}월</div>
          </div>
        </div>

        {/* Submission alerts */}
        {d.todayChecklist.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {d.todayChecklist.map((item) => {
              const isRed = item.type.includes('overdue') || item.type === 'payment_overdue';
              const isAmber = item.type.includes('unreviewed') || item.type === 'revision_waiting' || item.type.includes('due_today') || item.type.includes('due_soon') || item.type.includes('expiring');
              const bg = isRed ? '#FBE9E8' : isAmber ? '#FDF4E7' : '#F2F4F7';
              const color = isRed ? '#B03F3B' : isAmber ? '#A8712A' : '#5A6169';
              return (
                <div
                  key={item.type}
                  style={{
                    padding: '6px 12px', borderRadius: 8, fontSize: 13,
                    background: bg, color, fontWeight: 500,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{item.count}</span>
                  {item.label}
                </div>
              );
            })}
          </div>
        )}

        {/* Weekly Tasks — "할 일" (P0-C: renamed from "이번 주 할 일") */}
        <div style={{ ...sectionStyle, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
              할 일
              <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                {getWeekRange().label} · 7일 이내
              </span>
            </h2>
          </div>

          {/* 4-column summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
            {(d.weeklyTaskSummary ?? []).map((s) => {
              const isActive = weeklyFilter === s.step;
              const isEmpty = s.count === 0;
              const barColor = isEmpty ? '#E4E8EC' : STEP_COLORS[s.step];
              const subtitleStr = s.subtitle && s.subtitle !== '—' ? s.subtitle : '';
              return (
                <div
                  key={s.step}
                  onClick={() => setWeeklyFilter(isActive ? null : s.step)}
                  style={{
                    borderLeft: `3px solid ${barColor}`,
                    padding: '12px 14px',
                    background: isActive ? '#F5F9FE' : '#FFFFFF',
                    border: isActive ? `1px solid #D0DFF2` : '1px solid var(--border)',
                    borderLeftWidth: 3,
                    borderLeftStyle: 'solid',
                    borderLeftColor: barColor,
                    borderRadius: 8,
                    cursor: 'pointer',
                    transition: 'background 0.12s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: isEmpty ? '#8A9199' : 'var(--text-primary)' }}>
                      {s.count}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: isEmpty ? '#8A9199' : 'var(--text-primary)' }}>
                      {STEP_LABELS[s.step]}
                    </span>
                  </div>
                  {s.overdue_count > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#B03F3B', flexShrink: 0 }} />
                      <span style={{ fontSize: 11.5, color: '#B03F3B' }}>{s.overdue_count}건 지연</span>
                    </div>
                  )}
                  {subtitleStr && (
                    <div style={{ fontSize: 12, color: '#565D64', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {subtitleStr}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Task list */}
          {(() => {
            const allTasks = d.weeklyTasks ?? [];
            const isCardFilter = weeklyFilter !== null && weeklyFilter !== 'all';
            const filtered = isCardFilter
              ? allTasks.filter(t => t.step === weeklyFilter)
              : allTasks;
            const allEmpty = (d.weeklyTaskSummary ?? []).every(s => s.count === 0);
            const isDefaultView = weeklyFilter === null;
            const displayTasks = isDefaultView ? filtered.slice(0, 5) : filtered;
            const hasMore = isDefaultView && filtered.length > 5;

            if (allEmpty) {
              return (
                <div style={{ padding: '20px 0', textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#61686F', marginBottom: 4 }}>
                    처리할 일이 없습니다
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 450, color: '#838B93' }}>
                    {getWeekRange().label}
                  </div>
                </div>
              );
            }

            if (filtered.length === 0 && isCardFilter) {
              return (
                <div style={{ padding: '16px 0', textAlign: 'center' }}>
                  <span style={{ fontSize: 13, color: '#838B93' }}>
                    {STEP_LABELS[weeklyFilter as WeeklyStep]} 항목이 없습니다
                  </span>
                </div>
              );
            }

            if (displayTasks.length === 0) return null;

            const btnStyle: React.CSSProperties = {
              height: 28, padding: '0 12px',
              border: '1px solid #E4E8EC', borderRadius: 8,
              background: '#FFFFFF', fontSize: 13, fontWeight: 500,
              color: '#565D64', cursor: 'pointer',
              fontFamily: 'var(--font)', whiteSpace: 'nowrap',
            };

            return (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                    <thead>
                      <tr>
                        <th style={{ ...thStyle, width: '10%' }}>인플루언서</th>
                        <th style={{ ...thStyle, width: '16%' }}>캠페인</th>
                        <th style={{ ...thStyle, width: '10%' }}>단계</th>
                        <th style={{ ...thStyle, width: '16%' }}>예정일</th>
                        <th style={{ ...thStyle, width: '10%', textAlign: 'center' }}>상태</th>
                        <th style={{ ...thStyle, width: '10%' }}>정산서</th>
                        <th style={{ ...thStyle, width: '10%', textAlign: 'right' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayTasks.map((t, i) => {
                        const status = getStatusDisplay(t);
                        return (
                          <tr key={`${t.participant_id}-${t.step}-${i}`} style={{ cursor: 'default' }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#F7F9FB')}
                            onMouseLeave={e => (e.currentTarget.style.background = '')}
                          >
                            <td style={{ ...tdStyle, verticalAlign: 'top' }}>
                              <div>
                                <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {t.display_name}
                                </div>
                                {t.channel && (
                                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                                    {CHANNEL_LABELS[t.channel as keyof typeof CHANNEL_LABELS] || t.channel}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td style={{ ...tdStyle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{t.campaign_name}</td>
                            <td style={tdStyle}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: STEP_COLORS[t.step], flexShrink: 0 }} />
                                {STEP_LABELS[t.step]}
                              </span>
                            </td>
                            <td style={{ ...tdStyle, color: t.is_overdue ? '#B03F3B' : 'var(--text-primary)' }}>
                              {t.scheduled_date ? formatDateFull(t.scheduled_date) : (
                                <span style={{ color: '#8A9199' }}>—</span>
                              )}
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'center' }}>
                              {t.step === 'payment' ? (
                                (() => {
                                  const isSubmitted = t.settlement_status === 'docs_submitted' || t.settlement_status === 'payment_requested';
                                  const isRequested = t.settlement_status === 'docs_requested';
                                  const label = isSubmitted ? '제출 완료' : isRequested ? '정보 대기' : '미발송';
                                  const bg = isSubmitted ? '#FEF7ED' : isRequested ? '#F2F4F7' : '#F9FAFB';
                                  const fg = isSubmitted ? '#92640D' : isRequested ? '#565D64' : '#B0B7BF';
                                  return (
                                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: bg, color: fg, fontWeight: 500, whiteSpace: 'nowrap' }}>
                                      {label}
                                    </span>
                                  );
                                })()
                              ) : (
                                <span style={{ color: status.color, fontWeight: status.weight, fontSize: 13 }}>
                                  {status.text}
                                </span>
                              )}
                            </td>
                            <td style={{ ...tdStyle, fontSize: 12 }}>
                              {t.settlement_token ? (
                                (t.settlement_status === 'docs_submitted' || t.settlement_status === 'payment_requested') ? (
                                  <a
                                    href={`/influencer/settlement/${t.settlement_token}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ color: '#4A7DB5', fontSize: 11, textDecoration: 'none' }}
                                  >보기</a>
                                ) : (
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const url = `${window.location.origin}/influencer/settlement/${t.settlement_token}`;
                                        navigator.clipboard.writeText(url);
                                      }}
                                      style={{ padding: '2px 6px', fontSize: 11, borderRadius: 4, border: '1px solid #D0D5DD', background: '#fff', cursor: 'pointer', color: '#565D64' }}
                                    >복사</button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        window.open(`${window.location.origin}/influencer/settlement/${t.settlement_token}`, '_blank');
                                      }}
                                      style={{ padding: '2px 6px', fontSize: 11, borderRadius: 4, border: '1px solid #D0D5DD', background: '#fff', cursor: 'pointer', color: '#565D64' }}
                                    >열기</button>
                                  </span>
                                )
                              ) : (
                                <span style={{ color: '#C4CAD1' }}>—</span>
                              )}
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'right' }}>
                              {(t.step === 'draft' || t.step === 'edit') && (
                                <button
                                  onClick={() => handleCheckStep(t)}
                                  style={btnStyle}
                                  onMouseEnter={e => (e.currentTarget.style.background = '#F7F9FB')}
                                  onMouseLeave={e => (e.currentTarget.style.background = '#FFFFFF')}
                                >
                                  {t.deliverable_status === 'revision_requested'
                                    ? `${(t.deliverable_version || 1) + 1}안 받음`
                                    : STEP_BTN_LABELS[t.step]}
                                </button>
                              )}
                              {t.step === 'upload' && (
                                <button
                                  onClick={() => handleCheckStep(t)}
                                  style={btnStyle}
                                  onMouseEnter={e => (e.currentTarget.style.background = '#F7F9FB')}
                                  onMouseLeave={e => (e.currentTarget.style.background = '#FFFFFF')}
                                >
                                  {STEP_BTN_LABELS[t.step]}
                                </button>
                              )}
                              {t.step === 'payment' && (
                                <button
                                  onClick={() => handlePaymentComplete(t)}
                                  style={btnStyle}
                                  onMouseEnter={e => (e.currentTarget.style.background = '#F7F9FB')}
                                  onMouseLeave={e => (e.currentTarget.style.background = '#FFFFFF')}
                                >
                                  {STEP_BTN_LABELS[t.step]}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {hasMore && (
                  <div style={{ textAlign: 'center', paddingTop: 10 }}>
                    <button
                      onClick={() => setWeeklyFilter('all')}
                      style={{
                        background: 'none', border: 'none', fontSize: 13, fontWeight: 500,
                        color: 'var(--accent)', cursor: 'pointer', fontFamily: 'var(--font)',
                        padding: '4px 12px',
                      }}
                    >
                      전체 보기 ({allTasks.length}건)
                    </button>
                  </div>
                )}
              </>
            );
          })()}
        </div>

        {/* Monthly Budget Progress */}
        {d.monthlyBudget > 0 && (
          <div style={{ ...sectionStyle, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>월간 예산 진행률</span>
              <span style={{ fontSize: 13, color: 'var(--text-info)' }}>{budgetPct}%</span>
            </div>
            <div style={{ height: 8, background: 'var(--track)', borderRadius: 4, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${budgetPct}%`,
                  background: budgetPct > 90 ? 'var(--red)' : budgetPct > 70 ? 'var(--amber)' : 'var(--green)',
                  borderRadius: 4,
                  transition: 'width 0.3s',
                }}
              />
            </div>
            {(d.monthlyContractProductCost > 0 || d.monthlyContractFee > 0) && (
              <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-info)', marginTop: 6 }}>
                <span>제품 {formatKRW(d.monthlyContractProductCost)}</span>
                <span>고료 {formatKRW(d.monthlyContractFee)}</span>
                {d.monthlyConfirmedFee > 0 && <span>집행 예정 {formatKRW(d.monthlyConfirmedFee)}</span>}
              </div>
            )}
          </div>
        )}

        {/* Annual Budget Progress */}
        {d.annualBudget > 0 && (() => {
          const burnPct = Math.min(100, Math.round((d.annualContractTotal / d.annualBudget) * 100));
          return (
            <div style={{ ...sectionStyle, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>연간 예산</span>
                <span style={{ fontSize: 13, color: 'var(--text-info)' }}>
                  계약 {formatKRW(d.annualContractTotal)} / {formatKRW(d.annualBudget)} (소진 {burnPct}%)
                </span>
              </div>
              <div style={{ height: 8, background: 'var(--track)', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                <div
                  style={{
                    height: '100%',
                    width: `${burnPct}%`,
                    background: burnPct > 90 ? 'var(--red)' : burnPct > 70 ? 'var(--amber)' : 'var(--green)',
                    borderRadius: 4,
                    transition: 'width 0.3s',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-info)' }}>
                <span>계약 총액 {formatKRW(d.annualContractTotal)}</span>
                <span>집행 예정 {formatKRW(d.annualConfirmedFee)}</span>
                <span>지급 완료 {formatKRW(d.annualPaidAmount || 0)}</span>
              </div>
            </div>
          );
        })()}

        {/* Campaign Stacked Bar + Product Donut */}
        {(campaigns.length > 0 || productRows.length > 0) && (
          <div style={{ display: 'grid', gridTemplateColumns: productRows.length > 0 ? '2fr 1fr' : '1fr', gap: 14, marginBottom: 14, height: productRows.length > 0 ? 280 : undefined, alignItems: 'stretch' }}>
            {campaigns.length > 0 && (
              <div style={{ ...sectionStyle, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <h2 style={{ fontSize: 14, fontWeight: 600, marginTop: 0, marginBottom: 16, flexShrink: 0 }}>캠페인 진행</h2>
                <div className="card-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', flex: 1, minHeight: 0 }}>
                  {campaigns.map((c) => {
                    const totalSpent = c.totalFee + c.totalProductCost;
                    const pct = c.budget > 0 ? Math.min(100, Math.round((totalSpent / c.budget) * 100)) : 0;
                    const consentPct = c.participantCount > 0 ? Math.round((c.consentAgreed / c.participantCount) * 100) : 0;
                    const completePct = c.participantCount > 0 ? Math.round((c.uploadDone / c.participantCount) * 100) : 0;
                    return (
                      <div key={c.id}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>
                            {c.name}
                            {c.month && <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6, fontSize: 12 }}>{c.month}</span>}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-info)' }}>
                            {c.participantCount}명 · 동의 {consentPct}% · 완료 {completePct}%
                          </div>
                        </div>
                        <div style={{ height: 10, background: 'var(--track)', borderRadius: 5, overflow: 'hidden', display: 'flex' }}>
                          {c.totalProductCost > 0 && c.budget > 0 && (
                            <div style={{ width: `${Math.min(100, (c.totalProductCost / c.budget) * 100)}%`, background: '#B8D4E8', height: '100%' }} />
                          )}
                          {c.totalFee > 0 && c.budget > 0 && (
                            <div style={{ width: `${Math.min(100 - (c.totalProductCost / c.budget) * 100, (c.totalFee / c.budget) * 100)}%`, background: 'var(--accent)', height: '100%' }} />
                          )}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                          <span>{totalSpent > 0 ? formatKRW(totalSpent) : '-'}</span>
                          <span>{c.budget > 0 ? `${formatKRW(c.budget)} (${pct}%)` : ''}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#B8D4E8', marginRight: 4, verticalAlign: 'middle' }} />제품</span>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--accent)', marginRight: 4, verticalAlign: 'middle' }} />고료</span>
                </div>
              </div>
            )}
            {productRows.length > 0 && (() => {
              const totalFee = productRows.reduce((s, [, v]) => s + v.fee, 0);
              const DONUT_COLORS = ['#4A7DB5', '#7FCDBB', '#F2A0A0', '#E8C87A', '#B09DD9', '#9AA2AA'];
              let cumulativeAngle = -90;
              const arcs = productRows.map(([name, v], i) => {
                const pct = totalFee > 0 ? v.fee / totalFee : 0;
                const angle = pct * 360;
                const start = cumulativeAngle;
                cumulativeAngle += angle;
                return { name, fee: v.fee, count: v.count, pct, start, angle, color: DONUT_COLORS[i % DONUT_COLORS.length] };
              });
              const r = 60, cx = 80, cy = 80, strokeWidth = 18;
              const toRad = (deg: number) => (deg * Math.PI) / 180;

              return (
                <div style={{ ...sectionStyle, overflow: 'hidden' }}>
                  <h2 style={{ fontSize: 14, fontWeight: 600, marginTop: 0, marginBottom: 16 }}>제품별 고료</h2>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <svg width={160} height={160} viewBox="0 0 160 160">
                      {arcs.map((arc, i) => {
                        if (arc.angle <= 0) return null;
                        const startRad = toRad(arc.start);
                        const endRad = toRad(arc.start + arc.angle);
                        const x1 = cx + r * Math.cos(startRad);
                        const y1 = cy + r * Math.sin(startRad);
                        const x2 = cx + r * Math.cos(endRad);
                        const y2 = cy + r * Math.sin(endRad);
                        const largeArc = arc.angle > 180 ? 1 : 0;
                        const pathD = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
                        return <path key={i} d={pathD} fill="none" stroke={arc.color} strokeWidth={strokeWidth} />;
                      })}
                      <text x={cx} y={cy - 6} textAnchor="middle" fontSize={12} fill="var(--text-info)">합계</text>
                      <text x={cx} y={cy + 10} textAnchor="middle" fontSize={14} fontWeight={600} fill="var(--text-primary)">{formatKRW(totalFee)}</text>
                    </svg>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12, width: '100%' }}>
                      {arcs.map((arc, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: arc.color, flexShrink: 0 }} />
                            <span style={{ color: 'var(--text-secondary)' }}>{arc.name}</span>
                          </div>
                          <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                            {formatKRW(arc.fee)} ({arc.count}건)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Empty state */}
        {d.activeCampaigns === 0 && d.totalParticipants === 0 && (
          <div style={{ ...sectionStyle, textAlign: 'center', padding: '60px 24px' }}>
            <p style={{ fontSize: 16, color: 'var(--text-secondary)', marginBottom: 8 }}>
              아직 캠페인이 없습니다
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              캠페인 관리에서 첫 캠페인을 만들어보세요
            </p>
          </div>
        )}

        {/* Receive modal */}
        {modal && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400,
          }} onClick={() => { if (!modal.saving) setModal(null); }}>
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: '#FFFFFF', borderRadius: 12, padding: '24px 28px',
                width: 440, boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>
                {modal.item.step === 'upload' ? '업로드 등록' : `${STEP_LABELS[modal.item.step]?.replace(' 대기', '')} 수령`}
              </div>
              <div style={{ fontSize: 13, color: '#565D64', marginBottom: 20 }}>
                {modal.item.display_name} · {modal.item.campaign_name}
              </div>

              {/* Link URL */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#565D64', marginBottom: 4 }}>
                  {modal.item.step === 'upload' ? '업로드 링크' : '링크 주소'}{!(modal.item.step !== 'upload' && modal.noLink) && <span style={{ color: '#B03F3B', marginLeft: 2 }}>*</span>}
                </label>
                <input
                  type="url"
                  placeholder={modal.item.step === 'upload' ? 'https://www.instagram.com/...' : 'https://docs.google.com/...'}
                  value={modal.link}
                  onChange={e => setModal({ ...modal, link: e.target.value, error: null })}
                  disabled={(modal.item.step !== 'upload' && modal.noLink) || modal.saving}
                  autoFocus
                  style={{
                    width: '100%', height: 38, padding: '0 12px',
                    border: '1px solid #D0D5DD', borderRadius: 8,
                    fontSize: 13, fontFamily: 'var(--font)',
                    outline: 'none', boxSizing: 'border-box',
                    background: (modal.item.step !== 'upload' && modal.noLink) ? '#F7F9FB' : '#FFFFFF',
                    color: (modal.item.step !== 'upload' && modal.noLink) ? '#8A9199' : 'var(--text-primary)',
                  }}
                />
              </div>

              {/* Date */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#565D64', marginBottom: 4 }}>
                  {modal.item.step === 'upload' ? '업로드 시간' : '수령일'}
                </label>
                <input
                  type={modal.item.step === 'upload' ? 'datetime-local' : 'date'}
                  value={modal.receivedDate}
                  onChange={e => setModal({ ...modal, receivedDate: e.target.value })}
                  disabled={modal.saving}
                  style={{
                    width: '100%', height: 38, padding: '0 12px',
                    border: '1px solid #D0D5DD', borderRadius: 8,
                    fontSize: 13, fontFamily: 'var(--font)',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Memo - only for draft/edit */}
              {modal.item.step !== 'upload' && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#565D64', marginBottom: 4 }}>
                  메모 <span style={{ fontWeight: 400, color: '#8A9199' }}>(선택)</span>
                </label>
                <textarea
                  placeholder="참고사항 입력"
                  value={modal.memo}
                  onChange={e => setModal({ ...modal, memo: e.target.value })}
                  disabled={modal.saving}
                  rows={2}
                  style={{
                    width: '100%', padding: '8px 12px',
                    border: '1px solid #D0D5DD', borderRadius: 8,
                    fontSize: 13, fontFamily: 'var(--font)',
                    outline: 'none', boxSizing: 'border-box',
                    resize: 'vertical', minHeight: 44,
                  }}
                />
              </div>
              )}

              {/* Processing mode - only for draft/edit */}
              {modal.item.step !== 'upload' && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#565D64', marginBottom: 6 }}>
                  처리
                </label>
                <div style={{ display: 'flex', gap: 16 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)' }}>
                    <input
                      type="radio" name="processType" value="approved"
                      checked={modal.processType === 'approved'}
                      onChange={() => setModal({ ...modal, processType: 'approved', error: null })}
                      disabled={modal.saving}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    컨펌 완료
                    <span style={{ fontSize: 11, color: '#8A9199', marginLeft: 2 }}>이대로 진행합니다</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)' }}>
                    <input
                      type="radio" name="processType" value="revision_requested"
                      checked={modal.processType === 'revision_requested'}
                      onChange={() => setModal({ ...modal, processType: 'revision_requested', error: null })}
                      disabled={modal.saving}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    수정 요청
                    <span style={{ fontSize: 11, color: '#8A9199', marginLeft: 2 }}>수정을 요청합니다</span>
                  </label>
                </div>
              </div>
              )}

              {/* Revision note (shown only when revision_requested, draft/edit only) */}
              {modal.item.step !== 'upload' && modal.processType === 'revision_requested' && (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#565D64', marginBottom: 4 }}>
                    수정 요청 사항 <span style={{ color: '#B03F3B' }}>*</span>
                  </label>
                  <textarea
                    placeholder="수정 요청 내용을 입력하세요"
                    value={modal.revisionNote}
                    onChange={e => setModal({ ...modal, revisionNote: e.target.value, error: null })}
                    disabled={modal.saving}
                    rows={3}
                    style={{
                      width: '100%', padding: '8px 12px',
                      border: '1px solid #D0D5DD', borderRadius: 8,
                      fontSize: 13, fontFamily: 'var(--font)',
                      outline: 'none', boxSizing: 'border-box',
                      resize: 'vertical', minHeight: 60,
                    }}
                  />
                </div>
              )}

              {/* No-link checkbox - only for draft/edit */}
              {modal.item.step !== 'upload' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#565D64', marginBottom: 16 }}>
                <input
                  type="checkbox"
                  checked={modal.noLink}
                  onChange={e => setModal({ ...modal, noLink: e.target.checked, link: e.target.checked ? '' : modal.link, error: null })}
                  disabled={modal.saving}
                  style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
                />
                링크 없이 확인함
              </label>
              )}

              {/* Error message */}
              {modal.error && (
                <div style={{
                  padding: '8px 12px', marginBottom: 12,
                  background: '#FEF3F2', borderRadius: 6,
                  fontSize: 13, color: '#B03F3B',
                }}>
                  {modal.error}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  onClick={() => setModal(null)}
                  disabled={modal.saving}
                  style={{
                    height: 34, padding: '0 16px', border: '1px solid #D0D5DD',
                    borderRadius: 8, background: '#FFFFFF', fontSize: 13,
                    fontWeight: 500, color: '#565D64', cursor: modal.saving ? 'not-allowed' : 'pointer',
                    fontFamily: 'var(--font)', opacity: modal.saving ? 0.5 : 1,
                  }}
                >
                  취소
                </button>
                <button
                  onClick={handleSaveDeliverable}
                  disabled={modal.saving}
                  style={{
                    height: 34, padding: '0 16px', border: 'none',
                    borderRadius: 8, background: modal.saving ? '#8A9199' : '#1A1D21', fontSize: 13,
                    fontWeight: 500, color: '#FFFFFF', cursor: modal.saving ? 'not-allowed' : 'pointer',
                    fontFamily: 'var(--font)', minWidth: 70,
                  }}
                >
                  {modal.saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Undo toast */}
        {undoToast && (
          <div style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#1A1D21',
            color: '#FFFFFF',
            fontSize: 13,
            padding: '10px 20px',
            borderRadius: 10,
            zIndex: 300,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}>
            {undoToast.name === '_revision_' ? (
              <span>수정 요청으로 기록했습니다</span>
            ) : (
              <>
                <span>{STEP_LABELS[undoToast.step as WeeklyStep]?.replace(' 대기', '')} 컨펌 완료</span>
                <button
                  onClick={handleUndo}
                  style={{
                    background: 'none',
                    border: '1px solid rgba(255,255,255,0.3)',
                    borderRadius: 6,
                    color: '#FFFFFF',
                    fontSize: 12,
                    fontWeight: 500,
                    padding: '3px 10px',
                    cursor: 'pointer',
                    fontFamily: 'var(--font)',
                  }}
                >
                  실행 취소
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
