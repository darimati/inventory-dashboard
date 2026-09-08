import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/purchase-orders
 * Query params: status (optional filter)
 * Returns purchase orders with items joined
 */
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status');

  let query = supabaseAdmin
    .from('purchase_orders')
    .select('*, purchase_order_items(*)')
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}

/**
 * POST /api/purchase-orders
 * Body: { order_type, destination?, ordered_at?, expected_at?, memo?, items: [{ product, quantity, unit_price? }] }
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 });
  }

  const { order_type, destination, ordered_at, expected_at, memo, items } = body as {
    order_type?: string;
    destination?: string;
    ordered_at?: string;
    expected_at?: string;
    memo?: string;
    items?: { product: string; quantity: number; unit_price?: number }[];
  };

  if (!order_type || !items?.length) {
    return NextResponse.json({ error: 'order_type과 items가 필요합니다' }, { status: 400 });
  }

  // Generate order number: PO-YYYYMMDD-NNN
  const kst = new Date(Date.now() + 9 * 3_600_000);
  const dateStr = kst.toISOString().slice(0, 10).replace(/-/g, '');

  const { count } = await supabaseAdmin
    .from('purchase_orders')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', kst.toISOString().slice(0, 10) + 'T00:00:00+09:00');

  const seq = String((count ?? 0) + 1).padStart(3, '0');
  const orderNumber = `PO-${dateStr}-${seq}`;

  const { data: order, error: orderError } = await supabaseAdmin
    .from('purchase_orders')
    .insert({
      order_number: orderNumber,
      order_type,
      destination: destination || 'easyadmin',
      ordered_at: ordered_at || kst.toISOString().slice(0, 10),
      expected_at: expected_at || null,
      memo: memo || null,
    })
    .select()
    .single();

  if (orderError) {
    return NextResponse.json({ error: orderError.message }, { status: 500 });
  }

  const itemRows = items.map((item) => ({
    purchase_order_id: order.id,
    product: item.product,
    quantity: item.quantity,
  }));

  const { error: itemsError } = await supabaseAdmin
    .from('purchase_order_items')
    .insert(itemRows);

  if (itemsError) {
    await supabaseAdmin.from('purchase_orders').delete().eq('id', order.id);
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  const { data: complete } = await supabaseAdmin
    .from('purchase_orders')
    .select('*, purchase_order_items(*)')
    .eq('id', order.id)
    .single();

  return NextResponse.json(complete);
}

/**
 * PATCH /api/purchase-orders
 * Body: { id, action: 'arrive' | 'cancel', items?: [{ id, arrived_quantity }] }
 */
export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 });
  }

  const { id, action, items } = body as {
    id?: string;
    action?: string;
    items?: { id: string; arrived_quantity: number }[];
  };

  if (!id || !action) {
    return NextResponse.json({ error: 'id와 action이 필요합니다' }, { status: 400 });
  }

  if (action === 'cancel') {
    const { error } = await supabaseAdmin
      .from('purchase_orders')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('status', 'ordered');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === 'arrive') {
    if (!items?.length) {
      return NextResponse.json({ error: '입고 품목 정보가 필요합니다' }, { status: 400 });
    }

    for (const item of items) {
      const { error } = await supabaseAdmin
        .from('purchase_order_items')
        .update({ arrived_quantity: item.arrived_quantity })
        .eq('id', item.id);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Determine new order status
    const { data: allItems } = await supabaseAdmin
      .from('purchase_order_items')
      .select('quantity, arrived_quantity')
      .eq('purchase_order_id', id);

    const allComplete = allItems?.every((i) => i.arrived_quantity >= i.quantity) ?? false;

    // No 'partial' status — stays 'ordered' until all items arrive
    const newStatus = allComplete ? 'arrived' : 'ordered';
    const updateData: Record<string, unknown> = { status: newStatus };
    if (allComplete) updateData.arrived_at = new Date().toISOString();

    await supabaseAdmin
      .from('purchase_orders')
      .update(updateData)
      .eq('id', id);

    // Return updated order
    const { data: updated } = await supabaseAdmin
      .from('purchase_orders')
      .select('*, purchase_order_items(*)')
      .eq('id', id)
      .single();

    return NextResponse.json({ ok: true, status: newStatus, order: updated });
  }

  return NextResponse.json({ error: '알 수 없는 action입니다' }, { status: 400 });
}
