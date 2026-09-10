import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';

/**
 * POST /api/influencer/submissions/review
 * Add a review to a submission asset.
 * Body: { asset_id, action: 'approved' | 'revision_requested', reason?, memo? }
 */
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 }); }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 }); }

  const { asset_id, action, reason, memo } = body as {
    asset_id?: string;
    action?: string;
    reason?: string;
    memo?: string;
  };

  if (!asset_id || !action) {
    return NextResponse.json({ error: 'asset_id and action required' }, { status: 400 });
  }

  if (action !== 'approved' && action !== 'revision_requested') {
    return NextResponse.json({ error: 'action must be approved or revision_requested' }, { status: 400 });
  }

  // Get the asset
  const { data: asset } = await supabaseAdmin
    .from('campaign_submission_assets')
    .select('*')
    .eq('id', asset_id)
    .single();

  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });

  // Update asset status
  const newStatus = action === 'approved' ? 'approved' : 'revision_requested';
  const { error: upErr } = await supabaseAdmin
    .from('campaign_submission_assets')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', asset_id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Insert review record
  const { error: revErr } = await supabaseAdmin
    .from('campaign_submission_reviews')
    .insert({
      asset_id,
      action,
      reason: reason?.trim() || null,
      memo: memo?.trim() || null,
    });
  if (revErr) return NextResponse.json({ error: revErr.message }, { status: 500 });

  // Fetch updated asset with reviews
  const { data: updated } = await supabaseAdmin
    .from('campaign_submission_assets')
    .select('*, campaign_submission_reviews(*)')
    .eq('id', asset_id)
    .single();

  const { campaign_submission_reviews, ...rest } = updated as Record<string, unknown>;
  return NextResponse.json({
    asset: {
      ...rest,
      reviews: ((campaign_submission_reviews as Array<Record<string, unknown>>) || []).sort(
        (x, y) => new Date(y.created_at as string).getTime() - new Date(x.created_at as string).getTime()
      ),
    },
  });
}
