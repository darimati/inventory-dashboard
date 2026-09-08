'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import DualDonutChart from '@/components/DualDonutChart';
import { formatKRW, formatNumber, formatCompact, formatDateShort, formatChartAxis } from '@/lib/helpers';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type StockStatus = 'oos' | 'order_needed' | 'transfer_review' | 'normal' | 'no_sales';
type ChartMode = 'daily' | 'weekly' | 'monthly';

interface DailyPoint {
  date: string;
  sales: number;
  orders: number;
  quantity: number;
}

interface ProductBreakdownRow {
  product: string;
  sales: number;
  orders: number;
  setsSold: number;
  unitsSold: number;
  share: number;
}

interface OptionBreakdownRow {
  option: string;
  unitCount: number;
  spec: string;
  sales: number;
  orders: number;
  setsSold: number;
  unitsSold: number;
  share: number;
}

interface DailyProductDetail {
  product: string;
  sales: number;
  units: number;
}

interface TodayCheck {
  dot: 'red' | 'amber' | 'gray' | 'blue';
  title: string;
  description: string;
}

interface OptionInventoryForHome {
  product: string;
  option: string;
  unitCount: number;
  rocketStock: number;
  dailyAvg: number;
  daysLeft: number | null;
  status: StockStatus;
  sales30d: number;
}

interface YesterdayOptionSale {
  product: string;
  option: string;
  quantity: number;
  sales: number;
}

interface HomeData {
  yesterdaySales: number;
  yesterdayOrders: number;
  yesterday: string;
  totalSales: number;
  totalOrders: number;
  totalQuantity: number;
  totalSets: number;
  compValid: boolean;
  compPeriodStart: string;
  compPeriodEnd: string;
  compPeriodLabel: string;
  compInvalidReason: string | null;
  compCaveat: string | null;
  salesChange: number | null;
  ordersChange: number | null;
  quantityChange: number | null;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  numDays: number;
  orderNeededCount: number;
  dailySales: DailyPoint[];
  dailyProductBreakdown: Record<string, DailyProductDetail[]>;
  productBreakdown: ProductBreakdownRow[];
  productOrderSum: number;
  optionBreakdownByProduct: Record<string, OptionBreakdownRow[]>;
  todayChecks: TodayCheck[];
  homeOptionInventory: OptionInventoryForHome[];
  ezadminByProductHome: Record<string, { domestic: number; shippingDomestic: number }>;
  yesterdayByOption: YesterdayOptionSale[];
  ezadminRawTotal: number;
  ezadminMappedTotal: number;
  ezadminUnmappedTotal: number;
  ezadminSuppliesTotal: number;
  ezadminUpdatedAt: string;
  ezadminIntegrityOk: boolean;
  totalCouponDiscount: number;
  couponDataCount: number;
  dataCoverageDays: number;
  earliestDataDate: string | null;
  latestDataDate: string | null;
  activePromotions: { name: string; product: string | null; discountRate: number; startDate: string; endDate: string }[];
}

/* ------------------------------------------------------------------ */
/*  Bucket types for weekly/monthly grouping                           */
/* ------------------------------------------------------------------ */

interface WeekBucket {
  label: string;     // "08/04~08/10"
  sales: number;
  orders: number;
  units: number;
  byProduct: Record<string, number>;
}

interface MonthBucket {
  label: string;     // "8월"
  sales: number;
  orders: number;
  units: number;
  byProduct: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/*  Style constants                                                    */
/* ------------------------------------------------------------------ */

const tabNums: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };

const unitStyle: React.CSSProperties = {
  fontSize: '0.6em',
  fontWeight: 400,
  color: '#9AA2AA',
};

/* ------------------------------------------------------------------ */
/*  Chart layout constants                                             */
/* ------------------------------------------------------------------ */

const VIEW_W = 900;
const PAD_L = 56;
const PAD_R = 16;
const PAD_T = 8;
const PAD_B = 24;
const CHART_W = VIEW_W - PAD_L - PAD_R;

/* ------------------------------------------------------------------ */
/*  Chart helpers                                                      */
/* ------------------------------------------------------------------ */

function computeYTicks(max: number): number[] {
  if (max <= 0) return [0, 10000, 20000, 30000, 40000];
  const candidates = [
    10000, 20000, 50000,
    100000, 200000, 250000, 500000,
    1000000, 2000000, 2500000, 5000000,
    10000000, 20000000, 25000000, 50000000,
  ];
  const quarter = max / 4;
  const interval = candidates.find(c => c >= quarter) || candidates[candidates.length - 1];
  return [0, interval, interval * 2, interval * 3, interval * 4];
}

function monotonePath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  let path = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return path;
}

function groupByWeek(
  daily: DailyPoint[],
  periodStart: string,
  periodEnd: string,
  productBreakdown?: Record<string, { product: string; sales: number }[]>,
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
        bucket.label = `${clipStart.toISOString().slice(5, 10).replace('-', '/')}~${clipEnd.toISOString().slice(5, 10).replace('-', '/')}`;
        buckets.push(bucket);
      }
      bucket = { label: '', sales: 0, orders: 0, units: 0, byProduct: {} };
      currentWeekStart = mondayStr;
      bucketMonday = new Date(monday);
    }

    bucket!.sales += d.sales;
    bucket!.orders += d.orders;
    bucket!.units += d.quantity;

    if (productBreakdown && productBreakdown[d.date]) {
      for (const p of productBreakdown[d.date]) {
        bucket!.byProduct[p.product] = (bucket!.byProduct[p.product] || 0) + p.sales;
      }
    }
  }

  if (bucket && bucketMonday) {
    const sunday = new Date(bucketMonday);
    sunday.setDate(bucketMonday.getDate() + 6);
    const clipStart = bucketMonday < pStart ? pStart : bucketMonday;
    const clipEnd = sunday > pEnd ? pEnd : sunday;
    bucket.label = `${clipStart.toISOString().slice(5, 10).replace('-', '/')}~${clipEnd.toISOString().slice(5, 10).replace('-', '/')}`;
    buckets.push(bucket);
  }
  return buckets;
}

