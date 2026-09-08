'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import AppShell from '@/components/AppShell';
import { formatKRW, formatNumber, formatCompact, formatChartAxis, formatDateShort } from '@/lib/helpers';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface OptionRow {
  option: string;
  sales: number;
  orders: number;
  setsSold: number;
  unitsSold: number;
  unitCount: number;
  share: number;
}

interface ProductRow {
  product: string;
  spec: string;
  sales: number;
  orders: number;
  setsSold: number;
  unitsSold: number;
  share: number;
  options: OptionRow[];
}

interface DailyPoint {
  date: string;
  sales: number;
  orders: number;
  unitsSold: number;
}

interface DayDetailProduct {
  product: string;
  sales: number;
  unitsSold: number;
}

interface Props {
  totalSales: number;
  totalOrders: number;
  totalUnitsSold: number;
  numDays: number;
  dailyAvgSales: number;
  dailyAvgOrders: number;
  unitsPerOrder: number;
  productOrderSum: number;
  comparisonValid: boolean;
  compTotalSales: number;
  compTotalOrders: number;
  compTotalUnitsSold: number;
  compPeriodStart: string;
  compPeriodEnd: string;
  compPeriodLabel: string;
  compInvalidReason: string | null;
  compCaveat: string | null;
  compProducts: { product: string; sales: number; orders: number }[];
  products: ProductRow[];
  daily: DailyPoint[];
  dailyDetails: Record<string, DayDetailProduct[]>;
  totalCouponDiscount: number;
  couponDataCount: number;
  dataCoverageDays: number;
  periodStart: string;
  periodEnd: string;
  dataStartDate: string | null;
  earliestDataDate: string | null;
  latestDataDate: string | null;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PRODUCT_COLORS: Record<string, string> = {
  '\uD074\uB80C\uC9D5\uBC24': '#9DC3E6',
  '\uD074\uB80C\uC9D5\uD3FC': '#7FCDBB',
  '\uC138\uB7FC': '#F2A0A0',
};


const PRODUCT_ORDER_CHART = ['\uD074\uB80C\uC9D5\uBC24', '\uD074\uB80C\uC9D5\uD3FC', '\uC138\uB7FC'];

/** Adjust percentage shares so they sum to 100.0% (largest remainder method) */
function adjustedPercents(shares: number[]): string[] {
  if (shares.length === 0) return [];
  const raw = shares.map(s => s * 100);
  const rounded = raw.map(v => Math.round(v * 10) / 10);
  const sum = Math.round(rounded.reduce((a, b) => a + b, 0) * 10) / 10;
  const diff = Math.round((100 - sum) * 10) / 10;
  if (diff !== 0) {
    let maxIdx = 0;
    for (let i = 1; i < rounded.length; i++) {
      if (rounded[i] > rounded[maxIdx]) maxIdx = i;
    }
    rounded[maxIdx] = Math.round((rounded[maxIdx] + diff) * 10) / 10;
  }
  return rounded.map(v => v.toFixed(1));
}

/* ------------------------------------------------------------------ */
/*  Chart mode                                                         */
/* ------------------------------------------------------------------ */

type ChartMode = 'daily' | 'weekly' | 'monthly';

/* ------------------------------------------------------------------ */
/*  Weekly / Monthly bucket types                                      */
/* ------------------------------------------------------------------ */

interface WeekBucket {
  label: string;
  sales: number;
  orders: number;
  units: number;
  byProduct: Record<string, number>;
}

interface MonthBucket {
  label: string;
  sales: number;
  orders: number;
  units: number;
  byProduct: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/*  Grouping helpers                                                   */
/* ------------------------------------------------------------------ */

function groupByWeek(
  daily: DailyPoint[],
  periodStart: string,
  periodEnd: string,
  details?: Record<string, DayDetailProduct[]>,
): WeekBucket[] {
  if (daily.length === 0) return [];
  const pStart = new Date(periodStart);
  const pEnd = new Date(periodEnd);
  const buckets: WeekBucket[] = [];
  let currentWeekStart: string | null = null;
  let bucket: WeekBucket | null = null;
  let bucketMonday: Date | null = null;

  for (const d of daily) {
    const date = new Date(d.date);
    const dow = date.getDay();
    const mondayOffset = dow === 0 ? 6 : dow - 1;
    const monday = new Date(date);
    monday.setDate(date.getDate() - mondayOffset);
    const mondayStr = monday.toISOString().slice(0, 10);

    if (mondayStr !== currentWeekStart) {
      if (bucket && bucketMonday) {
        const sunday = new Date(bucketMonday);
        sunday.setDate(bucketMonday.getDate() + 6);
        const clipStart = bucketMonday < pStart ? pStart : bucketMonday;
        const clipEnd = sunday > pEnd ? pEnd : sunday;
        const startLabel = clipStart.toISOString().slice(5, 10).replace('-', '/');
        const endLabel = clipEnd.toISOString().slice(5, 10).replace('-', '/');
        bucket.label = startLabel;
        (bucket as WeekBucket & { fullLabel?: string }).fullLabel = `${startLabel} \u2013 ${endLabel}`;
        buckets.push(bucket);
      }
      bucket = { label: '', sales: 0, orders: 0, units: 0, byProduct: {} };
      currentWeekStart = mondayStr;
      bucketMonday = new Date(monday);
    }

    bucket!.sales += d.sales;
    bucket!.orders += d.orders;
    bucket!.units += d.unitsSold;

    if (details && details[d.date]) {
      for (const p of details[d.date]) {
        bucket!.byProduct[p.product] = (bucket!.byProduct[p.product] || 0) + p.sales;
      }
    }
  }

  if (bucket && bucketMonday) {
    const sunday = new Date(bucketMonday);
    sunday.setDate(bucketMonday.getDate() + 6);
    const clipStart = bucketMonday < pStart ? pStart : bucketMonday;
    const clipEnd = sunday > pEnd ? pEnd : sunday;
    const startLabel = clipStart.toISOString().slice(5, 10).replace('-', '/');
    const endLabel = clipEnd.toISOString().slice(5, 10).replace('-', '/');
    bucket.label = startLabel;
    (bucket as WeekBucket & { fullLabel?: string }).fullLabel = `${startLabel} \u2013 ${endLabel}`;
    buckets.push(bucket);
  }
  return buckets;
}

function groupByMonth(
  daily: DailyPoint[],
  details?: Record<string, DayDetailProduct[]>,
): MonthBucket[] {
  if (daily.length === 0) return [];
  const map = new Map<string, MonthBucket>();
  for (const d of daily) {
    const monthKey = d.date.slice(0, 7);
    if (!map.has(monthKey)) {
      const m = parseInt(monthKey.slice(5, 7));
      map.set(monthKey, {
        label: `${m}\uC6D4`,
        sales: 0,
        orders: 0,
        units: 0,
        byProduct: {},
      });
    }
    const b = map.get(monthKey)!;
    b.sales += d.sales;
    b.orders += d.orders;
    b.units += d.unitsSold;

    if (details && details[d.date]) {
      for (const p of details[d.date]) {
        b.byProduct[p.product] = (b.byProduct[p.product] || 0) + p.sales;
      }
    }
  }
  return Array.from(map.values());
}

/* ------------------------------------------------------------------ */
/*  Chart math helpers                                                 */
/* ------------------------------------------------------------------ */

function monotonePath(points: { x: number; y: number }[], yFloor?: number): string {
  if (points.length < 2) return '';
  const n = points.length;

  /* Fritsch-Carlson monotone interpolation — prevents overshoot */
  const dx: number[] = [];
  const dy: number[] = [];
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1].x - points[i].x);
    dy.push(points[i + 1].y - points[i].y);
    slopes.push(dx[i] !== 0 ? dy[i] / dx[i] : 0);
  }

  const tangents: number[] = [slopes[0]];
  for (let i = 1; i < n - 1; i++) {
    if (slopes[i - 1] * slopes[i] <= 0) {
      tangents.push(0);
    } else {
      tangents.push(2 / (1 / slopes[i - 1] + 1 / slopes[i]));
    }
  }
  tangents.push(slopes[n - 2]);

  let path = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const seg = dx[i] / 3;
    let cp1y = points[i].y + tangents[i] * seg;
    let cp2y = points[i + 1].y - tangents[i + 1] * seg;
    if (yFloor !== undefined) {
      cp1y = Math.min(cp1y, yFloor);
      cp2y = Math.min(cp2y, yFloor);
    }
    path += ` C${points[i].x + seg},${cp1y} ${points[i + 1].x - seg},${cp2y} ${points[i + 1].x},${points[i + 1].y}`;
  }
  return path;
}

