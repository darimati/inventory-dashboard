import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';

/**
 * GET /api/influencer/submissions?campaign_id=X
 * GET /api/influencer/submissions?participant_id=X
 * Returns submission assets with nested reviews.
 */
export async function GET(req: NextRequest) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 }); }

  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get('campaign_id');
  const participantId = searchParams.get('participant_id');

  if (!campaignId && !participantId) {
    return NextResponse.json({ error: 'campaign_id or participant_id required' }, { status: 400 });
  }

  let participantIds: string[] = [];

  if (campaignId) {
    const { data: parts } = await supabaseAdmin
      .from('inf_participants')
      .select('id')
      .eq('campaign_id', campaignId);
    participantIds = (parts || []).map(p => p.id);
  } else if (participantId) {
    participantIds = [participantId];
  }

  if (participantIds.length === 0) {
    return NextResponse.json({ assets: [] });
  }

  // Check for existing new-system records
  const { data: assets, error } = await supabaseAdmin
    .from('campaign_submission_assets')
    .select('*, campaign_submission_reviews(*)')
    .in('participant_id', participantIds)
    .order('version', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Auto-migrate old deliverable data from inf_settings if no new records exist
  // Old system stores deliverables as inf_settings keys: dlv:{pid}:{step}
  // stage mapping: draft→proposal, edit→rough_cut, upload→final_upload
  const pidsWithAssets = new Set((assets || []).map(a => a.participant_id));
  const pidsToMigrate = participantIds.filter(pid => !pidsWithAssets.has(pid));

  if (pidsToMigrate.length > 0) {
    const oldStageMap: Record<string, string> = {
      draft: 'proposal',
      edit: 'rough_cut',
      upload: 'final_upload',
    };

    for (const pid of pidsToMigrate) {
      const { data: oldRecords } = await supabaseAdmin
        .from('inf_settings')
        .select('key, value')
        .like('key', `dlv:${pid}:%`);

      if (!oldRecords || oldRecords.length === 0) continue;

      for (const rec of oldRecords) {
        const parts = rec.key.split(':');
        if (parts.length < 3) continue;
        const oldStep = parts[2]; // draft, edit, upload
        const newStage = oldStageMap[oldStep];
        if (!newStage) continue;

        const val = rec.value as Record<string, unknown>;
        if (!val) continue;

        const insertData: Record<string, unknown> = {
          participant_id: pid,
          stage: newStage,
          version: (val.version as number) || 1,
          status: mapOldStatus(val.status as string),
          received_at: (val.received_at as string) || new Date().toISOString(),
        };

        if (val.file_url) {
          insertData.file_path = val.file_url;
          insertData.original_filename = val.original_filename || null;
          insertData.mime_type = val.mime_type || null;
          insertData.file_size = val.file_size || null;
        }
        if (val.link_url) {
          insertData.external_url = val.link_url;
        }
        if (val.content_type) {
          insertData.content_type = val.content_type;
        }

        const { data: created } = await supabaseAdmin
          .from('campaign_submission_assets')
          .insert(insertData)
          .select()
          .single();

        if (created) {
          // Create initial review record
          await supabaseAdmin.from('campaign_submission_reviews').insert({
            asset_id: created.id,
            action: mapOldStatus(val.status as string) === 'revision_requested' ? 'revision_requested' : 'received',
            memo: (val.memo as string) || (val.revision_note as string) || null,
            reason: (val.revision_note as string) || (val.review_category as string) || null,
            created_at: (val.received_at as string) || new Date().toISOString(),
          });

          // Migrate version history if exists
          const history = val.history as Array<Record<string, unknown>> | undefined;
          if (history && history.length > 0 && newStage === 'rough_cut') {
            for (const h of history) {
              const hInsert: Record<string, unknown> = {
                participant_id: pid,
                stage: newStage,
                version: (h.version as number) || 1,
                status: mapOldStatus(h.status as string),
                received_at: (h.received_at as string) || new Date().toISOString(),
              };
              if (h.file_url) {
                hInsert.file_path = h.file_url;
                hInsert.original_filename = h.original_filename || null;
                hInsert.mime_type = h.mime_type || null;
                hInsert.file_size = h.file_size || null;
              }
              if (h.link_url) hInsert.external_url = h.link_url;

              const { data: hCreated } = await supabaseAdmin
                .from('campaign_submission_assets')
                .insert(hInsert)
                .select()
                .single();

              if (hCreated && h.revision_note) {
                await supabaseAdmin.from('campaign_submission_reviews').insert({
                  asset_id: hCreated.id,
                  action: 'revision_requested',
                  reason: (h.revision_note as string) || null,
                  created_at: (h.received_at as string) || new Date().toISOString(),
                });
              }
            }
          }
        }
      }
    }

    // Re-fetch all assets after migration
    const { data: allAssets, error: reErr } = await supabaseAdmin
      .from('campaign_submission_assets')
      .select('*, campaign_submission_reviews(*)')
      .in('participant_id', participantIds)
      .order('version', { ascending: false });

    if (reErr) return NextResponse.json({ error: reErr.message }, { status: 500 });

    const mapped = (allAssets || []).map(a => {
      const { campaign_submission_reviews, ...rest } = a;
      return {
        ...rest,
        reviews: (campaign_submission_reviews || []).sort(
          (x: { created_at: string }, y: { created_at: string }) =>
            new Date(y.created_at).getTime() - new Date(x.created_at).getTime()
        ),
      };
    });

    return NextResponse.json({ assets: mapped });
  }

  // Rename nested reviews for cleaner API
  const mapped = (assets || []).map(a => {
    const { campaign_submission_reviews, ...rest } = a;
    return {
      ...rest,
      reviews: (campaign_submission_reviews || []).sort(
        (x: { created_at: string }, y: { created_at: string }) =>
          new Date(y.created_at).getTime() - new Date(x.created_at).getTime()
      ),
    };
  });

  return NextResponse.json({ assets: mapped });
}

