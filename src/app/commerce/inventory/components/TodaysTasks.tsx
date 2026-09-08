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
  inbound_delayed: { label: '긴급',   color: '#D9534F', bg: '#FBE9E8', priority: 0, actionLabel: '쿠팡 확인' },
  urgent_order:    { label: '긴급',   color: '#D9534F', bg: '#FBE9E8', priority: 1, actionLabel: '이관 등록' },
  tracking_needed: { label: '주의',   color: '#A8712A', bg: '#FDF6EC', priority: 2, actionLabel: '송장 입력' },
  ea_order_needed: { label: '주의',   color: '#A8712A', bg: '#FDF6EC', priority: 3, actionLabel: '3PL 출고 요청' },
  inbound_needed:  { label: '주의',   color: '#A8712A', bg: '#FDF6EC', priority: 4, actionLabel: '이관 등록' },
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
/*  TodaysTasks component                                              */
/* ------------------------------------------------------------------ */

export function TodaysTasks({ tasks, onInboundClick, onScrollToSection }: {
  tasks: TaskItem[];
  onInboundClick?: (product: string, qty: number) => void;
  onScrollToSection?: (id: string) => void;
}) {
  const visible = tasks.slice(0, 8);
  const remaining = tasks.length - visible.length;

  return (
    <div id="section-tasks" className="section">
      <div style={{ padding: '12px 16px', borderBottom: visible.length > 0 ? '1px solid var(--border-light)' : 'none' }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: '#1F2328', margin: 0 }}>오늘 할 일</h2>
      </div>

      {visible.length === 0 ? (
        <div style={{ padding: '20px 16px', fontSize: 13, color: '#9AA2AA', textAlign: 'center' }}>
          오늘 처리할 입고 이슈가 없습니다
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ width: 60, textAlign: 'center' }}>상태</th>
                <th>제품·옵션</th>
                <th>사유</th>
                <th style={{ width: 140 }}>기한</th>
                <th style={{ width: 100, textAlign: 'center' }}>액션</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t, i) => {
                const meta = CATEGORY_META[t.category];
                return (
                  <tr key={i}>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-block', fontSize: 11, fontWeight: 600,
                        padding: '1px 6px', borderRadius: 4,
                        color: meta.color, background: meta.bg,
                        whiteSpace: 'nowrap',
                      }}>
                        {meta.label}
                      </span>
                    </td>
                    <td style={{ fontWeight: 500, color: '#1A1D21' }}>
                      {t.option ? `${t.product} ${t.option}` : t.product || '미매핑 SKU'}
                      {t.detail && (
                        <span style={{ fontWeight: 400, color: '#6E767E', marginLeft: 6, fontSize: 12 }}>
                          {t.detail}
                        </span>
                      )}
                    </td>
                    <td style={{ color: '#565D64', fontSize: 12 }}>{t.reason}</td>
                    <td style={{ color: '#6E767E', fontSize: 12 }}>{t.deadline}</td>
                    <td style={{ textAlign: 'center' }}>
                      {renderActionButton(t, meta, onInboundClick, onScrollToSection)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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

function renderActionButton(
  t: TaskItem,
  meta: typeof CATEGORY_META[TaskItem['category']],
  onInboundClick?: (product: string, qty: number) => void,
  onScrollToSection?: (id: string) => void,
): React.ReactNode {
  const btnStyle: React.CSSProperties = {
    padding: '4px 10px', fontSize: 11, fontWeight: 600,
    background: '#1F2328', color: '#fff', border: 'none', borderRadius: 5,
    cursor: 'pointer', whiteSpace: 'nowrap',
  };
  const secondaryBtnStyle: React.CSSProperties = {
    ...btnStyle, background: '#F2F4F7', color: '#565D64',
  };

  switch (t.category) {
    case 'urgent_order':
    case 'inbound_needed':
      return onInboundClick ? (
        <button onClick={() => onInboundClick(t.product, t.quantity || 150)} style={btnStyle}>
          이관 등록
        </button>
      ) : null;

    case 'inbound_delayed':
      return (
        <button
          onClick={() => window.open('https://wing.coupang.com/tenants/direct-wing/vendor-inventory/inbound/management', '_blank')}
          style={btnStyle}
        >
          쿠팡 확인
        </button>
      );

    case 'tracking_needed':
      return (
        <button
          onClick={() => window.open('https://wing.coupang.com/tenants/direct-wing/vendor-inventory/inbound/management', '_blank')}
          style={btnStyle}
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
