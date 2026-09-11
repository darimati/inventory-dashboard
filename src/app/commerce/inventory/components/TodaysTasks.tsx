'use client';

import React from 'react';
import { formatNumber } from '@/lib/helpers';
import { getSafetyDays } from '../constants';
import type { ProductSummary, InboundRequest, EzadminItem } from '../types';

/* ------------------------------------------------------------------ */
/*  Task item types                                                    */
/* ------------------------------------------------------------------ */

export interface TaskItem {
  category: 'urgent_order' | 'inbound_needed' | 'ea_order_needed' | 'tracking_needed' | 'inbound_delayed' | 'unmapped_sku';
  product: string;
  option?: string;
  detail: string;
  reason: string;
  deadline: string;
  targetSection: string;
  requestId?: string;
  quantity?: number;
}

const CATEGORY_META: Record<TaskItem['category'], { label: string; color: string; bg: string; priority: number; actionLabel: string }> = {
  inbound_delayed: { label: '긴급',   color: '#B03F3B', bg: '#FBE9E8', priority: 0, actionLabel: '쿠팡 확인' },
  urgent_order:    { label: '긴급',   color: '#B03F3B', bg: '#FBE9E8', priority: 1, actionLabel: '이관 등록' },
  tracking_needed: { label: '주의',   color: '#A8712A', bg: '#FDF4E7', priority: 2, actionLabel: '송장 입력' },
  ea_order_needed: { label: '주의',   color: '#A8712A', bg: '#FDF4E7', priority: 3, actionLabel: '3PL 출고 요청' },
  inbound_needed:  { label: '주의',   color: '#A8712A', bg: '#FDF4E7', priority: 4, actionLabel: '이관 등록' },
  unmapped_sku:    { label: '확인 필요', color: '#6E767E', bg: '#F1F3F6', priority: 5, actionLabel: '매핑하기' },
};

/* ------------------------------------------------------------------ */
/*  Build tasks from inventory data                                    */
/* ------------------------------------------------------------------ */

