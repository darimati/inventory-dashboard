import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';

/**
 * POST /api/influencer/participants/reset
 *
 * Body:
 *   { type: 'participant', participant_id: string }
 *   { type: 'campaign', campaign_id: string }
 *
 * Clears all progress records (draft_received_at, edit_received_at, uploaded_at, published_url)
 * and their deliverable entries in inf_settings.
 * Does NOT clear consent, settlement info, or scheduled dates.
 * Logs each reset to inf_access_logs.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 });
  }

  const { type, participant_id, campaign_id } = body as {
    type?: string;
    participant_id?: string;
    campaign_id?: string;
  };

  if (type === 'participant') {
    if (!participant_id) {
      return NextResponse.json({ error: 'participant_id required' }, { status: 400 });
    }
    const count = await resetParticipant(participant_id);
    return NextResponse.json({ ok: true, reset_count: count });
  }

  if (type === 'campaign') {
    if (!campaign_id) {
      return NextResponse.json({ error: 'campaign_id required' }, { status: 400 });
    }
    // Fetch all participants for this campaign
    const { data: parts } = await supabaseAdmin
      .from('inf_participants')
      .select('id')
      .eq('campaign_id', campaign_id)
      .neq('status', 'cancelled');

    if (!parts || parts.length === 0) {
      return NextResponse.json({ ok: true, reset_count: 0 });
    }

    let total = 0;
    for (const p of parts) {
      total += await resetParticipant(p.id, campaign_id);
    }
    return NextResponse.json({ ok: true, reset_count: total });
  }

  return NextResponse.json({ error: 'type must be "participant" or "campaign"' }, { status: 400 });
}

async function resetParticipant(participantId: string, campaignId?: string): Promise<number> {
  // Clear progress fields
  const { error } = await supabaseAdmin
    .from('inf_participants')
    .update({
      draft_received_at: null,
      edit_received_at: null,
      uploaded_at: null,
      published_url: null,
    })
    .eq('id', participantId);

  if (error) return 0;

  // Delete all deliverable records for this participant
  await supabaseAdmin
    .from('inf_settings')
    .delete()
    .like('key', `dlv:${participantId}:%`);

  // Log to access_logs
  await supabaseAdmin.from('inf_access_logs').insert({
    participant_id: participantId,
    field_name: campaignId ? 'campaign_reset' : 'participant_reset',
    action: 'reset_progress',
  }).then(() => {});

  return 1;
}
