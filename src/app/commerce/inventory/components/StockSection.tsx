'use client';

import React, { useState } from 'react';
import { formatNumber } from '@/lib/helpers';
import { getSafetyDays, PRODUCTS, statusLabel } from '../constants';
import { CopyButton } from './CopyButton';
import { InboundDropdown } from './InboundDropdown';
import type { RocketItem, EzadminItem, ProductSummary, InboundRequest } from '../types';

/* ------------------------------------------------------------------ */
/*  Shared types & helpers                                             */
/* ------------------------------------------------------------------ */

interface StockProps {
  rocketItems: RocketItem[];
  ezadminItems: EzadminItem[];
  productSummaries: ProductSummary[];
  inboundRequests: InboundRequest[];
}

function computeAggregates(props: StockProps) {
  const { ezadminItems, inboundRequests } = props;

  const activeInbound = inboundRequests.filter(r => !['arrived', 'rejected', 'cancelled'].includes(r.status));
  const inboundByProduct: Record<string, number> = {};
  for (const req of activeInbound) {
    inboundByProduct[req.product] = (inboundByProduct[req.product] || 0) + req.quantity;
  }

  const ezadminByProduct: Record<string, { domestic: number; japan: number; export: number }> = {};
  for (const e of ezadminItems) {
    if (!e.mapped || e.stockType !== 'finished') continue;
    const p = e.product;
    if (!ezadminByProduct[p]) ezadminByProduct[p] = { domestic: 0, japan: 0, export: 0 };
    if (e.variantType === 'domestic') ezadminByProduct[p].domestic += e.availableStock;
    else if (e.variantType === 'japan') ezadminByProduct[p].japan += e.availableStock;
    else if (e.variantType === 'export') ezadminByProduct[p].export += e.availableStock;
  }

  return { activeInbound, inboundByProduct, ezadminByProduct };
}

const numS: React.CSSProperties = { fontSize: 13, fontVariantNumeric: 'tabular-nums', textAlign: 'right', whiteSpace: 'nowrap' };

/* ================================================================== */
/*  1. StockComparisonTable — 제품별 재고 운영표                         */
/* ================================================================== */

