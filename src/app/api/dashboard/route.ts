import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { format, startOfMonth, subMonths } from 'date-fns';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const now = new Date();
    const today = format(now, 'yyyy-MM-dd');
    const thisMonthStart = format(startOfMonth(now), 'yyyy-MM-dd');
    const lastMonthStart = format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd');
    const lastMonthEnd = format(
      new Date(startOfMonth(now).getTime() - 1),
      'yyyy-MM-dd',
    );

    // Parallelize all independent DB queries
    const [
      { data: todaySalesRows },
      { data: thisMonthRows },
      { data: lastMonthRows },
      { data: recentSettlements },
      { data: lowStockRows },
    ] = await Promise.all([
      // a) Today's sales (HEEDA + SUPERLABS)
      supabaseAdmin
        .from('sales_coupang')
        .select('order_id, sale_amount, settlement_amount, sale_type, quantity, brand')
        .in('brand', ['HEEDA', 'SUPERLABS'])
        .eq('country', 'KR')
        .eq('sale_date', today),
      // b) This month's sales (HEEDA + SUPERLABS)
      supabaseAdmin
        .from('sales_coupang')
        .select('order_id, sale_amount, settlement_amount, sale_type, quantity, product_name, vendor_item_id, brand')
        .in('brand', ['HEEDA', 'SUPERLABS'])
        .eq('country', 'KR')
        .gte('sale_date', thisMonthStart)
        .lte('sale_date', today),
      // c) Last month's sales (HEEDA + SUPERLABS)
      supabaseAdmin
        .from('sales_coupang')
        .select('order_id, sale_amount, settlement_amount, sale_type, quantity, brand')
        .in('brand', ['HEEDA', 'SUPERLABS'])
        .eq('country', 'KR')
        .gte('sale_date', lastMonthStart)
        .lte('sale_date', lastMonthEnd),
      // e) Recent settlements
      supabaseAdmin
        .from('settlements_coupang')
        .select('vendor_id, revenue_recognition_year_month, settlement_date, settlement_type, status, final_amount, settlement_amount')
        .order('settlement_date', { ascending: false })
        .limit(5),
      // f) Low stock items
      supabaseAdmin
        .from('inventory_coupang')
        .select('vendor_id, vendor_item_id, total_orderable_quantity, sales_count_last_thirty_days')
        .lte('total_orderable_quantity', 10)
        .order('total_orderable_quantity', { ascending: true }),
    ]);

    // Process today's sales
    const todayOrderIds = new Set<string>();
    const todaySales = (todaySalesRows ?? []).reduce((acc, r: any) => {
      const sign = r.sale_type === 'SALE' ? 1 : -1;
      if (r.sale_type === 'SALE') todayOrderIds.add(String(r.order_id));
      return {
        sales: acc.sales + sign * (r.sale_amount ?? 0),
        orders: 0,
        settlement: acc.settlement + sign * (r.settlement_amount ?? 0),
        quantity: acc.quantity + sign * (r.quantity ?? 0),
      };
    }, { sales: 0, orders: 0, settlement: 0, quantity: 0 });
    todaySales.orders = todayOrderIds.size;

    // Process this month's sales
    const thisMonthOrderIds = new Set<string>();
    const thisMonthSales = (thisMonthRows ?? []).reduce((acc, r: any) => {
      const sign = r.sale_type === 'SALE' ? 1 : -1;
      if (r.sale_type === 'SALE') thisMonthOrderIds.add(String(r.order_id));
      return {
        sales: acc.sales + sign * (r.sale_amount ?? 0),
        orders: 0,
        settlement: acc.settlement + sign * (r.settlement_amount ?? 0),
        quantity: acc.quantity + sign * (r.quantity ?? 0),
      };
    }, { sales: 0, orders: 0, settlement: 0, quantity: 0 });
    thisMonthSales.orders = thisMonthOrderIds.size;

    // Process last month's sales
    const lastMonthOrderIds = new Set<string>();
    const lastMonthSales = (lastMonthRows ?? []).reduce((acc, r: any) => {
      const sign = r.sale_type === 'SALE' ? 1 : -1;
      if (r.sale_type === 'SALE') lastMonthOrderIds.add(String(r.order_id));
      return {
        sales: acc.sales + sign * (r.sale_amount ?? 0),
        orders: 0,
        settlement: acc.settlement + sign * (r.settlement_amount ?? 0),
        quantity: acc.quantity + sign * (r.quantity ?? 0),
      };
    }, { sales: 0, orders: 0, settlement: 0, quantity: 0 });
    lastMonthSales.orders = lastMonthOrderIds.size;

    // d) Top 5 products this month
    const productMap = new Map<string, { product_name: string; sale_amount: number; quantity: number }>();
    for (const row of (thisMonthRows ?? []) as any[]) {
      const key = row.vendor_item_id ?? row.product_name ?? 'unknown';
      const name = row.product_name ?? 'Unknown';
      const sign = row.sale_type === 'SALE' ? 1 : -1;
      if (!productMap.has(key)) {
        productMap.set(key, { product_name: name, sale_amount: 0, quantity: 0 });
      }
      const entry = productMap.get(key)!;
      entry.sale_amount += sign * (row.sale_amount ?? 0);
      entry.quantity += sign * (row.quantity ?? 0);
    }
    const topProducts = Array.from(productMap.values())
      .sort((a, b) => b.sale_amount - a.sale_amount)
      .slice(0, 5);

    // Enrich low stock with product names
    const lowStockItemIds = (lowStockRows ?? []).map((r: any) => String(r.vendor_item_id)).filter(Boolean);
    let lowStockEnriched = lowStockRows ?? [];

    if (lowStockItemIds.length > 0) {
      const { data: namesData } = await supabaseAdmin
        .from('sales_coupang')
        .select('vendor_item_id, product_name')
        .in('vendor_item_id', lowStockItemIds);

      const nameMap = new Map<string, string>();
      for (const r of (namesData ?? []) as any[]) {
        if (r.vendor_item_id && r.product_name && !nameMap.has(String(r.vendor_item_id))) {
          nameMap.set(String(r.vendor_item_id), r.product_name);
        }
      }

      lowStockEnriched = (lowStockRows ?? []).map((row: any) => ({
        ...row,
        product_name: nameMap.get(String(row.vendor_item_id)) ?? null,
      }));
    }

    // Calculate month-over-month change
    const momChange = lastMonthSales.sales !== 0
      ? Math.round(((thisMonthSales.sales - lastMonthSales.sales) / Math.abs(lastMonthSales.sales)) * 10000) / 100
      : null;

    return NextResponse.json({
      today: todaySales,
      this_month: thisMonthSales,
      last_month: lastMonthSales,
      mom_change_percent: momChange,
      top_products: topProducts,
      recent_settlements: recentSettlements ?? [],
      low_stock_items: lowStockEnriched,
      generated_at: now.toISOString(),
    });
  } catch (err) {
    console.error('[API /dashboard] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