/**
 * POST /api/influencer/submissions
 * Create a new submission asset.
 * Body: { participant_id, stage, external_url?, file_path?, original_filename?, mime_type?, file_size?, content_type?, received_at?, memo? }
 */
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 }); }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 }); }

  const { participant_id, stage, external_url, file_path, original_filename, mime_type, file_size, content_type, received_at, memo } = body as {
    participant_id?: string;
    stage?: string;
    external_url?: string;
    file_path?: string;
    original_filename?: string;
    mime_type?: string;
    file_size?: number;
    content_type?: string;
    received_at?: string;
    memo?: string;
  };

  if (!participant_id || !stage) {
    return NextResponse.json({ error: 'participant_id and stage required' }, { status: 400 });
  }

  const validStages = ['proposal', 'rough_cut', 'final_upload'];
  if (!validStages.includes(stage)) {
    return NextResponse.json({ error: `Invalid stage: ${stage}` }, { status: 400 });
  }

  const effectiveReceivedAt = received_at || new Date().toISOString();

  if (stage === 'proposal' || stage === 'final_upload') {
    // Single record per participant+stage — upsert
    const { data: existing } = await supabaseAdmin
      .from('campaign_submission_assets')
      .select('id, external_url')
      .eq('participant_id', participant_id)
      .eq('stage', stage)
      .maybeSingle();

    if (existing) {
      // Update existing record
      const updateData: Record<string, unknown> = {
        external_url: external_url?.trim() || null,
        status: 'received',
        received_at: effectiveReceivedAt,
        updated_at: new Date().toISOString(),
      };
      if (content_type) updateData.content_type = content_type;

      const { error: upErr } = await supabaseAdmin
        .from('campaign_submission_assets')
        .update(updateData)
        .eq('id', existing.id);
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

      // Add link_updated review if URL changed (proposal only)
      if (stage === 'proposal' && existing.external_url !== (external_url?.trim() || null)) {
        await supabaseAdmin.from('campaign_submission_reviews').insert({
          asset_id: existing.id,
          action: 'link_updated',
          memo: memo?.trim() || null,
          created_at: effectiveReceivedAt,
        });
      }

      // Add received review
      await supabaseAdmin.from('campaign_submission_reviews').insert({
        asset_id: existing.id,
        action: 'received',
        memo: memo?.trim() || null,
        created_at: effectiveReceivedAt,
      });

      // Fetch updated asset with reviews
      const { data: updated } = await supabaseAdmin
        .from('campaign_submission_assets')
        .select('*, campaign_submission_reviews(*)')
        .eq('id', existing.id)
        .single();

      return NextResponse.json({ asset: formatAsset(updated) });
    }

    // Create new record
    const insertData: Record<string, unknown> = {
      participant_id,
      stage,
      version: 1,
      external_url: external_url?.trim() || null,
      status: 'received',
      received_at: effectiveReceivedAt,
    };
    if (content_type) insertData.content_type = content_type;

    const { data: created, error: crErr } = await supabaseAdmin
      .from('campaign_submission_assets')
      .insert(insertData)
      .select()
      .single();
    if (crErr) return NextResponse.json({ error: crErr.message }, { status: 500 });

    // Add received review
    await supabaseAdmin.from('campaign_submission_reviews').insert({
      asset_id: created.id,
      action: 'received',
      memo: memo?.trim() || null,
      created_at: effectiveReceivedAt,
    });

    const { data: full } = await supabaseAdmin
      .from('campaign_submission_assets')
      .select('*, campaign_submission_reviews(*)')
      .eq('id', created.id)
      .single();

    return NextResponse.json({ asset: formatAsset(full) });
  }

  // rough_cut: version auto-increment
  const { data: existingVersions } = await supabaseAdmin
    .from('campaign_submission_assets')
    .select('version')
    .eq('participant_id', participant_id)
    .eq('stage', 'rough_cut')
    .order('version', { ascending: false })
    .limit(1);

  const nextVersion = (existingVersions?.[0]?.version || 0) + 1;

  const { data: created, error: crErr } = await supabaseAdmin
    .from('campaign_submission_assets')
    .insert({
      participant_id,
      stage: 'rough_cut',
      version: nextVersion,
      file_path: file_path?.trim() || null,
      original_filename: original_filename || null,
      mime_type: mime_type || null,
      file_size: file_size || null,
      external_url: external_url?.trim() || null,
      status: 'received',
      received_at: effectiveReceivedAt,
    })
    .select()
    .single();
  if (crErr) return NextResponse.json({ error: crErr.message }, { status: 500 });

  // Add received review
  await supabaseAdmin.from('campaign_submission_reviews').insert({
    asset_id: created.id,
    action: 'received',
    memo: memo?.trim() || null,
    created_at: effectiveReceivedAt,
  });

  const { data: full } = await supabaseAdmin
    .from('campaign_submission_assets')
    .select('*, campaign_submission_reviews(*)')
    .eq('id', created.id)
    .single();

  return NextResponse.json({ asset: formatAsset(full) });
}

