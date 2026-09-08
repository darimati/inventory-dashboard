import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sku-mappings
 * Returns all SKU mappings (active only by default)
 */
export async function GET(req: NextRequest) {
  const includeInactive = req.nextUrl.searchParams.get('all') === 'true';

  let query = supabaseAdmin
    .from('commerce_sku_mappings')
    .select('*')
    .order('product_name', { ascending: true });

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;

  if (error) {
    if (error.message.includes('does not exist') || error.code === '42P01') {
      return NextResponse.json({ data: [], _tableNotReady: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}

/**
 * POST /api/sku-mappings
 * Create a new SKU mapping
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 });
  }

  const {
    product_name, option_name,
    coupang_product_id, coupang_option_id, coupang_vendor_item_id,
    easyadmin_sku_code, easyadmin_product_code,
    stock_unit_multiplier, memo,
  } = body as {
    product_name?: string; option_name?: string;
    coupang_product_id?: string; coupang_option_id?: string; coupang_vendor_item_id?: string;
    easyadmin_sku_code?: string; easyadmin_product_code?: string;
    stock_unit_multiplier?: number; memo?: string;
  };

  if (!product_name || !option_name) {
    return NextResponse.json({ error: '제품명과 옵션명은 필수입니다' }, { status: 400 });
  }

  const insertData: Record<string, unknown> = {
    product_name,
    option_name,
    coupang_product_id: coupang_product_id || null,
    coupang_option_id: coupang_option_id || null,
    coupang_vendor_item_id: coupang_vendor_item_id || null,
    easyadmin_sku_code: easyadmin_sku_code || null,
    easyadmin_product_code: easyadmin_product_code || null,
    stock_unit_multiplier: stock_unit_multiplier ?? 1,
    memo: memo || null,
    is_active: true,
  };

  const { data, error } = await supabaseAdmin
    .from('commerce_sku_mappings')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

/**
 * PATCH /api/sku-mappings
 * Update an existing mapping
 * Body: { id, fields: { ... } }
 */
export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 });
  }

  const { id, fields } = body as { id?: string; fields?: Record<string, unknown> };
  if (!id || !fields) {
    return NextResponse.json({ error: 'id와 fields는 필수입니다' }, { status: 400 });
  }

  const updateData: Record<string, unknown> = { ...fields, updated_at: new Date().toISOString() };

  const { data, error } = await supabaseAdmin
    .from('commerce_sku_mappings')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

/**
 * DELETE /api/sku-mappings
 * Soft delete (set is_active = false)
 * Body: { id }
 */
export async function DELETE(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 });
  }

  const { id } = body as { id?: string };
  if (!id) {
    return NextResponse.json({ error: 'id는 필수입니다' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('commerce_sku_mappings')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
