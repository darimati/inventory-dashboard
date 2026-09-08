import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

const BASE_FIELDS = `
  id,
  campaign_id,
  name,
  display_name,
  channel,
  handle,
  fee,
  post_type,
  post_count,
  product,
  secondary_use,
  secondary_use_period,
  consent_status,
  consent_agreed_at,
  consent_ip,
  phone,
  planned_draft_date,
  planned_edit_date,
  planned_upload_date,
  inf_campaigns!inner(id, name, collab_type)
`;

export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get('campaign_id');

  // Try with consent_snapshot first, fall back without it
  let hasSnapshot = true;
  let query = supabaseAdmin
    .from('inf_participants')
    .select(`${BASE_FIELDS}, consent_snapshot`)
    .eq('consent_status', 'agreed')
    .order('consent_agreed_at', { ascending: false });

  if (campaignId) query = query.eq('campaign_id', campaignId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any[] | null = null;
  let error: { message: string } | null = null;

  const result1 = await query;
  data = result1.data;
  error = result1.error;

  // Fallback: consent_snapshot column might not exist yet
  if (error?.message?.includes('consent_snapshot')) {
    hasSnapshot = false;
    let fallbackQuery = supabaseAdmin
      .from('inf_participants')
      .select(BASE_FIELDS)
      .eq('consent_status', 'agreed')
      .order('consent_agreed_at', { ascending: false });

    if (campaignId) fallbackQuery = fallbackQuery.eq('campaign_id', campaignId);

    const result2 = await fallbackQuery;
    data = result2.data;
    error = result2.error;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []).map((p: Record<string, unknown>) => ({
    ...p,
    ...(hasSnapshot ? {} : { consent_snapshot: null }),
    campaign_name: (p.inf_campaigns as { name: string })?.name ?? '',
    collab_type: (p.inf_campaigns as { collab_type: string })?.collab_type ?? '',
  }));

  return NextResponse.json(rows);
}
