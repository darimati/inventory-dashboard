export const dynamic = 'force-dynamic';

import { supabaseAdmin } from '@/lib/supabase-server';
import {
  resolveCoupangProduct,
  inferProduct,
  productSortKey,
} from '@/lib/product-map';
import {
  getPeriodRange,
  getPreviousPeriodRange,
  getComparisonInvalidReason,
  getComparisonCaveat,
  formatDateShort,
  type PeriodPreset,
} from '@/lib/helpers';
import SalesClient from './SalesClient';

export const metadata = { title: '매출 | HEEDA Commerce' };

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SalesRow {
  order_id: number;
  vendor_item_id: number;
  product_name: string;
  sale_amount: number;
  quantity: number;
  sale_date: string;
  sale_type: string;
  settlement_amount: number | null;
}

/* ------------------------------------------------------------------ */
/*  Page (Server Component)                                            */
/* ------------------------------------------------------------------ */

export default async function SalesPage(props: {
  searchParams: Promise<Record<string, string>>;
}) {
  const searchParams = await props.searchParams;
  const preset = (searchParams.period as PeriodPreset) || '30d';

  /* --- period range --- */
  let fromDate: string;
  let toDate: string;
  if (preset === 'custom' && searchParams.from && searchParams.to) {
    fromDate = searchParams.from;
    toDate = searchParams.to;
  } else {
    [fromDate, toDate] = getPeriodRange(preset, searchParams.from, searchParams.to);
  }

  const productFilter = searchParams.product || null;

  const [compFrom, compTo] = getPreviousPeriodRange(fromDate, toDate);

  /* --- parallel queries --- */
  const [{ data: currentRaw }, { data: compRaw }, { data: earliestRow }, { data: latestRow }] =
    await Promise.all([
      supabaseAdmin
        .from('sales_coupang')
        .select(
          'order_id, vendor_item_id, product_name, sale_amount, quantity, sale_date, sale_type, settlement_amount',
        )
        .eq('brand', 'HEEDA')
        .eq('country', 'KR')
        .gte('sale_date', fromDate)
        .lte('sale_date', toDate)
        .limit(50000),
      supabaseAdmin
        .from('sales_coupang')
        .select(
          'order_id, vendor_item_id, product_name, sale_amount, quantity, sale_date, sale_type, settlement_amount',
        )
        .eq('brand', 'HEEDA')
        .eq('country', 'KR')
        .gte('sale_date', compFrom)
        .lte('sale_date', compTo)
        .limit(50000),
      supabaseAdmin
        .from('sales_coupang')
        .select('sale_date')
        .eq('brand', 'HEEDA')
        .eq('country', 'KR')
        .order('sale_date', { ascending: true })
        .limit(1)
        .single(),
      supabaseAdmin
        .from('sales_coupang')
        .select('sale_date')
        .eq('brand', 'HEEDA')
        .eq('country', 'KR')
        .order('sale_date', { ascending: false })
        .limit(1)
        .single(),
    ]);

  const currentRows = (currentRaw ?? []) as SalesRow[];
  const compRows = (compRaw ?? []) as SalesRow[];
  const dataStartDate: string | null = earliestRow?.sale_date ?? null;
  const earliestDataDate: string | null = earliestRow?.sale_date ?? null;
  const latestDataDate: string | null = latestRow?.sale_date ?? null;

  const filteredRows = productFilter
    ? currentRows.filter(row => {
        const mapped = resolveCoupangProduct(String(row.vendor_item_id)) ?? inferProduct(row.product_name);
        return mapped.product === productFilter;
      })
    : currentRows;

  const filteredCompRows = productFilter
    ? compRows.filter(row => {
        const mapped = resolveCoupangProduct(String(row.vendor_item_id)) ?? inferProduct(row.product_name);
        return mapped.product === productFilter;
      })
    : compRows;

  /* --- aggregate current period: product -> option --- */
  type OptAgg = {
    option: string;
    sales: number;
    orderIds: Set<string>;
    setsSold: number;
    unitsSold: number;
    unitCount: number;
  };
  type ProdAgg = {
    product: string;
    spec: string;
    sales: number;
    orderIds: Set<string>;
    setsSold: number;
    unitsSold: number;
    options: Map<string, OptAgg>;
  };

  const productMap = new Map<string, ProdAgg>();
  const dailyMap = new Map<
    string,
    { sales: number; orderIds: Set<string>; unitsSold: number }
  >();
  const dailyDetailMap = new Map<
    string,
    Map<string, { product: string; sales: number; unitsSold: number }>
  >();

  let totalSales = 0;
  const allOrderIds = new Set<string>();

  for (const row of filteredRows) {
    if (row.sale_type !== 'SALE') continue;

    const amount = Number(row.sale_amount) || 0;
    const qty = Number(row.quantity) || 1;
    const orderId = String(row.order_id);
    const vid = String(row.vendor_item_id);
    const mapped = resolveCoupangProduct(vid) ?? inferProduct(row.product_name);

    totalSales += amount;
    allOrderIds.add(orderId);

    /* product -> option */
    if (!productMap.has(mapped.product)) {
      productMap.set(mapped.product, {
        product: mapped.product,
        spec: mapped.spec,
        sales: 0,
        orderIds: new Set(),
        setsSold: 0,
        unitsSold: 0,
        options: new Map(),
      });
    }
    const pg = productMap.get(mapped.product)!;
    pg.sales += amount;
    pg.orderIds.add(orderId);
    pg.setsSold += qty;
    pg.unitsSold += qty * mapped.unitCount;

    if (!pg.options.has(mapped.option)) {
      pg.options.set(mapped.option, {
        option: mapped.option,
        sales: 0,
        orderIds: new Set(),
        setsSold: 0,
        unitsSold: 0,
        unitCount: mapped.unitCount,
      });
    }
    const og = pg.options.get(mapped.option)!;
    og.sales += amount;
    og.orderIds.add(orderId);
    og.setsSold += qty;
    og.unitsSold += qty * mapped.unitCount;

    /* daily total */
    if (!dailyMap.has(row.sale_date)) {
      dailyMap.set(row.sale_date, {
        sales: 0,
        orderIds: new Set(),
        unitsSold: 0,
      });
    }
    const dg = dailyMap.get(row.sale_date)!;
    dg.sales += amount;
    dg.orderIds.add(orderId);
    dg.unitsSold += qty * mapped.unitCount;

    /* daily detail (product level) */
    if (!dailyDetailMap.has(row.sale_date)) {
      dailyDetailMap.set(row.sale_date, new Map());
    }
    const ddm = dailyDetailMap.get(row.sale_date)!;
    if (!ddm.has(mapped.product)) {
      ddm.set(mapped.product, {
        product: mapped.product,
        sales: 0,
        unitsSold: 0,
      });
    }
    const dd = ddm.get(mapped.product)!;
    dd.sales += amount;
    dd.unitsSold += qty * mapped.unitCount;
  }

  /* totals */
  const totalOrders = allOrderIds.size;
  const totalUnitsSold = Array.from(productMap.values()).reduce(
    (s, p) => s + p.unitsSold,
    0,
  );

  /* coupon discount: settlement_amount > 0 means we have actual payment data */
  let totalCouponDiscount = 0;
  let couponDataCount = 0;
  for (const row of filteredRows) {
    if (row.sale_type !== 'SALE') continue;
    const settlement = Number(row.settlement_amount) || 0;
    if (settlement > 0) {
      couponDataCount++;
      totalCouponDiscount += (Number(row.sale_amount) || 0) - settlement;
    }
  }

  /* --- data coverage: how many days in period actually have data --- */
  const dataDates = new Set<string>();
  for (const row of filteredRows) {
    if (row.sale_type === 'SALE') dataDates.add(row.sale_date);
  }
  const dataCoverageDays = dataDates.size;

  /* number of days in period — for 'all' use actual data range */
  const effectiveStart = preset === 'all' && earliestDataDate ? earliestDataDate : fromDate;
  const effectiveEnd = preset === 'all' && latestDataDate ? latestDataDate : toDate;
  const startMs = new Date(effectiveStart).getTime();
  const endMs = new Date(effectiveEnd).getTime();
  const numDays = Math.max(1, Math.round((endMs - startMs) / 86_400_000) + 1);

  const dailyAvgSales = Math.round(totalSales / numDays);
  const dailyAvgOrders = Math.round((totalOrders / numDays) * 10) / 10;
  const unitsPerOrder =
    totalOrders > 0 ? Math.round((totalUnitsSold / totalOrders) * 10) / 10 : 0;

  /* productOrderSum: sum of per-product order counts (may differ from totalOrders) */
  const productOrderSum = Array.from(productMap.values()).reduce(
    (s, p) => s + p.orderIds.size,
    0,
  );

  /* products array (serialisable) */
  const products = Array.from(productMap.values())
    .map((p) => ({
      product: p.product,
      spec: p.spec,
      sales: p.sales,
      orders: p.orderIds.size,
      setsSold: p.setsSold,
      unitsSold: p.unitsSold,
      share: totalSales > 0 ? p.sales / totalSales : 0,
      options: Array.from(p.options.values()).map((o) => ({
        option: o.option,
        sales: o.sales,
        orders: o.orderIds.size,
        setsSold: o.setsSold,
        unitsSold: o.unitsSold,
        unitCount: o.unitCount,
        share: totalSales > 0 ? o.sales / totalSales : 0,
      })),
    }))
    .sort((a, b) => productSortKey(a.product) - productSortKey(b.product));

  /* daily array */
  const daily = Array.from(dailyMap.entries())
    .map(([date, d]) => ({
      date,
      sales: d.sales,
      orders: d.orderIds.size,
      unitsSold: d.unitsSold,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  /* daily details */
  const dailyDetails: Record<
    string,
    { product: string; sales: number; unitsSold: number }[]
  > = {};
  for (const [date, pMap] of dailyDetailMap) {
    dailyDetails[date] = Array.from(pMap.values()).sort(
      (a, b) => b.sales - a.sales,
    );
  }

  /* --- comparison aggregation --- */
  let compTotalSales = 0;
  let compTotalUnitsSold = 0;
  const compOrderIds = new Set<string>();

  for (const row of filteredCompRows) {
    if (row.sale_type !== 'SALE') continue;
    compTotalSales += Number(row.sale_amount) || 0;
    compOrderIds.add(String(row.order_id));
    const mapped =
      resolveCoupangProduct(String(row.vendor_item_id)) ??
      inferProduct(row.product_name);
    compTotalUnitsSold += (Number(row.quantity) || 1) * mapped.unitCount;
  }
  const compTotalOrders = compOrderIds.size;

  // Count distinct dates in comparison data for coverage check
  const compDataDates = new Set<string>();
  for (const row of filteredCompRows) {
    if (row.sale_type !== 'SALE') continue;
    compDataDates.add(row.sale_date);
  }
  const compInvalidReason = getComparisonInvalidReason(compFrom, compTo, dataStartDate, compDataDates.size);
  const compValid = compInvalidReason === null;
  const compCaveat = getComparisonCaveat(compFrom, compTo, compDataDates.size);

  // Per-product comparison aggregation
  const compProductMap = new Map<string, { sales: number; orderIds: Set<string> }>();
  for (const row of filteredCompRows) {
    if (row.sale_type !== 'SALE') continue;
    const mapped = resolveCoupangProduct(String(row.vendor_item_id)) ?? inferProduct(row.product_name);
    if (!compProductMap.has(mapped.product)) {
      compProductMap.set(mapped.product, { sales: 0, orderIds: new Set() });
    }
    const pg = compProductMap.get(mapped.product)!;
    pg.sales += Number(row.sale_amount) || 0;
    pg.orderIds.add(String(row.order_id));
  }

  const compProducts = Array.from(compProductMap.entries()).map(([product, v]) => ({
    product,
    sales: v.sales,
    orders: v.orderIds.size,
  }));

  /* --- render --- */
  return (
    <SalesClient
      totalSales={totalSales}
      totalOrders={totalOrders}
      totalUnitsSold={totalUnitsSold}
      numDays={numDays}
      dailyAvgSales={dailyAvgSales}
      dailyAvgOrders={dailyAvgOrders}
      unitsPerOrder={unitsPerOrder}
      productOrderSum={productOrderSum}
      comparisonValid={compValid}
      compTotalSales={compTotalSales}
      compTotalOrders={compTotalOrders}
      compTotalUnitsSold={compTotalUnitsSold}
      compProducts={compProducts}
      compPeriodStart={compFrom}
      compPeriodEnd={compTo}
      compPeriodLabel={`${formatDateShort(compFrom)}~${formatDateShort(compTo)}`}
      compInvalidReason={compInvalidReason}
      compCaveat={compCaveat}
      products={products}
      daily={daily}
      dailyDetails={dailyDetails}
      periodStart={effectiveStart}
      periodEnd={effectiveEnd}
      totalCouponDiscount={totalCouponDiscount}
      couponDataCount={couponDataCount}
      dataCoverageDays={dataCoverageDays}
      dataStartDate={dataStartDate}
      earliestDataDate={earliestDataDate}
      latestDataDate={latestDataDate}
    />
  );
}
