export const dynamic = 'force-dynamic';

import { supabaseAdmin } from '@/lib/supabase-server';
import {
  resolveCoupangProduct,
  resolveEzadminProduct,
  productSortKey,
  PRODUCT_ORDER,
  EZADMIN_EXCLUDE,
} from '@/lib/product-map';
import { getDaysAgo } from '@/lib/helpers';
import ProductsClient from './ProductsClient';

/* ------------------------------------------------------------------ */
/*  Status logic                                                       */
/* ------------------------------------------------------------------ */

import {
  calcStockStatus as calcStockStatusShared,
  type StockStatus as SharedStockStatus,
} from '@/lib/stock-status';

type StockStatus = SharedStockStatus | 'unmapped' | 'not_linked';

function calcStatus(
  stock: number,
  sales30d: number,
  daysLeft: number | null,
): StockStatus {
  return calcStockStatusShared(stock, sales30d, daysLeft);
}

/* ------------------------------------------------------------------ */
/*  DB row types                                                       */
/* ------------------------------------------------------------------ */

interface InventoryRow {
  vendor_item_id: string;
  total_orderable_quantity: number;
  sales_count_last_thirty_days: number;
}

interface EzadminRow {
  product_code: string;
  product_name: string;
  available_stock: number;
  updated_at: string;
}

interface SalesVidRow {
  vendor_item_id: number;
  product_name: string;
}

/* ------------------------------------------------------------------ */
/*  Output types                                                       */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Internal aggregation                                               */
/* ------------------------------------------------------------------ */

interface OptionAgg {
  option: string;
  unitCount: number;
  rocketStock: number;
  rocketSales30d: number;
}

interface ProductAgg {
  product: string;
  spec: string;
  optionMap: Map<string, OptionAgg>;
  ezadminStock: number;
  hasExportOnly: boolean;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const productFilter = params.product;

  // Sales query: only need distinct VIDs from last 30 days for unmapped detection
  const salesCutoff = getDaysAgo(29);

  const kst = new Date(Date.now() + 9 * 3_600_000);
  kst.setUTCDate(kst.getUTCDate() - 1);
  const yesterdayStr = kst.toISOString().slice(0, 10);

  // --- Four parallel queries ---
  const [{ data: inventoryRows }, { data: ezadminRows }, { data: salesRows }, { data: rawSales30d }] =
    await Promise.all([
      supabaseAdmin
        .from('inventory_coupang')
        .select(
          'vendor_item_id, total_orderable_quantity, sales_count_last_thirty_days',
        ),
      supabaseAdmin
        .from('ezadmin_inventory')
        .select('product_code, product_name, available_stock, updated_at'),
      supabaseAdmin
        .from('sales_coupang')
        .select('vendor_item_id, product_name')
        .eq('brand', 'HEEDA')
        .eq('country', 'KR')
        .eq('sale_type', 'SALE')
        .gte('sale_date', salesCutoff),
      supabaseAdmin
        .from('sales_coupang')
        .select('vendor_item_id, quantity, sale_type')
        .eq('brand', 'HEEDA')
        .eq('country', 'KR')
        .gte('sale_date', getDaysAgo(29))
        .lte('sale_date', yesterdayStr),
    ]);

  /* ========== Step 1: Build set of VIDs with recent sales ========== */

  const salesVidSet = new Set<string>();
  const nameFromSales = new Map<string, string>();

  for (const row of (salesRows ?? []) as SalesVidRow[]) {
    const vid = String(row.vendor_item_id);
    salesVidSet.add(vid);
    if (row.product_name) nameFromSales.set(vid, row.product_name);
  }

  // Build per-VID actual sales count for last 30 days
  const sales30dByVid = new Map<string, number>();
  for (const row of (rawSales30d ?? []) as any[]) {
    if (row.sale_type !== 'SALE') continue;
    const vid = String(row.vendor_item_id);
    const qty = Number(row.quantity) || 0;
    sales30dByVid.set(vid, (sales30dByVid.get(vid) ?? 0) + qty);
  }

  /* ========== Step 2: Build per-product / per-option from inventory ========== */
  //
  // CRITICAL: Merge duplicate VIDs that map to the same option name.
  //   e.g. 3 VIDs all map to "클렌징밤 단품" → sum their stocks/sales30d
  //
  // CRITICAL: Option-level depletion — each option's stock / each option's daily avg.
  //   NEVER aggregate stock across options for depletion.

