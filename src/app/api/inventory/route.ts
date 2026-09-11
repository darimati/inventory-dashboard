import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Parallel fetch: inventory rows + product name mapping
    const [{ data: inventoryRows, error: invError }, { data: salesMapping, error: salesError }] = await Promise.all([
      supabaseAdmin
        .from('inventory_coupang')
        .select('vendor_id, vendor_item_id, brand, country, total_orderable_quantity, sales_count_last_thirty_days, snapshot_at')
        .order('snapshot_at', { ascending: false }),
      supabaseAdmin
        .from('sales_coupang')
        .select('vendor_item_id, product_name')
        .eq('brand', 'HEEDA')
        .eq('country', 'KR')
        .order('sale_date', { ascending: false })
        .limit(5000),
    ]);

    if (invError) {
      return NextResponse.json({ error: invError.message }, { status: 500 });
    }
    if (salesError) {
      return NextResponse.json({ error: salesError.message }, { status: 500 });
    }

    // Build a map: vendor_item_id -> product_name (take the first non-null name)
    const productNameMap = new Map<string, string>();
    for (const row of salesMapping ?? []) {
      if (row.vendor_item_id && row.product_name && !productNameMap.has(String(row.vendor_item_id))) {
        productNameMap.set(String(row.vendor_item_id), row.product_name);
      }
    }

    // 3) Enrich inventory rows with product_name
    const data = (inventoryRows ?? []).map((row) => ({
      ...row,
      product_name: productNameMap.get(String(row.vendor_item_id)) ?? null,
    }));

    return NextResponse.json({ data });
  } catch (err) {
    console.error('[API /inventory] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
