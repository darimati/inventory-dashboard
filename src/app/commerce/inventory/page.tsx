import { supabaseAdmin } from '@/lib/supabase-server';
import { resolveCoupangProduct, resolveEzadminProduct, productSortKey, EZADMIN_EXCLUDE, PRODUCT_COLORS, isMainProduct } from '@/lib/product-map';
import type { SkuClassification, EzadminVariant } from '@/lib/product-map';
import InventoryClient from './InventoryClient';

export const dynamic = 'force-dynamic';

function nDaysAgoKST(n: number): string {
  const kst = new Date(Date.now() + 9 * 3_600_000);
  kst.setUTCDate(kst.getUTCDate() - n);
  return kst.toISOString().slice(0, 10);
}

export interface RocketItem {
  product: string;
  option: string;
  spec: string;
  vendorItemId: string;
  stock: number;           // 세트 단위 재고 (원본)
  unitCount: number;       // 세트당 낱개 수
  unitStock: number;       // 낱개 환산 재고 = stock × unitCount
  sales30d: number;
  sales7d: number;
  dailyAvg: number;        // 소진일 계산용 (7일 우선, 30일 폴백)
  dailyAvg7: number;
  dailyAvg30: number;
  salesBasis: '7d' | '30d' | null;
  daysLeft: number | null;
  snapshotAt: string;
}

export interface EzadminItem {
  product: string;
  option: string;
  spec: string;
  productCode: string;
  productName: string;
  availableStock: number;
  normalStock: number;
  defectiveStock: number;
  shipping: number;
  incoming: number;
  updatedAt: string;
  variant: 'domestic' | 'export';
  variantType: 'domestic' | 'japan' | 'export';
  stockType: 'finished' | 'submaterial';
  note: string;
  mapped: boolean;
}

export interface AlertItem {
  product: string;
  option: string;
  stock: number;
  dailyAvg: number;
  daysLeft: number;
  location: string;
}

export interface PurchaseOrder {
  id: string;
  order_number: string;
  order_type: 'production' | 'transfer';
  destination: 'easyadmin' | 'rocketgrowth';
  status: 'ordered' | 'arrived' | 'cancelled';
  ordered_at: string;
  expected_at: string | null;
  arrived_at: string | null;
  memo: string | null;
  created_at: string;
  created_by: string | null;
  purchase_order_items: PurchaseOrderItem[];
}

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  product: string;
  quantity: number;
  arrived_quantity: number;
}

/** Per-product summary card data */
export interface ProductSummary {
  product: string;
  spec: string;
  color: string;
  rocketStock: number;        // 낱개 환산 합계
  ezadminTotal: number;
  ezadminDomestic: number;
  ezadminJapan: number;
  ezadminExport: number;
  ezadminExportWorkable: number;
  shippingQty: number;
  incomingQty: number;
  availableStock: number;
  dailyAvg: number;
  dailyAvg7: number;
  dailyAvg30: number;
  salesBasis: '7d' | '30d' | null;
  daysLeft: number | null;
  oosOptions: number;         // 재고0 + 매출>0 인 옵션 수
  noSalesOptions: number;     // 재고0 + 매출0 인 옵션 수 (판매 중지)
  primarySkuCode: string | null;
  primarySkuStock: number;
  nonPrimarySkuStock: number;
  inboundShippedQty: number;  // 등록된 이관 중 물량
  inboundDeadline: string | null;
}

