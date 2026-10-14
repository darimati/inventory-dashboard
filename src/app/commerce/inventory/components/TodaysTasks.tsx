'use client';

import React from 'react';
import { formatNumber } from '@/lib/helpers';
import { getSafetyDays, SKU_STATUS_CONFIG } from '../constants';
import type { ProductSummary, InboundRequest, EzadminItem, OptionRow } from '../types';

/* ------------------------------------------------------------------ */
/*  Task item types                                                    */
/* ------------------------------------------------------------------ */

export interface TaskItem {
  category: 'urgent_order' | 'inbound_needed' | 'ea_order_needed' | 'tracking_needed' | 'inbound_delayed' | 'unmapped_sku';
  product: string;
  option?: string;
  sentence: string;
  helper: string;
  dotColor: string;
  targetSection: string;
  requestId?: string;
  quantity?: number;
  buttonLabel: string;
  buttonAction: 'inbound' | 'order' | 'coupang' | 'scroll';
}

/* ------------------------------------------------------------------ */
/*  Build tasks from inventory data                                    */
/* ------------------------------------------------------------------ */

export function buildTasks(
  summaries: ProductSummary[],
  inboundRequests: InboundRequest[],
  ezadminItems: EzadminItem[],
  optionRows: OptionRow[],
): TaskItem[] {
  const tasks: TaskItem[] = [];
  const today = new Date(Date.now() + 9 * 3_600_000);
  const todayStr = today.toISOString().slice(0, 10);

  const activeInbound = inboundRequests.filter(r =>
    !['arrived', 'rejected', 'cancelled'].includes(r.status)
  );

  // 3PL domestic stock per product (export excluded)
  const ezDomesticByProduct = new Map<string, number>();
  for (const e of ezadminItems) {
    if (!e.mapped || e.stockType !== 'finished' || e.variantType !== 'domestic') continue;
    ezDomesticByProduct.set(e.product, (ezDomesticByProduct.get(e.product) ?? 0) + e.availableStock);
  }

  /* --- Per-product checks --- */
  for (const s of summaries) {
    const safetyDays = getSafetyDays(s.product);
    const rgDaysLeft = s.dailyAvg > 0
      ? Math.floor(s.rocketStock / s.dailyAvg)
      : (s.rocketStock > 0 ? null : 0);
    const hasActiveInbound = activeInbound.some(r => r.product === s.product);
    const ezDomestic = ezDomesticByProduct.get(s.product) ?? 0;

    // OOS or daysLeft <= 14 AND no active inbound
    if (rgDaysLeft !== null && rgDaysLeft <= 14 && !hasActiveInbound) {
      const recommendedQty = Math.max(0, Math.ceil(s.dailyAvg * safetyDays) - s.rocketStock);
      const isOOS = rgDaysLeft === 0;
      const dotColor = isOOS ? '#E8A0B4' : '#8FAEE0';

      // Determine button: 3PL enough → 이관, otherwise → 발주
      const sales30d = Math.round(s.dailyAvg30 * 30);
      const canTransfer = ezDomestic >= sales30d && ezDomestic > 0;

      const sentence = isOOS
        ? `${s.product} 로켓그로스 품절`
        : `${s.product} 로켓그로스 재고 ${rgDaysLeft}일치`;

      const helperParts: string[] = [];
      if (ezDomestic > 0) helperParts.push(`3PL 국내 ${formatNumber(ezDomestic)}개 보유`);
      if (recommendedQty > 0) helperParts.push(`권장 ${canTransfer ? '이관' : '발주'} ${formatNumber(recommendedQty)}개`);

      tasks.push({
        category: isOOS ? 'urgent_order' : 'inbound_needed',
        product: s.product,
        sentence,
        helper: helperParts.join(' / '),
        dotColor,
        targetSection: 'section-active',
        quantity: recommendedQty,
        buttonLabel: canTransfer ? '이관 등록' : '발주 등록',
        buttonAction: canTransfer ? 'inbound' : 'order',
      });
    }
  }

  /* --- Per-inbound-request checks --- */
  for (const req of activeInbound) {
    const optionLabel = req.option ? `${req.product} ${req.option}` : req.product;

    // Inbound delayed
    if (req.coupang_deadline && req.coupang_deadline < todayStr && !req.arrived_at) {
      const dlDate = new Date(req.coupang_deadline + 'T00:00:00');
      const diff = Math.round((today.getTime() - dlDate.getTime()) / 86_400_000);
      tasks.push({
        category: 'inbound_delayed',
        product: req.product,
        option: req.option ?? undefined,
        sentence: `${optionLabel} 입고 기한 ${diff}일 초과`,
        helper: `${formatNumber(req.quantity)}개 / 기한 ${req.coupang_deadline.slice(5).replace('-', '/')}`,
        dotColor: '#E8A0B4',
        targetSection: 'section-active',
        requestId: req.id,
        buttonLabel: '쿠팡 확인',
        buttonAction: 'coupang',
      });
      continue;
    }

    // EA order needed
    if (!req.ea_ordered_at) {
      tasks.push({
        category: 'ea_order_needed',
        product: req.product,
        option: req.option ?? undefined,
        sentence: `${optionLabel} 이지어드민 출고 요청 필요`,
        helper: `${formatNumber(req.quantity)}개${req.coupang_deadline ? ' / 기한 ' + req.coupang_deadline.slice(5).replace('-', '/') : ''}`,
        dotColor: '#8FAEE0',
        targetSection: 'section-active',
        requestId: req.id,
        buttonLabel: '출고 요청',
        buttonAction: 'scroll',
      });
      continue;
    }

    // Tracking needed
    if (req.ea_ordered_at && !req.tracking_entered_at) {
      tasks.push({
        category: 'tracking_needed',
        product: req.product,
        option: req.option ?? undefined,
        sentence: `${optionLabel} 쿠팡 송장번호 입력 필요`,
        helper: `${formatNumber(req.quantity)}개${req.coupang_deadline ? ' / 기한 ' + req.coupang_deadline.slice(5).replace('-', '/') : ''}`,
        dotColor: '#8FAEE0',
        targetSection: 'section-active',
        requestId: req.id,
        buttonLabel: '송장 입력',
        buttonAction: 'coupang',
      });
    }
  }

  /* --- Unmapped SKU --- */
  const unmappedCount = ezadminItems.filter(e => !e.mapped).length;
  if (unmappedCount > 0) {
    tasks.push({
      category: 'unmapped_sku',
      product: '',
      sentence: `${unmappedCount}개 SKU가 제품과 연결되지 않음`,
      helper: '',
      dotColor: '#CDD2D8',
      targetSection: 'section-unmapped',
      buttonLabel: '매핑하기',
      buttonAction: 'scroll',
    });
  }

  // Sort: delayed first, then OOS, then ≤14d, then inbound actions, then unmapped
  const priorityMap: Record<TaskItem['category'], number> = {
    inbound_delayed: 0, urgent_order: 1, tracking_needed: 2,
    ea_order_needed: 3, inbound_needed: 4, unmapped_sku: 5,
  };
  tasks.sort((a, b) => priorityMap[a.category] - priorityMap[b.category]);
  return tasks;
}

