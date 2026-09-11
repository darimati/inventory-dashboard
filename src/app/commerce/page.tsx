export const dynamic = 'force-dynamic';

import { supabaseAdmin } from '@/lib/supabase-server';
import {
  resolveCoupangProduct,
  resolveEzadminProduct,
  inferProduct,
  productSortKey,
  PRODUCT_ORDER,
  EZADMIN_EXCLUDE,
} from '@/lib/product-map';
import {
  formatDateShort,
  formatKRW,
  getPreviousPeriodRange,
  getComparisonInvalidReason,
  getComparisonCaveat,
  getPeriodRange,
  type PeriodPreset,
} from '@/lib/helpers';
import {
  calcDailyAvg,
  calcDaysLeft,
  calcStockStatus,
  type StockStatus,
} from '@/lib/stock-status';
import HomeClient from './HomeClient';

/* ------------------------------------------------------------------ */
/*  DB row types                                                       */
/* ------------------------------------------------------------------ */

interface SaleRow {
  order_id: number;
  vendor_item_id: number;
  product_name: string;
  sale_amount: number;
  quantity: number;
  sale_date: string;
  sale_type: string;
}

interface InvRow {
  vendor_item_id: number;
  total_orderable_quantity: number;
  sales_count_last_thirty_days: number;
}

interface EzRow {
  product_code: string;
  product_name: string;
  available_stock: number;
  shipping: number;
  updated_at: string;
}

/* ------------------------------------------------------------------ */
/*  KST helpers                                                        */
/* ------------------------------------------------------------------ */

function todayKST(): string {
  const kst = new Date(Date.now() + 9 * 3_600_000);
  return kst.toISOString().slice(0, 10);
}

function yesterdayKST(): string {
  const kst = new Date(Date.now() + 9 * 3_600_000);
  kst.setUTCDate(kst.getUTCDate() - 1);
  return kst.toISOString().slice(0, 10);
}

