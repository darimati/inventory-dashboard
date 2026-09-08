import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const groupBy = searchParams.get('group_by'); // day | week | month
    const product = searchParams.get('product');
    const brand = searchParams.get('brand') || 'HEEDA';
    const country = searchParams.get('country') || 'KR';

    let query = supabaseAdmin
      .from('sales_coupang')
      .select('order_id, vendor_item_id, sale_type, sale_date, brand, country, sale_amount, quantity, settlement_amount, product_name, updated_at')
      .eq('brand', brand)
      .eq('country', country);

    if (from) {
      query = query.gte('sale_date', from);
    }
    if (to) {
      query = query.lte('sale_date', to);
    }
    if (product) {
      query = query.ilike('product_name', `%${product}%`);
    }

    query = query.order('sale_date', { ascending: false });

    const { data: rows, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const data = rows ?? [];

    // Build summary from raw data (only count SALE type for positive metrics)
    const saleRows = data.filter((r) => r.sale_type === 'SALE');
    const cancelReturnRows = data.filter((r) => r.sale_type !== 'SALE');

    const totalSales = saleRows.reduce((sum, r) => sum + (r.sale_amount ?? 0), 0)
      - cancelReturnRows.reduce((sum, r) => sum + (r.sale_amount ?? 0), 0);
    const totalOrders = new Set(saleRows.map((r) => r.order_id)).size;
    const totalSettlement = saleRows.reduce((sum, r) => sum + (r.settlement_amount ?? 0), 0)
      - cancelReturnRows.reduce((sum, r) => sum + (r.settlement_amount ?? 0), 0);
    const avgOrderValue = totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0;

    const summary = {
      total_sales: totalSales,
      total_orders: totalOrders,
      total_settlement: totalSettlement,
      avg_order_value: avgOrderValue,
    };

    const result: Record<string, unknown> = { data, summary };

    // Aggregate by group_by if requested
    if (groupBy) {
      const bucketMap = new Map<string, { sales: number; orderIds: Set<string>; settlement: number }>();

      for (const row of data) {
        const saleDate = row.sale_date as string;
        if (!saleDate) continue;

        let key: string;
        if (groupBy === 'month') {
          key = saleDate.slice(0, 7); // YYYY-MM
        } else if (groupBy === 'week') {
          // ISO week: use the Monday of the week
          const d = new Date(saleDate);
          const day = d.getDay();
          const diff = d.getDate() - day + (day === 0 ? -6 : 1);
          const monday = new Date(d.setDate(diff));
          key = monday.toISOString().slice(0, 10);
        } else {
          // day
          key = saleDate.slice(0, 10);
        }

        if (!bucketMap.has(key)) {
          bucketMap.set(key, { sales: 0, orderIds: new Set(), settlement: 0 });
        }
        const bucket = bucketMap.get(key)!;
        const sign = row.sale_type === 'SALE' ? 1 : -1;
        bucket.sales += sign * (row.sale_amount ?? 0);
        if (row.sale_type === 'SALE') bucket.orderIds.add(String(row.order_id));
        bucket.settlement += sign * (row.settlement_amount ?? 0);
      }

      const daily = Array.from(bucketMap.entries())
        .map(([date, vals]) => ({ date, sales: vals.sales, orders: vals.orderIds.size, settlement: vals.settlement }))
        .sort((a, b) => a.date.localeCompare(b.date));

      result.daily = daily;
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[API /sales] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