  const productAggMap = new Map<string, ProductAgg>();
  const unmappedSkus: UnmappedSku[] = [];
  const processedVids = new Set<string>();

  for (const inv of (inventoryRows ?? []) as InventoryRow[]) {
    const vid = String(inv.vendor_item_id);
    processedVids.add(vid);

    const resolved = resolveCoupangProduct(vid);

    if (!resolved) {
      unmappedSkus.push({
        vendorItemId: vid,
        rawName: nameFromSales.get(vid) || vid,
        stock: inv.total_orderable_quantity ?? 0,
        sales30d: sales30dByVid.get(vid) ?? 0,
        hasSales: salesVidSet.has(vid),
      });
      continue;
    }

    const { product, spec, option, unitCount } = resolved;
    const key = `${product}__${spec}`;

    if (!productAggMap.has(key)) {
      productAggMap.set(key, {
        product,
        spec,
        optionMap: new Map(),
        ezadminStock: 0,
        hasExportOnly: false,
      });
    }

    const agg = productAggMap.get(key)!;
    const stock = inv.total_orderable_quantity ?? 0;
    const sales30d = sales30dByVid.get(vid) ?? 0;

    // Merge by option name: sum stocks and sales30d
    const existing = agg.optionMap.get(option);
    if (existing) {
      existing.rocketStock += stock;
      existing.rocketSales30d += sales30d;
    } else {
      agg.optionMap.set(option, {
        option,
        unitCount,
        rocketStock: stock,
        rocketSales30d: sales30d,
      });
    }
  }

  /* ========== Step 3: Sales-only VIDs not in inventory (unmapped detection) ========== */

  for (const vid of salesVidSet) {
    if (processedVids.has(vid)) continue;
    // Mapped product with sales but no inventory row — skip (not "unmapped")
    const resolved = resolveCoupangProduct(vid);
    if (resolved) continue;

    unmappedSkus.push({
      vendorItemId: vid,
      rawName: nameFromSales.get(vid) || vid,
      stock: 0,
      sales30d: 0,
      hasSales: true,
    });
  }

  /* ========== Step 4: EZAdmin 3PL stock ========== */

  let ezadminTotal = 0;
  let ezadminMapped = 0;
  let ezadminUnmapped = 0;
  let ezadminSuppliesTotal = 0;
  const ezadminByProduct = new Map<string, { domestic: number; export: number }>();
  let ezadminUpdatedAt = '';

  // Raw EZAdmin items for mapping status table
  interface EzMappingItem {
    productCode: string;
    productName: string;
    availableStock: number;
    mappedProduct: string | null;
    mappedOption: string | null;
    stockType: '완제품' | '부자재' | null;
  }
  const ezadminMappingItems: EzMappingItem[] = [];

  for (const row of (ezadminRows ?? []) as EzadminRow[]) {
    if (EZADMIN_EXCLUDE.has(row.product_code)) continue;

    const stock = row.available_stock ?? 0;
    ezadminTotal += stock;

    if (row.updated_at && row.updated_at > ezadminUpdatedAt) {
      ezadminUpdatedAt = row.updated_at;
    }

    const mapped = resolveEzadminProduct(row.product_code);

    ezadminMappingItems.push({
      productCode: row.product_code,
      productName: row.product_name,
      availableStock: stock,
      mappedProduct: mapped?.product ?? null,
      mappedOption: mapped?.option ?? null,
      stockType: mapped?.stockType ?? null,
    });

    if (!mapped) {
      ezadminUnmapped += stock;
      continue;
    }

    if (mapped.stockType === '부자재') {
      ezadminSuppliesTotal += stock;
      continue;
    }

    ezadminMapped += stock;

    const existing = ezadminByProduct.get(mapped.product) ?? { domestic: 0, export: 0 };
    if (mapped.variant === '수출용') {
      existing.export += stock;
    } else {
      existing.domestic += stock;
    }
    ezadminByProduct.set(mapped.product, existing);
  }

  const ezadminIntegrityOk = (ezadminMapped + ezadminUnmapped + ezadminSuppliesTotal) === ezadminTotal;

  for (const agg of productAggMap.values()) {
    const detail = ezadminByProduct.get(agg.product) ?? { domestic: 0, export: 0 };
    agg.ezadminStock = detail.domestic + detail.export;
    agg.hasExportOnly = false; // no longer needed, all variants are mapped
  }

  /* ========== Step 5: Ensure all PRODUCT_ORDER entries exist ========== */

