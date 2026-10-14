'use client';

import React from 'react';
import { formatNumber } from '@/lib/helpers';
import { SKU_STATUS_CONFIG } from '../constants';
import type { OptionRow } from '../types';

/* ------------------------------------------------------------------ */
/*  Status priority for sorting                                        */
/* ------------------------------------------------------------------ */

const STATUS_PRIORITY: Record<string, number> = {
  critical: 0, shortage: 1, warning: 2, transfer_ok: 3, stable: 4,
};

/* ------------------------------------------------------------------ */
/*  Depletion color                                                    */
/* ------------------------------------------------------------------ */

function depletionColor(days: number | null): string {
  if (days === null) return '#CDD2D8';
  if (days === 0) return '#E8A0B4';
  if (days <= 14) return '#E8A0B4';
  if (days <= 30) return '#8FAEE0';
  return '#CDD2D8';
}

/* ------------------------------------------------------------------ */
/*  Transfer label                                                     */
/* ------------------------------------------------------------------ */

function transferText(transferable: boolean): { text: string; color: string } {
  return transferable
    ? { text: '가능', color: '#86C9A8' }
    : { text: '—', color: '#CDD2D8' };
}

/* ------------------------------------------------------------------ */
/*  InventoryTable — unified table, 1 SKU = 1 row                     */
/* ------------------------------------------------------------------ */

interface InventoryTableProps {
  rows: OptionRow[];
  onInboundClick?: (product: string, qty: number) => void;
  onOrderClick?: () => void;
}

const cellBase: React.CSSProperties = {
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  fontSize: 13, lineHeight: '20px',
};

// 제품 | 옵션 | RG 재고 | 예상 소진 | 3PL 재고 | 이관 가능 | 상태 | 권장 액션
const gridTemplate = 'minmax(0,1.2fr) minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,0.8fr) minmax(0,0.8fr) minmax(0,0.9fr)';

export function InventoryTable({ rows, onInboundClick, onOrderClick }: InventoryTableProps) {
  /* Sort: status priority → product name → daysLeft ASC (null last) */
  const sorted = [...rows].sort((a, b) => {
    const sp = (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9);
    if (sp !== 0) return sp;
    if (a.product !== b.product) return a.product.localeCompare(b.product);
    if (a.daysLeft30 === null && b.daysLeft30 === null) return 0;
    if (a.daysLeft30 === null) return 1;
    if (b.daysLeft30 === null) return -1;
    return a.daysLeft30 - b.daysLeft30;
  });

  /* Totals */
  const rgTotal = rows.reduce((s, r) => s + r.unitStock, 0);
  const plSeen = new Set<string>();
  let plTotal = 0;
  for (const r of rows) {
    if (!plSeen.has(r.product)) { plSeen.add(r.product); plTotal += r.ezDomesticStock; }
  }

  return (
    <div style={{
      border: '1px solid #CBD1D8', borderRadius: 12,
      background: '#fff', overflow: 'hidden',
    }}>
      {/* Title */}
      <div style={{
        padding: '14px 16px', borderBottom: '1px solid #E4E8EC',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#1A1D21' }}>재고 현황</span>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid', gridTemplateColumns: gridTemplate,
        gap: 8, padding: '8px 16px',
        borderBottom: '1px solid #E4E8EC',
      }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#9AA2AA' }}>제품</div>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#9AA2AA' }}>옵션</div>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#9AA2AA', textAlign: 'right' }}>RG 재고</div>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#9AA2AA', textAlign: 'right' }}>예상 소진</div>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#9AA2AA', textAlign: 'right' }}>3PL 재고</div>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#9AA2AA' }}>이관 가능</div>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#9AA2AA' }}>상태</div>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#9AA2AA' }}>권장 액션</div>
      </div>

      {/* Data rows — 1 SKU per row, fixed height */}
      <div>
        {sorted.map((row, i) => {
          const statusCfg = SKU_STATUS_CONFIG[row.status] ?? SKU_STATUS_CONFIG.stable;
          const tl = transferText(row.transferable);
          const depText = row.daysLeft30 !== null ? `${row.daysLeft30}일` : '—';
          const depColor = depletionColor(row.daysLeft30);

          return (
            <div
              key={row.vendorItemId || `${row.product}-${row.option}`}
              style={{
                display: 'grid', gridTemplateColumns: gridTemplate,
                gap: 8, padding: '0 16px', alignItems: 'center',
                borderBottom: i < sorted.length - 1 ? '1px solid #F2F4F7' : 'none',
                height: 44,
              }}
            >
              {/* 제품 — left */}
              <div style={{ ...cellBase, fontWeight: 500, color: '#1A1D21' }}>
                {row.product}
              </div>

              {/* 옵션 — left */}
              <div style={{ ...cellBase, color: '#565D64' }}>
                {row.option}
              </div>

              {/* RG 재고 — right */}
              <div style={{ ...cellBase, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {formatNumber(row.unitStock)}
              </div>

              {/* 예상 소진 — right */}
              <div style={{ ...cellBase, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: depColor }}>
                {depText}
              </div>

              {/* 3PL 재고 — right */}
              <div style={{ ...cellBase, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {formatNumber(row.ezDomesticStock)}
              </div>

              {/* 이관 가능 — left */}
              <div style={{ ...cellBase, color: tl.color, fontWeight: 500 }}>
                {tl.text}
              </div>

              {/* 상태 — left */}
              <div style={{ ...cellBase }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusCfg.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: statusCfg.color }}>{statusCfg.text}</span>
                </span>
              </div>

              {/* 권장 액션 — left */}
              <div style={{ ...cellBase }}>
                {row.actionLabel !== '—' ? (
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
                      cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >
                    {row.actionLabel}
                  </button>
                ) : (
                  <span style={{ color: '#CDD2D8' }}>—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer — totals as secondary info */}
      <div style={{
        display: 'grid', gridTemplateColumns: gridTemplate,
        gap: 8, padding: '0 16px',
        borderTop: '1px solid #E4E8EC',
        height: 40, alignItems: 'center',
      }}>
        <div style={{ fontSize: 12, color: '#9AA2AA' }}>합계</div>
        <div />
        <div style={{ fontSize: 12, color: '#9AA2AA', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {formatNumber(rgTotal)}
        </div>
        <div />
        <div style={{ fontSize: 12, color: '#9AA2AA', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {formatNumber(plTotal)}
        </div>
        <div />
        <div />
        <div />
      </div>
    </div>
  );
}
