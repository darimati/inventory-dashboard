import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('inf_settings')
    .select('key, value');

  if (error) {
    // Return empty settings (defaults will be used on client)
    return NextResponse.json({});
  }

  const settings: Record<string, unknown> = {};
  for (const row of data ?? []) {
    settings[row.key] = row.value;
  }

  return NextResponse.json(settings);
}

export async function PUT(req: NextRequest) {
  const user = await requireAdmin();
  const body = await req.json();

  const updates: { key: string; value: unknown }[] = Object.entries(body).map(
    ([key, value]) => ({ key, value }),
  );

  for (const { key, value } of updates) {
    const { error } = await supabaseAdmin
      .from('inf_settings')
      .upsert(
        { key, value, updated_by: user.id },
        { onConflict: 'key' },
      );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