  const defaultSpecs: Record<string, string> = {
    클렌징밤: '100ml',
    클렌징폼: '150ml',
    세럼: '30ml',
  };
  const existingProducts = new Set(
    Array.from(productAggMap.values()).map((a) => a.product),
  );

  for (const pName of PRODUCT_ORDER) {
    if (existingProducts.has(pName)) continue;
    const spec = defaultSpecs[pName] ?? '';
    productAggMap.set(`${pName}__${spec}`, {
      product: pName,
      spec,
      optionMap: new Map(),
      ezadminStock: (() => {
        const d = ezadminByProduct.get(pName);
        return d ? d.domestic + d.export : 0;
      })(),
      hasExportOnly: false,
    });
  }

  /* ========== Step 6: Finalize options + build serializable output ========== */

  const products: ProductData[] = [];

  for (const agg of productAggMap.values()) {
    const options: OptionData[] = [];
    let rocketStockTotal = 0;
    let rocketStockTotalUnits = 0;
    let earliestDepletion: ProductData['earliestDepletion'] = null;

    for (const optAgg of agg.optionMap.values()) {
      const dailyAvg = optAgg.rocketSales30d / 30;
      const daysLeft =
        optAgg.rocketStock > 0 && dailyAvg > 0
          ? Math.floor(optAgg.rocketStock / dailyAvg)
          : null;

      const status = calcStatus(
        optAgg.rocketStock,
        optAgg.rocketSales30d,
        daysLeft,
      );

      const rocketStockUnits = optAgg.rocketStock * optAgg.unitCount;
      const dailyAvgUnits =
        Math.round(dailyAvg * optAgg.unitCount * 10) / 10;

      const opt: OptionData = {
        option: optAgg.option,
        unitCount: optAgg.unitCount,
        rocketStock: optAgg.rocketStock,
        rocketStockUnits,
        rocketSales30d: optAgg.rocketSales30d,
        rocketDailyAvg: Math.round(dailyAvg * 10) / 10,
        rocketDailyAvgUnits: dailyAvgUnits,
        rocketDaysLeft: daysLeft,
        status,
      };

      options.push(opt);
      rocketStockTotal += optAgg.rocketStock;
      rocketStockTotalUnits += rocketStockUnits;

      // Earliest depletion: min(daysLeft) among options with stock > 0 and sales > 0
      if (
        optAgg.rocketStock > 0 &&
        optAgg.rocketSales30d > 0 &&
        daysLeft !== null
      ) {
        if (!earliestDepletion || daysLeft < earliestDepletion.daysLeft) {
          earliestDepletion = {
            option: optAgg.option,
            daysLeft,
            stock: optAgg.rocketStock,
            stockUnits: rocketStockUnits,
          };
        }
      }
    }

    // Sort options: OOS first, then by daysLeft ascending, no-sales last
    options.sort((a, b) => {
      if (a.rocketStock === 0 && b.rocketStock !== 0) return -1;
      if (a.rocketStock !== 0 && b.rocketStock === 0) return 1;
      if (a.rocketDaysLeft === null && b.rocketDaysLeft === null) return 0;
      if (a.rocketDaysLeft === null) return 1;
      if (b.rocketDaysLeft === null) return -1;
      return a.rocketDaysLeft - b.rocketDaysLeft;
    });

    products.push({
      product: agg.product,
      spec: agg.spec,
      rocketStockTotal,
      rocketStockTotalUnits,
      ezadminStock: agg.ezadminStock,
      hasExportOnly: agg.hasExportOnly,
      earliestDepletion,
      options,
    });
  }

  // Sort products by PRODUCT_ORDER
  products.sort(
    (a, b) => productSortKey(a.product) - productSortKey(b.product),
  );

  // Optional product filter from searchParams
  const filtered = productFilter
    ? products.filter((p) => p.product === productFilter)
    : products;

  /* ========== Render ========== */

  return (
    <ProductsClient
      products={filtered}
      unmappedSkus={unmappedSkus}
      ezadminTotal={ezadminTotal}
      ezadminMapped={ezadminMapped}
      ezadminUnmapped={ezadminUnmapped}
      ezadminSupplies={ezadminSuppliesTotal}
      ezadminUpdatedAt={ezadminUpdatedAt}
      ezadminIntegrityOk={ezadminIntegrityOk}
      ezadminMappingItems={ezadminMappingItems}
    />
  );
}