function thirtyDaysAgoKST(): string {
  const kst = new Date(Date.now() + 9 * 3_600_000);
  kst.setUTCDate(kst.getUTCDate() - 30);
  return kst.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/*  Status helpers (shared module)                                     */
/* ------------------------------------------------------------------ */

function statusPriority(s: StockStatus): number {
  switch (s) {
    case 'oos': return 0;
    case 'order_needed': return 1;
    case 'transfer_review': return 2;
    case 'normal': return 3;
    case 'no_sales': return 4;
  }
}

/* ------------------------------------------------------------------ */
/*  Change %                                                           */
/* ------------------------------------------------------------------ */

function calcChange(
  curr: number,
  prev: number,
  valid: boolean,
): number | null {
  if (!valid) return null;
  if (prev === 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default async function HomePage(props: {
  searchParams: Promise<Record<string, string>>;
}) {
  const sp = await props.searchParams;

  /* --- period -------------------------------------------------------- */
  const preset = (sp.period as PeriodPreset) || '30d';
  const [start, end] = getPeriodRange(preset, sp.from, sp.to);
  const [compStart, compEnd] = getPreviousPeriodRange(start, end);
  const yesterday = yesterdayKST();
  const thirtyDaysAgo = thirtyDaysAgoKST();
  const productFilter = sp.product || null;

  /* --- parallel DB queries ------------------------------------------- */
  const [
    { data: rawCurrent },
    { data: rawComp },
    { data: earliestRow },
    { data: latestRow },
    { data: rawInventory },
    { data: rawEzadmin },
    { data: salesNameMapping },
    { data: rawSales30d },
    { data: rawPromotions },
    rawPurchaseOrders,
    { data: rawYesterday },
  ] = await Promise.all([
    // 1. current period sales
    supabaseAdmin
      .from('sales_coupang')
      .select(
        'order_id, vendor_item_id, product_name, sale_amount, quantity, sale_date, sale_type, settlement_amount',
      )
      .eq('brand', 'HEEDA')
      .eq('country', 'KR')
      .gte('sale_date', start)
      .lte('sale_date', end)
      .order('sale_date', { ascending: true })
      .limit(50000),
    // 2. comparison period sales
    supabaseAdmin
      .from('sales_coupang')
      .select(
        'order_id, vendor_item_id, product_name, sale_amount, quantity, sale_date, sale_type, settlement_amount',
      )
      .eq('brand', 'HEEDA')
      .eq('country', 'KR')
      .gte('sale_date', compStart)
      .lte('sale_date', compEnd)
      .limit(50000),
    // 3. earliest sale_date for data coverage
    supabaseAdmin
      .from('sales_coupang')
      .select('sale_date')
      .eq('brand', 'HEEDA')
      .eq('country', 'KR')
      .order('sale_date', { ascending: true })
      .limit(1)
      .single(),
    // 4. latest sale_date for data coverage
    supabaseAdmin
      .from('sales_coupang')
      .select('sale_date')
      .eq('brand', 'HEEDA')
      .eq('country', 'KR')
      .order('sale_date', { ascending: false })
      .limit(1)
      .single(),
    // 5. inventory_coupang
    supabaseAdmin
      .from('inventory_coupang')
      .select(
        'vendor_item_id, total_orderable_quantity, sales_count_last_thirty_days',
      ),
    // 6. ezadmin_inventory
    supabaseAdmin
      .from('ezadmin_inventory')
      .select('product_code, product_name, available_stock, shipping, updated_at'),
    // 7. vendor_item_id -> product_name mapping for unmapped inventory labels
    supabaseAdmin
      .from('sales_coupang')
      .select('vendor_item_id, product_name')
      .eq('brand', 'HEEDA')
      .eq('country', 'KR')
      .order('sale_date', { ascending: false })
      .limit(5000),
    // 8. last 30 days sales for reliable dailyAvg per VID
    supabaseAdmin
      .from('sales_coupang')
      .select('vendor_item_id, quantity, sale_type')
      .eq('brand', 'HEEDA')
      .eq('country', 'KR')
      .gte('sale_date', thirtyDaysAgo)
      .lte('sale_date', yesterday),
    // 9. active promotions
    supabaseAdmin
      .from('promotions_coupang')
      .select('name, product, start_date, end_date, discount_rate')
      .eq('is_active', true)
      .gte('end_date', todayKST())
      .lte('start_date', todayKST()),
    // 10. active purchase orders for overdue alerts
    Promise.resolve(
      supabaseAdmin
        .from('purchase_orders')
        .select('order_number, order_type, expected_at, status, purchase_order_items(product, quantity, arrived_quantity)')
        .eq('status', 'ordered')
    ).catch(() => ({ data: null, error: null })),
    // 11. yesterday sales (independent of selected period)
    supabaseAdmin
      .from('sales_coupang')
      .select('order_id, vendor_item_id, product_name, sale_amount, quantity, sale_date, sale_type')
      .eq('brand', 'HEEDA')
      .eq('country', 'KR')
      .eq('sale_date', yesterday)
      .limit(5000),
  ]);

  /* --- data coverage ------------------------------------------------- */
  const dataStartDate: string = (earliestRow as any)?.sale_date ?? '';
  const earliestDataDate: string | null = (earliestRow as any)?.sale_date ?? null;
  const latestDataDate: string | null = (latestRow as any)?.sale_date ?? null;

  /* --- comparison coverage check ------------------------------------- */
  const compDates = new Set<string>();
  for (const r of (rawComp ?? []) as SaleRow[]) {
    if (r.sale_type === 'SALE') compDates.add(r.sale_date);
  }
  const compInvalidReason = getComparisonInvalidReason(compStart, compEnd, dataStartDate || null, compDates.size);
  const compValidFinal = compInvalidReason === null;
  const compCaveat = getComparisonCaveat(compStart, compEnd, compDates.size);

  /* --- compute 30-day sales per VID from actual sales data ----------- */
  const sales30dByVid = new Map<string, number>();
  for (const row of (rawSales30d ?? []) as any[]) {
    if (row.sale_type !== 'SALE') continue;
    const vid = String(row.vendor_item_id);
    const qty = Number(row.quantity) || 0;
    sales30dByVid.set(vid, (sales30dByVid.get(vid) ?? 0) + qty);
  }

  /* --- product name map for inventory labels ------------------------- */
  const nameByVid = new Map<string, string>();
  for (const row of (salesNameMapping ?? []) as any[]) {
    if (row.vendor_item_id && row.product_name) {
      nameByVid.set(String(row.vendor_item_id), row.product_name);
    }
  }

  /* --- filter sales -------------------------------------------------- */
  const saleOnly = (rows: any[] | null): SaleRow[] =>
    (rows ?? []).filter((r: any) => r.sale_type === 'SALE') as SaleRow[];

  const resolveRow = (r: SaleRow) => {
    const vid = String(r.vendor_item_id);
    return resolveCoupangProduct(vid) ?? inferProduct(r.product_name);
  };

  const applyProductFilter = (rows: SaleRow[]): SaleRow[] => {
    if (!productFilter) return rows;
    return rows.filter((r) => resolveRow(r).product === productFilter);
  };

  const currentSales = applyProductFilter(saleOnly(rawCurrent));
  const compSales = applyProductFilter(saleOnly(rawComp));

  /* --- compute numDays in period ------------------------------------- */
  const effectiveStart = preset === 'all' && earliestDataDate ? earliestDataDate : start;
  const effectiveEnd = preset === 'all' && latestDataDate ? latestDataDate : end;
  const startMs = new Date(effectiveStart).getTime();
  const endMs = new Date(effectiveEnd).getTime();
  const numDays = Math.max(1, Math.round((endMs - startMs) / 86_400_000) + 1);

  /* --- KPIs: current period ------------------------------------------ */
  let totalSales = 0;
  let totalUnits = 0;
  let totalSets = 0;
  const orderIds = new Set<string>();

  for (const r of currentSales) {
    const amt = Number(r.sale_amount) || 0;
    const qty = Number(r.quantity) || 0;
    const mapped = resolveRow(r);
    totalSales += amt;
    totalSets += qty;
    totalUnits += qty * mapped.unitCount;
    orderIds.add(String(r.order_id));
  }

  const totalOrders = orderIds.size;

  /* --- coupon discount (where settlement_amount > 0) ------------------- */
  let totalCouponDiscount = 0;
  let couponDataCount = 0;
  for (const r of currentSales) {
    const settlement = Number((r as any).settlement_amount) || 0;
    if (settlement > 0) {
      couponDataCount++;
      totalCouponDiscount += (Number(r.sale_amount) || 0) - settlement;
    }
  }

  /* --- data coverage: days with actual data vs period length --- */
  const saleDates = new Set<string>();
  for (const r of currentSales) { saleDates.add(r.sale_date); }
  const dataCoverageDays = saleDates.size;

  /* --- KPIs: comparison period --------------------------------------- */
  let compTotalSales = 0;
  let compTotalUnits = 0;
  const compOrderIds = new Set<string>();

  for (const r of compSales) {
    const mapped = resolveRow(r);
    compTotalSales += Number(r.sale_amount) || 0;
    compOrderIds.add(String(r.order_id));
    compTotalUnits += (Number(r.quantity) || 0) * mapped.unitCount;
  }

  const compTotalOrders = compOrderIds.size;

  /* --- yesterday (from dedicated query, not period-bounded) ----------- */
  const yesterdaySalesRows = ((rawYesterday ?? []) as SaleRow[]).filter(
    (r) => r.sale_type === 'SALE',
  );
  let yesterdaySales = 0;
  const yOrderIds = new Set<string>();
  for (const r of yesterdaySalesRows) {
    yesterdaySales += Number(r.sale_amount) || 0;
    yOrderIds.add(String(r.order_id));
  }

  /* --- daily chart --------------------------------------------------- */
  const dailyMap = new Map<
    string,
    { sales: number; orders: Set<string>; qty: number }
  >();

  for (const r of currentSales) {
    const d = r.sale_date;
    if (!dailyMap.has(d))
      dailyMap.set(d, { sales: 0, orders: new Set(), qty: 0 });
    const e = dailyMap.get(d)!;
    const mapped = resolveRow(r);
    e.sales += Number(r.sale_amount) || 0;
    e.orders.add(String(r.order_id));
    e.qty += (Number(r.quantity) || 0) * mapped.unitCount;
  }

  const dailySales = Array.from(dailyMap.entries())
    .map(([date, v]) => ({
      date,
      sales: v.sales,
      orders: v.orders.size,
      quantity: v.qty,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  /* --- daily product breakdown for chart day detail ------------------- */
  const dailyProductMap = new Map<
    string,
    Map<string, { sales: number; units: number }>
  >();

  for (const r of currentSales) {
    const d = r.sale_date;
    const mapped = resolveRow(r);
    if (!dailyProductMap.has(d)) dailyProductMap.set(d, new Map());
    const dayMap = dailyProductMap.get(d)!;
    if (!dayMap.has(mapped.product))
      dayMap.set(mapped.product, { sales: 0, units: 0 });
    const e = dayMap.get(mapped.product)!;
    e.sales += Number(r.sale_amount) || 0;
    e.units += (Number(r.quantity) || 0) * mapped.unitCount;
  }

  const dailyProductBreakdown: Record<
    string,
    { product: string; sales: number; units: number }[]
  > = {};
  for (const [date, prodMap] of dailyProductMap) {
    dailyProductBreakdown[date] = Array.from(prodMap.entries())
      .map(([product, v]) => ({ product, sales: v.sales, units: v.units }))
      .sort((a, b) => productSortKey(a.product) - productSortKey(b.product));
  }

  /* --- product breakdown --------------------------------------------- */
  const prodAgg = new Map<
    string,
    { sales: number; oIds: Set<string>; setsSold: number; unitsSold: number }
  >();

  for (const r of currentSales) {
    const mapped = resolveRow(r);
    const qty = Number(r.quantity) || 0;
    const amt = Number(r.sale_amount) || 0;

    if (!prodAgg.has(mapped.product))
      prodAgg.set(mapped.product, {
        sales: 0,
        oIds: new Set(),
        setsSold: 0,
        unitsSold: 0,
      });
    const e = prodAgg.get(mapped.product)!;
    e.sales += amt;
    e.oIds.add(String(r.order_id));
    e.setsSold += qty;
    e.unitsSold += qty * mapped.unitCount;
  }

  const productBreakdown = Array.from(prodAgg.entries())
    .map(([product, v]) => ({
      product,
      sales: v.sales,
      orders: v.oIds.size,
      setsSold: v.setsSold,
      unitsSold: v.unitsSold,
      share: totalSales > 0 ? v.sales / totalSales : 0,
    }))
    .sort((a, b) => productSortKey(a.product) - productSortKey(b.product));

  const productOrderSum = productBreakdown.reduce((sum, p) => sum + p.orders, 0);

  /* --- option-level breakdown per product (for expandable rows) ------ */
  const optionAgg = new Map<
    string,
    Map<
      string,
      { sales: number; oIds: Set<string>; setsSold: number; unitsSold: number; unitCount: number; spec: string }
    >
  >();

  for (const r of currentSales) {
    const mapped = resolveRow(r);
    const qty = Number(r.quantity) || 0;
    const amt = Number(r.sale_amount) || 0;

    if (!optionAgg.has(mapped.product))
      optionAgg.set(mapped.product, new Map());
    const prodMap = optionAgg.get(mapped.product)!;

    if (!prodMap.has(mapped.option))
      prodMap.set(mapped.option, {
        sales: 0,
        oIds: new Set(),
        setsSold: 0,
        unitsSold: 0,
        unitCount: mapped.unitCount,
        spec: mapped.spec,
      });
    const e = prodMap.get(mapped.option)!;
    e.sales += amt;
    e.oIds.add(String(r.order_id));
    e.setsSold += qty;
    e.unitsSold += qty * mapped.unitCount;
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

  const optionBreakdownByProduct: Record<string, OptionBreakdownRow[]> = {};
  for (const [product, optMap] of optionAgg) {
    optionBreakdownByProduct[product] = Array.from(optMap.entries())
      .map(([option, v]) => ({
        option,
        unitCount: v.unitCount,
        spec: v.spec,
        sales: v.sales,
        orders: v.oIds.size,
        setsSold: v.setsSold,
        unitsSold: v.unitsSold,
        share: totalSales > 0 ? v.sales / totalSales : 0,
      }))
      .sort((a, b) => a.unitCount - b.unitCount);
  }

  /* --- EZAdmin processing -------------------------------------------- */
  let ezadminRawTotal = 0;
  let ezadminMappedTotal = 0;
  let ezadminUnmappedTotal = 0;
  let ezadminSuppliesTotal = 0;
  const ezStockByProduct = new Map<string, { domestic: number; japan: number; export: number; shippingDomestic: number }>();
  let ezadminUpdatedAt = '';

  // raw EZAdmin items for mapping display
  interface EzMappingRow {
    productCode: string;
    productName: string;
    availableStock: number;
    mappedProduct: string | null;
    mappedOption: string | null;
    updatedAt: string;
  }
  const ezadminMappingRows: EzMappingRow[] = [];

  for (const row of (rawEzadmin ?? []) as EzRow[]) {
    // Skip non-HEEDA brand products
    if (EZADMIN_EXCLUDE.has(row.product_code)) continue;

    const stock = row.available_stock ?? 0;
    ezadminRawTotal += stock;

    // track latest updated_at
    if (row.updated_at && row.updated_at > ezadminUpdatedAt) {
      ezadminUpdatedAt = row.updated_at;
    }

    const mapped = resolveEzadminProduct(row.product_code);

    if (mapped?.stockType === '부자재') {
      ezadminSuppliesTotal += stock;
      // Still add to mapping rows for display
      ezadminMappingRows.push({
        productCode: row.product_code,
        productName: row.product_name,
        availableStock: stock,
        mappedProduct: mapped.product,
        mappedOption: mapped.option,
        updatedAt: row.updated_at,
      });
      continue; // Don't count as mapped product stock
    }

    ezadminMappingRows.push({
      productCode: row.product_code,
      productName: row.product_name,
      availableStock: stock,
      mappedProduct: mapped?.product ?? null,
      mappedOption: mapped?.option ?? null,
      updatedAt: row.updated_at,
    });

    if (!mapped) {
      ezadminUnmappedTotal += stock;
      continue;
    }

    ezadminMappedTotal += stock;

    // Per-product domestic/export breakdown
    const existing = ezStockByProduct.get(mapped.product) ?? { domestic: 0, japan: 0, export: 0, shippingDomestic: 0 };
    const variantType = (mapped as any).variantType ?? (mapped.variant === '수출용' ? 'export' : 'domestic');
    if (variantType === 'export') {
      existing.export += stock;
    } else if (variantType === 'japan') {
      existing.japan += stock;
    } else {
      existing.domestic += stock;
      existing.shippingDomestic += (row.shipping ?? 0);
    }
    ezStockByProduct.set(mapped.product, existing);
  }

  const ezadminIntegrityOk = (ezadminMappedTotal + ezadminUnmappedTotal + ezadminSuppliesTotal) === ezadminRawTotal;

  /* --- build merged option-level items from inventory ----------------- */
  /*
   * Key fix: merge duplicate VIDs that map to the same product+option.
   * Also use sales30dByVid (from actual sales_coupang) instead of
   * inventory_coupang.sales_count_last_thirty_days which can be 0/stale.
   */
  const invRows = (rawInventory ?? []) as InvRow[];

  interface MergedOption {
    product: string;
    option: string;
    unitCount: number;
    stock: number;        // sum of total_orderable_quantity across VIDs
    sales30d: number;     // sum of 30-day sales (sets) across VIDs
  }

  const mergedOptionMap = new Map<string, MergedOption>();

  for (const inv of invRows) {
    const vid = String(inv.vendor_item_id);
    const stock = inv.total_orderable_quantity ?? 0;

    const mapped = resolveCoupangProduct(vid);
    const rawName = nameByVid.get(vid) || '';
    const inferred = inferProduct(rawName);

    const product = mapped ? mapped.product : inferred.product;
    const option = mapped ? mapped.option : inferred.option;
    const unitCount = mapped ? mapped.unitCount : inferred.unitCount;

    if (productFilter && product !== productFilter) continue;

    const key = `${product}|${option}`;
    const existing = mergedOptionMap.get(key);

    // Use actual 30-day sales from sales_coupang
    const vidSales30d = sales30dByVid.get(vid) ?? 0;

    if (existing) {
      existing.stock += stock;
      existing.sales30d += vidSales30d;
    } else {
      mergedOptionMap.set(key, {
        product,
        option,
        unitCount,
        stock,
        sales30d: vidSales30d,
      });
    }
  }

  /* --- compute depletion & status per merged option ------------------- */
  interface OptionInventoryItem {
    product: string;
    option: string;
    unitCount: number;
    stock: number;
    sales30d: number;
    dailyAvg: number;       // sets/day
    daysLeft: number | null;
    status: StockStatus;
  }

  const allOptionItems: OptionInventoryItem[] = [];

  for (const m of mergedOptionMap.values()) {
    const dailyAvg = calcDailyAvg(m.sales30d);
    const daysLeft = calcDaysLeft(m.stock, dailyAvg);
    const status = calcStockStatus(m.stock, m.sales30d, daysLeft);

    allOptionItems.push({
      product: m.product,
      option: m.option,
      unitCount: m.unitCount,
      stock: m.stock,
      sales30d: m.sales30d,
      dailyAvg,
      daysLeft,
      status,
    });
  }

  /* --- orderNeededCount (option-level) -------------------------------- */
  const orderNeededCount = allOptionItems.filter(
    (s) => s.status === 'order_needed',
  ).length;

  /* --- unmapped VIDs (SKUs with sales but not in COUPANG_MAP) --------- */
  const unmappedVids = new Set<string>();
  for (const r of saleOnly(rawCurrent)) {
    if (!resolveCoupangProduct(String(r.vendor_item_id))) {
      unmappedVids.add(String(r.vendor_item_id));
    }
  }

  /* --- todayChecks: 4 actionable alert items -------------------------- */
  interface TodayCheck {
    dot: 'red' | 'amber' | 'gray' | 'blue';
    title: string;
    description: string;
  }

  const todayChecks: TodayCheck[] = [];

  // 1. 발주 필요 SKU
  const orderNeededItems = allOptionItems.filter(
    (s) => s.status === 'order_needed',
  );
  if (orderNeededItems.length > 0) {
    const details = orderNeededItems
      .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
      .map(
        (s) =>
          `${s.product} ${s.option}: 재고 ${s.stock}개, 일평균 ${s.dailyAvg}개, ${s.daysLeft}일 후 소진`,
      )
      .join(' / ');
    todayChecks.push({
      dot: 'red',
      title: `발주 필요 ${orderNeededItems.length}건`,
      description: details,
    });
  }

  // 1-b. 이관 검토 SKU (daysLeft 15~30일)
  const transferReviewItems = allOptionItems.filter(
    (s) => s.status === 'transfer_review',
  );
  if (transferReviewItems.length > 0) {
    const details = transferReviewItems
      .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
      .map(
        (s) =>
          `${s.product} ${s.option}: 재고 ${s.stock}개, ${s.daysLeft}일 후 소진`,
      )
      .join(' / ');
    todayChecks.push({
      dot: 'amber',
      title: `이관 검토 ${transferReviewItems.length}건`,
      description: details,
    });
  }

  // 1-c. 품절 SKU (split unmapped vs mapped)
  const oosItems = allOptionItems.filter(
    (s) => s.status === 'oos',
  );
  const oosUnmapped = oosItems.filter((s) => s.product === '분류 필요');
  const oosMapped = oosItems.filter((s) => s.product !== '분류 필요');
  if (oosMapped.length > 0) {
    const details = oosMapped
      .map((s) => `${s.product} ${s.option}`)
      .join(' / ');
    todayChecks.push({
      dot: 'red',
      title: `품절 ${oosMapped.length}건`,
      description: details,
    });
  }
  if (oosUnmapped.length > 0) {
    todayChecks.push({
      dot: 'red',
      title: `미매핑 SKU 품절 ${oosUnmapped.length}건`,
      description: oosUnmapped.map((s) => s.option).join(' / '),
    });
  }

  // 2. SKU 미매핑 옵션
  if (unmappedVids.size > 0) {
    todayChecks.push({
      dot: 'amber',
      title: `SKU 미매핑 ${unmappedVids.size}건`,
      description: '매출은 발생하나 재고 매핑이 없는 옵션',
    });
  }

  // 3. 국내 3PL 미매핑 재고
  if (ezadminUnmappedTotal > 0) {
    todayChecks.push({
      dot: 'amber',
      title: `3PL 미매핑 재고 ${ezadminUnmappedTotal}개`,
      description: `이지어드민 전체 ${ezadminRawTotal}개 중 ${ezadminMappedTotal}개 매핑`,
    });
  }

  // --- Sales alerts ---

  // a) 급증/급감 products (+-30% vs prev period)
  if (compValidFinal) {
    const currentProductSales = new Map<string, number>();
    const compProductSales = new Map<string, number>();
    for (const r of currentSales) {
      const mapped = resolveRow(r);
      currentProductSales.set(mapped.product, (currentProductSales.get(mapped.product) ?? 0) + (Number(r.sale_amount) || 0));
    }
    for (const r of compSales) {
      const mapped = resolveRow(r);
      compProductSales.set(mapped.product, (compProductSales.get(mapped.product) ?? 0) + (Number(r.sale_amount) || 0));
    }

    const surgeItems: TodayCheck[] = [];
    for (const [product, currSales] of currentProductSales) {
      const prevSales = compProductSales.get(product) ?? 0;
      if (prevSales === 0 && currSales > 0) {
        surgeItems.push({
          dot: 'blue',
          title: `${product} 신규 매출`,
          description: `이번 기간 ${formatKRW(currSales)} (직전 매출 없음)`,
        });
      } else if (prevSales > 0) {
        const changeRate = ((currSales - prevSales) / prevSales) * 100;
        if (changeRate >= 30) {
          surgeItems.push({
            dot: 'blue',
            title: `${product} 매출 +${Math.round(changeRate)}%`,
            description: `이번 기간 ${formatKRW(currSales)} (직전 ${formatKRW(prevSales)})`,
          });
        } else if (changeRate <= -30) {
          surgeItems.push({
            dot: 'amber',
            title: `${product} 매출 ${Math.round(changeRate)}%`,
            description: `이번 기간 ${formatKRW(currSales)} (직전 ${formatKRW(prevSales)})`,
          });
        }
      }
    }
    todayChecks.push(...surgeItems);

    // b) 비중 역전
    const currentRanking = Array.from(currentProductSales.entries())
      .filter(([p]) => (PRODUCT_ORDER as readonly string[]).includes(p))
      .sort((a, b) => b[1] - a[1]);
    const prevRanking = Array.from(compProductSales.entries())
      .filter(([p]) => (PRODUCT_ORDER as readonly string[]).includes(p))
      .sort((a, b) => b[1] - a[1]);

    for (let i = 0; i < currentRanking.length; i++) {
      const [product, sales] = currentRanking[i];
      const prevIdx = prevRanking.findIndex(([p]) => p === product);
      if (prevIdx > i && prevIdx >= 0) {
        // This product moved up - it overtook someone
        const overtaken = prevRanking[i]?.[0];
        if (overtaken && overtaken !== product) {
          const share = totalSales > 0 ? ((sales / totalSales) * 100).toFixed(1) : '0';
          const prevShare = prevRanking.length > 0
            ? (((compProductSales.get(product) ?? 0) / prevRanking.reduce((s, [, v]) => s + v, 0)) * 100).toFixed(1)
            : '0';
          todayChecks.push({
            dot: 'gray',
            title: `${product}이 ${overtaken}을 추월`,
            description: `비중 ${share}% (직전 ${prevShare}%)`,
          });
        }
      }
    }
  }

  // c) 판매 없는 옵션
  const zeroSalesOptions: string[] = [];
  for (const [product, optMap] of optionAgg) {
    if (!(PRODUCT_ORDER as readonly string[]).includes(product)) continue;
    for (const [option, data] of optMap) {
      if (data.sales === 0) {
        // Check if there's inventory for this option
        const invKey = `${product}|${option}`;
        const inv = mergedOptionMap.get(invKey);
        const stock = inv?.stock ?? 0;
        zeroSalesOptions.push(`${product} ${option} 판매 0건${stock > 0 ? ` — 재고 ${stock}개 보유` : ''}`);
      }
    }
  }
  if (zeroSalesOptions.length > 0) {
    todayChecks.push({
      dot: 'gray',
      title: `판매 없는 옵션 ${zeroSalesOptions.length}건`,
      description: zeroSalesOptions.join(' / '),
    });
  }

  // 4. 발주 입고 지연
  const today = todayKST();
  const activePOs = ((rawPurchaseOrders as any)?.data ?? []) as any[];
  const overduePOs = activePOs.filter((po: any) => po.expected_at && po.expected_at < today);
  if (overduePOs.length > 0) {
    const details = overduePOs.map((po: any) => {
      const items = (po.purchase_order_items ?? []).map((i: any) => i.product).join(', ');
      const daysOverdue = Math.round((Date.now() + 9 * 3_600_000 - new Date(po.expected_at + 'T00:00:00+09:00').getTime()) / 86_400_000);
      return `${po.order_number} (${items}) ${daysOverdue}일 지연`;
    }).join(' / ');
    todayChecks.push({
      dot: 'red',
      title: `발주 입고 지연 ${overduePOs.length}건`,
      description: details,
    });
  }

  // 4-b. 입고 예정 (3일 이내)
  const upcomingPOs = activePOs.filter((po: any) => {
    if (!po.expected_at || po.expected_at < today) return false;
    const daysUntil = Math.round((new Date(po.expected_at + 'T00:00:00+09:00').getTime() - (Date.now() + 9 * 3_600_000)) / 86_400_000);
    return daysUntil <= 3;
  });
  if (upcomingPOs.length > 0) {
    const details = upcomingPOs.map((po: any) => {
      const items = (po.purchase_order_items ?? []).map((i: any) => i.product).join(', ');
      return `${po.order_number} (${items}) 예정일 ${po.expected_at.slice(5).replace('-', '/')}`;
    }).join(' / ');
    todayChecks.push({
      dot: 'blue',
      title: `입고 예정 ${upcomingPOs.length}건 (3일 이내)`,
      description: details,
    });
  }

  // Priority sort and trim to 6
  function checkPriority(title: string): number {
    if (title.includes('품절')) return 0;
    if (title.includes('입고 지연')) return 1;
    if (title.includes('발주 필요')) return 2;
    if (title.includes('이관 검토')) return 3;
    if (title.includes('입고 예정')) return 4;
    if (title.includes('매출') && (title.includes('+') || title.includes('-') || title.includes('%'))) return 5;
    if (title.includes('추월')) return 6;
    if (title.includes('판매 없는')) return 7;
    if (title.includes('미매핑')) return 8;
    return 9;
  }
  todayChecks.sort((a, b) => checkPriority(a.title) - checkPriority(b.title));
  const finalChecks = todayChecks.slice(0, 6);

  /* --- option-level inventory for home (P0-B) ------------------------ */
  // Filter: show options with stock > 0 or 30-day sales > 0
  const homeOptionInventory = allOptionItems
    .filter(item => item.product !== '분류 필요' && (item.stock > 0 || item.sales30d > 0))
    .sort((a, b) => {
      const pk = productSortKey(a.product) - productSortKey(b.product);
      if (pk !== 0) return pk;
      return a.unitCount - b.unitCount;
    })
    .map(item => ({
      product: item.product,
      option: item.option,
      unitCount: item.unitCount,
      rocketStock: item.stock,
      dailyAvg: item.dailyAvg,
      daysLeft: item.daysLeft,
      status: item.status,
      sales30d: item.sales30d,
    }));

  // EZAdmin per-product for 3PL column (only 단품 gets 3PL display)
  const ezadminByProductHome: Record<string, { domestic: number; shippingDomestic: number }> = {};
  for (const [product, detail] of ezStockByProduct) {
    ezadminByProductHome[product] = {
      domestic: detail.domestic,
      shippingDomestic: detail.shippingDomestic,
    };
  }

  /* --- yesterday sales per option (P0-C) ----------------------------- */
  interface YesterdayOptionSale {
    product: string;
    option: string;
    quantity: number;
    sales: number;
  }

  const yOptionMap = new Map<string, { product: string; option: string; quantity: number; sales: number }>();
  for (const r of yesterdaySalesRows) {
    const mapped = resolveRow(r);
    const key = `${mapped.product}|${mapped.option}`;
    const existing = yOptionMap.get(key);
    const qty = Number(r.quantity) || 0;
    const amt = Number(r.sale_amount) || 0;
    if (existing) {
      existing.quantity += qty;
      existing.sales += amt;
    } else {
      yOptionMap.set(key, { product: mapped.product, option: mapped.option, quantity: qty, sales: amt });
    }
  }

  // Include main options with 0 sales
  const mainOptions = allOptionItems.filter(item =>
    (PRODUCT_ORDER as readonly string[]).includes(item.product) && item.product !== '분류 필요'
  );
  for (const item of mainOptions) {
    const key = `${item.product}|${item.option}`;
    if (!yOptionMap.has(key) && (item.stock > 0 || item.sales30d > 0)) {
      yOptionMap.set(key, { product: item.product, option: item.option, quantity: 0, sales: 0 });
    }
  }

  const yesterdayByOption: YesterdayOptionSale[] = Array.from(yOptionMap.values())
    .sort((a, b) => {
      const pk = productSortKey(a.product) - productSortKey(b.product);
      if (pk !== 0) return pk;
      return b.sales - a.sales;
    });

  /* --- inventorySummaryByProduct (product-level) ---------------------- */

  const invByProduct = new Map<
    string,
    {
      rocketStock: number;
      rocketDailyAvg: number;
      options: OptionInventoryItem[];
    }
  >();

  for (const item of allOptionItems) {
    const existing = invByProduct.get(item.product);
    if (existing) {
      existing.rocketStock += item.stock;
      existing.rocketDailyAvg += item.dailyAvg;
      existing.options.push(item);
    } else {
      invByProduct.set(item.product, {
        rocketStock: item.stock,
        rocketDailyAvg: item.dailyAvg,
        options: [item],
      });
    }
  }

  // Incoming from active POs per product
  const incomingByProductHome = new Map<string, number>();
  for (const po of activePOs) {
    if (po.expected_at && po.expected_at < today) continue;
    for (const item of (po.purchase_order_items ?? []) as any[]) {
      const remaining = (item.quantity ?? 0) - (item.arrived_quantity ?? 0);
      if (remaining <= 0) continue;
      incomingByProductHome.set(item.product, (incomingByProductHome.get(item.product) ?? 0) + remaining);
    }
  }

  /* --- build client data --------------------------------------------- */
  return (
    <HomeClient
      data={{
        yesterdaySales,
        yesterdayOrders: yOrderIds.size,
        yesterday,
        totalSales,
        totalOrders,
        totalQuantity: totalUnits,
        totalSets,
        compValid: compValidFinal,
        salesChange: calcChange(totalSales, compTotalSales, compValidFinal),
        ordersChange: calcChange(totalOrders, compTotalOrders, compValidFinal),
        quantityChange: calcChange(totalUnits, compTotalUnits, compValidFinal),
        periodLabel: `${formatDateShort(effectiveStart)} ~ ${formatDateShort(effectiveEnd)}`,
        periodStart: effectiveStart,
        periodEnd: effectiveEnd,
        compPeriodStart: compStart,
        compPeriodEnd: compEnd,
        compPeriodLabel: `${formatDateShort(compStart)}~${formatDateShort(compEnd)}`,
        compInvalidReason: compInvalidReason,
        compCaveat,
        numDays,
        orderNeededCount,
        dailySales,
        dailyProductBreakdown,
        productBreakdown,
        productOrderSum,
        optionBreakdownByProduct,
        todayChecks: finalChecks,
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
        activePromotions: (rawPromotions ?? []).map((p: any) => ({
          name: p.name,
          product: p.product,
          discountRate: p.discount_rate,
          startDate: p.start_date,
          endDate: p.end_date,
        })),
      }}
    />
  );
}
