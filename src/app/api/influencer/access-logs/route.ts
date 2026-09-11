import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/influencer/access-logs
 *
 * Query params:
 *  - page (default 1)
 *  - limit (default 50, max 200)
 *  - field_name  (optional filter)
 *  - action      (optional filter)
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const limit = Math.min(200, Math.max(1, Number(sp.get('limit')) || 50));
  const fieldName = sp.get('field_name');
  const action = sp.get('action');
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabaseAdmin
    .from('inf_access_logs')
    .select(
      '*, participant:inf_participants!left(id, name, display_name, handle, channel)',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(from, to);

  if (fieldName) query = query.eq('field_name', fieldName);
  if (action) query = query.eq('action', action);

  const { data, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    data: data ?? [],
    total: count ?? 0,
    page,
    limit,
    totalPages: Math.ceil((count ?? 0) / limit),
  });
}