/* ------------------------------------------------------------------ */
/*  Summary count bar                                                   */
/* ------------------------------------------------------------------ */

interface SummaryCard {
  label: string;
  desc: string;
  count: number;
  color: string;
}

function SummaryCards({ optionRows, inboundRequests }: {
  optionRows: OptionRow[];
  inboundRequests: InboundRequest[];
}) {
  const activeInbound = inboundRequests.filter(r =>
    !['arrived', 'rejected', 'cancelled'].includes(r.status)
  );

  const cards: SummaryCard[] = [
    { label: '긴급 조치', desc: '재고 0 또는 소진 0일', count: optionRows.filter(r => r.status === 'critical').length, color: SKU_STATUS_CONFIG.critical.color },
    { label: '주의 재고', desc: '30일 이하 소진 예상', count: optionRows.filter(r => r.status === 'warning').length, color: SKU_STATUS_CONFIG.warning.color },
    { label: '이관 가능', desc: '3PL → RG 이관 가능', count: optionRows.filter(r => r.status === 'transfer_ok').length, color: SKU_STATUS_CONFIG.transfer_ok.color },
    { label: '진행 중', desc: '입고/이관 진행 중', count: activeInbound.length, color: '#8FAEE0' },
  ];

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 12, padding: '16px',
      borderBottom: '1px solid #E4E8EC',
    }}>
      {cards.map(c => (
        <div key={c.label} style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 6,
          padding: '16px 8px',
          border: '1px solid #E4E8EC', borderRadius: 10,
          background: '#FAFBFC', minHeight: 80,
        }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#565D64', lineHeight: 1 }}>{c.label}</span>
          <span style={{
            fontSize: 24, fontWeight: 600, color: c.count > 0 ? c.color : '#CDD2D8',
            fontVariantNumeric: 'tabular-nums', lineHeight: 1,
          }}>
            {c.count}<span style={{ fontSize: 13, fontWeight: 500 }}>건</span>
          </span>
          <span style={{ fontSize: 11, color: '#9AA2AA', lineHeight: 1 }}>{c.desc}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SKU-level action list (from optionRows)                            */
/* ------------------------------------------------------------------ */

function SkuActionList({ optionRows, onInboundClick, onOrderClick }: {
  optionRows: OptionRow[];
  onInboundClick?: (product: string, qty: number) => void;
  onOrderClick?: () => void;
}) {
  const actionRows = optionRows.filter(r => r.status !== 'stable');
  if (actionRows.length === 0) return null;

  // Sort: critical first, then shortage, warning, transfer_ok
  const priority: Record<string, number> = { critical: 0, shortage: 1, warning: 2, transfer_ok: 3 };
  const sorted = [...actionRows].sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9));

  return (
    <div>
      {sorted.map((row, i) => {
        const statusCfg = SKU_STATUS_CONFIG[row.status] ?? SKU_STATUS_CONFIG.stable;
        const depText = row.daysLeft30 !== null ? `소진 ${row.daysLeft30}일` : '';
        const desc = row.status === 'critical'
          ? `RG ${formatNumber(row.unitStock)}개, 3PL ${formatNumber(row.ezDomesticStock)}개 → ${row.transferable ? '3PL에서 RG로 이관 필요' : '발주 필요'}`
          : `RG ${depText}, 3PL ${formatNumber(row.ezDomesticStock)}개 → ${row.actionLabel}`;

        return (
          <div
            key={row.vendorItemId || `${row.product}-${row.option}`}
            style={{
              padding: '10px 16px',
              borderBottom: i < sorted.length - 1 ? '1px solid #F2F4F7' : 'none',
              display: 'flex', alignItems: 'center', gap: 10,
              minHeight: 44,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusCfg.color, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1D21' }}>
                {row.product} {row.option}
              </span>
              <span style={{ fontSize: 12, color: '#9AA2AA', marginLeft: 8 }}>
                {desc}
              </span>
            </div>
            {row.actionLabel !== '—' && (
              <button
                onClick={() => {
                  if (row.actionLabel.includes('이관') && onInboundClick) {
                    const qty = Math.max(0, Math.ceil(row.dailyAvg30 * 21) - row.unitStock);
                    onInboundClick(row.product, qty);
                  } else if (onOrderClick) {
                    onOrderClick();
                  }
                }}
                style={{
                  height: 28, padding: '0 10px', fontSize: 12, fontWeight: 600,
                  background: '#1A1D21', color: '#fff', border: 'none', borderRadius: 6,
                  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >
                {row.actionLabel}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  TodaysTasks component — summary counts + action list                */
/* ------------------------------------------------------------------ */

const actionBtnStyle: React.CSSProperties = {
  height: 32, padding: '0 14px', fontSize: 13, fontWeight: 600,
  background: '#1A1D21', color: '#fff', border: 'none', borderRadius: 8,
  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
};

export function TodaysTasks({ tasks, optionRows, inboundRequests, onInboundClick, onOrderClick, onScrollToSection }: {
  tasks: TaskItem[];
  optionRows: OptionRow[];
  inboundRequests: InboundRequest[];
  onInboundClick?: (product: string, qty: number) => void;
  onOrderClick?: () => void;
  onScrollToSection?: (id: string) => void;
}) {
  const visible = tasks.slice(0, 8);
  const remaining = tasks.length - visible.length;

  return (
    <div id="section-tasks" style={{
      border: '1px solid #CBD1D8', borderRadius: 12,
      background: '#fff', overflow: 'hidden',
    }}>
      {/* Section header */}
      <div style={{
        padding: '14px 16px',
        borderBottom: '1px solid #E4E8EC',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#1A1D21' }}>지금 할 일</span>
        {visible.length > 0 && (
          <span style={{ fontSize: 12, color: '#9AA2AA' }}>{tasks.length}</span>
        )}
      </div>

      {/* Summary cards */}
      <SummaryCards optionRows={optionRows} inboundRequests={inboundRequests} />

      {/* SKU-level action list */}
      <SkuActionList optionRows={optionRows} onInboundClick={onInboundClick} onOrderClick={onOrderClick} />

      {/* Inbound/process task list */}
      {visible.length > 0 && (
        <div>
          {visible.map((t, i) => (
            <div
              key={i}
              style={{
                padding: '10px 16px',
                borderTop: '1px solid #F2F4F7',
                display: 'flex', alignItems: 'center', gap: 10,
                minHeight: 44,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.dotColor, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#1A1D21' }}>{t.sentence}</span>
                {t.helper && (
                  <span style={{ fontSize: 12, color: '#9AA2AA', marginLeft: 8 }}>{t.helper}</span>
                )}
              </div>
              <div style={{ flexShrink: 0 }}>
                {renderButton(t, onInboundClick, onOrderClick, onScrollToSection)}
              </div>
            </div>
          ))}
          {remaining > 0 && (
            <div style={{ padding: '8px 16px', fontSize: 12, color: '#9AA2AA', textAlign: 'center' }}>
              외 {remaining}건
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function renderButton(
  t: TaskItem,
  onInboundClick?: (product: string, qty: number) => void,
  onOrderClick?: () => void,
  onScrollToSection?: (id: string) => void,
): React.ReactNode {
  switch (t.buttonAction) {
    case 'inbound':
      return onInboundClick ? (
        <button onClick={() => onInboundClick(t.product, t.quantity || 150)} style={actionBtnStyle}>
          {t.buttonLabel}
        </button>
      ) : null;

    case 'order':
      return onOrderClick ? (
        <button onClick={() => onOrderClick()} style={actionBtnStyle}>
          {t.buttonLabel}
        </button>
      ) : null;

    case 'coupang':
      return (
        <button
          onClick={() => window.open('https://wing.coupang.com/tenants/direct-wing/vendor-inventory/inbound/management', '_blank')}
          style={actionBtnStyle}
        >
          {t.buttonLabel}
        </button>
      );

    case 'scroll':
      return (
        <button
          onClick={() => onScrollToSection?.(t.targetSection)}
          style={{ ...actionBtnStyle, background: '#F2F4F7', color: '#565D64' }}
        >
          {t.buttonLabel}
        </button>
      );

    default:
      return null;
  }
}
