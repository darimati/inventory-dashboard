'use client';

import { useState } from 'react';
import AppShell from '@/components/AppShell';
import { formatNumber } from '@/lib/helpers';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type StockStatus =
  | 'oos'
  | 'order_needed'
  | 'transfer_review'
  | 'normal'
  | 'no_sales'
  | 'unmapped'
  | 'not_linked';

interface OptionData {
  option: string;
  unitCount: number;
  rocketStock: number;
  rocketStockUnits: number;
  rocketSales30d: number;
  rocketDailyAvg: number;
  rocketDailyAvgUnits: number;
  rocketDaysLeft: number | null;
  status: StockStatus;
}

interface ProductData {
  product: string;
  spec: string;
  rocketStockTotal: number;
  rocketStockTotalUnits: number;
  ezadminStock: number;
  hasExportOnly: boolean;
  earliestDepletion: {
    option: string;
    daysLeft: number;
    stock: number;
    stockUnits: number;
  } | null;
  options: OptionData[];
}

interface UnmappedSku {
  vendorItemId: string;
  rawName: string;
  stock: number;
  sales30d: number;
  hasSales: boolean;
}

interface Props {
  products: ProductData[];
  unmappedSkus: UnmappedSku[];
  ezadminTotal: number;
  ezadminMapped: number;
  ezadminUnmapped: number;
  ezadminSupplies: number;
  ezadminUpdatedAt: string;
  ezadminIntegrityOk: boolean;
  ezadminMappingItems: EzMappingItem[];
}

interface EzMappingItem {
  productCode: string;
  productName: string;
  availableStock: number;
  mappedProduct: string | null;
  mappedOption: string | null;
  stockType: '완제품' | '부자재' | null;
}

/* ------------------------------------------------------------------ */
/*  Tabular nums style (no font-mono)                                  */
/* ------------------------------------------------------------------ */

const nums: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
};

/* ------------------------------------------------------------------ */
/*  Status Badge (unified design)                                      */
/* ------------------------------------------------------------------ */

function StatusBadge({
  status,
  daysLeft,
}: {
  status: StockStatus;
  daysLeft: number | null;
}) {
  switch (status) {
    case 'oos':
      return <span className="badge badge-red">품절</span>;
    case 'order_needed':
      return (
        <span className="badge badge-red">
          발주 필요
        </span>
      );
    case 'transfer_review':
      return (
        <span className="badge badge-amber">
          이관 검토
        </span>
      );
    case 'unmapped':
      return <span style={{ color: '#8E959D', fontSize: 12 }}>SKU 미매핑</span>;
    case 'normal':
      return (
        <span className="badge badge-gray">
          정상
        </span>
      );
    case 'no_sales':
      return <span className="badge badge-gray">판매 없음</span>;
    case 'not_linked':
      return <span className="badge badge-gray">미연동</span>;
  }
}

/* ------------------------------------------------------------------ */
/*  Option spec label helper                                           */
/* ------------------------------------------------------------------ */

function optionSpecLabel(option: string, unitCount: number): string {
  if (unitCount === 1) return '단품 1개입';
  return `${option} ${unitCount}개입`;
}

/* ------------------------------------------------------------------ */
/*  Unmapped summary helper                                            */
/* ------------------------------------------------------------------ */

