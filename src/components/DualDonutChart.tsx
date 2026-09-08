'use client';

import { useState } from 'react';
import { formatKRW, formatCompact } from '@/lib/helpers';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface OptionData {
  option: string;
  sales: number;
  orders: number;
}

export interface DonutProductData {
  product: string;
  sales: number;
  orders: number;
  options: OptionData[];
}

interface DualDonutChartProps {
  products: DonutProductData[];
  totalSales: number;
  productFilter?: string | null;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PRODUCT_COLORS: Record<string, string> = {
  '\uD074\uB80C\uC9D5\uBC24': '#9DC3E6',
  '\uD074\uB80C\uC9D5\uD3FC': '#7FCDBB',
  '\uC138\uB7FC': '#F2A0A0',
};

const PRODUCT_ORDER = ['\uD074\uB80C\uC9D5\uBC24', '\uD074\uB80C\uC9D5\uD3FC', '\uC138\uB7FC'];

/** Fixed option display order within each product */
const OPTION_ORDER = ['\uB2E8\uD488', '2\uAC1C \uC138\uD2B8', '3\uAC1C \uC138\uD2B8', '4\uAC1C \uC138\uD2B8'];

function sortOptionsByOrder<T extends { option: string }>(opts: T[]): T[] {
  return [...opts].sort((a, b) => {
    const ai = OPTION_ORDER.indexOf(a.option);
    const bi = OPTION_ORDER.indexOf(b.option);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

const CX = 110;
const CY = 110;
const RING_R2 = 100; // outer radius
const RING_R1 = 60;  // inner radius (40px ring thickness)

const nums: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };

/* ------------------------------------------------------------------ */
/*  Color helpers                                                      */
/* ------------------------------------------------------------------ */

function mixWithWhite(hex: string, ratio: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const nr = Math.round(r + (255 - r) * ratio);
  const ng = Math.round(g + (255 - g) * ratio);
  const nb = Math.round(b + (255 - b) * ratio);
  const toHex = (c: number) => c.toString(16).padStart(2, '0');
  return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
}

const WHITE_RATIOS = [0, 0.25, 0.45, 0.60, 0.72, 0.80];

function generateOptionColors(baseHex: string, count: number): string[] {
  if (count <= 0) return [];
  if (count === 1) return [baseHex];
  return Array.from({ length: count }, (_, i) => {
    const ratio = i < WHITE_RATIOS.length
      ? WHITE_RATIOS[i]
      : Math.min(0.80 + (i - WHITE_RATIOS.length + 1) * 0.05, 0.92);
    return mixWithWhite(baseHex, ratio);
  });
}

function getTextColor(bgHex: string): string {
  const r = parseInt(bgHex.slice(1, 3), 16) / 255;
  const g = parseInt(bgHex.slice(3, 5), 16) / 255;
  const b = parseInt(bgHex.slice(5, 7), 16) / 255;
  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const lum = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return lum > 0.38 ? '#1A1D21' : '#FFFFFF';
}

/* ------------------------------------------------------------------ */
/*  SVG geometry helpers                                               */
/* ------------------------------------------------------------------ */

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arcPath(
  cx: number, cy: number,
  r1: number, r2: number,
  startDeg: number, endDeg: number,
): string {
  let sweep = endDeg - startDeg;
  if (sweep <= 0.05) return '';

  if (sweep >= 359.9) {
    sweep = 359.9;
    const half = startDeg + sweep / 2;
    return (
      arcPath(cx, cy, r1, r2, startDeg, half) +
      ' ' +
      arcPath(cx, cy, r1, r2, half, startDeg + sweep)
    );
  }

  const [x1o, y1o] = polar(cx, cy, r2, startDeg);
  const [x2o, y2o] = polar(cx, cy, r2, endDeg);
  const [x2i, y2i] = polar(cx, cy, r1, endDeg);
  const [x1i, y1i] = polar(cx, cy, r1, startDeg);
  const lg = sweep > 180 ? 1 : 0;
  return `M${x1o},${y1o} A${r2},${r2} 0 ${lg} 1 ${x2o},${y2o} L${x2i},${y2i} A${r1},${r1} 0 ${lg} 0 ${x1i},${y1i} Z`;
}

/** Gap angle in degrees for ~2px visual gap at given mid-radius. */
function gapDeg(r: number): number {
  return (2 / (2 * Math.PI * r)) * 360;
}

/* ------------------------------------------------------------------ */
/*  Rounding helper: ensure percentages sum to 100.0%                  */
/* ------------------------------------------------------------------ */

function fixedPcts(values: number[], total: number): number[] {
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 100);
  const rounded = raw.map((p) => Math.round(p * 10) / 10);
  const diff = Math.round(
    (1000 - rounded.reduce((s, v) => s + Math.round(v * 10), 0)) / 1,
  );
  if (diff !== 0) {
    const maxIdx = raw.indexOf(Math.max(...raw));
    rounded[maxIdx] = Math.round((rounded[maxIdx] * 10 + diff)) / 10;
  }
  return rounded;
}

/* ------------------------------------------------------------------ */
/*  Slice & group types                                                */
/* ------------------------------------------------------------------ */

interface SliceData {
  product: string;
  option: string;
  sales: number;
  orders: number;
  pct: number;
  start: number;
  end: number;
  color: string;
}

interface ProductGroupInfo {
  product: string;
  sales: number;
  orders: number;
  pct: number;
  color: string;
  arcStart: number;
  arcEnd: number;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DualDonutChart({
  products,
  totalSales,
  productFilter,
}: DualDonutChartProps) {
  const [hovProd, setHovProd] = useState<string | null>(null);
  const [hovOpt, setHovOpt] = useState<string | null>(null);

  /* ---- Build ordered product list -------------------------------- */
  const ordered: DonutProductData[] = [];
  for (const name of PRODUCT_ORDER) {
    const p = products.find((pr) => pr.product === name);
    if (p && p.sales > 0) ordered.push(p);
  }
  for (const p of products) {
    if (p.sales > 0 && !PRODUCT_ORDER.includes(p.product) && p.product !== '\uBD84\uB958 \uD544\uC694') {
      ordered.push(p);
    }
  }

  const orderedSum = ordered.reduce((s, p) => s + p.sales, 0);
  const activeTotalSales = totalSales > 0 ? totalSales : orderedSum;
  if (ordered.length === 0 || orderedSum <= 0) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24, fontSize: 13 }}>
        매출 데이터가 없습니다.
      </div>
    );
  }

  /* ---- Determine mode -------------------------------------------- */
  const isFiltered = !!productFilter && productFilter !== 'all';
  const filteredProduct = isFiltered
    ? ordered.find((p) => p.product === productFilter)
    : null;

  /* ---- Hover helpers --------------------------------------------- */
  const opacity = (product: string, option?: string): number => {
    if (!hovProd && !hovOpt) return 1;
    if (hovOpt) {
      if (product === hovProd && option === hovOpt) return 1;
      return 0.35;
    }
    if (hovProd) {
      if (product === hovProd) return 1;
      return 0.35;
    }
    return 1;
  };

  const clearHover = () => {
    setHovProd(null);
    setHovOpt(null);
  };

  /* ================================================================ */
  /*  FILTERED MODE (single product selected)                          */
  /* ================================================================ */
  if (filteredProduct) {
    const options = filteredProduct.options
      .filter((o) => o.sales > 0)
      .sort((a, b) => {
        const ai = OPTION_ORDER.indexOf(a.option);
        const bi = OPTION_ORDER.indexOf(b.option);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
    if (options.length === 0) {
      return (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24, fontSize: 13 }}>
          매출 데이터가 없습니다.
        </div>
      );
    }

    const pTotal = options.reduce((s, o) => s + o.sales, 0);
    const pcts = fixedPcts(options.map((o) => o.sales), pTotal);
    const baseColor = PRODUCT_COLORS[filteredProduct.product] || '#9CA5B0';
    const shades = generateOptionColors(baseColor, options.length);
    const gap = options.length > 1 ? gapDeg((RING_R1 + RING_R2) / 2) : 0;

    let cursor = 0;
    const arcs = options.map((o, i) => {
      const angle = (o.sales / pTotal) * 360;
      const start = cursor + gap / 2;
      const end = cursor + angle - gap / 2;
      cursor += angle;
      return { ...o, pct: pcts[i], start, end, color: shades[i] };
    });

    return (
      <div>
        <div style={{ width: 220, height: 220, margin: '0 auto', padding: '10px 0' }}>
          <svg viewBox="0 0 220 220" width={220} height={220} style={{ overflow: 'visible' }}>
            {arcs.map((a, i) => (
              <path
                key={i}
                d={arcPath(CX, CY, RING_R1, RING_R2, a.start, a.end)}
                fill={a.color}
                opacity={opacity(filteredProduct.product, a.option)}
                style={{ transition: 'opacity 0.15s', cursor: 'pointer' }}
                onMouseEnter={() => { setHovOpt(a.option); setHovProd(filteredProduct.product); }}
                onMouseLeave={clearHover}
              >
                <title>{`${filteredProduct.product} ${a.option} / ${formatKRW(a.sales)} / ${a.pct.toFixed(1)}%`}</title>
              </path>
            ))}
            {arcs.filter((a) => {
              const arcAngle = a.end - a.start;
              if (arcAngle < 30) return false;
              const labelText = `${a.pct.toFixed(1)}%`;
              const estimatedTextWidth = labelText.length * 6.5;
              if (estimatedTextWidth > RING_R2 - RING_R1) return false;
              return true;
            }).map((a, i) => {
              const mid = (a.start + a.end) / 2;
              const [lx, ly] = polar(CX, CY, (RING_R1 + RING_R2) / 2, mid);
              return (
                <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="central"
                  fontSize={11} fontWeight={600} fill="#FFFFFF"
                  opacity={opacity(filteredProduct.product, a.option)}
                  style={{ pointerEvents: 'none', transition: 'opacity 0.15s' }}
                >
                  {a.pct.toFixed(1)}%
                </text>
              );
            })}
            <text x={CX} y={CY - 6} textAnchor="middle" fontSize={18} fontWeight={700} fill="#1A1D21" style={nums}>
              {formatCompact(pTotal)}
            </text>
            <text x={CX} y={CY + 12} textAnchor="middle" fontSize={10} fontWeight={400} fill="#9AA2AA">
              {'\uCD1D\uB9E4\uCD9C'}
            </text>
          </svg>
        </div>

        <div style={{ marginTop: 20 }}>
          <LegendProductRow
            product={filteredProduct.product}
            color={baseColor}
            sales={pTotal}
            pct={100}
            opacity={1}
            onEnter={() => { setHovProd(filteredProduct.product); setHovOpt(null); }}
            onLeave={clearHover}
          />
          {options.length > 1 && arcs.map((a) => (
            <LegendOptionRow
              key={a.option}
              option={a.option}
              sales={a.sales}
              pct={a.pct}
              opacity={opacity(filteredProduct.product, a.option)}
              onEnter={() => { setHovOpt(a.option); setHovProd(filteredProduct.product); }}
              onLeave={clearHover}
            />
          ))}
        </div>
      </div>
    );
  }

  /* ================================================================ */
  /*  ALL PRODUCTS — SINGLE RING (options as individual slices)         */
  /* ================================================================ */

  const productPcts = fixedPcts(ordered.map((p) => p.sales), activeTotalSales);
  const gap = gapDeg((RING_R1 + RING_R2) / 2);

  /* Build flat option list: grouped by product, sorted by sales desc within each */
  const flatOptions: { product: string; option: string; sales: number; orders: number; color: string }[] = [];

  ordered.forEach((p) => {
    const activeOpts = sortOptionsByOrder(p.options.filter((o) => o.sales > 0));
    const baseColor = PRODUCT_COLORS[p.product] || '#9CA5B0';

    if (activeOpts.length === 0) {
      flatOptions.push({
        product: p.product,
        option: p.product,
        sales: p.sales,
        orders: p.orders,
        color: baseColor,
      });
    } else {
      const shades = generateOptionColors(baseColor, activeOpts.length);
      activeOpts.forEach((o, i) => {
        flatOptions.push({
          product: p.product,
          option: o.option,
          sales: o.sales,
          orders: o.orders,
          color: shades[i],
        });
      });
    }
  });

  /* Total-basis percentages for every option slice */
  const optionPcts = fixedPcts(flatOptions.map((o) => o.sales), activeTotalSales);

  /* Build slice arcs */
  const slices: SliceData[] = [];
  let cursor = 0;

  flatOptions.forEach((o, i) => {
    const angle = (o.sales / orderedSum) * 360;
    const start = cursor + gap / 2;
    const end = cursor + angle - gap / 2;
    slices.push({
      product: o.product,
      option: o.option,
      sales: o.sales,
      orders: o.orders,
      pct: optionPcts[i],
      start,
      end,
      color: o.color,
    });
    cursor += angle;
  });

  /* Product group info for labels & legend */
  const productGroups: ProductGroupInfo[] = ordered.map((p, pi) => {
    const groupSlices = slices.filter((s) => s.product === p.product);
    const first = groupSlices[0];
    const last = groupSlices[groupSlices.length - 1];
    return {
      product: p.product,
      sales: p.sales,
      orders: p.orders,
      pct: productPcts[pi],
      color: PRODUCT_COLORS[p.product] || '#9CA5B0',
      arcStart: first ? first.start : 0,
      arcEnd: last ? last.end : 0,
    };
  });

  return (
    <div>
      {/* Donut SVG */}
      <div style={{ width: 220, height: 220, margin: '0 auto', padding: '10px 0' }}>
        <svg viewBox="0 0 220 220" width={220} height={220} style={{ overflow: 'visible' }} onMouseLeave={clearHover}>
          {/* Single ring — option slices */}
          {slices.map((s, i) => (
            <path
              key={i}
              d={arcPath(CX, CY, RING_R1, RING_R2, s.start, s.end)}
              fill={s.color}
              opacity={opacity(s.product, s.option)}
              style={{ transition: 'opacity 0.15s', cursor: 'pointer' }}
              onMouseEnter={() => { setHovOpt(s.option); setHovProd(s.product); }}
              onMouseLeave={clearHover}
            >
              <title>{`${s.product} ${s.option} / ${formatKRW(s.sales)} / ${s.pct.toFixed(1)}%`}</title>
            </path>
          ))}

          {/* Product-level labels at group angular midpoints */}
          {productGroups
            .filter((pg) => {
              const arcAngle = pg.arcEnd - pg.arcStart;
              if (arcAngle < 30) return false;
              const labelText = `${pg.pct.toFixed(1)}%`;
              const estimatedTextWidth = labelText.length * 6.5;
              if (estimatedTextWidth > RING_R2 - RING_R1) return false;
              return true;
            })
            .map((pg) => {
              const mid = (pg.arcStart + pg.arcEnd) / 2;
              const labelR = (RING_R1 + RING_R2) / 2;
              const [lx, ly] = polar(CX, CY, labelR, mid);
              return (
                <text
                  key={`lbl-${pg.product}`}
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={11}
                  fontWeight={600}
                  fill="#FFFFFF"
                  opacity={opacity(pg.product)}
                  style={{ pointerEvents: 'none', transition: 'opacity 0.15s' }}
                >
                  {`${pg.pct.toFixed(1)}%`}
                </text>
              );
            })}

          {/* Center text */}
          <text x={CX} y={CY - 6} textAnchor="middle" fontSize={18} fontWeight={700} fill="#1A1D21" style={nums}>
            {formatCompact(activeTotalSales)}
          </text>
          <text x={CX} y={CY + 12} textAnchor="middle" fontSize={10} fontWeight={400} fill="#9AA2AA">
            {'\uCD1D\uB9E4\uCD9C'}
          </text>
        </svg>
      </div>

      {/* Legend — hierarchical (product → options) */}
      <div style={{ marginTop: 20 }}>
        {productGroups.map((pg, pi) => {
          const productSlices = slices.filter((s) => s.product === pg.product);
          const showOptions = productSlices.length > 1;
          return (
            <div key={pg.product}>
              {pi > 0 && <div style={{ height: 6 }} />}
              <LegendProductRow
                product={pg.product}
                color={pg.color}
                sales={pg.sales}
                pct={pg.pct}
                opacity={opacity(pg.product)}
                onEnter={() => { setHovProd(pg.product); setHovOpt(null); }}
                onLeave={clearHover}
              />
              {showOptions &&
                productSlices.map((s) => (
                  <LegendOptionRow
                    key={s.option}
                    option={s.option}
                    sales={s.sales}
                    pct={s.pct}
                    opacity={opacity(s.product, s.option)}
                    onEnter={() => { setHovOpt(s.option); setHovProd(s.product); }}
                    onLeave={clearHover}
                  />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Legend sub-components                                               */
/* ------------------------------------------------------------------ */

function LegendProductRow({
  product, color, sales, pct, opacity: op,
  onEnter, onLeave,
}: {
  product: string; color: string; sales: number; pct: number; opacity: number;
  onEnter: () => void; onLeave: () => void;
}) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', height: 24, cursor: 'pointer', opacity: op, transition: 'opacity 0.15s' }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ marginLeft: 10, flex: 1, fontSize: 12.5, fontWeight: 550, color: '#1A1D21', whiteSpace: 'nowrap' }}>
        {product}
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 500, color: '#1A1D21', ...nums, marginRight: 8, flexShrink: 0 }}>
        {formatKRW(sales)}
      </span>
      <span style={{ fontSize: 12.5, color: '#565D64', ...nums, width: 48, textAlign: 'right', flexShrink: 0 }}>
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

function LegendOptionRow({
  option, sales, pct, opacity: op,
  onEnter, onLeave,
}: {
  option: string; sales: number; pct: number; opacity: number;
  onEnter: () => void; onLeave: () => void;
}) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', height: 24, paddingLeft: 18, cursor: 'pointer', opacity: op, transition: 'opacity 0.15s' }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <span style={{ flex: 1, fontSize: 12, fontWeight: 450, color: '#565D64', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {option}
      </span>
      <span style={{ fontSize: 12, fontWeight: 450, color: '#1A1D21', ...nums, marginRight: 8, flexShrink: 0 }}>
        {formatKRW(sales)}
      </span>
      <span style={{ fontSize: 12, color: '#565D64', ...nums, width: 48, textAlign: 'right', flexShrink: 0 }}>
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}
