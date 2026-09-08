import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { resolveCoupangProduct, resolveEzadminProduct, EZADMIN_EXCLUDE } from '@/lib/product-map';

export const dynamic = 'force-dynamic';

function todayKST(): string {
  const kst = new Date(Date.now() + 9 * 3_600_000);
  return kst.toISOString().slice(0, 10);
}

/** POST: Take a snapshot of current inventory by product */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET || '';
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const snapshotDate = todayKST();

  // Fetch current inventory
  const [{ data: coupangRows }, { data: ezadminRows }] = await Promise.all([
    supabaseAdmin
      .from('inventory_coupang')
      .select('vendor_item_id, total_orderable_quantity'),
    supabaseAdmin
      .from('ezadmin_inventory')
      .select('product_code, available_stock'),
  ]);

  // Aggregate by product — Coupang Rocket Growth
  const stockByProduct = new Map<string, { rocket: number; ezadmin: number }>();

  for (const row of coupangRows ?? []) {
    const vid = String(row.vendor_item_id);
    const mapped = resolveCoupangProduct(vid);
    if (!mapped) continue;
    const product = mapped.product;
    const existing = stockByProduct.get(product) ?? { rocket: 0, ezadmin: 0 };
    existing.rocket += row.total_orderable_quantity ?? 0;
    stockByProduct.set(product, existing);
  }

  // Aggregate by product — EZAdmin
  for (const row of ezadminRows ?? []) {
    if (EZADMIN_EXCLUDE.has(row.product_code)) continue;
    const mapped = resolveEzadminProduct(row.product_code);
    if (!mapped || mapped.stockType === '부자재') continue;
    const product = mapped.product;
    const existing = stockByProduct.get(product) ?? { rocket: 0, ezadmin: 0 };
    existing.ezadmin += row.available_stock ?? 0;
    stockByProduct.set(product, existing);
  }

  // Upsert snapshots
  const rows = Array.from(stockByProduct.entries()).map(([product, stock]) => ({
    snapshot_date: snapshotDate,
    product,
    stock_total: stock.rocket,
    ezadmin_total: stock.ezadmin,
  }));

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, message: 'No mapped products found', date: snapshotDate });
  }

  const { error } = await supabaseAdmin
    .from('inventory_snapshots_coupang')
    .upsert(rows, { onConflict: 'snapshot_date,product' });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    date: snapshotDate,
    products: rows.length,
    rows,
  });
}

/** GET: Fetch snapshots for last N days */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = parseInt(searchParams.get('days') || '90', 10);

  const kst = new Date(Date.now() + 9 * 3_600_000);
  kst.setUTCDate(kst.getUTCDate() - days);
  const fromDate = kst.toISOString().slice(0, 10);

  const { data, error } = await supabaseAdmin
    .from('inventory_snapshots_coupang')
    .select('snapshot_date, product, stock_total, ezadmin_total')
    .gte('snapshot_date', fromDate)
    .order('snapshot_date', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