export default async function InventoryPage() {
  const thirtyDaysAgo = nDaysAgoKST(30);
  const sevenDaysAgo = nDaysAgoKST(7);
  const yesterdayStr = nDaysAgoKST(1);

  const [{ data: coupangRows }, { data: salesMapping }, { data: ezadminRows }, { data: snapshots }, poResult, ltResult, invThreshResult, noticesResult, skuClassResult, { data: rawSales30d }, { data: rawSales7d }, primarySkusResult, { data: inboundRows }] = await Promise.all([
    supabaseAdmin
      .from('inventory_coupang')
      .select('vendor_item_id, total_orderable_quantity, sales_count_last_thirty_days, snapshot_at')
      .order('total_orderable_quantity', { ascending: false }),
    supabaseAdmin
      .from('sales_coupang')
      .select('vendor_item_id, product_name')
      .eq('brand', 'HEEDA')
      .eq('country', 'KR')
      .order('sale_date', { ascending: false })
      .limit(5000),
    supabaseAdmin
      .from('ezadmin_inventory')
      .select('product_code, product_name, normal_stock, defective_stock, available_stock, shipping, incoming, updated_at')
      .order('available_stock', { ascending: false }),
    supabaseAdmin
      .from('inventory_snapshots_coupang')
      .select('snapshot_date, product, stock_total, ezadmin_total')
      .gte('snapshot_date', nDaysAgoKST(90))
      .order('snapshot_date', { ascending: true }),
    Promise.resolve(
      supabaseAdmin
        .from('purchase_orders')
        .select('*, purchase_order_items(*)')
        .order('created_at', { ascending: false })
    ).catch(() => ({ data: null, error: null })),
    Promise.resolve(
      supabaseAdmin
        .from('inf_settings')
        .select('value')
        .eq('key', 'commerce:lead_times')
        .maybeSingle()
    ).catch(() => ({ data: null, error: null })),
    Promise.resolve(
      supabaseAdmin
        .from('inf_settings')
        .select('value')
        .eq('key', 'commerce:inventory_thresholds')
        .maybeSingle()
    ).catch(() => ({ data: null, error: null })),
    Promise.resolve(
      supabaseAdmin
        .from('inf_settings')
        .select('value')
        .eq('key', 'commerce:product_notices')
        .maybeSingle()
    ).catch(() => ({ data: null, error: null })),
    Promise.resolve(
      supabaseAdmin
        .from('inf_settings')
        .select('value')
        .eq('key', 'commerce:sku_classifications')
        .maybeSingle()
    ).catch(() => ({ data: null, error: null })),
    // Actual 30-day sales per VID (consistent with home page)
    supabaseAdmin
      .from('sales_coupang')
      .select('vendor_item_id, quantity, sale_type')
      .eq('brand', 'HEEDA')
      .eq('country', 'KR')
      .gte('sale_date', thirtyDaysAgo)
      .lte('sale_date', yesterdayStr),
    // 7-day sales per VID
    supabaseAdmin
      .from('sales_coupang')
      .select('vendor_item_id, quantity, sale_type')
      .eq('brand', 'HEEDA')
      .eq('country', 'KR')
      .gte('sale_date', sevenDaysAgo)
      .lte('sale_date', yesterdayStr),
    // Primary SKU settings
    Promise.resolve(
      supabaseAdmin
        .from('inf_settings')
        .select('value')
        .eq('key', 'commerce:primary_skus')
        .maybeSingle()
    ).catch(() => ({ data: null, error: null })),
    // Active inbound requests (server-side)
    supabaseAdmin
      .from('rg_inbound_requests')
      .select('id, product, option, quantity, status, shipped_at, tracking_entered_at, ea_ordered_at, coupang_deadline, arrived_at')
      .not('status', 'in', '("cancelled","rejected")'),
  ]);

  // Compute actual 30-day sales per VID (consistent with home page)
  const sales30dByVid = new Map<string, number>();
  for (const row of (rawSales30d ?? []) as any[]) {
    if (row.sale_type !== 'SALE') continue;
    const vid = String(row.vendor_item_id);
    const qty = Number(row.quantity) || 0;
    sales30dByVid.set(vid, (sales30dByVid.get(vid) ?? 0) + qty);
  }

  // Compute 7-day sales per VID
  const sales7dByVid = new Map<string, number>();
  for (const row of (rawSales7d ?? []) as any[]) {
    if (row.sale_type !== 'SALE') continue;
    const vid = String(row.vendor_item_id);
    const qty = Number(row.quantity) || 0;
    sales7dByVid.set(vid, (sales7dByVid.get(vid) ?? 0) + qty);
  }

  const purchaseOrders: PurchaseOrder[] = (poResult as any)?.data ?? [];
  const leadTimes = (ltResult as any)?.data?.value as { production: number; transfer: number } | null;
  const inventoryThresholds = (invThreshResult as any)?.data?.value as {
    transferSafetyDays: number; transferTargetDays: number;
    orderTargetDays: number; transferLeadTime: number; productionLeadTime: number;
  } | null;
  const productNotices = ((noticesResult as any)?.data?.value as Record<string, { type: string; message: string; resumeDate?: string }>) ?? {};
  const skuClassifications = ((skuClassResult as any)?.data?.value as Record<string, SkuClassification>) ?? {};
  const primarySkus: Record<string, string> = ((primarySkusResult as any)?.data?.value as Record<string, string>) ?? {
    '클렌징밤': '18396', '클렌징폼': '18279', '세럼': '18919',
  };
  const serverInboundRequests = (inboundRows ?? []) as any[];

  // Product name fallback from sales
  const productNameMap = new Map<string, string>();
  for (const row of salesMapping ?? []) {
    if (row.vendor_item_id && row.product_name && !productNameMap.has(String(row.vendor_item_id))) {
      productNameMap.set(String(row.vendor_item_id), row.product_name);
    }
  }

  // Build Rocket Growth items — use actual sales, apply unitCount for set multiplication
  const rocketItems: RocketItem[] = (coupangRows ?? []).map((row: any) => {
    const vid = String(row.vendor_item_id);
    const rawName = productNameMap.get(vid) ?? '';
    const mapped = resolveCoupangProduct(vid);
    const qty = row.total_orderable_quantity ?? 0;
    const unitCount = mapped?.unitCount ?? 1;
    const unitStock = qty * unitCount;
    const sales30 = sales30dByVid.get(vid) ?? (row.sales_count_last_thirty_days ?? 0);
    const sales7 = sales7dByVid.get(vid) ?? 0;
    // Unit-level sales (세트 판매 × 낱개 수)
    const unitSales7 = sales7 * unitCount;
    const unitSales30 = sales30 * unitCount;
    const dailyAvg7 = Math.round((unitSales7 / 7) * 10) / 10;
    const dailyAvg30 = Math.round((unitSales30 / 30) * 10) / 10;
    const salesBasis: '7d' | '30d' | null = dailyAvg7 > 0 ? '7d' : dailyAvg30 > 0 ? '30d' : null;
    const dailyAvg = dailyAvg7 || dailyAvg30;
    const daysLeft = dailyAvg > 0 ? Math.round(unitStock / dailyAvg) : null;

    return {
      product: mapped?.product ?? '분류 필요',
      option: mapped?.option ?? (rawName || `SKU ${vid}`),
      spec: mapped?.spec ?? '',
      vendorItemId: vid,
      stock: qty,
      unitCount,
      unitStock,
      sales30d: sales30,
      sales7d: sales7,
      dailyAvg,
      dailyAvg7,
      dailyAvg30,
      salesBasis,
      daysLeft,
      snapshotAt: row.snapshot_at,
    };
  }).sort((a, b) => {
    const pk = productSortKey(a.product) - productSortKey(b.product);
    if (pk !== 0) return pk;
    return b.unitStock - a.unitStock;
  });

  // Build EZAdmin items — include ALL HEEDA products (mapped + unmapped, exclude non-HEEDA)
  // Use SKU classification settings to override default product-map entries
  const ezadminItems: EzadminItem[] = (ezadminRows ?? [])
    .map((row: any) => {
      const code = String(row.product_code);
      // Skip non-HEEDA brands
      if (EZADMIN_EXCLUDE.has(code)) return null;

      const mapped = resolveEzadminProduct(code, skuClassifications);
      const variantType: EzadminVariant = mapped?.variantType ?? (mapped?.variant === '수출용' ? 'export' : 'domestic');
      return {
        product: mapped?.product ?? '미매핑',
        option: mapped?.option ?? (row.product_name || code),
        spec: mapped?.spec ?? '',
        productCode: code,
        productName: row.product_name ?? '',
        availableStock: row.available_stock ?? 0,
        normalStock: row.normal_stock ?? 0,
        defectiveStock: row.defective_stock ?? 0,
        shipping: row.shipping ?? 0,
        incoming: row.incoming ?? 0,
        updatedAt: row.updated_at,
        variant: variantType === 'export' ? 'export' as const : 'domestic' as const,
        variantType,
        stockType: mapped?.stockType === '부자재' ? 'submaterial' as const : 'finished' as const,
        note: mapped?.note ?? '',
        mapped: !!mapped,
      };
    })
    .filter((item): item is EzadminItem => item !== null)
    .sort((a, b) => {
      const pk = productSortKey(a.product) - productSortKey(b.product);
      if (pk !== 0) return pk;
      // finished before submaterial
      if (a.stockType !== b.stockType) return a.stockType === 'finished' ? -1 : 1;
      return b.availableStock - a.availableStock;
    });

  // Summaries (use unitStock for totals)
  const rocketTotal = rocketItems.reduce((s, i) => s + i.unitStock, 0);
  const rocketInStock = rocketItems.filter(i => i.stock > 0).length;
  const rocketOOS = rocketItems.filter(i => i.stock === 0 && i.sales30d > 0).length;

  // EZAdmin totals — separate domestic finished vs all
  const ezadminTotal = ezadminItems.filter(i => i.mapped).reduce((s, i) => s + i.availableStock, 0);
  const ezadminDomesticTotal = ezadminItems.filter(i => i.mapped && i.variant === 'domestic' && i.stockType === 'finished').reduce((s, i) => s + i.availableStock, 0);
  const ezadminInStock = ezadminItems.filter(i => i.mapped && i.availableStock > 0).length;
  const ezadminOOS = ezadminItems.filter(i => i.mapped && i.availableStock === 0).length;

  // Build alerts: Rocket items with <30 days
  const alerts: AlertItem[] = rocketItems
    .filter(i => i.daysLeft !== null && i.daysLeft <= 30 && i.stock > 0)
    .map(i => ({
      product: i.product,
      option: i.option,
      stock: i.stock,
      dailyAvg: i.dailyAvg,
      daysLeft: i.daysLeft!,
      location: '로켓그로스',
    }))
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 5);

  // Build snapshot data for trend view
  const snapshotData = (snapshots ?? []).map((s: any) => ({
    date: s.snapshot_date,
    product: s.product,
    rocketStock: s.stock_total,
    ezadminStock: s.ezadmin_total,
  }));

  // Incoming quantities by product from active purchase orders
  const todayStr = (() => {
    const kst = new Date(Date.now() + 9 * 3_600_000);
    return kst.toISOString().slice(0, 10);
  })();
  const incomingByProduct = new Map<string, { rocket: number; ezadmin: number }>();
  for (const po of purchaseOrders) {
    if (po.status !== 'ordered') continue;
    if (po.expected_at && po.expected_at < todayStr) continue;
    for (const item of po.purchase_order_items) {
      const remaining = item.quantity - item.arrived_quantity;
      if (remaining <= 0) continue;
      const existing = incomingByProduct.get(item.product) ?? { rocket: 0, ezadmin: 0 };
      if (po.destination === 'rocketgrowth') existing.rocket += remaining;
      else if (po.destination === 'easyadmin') existing.ezadmin += remaining;
      incomingByProduct.set(item.product, existing);
    }
  }

  const incomingMap: Record<string, { rocket: number; ezadmin: number }> = {};
  for (const [product, qty] of incomingByProduct) {
    incomingMap[product] = qty;
  }

  // Build per-product summary cards
  // Aggregate rocket stock by product (낱개 환산)
  const rocketByProduct = new Map<string, { stock: number; dailyAvg: number; dailyAvg7: number; dailyAvg30: number; salesBasis: '7d' | '30d' | null; oosCount: number; noSalesCount: number }>();
  for (const item of rocketItems) {
    if (item.product === '분류 필요') continue;
    const existing = rocketByProduct.get(item.product) ?? { stock: 0, dailyAvg: 0, dailyAvg7: 0, dailyAvg30: 0, salesBasis: null as '7d' | '30d' | null, oosCount: 0, noSalesCount: 0 };
    existing.stock += item.unitStock;  // 낱개 환산 합계
    existing.dailyAvg += item.dailyAvg;
    existing.dailyAvg7 += item.dailyAvg7;
    existing.dailyAvg30 += item.dailyAvg30;
    if (existing.dailyAvg7 > 0) existing.salesBasis = '7d';
    else if (existing.dailyAvg30 > 0) existing.salesBasis = '30d';
    // P0-C: 품절 = 재고 0 AND 매출 > 0 (진짜 품절)
    if (item.stock === 0 && item.sales30d > 0) existing.oosCount++;
    // 재고 0 AND 매출 0 = 판매 중지 (경고 아님)
    if (item.stock === 0 && item.sales30d === 0) existing.noSalesCount++;
    rocketByProduct.set(item.product, existing);
  }

  // Aggregate ezadmin finished stock by product and variant type
  const ezadminByProduct = new Map<string, { total: number; domestic: number; japan: number; export: number; shippingDomestic: number; exportWorkable: number }>();
  for (const item of ezadminItems) {
    if (!item.mapped || !isMainProduct(item.product)) continue;
    const existing = ezadminByProduct.get(item.product) ?? { total: 0, domestic: 0, japan: 0, export: 0, shippingDomestic: 0, exportWorkable: 0 };
    if (item.stockType === 'finished') {
      existing.total += item.availableStock;
      if (item.variantType === 'domestic') {
        existing.domestic += item.availableStock;
        existing.shippingDomestic += item.shipping;
      } else if (item.variantType === 'japan') {
        existing.japan += item.availableStock;
      } else if (item.variantType === 'export') {
        existing.export += item.availableStock;
      }
    } else if (item.stockType === 'submaterial' && (item.variantType === 'export' || item.variantType === 'japan')) {
      // Submaterial export/japan = sticker work queue, convertible stock
      existing.exportWorkable += item.availableStock;
    }
    ezadminByProduct.set(item.product, existing);
  }

  // Build inbound shipped qty/deadline by product
  const inboundShippedByProduct = new Map<string, { qty: number; deadline: string | null }>();
  for (const req of serverInboundRequests) {
    if (req.status === 'shipped' || (req.status === 'ea_ordered' && req.shipped_at)) {
      const p = req.product as string;
      const existing = inboundShippedByProduct.get(p) ?? { qty: 0, deadline: null };
      existing.qty += (req.quantity ?? 0);
      if (req.coupang_deadline) {
        if (!existing.deadline || req.coupang_deadline < existing.deadline) {
          existing.deadline = req.coupang_deadline;
        }
      }
      inboundShippedByProduct.set(p, existing);
    }
  }

  // Build primary SKU stock by product
  const primarySkuStockByProduct = new Map<string, { primary: number; nonPrimary: number }>();
  for (const item of ezadminItems) {
    if (!item.mapped || !isMainProduct(item.product) || item.stockType !== 'finished') continue;
    const psku = primarySkus[item.product];
    const existing = primarySkuStockByProduct.get(item.product) ?? { primary: 0, nonPrimary: 0 };
    if (psku && item.productCode === psku) {
      existing.primary += item.availableStock;
    } else {
      existing.nonPrimary += item.availableStock;
    }
    primarySkuStockByProduct.set(item.product, existing);
  }

  const productSummaries: ProductSummary[] = ['클렌징밤', '클렌징폼', '세럼'].map(product => {
    const rocket = rocketByProduct.get(product) ?? { stock: 0, dailyAvg: 0, dailyAvg7: 0, dailyAvg30: 0, salesBasis: null as '7d' | '30d' | null, oosCount: 0, noSalesCount: 0 };
    const ezadmin = ezadminByProduct.get(product) ?? { total: 0, domestic: 0, japan: 0, export: 0, shippingDomestic: 0, exportWorkable: 0 };
    const inc = incomingMap[product] ?? { rocket: 0, ezadmin: 0 };
    const incomingTotal = inc.rocket + inc.ezadmin;
    const poTransferIncoming = incomingByProduct.get(product)?.rocket ?? 0;
    const shippingFromEzadmin = ezadmin.shippingDomestic;
    const effectiveShipping = shippingFromEzadmin;
    const effectiveIncoming = poTransferIncoming > 0 && shippingFromEzadmin > 0
      ? inc.ezadmin
      : incomingTotal;
    const availableStock = rocket.stock + ezadmin.domestic + effectiveShipping + effectiveIncoming;
    const daysLeft = rocket.dailyAvg > 0 ? Math.round(availableStock / rocket.dailyAvg) : null;
    const spec = product === '클렌징밤' ? '100ml' : product === '클렌징폼' ? '150ml' : '30ml';
    const inboundData = inboundShippedByProduct.get(product);
    const pSkuData = primarySkuStockByProduct.get(product);

    return {
      product,
      spec,
      color: PRODUCT_COLORS[product] ?? '#9AA2AA',
      rocketStock: rocket.stock,
      ezadminTotal: ezadmin.total,
      ezadminDomestic: ezadmin.domestic,
      ezadminJapan: ezadmin.japan,
      ezadminExport: ezadmin.export,
      ezadminExportWorkable: ezadmin.exportWorkable,
      shippingQty: ezadmin.shippingDomestic,
      incomingQty: effectiveIncoming,
      availableStock,
      dailyAvg: rocket.dailyAvg,
      dailyAvg7: rocket.dailyAvg7,
      dailyAvg30: rocket.dailyAvg30,
      salesBasis: rocket.salesBasis,
      daysLeft,
      oosOptions: rocket.oosCount,
      noSalesOptions: rocket.noSalesCount,
      primarySkuCode: primarySkus[product] ?? null,
      primarySkuStock: pSkuData?.primary ?? 0,
      nonPrimarySkuStock: pSkuData?.nonPrimary ?? 0,
      inboundShippedQty: inboundData?.qty ?? 0,
      inboundDeadline: inboundData?.deadline ?? null,
    };
  });

  return (
    <InventoryClient
      rocketItems={rocketItems}
      ezadminItems={ezadminItems}
      alerts={alerts}
      snapshots={snapshotData}
      purchaseOrders={purchaseOrders}
      incomingMap={incomingMap}
      leadTimes={leadTimes ?? { production: 14, transfer: 7 }}
      inventoryThresholds={{
        transferSafetyDays: inventoryThresholds?.transferSafetyDays ?? 10,
        transferTargetDays: inventoryThresholds?.transferTargetDays ?? 30,
        orderTargetDays: inventoryThresholds?.orderTargetDays ?? 90,
        transferLeadTime: inventoryThresholds?.transferLeadTime ?? (leadTimes?.transfer ?? 7),
        productionLeadTime: inventoryThresholds?.productionLeadTime ?? (leadTimes?.production ?? 14),
      }}
      productNotices={productNotices}
      productSummaries={productSummaries}
      serverInboundRequests={serverInboundRequests}
      primarySkus={primarySkus}
      summary={{
        rocketTotal,
        rocketInStock,
        rocketOOS,
        rocketCount: rocketItems.length,
        ezadminTotal,
        ezadminDomesticTotal,
        ezadminInStock,
        ezadminOOS,
        ezadminCount: ezadminItems.filter(i => i.mapped).length,
      }}
    />
  );
}
