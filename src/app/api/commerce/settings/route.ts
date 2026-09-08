import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/commerce/settings?key=...
 * Returns the value for a given settings key
 */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (!key) {
    return NextResponse.json({ error: 'key required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('inf_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ value: data?.value ?? null });
}

/**
 * PUT /api/commerce/settings
 * Body: { key, value }
 * Upserts a settings entry
 */
export async function PUT(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 });
  }

  const { key, value } = body as { key?: string; value?: unknown };

  if (!key) {
    return NextResponse.json({ error: 'key required' }, { status: 400 });
  }

  // Check if exists
  const { data: existing } = await supabaseAdmin
    .from('inf_settings')
    .select('id')
    .eq('key', key)
    .maybeSingle();

  if (existing) {
    const { error } = await supabaseAdmin
      .from('inf_settings')
      .update({ value, updated_at: new Date().toISOString(), updated_by: 'admin' })
      .eq('key', key);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabaseAdmin
      .from('inf_settings')
      .insert({ key, value, updated_by: 'admin' });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