/**
 * PATCH /api/influencer/submissions
 * Update an existing submission asset (link update, confirm revision).
 * Body: { id, external_url?, content_type?, action?: 'confirm_revision' }
 */
export async function PATCH(req: NextRequest) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 }); }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 }); }

  const { id, external_url, content_type, action } = body as {
    id?: string;
    external_url?: string;
    content_type?: string;
    action?: string;
  };

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { data: asset } = await supabaseAdmin
    .from('campaign_submission_assets')
    .select('*')
    .eq('id', id)
    .single();

  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });

  if (action === 'confirm_revision') {
    // Set status back to received for re-review
    const { error: upErr } = await supabaseAdmin
      .from('campaign_submission_assets')
      .update({ status: 'received', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    await supabaseAdmin.from('campaign_submission_reviews').insert({
      asset_id: id,
      action: 'received',
      memo: '수정본 확인',
    });
  } else {
    // Update link/content_type
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (external_url !== undefined) {
      updateData.external_url = external_url?.trim() || null;
      updateData.status = 'received';
    }
    if (content_type !== undefined) updateData.content_type = content_type;

    const { error: upErr } = await supabaseAdmin
      .from('campaign_submission_assets')
      .update(updateData)
      .eq('id', id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    if (external_url !== undefined && asset.external_url !== (external_url?.trim() || null)) {
      await supabaseAdmin.from('campaign_submission_reviews').insert({
        asset_id: id,
        action: 'link_updated',
      });
    }
  }

  const { data: updated } = await supabaseAdmin
    .from('campaign_submission_assets')
    .select('*, campaign_submission_reviews(*)')
    .eq('id', id)
    .single();

  return NextResponse.json({ asset: formatAsset(updated) });
}

function mapOldStatus(status: string | null | undefined): string {
  if (!status) return 'received';
  switch (status) {
    case 'approved': return 'approved';
    case 'revision_requested': return 'revision_requested';
    default: return 'received';
  }
}

function formatAsset(a: Record<string, unknown> | null) {
  if (!a) return null;
  const { campaign_submission_reviews, ...rest } = a as Record<string, unknown>;
  return {
    ...rest,
    reviews: ((campaign_submission_reviews as Array<Record<string, unknown>>) || []).sort(
      (x, y) => new Date(y.created_at as string).getTime() - new Date(x.created_at as string).getTime()
    ),
  };
}