export function buildTasks(
  summaries: ProductSummary[],
  inboundRequests: InboundRequest[],
  ezadminItems: EzadminItem[],
): TaskItem[] {
  const tasks: TaskItem[] = [];
  const today = new Date(Date.now() + 9 * 3_600_000);
  const todayStr = today.toISOString().slice(0, 10);

  const activeInbound = inboundRequests.filter(r =>
    !['arrived', 'rejected', 'cancelled'].includes(r.status)
  );

  /* --- Per-product checks --- */
  for (const s of summaries) {
    const safetyDays = getSafetyDays(s.product);
    const rgDaysLeft = s.dailyAvg > 0
      ? Math.floor(s.rocketStock / s.dailyAvg)
      : (s.rocketStock > 0 ? null : 0);
    const hasActiveInbound = activeInbound.some(r => r.product === s.product);

    // 1. 긴급 발주: RG ≤ 10일 AND 진행 중 입고 없음
    if (rgDaysLeft !== null && rgDaysLeft <= 10 && !hasActiveInbound) {
      const recommendedQty = Math.max(0, Math.ceil(s.dailyAvg * safetyDays) - s.rocketStock);
      tasks.push({
        category: 'urgent_order',
        product: s.product,
        reason: `RG ${formatNumber(s.rocketStock)}개 (${rgDaysLeft}일치) · 진행 중 입고 없음`,
        detail: `RG ${formatNumber(s.rocketStock)}개 (${rgDaysLeft}일치)`,
        deadline: `권장 입고 ${formatNumber(recommendedQty)}개`,
        targetSection: 'section-active',
        quantity: recommendedQty,
      });
    }
    // 2. 입고 필요: RG ≤ 21일 AND 3PL 재고 있음 AND 이관 없음
    else if (rgDaysLeft !== null && rgDaysLeft <= 21 && s.primarySkuStock > 0 && !hasActiveInbound) {
      const recommendedQty = Math.max(0, Math.ceil(s.dailyAvg * safetyDays) - s.rocketStock);
      tasks.push({
        category: 'inbound_needed',
        product: s.product,
        reason: `RG ${rgDaysLeft}일치 남음 · 3PL ${formatNumber(s.primarySkuStock)}개 보유`,
        detail: `RG ${formatNumber(s.rocketStock)}개 (${rgDaysLeft}일치)`,
        deadline: `권장 입고 ${formatNumber(recommendedQty)}개`,
        targetSection: 'section-active',
        quantity: recommendedQty,
      });
    }
  }

  /* --- Per-inbound-request checks --- */
  for (const req of activeInbound) {
    const optionLabel = req.option ? `${req.product} ${req.option}` : req.product;

    // 3. 입고 지연
    if (req.coupang_deadline && req.coupang_deadline < todayStr && !req.arrived_at) {
      const dlDate = new Date(req.coupang_deadline + 'T00:00:00');
      const diff = Math.round((today.getTime() - dlDate.getTime()) / 86_400_000);
      tasks.push({
        category: 'inbound_delayed',
        product: req.product,
        option: req.option ?? undefined,
        reason: `입고 기한 ${diff}일 초과`,
        detail: `${formatNumber(req.quantity)}개`,
        deadline: `도착기한 ${req.coupang_deadline.slice(5).replace('-', '/')}`,
        targetSection: 'section-active',
        requestId: req.id,
      });
      continue;
    }

    // 4. 이지어드민 발주 필요
    if (!req.ea_ordered_at) {
      tasks.push({
        category: 'ea_order_needed',
        product: req.product,
        option: req.option ?? undefined,
        reason: '이지어드민 출고 요청 미완료',
        detail: `${formatNumber(req.quantity)}개`,
        deadline: req.coupang_deadline ? `도착기한 ${req.coupang_deadline.slice(5).replace('-', '/')}` : '',
        targetSection: 'section-active',
        requestId: req.id,
      });
      continue;
    }

    // 5. 송장 입력 필요
    if (req.ea_ordered_at && !req.tracking_entered_at) {
      tasks.push({
        category: 'tracking_needed',
        product: req.product,
        option: req.option ?? undefined,
        reason: '출고 완료 · 쿠팡 송장번호 입력 필요',
        detail: `${formatNumber(req.quantity)}개`,
        deadline: req.coupang_deadline ? `도착기한 ${req.coupang_deadline.slice(5).replace('-', '/')}` : '',
        targetSection: 'section-active',
        requestId: req.id,
      });
    }
  }

  /* --- 6. 미매핑 SKU --- */
  const unmappedCount = ezadminItems.filter(e => !e.mapped).length;
  if (unmappedCount > 0) {
    tasks.push({
      category: 'unmapped_sku',
      product: '',
      reason: `${unmappedCount}개 SKU가 제품과 연결되지 않음`,
      detail: '',
      deadline: '',
      targetSection: 'section-unmapped',
    });
  }

  // Sort by priority
  tasks.sort((a, b) => CATEGORY_META[a.category].priority - CATEGORY_META[b.category].priority);
  return tasks;
}

/* ------------------------------------------------------------------ */
/*  TodaysTasks component — card rows                                  */
/* ------------------------------------------------------------------ */

const badgeStyle = (meta: typeof CATEGORY_META[TaskItem['category']]): React.CSSProperties => ({
  display: 'inline-block', fontSize: 11.5, fontWeight: 550,
  padding: '2px 8px', borderRadius: 6,
  color: meta.color, background: meta.bg,
  whiteSpace: 'nowrap', flexShrink: 0,
});

const primaryBtnStyle: React.CSSProperties = {
  height: 36, padding: '0 14px', fontSize: 13, fontWeight: 550,
  background: '#1A1D21', color: '#fff', border: 'none', borderRadius: 8,
  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
};