function computeYTicks(max: number): number[] {
  if (max <= 0) return [0, 10000, 20000, 30000, 40000];
  const adjusted = max * 1.1; // 10% headroom
  const candidates = [
    10000, 20000, 50000,
    100000, 200000, 250000, 500000,
    1000000, 2000000, 2500000, 5000000,
    10000000, 20000000, 25000000, 50000000,
  ];
  const quarter = adjusted / 4;
  const interval = candidates.find(c => c >= quarter) || candidates[candidates.length - 1];
  return [0, interval, interval * 2, interval * 3, interval * 4];
}

/* ------------------------------------------------------------------ */
/*  Inline style helpers                                               */
/* ------------------------------------------------------------------ */

const nums: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
};

const tdPad: React.CSSProperties = { paddingTop: 9, paddingBottom: 9 };
const optTdPad: React.CSSProperties = { paddingTop: 7, paddingBottom: 7 };

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function SalesClient({
  totalSales,
  totalOrders,
  totalUnitsSold,
  numDays,
  dailyAvgSales,
  dailyAvgOrders,
  unitsPerOrder,
  productOrderSum,
  comparisonValid,
  compTotalSales,
  compTotalOrders,
  compTotalUnitsSold,
  compPeriodStart,
  compPeriodEnd,
  compPeriodLabel,
  compInvalidReason,
  compCaveat,
  compProducts,
  products,
  daily,
  dailyDetails,
  totalCouponDiscount,
  couponDataCount,
  dataCoverageDays,
  periodStart,
  periodEnd,
  dataStartDate,
  earliestDataDate,
  latestDataDate,
}: Props) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  /* auto-select chart mode based on period length */
  const defaultMode: ChartMode = numDays > 180 ? 'monthly' : numDays > 90 ? 'weekly' : 'daily';
  const [chartMode, setChartMode] = useState<ChartMode>(defaultMode);
  const monthlyData = groupByMonth(daily, dailyDetails);
  const weeklyDisabled = numDays < 7;
  const monthlyDisabled = numDays < 30;

  // Auto-adjust chart mode when period changes
  useEffect(() => {
    const ideal: ChartMode = numDays > 180 ? 'monthly' : numDays > 90 ? 'weekly' : 'daily';
    setChartMode(ideal);
    setSelectedDay(null);
  }, [numDays]);

  const toggleDay = (date: string) => {
    setSelectedDay((prev) => (prev === date ? null : date));
  };

  /* ---- daily averages (calendar period days) ---- */
  const dailyAvgSalesCalc =
    numDays > 0 ? Math.round(totalSales / numDays) : 0;
  const dailyAvgOrdersCalc =
    numDays > 0 ? Math.round((totalOrders / numDays) * 10) / 10 : 0;

  /* ---- comparison change rates ---- */
  const salesChangeRate =
    compTotalSales > 0
      ? ((totalSales - compTotalSales) / compTotalSales) * 100
      : null;
  const ordersChangeRate =
    compTotalOrders > 0
      ? ((totalOrders - compTotalOrders) / compTotalOrders) * 100
      : null;
  const unitsChangeRate =
    compTotalUnitsSold > 0
      ? ((totalUnitsSold - compTotalUnitsSold) / compTotalUnitsSold) * 100
      : null;

  /* ---- comparison render helper ---- */
  function renderComparison(rate: number | null) {
    if (comparisonValid && rate !== null) {
      const sign = rate >= 0 ? '+' : '';
      const color = rate >= 0 ? '#3D9970' : '#D9534F';
      return (
        <div style={{ marginTop: 4 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 500,
              color,
              lineHeight: 1.4,
            }}
          >
            {`${sign}${rate.toFixed(1)}%`} {'\uC804\uAE30\uAC04 \uB300\uBE44'}
            {compCaveat && (
              <span style={{ color: '#9AA2AA', fontWeight: 400, fontSize: 11, marginLeft: 4 }}>
                ({'\uC9C1\uC804 \uAE30\uAC04'} {compCaveat}, {'\uCC38\uACE0\uC6A9'})
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 11,
              color: '#9AA2AA',
              lineHeight: 1.4,
            }}
          >
            {compPeriodLabel} {'\uB300\uBE44'}
          </div>
        </div>
      );
    }
    // Single-line format for invalid comparison
    const shortReason = compInvalidReason
      ? compInvalidReason.replace(/\s*\(.*\)$/, '').replace(/\s*\u2014.*$/, '')
      : '';
    return (
      <div style={{ marginTop: 4 }}>
        <div
          style={{ fontSize: 11, color: '#9AA2AA', lineHeight: 1.4 }}
          title={compInvalidReason || '\uBE44\uAD50 \uBD88\uAC00'}
        >
          {'\uBE44\uAD50 \uBD88\uAC00'}{shortReason ? ` · ${shortReason}` : ''}
        </div>
      </div>
    );
  }

  /* ---- CSV export ---- */
  const handleCSV = useCallback(() => {
    const header =
      '\uC81C\uD488,\uC635\uC158,\uB9E4\uCD9C,\uC8FC\uBB38 \uAC74\uC218,\uD310\uB9E4 \uB0B1\uAC1C\uC218,\uBE44\uC911(%)';
    const rows: string[] = [];
    for (const p of products) {
      for (const o of p.options) {
        const share =
          totalSales > 0 ? ((o.sales / totalSales) * 100).toFixed(1) : '0.0';
        rows.push(
          `"${p.product}","${o.option}",${o.sales},${o.orders},${o.unitsSold},${share}`,
        );
      }
    }
    const csv = [header, ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `\uB9E4\uCD9C_${periodStart}_${periodEnd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [products, totalSales, periodStart, periodEnd]);

  /* ---- adjusted percentages ---- */
  const productPercents = adjustedPercents(products.map(p => p.share));

  /* ---- chart data ---- */
  const weeklyData = groupByWeek(daily, periodStart, periodEnd, dailyDetails);

  /* ---- render ---- */
  return (
    <AppShell>
      {/* Page Title with tooltip */}
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {'매출'}
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <span
            className="info-trigger"
            style={{ fontSize: 14, color: '#9AA2AA', cursor: 'help', lineHeight: 1 }}
            title={[
              '정가 기준 · 쿠팡 할인쿠폰 미반영',
              'RG Order API 기준, 실결제 금액과 차이가 있을 수 있습니다',
              earliestDataDate && latestDataDate ? `데이터 ${formatDateShort(earliestDataDate)} ~ ${formatDateShort(latestDataDate)} 반영` : '',
              latestDataDate && periodEnd > latestDataDate ? `${formatDateShort(latestDataDate)} 이후 미반영` : '',
              numDays > 3 && dataCoverageDays > 0 && dataCoverageDays < numDays ? `매출 발생일 ${dataCoverageDays}일 / ${numDays}일` : '',
            ].filter(Boolean).join('\n')}
          >
            {'\u24D8'}
          </span>
        </span>
      </h1>
      {numDays > 3 && dataCoverageDays === 0 && (
        <div style={{
          background: '#FFF3CD',
          border: '1px solid #FFEEBA',
          borderRadius: 8,
          padding: '10px 14px',
          marginBottom: 16,
          fontSize: 12.5,
          color: '#856404',
          lineHeight: 1.5,
        }}>
          {'\u26A0'} {'해당 기간 데이터가 없습니다.'}
        </div>
      )}

      {/* ---- 1. KPI Cards - 3 column ---- */}
      <div className="kpi-row three">
        {/* 총매출 */}
        <div className="kpi-card">
          <div className="kpi-label">{'\uCD1D\uB9E4\uCD9C'}</div>
          <div
            className="kpi-value"
            style={{
              fontWeight: 650,
              color: 'var(--text-primary)',
              ...nums,
            }}
          >
            {formatNumber(totalSales)}
            <span
              className="unit"
              style={{
                color: '#9AA2AA',
                fontWeight: 400,
                fontSize: '0.6em',
              }}
            >
              {'\uC6D0'}
            </span>
          </div>
          <div className="kpi-sub">
            {'\uC77C\uD3C9\uADE0'} {formatNumber(dailyAvgSalesCalc)}
            {'\uC6D0'}
          </div>
          {totalCouponDiscount > 0 && (
            <div style={{ fontSize: 12, color: '#9AA2AA', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
              {'\uCFE0\uD3F0\uD560\uC778'} -{formatNumber(totalCouponDiscount)}{'\uC6D0'} ({couponDataCount}{'\uAC74'})
            </div>
          )}
          {renderComparison(salesChangeRate)}
        </div>

        {/* 주문 건수 */}
        <div className="kpi-card">
          <div className="kpi-label">{'\uC8FC\uBB38 \uAC74\uC218'}</div>
          <div
            className="kpi-value"
            style={{
              fontWeight: 650,
              color: 'var(--text-primary)',
              ...nums,
            }}
          >
            {formatNumber(totalOrders)}
            <span
              className="unit"
              style={{
                color: '#9AA2AA',
                fontWeight: 400,
                fontSize: '0.6em',
              }}
            >
              {'\uAC74'}
            </span>
          </div>
          <div className="kpi-sub">
            {'\uC77C\uD3C9\uADE0'} {dailyAvgOrdersCalc}
            {'\uAC74'}
          </div>
          {renderComparison(ordersChangeRate)}
        </div>

        {/* 판매 낱개수 */}
        <div className="kpi-card">
          <div className="kpi-label">
            {'\uD310\uB9E4 \uB0B1\uAC1C\uC218'}
          </div>
          <div
            className="kpi-value"
            style={{
              fontWeight: 650,
              color: 'var(--text-primary)',
              ...nums,
            }}
          >
            {formatNumber(totalUnitsSold)}
            <span
              className="unit"
              style={{
                color: '#9AA2AA',
                fontWeight: 400,
                fontSize: '0.6em',
              }}
            >
              {'\uAC1C'}
            </span>
          </div>
          <div className="kpi-sub">
            {'\uC8FC\uBB38\uB2F9'} {unitsPerOrder}
            {'\uAC1C'}
          </div>
          {renderComparison(unitsChangeRate)}
        </div>
      </div>

      {/* ---- 2. Chart + Period Summary ---- */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--card-gap)', marginBottom: 'var(--card-gap)', height: 400, alignItems: 'stretch' }}>
          {/* LEFT 2/3: Chart */}
          <div className="section" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="section-header" style={{ flexShrink: 0 }}>
              <span className="section-title">
                {'매출 추이'}
              </span>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                {chartMode === 'daily' && (
                  <span
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      marginRight: 8,
                    }}
                  >
                    {'포인트를 클릭하면 해당 날짜 상세가 열립니다'}
                  </span>
                )}
                <div className="filter-segment">
                  <button
                    className={`seg-btn${chartMode === 'daily' ? ' active' : ''}`}
                    onClick={() => setChartMode('daily')}
                  >
                    {'일별'}
                  </button>
                  <button
                    className={`seg-btn${chartMode === 'weekly' ? ' active' : ''}`}
                    onClick={() => !weeklyDisabled && setChartMode('weekly')}
                    disabled={weeklyDisabled}
                    title={weeklyDisabled ? '기간이 일주일 미만입니다' : undefined}
                  >
                    {'주별'}
                  </button>
                  <button
                    className={`seg-btn${chartMode === 'monthly' ? ' active' : ''}`}
                    onClick={() =>
                      !monthlyDisabled && setChartMode('monthly')
                    }
                    disabled={monthlyDisabled}
                    title={monthlyDisabled ? '기간이 한 달 미만입니다' : undefined}
                  >
                    {'월별'}
                  </button>
                </div>
              </div>
            </div>

            {daily.length > 0 ? (
            <>
              <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                {chartMode === 'daily' && (
                  <DailyAreaChart
                    daily={daily}
                    selectedDay={selectedDay}
                    onSelectDay={toggleDay}
                    dailyDetails={dailyDetails}
                  />
                )}
                {chartMode === 'weekly' && <BarChart data={weeklyData} />}
                {chartMode === 'monthly' && <BarChart data={monthlyData} />}
              </div>
              {/* Chart legend */}
              <div
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  gap: 16,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  padding: '12px 16px 16px 56px',
                }}
              >
                {PRODUCT_ORDER_CHART.filter(product => {
                  const hasSales = daily.some(d => {
                    const detail = dailyDetails[d.date] || [];
                    return detail.some(x => x.product === product && x.sales > 0);
                  });
                  return hasSales;
                }).map((product) => (
                  <span
                    key={product}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 12,
                      fontWeight: 450,
                      color: '#565D64',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        background: PRODUCT_COLORS[product],
                        borderRadius: '50%',
                      }}
                    />
                    {product}
                  </span>
                ))}
              </div>
            </>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A9199', fontSize: 13 }}>선택 기간에 매출 데이터가 없습니다.</div>
            )}
          </div>

          {/* RIGHT 1/3: Period Summary */}
          <div className="section" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="section-header" style={{ flexShrink: 0 }}>
              <span className="section-title">기간 요약</span>
            </div>
            <div className="card-scroll" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
              <PeriodSummary
                daily={daily}
                dailyDetails={dailyDetails}
                totalSales={totalSales}
                totalOrders={totalOrders}
                totalUnitsSold={totalUnitsSold}
                numDays={numDays}
                monthlyData={monthlyData}
                products={products}
                periodStart={periodStart}
                periodEnd={periodEnd}
              />
            </div>
          </div>
        </div>
      {/* ---- Day detail card (SEPARATE from chart card) ---- */}
      {selectedDay &&
        (() => {
          const dayData = daily.find((d) => d.date === selectedDay);
          const detail = dailyDetails[selectedDay] ?? [];
          if (!dayData) return null;
          return (
            <div className="section">
              <div className="section-header">
                <span className="section-title">
                  {selectedDay} {'·'} {formatKRW(dayData.sales)}
                </span>
                <button
                  className="btn-ghost"
                  onClick={() => setSelectedDay(null)}
                >
                  {'\uB2EB\uAE30'}
                </button>
              </div>
              <div className="section-body">
                {detail.length > 0 ? (
                  <table className="data-table" style={{ fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={{ color: 'var(--text-muted)' }}>
                          {'\uC81C\uD488'}
                        </th>
                        <th
                          className="right"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {'\uB9E4\uCD9C'}
                        </th>
                        <th
                          className="right"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {'\uB0B1\uAC1C\uC218'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.map((d) => (
                        <tr key={d.product}>
                          <td
                            style={{
                              fontWeight: 500,
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {d.product}
                          </td>
                          <td
                            className="right"
                            style={{
                              color: 'var(--text-secondary)',
                              ...nums,
                            }}
                          >
                            {formatKRW(d.sales)}
                          </td>
                          <td
                            className="right"
                            style={{
                              color: 'var(--text-secondary)',
                              ...nums,
                            }}
                          >
                            {formatNumber(d.unitsSold)}
                            {'\uAC1C'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div
                    style={{
                      padding: 24,
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {'\uD574\uB2F9 \uB0A0\uC9DC \uC0C1\uC138 \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.'}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

      {/* ---- 3. Table + Donut grid ---- */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--card-gap)', marginBottom: 'var(--card-gap)', height: 420, alignItems: 'stretch' }}>
        {/* Left 2/3: Table */}
        <div className="section" style={{ marginBottom: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="section-header">
            <span className="section-title">
              {'\uC81C\uD488\uBCC4 \uB9E4\uCD9C'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="btn-ghost" onClick={handleCSV}>
                CSV {'\uB0B4\uBCF4\uB0B4\uAE30'}
              </button>
            </div>
          </div>
          <div className="section-body card-scroll" style={{ flex: 1, overflowY: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 200, color: 'var(--text-muted)', background: '#F7F9FB' }}>
                    {'\uC81C\uD488 / \uC635\uC158'}
                  </th>
                  <th
                    className="right"
                    style={{ color: 'var(--text-muted)', background: '#F7F9FB' }}
                  >
                    {'\uB9E4\uCD9C'}
                  </th>
                  <th
                    className="right"
                    style={{ color: 'var(--text-muted)', background: '#F7F9FB' }}
                  >
                    {'\uC8FC\uBB38 \uAC74\uC218'}
                  </th>
                  <th
                    className="right"
                    style={{ color: 'var(--text-muted)', background: '#F7F9FB' }}
                  >
                    {'\uD310\uB9E4 \uB0B1\uAC1C\uC218'}
                  </th>
                  <th
                    className="right"
                    style={{ width: 72, color: 'var(--text-muted)', background: '#F7F9FB' }}
                  >
                    {'\uBE44\uC911'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.map((p, pIdx) => (
                  <Fragment key={p.product}>
                    {/* Product row */}
                    <tr style={{ backgroundColor: '#F5F8FA' }}>
                      <td style={tdPad}>
                        <span
                          style={{
                            display: 'inline-block',
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: PRODUCT_COLORS[p.product] || '#9CA5B0',
                            marginRight: 8,
                          }}
                        />
                        <span
                          style={{ fontWeight: 600, color: '#61686F' }}
                        >
                          {p.product}
                        </span>
                        {p.spec && (
                          <span
                            className="product-spec"
                            style={{ fontSize: 11.5, fontWeight: 500 }}
                          >
                            {p.spec}
                          </span>
                        )}
                      </td>
                      <td
                        className="right"
                        style={{
                          color: 'var(--text-secondary)',
                          ...nums,
                          ...tdPad,
                        }}
                      >
                        {formatKRW(p.sales)}
                      </td>
                      <td
                        className="right"
                        style={{
                          color: 'var(--text-secondary)',
                          ...nums,
                          ...tdPad,
                        }}
                      >
                        {formatNumber(p.orders)}
                        {'\uAC74'}
                      </td>
                      <td
                        className="right"
                        style={{
                          color: 'var(--text-secondary)',
                          ...nums,
                          ...tdPad,
                        }}
                      >
                        {formatNumber(p.unitsSold)}
                      </td>
                      <td
                        className="right"
                        style={{
                          color: 'var(--text-secondary)',
                          ...nums,
                          ...tdPad,
                        }}
                      >
                        {productPercents[pIdx]}%
                      </td>
                    </tr>

                    {/* Option rows (sorted by revenue desc) */}
                    {[...p.options].sort((a, b) => b.sales - a.sales).map((o) => {
                      const zeroSales = o.sales === 0;
                      const cellColor = zeroSales ? '#C4CAD1' : 'var(--text-secondary)';
                      return (
                        <tr
                          key={`${p.product}-${o.option}`}
                          className="option-row"
                        >
                          <td style={{ paddingLeft: 32, ...optTdPad, color: cellColor }}>
                            <span>{o.option}</span>
                            <span
                              style={{
                                fontSize: 12,
                                color: zeroSales ? '#C4CAD1' : 'var(--text-muted)',
                                marginLeft: 6,
                              }}
                            >
                              {o.unitCount}
                              {'\uAC1C\uC785'}
                            </span>
                          </td>
                          <td
                            className="right"
                            style={{
                              color: cellColor,
                              ...nums,
                              ...optTdPad,
                            }}
                          >
                            {formatKRW(o.sales)}
                          </td>
                          <td
                            className="right"
                            style={{
                              color: cellColor,
                              ...nums,
                              ...optTdPad,
                            }}
                          >
                            {formatNumber(o.orders)}
                            {'\uAC74'}
                          </td>
                          <td
                            className="right"
                            style={{
                              color: cellColor,
                              ...nums,
                              ...optTdPad,
                            }}
                          >
                            {formatNumber(o.unitsSold)}
                          </td>
                          <td
                            className="right"
                            style={{
                              color: cellColor,
                              ...nums,
                              ...optTdPad,
                            }}
                          >
                            {(o.share * 100).toFixed(1)}%
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}

                {/* Grand total */}
                {products.length > 0 && (
                  <tr className="total-row">
                    <td
                      style={{
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        background: '#FAFBFC',
                        ...tdPad,
                      }}
                    >
                      {'\uD569\uACC4'}
                    </td>
                    <td
                      className="right"
                      style={{
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        background: '#FAFBFC',
                        ...nums,
                        ...tdPad,
                      }}
                    >
                      {formatKRW(totalSales)}
                    </td>
                    <td
                      className="right"
                      style={{
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        background: '#FAFBFC',
                        ...nums,
                        ...tdPad,
                      }}
                    >
                      {formatNumber(totalOrders)}
                      {'\uAC74'}
                    </td>
                    <td
                      className="right"
                      style={{
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        background: '#FAFBFC',
                        ...nums,
                        ...tdPad,
                      }}
                    >
                      {formatNumber(totalUnitsSold)}
                    </td>
                    <td
                      className="right"
                      style={{
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        background: '#FAFBFC',
                        ...nums,
                        ...tdPad,
                      }}
                    >
                      100%
                    </td>
                  </tr>
                )}

                {/* Empty state */}
                {products.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      style={{
                        textAlign: 'center',
                        color: 'var(--text-muted)',
                        padding: 24,
                      }}
                    >
                      {'\uC120\uD0DD \uAE30\uAC04\uC5D0 \uB9E4\uCD9C \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* Footnote */}
            {products.length > 0 && productOrderSum !== totalOrders && (
              <div
                className="table-footnote"
                style={{ fontSize: 11, color: '#9AA2AA' }}
              >
                제품별 합 {formatNumber(productOrderSum)}건 · 중복 주문 {formatNumber(productOrderSum - totalOrders)}건 제외
              </div>
            )}
            {products.length > 0 && (
              <div style={{ fontSize: 11, color: '#9AA2AA', marginTop: 4, padding: '0 16px 8px' }}>
                판매 낱개수는 세트 상품을 개별 낱개로 환산한 수량입니다 (예: 2개 세트 1건 = 2개). 쿠팡 윙의 판매수량과 다를 수 있습니다.
              </div>
            )}
            {/* Option composition + per-order metrics */}
            {products.length > 0 && (() => {
              const allOptions = products.flatMap(p => p.options.filter(o => o.orders > 0).map(o => ({
                label: `${p.product} ${o.option}`, orders: o.orders, sales: o.sales,
              })));
              allOptions.sort((a, b) => b.orders - a.orders);
              const avgOrderValue = totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0;
              return (
                <div style={{ borderTop: '1px solid #E4E8EC', margin: '8px 16px 0', padding: '10px 0 8px' }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: '#1A1D21', marginBottom: 6 }}>옵션 구성</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {allOptions.slice(0, 5).map(o => (
                      <div key={o.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                        <span style={{ color: '#565D64' }}>{o.label}</span>
                        <span style={{ color: '#1A1D21', fontWeight: 500 }}>
                          {formatNumber(o.orders)}건 · {totalOrders > 0 ? ((o.orders / totalOrders) * 100).toFixed(1) : '0'}%
                        </span>
                      </div>
                    ))}
                  </div>
                  <div style={{ borderTop: '1px solid #F2F4F7', marginTop: 8, paddingTop: 8, display: 'flex', gap: 16, fontSize: 12 }}>
                    <span style={{ color: '#565D64' }}>건당 매출 <span style={{ fontWeight: 600, color: '#1A1D21', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(avgOrderValue)}원</span></span>
                    <span style={{ color: '#565D64' }}>건당 낱개수 <span style={{ fontWeight: 600, color: '#1A1D21', fontVariantNumeric: 'tabular-nums' }}>{unitsPerOrder}개</span></span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Right 1/3: Donut */}
        <div className="section" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="section-header">
            <span className="section-title">제품 비중</span>
          </div>
          <div style={{ flex: 1, padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <ProductDonut products={products} totalSales={totalSales} />
          </div>
        </div>
      </div>

    </AppShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Period Summary                                                      */
/* ------------------------------------------------------------------ */

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'] as const;

function getDayName(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  return DAY_NAMES[d.getDay()];
}

function fmtDateWithDay(dateStr: string): string {
  return `${dateStr.slice(5).replace('-', '/')} (${getDayName(dateStr)})`;
}

function PeriodSummary({
  daily,
  dailyDetails,
  totalSales,
  totalOrders,
  totalUnitsSold,
  numDays,
  monthlyData,
  products,
  periodStart,
  periodEnd,
}: {
  daily: DailyPoint[];
  dailyDetails: Record<string, DayDetailProduct[]>;
  totalSales: number;
  totalOrders: number;
  totalUnitsSold: number;
  numDays: number;
  monthlyData: MonthBucket[];
  products: ProductRow[];
  periodStart: string;
  periodEnd: string;
}) {
  const daysWithSales = daily.filter((d) => d.sales > 0);

  // Max/Min sales day
  const maxDay = daysWithSales.length > 0
    ? daysWithSales.reduce((a, b) => (a.sales >= b.sales ? a : b))
    : null;
  const minDay = daysWithSales.length > 0
    ? daysWithSales.reduce((a, b) => (a.sales <= b.sales ? a : b))
    : null;

  const dailyAvg = numDays > 0 ? Math.round(totalSales / numDays) : 0;

  // Find days without sales in the period
  const salesDateSet = new Set(daysWithSales.map(d => d.date));
  const missingDays: string[] = [];
  const pStart = new Date(periodStart);
  const pEnd = new Date(periodEnd);
  for (let dt = new Date(pStart); dt <= pEnd; dt.setDate(dt.getDate() + 1)) {
    const ds = dt.toISOString().slice(0, 10);
    if (!salesDateSet.has(ds)) missingDays.push(ds);
  }


  // Day-of-week sales (for periods < 31 days)
  const useWeekday = numDays >= 7 && numDays < 31;
  const dowSales: { day: string; sales: number; unreflected: boolean }[] = [];

  // Determine today's day-of-week index for "미반영" marking
  const todayKST = new Date(Date.now() + 9 * 3_600_000);
  const todayStr = todayKST.toISOString().slice(0, 10);
  // Check if today is within period and has no data
  const todayInPeriod = todayStr >= periodStart && todayStr <= periodEnd;
  const todayHasData = daily.some(d => d.date === todayStr);
  const todayDow = todayKST.getDay(); // 0=Sun
  const todayDowIdx = todayDow === 0 ? 6 : todayDow - 1; // Mon=0..Sun=6

  if (useWeekday) {
    const dayTotals = [0, 0, 0, 0, 0, 0, 0]; // 월~일
    for (const d of daily) {
      const dt = new Date(d.date + 'T00:00:00+09:00');
      const dow = dt.getDay(); // 0=Sun
      const idx = dow === 0 ? 6 : dow - 1; // Mon=0 ... Sun=6
      dayTotals[idx] += d.sales;
    }
    const dayLabels = ['월', '화', '수', '목', '금', '토', '일'];
    for (let i = 0; i < 7; i++) {
      // Mark as unreflected if today is in period, has no data, and matches this dow
      const isUnreflected = todayInPeriod && !todayHasData && i === todayDowIdx;
      dowSales.push({ day: dayLabels[i], sales: dayTotals[i], unreflected: isUnreflected });
    }
  }
  const dowMax = Math.max(...dowSales.map(d => d.sales), 1);

  // Empty state
  if (totalSales === 0 && daily.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#61686F' }}>선택 기간에 매출이 없습니다</div>
        <div style={{ fontSize: 12.5, fontWeight: 450, color: '#838B93', marginTop: 4 }}>기간을 바꾸거나 동기화를 확인해주세요</div>
      </div>
    );
  }

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 12.5,
    fontWeight: 600,
    color: '#1A1D21',
    marginBottom: 8,
  };

  const sectionDivider: React.CSSProperties = {
    borderTop: '1px solid #E4E8EC',
    margin: '16px 0',
  };

  const psLabelStyle: React.CSSProperties = {
    color: '#565D64',
    fontSize: 13,
    fontWeight: 450,
    flexShrink: 0,
  };

  const psValueStyle: React.CSSProperties = {
    color: '#1A1D21',
    fontWeight: 650,
    fontVariantNumeric: 'tabular-nums',
    fontSize: 15,
    textAlign: 'right',
  };

  const psSubStyle: React.CSSProperties = {
    color: '#6E767E',
    fontWeight: 450,
    fontVariantNumeric: 'tabular-nums',
    fontSize: 12,
    textAlign: 'right',
  };

  return (
    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', flex: 1 }}>
      {/* Section 1: Period Metrics */}
      <div style={sectionTitleStyle}>기간 지표</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Highest sales day */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <span style={psLabelStyle}>최고 매출일</span>
          <div style={{ textAlign: 'right' }}>
            <div style={psValueStyle}>{maxDay ? formatKRW(maxDay.sales) : '-'}</div>
            <div style={psSubStyle}>{maxDay ? fmtDateWithDay(maxDay.date) : ''}</div>
          </div>
        </div>
        {/* Lowest sales day */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <span style={psLabelStyle}>최저 매출일</span>
          <div style={{ textAlign: 'right' }}>
            <div style={{ ...psValueStyle, fontSize: 14, fontWeight: 600 }}>{minDay ? formatKRW(minDay.sales) : '-'}</div>
            <div style={psSubStyle}>{minDay ? fmtDateWithDay(minDay.date) : ''}</div>
          </div>
        </div>
        {/* Daily average */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <span style={psLabelStyle}>일평균</span>
          <div style={psValueStyle}>{formatKRW(dailyAvg)}</div>
        </div>
        {/* Sales days */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <span style={psLabelStyle}>매출 발생일</span>
          <div style={{ textAlign: 'right' }}>
            <div style={{ ...psValueStyle, fontSize: 14, fontWeight: 600 }}>{daysWithSales.length}일 / {numDays}일</div>
            {missingDays.length > 0 && missingDays.length <= 5 && (
              <div style={{ fontSize: 12, fontWeight: 450, color: '#A8712A', marginTop: 2 }}>
                {missingDays.map(d => {
                  if (d === todayStr) {
                    return `${fmtDateWithDay(d)} 미반영`;
                  }
                  return `${fmtDateWithDay(d)} 매출 없음`;
                }).join(', ')}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section 2: Day-of-week or Monthly sales */}
      <div style={sectionDivider} />
      {useWeekday ? (
        <>
          <div style={sectionTitleStyle}>요일별 매출</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {dowSales.map(ds => {
              const barWidth = dowMax > 0 ? (ds.sales / dowMax) * 100 : 0;
              const isMax = ds.sales === dowMax && ds.sales > 0;
              const barColor = isMax ? '#4A7DB5' : '#C4CAD1';
              return (
                <div key={ds.day} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 22 }}>
                  <span style={{ width: 16, fontSize: 12, fontWeight: 450, color: '#565D64', textAlign: 'center', flexShrink: 0 }}>{ds.day}</span>
                  {ds.unreflected ? (
                    <>
                      <div style={{ flex: 1 }} />
                      <span style={{ fontSize: 12, color: '#8A9199', minWidth: 70, textAlign: 'right', flexShrink: 0 }}>미반영</span>
                    </>
                  ) : ds.sales > 0 ? (
                    <>
                      <div style={{ flex: 1, height: 14, background: '#F5F7F9', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${barWidth}%`, height: '100%', background: barColor, borderRadius: 3, transition: 'width 0.3s' }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 500, color: '#1A1D21', fontVariantNumeric: 'tabular-nums', minWidth: 70, textAlign: 'right', flexShrink: 0 }}>
                        {formatKRW(ds.sales)}
                      </span>
                    </>
                  ) : (
                    <>
                      <div style={{ flex: 1 }} />
                      <span style={{ fontSize: 12, color: '#9AA2AA', minWidth: 70, textAlign: 'right', flexShrink: 0 }}>—</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div style={sectionTitleStyle}>월별 매출 (선택 기간 내)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }} className="card-scroll">
            {monthlyData.length > 0 ? monthlyData.map((m) => {
              const share = totalSales > 0 ? (m.sales / totalSales * 100).toFixed(1) : '0';
              return (
                <div key={m.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', lineHeight: 2 }}>
                  <span style={{ ...psLabelStyle, fontSize: 12 }}>{m.label}</span>
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#1A1D21' }}>{formatKRW(m.sales)}</span>
                    <span style={{ fontSize: 12, fontWeight: 450, color: '#6E767E', marginLeft: 6 }}>{share}%</span>
                  </span>
                </div>
              );
            }) : (
              <div style={{ fontSize: 12.5, color: '#8A9199' }}>데이터가 없습니다</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Daily Area Chart (SVG) - Overlaid per product                      */
/* ------------------------------------------------------------------ */

function DailyAreaChart({
  daily,
  selectedDay,
  onSelectDay,
  dailyDetails,
}: {
  daily: DailyPoint[];
  selectedDay: string | null;
  onSelectDay: (date: string) => void;
  dailyDetails: Record<string, DayDetailProduct[]>;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [cSize, setCSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setCSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const VW = 900;
  const padL = 56;
  const padR = 16;
  const padT = 8;
  const padB = 24;
  const n = daily.length || 1;

  const totalH = cSize ? Math.round(VW * cSize.h / cSize.w) : 224;
  const drawW = VW - padL - padR;
  const drawH = totalH - padT - padB;
  const dataBottom = padT + drawH;

  /* Overlay data computation - each product from baseline 0 */
  const overlayData = daily.map((d) => {
    const breakdown = dailyDetails[d.date] || [];
    const byProduct: Record<string, number> = {};
    for (const p of breakdown) byProduct[p.product] = p.sales;
    return { date: d.date, byProduct, total: d.sales };
  });

  /* Filter products with any non-zero sales */
  const activeProducts = PRODUCT_ORDER_CHART.filter(product =>
    overlayData.some(d => (d.byProduct[product] || 0) > 0)
  );

  const maxProductSales = Math.max(
    ...overlayData.flatMap((d) =>
      activeProducts.map((p) => d.byProduct[p] || 0),
    ),
    1,
  );
  const yTicks = computeYTicks(maxProductSales);
  const yMax = yTicks[yTicks.length - 1] || maxProductSales;

  const xScale = (i: number) =>
    padL + (n > 1 ? (i / (n - 1)) * drawW : drawW / 2);
  const yScale = (v: number) =>
    dataBottom - (yMax > 0 ? (v / yMax) * drawH : 0);

  /* Build paths for each product layer (overlaid from baseline 0) */
  const layerPaths = activeProducts.map((product) => {
    const color = PRODUCT_COLORS[product] || '#9CA5B0';

    const pts = overlayData.map((d, i) => ({
      x: xScale(i),
      y: yScale(d.byProduct[product] || 0),
    }));

    /* <= 7 points: straight lines; >= 8: monotone curve */
    const linePath = n <= 7
      ? pts.map((p, j) => `${j === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
      : monotonePath(pts, yScale(0));

    return { product, color, linePath, pts };
  });

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0 }}>
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${VW} ${totalH}`}
      preserveAspectRatio="xMinYMin meet"
      style={{ display: 'block', cursor: 'pointer' }}
      onMouseLeave={() => setHoverIdx(null)}
    >
      {/* Y-axis gridlines + labels */}
      {yTicks.map((tick) => {
        const y = yScale(tick);
        return (
          <g key={tick}>
            <line
              x1={padL}
              x2={VW - padR}
              y1={y}
              y2={y}
              stroke="#EAEDF0"
              strokeWidth={1}
            />
            <text
              x={padL - 8}
              y={y + 4}
              textAnchor="end"
              fontSize={11}
              fill="#6E767E"
              fontWeight={500}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatChartAxis(tick)}
            </text>
          </g>
        );
      })}

      {/* Overlaid lines */}
      {layerPaths.map(({ product, color, linePath, pts }) => (
        <g key={product}>
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke={color}
              strokeWidth={2}
            />
          )}
          {n <= 7 && pts.map((pt, i) => {
            const val = overlayData[i]?.byProduct[product] || 0;
            if (val <= 0) return null;
            return <circle key={i} cx={pt.x} cy={pt.y} r={3} fill={color} stroke="white" strokeWidth={1.5} />;
          })}
        </g>
      ))}

      {/* Selected day vertical indicator */}
      {selectedDay &&
        (() => {
          const idx = daily.findIndex((d) => d.date === selectedDay);
          if (idx < 0) return null;
          return (
            <line
              x1={xScale(idx)}
              x2={xScale(idx)}
              y1={padT}
              y2={dataBottom}
              stroke="#4A90D9"
              strokeWidth={1.5}
              opacity={0.4}
            />
          );
        })()}

      {/* Hover vertical guide line */}
      {hoverIdx !== null && (
        <line
          x1={xScale(hoverIdx)}
          x2={xScale(hoverIdx)}
          y1={padT}
          y2={dataBottom}
          stroke="#9AA2AA"
          strokeWidth={1}
          strokeDasharray="4 3"
          opacity={0.4}
        />
      )}

      {/* Hover dots on each product line */}
      {hoverIdx !== null &&
        layerPaths.map(({ product, color, pts }) => {
          const pt = pts[hoverIdx];
          if (!pt) return null;
          const val = overlayData[hoverIdx]?.byProduct[product] || 0;
          if (val <= 0) return null;
          return (
            <circle
              key={product}
              cx={pt.x}
              cy={pt.y}
              r={3.5}
              fill={color}
              stroke="white"
              strokeWidth={1.5}
            />
          );
        })}

      {/* Hit areas + date labels */}
      {daily.map((d, i) => {
        const isSelected = selectedDay === d.date;
        const isHovered = hoverIdx === i;
        /* Label spacing: min width per label, first+last always shown */
        const minLabelW = n <= 7 ? 48 : 24;
        const maxLabels = Math.max(2, Math.floor(drawW / minLabelW));
        const showLabel = n <= maxLabels
          ? true
          : i === 0 || i === n - 1 || i % Math.ceil(n / maxLabels) === 0;

        const detail = dailyDetails[d.date] || [];
        const tooltipParts = PRODUCT_ORDER_CHART.map((p) => {
          const pd = detail.find((x) => x.product === p);
          return `${p}: ${formatKRW(pd?.sales || 0)}`;
        });
        const tooltip = `${d.date}\n${tooltipParts.join('\n')}\n\uD569\uACC4: ${formatKRW(d.sales)}`;

        return (
          <g
            key={d.date}
            onClick={() => onSelectDay(d.date)}
            onMouseEnter={() => setHoverIdx(i)}
            style={{ cursor: 'pointer' }}
          >
            <title>{tooltip}</title>
            {/* Invisible hit area */}
            <rect
              x={xScale(i) - drawW / n / 2}
              y={0}
              width={drawW / n}
              height={totalH}
              fill="transparent"
            />
            {/* Date label */}
            {showLabel && (
              <text
                x={xScale(i)}
                y={dataBottom + 16}
                textAnchor="middle"
                fontSize={11}
                fill={isSelected || isHovered ? '#4A90D9' : '#9AA2AA'}
                fontWeight={isSelected ? 600 : 400}
              >
                {n <= 7 ? d.date.slice(5).replace('-', '/') : String(parseInt(d.date.slice(8)))}
              </text>
            )}
          </g>
        );
      })}
    </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Product Donut (single ring, products only)                         */
/* ------------------------------------------------------------------ */

function ProductDonut({ products, totalSales }: { products: ProductRow[]; totalSales: number }) {
  const cx = 100, cy = 100, outerR = 80, innerR = 52;
  const filtered = products.filter(p => p.sales > 0);

  if (filtered.length === 0) {
    return <div style={{ color: '#8A9199', fontSize: 13, textAlign: 'center' }}>데이터가 없습니다</div>;
  }

  const gapDeg = 2;
  const totalGap = gapDeg * filtered.length;
  const availableDeg = 360 - totalGap;

  const toRad = (d: number) => (d * Math.PI) / 180;
  function arcPath(start: number, sweep: number, outer: number, inner: number): string {
    const x1 = cx + outer * Math.cos(toRad(start));
    const y1 = cy + outer * Math.sin(toRad(start));
    const x2 = cx + outer * Math.cos(toRad(start + sweep));
    const y2 = cy + outer * Math.sin(toRad(start + sweep));
    const x3 = cx + inner * Math.cos(toRad(start + sweep));
    const y3 = cy + inner * Math.sin(toRad(start + sweep));
    const x4 = cx + inner * Math.cos(toRad(start));
    const y4 = cy + inner * Math.sin(toRad(start));
    const large = sweep > 180 ? 1 : 0;
    return `M${x1},${y1} A${outer},${outer} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 ${large} 0 ${x4},${y4} Z`;
  }

  let startAngle = -90;
  const segments = filtered.map(p => {
    const sweepDeg = (p.sales / totalSales) * availableDeg;
    const seg = { product: p.product, color: PRODUCT_COLORS[p.product] || '#9CA5B0', startAngle, sweepDeg, share: p.share };
    startAngle += sweepDeg + gapDeg;
    return seg;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <svg width={200} height={200} viewBox="0 0 200 200">
        {segments.map(s => (
          <path key={s.product} d={arcPath(s.startAngle, s.sweepDeg, outerR, innerR)} fill={s.color} />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={11} fill="#6E767E" fontWeight={450}>총매출</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize={16} fill="#1A1D21" fontWeight={650} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatCompact(totalSales)}
        </text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
        {filtered.map(p => (
          <div key={p.product} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: PRODUCT_COLORS[p.product] || '#9CA5B0', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 450, color: '#565D64', flexShrink: 0 }}>{p.product}</span>
            <span style={{ fontSize: 12.5, fontWeight: 500, color: '#1A1D21', fontVariantNumeric: 'tabular-nums', marginLeft: 'auto' }}>
              {formatNumber(p.sales)}원
            </span>
            <span style={{ fontSize: 12, fontWeight: 500, color: '#9AA2AA', fontVariantNumeric: 'tabular-nums', minWidth: 38, textAlign: 'right' }}>
              {(p.share * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Line Chart (for weekly / monthly) - Overlaid per product           */
/* ------------------------------------------------------------------ */

function BarChart({
  data,
}: {
  data: {
    label: string;
    sales: number;
    orders: number;
    units: number;
    byProduct: Record<string, number>;
  }[];
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [cSize, setCSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setCSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const VW = 900;
  const padL = 56;
  const padR = 16;
  const padT = 8;
  const padB = 24;
  const n = data.length || 1;

  const totalH = cSize ? Math.round(VW * cSize.h / cSize.w) : 224;
  const drawW = VW - padL - padR;
  const drawH = totalH - padT - padB;
  const dataBottom = padT + drawH;

  const activeProducts = PRODUCT_ORDER_CHART.filter(product =>
    data.some(d => (d.byProduct[product] || 0) > 0)
  );

  const maxProductSales = Math.max(
    ...data.flatMap(d => activeProducts.map(p => d.byProduct[p] || 0)),
    1,
  );
  const yTicks = computeYTicks(maxProductSales);
  const yMax = yTicks[yTicks.length - 1] || maxProductSales;

  const xScale = (i: number) =>
    padL + (n > 1 ? (i / (n - 1)) * drawW : drawW / 2);
  const yScale = (v: number) =>
    dataBottom - (yMax > 0 ? (v / yMax) * drawH : 0);

  const layerPaths = activeProducts.map((product) => {
    const color = PRODUCT_COLORS[product] || '#9CA5B0';
    const pts = data.map((d, i) => ({
      x: xScale(i),
      y: yScale(d.byProduct[product] || 0),
    }));
    const linePath = n <= 7
      ? pts.map((p, j) => `${j === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
      : monotonePath(pts, yScale(0));
    return { product, color, linePath, pts };
  });

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0 }}>
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${VW} ${totalH}`}
      preserveAspectRatio="xMinYMin meet"
      style={{ display: 'block', cursor: 'pointer' }}
      onMouseLeave={() => setHoverIdx(null)}
    >
      {/* Y-axis gridlines + labels */}
      {yTicks.map((tick) => {
        const y = yScale(tick);
        return (
          <g key={tick}>
            <line
              x1={padL}
              x2={VW - padR}
              y1={y}
              y2={y}
              stroke="#EAEDF0"
              strokeWidth={1}
            />
            <text
              x={padL - 8}
              y={y + 4}
              textAnchor="end"
              fontSize={11}
              fill="#6E767E"
              fontWeight={500}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatChartAxis(tick)}
            </text>
          </g>
        );
      })}

      {/* Overlaid lines */}
      {layerPaths.map(({ product, color, linePath, pts }) => (
        <g key={product}>
          {linePath && <path d={linePath} fill="none" stroke={color} strokeWidth={2} />}
          {n <= 7 && pts.map((pt, i) => {
            const val = data[i]?.byProduct[product] || 0;
            if (val <= 0) return null;
            return <circle key={i} cx={pt.x} cy={pt.y} r={3} fill={color} stroke="white" strokeWidth={1.5} />;
          })}
        </g>
      ))}

      {/* Hover vertical guide */}
      {hoverIdx !== null && (
        <line x1={xScale(hoverIdx)} x2={xScale(hoverIdx)} y1={padT} y2={dataBottom} stroke="#9AA2AA" strokeWidth={1} strokeDasharray="4 3" opacity={0.4} />
      )}

      {/* Hover dots */}
      {hoverIdx !== null && layerPaths.map(({ product, color, pts }) => {
        const pt = pts[hoverIdx];
        if (!pt) return null;
        const val = data[hoverIdx]?.byProduct[product] || 0;
        if (val <= 0) return null;
        return <circle key={product} cx={pt.x} cy={pt.y} r={3.5} fill={color} stroke="white" strokeWidth={1.5} />;
      })}

      {/* Hit areas + labels */}
      {data.map((d, i) => {
        const isHovered = hoverIdx === i;
        const tooltipLabel = (d as { fullLabel?: string }).fullLabel || d.label;
        const tooltipParts = PRODUCT_ORDER_CHART.map(p => `${p}: ${formatKRW(d.byProduct[p] || 0)}`);
        const tooltip = `${tooltipLabel}\n${tooltipParts.join('\n')}\n합계: ${formatKRW(d.sales)}`;
        const minLabelW = 64;
        const maxLabels = Math.max(2, Math.floor(drawW / minLabelW));
        const showLabel = n <= maxLabels || i === 0 || i === n - 1 || i % Math.ceil(n / maxLabels) === 0;
        return (
          <g key={i} onMouseEnter={() => setHoverIdx(i)} style={{ cursor: 'pointer' }}>
            <title>{tooltip}</title>
            <rect x={xScale(i) - drawW / n / 2} y={0} width={drawW / n} height={totalH} fill="transparent" />
            {showLabel && (
              <text x={xScale(i)} y={dataBottom + 16} textAnchor="middle" fontSize={11} fill={isHovered ? '#4A90D9' : '#9AA2AA'} fontWeight={isHovered ? 600 : 400}>
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
    </div>
  );
}