function groupByMonth(
  daily: DailyPoint[],
  productBreakdown?: Record<string, { product: string; sales: number }[]>,
): MonthBucket[] {
  if (daily.length === 0) return [];
  const buckets: MonthBucket[] = [];
  const map = new Map<string, MonthBucket>();

  for (const d of daily) {
    const key = d.date.slice(0, 7);
    const month = parseInt(d.date.slice(5, 7));
    if (!map.has(key)) {
      const b: MonthBucket = { label: `${month}월`, sales: 0, orders: 0, units: 0, byProduct: {} };
      map.set(key, b);
      buckets.push(b);
    }
    const b = map.get(key)!;
    b.sales += d.sales;
    b.orders += d.orders;
    b.units += d.quantity;

    if (productBreakdown && productBreakdown[d.date]) {
      for (const p of productBreakdown[d.date]) {
        b.byProduct[p.product] = (b.byProduct[p.product] || 0) + p.sales;
      }
    }
  }
  return buckets;
}

function roundedTopBar(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  if (r <= 0) return `M${x},${y} H${x + w} V${y + h} H${x} Z`;
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/* ------------------------------------------------------------------ */
/*  Product colors for charts                                          */
/* ------------------------------------------------------------------ */

const PRODUCT_COLORS: Record<string, string> = {
  '클렌징밤': '#9DC3E6',
  '클렌징폼': '#7FCDBB',
  '세럼': '#F2A0A0',
};
const PRODUCT_ORDER_CHART = ['클렌징밤', '클렌징폼', '세럼'];

function hexToRGBA(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ------------------------------------------------------------------ */
/*  Status helpers                                                     */
/* ------------------------------------------------------------------ */

const SAFETY_DAYS_HOME = 21;

function daysColor(days: number | null): string {
  if (days === null) return '#9AA2AA';
  if (days <= SAFETY_DAYS_HOME) return '#B03F3B';
  if (days <= Math.round(SAFETY_DAYS_HOME * 1.5)) return '#E09B3D';
  return '#565D64';
}

function deliveryLabel(rocketStock: number, sales30d: number): { text: string; warn: boolean } {
  if (sales30d === 0) return { text: '판매 없음', warn: false };
  if (rocketStock > 0) return { text: '로켓 내일', warn: false };
  return { text: '판매자배송 4일', warn: true };
}

function changeDisplay(
  value: number | null,
  compValid: boolean,
  compPeriodLabel?: string,
  compInvalidReason?: string | null,
  caveat?: string | null,
): React.ReactNode {
  if (!compValid) {
    return (
      <span className="kpi-change unavailable" style={{ color: 'var(--text-muted)', cursor: compInvalidReason ? 'help' : undefined }} title={compInvalidReason || undefined}>비교 불가</span>
    );
  }
  if (value === null) {
    return <span className="kpi-change unavailable" style={{ color: 'var(--text-muted)' }}>비교 불가</span>;
  }
  const dir = value > 0 ? 'up' : value < 0 ? 'down' : 'neutral';
  const prefix = value > 0 ? '+' : '';
  return (
    <>
      <span className={`kpi-change ${dir}`}>
        {prefix}{value}% 전월 동기간
        {caveat && (
          <span style={{ color: '#9AA2AA', fontWeight: 400, fontSize: 11, marginLeft: 4 }}>
            (직전 기간 {caveat}, 참고용)
          </span>
        )}
      </span>
      {compPeriodLabel && (
        <div style={{ fontSize: 11, color: '#9AA2AA', marginTop: 2 }}>{compPeriodLabel} 대비</div>
      )}
    </>
  );
}

function exportCSV(productBreakdown: ProductBreakdownRow[], totalOrders: number) {
  const header = '제품,매출,주문,세트수,낱개수,비중';
  const rows = productBreakdown.map((p) =>
    `${p.product},${p.sales},${p.orders},${p.setsSold},${p.unitsSold},${(p.share * 100).toFixed(1)}%`,
  );
  const totalRow = `합계,${productBreakdown.reduce((s, r) => s + r.sales, 0)},${totalOrders},${productBreakdown.reduce((s, r) => s + r.setsSold, 0)},${productBreakdown.reduce((s, r) => s + r.unitsSold, 0)},100%`;
  const csv = [header, ...rows, totalRow].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'product-sales.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function HomeClient({ data }: { data: HomeData }) {
  const {
    yesterdaySales,
    yesterdayOrders,
    yesterday,
    totalSales,
    totalOrders,
    totalQuantity,
    totalSets,
    compValid,
    compPeriodLabel,
    compInvalidReason,
    compCaveat,
    salesChange,
    ordersChange,
    quantityChange,
    periodLabel,
    periodStart,
    periodEnd,
    numDays,
    orderNeededCount,
    dailySales,
    dailyProductBreakdown,
    productBreakdown,
    productOrderSum,
    optionBreakdownByProduct,
    todayChecks,
    homeOptionInventory,
    ezadminByProductHome,
    yesterdayByOption,
    ezadminRawTotal,
    ezadminMappedTotal,
    ezadminUnmappedTotal,
    ezadminSuppliesTotal,
    ezadminUpdatedAt,
    ezadminIntegrityOk,
    totalCouponDiscount,
    couponDataCount,
    dataCoverageDays,
    earliestDataDate,
    latestDataDate,
    activePromotions,
  } = data;

  const searchParams = useSearchParams();
  const productFilter = searchParams.get('product');

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>(numDays > 180 ? 'monthly' : numDays > 90 ? 'weekly' : 'daily');
  const [showNoSalesOptions, setShowNoSalesOptions] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartCSize, setChartCSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setChartCSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const chartViewH = chartCSize ? Math.round(VIEW_W * chartCSize.h / chartCSize.w) : 232;
  const chartH = chartViewH - PAD_T - PAD_B;

  // Auto-adjust chart mode when period changes
  useEffect(() => {
    const ideal: ChartMode = numDays > 180 ? 'monthly' : numDays > 90 ? 'weekly' : 'daily';
    setChartMode(ideal);
    setHoveredIdx(null);
    setSelectedDay(null);
  }, [numDays]);

  const handleChartMode = (mode: ChartMode) => {
    setChartMode(mode);
    setHoveredIdx(null);
    if (mode !== 'daily') setSelectedDay(null);
  };

  /* ================================================================== */
  /*  Daily chart computations                                          */
  /* ================================================================== */

  const n = dailySales.length;
  const maxSales = Math.max(...dailySales.map((d) => d.sales), 1);
  const yTicks = computeYTicks(maxSales);
  const yMax = yTicks[yTicks.length - 1] || maxSales;

  const xForIndex = (i: number) =>
    n > 1 ? PAD_L + (i / (n - 1)) * CHART_W : PAD_L + CHART_W / 2;

  const points = dailySales.map((d, i) => ({
    x: xForIndex(i),
    y: PAD_T + chartH - (d.sales / yMax) * chartH,
  }));

  const baseY = PAD_T + chartH;

  // Active products
  const activeProducts = new Set(productBreakdown.map(p => p.product));
  const isSingleProduct = activeProducts.size === 1;
  const singleProductName = isSingleProduct ? productBreakdown[0].product : null;

  // Per-day product data for overlaid area chart (no stacking)
  const dailyByProduct = dailySales.map((d, i) => {
    const breakdown = dailyProductBreakdown[d.date] || [];
    const byProduct: Record<string, number> = {};
    for (const p of breakdown) byProduct[p.product] = p.sales;
    return { date: d.date, byProduct, x: xForIndex(i) };
  });

  // Build per-product paths for overlaid area (each from baseline 0)
  const layerPaths = PRODUCT_ORDER_CHART.map((product) => {
    const topPoints = dailyByProduct.map((sd) => {
      const sales = sd.byProduct[product] || 0;
      return { x: sd.x, y: PAD_T + chartH - (sales / yMax) * chartH };
    });
    const topPath = monotonePath(topPoints);
    const areaPath = topPoints.length >= 2
      ? `${topPath} L${topPoints[topPoints.length - 1].x},${baseY} L${topPoints[0].x},${baseY} Z`
      : '';
    const color = PRODUCT_COLORS[product] || '#999';
    return { product, topPath, areaPath, color, topPoints };
  });

  // Single-product mode
  const singleColor = '#4A90D9';
  const linePath = monotonePath(points);
  const singleAreaPath =
    points.length >= 2
      ? `${linePath} L${points[points.length - 1].x},${baseY} L${points[0].x},${baseY} Z`
      : '';

  // Label skip interval for x-axis
  const labelSkip = Math.max(1, Math.ceil(n / 20));

  /* ================================================================== */
  /*  Weekly / Monthly data                                             */
  /* ================================================================== */

  const weekData = groupByWeek(dailySales, periodStart, periodEnd, dailyProductBreakdown);
  const monthData = groupByMonth(dailySales, dailyProductBreakdown);
  const weekMaxSales = weekData.length > 0 ? Math.max(...weekData.map((w) => w.sales)) : 0;
  const monthMaxSales = monthData.length > 0 ? Math.max(...monthData.map((m) => m.sales)) : 0;

  /* ================================================================== */
  /*  Day detail                                                        */
  /* ================================================================== */

  const selectedDetail = selectedDay
    ? dailySales.find((d) => d.date === selectedDay)
    : null;
  const selectedDayProducts = selectedDay
    ? dailyProductBreakdown[selectedDay] ?? []
    : [];

  /* ================================================================== */
  /*  Product breakdown totals                                          */
  /* ================================================================== */

  const breakdownTotalSales = productBreakdown.reduce((s, r) => s + r.sales, 0);

  /* ================================================================== */
  /*  Donut chart data                                                  */
  /* ================================================================== */

  const donutBreakdown = productBreakdown.filter(p => p.product !== '분류 필요');
  const donutTotalSales = breakdownTotalSales;
  // Home: product-only donut (no option breakdown — options shown on sales page)
  const donutProducts = donutBreakdown.map(p => ({
    product: p.product,
    sales: p.sales,
    orders: p.orders,
    options: [] as { option: string; sales: number; orders: number }[],
  }));

  /* ================================================================== */
  /*  KPI daily averages                                                */
  /* ================================================================== */

  const dailyAvgSales = numDays > 0 ? Math.round(totalSales / numDays) : 0;
  const dailyAvgOrders = numDays > 0 ? Math.round((totalOrders / numDays) * 10) / 10 : 0;
  const avgUnitsPerOrder = totalOrders > 0 ? Math.round((totalQuantity / totalOrders) * 10) / 10 : 0;

  /* ================================================================== */
  /*  Bar chart SVG renderer (weekly / monthly)                         */
  /* ================================================================== */

  function renderBarSVG(buckets: (WeekBucket | MonthBucket)[], isWeekly?: boolean): React.ReactNode {
    if (buckets.length === 0) {
      return (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24, fontSize: 13 }}>
          차트 데이터가 없습니다.
        </div>
      );
    }

    const maxVal = Math.max(...buckets.map((b) => b.sales), 1);
    const bYTicks = computeYTicks(maxVal);
    const bYMax = bYTicks[bYTicks.length - 1] || maxVal;
    const bc = buckets.length;
    const gap = Math.max(4, Math.min(12, CHART_W / bc / 4));
    const bW = Math.max(16, Math.min(56, (CHART_W - (bc - 1) * gap) / bc));
    const totalW = bc * bW + (bc - 1) * gap;
    const startX = PAD_L + (CHART_W - totalW) / 2;
    const barLabelSkip = Math.max(1, Math.ceil(bc / 15));

    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${VIEW_W} ${chartViewH}`} preserveAspectRatio="xMinYMin meet" style={{ display: 'block' }}>
        {/* Y gridlines + labels */}
        {bYTicks.map((tick) => {
          const y = PAD_T + chartH - (tick / bYMax) * chartH;
          return (
            <g key={tick}>
              <line
                x1={PAD_L}
                x2={VIEW_W - PAD_R}
                y1={y}
                y2={y}
                stroke="#EAEDF0"
                strokeWidth={1}
              />
              <text
                x={PAD_L - 8}
                y={y + 4}
                textAnchor="end"
                fontSize={11}
                fill="#6E767E"
                fontWeight={500}
              >
                {formatChartAxis(tick)}
              </text>
            </g>
          );
        })}

        {/* Stacked Bars */}
        {buckets.map((b, i) => {
          const x = startX + i * (bW + gap);
          const totalH = bYMax > 0 ? (b.sales / bYMax) * chartH : 0;
          const showLabel = i % barLabelSkip === 0 || i === bc - 1;
          const shortLabel = isWeekly ? b.label.split('~')[0] : b.label;

          // Stacked segments
          let segmentY = PAD_T + chartH;
          const segments: { product: string; y: number; h: number; isTop: boolean }[] = [];

          for (let pi = 0; pi < PRODUCT_ORDER_CHART.length; pi++) {
            const product = PRODUCT_ORDER_CHART[pi];
            const pSales = b.byProduct[product] || 0;
            if (pSales <= 0) continue;
            const segH = (pSales / bYMax) * chartH;
            segmentY -= segH;
            segments.push({ product, y: segmentY, h: segH, isTop: false });
          }

          // Mark top segment
          if (segments.length > 0) {
            let topIdx = 0;
            for (let si = 1; si < segments.length; si++) {
              if (segments[si].y < segments[topIdx].y) topIdx = si;
            }
            segments[topIdx].isTop = true;
          }

          const hasProductData = segments.length > 0;

          return (
            <g key={i}>
              <title>{`${b.label}: ${formatKRW(b.sales)}`}</title>
              {hasProductData ? (
                segments.map((seg, si) => {
                  const color = PRODUCT_COLORS[seg.product] || '#999';
                  if (seg.isTop) {
                    return (
                      <path
                        key={si}
                        d={roundedTopBar(x, seg.y, bW, Math.max(seg.h, 1), 4)}
                        fill={color}
                      />
                    );
                  }
                  return (
                    <rect
                      key={si}
                      x={x}
                      y={seg.y}
                      width={bW}
                      height={Math.max(seg.h, 1)}
                      fill={color}
                    />
                  );
                })
              ) : (
                <path
                  d={roundedTopBar(x, PAD_T + chartH - Math.max(totalH, 1), bW, Math.max(totalH, 1), 4)}
                  fill="#CFE3D8"
                />
              )}
              {showLabel && (
                <text
                  x={x + bW / 2}
                  y={PAD_T + chartH + 16}
                  textAnchor="middle"
                  fontSize={11}
                  fill="#9AA2AA"
                >
                  {shortLabel}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    );
  }

  /* ================================================================== */
  /*  Render                                                            */
  /* ================================================================== */

  return (
    <AppShell>
      {/* Consolidated info line */}
      <div style={{ fontSize: 11, color: '#9AA2AA', marginTop: -8, marginBottom: 12, paddingLeft: 4 }}>
        {earliestDataDate && latestDataDate && (
          <>데이터 {formatDateShort(earliestDataDate)}~{formatDateShort(latestDataDate)}</>
        )}
        {numDays > 3 && dataCoverageDays > 0 && dataCoverageDays < numDays && (
          <> · 매출 발생일 {dataCoverageDays}일</>
        )}
        {' · 정가 기준(쿠폰 미반영)'}
        {numDays > 3 && dataCoverageDays === 0 && (
          <span style={{ color: '#D9534F' }}> · 해당 기간 데이터 없음</span>
        )}
      </div>

      {/* Active promotion banner */}
      {activePromotions.length > 0 && (
        <div style={{
          background: '#FDF6EC',
          border: '1px solid #F5DEB3',
          borderRadius: 8,
          padding: '8px 14px',
          marginBottom: 12,
          fontSize: 12,
          color: '#8B6914',
          lineHeight: 1.5,
        }}>
          {activePromotions.map((p, i) => (
            <div key={i}>
              <strong>{p.name}</strong>
              {p.product ? ` · ${p.product}` : ' · 전체'}
              {` · 할인 ${p.discountRate}%`}
              {` (${p.startDate.slice(5).replace('-', '/')} ~ ${p.endDate.slice(5).replace('-', '/')})`}
            </div>
          ))}
        </div>
      )}

      {/* ============================================================ */}
      {/* Row 1: KPI Cards (5)                                          */}
      {/* ============================================================ */}
      <div className="kpi-row five">
        <div className="kpi-card">
          <div className="kpi-label" data-tooltip="쿠팡 결제 완료 기준. RG(로켓그로스) + 셀러 직접배송 합산">선택기간 매출</div>
          <div className="kpi-value" style={{ fontWeight: 650 }}>{formatKRW(totalSales)}</div>
          {numDays >= 7 && <div>{changeDisplay(salesChange, compValid, compPeriodLabel, compInvalidReason, compCaveat)}</div>}
          <div className="kpi-sub" style={{ color: 'var(--text-muted)' }}>일평균 {formatKRW(dailyAvgSales)}</div>
          {totalCouponDiscount > 0 && (
            <div style={{ fontSize: 11.5, color: '#9AA2AA', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
              쿠폰할인 -{formatNumber(totalCouponDiscount)}원 ({couponDataCount}건)
            </div>
          )}
        </div>

        <div className="kpi-card">
          <div className="kpi-label" data-tooltip="고유 주문번호 기준. 1건에 여러 상품 포함 가능">주문 건수</div>
          <div className="kpi-value" style={{ fontWeight: 650 }}>
            {formatNumber(totalOrders)}<span style={unitStyle}>건</span>
          </div>
          {numDays >= 7 && <div>{changeDisplay(ordersChange, compValid, compPeriodLabel, compInvalidReason, compCaveat)}</div>}
          <div className="kpi-sub" style={{ color: 'var(--text-muted)' }}>일평균 {dailyAvgOrders}건</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label" data-tooltip="세트 상품은 낱개로 환산 (예: 3개세트 1건 = 3개)">판매 낱개수</div>
          <div className="kpi-value" style={{ fontWeight: 650 }}>
            {formatNumber(totalQuantity)}<span style={unitStyle}>개</span>
          </div>
          {numDays >= 7 && <div>{changeDisplay(quantityChange, compValid, compPeriodLabel, compInvalidReason, compCaveat)}</div>}
          <div className="kpi-sub" style={{ color: 'var(--text-muted)' }}>주문당 {avgUnitsPerOrder}개</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label" data-tooltip="선택 기간과 무관. 어제 하루 결제 기준 매출">어제 매출</div>
          <div className="kpi-value" style={{ fontWeight: 650 }}>{formatKRW(yesterdaySales)}</div>
          <div className="kpi-sub" style={{ color: 'var(--text-muted)', fontSize: 12.5, marginTop: 4 }}>
            {yesterday} / {formatNumber(yesterdayOrders)}건
          </div>
        </div>

        <div className={`kpi-card${orderNeededCount > 0 ? ' alert-card' : ''}`}>
          <div className="kpi-label" data-tooltip="현재 재고로 14일 이내 소진 예상되는 SKU 수">발주 필요 SKU</div>
          <div className="kpi-value" style={{ fontWeight: 650 }}>
            {orderNeededCount}<span style={unitStyle}>개</span>
          </div>
          <div className="kpi-sub" style={{ color: 'var(--text-muted)' }}>리드타임 14일 기준</div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* Row 2: 매출 추이 (2/3) + 제품 비중 도넛 (1/3)                  */}
      {/* ============================================================ */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--card-gap)', height: 420, marginBottom: selectedDetail ? 0 : 'var(--card-gap)', alignItems: 'stretch' }}>
        {/* LEFT: 매출 추이 */}
        <div className="section" style={{ display: 'flex', flexDirection: 'column', marginBottom: 0, overflow: 'hidden' }}>
          <div className="section-header" style={{ flexShrink: 0 }}>
            <span className="section-title">매출 추이</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {chartMode === 'daily' && (
                <span className="section-hint">클릭하면 해당 날짜 상세가 열립니다</span>
              )}
              <div className="filter-segment">
                <button
                  className={`seg-btn${chartMode === 'daily' ? ' active' : ''}`}
                  onClick={() => handleChartMode('daily')}
                >
                  일별
                </button>
                <button
                  className={`seg-btn${chartMode === 'weekly' ? ' active' : ''}`}
                  onClick={() => handleChartMode('weekly')}
                >
                  주별
                </button>
                <button
                  className={`seg-btn${chartMode === 'monthly' ? ' active' : ''}`}
                  onClick={() => handleChartMode('monthly')}
                  disabled={monthData.length < 2}
                >
                  월별
                </button>
              </div>
            </div>
          </div>

          {/* -- Chart area ------------------------------------------------- */}
          <div ref={chartContainerRef} style={{ height: 340, position: 'relative' }}>
           <div style={{ position: 'absolute', inset: 0 }}>
            {/* ---- Daily: overlaid area chart ---- */}
            {chartMode === 'daily' && (
              <>
                {dailySales.length > 0 ? (
                  <svg
                    width="100%"
                    height="100%"
                    viewBox={`0 0 ${VIEW_W} ${chartViewH}`}
                    preserveAspectRatio="xMinYMin meet"
                    style={{ cursor: 'pointer', display: 'block' }}
                    onMouseLeave={() => setHoveredIdx(null)}
                  >
                    <defs>
                      <filter id="tooltipShadow" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="rgba(0,0,0,0.08)" />
                      </filter>
                      <clipPath id="chartClip">
                        <rect x={PAD_L} y={PAD_T} width={CHART_W} height={chartH} />
                      </clipPath>
                    </defs>

                    {/* Y-axis gridlines + labels */}
                    {yTicks.map((tick) => {
                      const y = PAD_T + chartH - (tick / yMax) * chartH;
                      return (
                        <g key={tick}>
                          <line
                            x1={PAD_L}
                            x2={VIEW_W - PAD_R}
                            y1={y}
                            y2={y}
                            stroke="#EAEDF0"
                            strokeWidth={1}
                          />
                          <text
                            x={PAD_L - 8}
                            y={y + 4}
                            textAnchor="end"
                            fontSize={11}
                            fill="#6E767E"
                            fontWeight={500}
                          >
                            {formatChartAxis(tick)}
                          </text>
                        </g>
                      );
                    })}

                    {/* Overlaid area layers or single area — clipped to chart bounds */}
                    <g clipPath="url(#chartClip)">
                    {isSingleProduct ? (
                      <>
                        {singleAreaPath && (
                          <path d={singleAreaPath} fill={hexToRGBA(singleColor, 0.35)} />
                        )}
                        {linePath && (
                          <path
                            d={linePath}
                            fill="none"
                            stroke={singleColor}
                            strokeWidth={1.5}
                          />
                        )}
                      </>
                    ) : (
                      <>
                        {layerPaths.map((lp) => (
                          <g key={lp.product}>
                            {lp.areaPath && (
                              <path d={lp.areaPath} fill={hexToRGBA(lp.color, 0.35)} />
                            )}
                            {lp.topPath && lp.topPoints.length >= 2 && (
                              <path
                                d={lp.topPath}
                                fill="none"
                                stroke={lp.color}
                                strokeWidth={1.5}
                              />
                            )}
                          </g>
                        ))}
                      </>
                    )}
                    </g>

                    {/* Single-point dot */}
                    {n === 1 && (
                      <circle
                        cx={points[0].x}
                        cy={points[0].y}
                        r={5}
                        fill={singleColor}
                        stroke="white"
                        strokeWidth={2}
                      />
                    )}

                    {/* X-axis date labels */}
                    {dailySales.map((d, i) => {
                      const showLabel = i % labelSkip === 0 || i === n - 1;
                      if (!showLabel) return null;
                      const day = parseInt(d.date.slice(8, 10));
                      const isHovered = i === hoveredIdx;
                      return (
                        <text
                          key={d.date}
                          x={points[i].x}
                          y={PAD_T + chartH + 16}
                          textAnchor="middle"
                          fontSize={11}
                          fill={isHovered ? 'var(--text-primary)' : '#9AA2AA'}
                          fontWeight={isHovered ? 600 : 400}
                        >
                          {day}
                        </text>
                      );
                    })}

                    {/* Hover vertical guide line */}
                    {hoveredIdx !== null && points[hoveredIdx] && (
                      <line
                        x1={points[hoveredIdx].x}
                        y1={PAD_T}
                        x2={points[hoveredIdx].x}
                        y2={PAD_T + chartH}
                        stroke="var(--border)"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                      />
                    )}

                    {/* Hover dots - per-product for multi, single for single */}
                    {hoveredIdx !== null && points[hoveredIdx] && isSingleProduct && (
                      <circle
                        cx={points[hoveredIdx].x}
                        cy={points[hoveredIdx].y}
                        r={4.5}
                        fill={singleColor}
                        stroke="white"
                        strokeWidth={2}
                      />
                    )}
                    {hoveredIdx !== null && points[hoveredIdx] && !isSingleProduct &&
                      PRODUCT_ORDER_CHART.map(product => {
                        const bk = dailyProductBreakdown[dailySales[hoveredIdx].date] || [];
                        const row = bk.find(b => b.product === product);
                        if (!row || row.sales <= 0) return null;
                        const dotY = PAD_T + chartH - (row.sales / yMax) * chartH;
                        return (
                          <circle
                            key={product}
                            cx={points[hoveredIdx].x}
                            cy={dotY}
                            r={4}
                            fill={PRODUCT_COLORS[product] || '#999'}
                            stroke="white"
                            strokeWidth={2}
                          />
                        );
                      })
                    }

                    {/* Invisible hit areas for hover + click */}
                    {points.map((pt, i) => {
                      const hitW = n > 1 ? CHART_W / (n - 1) : CHART_W;
                      return (
                        <rect
                          key={i}
                          x={pt.x - hitW / 2}
                          y={0}
                          width={hitW}
                          height={chartViewH}
                          fill="transparent"
                          onMouseEnter={() => setHoveredIdx(i)}
                          onClick={() => {
                            const date = dailySales[i].date;
                            setSelectedDay(selectedDay === date ? null : date);
                          }}
                          style={{ cursor: 'pointer' }}
                        />
                      );
                    })}

                    {/* Tooltip */}
                    {hoveredIdx !== null && points[hoveredIdx] && (() => {
                      const d = dailySales[hoveredIdx];
                      const px = points[hoveredIdx].x;

                      if (isSingleProduct) {
                        const tooltipW = 150;
                        const tooltipH = 68;
                        let tx = px - tooltipW / 2;
                        if (tx < PAD_L) tx = PAD_L;
                        if (tx + tooltipW > VIEW_W - PAD_R) tx = VIEW_W - PAD_R - tooltipW;
                        const py = points[hoveredIdx].y;
                        let ty = py - tooltipH - 16;
                        if (ty < 0) ty = py + 16;
                        return (
                          <g>
                            <rect x={tx} y={ty} width={tooltipW} height={tooltipH} rx={8}
                                  fill="white" stroke="#E5E8EB" strokeWidth={1} filter="url(#tooltipShadow)" />
                            <text x={tx + 12} y={ty + 18} fontSize={11} fill="#9AA2AA">
                              {d.date.slice(5).replace('-', '/')}
                            </text>
                            <text x={tx + 12} y={ty + 36} fontSize={13} fill="#1F2328" fontWeight={650}>
                              {formatKRW(d.sales)}
                            </text>
                            <text x={tx + 12} y={ty + 54} fontSize={11} fill="#9AA2AA">
                              {`${d.orders}건 / ${d.quantity}개`}
                            </text>
                          </g>
                        );
                      }

                      // Multi-product tooltip
                      const breakdown = dailyProductBreakdown[d.date] || [];
                      const hovProducts = PRODUCT_ORDER_CHART.filter(p =>
                        breakdown.some(b => b.product === p && b.sales > 0)
                      );
                      const tooltipW = 170;
                      const tooltipH = 64 + hovProducts.length * 17;
                      let tx = px - tooltipW / 2;
                      if (tx < PAD_L) tx = PAD_L;
                      if (tx + tooltipW > VIEW_W - PAD_R) tx = VIEW_W - PAD_R - tooltipW;

                      let highestY = baseY;
                      for (const p of hovProducts) {
                        const row = breakdown.find(b => b.product === p);
                        if (row) {
                          const y = PAD_T + chartH - (row.sales / yMax) * chartH;
                          if (y < highestY) highestY = y;
                        }
                      }
                      let ty = highestY - tooltipH - 12;
                      if (ty < 0) ty = highestY + 12;

                      return (
                        <g>
                          <rect x={tx} y={ty} width={tooltipW} height={tooltipH} rx={8}
                                fill="white" stroke="#E5E8EB" strokeWidth={1} filter="url(#tooltipShadow)" />
                          <text x={tx + 12} y={ty + 16} fontSize={11} fill="#9AA2AA">
                            {d.date.slice(5).replace('-', '/')}
                          </text>
                          {hovProducts.map((product, i) => {
                            const row = breakdown.find(b => b.product === product);
                            const sales = row ? row.sales : 0;
                            const color = PRODUCT_COLORS[product] || '#999';
                            return (
                              <g key={product}>
                                <circle cx={tx + 14} cy={ty + 30 + i * 17} r={4} fill={color} />
                                <text x={tx + 24} y={ty + 34 + i * 17} fontSize={12} fill="#1F2328">
                                  {product}
                                </text>
                                <text x={tx + tooltipW - 12} y={ty + 34 + i * 17} textAnchor="end" fontSize={12} fill="#1F2328" fontWeight={500}>
                                  {formatKRW(sales)}
                                </text>
                              </g>
                            );
                          })}
                          <line
                            x1={tx + 12} x2={tx + tooltipW - 12}
                            y1={ty + 34 + hovProducts.length * 17 + 4}
                            y2={ty + 34 + hovProducts.length * 17 + 4}
                            stroke="#E8EBEF" strokeWidth={1}
                          />
                          <text x={tx + 12} y={ty + 34 + hovProducts.length * 17 + 20} fontSize={12} fill="#1F2328" fontWeight={650}>
                            {`합계 ${formatKRW(d.sales)} · ${d.orders}건`}
                          </text>
                        </g>
                      );
                    })()}
                  </svg>
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24, fontSize: 13 }}>
                    차트 데이터가 없습니다.
                  </div>
                )}
              </>
            )}

            {/* ---- Weekly: stacked bar chart ---- */}
            {chartMode === 'weekly' && renderBarSVG(weekData, true)}

            {/* ---- Monthly: stacked bar chart ---- */}
            {chartMode === 'monthly' && renderBarSVG(monthData, false)}
           </div>
          </div>

          {/* -- Chart legend ---------------------------------------------- */}
          {chartMode === 'daily' && dailySales.length > 0 && (
            <div
              className="chart-legend"
              style={{ flexShrink: 0, display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'flex-start', flexWrap: 'wrap', padding: '12px 16px 16px 56px', fontSize: 12, color: '#565D64', fontWeight: 450 }}
            >
              {isSingleProduct ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      background: singleColor,
                      borderRadius: '50%',
                    }}
                  />
                  {singleProductName}
                </span>
              ) : (
                PRODUCT_ORDER_CHART.filter(p => activeProducts.has(p)).map(product => (
                  <span key={product} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        background: PRODUCT_COLORS[product] || '#999',
                        borderRadius: '50%',
                      }}
                    />
                    {product}
                  </span>
                ))
              )}
              <span>일평균 {formatKRW(dailyAvgSales)}</span>
            </div>
          )}
          {(chartMode === 'weekly' || chartMode === 'monthly') && (weekData.length > 0 || monthData.length > 0) && (
            <div
              className="chart-legend"
              style={{ flexShrink: 0, display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'flex-start', flexWrap: 'wrap', padding: '12px 16px 16px 56px', fontSize: 12, color: '#565D64', fontWeight: 450 }}
            >
              {PRODUCT_ORDER_CHART.filter(p => activeProducts.has(p)).map(product => (
                <span key={product} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      background: PRODUCT_COLORS[product] || '#999',
                      borderRadius: '50%',
                    }}
                  />
                  {product}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT: 제품 비중 도넛 */}
        <div className="section" style={{ display: 'flex', flexDirection: 'column', marginBottom: 0, overflow: 'hidden' }}>
          <div className="section-header">
            <span className="section-title">제품 비중</span>
          </div>
          <div style={{ flex: 1, padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <DualDonutChart
              products={donutProducts}
              totalSales={donutTotalSales}
              productFilter={productFilter}
            />
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* Day detail card (below chart row)                             */}
      {/* ============================================================ */}
      {selectedDetail && (
        <div className="section" style={{ marginTop: 'var(--card-gap)', marginBottom: 'var(--card-gap)' }}>
          <div className="section-header">
            <span className="section-title" style={{ ...tabNums }}>
              {formatDateShort(selectedDetail.date)} &middot; {formatKRW(selectedDetail.sales)}
            </span>
            <button
              className="btn-ghost"
              onClick={() => setSelectedDay(null)}
            >
              닫기
            </button>
          </div>
          <div className="section-body">
            <table className="data-table">
              <thead>
                <tr>
                  <th>제품</th>
                  <th className="right">매출</th>
                  <th className="right">낱개수</th>
                </tr>
              </thead>
              <tbody>
                {selectedDayProducts.map((p) => (
                  <tr key={p.product}>
                    <td><span className="product-name">{p.product}</span></td>
                    <td className="right" style={tabNums}>{formatKRW(p.sales)}</td>
                    <td className="right" style={tabNums}>{formatNumber(p.units)}개</td>
                  </tr>
                ))}
                {selectedDayProducts.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                      해당 날짜에 매출 데이터가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* Row 3: 제품별 매출 (left) + 재고 현황 (right)                  */}
      {/* ============================================================ */}
      <div className="section-grid-2" style={{ height: 340, alignItems: 'stretch' }}>
        {/* LEFT: 제품별 매출 */}
        <div className="section" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="section-header">
            <span className="section-title">제품별 매출</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                className="btn-ghost"
                onClick={() => exportCSV(productBreakdown, totalOrders)}
              >
                CSV 내보내기
              </button>
              <Link href="/commerce/sales" className="btn-ghost" style={{ textDecoration: 'none' }}>
                매출 상세
              </Link>
            </div>
          </div>
          <div className="section-body card-scroll" style={{ overflowY: 'auto', flex: 1 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>제품</th>
                  <th className="right">매출</th>
                  <th className="right">주문</th>
                  <th className="right">비중</th>
                </tr>
              </thead>
              <tbody>
                {productBreakdown.map((p) => (
                  <tr key={p.product}>
                    <td><span className="product-name">{p.product}</span></td>
                    <td className="right" style={tabNums}>{formatKRW(p.sales)}</td>
                    <td className="right" style={tabNums}>{formatNumber(p.orders)}</td>
                    <td className="right" style={tabNums}>{(p.share * 100).toFixed(1)}%</td>
                  </tr>
                ))}
                {productBreakdown.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                      매출 데이터가 없습니다.
                    </td>
                  </tr>
                )}
                {productBreakdown.length > 0 && (
                  <tr className="total-row">
                    <td style={{ fontWeight: 600, color: '#1F2328' }}>합계</td>
                    <td className="right" style={{ ...tabNums, fontWeight: 600, color: '#1F2328' }}>{formatKRW(breakdownTotalSales)}</td>
                    <td className="right" style={{ ...tabNums, fontWeight: 600, color: '#1F2328' }}>{formatNumber(totalOrders)}</td>
                    <td className="right" style={{ ...tabNums, fontWeight: 600, color: '#1F2328' }}>100%</td>
                  </tr>
                )}
              </tbody>
            </table>
            {productBreakdown.length > 0 && productOrderSum !== totalOrders && (
              <div className="table-footnote">
                합계 주문 건수는 order_id 기준 중복 제거값이라 제품별 합(
                {formatNumber(productOrderSum)}건)과 다를 수 있습니다
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: 재고 현황 (option-level table) */}
        <div className="section" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="section-header">
            <span className="section-title">재고 현황</span>
            <Link href="/commerce/inventory" className="btn-ghost" style={{ textDecoration: 'none' }}>
              재고 상세
            </Link>
          </div>
          <div className="section-body card-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {(() => {
              const noSalesCount = homeOptionInventory.filter(i => i.status === 'no_sales').length;
              const visibleItems = showNoSalesOptions ? homeOptionInventory : homeOptionInventory.filter(i => i.status !== 'no_sales');
              return (
                <>
                <table className="data-table" style={{ fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th>제품 · 옵션</th>
                      <th className="right">로켓</th>
                      <th className="right">3PL</th>
                      <th className="right">여유</th>
                      <th className="right">출고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((item, i) => {
                      const pl3 = item.unitCount === 1 ? (ezadminByProductHome[item.product]?.domestic ?? 0) : null;
                      const dl = deliveryLabel(item.rocketStock, item.sales30d);
                      return (
                        <tr key={i}>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <span style={{ fontWeight: 500 }}>{item.product}</span>
                            <span style={{ color: '#6E767E', marginLeft: 4 }}>{item.option}</span>
                          </td>
                          <td className="right" style={{ ...tabNums, color: item.rocketStock === 0 && item.sales30d > 0 ? '#B03F3B' : '#1F2328' }}>
                            {item.rocketStock}
                          </td>
                          <td className="right" style={{ ...tabNums, color: '#6E767E' }}>
                            {pl3 !== null ? formatNumber(pl3) : '—'}
                          </td>
                          <td className="right" style={{ ...tabNums, fontWeight: 600, color: daysColor(item.daysLeft) }}>
                            {item.daysLeft !== null ? `${item.daysLeft}일` : '—'}
                          </td>
                          <td className="right" style={{ fontSize: 12, color: dl.warn ? '#B03F3B' : '#6E767E', whiteSpace: 'nowrap' }}>
                            {dl.text}{dl.warn ? ' ⚠' : ''}
                          </td>
                        </tr>
                      );
                    })}
                    {homeOptionInventory.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                          재고 데이터가 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {noSalesCount > 0 && !showNoSalesOptions && (
                  <button
                    onClick={() => setShowNoSalesOptions(true)}
                    style={{
                      display: 'block', width: '100%', padding: '6px 16px', fontSize: 12, color: '#9AA2AA',
                      background: 'none', border: 'none', borderTop: '1px solid #E8EBEF', cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    판매 없는 옵션 {noSalesCount}건
                  </button>
                )}
                {noSalesCount > 0 && showNoSalesOptions && (
                  <button
                    onClick={() => setShowNoSalesOptions(false)}
                    style={{
                      display: 'block', width: '100%', padding: '6px 16px', fontSize: 12, color: '#9AA2AA',
                      background: 'none', border: 'none', borderTop: '1px solid #E8EBEF', cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    판매 없는 옵션 숨기기
                  </button>
                )}
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* Row 4: 어제 판매 (left) + 오늘 확인할 것 (right)              */}
      {/* ============================================================ */}
      <div className="section-grid-2" style={{ height: 300, marginTop: 'var(--card-gap)', alignItems: 'stretch' }}>
        {/* LEFT: 어제 판매 */}
        <div className="section" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="section-header">
            <span className="section-title">어제 판매</span>
            <span className="section-hint">{yesterday}</span>
          </div>
          <div className="section-body card-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {(() => {
              const withSales = yesterdayByOption.filter(i => i.quantity > 0);
              const noSales = yesterdayByOption.filter(i => i.quantity === 0);
              return (
                <table className="data-table" style={{ fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th>제품 · 옵션</th>
                      <th className="right">수량</th>
                      <th className="right">매출</th>
                    </tr>
                  </thead>
                  <tbody>
                    {withSales.map((item, i) => (
                      <tr key={i}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: 500 }}>{item.product}</span>
                          <span style={{ color: '#6E767E', marginLeft: 4 }}>{item.option}</span>
                        </td>
                        <td className="right" style={{ ...tabNums, color: '#1F2328' }}>
                          {item.quantity}
                        </td>
                        <td className="right" style={{ ...tabNums, color: '#1F2328' }}>
                          {formatKRW(item.sales)}
                        </td>
                      </tr>
                    ))}
                    {withSales.length > 0 && (
                      <tr className="total-row">
                        <td style={{ fontWeight: 600, color: '#1F2328' }}>합계</td>
                        <td className="right" style={{ ...tabNums, fontWeight: 600, color: '#1F2328' }}>
                          {withSales.reduce((s, i) => s + i.quantity, 0)}
                        </td>
                        <td className="right" style={{ ...tabNums, fontWeight: 600, color: '#1F2328' }}>
                          {formatKRW(withSales.reduce((s, i) => s + i.sales, 0))}
                        </td>
                      </tr>
                    )}
                    {noSales.length > 0 && (
                      <tr>
                        <td colSpan={3} style={{ padding: '4px 16px', fontSize: 11, color: '#9AA2AA', background: '#FAFBFC' }}>
                          판매 없음 ({noSales.length}건)
                        </td>
                      </tr>
                    )}
                    {noSales.map((item, i) => (
                      <tr key={`ns-${i}`} style={{ opacity: 0.5 }}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: 500 }}>{item.product}</span>
                          <span style={{ color: '#6E767E', marginLeft: 4 }}>{item.option}</span>
                        </td>
                        <td className="right" style={{ ...tabNums, color: '#9AA2AA' }}>—</td>
                        <td className="right" style={{ ...tabNums, color: '#9AA2AA' }}>—</td>
                      </tr>
                    ))}
                    {yesterdayByOption.length === 0 && (
                      <tr>
                        <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                          어제 매출 데이터가 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              );
            })()}
          </div>
        </div>

        {/* RIGHT: 오늘 확인할 것 (title-only, description as tooltip) */}
        <div className="section" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="section-header">
            <span className="section-title">오늘 확인할 것</span>
            {todayChecks.length > 6 && (
              <span className="section-hint">외 {todayChecks.length - 6}건</span>
            )}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
            {todayChecks.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>
                특이사항 없음
              </div>
            ) : todayChecks.slice(0, 6).map((check, i) => {
              const isInv = check.title.includes('품절') || check.title.includes('발주') || check.title.includes('이관');
              const href = isInv ? '/commerce/inventory' : undefined;
              return (
                <div
                  key={i}
                  title={check.description}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
                    cursor: href ? 'pointer' : 'default',
                  }}
                  onClick={href ? () => window.location.href = href : undefined}
                >
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: check.dot === 'red' ? '#D9534F' : check.dot === 'amber' ? '#E09B3D' : check.dot === 'blue' ? '#4A90D9' : '#C4CAD1',
                  }} />
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#1F2328' }}>{check.title}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