const secondaryBtnStyle: React.CSSProperties = {
  ...primaryBtnStyle, background: '#F2F4F7', color: '#565D64',
};

export function TodaysTasks({ tasks, onInboundClick, onScrollToSection }: {
  tasks: TaskItem[];
  onInboundClick?: (product: string, qty: number) => void;
  onScrollToSection?: (id: string) => void;
}) {
  const visible = tasks.slice(0, 8);
  const remaining = tasks.length - visible.length;

  return (
    <div id="section-tasks" className="section">
      {/* Section header */}
      <div style={{ padding: '16px 20px', borderBottom: visible.length > 0 ? '1px solid var(--border-light)' : 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 style={{ fontSize: 14.5, fontWeight: 600, color: '#1F2328', margin: 0 }}>오늘 할 일</h2>
        {visible.length > 0 && (
          <span style={{ fontSize: 12, color: '#6E767E' }}>{tasks.length}</span>
        )}
      </div>

      {visible.length === 0 ? (
        <div style={{ padding: '24px 20px', fontSize: 13, fontWeight: 450, color: '#6E767E', textAlign: 'center' }}>
          조치가 필요한 항목이 없습니다
        </div>
      ) : (
        <div>
          {visible.map((t, i) => {
            const meta = CATEGORY_META[t.category];
            const title = t.option ? `${t.product} ${t.option}` : t.product || '미매핑 SKU';
            return (
              <div
                key={i}
                style={{
                  minHeight: 64, padding: '14px 20px',
                  borderBottom: i < visible.length - 1 ? '1px solid #F2F4F7' : 'none',
                  display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4,
                }}
              >
                {/* Line 1: badge + title + detail + action button */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={badgeStyle(meta)}>{meta.label}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: '#1A1D21' }}>{title}</span>
                  {t.detail && (
                    <span style={{ fontSize: 12.5, fontWeight: 450, color: '#6E767E' }}>
                      {t.detail}
                    </span>
                  )}
                  <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
                    {renderActionButton(t, onInboundClick, onScrollToSection)}
                  </div>
                </div>
                {/* Line 2: reason + deadline */}
                <div style={{ fontSize: 12.5, fontWeight: 450, color: '#6E767E', paddingLeft: 0 }}>
                  {[t.reason, t.deadline].filter(Boolean).join(' · ')}
                </div>
              </div>
            );
          })}
          {remaining > 0 && (
            <div style={{ padding: '10px 20px', fontSize: 12, color: '#6E767E', textAlign: 'center' }}>
              외 {remaining}건
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function renderActionButton(
  t: TaskItem,
  onInboundClick?: (product: string, qty: number) => void,
  onScrollToSection?: (id: string) => void,
): React.ReactNode {
  switch (t.category) {
    case 'urgent_order':
    case 'inbound_needed':
      return onInboundClick ? (
        <button onClick={() => onInboundClick(t.product, t.quantity || 150)} style={primaryBtnStyle}>
          이관 등록
        </button>
      ) : null;

    case 'inbound_delayed':
      return (
        <button
          onClick={() => window.open('https://wing.coupang.com/tenants/direct-wing/vendor-inventory/inbound/management', '_blank')}
          style={primaryBtnStyle}
        >
          쿠팡 확인
        </button>
      );

    case 'tracking_needed':
      return (
        <button
          onClick={() => window.open('https://wing.coupang.com/tenants/direct-wing/vendor-inventory/inbound/management', '_blank')}
          style={primaryBtnStyle}
        >
          송장 입력
        </button>
      );

    case 'ea_order_needed':
      return (
        <button
          onClick={() => {
            const el = document.getElementById('section-active');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          style={secondaryBtnStyle}
        >
          3PL 출고 요청
        </button>
      );

    case 'unmapped_sku':
      return (
        <button
          onClick={() => onScrollToSection?.('section-unmapped')}
          style={secondaryBtnStyle}
        >
          매핑하기
        </button>
      );

    default:
      return null;
  }
}