export function StockComparisonTable({
  rocketItems, ezadminItems, productSummaries, inboundRequests,
  onInboundClick,
}: StockProps & {
  onInboundClick?: (product: string, qty: number) => void;
}) {
  const { inboundByProduct, ezadminByProduct } = computeAggregates({ rocketItems, ezadminItems, productSummaries, inboundRequests });
  const mainProducts = productSummaries.filter(s => PRODUCTS.includes(s.product));

  // Find fastest depletion option per product
  function fastestDepletion(product: string): { option: string; days: number } | null {
    const items = rocketItems.filter(r => r.product === product && r.daysLeft !== null && r.dailyAvg > 0);
    if (items.length === 0) return null;
    const fastest = items.reduce((min, r) => (r.daysLeft! < min.daysLeft! ? r : min));
    return { option: fastest.option, days: fastest.daysLeft! };
  }

  const btnStyle: React.CSSProperties = {
    padding: '4px 10px', fontSize: 11, fontWeight: 600,
    background: '#1F2328', color: '#fff', border: 'none', borderRadius: 5,
    cursor: 'pointer', whiteSpace: 'nowrap',
  };

  return (
    <div className="section" id="section-stock">
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-light)' }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: '#1F2328', margin: 0 }}>제품별 재고 운영표</h2>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th>제품</th>
              <th className="right">로켓그로스 재고</th>
              <th className="right">판매자배송 3PL(이지어드민)</th>
              <th className="right">입고중</th>
              <th className="right">7일 판매</th>
              <th className="right">30일 판매</th>
              <th>가장 빠른 소진</th>
              <th style={{ textAlign: 'center' }}>상태</th>
              <th style={{ textAlign: 'center', width: 80 }}>다음 액션</th>
            </tr>
          </thead>
          <tbody>
            {mainProducts.map(s => {
              const rgDaysLeft = s.dailyAvg > 0
                ? Math.floor(s.rocketStock / s.dailyAvg)
                : (s.rocketStock > 0 ? null : 0);
              const fastest = fastestDepletion(s.product);
              const st = statusLabel(fastest?.days ?? rgDaysLeft);
              const inboundQty = inboundByProduct[s.product] || 0;
              const ezStock = ezadminByProduct[s.product];
              const domesticStock = ezStock?.domestic || 0;
              const exportStock = (ezStock?.export || 0) + (ezStock?.japan || 0);
              const totalEz = domesticStock + exportStock;
              const recommendedQty = s.dailyAvg > 0
                ? Math.max(0, Math.ceil(s.dailyAvg * getSafetyDays(s.product)) - s.rocketStock)
                : 0;

              // Sales aggregation
              const productItems = rocketItems.filter(r => r.product === s.product);
              const sales7d = productItems.reduce((sum, r) => sum + (r.sales7d || 0), 0);
              const sales30d = productItems.reduce((sum, r) => sum + (r.sales30d || 0), 0);

              // Row background for urgent status
              const isUrgent = st.text === '긴급' || st.text === '품절';
              const isWarning = st.text === '발주 필요';

              return (
                <tr key={s.product}>
                  {/* 제품 */}
                  <td style={{ fontWeight: 600, color: '#1A1D21' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                      {s.product}
                    </div>
                  </td>

                  {/* 로켓그로스 재고 */}
                  <td className="right">
                    <div style={{ fontWeight: 700, fontSize: 14, color: isUrgent ? '#D9534F' : '#1A1D21', fontVariantNumeric: 'tabular-nums' }}>
                      {formatNumber(s.rocketStock)}개
                    </div>
                    <div style={{ fontSize: 11, color: '#6E767E', marginTop: 1 }}>
                      {rgDaysLeft !== null ? `${rgDaysLeft}일치` : '—'}
                      {fastest && ` · 최단 ${fastest.days}일`}
                    </div>
                  </td>

                  {/* 판매자배송 3PL(이지어드민) */}
                  <td className="right">
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#565D64', fontVariantNumeric: 'tabular-nums' }}>
                      {formatNumber(totalEz)}개
                    </div>
                    <div style={{ fontSize: 11, color: '#9AA2AA', marginTop: 1 }}>
                      {exportStock > 0 ? `수출용 ${formatNumber(exportStock)} · 국내 ${formatNumber(domesticStock)}` : `국내 ${formatNumber(domesticStock)}`}
                    </div>
                  </td>

                  {/* 입고중 */}
                  <td style={{ ...numS, color: inboundQty > 0 ? '#565D64' : '#C4CAD1' }}>
                    {inboundQty > 0 ? `${formatNumber(inboundQty)}개` : '-'}
                  </td>

                  {/* 7일 판매 */}
                  <td style={{ ...numS, color: '#565D64' }}>
                    {sales7d > 0 ? formatNumber(sales7d) : '-'}
                  </td>

                  {/* 30일 판매 */}
                  <td style={{ ...numS, color: '#565D64' }}>
                    {sales30d > 0 ? formatNumber(sales30d) : '-'}
                  </td>

                  {/* 가장 빠른 소진 */}
                  <td style={{ fontSize: 12 }}>
                    {fastest ? (
                      <span style={{ color: fastest.days <= 10 ? '#D9534F' : fastest.days <= 21 ? '#A8712A' : '#565D64', fontWeight: 500 }}>
                        {fastest.option} {fastest.days}일
                      </span>
                    ) : (
                      <span style={{ color: '#C4CAD1' }}>—</span>
                    )}
                  </td>

                  {/* 상태 */}
                  <td style={{ textAlign: 'center' }}>
                    {st.text !== '정상' && st.text !== '판매 없음' ? (
                      <span style={{
                        display: 'inline-block', fontSize: 11, fontWeight: 600,
                        padding: '1px 6px', borderRadius: 4,
                        color: st.color, background: st.bg,
                      }}>
                        {st.text}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: '#9AA2AA' }}>{st.text}</span>
                    )}
                  </td>

                  {/* 다음 액션 */}
                  <td style={{ textAlign: 'center' }}>
                    {(isUrgent || isWarning) && onInboundClick ? (
                      <button
                        onClick={() => onInboundClick(s.product, recommendedQty)}
                        style={btnStyle}
                      >
                        이관 등록
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  2. OptionDetailSection — 옵션별 상세 (기본 접힘)                     */
/* ================================================================== */

export function OptionDetailSection({
  rocketItems, ezadminItems, productSummaries, inboundRequests,
}: StockProps) {
  const [open, setOpen] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const { inboundByProduct, ezadminByProduct } = computeAggregates({ rocketItems, ezadminItems, productSummaries, inboundRequests });

  // Group rocket items by product (exclude 분류 필요)
  const rocketByProduct = new Map<string, RocketItem[]>();
  for (const item of rocketItems) {
    if (item.product === '분류 필요') continue;
    const list = rocketByProduct.get(item.product) || [];
    list.push(item);
    rocketByProduct.set(item.product, list);
  }
  const unmappedRocket = rocketItems.filter(r => r.product === '분류 필요');

  // Risk summary: top 3 options with daysLeft ≤ 21
  const riskyOptions = rocketItems
    .filter(r => r.product !== '분류 필요' && r.daysLeft !== null && r.daysLeft <= 21 && r.dailyAvg > 0)
    .sort((a, b) => a.daysLeft! - b.daysLeft!)
    .slice(0, 3);

  const riskSummaryText = riskyOptions.length > 0
    ? riskyOptions.map(r => `${r.product} ${r.option} ${r.daysLeft}일`).join(' · ')
    : '';

  return (
    <div className="section" id="section-detail">
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 13, fontWeight: 600, color: '#1F2328', textAlign: 'left',
        }}
      >
        <span style={{ transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block', color: '#9AA2AA' }}>▸</span>
        옵션별 상세
        {!open && riskSummaryText && (
          <span style={{ fontWeight: 400, fontSize: 12, color: '#A8712A', marginLeft: 8 }}>
            위험 옵션: {riskSummaryText}
          </span>
        )}
      </button>

      {open && (
        <div>
          {/* Filter row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 16px', borderTop: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#9AA2AA', cursor: 'pointer' }}>
              <input type="checkbox" checked={showExport} onChange={e => setShowExport(e.target.checked)} style={{ margin: 0 }} />
              수출용 포함
            </label>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ width: 80 }}>제품</th>
                  <th>옵션</th>
                  <th style={{ fontSize: 11, width: 90 }}>옵션 ID</th>
                  <th className="right" style={{ width: 80 }}>로켓그로스 재고</th>
                  <th className="right" style={{ width: 60 }}>입고중</th>
                  <th className="right" style={{ width: 100 }}>판매자배송 3PL(이지어드민)</th>
                  {showExport && <th className="right" style={{ width: 60 }}>수출용</th>}
                  <th className="right" style={{ width: 60 }}>7일 판매</th>
                  <th className="right" style={{ width: 60 }}>30일 판매</th>
                  <th className="right" style={{ width: 60 }}>예상 소진</th>
                  <th style={{ width: 60, textAlign: 'center' }}>상태</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(rocketByProduct.entries()).map(([product, items]) => {
                  const summary = productSummaries.find(s => s.product === product);
                  const productColor = summary?.color || '#9AA2AA';

                  const sorted = [...items].sort((a, b) => {
                    const aInactive = a.unitStock === 0 && a.sales30d === 0;
                    const bInactive = b.unitStock === 0 && b.sales30d === 0;
                    if (aInactive !== bInactive) return aInactive ? 1 : -1;
                    if (a.stock === 0 && b.stock !== 0) return -1;
                    if (a.stock !== 0 && b.stock === 0) return 1;
                    if (a.daysLeft !== null && b.daysLeft !== null) return a.daysLeft - b.daysLeft;
                    if (a.daysLeft !== null) return -1;
                    if (b.daysLeft !== null) return 1;
                    return 0;
                  });

                  return sorted.map(item => {
                    const isInactive = item.unitStock === 0 && item.sales30d === 0;
                    const st = statusLabel(item.daysLeft);
                    const isUrgent = st.text === '긴급' || st.text === '품절';
                    const isWarning = st.text === '발주 필요';

                    return (
                      <tr
                        key={item.vendorItemId}
                        style={{
                          opacity: isInactive ? 0.45 : 1,
                          background: isUrgent ? '#FBE9E810' : isWarning ? '#FDF6EC10' : 'transparent',
                        }}
                      >
                        <td style={{ paddingLeft: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ display: 'inline-block', width: 4, height: 4, borderRadius: '50%', background: productColor, flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: '#6E767E' }}>{product}</span>
                          </div>
                        </td>
                        <td style={{ fontWeight: 500, color: '#1F2328' }}>{item.option}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#9AA2AA' }}>
                            {item.vendorItemId} <CopyButton text={item.vendorItemId} />
                          </div>
                        </td>
                        <td style={{ ...numS, fontWeight: 600, color: item.unitStock === 0 ? '#D9534F' : '#1A1D21' }}>
                          {formatNumber(item.unitStock)}
                        </td>
                        <td style={{ ...numS, color: '#9AA2AA' }}>—</td>
                        <td style={{ ...numS, color: '#9AA2AA' }}>—</td>
                        {showExport && <td style={{ ...numS, color: '#9AA2AA' }}>—</td>}
                        <td style={numS}>
                          {item.sales7d > 0 ? formatNumber(item.sales7d) : <span style={{ color: '#C4CAD1' }}>—</span>}
                        </td>
                        <td style={numS}>
                          {item.sales30d > 0 ? formatNumber(item.sales30d) : <span style={{ color: '#C4CAD1' }}>—</span>}
                        </td>
                        <td style={{ ...numS, fontWeight: 600, color: st.color }}>
                          {item.daysLeft !== null ? `${item.daysLeft}일` : '—'}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {(isUrgent || isWarning) && (
                            <span style={{
                              display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                              color: st.color, background: st.bg,
                            }}>{st.text}</span>
                          )}
                        </td>
                      </tr>
                    );
                  });
                })}

                {/* Unmapped Rocket items */}
                {unmappedRocket.length > 0 && (
                  <tr style={{ background: '#F2F4F7' }}>
                    <td colSpan={showExport ? 11 : 10} style={{ padding: '8px 12px', fontSize: 12, color: '#6E767E' }}>
                      분류 필요 {unmappedRocket.length}개 · 재고 {formatNumber(unmappedRocket.reduce((s, i) => s + i.unitStock, 0))}개
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  3. UnmappedSkuSection — 미매핑 SKU (기본 접힘)                      */
/* ================================================================== */

export function UnmappedSkuSection({
  unmappedSkus, onSaveMapping, mapSaving,
}: {
  unmappedSkus: EzadminItem[];
  onSaveMapping: (sku: EzadminItem, product: string, option: string) => void;
  mapSaving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mappingCode, setMappingCode] = useState<string | null>(null);
  const [mapProduct, setMapProduct] = useState('클렌징밤');
  const [mapOption, setMapOption] = useState('');

  const productOptions = [
    { value: '클렌징밤', label: '클렌징밤' },
    { value: '클렌징폼', label: '클렌징폼' },
    { value: '세럼', label: '세럼' },
    { value: '모공브러쉬', label: '모공브러쉬' },
    { value: '숯 클렌징 듀오 세트', label: '듀오 세트' },
  ];

  if (unmappedSkus.length === 0) return null;

  return (
    <div className="section" id="section-unmapped">
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 13, fontWeight: 600, color: '#1F2328', textAlign: 'left',
        }}
      >
        <span style={{ transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block', color: '#9AA2AA' }}>▸</span>
        미매핑 SKU
        <span style={{ fontWeight: 400, fontSize: 12, color: '#A8712A', marginLeft: 4 }}>
          {unmappedSkus.length}건
        </span>
        <span style={{ fontWeight: 400, fontSize: 12, color: '#9AA2AA', marginLeft: 4 }}>
          · 총 {formatNumber(unmappedSkus.reduce((sum, e) => sum + e.availableStock, 0))}개 재고
        </span>
      </button>

      {open && (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th>상품명</th>
                <th style={{ width: 100 }}>상품코드</th>
                <th className="right" style={{ width: 60 }}>재고</th>
                <th style={{ width: 60 }}>구분</th>
                <th style={{ width: 240 }}>매핑</th>
              </tr>
            </thead>
            <tbody>
              {unmappedSkus.map(sku => (
                <React.Fragment key={sku.productCode}>
                  <tr>
                    <td style={{ fontWeight: 500, color: '#1F2328' }}>{sku.productName}</td>
                    <td style={{ fontSize: 11, color: '#9AA2AA' }}>{sku.productCode}</td>
                    <td style={{ ...numS }}>{formatNumber(sku.availableStock)}</td>
                    <td style={{ fontSize: 11, color: '#9AA2AA' }}>
                      {sku.variantType === 'domestic' ? '국내' : sku.variantType === 'japan' ? '일본' : '수출'}
                    </td>
                    <td>
                      {mappingCode === sku.productCode ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <div style={{ width: 100 }}>
                            <InboundDropdown
                              options={productOptions}
                              value={mapProduct}
                              onChange={setMapProduct}
                              placeholder="제품"
                            />
                          </div>
                          <input
                            value={mapOption}
                            onChange={e => setMapOption(e.target.value)}
                            placeholder="옵션명"
                            style={{
                              padding: '5px 8px', fontSize: 12, border: '1px solid #E4E8EC',
                              borderRadius: 6, background: '#fff', outline: 'none', width: 100,
                              height: 32, boxSizing: 'border-box',
                            }}
                          />
                          <button
                            onClick={() => { onSaveMapping(sku, mapProduct, mapOption); setMappingCode(null); }}
                            disabled={!mapOption || mapSaving}
                            style={{
                              padding: '5px 10px', fontSize: 11, fontWeight: 500, height: 32,
                              background: (!mapOption || mapSaving) ? '#E4E8EC' : '#1F2328',
                              color: (!mapOption || mapSaving) ? '#9AA2AA' : '#fff',
                              border: 'none', borderRadius: 6, cursor: (!mapOption || mapSaving) ? 'default' : 'pointer',
                            }}
                          >
                            {mapSaving ? '...' : '저장'}
                          </button>
                          <button
                            onClick={() => setMappingCode(null)}
                            style={{
                              padding: '5px 8px', fontSize: 11, height: 32,
                              background: 'none', color: '#9AA2AA',
                              border: '1px solid #E4E8EC', borderRadius: 6, cursor: 'pointer',
                            }}
                          >
                            취소
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setMappingCode(sku.productCode); setMapProduct('클렌징밤'); setMapOption(''); }}
                          style={{
                            padding: '3px 8px', fontSize: 11, fontWeight: 500,
                            background: 'none', color: '#0969DA',
                            border: '1px solid var(--border-light)', borderRadius: 4, cursor: 'pointer',
                          }}
                        >
                          매핑
                        </button>
                      )}
                    </td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* Legacy export for backwards compatibility during transition */
export function StockSection(props: StockProps & {
  unmappedSkus: EzadminItem[];
  onSaveMapping: (sku: EzadminItem, product: string, option: string) => void;
  mapSaving: boolean;
  onInboundClick?: (product: string, qty: number) => void;
}) {
  return (
    <>
      <StockComparisonTable {...props} onInboundClick={props.onInboundClick} />
      <OptionDetailSection {...props} />
      <UnmappedSkuSection unmappedSkus={props.unmappedSkus} onSaveMapping={props.onSaveMapping} mapSaving={props.mapSaving} />
    </>
  );
}