function unmappedSummary(skus: UnmappedSku[]): string {
  const allOos = skus.every((s) => s.stock === 0);
  if (allOos) return `미매핑 SKU ${skus.length}건 · 전부 품절 상태`;
  const oosCount = skus.filter((s) => s.stock === 0).length;
  if (oosCount > 0)
    return `미매핑 SKU ${skus.length}건 · ${oosCount}건 품절`;
  return `미매핑 SKU ${skus.length}건`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ProductsClient({
  products,
  unmappedSkus,
  ezadminTotal,
  ezadminMapped,
  ezadminUnmapped,
  ezadminSupplies,
  ezadminUpdatedAt,
  ezadminIntegrityOk,
  ezadminMappingItems,
}: Props) {
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [showUnmapped, setShowUnmapped] = useState(false);

  const selected = selectedProduct
    ? products.find((p) => p.product === selectedProduct) ?? null
    : null;

  // Find the worst status across a product's options for the footer badge
  function productWorstStatus(p: ProductData): {
    status: StockStatus;
    daysLeft: number | null;
  } {
    let worst: StockStatus = 'normal';
    let worstDays: number | null = null;
    const priority: Record<StockStatus, number> = {
      oos: 0,
      order_needed: 1,
      transfer_review: 2,
      unmapped: 3,
      normal: 4,
      no_sales: 5,
      not_linked: 6,
    };
    for (const o of p.options) {
      if (priority[o.status] < priority[worst]) {
        worst = o.status;
        worstDays = o.rocketDaysLeft;
      }
    }
    if (p.options.length === 0) {
      worst = 'no_sales';
    }
    return { status: worst, daysLeft: worstDays };
  }

  // Count unmapped options for a product
  function unmappedOptionCount(p: ProductData): number {
    return p.options.filter((o) => o.status === 'unmapped').length;
  }

  return (
    <AppShell>
      {/* Page Title */}
      <h1 className="page-title">재고</h1>

      {/* ---- Product Cards (3-column grid) ---- */}
      <div className="product-card-grid">
        {products.map((p) => {
          const isSelected = selectedProduct === p.product;
          const worstStatus = productWorstStatus(p);
          const unmappedCount = unmappedOptionCount(p);

          // Total stock display
          const totalStockLabel = `${formatNumber(p.rocketStockTotalUnits + p.ezadminStock)}개`;

          return (
            <div
              key={p.product}
              className={`product-card${isSelected ? ' selected' : ''}`}
              onClick={() =>
                setSelectedProduct(isSelected ? null : p.product)
              }
            >
              {/* Header */}
              <div style={{ marginBottom: 14 }}>
                <span className="pc-name">{p.product}</span>
                {p.spec && <span className="pc-spec">{p.spec}</span>}
              </div>

              {/* Body rows */}
              <div className="pc-row">
                <span className="pc-label">로켓그로스</span>
                <span
                  className="pc-value"
                  style={{
                    ...nums,
                    color:
                      p.rocketStockTotalUnits === 0
                        ? 'var(--red)'
                        : '#1F2328',
                  }}
                >
                  {formatNumber(p.rocketStockTotalUnits)}개
                </span>
              </div>

              <div className="pc-row">
                <span className="pc-label">국내 3PL(이지어드민)</span>
                <span className="pc-value" style={{
                  ...nums,
                  color: p.ezadminStock === 0 ? 'var(--red)' : '#1F2328',
                }}>
                  {formatNumber(p.ezadminStock)}개
                </span>
              </div>

              <div className="pc-row">
                <span className="pc-label">총 재고</span>
                <span className="pc-value" style={nums}>
                  {totalStockLabel}
                </span>
              </div>

              <div className="pc-row">
                <span className="pc-label">최단 소진</span>
                {p.earliestDepletion ? (
                  <span
                    className="pc-value"
                    style={{
                      ...nums,
                      color:
                        p.earliestDepletion.daysLeft <= 14
                          ? 'var(--red)'
                          : p.earliestDepletion.daysLeft <= 30
                            ? 'var(--amber)'
                            : '#1F2328',
                    }}
                  >
                    {p.earliestDepletion.daysLeft}일
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                    }}
                  >
                    –
                  </span>
                )}
              </div>

              {/* Footer */}
              <div className="pc-footer">
                <StatusBadge
                  status={worstStatus.status}
                  daysLeft={worstStatus.daysLeft}
                />
                <span className="pc-hint">
                  {unmappedCount > 0
                    ? `미매핑 옵션 ${unmappedCount}건`
                    : isSelected
                      ? '접기'
                      : '옵션 상세 보기'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ---- 옵션별 재고 표 ---- */}
      {selected && (
        <div className="section" style={{ marginBottom: 14 }}>
          <div className="section-header">
            <span className="section-title">
              {selected.product} 옵션별 재고
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              일평균·예상 소진은 최근 30일 판매 고정 · 기간 필터 미적용
            </span>
          </div>
          <div className="section-body" style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>옵션</th>
                  <th className="right">로켓그로스</th>
                  <th className="right">
                    국내 3PL
                    <br />
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 400,
                        color: 'var(--text-muted)',
                      }}
                    >
                      이지어드민
                    </span>
                  </th>
                  <th className="right">
                    총 재고
                    <br />
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 400,
                        color: 'var(--text-muted)',
                      }}
                    >
                      낱개 환산
                    </span>
                  </th>
                  <th className="right">
                    일평균
                    <br />
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 400,
                        color: 'var(--text-muted)',
                      }}
                    >
                      최근 30일
                    </span>
                  </th>
                  <th className="right">예상 소진</th>
                  <th className="right" style={{ minWidth: 80 }}>
                    상태
                  </th>
                  <th style={{ minWidth: 160 }}>비고</th>
                </tr>
              </thead>
              <tbody>
                {selected.options.length > 0 ? (
                  selected.options.map((o) => {
                    const notes: string[] = [];
                    if (o.status === 'unmapped' && o.rocketSales30d > 0) {
                      notes.push('판매 이력 있음 · SKU 미매핑');
                    }

                    return (
                      <tr key={o.option}>
                        <td>
                          <span className="product-name">{o.option}</span>
                          <span className="product-spec">
                            {optionSpecLabel(o.option, o.unitCount)}
                          </span>
                        </td>
                        <td className="right" style={nums}>
                          {o.unitCount > 1
                            ? `${formatNumber(o.rocketStock)}세트 (${formatNumber(o.rocketStockUnits)}개)`
                            : `${formatNumber(o.rocketStockUnits)}개`}
                        </td>
                        <td className="right" style={nums}>
                          {selected.hasExportOnly ? (
                            <span
                              style={{
                                fontSize: 13,
                                color: 'var(--text-muted)',
                                fontWeight: 500,
                              }}
                            >
                              수출용 재고 미연동
                            </span>
                          ) : o.status === 'unmapped' ? (
                            <span
                              style={{
                                fontSize: 13,
                                color: 'var(--text-muted)',
                                fontWeight: 500,
                              }}
                            >
                              미매핑
                            </span>
                          ) : (
                            '–'
                          )}
                        </td>
                        <td className="right" style={nums}>
                          {formatNumber(o.rocketStockUnits)}개
                        </td>
                        <td className="right" style={nums}>
                          {o.rocketDailyAvgUnits > 0
                            ? o.rocketDailyAvgUnits.toFixed(1)
                            : '–'}
                        </td>
                        <td className="right" style={nums}>
                          {o.rocketDaysLeft !== null
                            ? `${o.rocketDaysLeft}일`
                            : '–'}
                        </td>
                        <td className="right">
                          <StatusBadge
                            status={o.status}
                            daysLeft={o.rocketDaysLeft}
                          />
                        </td>
                        <td
                          style={{
                            fontSize: 12,
                            color: 'var(--text-muted)',
                          }}
                        >
                          {notes.join(' · ') || '–'}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td
                      colSpan={8}
                      style={{
                        textAlign: 'center',
                        color: 'var(--text-muted)',
                        padding: 24,
                      }}
                    >
                      옵션 데이터가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div
            style={{
              padding: '12px 20px',
              fontSize: 12,
              color: 'var(--text-muted)',
              borderTop: '1px solid var(--border-light)',
              lineHeight: 1.7,
            }}
          >
            <span style={{ fontWeight: 600, color: 'var(--red)' }}>
              발주 필요
            </span>{' '}
            14일 이하 — 지금 발주해도 리드타임에 걸림
            <span style={{ margin: '0 8px' }}>·</span>
            <span style={{ fontWeight: 600, color: 'var(--amber)' }}>
              이관 검토
            </span>{' '}
            30일 이하 — 국내 3PL 재고로 대응 가능
            <span style={{ margin: '0 8px' }}>·</span>
            미연동이 0개는 다릅니다
          </div>
        </div>
      )}

      {/* ---- Empty state ---- */}
      {products.length === 0 && (
        <div className="section">
          <div
            className="section-body"
            style={{
              padding: 40,
              textAlign: 'center',
              color: 'var(--text-muted)',
            }}
          >
            등록된 상품이 없습니다.
          </div>
        </div>
      )}

      {/* ---- 이지어드민 매핑 현황 ---- */}
      <div className="section" style={{ marginTop: 8 }}>
        <div className="section-header">
          <span className="section-title">이지어드민 매핑 현황</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            조회 시점: {ezadminUpdatedAt ? ezadminUpdatedAt.slice(0, 16).replace('T', ' ') : '–'}
          </span>
        </div>

        {/* Integrity warning */}
        {!ezadminIntegrityOk && (
          <div style={{ padding: '8px 20px', fontSize: 12, color: '#D14848', background: '#FDF1F1', borderBottom: '1px solid #F3CFCF' }}>
            매핑 합계({formatNumber(ezadminMapped)}) + 미매핑 합계({formatNumber(ezadminUnmapped)}) ≠ 원본 총합({formatNumber(ezadminTotal)})
          </div>
        )}

        {/* Summary bar */}
        <div style={{
          padding: '10px 20px',
          fontSize: 12,
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border-light)',
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <span>완제품 <span style={{ ...nums, fontWeight: 500, color: 'var(--text-secondary)' }}>{formatNumber(ezadminMapped)}개</span></span>
          <span>·</span>
          <span>부자재 <span style={{ ...nums, fontWeight: 500, color: 'var(--text-secondary)' }}>{formatNumber(ezadminSupplies)}개</span></span>
          <span>·</span>
          <span>미매핑 <span style={{ ...nums, fontWeight: 500, color: 'var(--text-secondary)' }}>{formatNumber(ezadminUnmapped)}개</span></span>
        </div>

        {/* Mapping table */}
        <div className="section-body" style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>이지어드민 SKU</th>
                <th>상품명</th>
                <th className="right">원본 수량</th>
                <th>매핑된 제품·옵션</th>
                <th>재고유형</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {[...ezadminMappingItems].sort((a, b) => b.availableStock - a.availableStock).map((item) => (
                <tr key={item.productCode}>
                  <td style={{ ...nums, fontSize: 12, color: '#9AA2AA', fontWeight: 400 }}>{item.productCode}</td>
                  <td style={{ fontSize: 13, color: '#61686F', fontWeight: 400 }}>{item.productName}</td>
                  <td className="right" style={nums}>{formatNumber(item.availableStock)}개</td>
                  <td>
                    {item.mappedProduct ? (
                      <span style={{ color: 'var(--text-secondary)' }}>{item.mappedProduct} · {item.mappedOption}</span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>–</span>
                    )}
                  </td>
                  <td>
                    {item.mappedProduct ? (
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.stockType === '부자재' ? '부자재' : '완제품'}</span>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>–</span>
                    )}
                  </td>
                  <td>
                    {item.mappedProduct ? (
                      <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>매핑</span>
                    ) : (
                      <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>미매핑</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- 미매핑 SKU (collapsed by default) ---- */}
      {unmappedSkus.length > 0 && (
        <div className="section" style={{ marginTop: 8 }}>
          <div
            className="section-header collapsible-header"
            onClick={() => setShowUnmapped(!showUnmapped)}
          >
            <span className="collapsible-summary">
              {unmappedSummary(unmappedSkus)}
              <span style={{ marginLeft: 6, fontSize: 9, color: '#C4CAD1' }}>
                {showUnmapped ? '\u25B2' : '\u25BC'}
              </span>
            </span>
          </div>

          {showUnmapped && (
            <div className="section-body" style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Vendor Item ID</th>
                    <th>상품명</th>
                    <th className="right">재고</th>
                    <th className="right">30일 판매</th>
                    <th className="right">판매 이력</th>
                  </tr>
                </thead>
                <tbody>
                  {unmappedSkus.map((sku) => (
                    <tr key={sku.vendorItemId}>
                      <td
                        style={{
                          ...nums,
                          fontSize: 12,
                          color: 'var(--text-muted)',
                        }}
                      >
                        {sku.vendorItemId}
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>
                        {sku.rawName}
                      </td>
                      <td className="right" style={nums}>
                        {formatNumber(sku.stock)}
                      </td>
                      <td className="right" style={nums}>
                        {formatNumber(sku.sales30d)}
                      </td>
                      <td className="right">
                        {sku.hasSales ? (
                          <StatusBadge status="unmapped" daysLeft={null} />
                        ) : (
                          <span
                            style={{
                              color: 'var(--text-muted)',
                              fontSize: 12,
                            }}
                          >
                            –
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
