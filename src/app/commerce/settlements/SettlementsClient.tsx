'use client';

import { useState, useMemo, Fragment } from 'react';
import AppShell from '@/components/AppShell';
import { formatKRW, formatNumber } from '@/lib/helpers';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DeductionBreakdown {
  totalSale: number;
  serviceFee: number;
  sellerDiscountCoupon: number;
  downloadableCoupon: number;
  couranteeFee: number;
  deductionAmount: number;
  debtOfLastWeek: number;
  lastAmount: number;
  pendingReleasedAmount: number;
  storeFeeDiscount: number;
}

interface SettlementItem {
  vendorId: string;
  revenueYearMonth: string;
  settlementDate: string;
  settlementType: string;
  status: string;
  finalAmount: number;
  settlementAmount: number;
  deduction: number;
  revenueFrom: string;
  revenueTo: string;
  updatedAt: string;
  isPaid: boolean;
  isPending: boolean;
  isCurrentMonth: boolean;
  breakdown: DeductionBreakdown;
}

interface Props {
  settlements: SettlementItem[];
  availableYears: number[];
  currentYear: number;
  currentYearMonth: string;
}

interface MonthGroup {
  yearMonth: string;
  label: string;
  items: SettlementItem[];
  totalSettlement: number;
  totalServiceFee: number;
  totalLastAmount: number;
  totalDebtOfLastWeek: number;
  totalPendingReleased: number;
  totalFinal: number;
  totalPaid: number;
  pendingCount: number;
  paidCount: number;
}

/* ------------------------------------------------------------------ */
/*  Inline style helpers                                               */
/* ------------------------------------------------------------------ */

const nums: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
};

const tdPad: React.CSSProperties = { paddingTop: 9, paddingBottom: 9 };

/* ------------------------------------------------------------------ */
/*  Status badge                                                       */
/* ------------------------------------------------------------------ */

function getStatusBadge(status: string): { label: string; bg: string; color: string } {
  const s = (status || '').trim();
  const su = s.toUpperCase();

  if (
    su === 'DONE' || su === 'COMPLETED' || su === 'PAID' ||
    s === '정산완료' || s === '지급완료'
  ) {
    return { label: '지급 완료', bg: '#E8F5E9', color: '#2E7D32' };
  }

  if (
    su === 'PENDING' || su === 'WAITING' ||
    s === '대기' || s === '미정산'
  ) {
    return { label: '지급 예정', bg: '#FFF3E0', color: '#E65100' };
  }

  if (su === 'HOLD' || s === '보류') {
    return { label: '보류', bg: '#F5F5F5', color: '#757575' };
  }

  return { label: s || '-', bg: '#F5F5F5', color: '#757575' };
}

/* ------------------------------------------------------------------ */
/*  Date formatting helpers                                            */
/* ------------------------------------------------------------------ */

function formatSettlementDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}.${m}.${day}`;
  } catch {
    return dateStr;
  }
}

function formatYearMonth(ym: string): string {
  if (!ym) return '-';
  const parts = ym.split('-');
  if (parts.length === 2) {
    return `${parts[0]}년 ${parseInt(parts[1])}월`;
  }
  return ym;
}

function formatShortMonth(ym: string): string {
  if (!ym) return '-';
  const parts = ym.split('-');
  if (parts.length === 2) {
    return `${parseInt(parts[1])}월`;
  }
  return ym;
}

function formatPeriod(from: string | null | undefined, to: string | null | undefined): string {
  if (!from && !to) return '-';
  return `${formatSettlementDate(from)} ~ ${formatSettlementDate(to)}`;
}

/* ------------------------------------------------------------------ */
/*  Zero-amount check                                                  */
/* ------------------------------------------------------------------ */

function isZeroRow(s: SettlementItem): boolean {
  return s.settlementAmount === 0 && s.finalAmount === 0 && Math.abs(s.deduction) === 0;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function SettlementsClient({
  settlements,
  availableYears,
  currentYear,
  currentYearMonth,
}: Props) {
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [toggledMonths, setToggledMonths] = useState<Set<string>>(new Set());
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  /* --- Available months for the selected year --- */
  const availableMonthSet = useMemo(() => {
    const months = new Set<string>();
    for (const s of settlements) {
      if (s.revenueYearMonth?.startsWith(String(selectedYear)) && !isZeroRow(s)) {
        months.add(s.revenueYearMonth);
      }
    }
    return months;
  }, [settlements, selectedYear]);

  /* --- Filter by selected year + optional month --- */
  const filtered = useMemo(() => {
    return settlements.filter((s) => {
      if (!s.revenueYearMonth) return false;
      if (selectedMonth) {
        return s.revenueYearMonth === selectedMonth;
      }
      return s.revenueYearMonth.startsWith(String(selectedYear));
    });
  }, [settlements, selectedYear, selectedMonth]);

  /* --- Group by month --- */
  const monthGroups = useMemo(() => {
    const groupMap = new Map<string, MonthGroup>();

    for (const s of filtered) {
      const ym = s.revenueYearMonth || 'unknown';
      if (!groupMap.has(ym)) {
        groupMap.set(ym, {
          yearMonth: ym,
          label: formatYearMonth(ym),
          items: [],
          totalSettlement: 0,
          totalServiceFee: 0,
          totalLastAmount: 0,
          totalDebtOfLastWeek: 0,
          totalPendingReleased: 0,
          totalFinal: 0,
          totalPaid: 0,
          pendingCount: 0,
          paidCount: 0,
        });
      }
      const g = groupMap.get(ym)!;

      if (isZeroRow(s)) continue;

      g.items.push(s);
      g.totalSettlement += s.settlementAmount;
      g.totalServiceFee += s.breakdown.serviceFee;
      g.totalLastAmount += s.breakdown.lastAmount;
      g.totalDebtOfLastWeek += s.breakdown.debtOfLastWeek;
      g.totalPendingReleased += s.breakdown.pendingReleasedAmount;
      g.totalFinal += s.finalAmount;
      if (s.isPaid) {
        g.paidCount++;
        g.totalPaid += s.finalAmount;
      }
      if (s.isPending) g.pendingCount++;
    }

    return Array.from(groupMap.values())
      .filter((g) => g.items.length > 0)
      .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
  }, [filtered]);

  /* --- KPI calculations --- */
  const kpi = useMemo(() => {
    let paidTotal = 0;
    let pendingTotal = 0;
    let totalServiceFee = 0;
    let totalSettlement = 0;
    let totalLastAmount = 0;
    let totalDebtOfLastWeek = 0;
    let currentMonthSettlement = 0;

    for (const s of filtered) {
      if (isZeroRow(s)) continue;
      if (s.isPaid) paidTotal += s.finalAmount;
      if (s.isPending) pendingTotal += s.finalAmount;
      totalServiceFee += s.breakdown.serviceFee;
      totalSettlement += s.settlementAmount;
      totalLastAmount += s.breakdown.lastAmount;
      totalDebtOfLastWeek += s.breakdown.debtOfLastWeek;
      if (s.isCurrentMonth) currentMonthSettlement += s.settlementAmount;
    }

    const feeRate = totalSettlement > 0 ? (totalServiceFee / totalSettlement * 100) : 0;
    const carryoverBalance = totalLastAmount - totalDebtOfLastWeek;

    return {
      paidTotal,
      pendingTotal,
      totalServiceFee,
      totalSettlement,
      feeRate,
      carryoverBalance,
      totalLastAmount,
      currentMonthSettlement,
    };
  }, [filtered]);

  /* --- Grand totals --- */
  const grandTotals = useMemo(() => {
    let totalSettlement = 0;
    let totalServiceFee = 0;
    let totalLastAmount = 0;
    let totalDebtOfLastWeek = 0;
    let totalPendingReleased = 0;
    let totalFinal = 0;
    for (const s of filtered) {
      if (isZeroRow(s)) continue;
      totalSettlement += s.settlementAmount;
      totalServiceFee += s.breakdown.serviceFee;
      totalLastAmount += s.breakdown.lastAmount;
      totalDebtOfLastWeek += s.breakdown.debtOfLastWeek;
      totalPendingReleased += s.breakdown.pendingReleasedAmount;
      totalFinal += s.finalAmount;
    }
    const netCarryover = totalLastAmount - totalDebtOfLastWeek - totalPendingReleased;
    const totalDeduction = totalSettlement - totalServiceFee - netCarryover - totalFinal;
    return { totalSettlement, totalServiceFee, totalDeduction, netCarryover, totalFinal };
  }, [filtered]);

  /* --- Period label for KPI sub text --- */
  const periodLabel = useMemo(() => {
    if (selectedMonth) return formatYearMonth(selectedMonth);
    if (monthGroups.length === 0) return `${selectedYear}년`;
    const months = monthGroups.map(g => parseInt(g.yearMonth.split('-')[1]));
    const min = Math.min(...months);
    const max = Math.max(...months);
    return min === max ? `${selectedYear}년 ${min}월` : `${selectedYear}년 ${min}~${max}월`;
  }, [selectedMonth, selectedYear, monthGroups]);

  /* --- Month expand/collapse (only most recent expanded by default) --- */
  const isMonthExpanded = (ym: string, idx: number) => {
    const wasToggled = toggledMonths.has(ym);
    if (idx === 0) return !wasToggled;
    return wasToggled;
  };

  const toggleMonth = (ym: string) => {
    setToggledMonths((prev) => {
      const next = new Set(prev);
      if (next.has(ym)) next.delete(ym);
      else next.add(ym);
      return next;
    });
  };

  const toggleRow = (key: string) => {
    setExpandedRow((prev) => (prev === key ? null : key));
  };

  const totalNonZero = monthGroups.reduce((s, g) => s + g.items.length, 0);

  /* --- Revenue card: adapts label based on filter --- */
  const revenueLabel = selectedMonth ? '매출액' : '이번 달 매출액';
  const revenueAmount = selectedMonth ? kpi.totalSettlement : kpi.currentMonthSettlement;
  const revenueSub = selectedMonth
    ? `${formatYearMonth(selectedMonth)} 매출인식분`
    : `${formatYearMonth(currentYearMonth)} 매출인식분`;

  return (
    <AppShell showFilter={false}>
      {/* Brand notice */}
      <div style={{
        background: '#EDF2F7',
        border: '1px solid #E2E8F0',
        borderRadius: 8,
        padding: '8px 14px',
        marginBottom: 12,
        fontSize: 12,
        color: '#4A5568',
        lineHeight: 1.5,
      }}>
        {'ℹ️'} {'정산 데이터는 HEEDA + SUPERLABS 두 브랜드 합산 금액입니다'}{' '}
        <span style={{ color: '#A0AEC0' }}>{'— 쿠팡 정산 API는 벤더 단위 집계만 제공'}</span>
      </div>

      {/* Page Title + Year Filter */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>정산</h1>
        <select
          value={selectedYear}
          onChange={(e) => {
            setSelectedYear(Number(e.target.value));
            setSelectedMonth(null);
            setToggledMonths(new Set());
            setExpandedRow(null);
          }}
          style={{
            padding: '6px 12px',
            fontSize: 14,
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          {availableYears.map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>
      </div>

      {/* Month filter pills */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        <button
          onClick={() => {
            setSelectedMonth(null);
            setToggledMonths(new Set());
            setExpandedRow(null);
          }}
          style={{
            padding: '4px 12px',
            fontSize: 13,
            fontWeight: selectedMonth === null ? 600 : 400,
            borderRadius: 16,
            border: '1px solid',
            borderColor: selectedMonth === null ? '#4A90D9' : '#E2E8F0',
            background: selectedMonth === null ? '#EBF4FF' : 'transparent',
            color: selectedMonth === null ? '#4A90D9' : '#9AA2AA',
            cursor: 'pointer',
          }}
        >
          전체
        </button>
        {Array.from({ length: 12 }, (_, i) => {
          const m = String(i + 1).padStart(2, '0');
          const ym = `${selectedYear}-${m}`;
          const hasData = availableMonthSet.has(ym);
          const isActive = selectedMonth === ym;
          return (
            <button
              key={ym}
              disabled={!hasData}
              onClick={() => {
                setSelectedMonth(ym);
                setToggledMonths(new Set());
                setExpandedRow(null);
              }}
              style={{
                padding: '4px 10px',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                borderRadius: 16,
                border: '1px solid',
                borderColor: isActive ? '#4A90D9' : hasData ? '#E2E8F0' : 'transparent',
                background: isActive ? '#EBF4FF' : 'transparent',
                color: isActive ? '#4A90D9' : hasData ? 'var(--text-secondary)' : '#D0D5DC',
                cursor: hasData ? 'pointer' : 'default',
                opacity: hasData ? 1 : 0.5,
              }}
            >
              {i + 1}월
            </button>
          );
        })}
      </div>

      {/* ---- 1. KPI Cards - 5 column ---- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 'var(--card-gap, 16px)' }}>
        {/* 지급 완료액 */}
        <div className="kpi-card">
          <div className="kpi-label">지급 완료액</div>
          <div className="kpi-value" style={{ fontWeight: 650, color: 'var(--text-primary)', ...nums }}>
            {formatNumber(kpi.paidTotal)}
            <span className="unit" style={{ color: '#9AA2AA', fontWeight: 400, fontSize: '0.6em' }}>원</span>
          </div>
          <div className="kpi-sub">
            {periodLabel} · {monthGroups.reduce((s, g) => s + g.paidCount, 0)}건
          </div>
        </div>

        {/* 지급 예정액 */}
        <div className="kpi-card">
          <div className="kpi-label">지급 예정액</div>
          <div className="kpi-value" style={{ fontWeight: 650, color: 'var(--text-primary)', ...nums }}>
            {formatNumber(kpi.pendingTotal)}
            <span className="unit" style={{ color: '#9AA2AA', fontWeight: 400, fontSize: '0.6em' }}>원</span>
          </div>
          <div className="kpi-sub">
            {periodLabel} · {monthGroups.reduce((s, g) => s + g.pendingCount, 0)}건
          </div>
        </div>

        {/* 이번 달 / 선택 월 매출액 */}
        <div className="kpi-card">
          <div className="kpi-label">{revenueLabel}</div>
          <div className="kpi-value" style={{ fontWeight: 650, color: 'var(--text-primary)', ...nums }}>
            {revenueAmount > 0 ? (
              <>
                {formatNumber(revenueAmount)}
                <span className="unit" style={{ color: '#9AA2AA', fontWeight: 400, fontSize: '0.6em' }}>원</span>
              </>
            ) : (
              <span style={{ fontSize: '0.7em', fontWeight: 500, color: '#9AA2AA' }}>아직 없음</span>
            )}
          </div>
          <div className="kpi-sub">
            {revenueSub}
          </div>
        </div>

        {/* 판매수수료 (merged with 수수료율) */}
        <div className="kpi-card">
          <div className="kpi-label">판매수수료</div>
          <div className="kpi-value" style={{ fontWeight: 650, color: 'var(--text-primary)', ...nums }}>
            {formatNumber(kpi.totalServiceFee)}
            <span className="unit" style={{ color: '#9AA2AA', fontWeight: 400, fontSize: '0.6em' }}>원</span>
          </div>
          <div className="kpi-sub">
            {kpi.feeRate > 0 ? `수수료율 ${kpi.feeRate.toFixed(1)}%` : '-'}
          </div>
          <div style={{ fontSize: 11, color: '#A0AEC0', marginTop: 2 }}>
            두 브랜드 합산 기준
          </div>
        </div>

        {/* 이월금 잔액 */}
        <div className="kpi-card">
          <div className="kpi-label">이월금 잔액</div>
          <div className="kpi-value" style={{ fontWeight: 650, color: 'var(--text-primary)', ...nums }}>
            {kpi.carryoverBalance > 0 ? (
              <>
                {formatNumber(kpi.carryoverBalance)}
                <span className="unit" style={{ color: '#9AA2AA', fontWeight: 400, fontSize: '0.6em' }}>원</span>
              </>
            ) : kpi.carryoverBalance < 0 ? (
              <>
                <span style={{ fontSize: '0.8em' }}>−</span>{formatNumber(Math.abs(kpi.carryoverBalance))}
                <span className="unit" style={{ color: '#9AA2AA', fontWeight: 400, fontSize: '0.6em' }}>원</span>
              </>
            ) : (
              <span style={{ fontSize: '0.7em', fontWeight: 500, color: '#9AA2AA' }}>-</span>
            )}
          </div>
          <div className="kpi-sub">
            미지급 이월분
          </div>
        </div>
      </div>

      {/* ---- 2. Monthly Grouped Table ---- */}
      <div className="section">
        <div className="section-header">
          <span className="section-title">회차별 정산 내역</span>
          <span className="section-hint">{totalNonZero}건</span>
        </div>
        <div className="section-body">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ color: 'var(--text-muted)' }}>매출인식기간</th>
                <th style={{ color: 'var(--text-muted)' }}>정산일</th>
                <th className="right" style={{ color: 'var(--text-muted)' }}>매출액</th>
                <th className="right" style={{ color: 'var(--text-muted)' }}>수수료</th>
                <th className="right" style={{ color: 'var(--text-muted)' }} title="반품/취소/유보금 등 기타 차감">차감</th>
                <th className="right" style={{ color: 'var(--text-muted)' }} title="이월 - 전주미지급 - 보류해제">순이월</th>
                <th className="right" style={{ color: 'var(--text-muted)' }}>지급액</th>
                <th style={{ width: 90, color: 'var(--text-muted)', textAlign: 'center' }}>상태</th>
              </tr>
            </thead>
            <tbody>
              {monthGroups.map((mg, mgIdx) => {
                const expanded = isMonthExpanded(mg.yearMonth, mgIdx);
                const monthFeeRate = mg.totalSettlement > 0
                  ? (mg.totalServiceFee / mg.totalSettlement * 100).toFixed(1)
                  : '-';
                return (
                  <Fragment key={mg.yearMonth}>
                    {/* Month header row */}
                    <tr
                      onClick={() => toggleMonth(mg.yearMonth)}
                      style={{
                        backgroundColor: '#F0F3F6',
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                    >
                      <td colSpan={2} style={{ ...tdPad, fontWeight: 600, color: 'var(--text-primary)' }}>
                        <span style={{ display: 'inline-block', width: 16, fontSize: 10, color: '#9AA2AA' }}>
                          {expanded ? '▼' : '▶'}
                        </span>
                        {formatShortMonth(mg.yearMonth)}
                        <span style={{ fontWeight: 400, color: '#9AA2AA', marginLeft: 8, fontSize: 12 }}>
                          {mg.items.length}회차 · 수수료 {monthFeeRate}%
                        </span>
                        {mg.pendingCount > 0 && (
                          <span style={{ fontWeight: 400, color: '#E65100', marginLeft: 8, fontSize: 12 }}>
                            예정 {mg.pendingCount}건
                          </span>
                        )}
                      </td>
                      {(() => {
                        const mgNetCarry = mg.totalLastAmount - mg.totalDebtOfLastWeek - mg.totalPendingReleased;
                        const mgDeduct = mg.totalSettlement - mg.totalServiceFee - mgNetCarry - mg.totalFinal;
                        return (
                          <>
                            <td className="right" style={{ fontWeight: 600, color: 'var(--text-secondary)', ...nums, ...tdPad }}>
                              {formatKRW(mg.totalSettlement)}
                            </td>
                            <td className="right" style={{ color: '#9AA2AA', ...nums, ...tdPad }}>
                              {formatKRW(mg.totalServiceFee)}
                            </td>
                            <td className="right" style={{ color: mgDeduct > 0 ? '#D14848' : '#9AA2AA', ...nums, ...tdPad }}>
                              {mgDeduct > 0 ? formatKRW(mgDeduct) : '-'}
                            </td>
                            <td className="right" style={{ color: '#9AA2AA', ...nums, ...tdPad }}>
                              {mgNetCarry > 0 ? formatKRW(mgNetCarry) : mgNetCarry < 0 ? `+${formatKRW(Math.abs(mgNetCarry))}` : '-'}
                            </td>
                            <td className="right" style={{ fontWeight: 600, color: 'var(--text-primary)', ...nums, ...tdPad }}>
                              {formatKRW(mg.totalFinal)}
                            </td>
                            <td style={tdPad} />
                          </>
                        );
                      })()}
                    </tr>

                    {/* Individual settlement rows */}
                    {expanded && mg.items.map((s, idx) => {
                      const badge = getStatusBadge(s.status);
                      const rowKey = `${s.settlementDate}-${s.revenueYearMonth}-${idx}`;
                      const isRowExpanded = expandedRow === rowKey;
                      const b = s.breakdown;

                      return (
                        <Fragment key={rowKey}>
                          <tr
                            className="expandable"
                            onClick={() => toggleRow(rowKey)}
                            style={{ backgroundColor: isRowExpanded ? '#F5F8FA' : undefined }}
                          >
                            <td style={tdPad}>
                              <div style={{ fontWeight: 500, color: 'var(--text-secondary)', paddingLeft: 16 }}>
                                {formatPeriod(s.revenueFrom, s.revenueTo)}
                              </div>
                            </td>
                            <td style={{ ...tdPad, color: 'var(--text-secondary)' }}>
                              {formatSettlementDate(s.settlementDate)}
                              {s.settlementType && (
                                <span style={{ fontSize: 11, color: '#9AA2AA', marginLeft: 6 }}>
                                  {s.settlementType === 'WEEKLY' ? '주간' : s.settlementType === 'RESERVE' ? '유보금' : s.settlementType}
                                </span>
                              )}
                            </td>
                            {(() => {
                              const rowNetCarry = b.lastAmount - b.debtOfLastWeek - b.pendingReleasedAmount;
                              const rowDeduct = s.settlementAmount - b.serviceFee - rowNetCarry - s.finalAmount;
                              return (
                                <>
                                  <td className="right" style={{ color: 'var(--text-secondary)', ...nums, ...tdPad }}>
                                    {formatKRW(s.settlementAmount)}
                                  </td>
                                  <td className="right" style={{ color: '#9AA2AA', ...nums, ...tdPad }}>
                                    {b.serviceFee > 0 ? formatKRW(b.serviceFee) : '-'}
                                  </td>
                                  <td className="right" style={{ color: rowDeduct > 0 ? '#D14848' : '#9AA2AA', ...nums, ...tdPad }}>
                                    {rowDeduct > 0 ? formatKRW(rowDeduct) : '-'}
                                  </td>
                                  <td className="right" style={{ ...nums, ...tdPad }}>
                                    {rowNetCarry > 0 ? (
                                      <span style={{ color: '#9AA2AA' }}>{formatKRW(rowNetCarry)}</span>
                                    ) : rowNetCarry < 0 ? (
                                      <span style={{ color: '#4A90D9' }} title="전주미지급/보류해제 수령">+{formatKRW(Math.abs(rowNetCarry))}</span>
                                    ) : (
                                      <span style={{ color: 'var(--text-muted)' }}>-</span>
                                    )}
                                  </td>
                                  <td className="right" style={{ fontWeight: 600, color: 'var(--text-primary)', ...nums, ...tdPad }}>
                                    {formatKRW(s.finalAmount)}
                                  </td>
                                </>
                              );
                            })()}
                            <td style={{ ...tdPad, textAlign: 'center' }}>
                              <span style={{
                                display: 'inline-block',
                                padding: '3px 10px',
                                borderRadius: 12,
                                fontSize: 12,
                                fontWeight: 500,
                                backgroundColor: badge.bg,
                                color: badge.color,
                                whiteSpace: 'nowrap',
                              }}>
                                {badge.label}
                              </span>
                            </td>
                          </tr>

                          {/* Expanded detail row */}
                          {isRowExpanded && (() => {
                            const detailRow = (label: string, amount: number, category: 'cost' | 'carry' | 'receive') => {
                              if (amount === 0) return null;
                              const isCost = category === 'cost';
                              const isReceive = category === 'receive';
                              return (
                                <tr key={label}>
                                  <td style={{ padding: '5px 0', fontSize: 13, color: isCost ? '#D14848' : isReceive ? '#4A90D9' : '#9AA2AA' }}>
                                    {label}
                                  </td>
                                  <td style={{ padding: '5px 0', fontSize: 13, textAlign: 'right', color: isCost ? '#D14848' : isReceive ? '#4A90D9' : '#9AA2AA', ...nums }}>
                                    {isCost ? '−' : isReceive ? '+' : '−'}{formatKRW(Math.abs(amount))}
                                  </td>
                                </tr>
                              );
                            };

                            return (
                              <tr>
                                <td colSpan={8} style={{ padding: 0, background: '#FAFBFC' }}>
                                  <div style={{ padding: '16px 20px 16px 40px' }}>
                                    <div style={{ display: 'flex', gap: 32 }}>
                                      {/* 실제 비용 */}
                                      <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: '#D14848', marginBottom: 8 }}>
                                          실제 비용
                                        </div>
                                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                          <tbody>
                                            {detailRow('판매수수료', b.serviceFee, 'cost')}
                                            {detailRow('쿠런티 수수료', b.couranteeFee, 'cost')}
                                            {detailRow('기타 공제', b.deductionAmount, 'cost')}
                                            {detailRow('셀러 할인쿠폰', b.sellerDiscountCoupon, 'cost')}
                                            {detailRow('다운로드 쿠폰', b.downloadableCoupon, 'cost')}
                                            {detailRow('스토어 수수료 할인', b.storeFeeDiscount, 'receive')}
                                          </tbody>
                                        </table>
                                      </div>

                                      {/* 이월 / 수령 */}
                                      <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: '#9AA2AA', marginBottom: 8 }}>
                                          이월 / 보류
                                        </div>
                                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                          <tbody>
                                            {detailRow('이월액 (주간 30%)', b.lastAmount, 'carry')}
                                            {detailRow('전주 미지급분', b.debtOfLastWeek, 'receive')}
                                            {detailRow('보류 해제', b.pendingReleasedAmount, 'receive')}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>

                                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
                                      <tbody>
                                        <tr style={{ borderTop: '1px solid #E8EBEF' }}>
                                          <td style={{ padding: '8px 0', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                                            실지급액
                                          </td>
                                          <td style={{ padding: '8px 0', fontSize: 13, fontWeight: 600, textAlign: 'right', color: 'var(--text-primary)', ...nums }}>
                                            {formatKRW(s.finalAmount)}
                                          </td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            );
                          })()}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}

              {/* Grand total row */}
              {totalNonZero > 0 && (
                <tr className="total-row">
                  <td style={{ fontWeight: 600, color: 'var(--text-primary)', ...tdPad }}>합계</td>
                  <td style={tdPad} />
                  <td className="right" style={{ fontWeight: 600, color: 'var(--text-primary)', ...nums, ...tdPad }}>
                    {formatKRW(grandTotals.totalSettlement)}
                  </td>
                  <td className="right" style={{ color: '#9AA2AA', ...nums, ...tdPad }}>
                    {formatKRW(grandTotals.totalServiceFee)}
                  </td>
                  <td className="right" style={{ color: grandTotals.totalDeduction > 0 ? '#D14848' : '#9AA2AA', ...nums, ...tdPad }}>
                    {grandTotals.totalDeduction > 0 ? formatKRW(grandTotals.totalDeduction) : '-'}
                  </td>
                  <td className="right" style={{ color: '#9AA2AA', ...nums, ...tdPad }}>
                    {grandTotals.netCarryover > 0 ? formatKRW(grandTotals.netCarryover) : grandTotals.netCarryover < 0 ? `+${formatKRW(Math.abs(grandTotals.netCarryover))}` : '-'}
                  </td>
                  <td className="right" style={{ fontWeight: 600, color: 'var(--text-primary)', ...nums, ...tdPad }}>
                    {formatKRW(grandTotals.totalFinal)}
                  </td>
                  <td style={tdPad} />
                </tr>
              )}

              {/* Empty state */}
              {totalNonZero === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                    {selectedMonth
                      ? `${formatYearMonth(selectedMonth)} 정산 데이터가 없습니다.`
                      : `${selectedYear}년 정산 데이터가 없습니다.`
                    }
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- 3. Monthly Summary ---- */}
      {monthGroups.length > 0 && (
        <div className="section">
          <div className="section-header">
            <span className="section-title">월별 요약</span>
          </div>

          {/* Timing lag notice */}
          <div style={{
            padding: '8px 16px',
            fontSize: 12,
            color: '#9AA2AA',
            borderBottom: '1px solid var(--border-light)',
            lineHeight: 1.5,
          }}>
            정산은 매출인식 기준 집계로, 실제 판매 시점과 1~2개월 차이가 있습니다
          </div>

          <div className="section-body">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ color: 'var(--text-muted)' }}>월</th>
                  <th className="right" style={{ color: 'var(--text-muted)' }}>매출액</th>
                  <th className="right" style={{ color: 'var(--text-muted)' }}>수수료</th>
                  <th className="right" style={{ color: 'var(--text-muted)' }}>차감</th>
                  <th className="right" style={{ color: 'var(--text-muted)' }}>순이월</th>
                  <th className="right" style={{ color: 'var(--text-muted)' }}>지급액</th>
                  <th className="right" style={{ color: 'var(--text-muted)' }}>지급 완료</th>
                  <th className="right" style={{ color: 'var(--text-muted)' }} title="(지급액 + 순이월) / 매출액">정산율</th>
                  <th className="right" style={{ color: 'var(--text-muted)' }} title="지급액 / 매출액">회수율</th>
                </tr>
              </thead>
              <tbody>
                {monthGroups.map((mg) => {
                  const mgNetCarry = mg.totalLastAmount - mg.totalDebtOfLastWeek - mg.totalPendingReleased;
                  const mgDeduct = mg.totalSettlement - mg.totalServiceFee - mgNetCarry - mg.totalFinal;
                  const settlementRate = mg.totalSettlement > 0
                    ? ((mg.totalFinal + mgNetCarry) / mg.totalSettlement * 100).toFixed(1)
                    : '-';
                  const recoveryRate = mg.totalSettlement > 0
                    ? (mg.totalFinal / mg.totalSettlement * 100).toFixed(1)
                    : '-';
                  return (
                    <tr key={mg.yearMonth}>
                      <td style={{ fontWeight: 500, color: 'var(--text-secondary)', ...tdPad }}>
                        {formatShortMonth(mg.yearMonth)}
                      </td>
                      <td className="right" style={{ color: 'var(--text-secondary)', ...nums, ...tdPad }}>
                        {formatKRW(mg.totalSettlement)}
                      </td>
                      <td className="right" style={{ color: '#9AA2AA', ...nums, ...tdPad }}>
                        {formatKRW(mg.totalServiceFee)}
                      </td>
                      <td className="right" style={{ color: mgDeduct > 0 ? '#D14848' : '#9AA2AA', ...nums, ...tdPad }}>
                        {mgDeduct > 0 ? formatKRW(mgDeduct) : '-'}
                      </td>
                      <td className="right" style={{ color: '#9AA2AA', ...nums, ...tdPad }}>
                        {mgNetCarry > 0 ? formatKRW(mgNetCarry) : mgNetCarry < 0 ? `+${formatKRW(Math.abs(mgNetCarry))}` : '-'}
                      </td>
                      <td className="right" style={{ fontWeight: 600, color: 'var(--text-primary)', ...nums, ...tdPad }}>
                        {formatKRW(mg.totalFinal)}
                      </td>
                      <td className="right" style={{ ...nums, ...tdPad }}>
                        {mg.totalPaid > 0 ? (
                          <span style={{ color: '#2E7D32' }}>{formatKRW(mg.totalPaid)}</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>-</span>
                        )}
                      </td>
                      <td className="right" style={{ color: '#9AA2AA', ...nums, ...tdPad }} title="(지급액 + 순이월) / 매출액">
                        {settlementRate}%
                      </td>
                      <td className="right" style={{ color: '#9AA2AA', ...nums, ...tdPad }} title="지급액 / 매출액">
                        {recoveryRate}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- 4. Footnote ---- */}
      <div
        style={{
          background: '#F8F9FB',
          border: '1px solid var(--border-light)',
          borderRadius: 10,
          padding: '14px 20px',
          marginBottom: 20,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
          용어 설명
        </div>
        <div style={{ fontSize: 12, color: '#9AA2AA', lineHeight: 1.6 }}>
          <strong>정산 공식</strong>: 매출액 − 수수료 − 차감 − 순이월 = 지급액. <strong>정산율</strong> = (지급액 + 순이월) / 매출액.
        </div>
        <div style={{ fontSize: 12, color: '#9AA2AA', lineHeight: 1.6, marginTop: 2 }}>
          <strong>회수율</strong> = 지급액 / 매출액. 해당 기간 실제 현금 회수 비율입니다. 이월분 반환 시 100%에 수렴합니다.
        </div>
        <div style={{ fontSize: 12, color: '#9AA2AA', lineHeight: 1.6, marginTop: 2 }}>
          <strong>차감</strong> = 반품/취소/쿠폰 차감 + 유보금 보류 등. 매출액에서 수수료·이월·지급액을 뺀 잔여 공제액입니다.
        </div>
        <div style={{ fontSize: 12, color: '#9AA2AA', lineHeight: 1.6, marginTop: 2 }}>
          <strong>순이월</strong> = 이월액 − 전주미지급분 − 보류해제. 주간 정산 시 매출의 30%를 다음 주로 이월하며, 이후 반환됩니다.
        </div>
      </div>
    </AppShell>
  );
}
