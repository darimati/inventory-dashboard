import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';

const STEP_COLUMNS: Record<string, string> = {
  draft: 'draft_received_at',
  edit: 'edit_received_at',
  upload: 'uploaded_at',
};

// Cascade protection: which next-step field blocks undo
const NEXT_STEP_BLOCK: Record<string, { column: string; label: string }> = {
  draft: { column: 'edit_received_at', label: '가편집본이 완료된 상태에서는 기획안을 취소할 수 없습니다' },
  edit: { column: 'uploaded_at', label: '업로드가 완료된 상태에서는 가편집본을 취소할 수 없습니다' },
  upload: { column: 'settlement_status', label: '지급 완료 상태에서는 업로드를 취소할 수 없습니다' },
};

export async function PATCH(req: NextRequest) {
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

  const {
    participant_id, step, undo,
    link, memo, received_at,
    status: delivStatus, revision_note, review_category,
    // File deliverable fields
    file_url, original_filename, mime_type, file_size,
    // Upload step fields
    content_type,
  } = body as {
    participant_id?: string;
    step?: string;
    undo?: boolean;
    link?: string;
    memo?: string;
    received_at?: string;
    status?: string;
    revision_note?: string;
    review_category?: string;
    file_url?: string;
    original_filename?: string;
    mime_type?: string;
    file_size?: number;
    content_type?: string;
  };

  if (!participant_id || !step) {
    return NextResponse.json({ error: 'participant_id and step required' }, { status: 400 });
  }

  const column = STEP_COLUMNS[step];
  if (!column) {
    return NextResponse.json({ error: `Invalid step: ${step}. Use draft, edit, or upload.` }, { status: 400 });
  }

  const now = new Date().toISOString();
  const effectiveStatus = delivStatus || 'approved';
  const isRevisionRequest = effectiveStatus === 'revision_requested';

  // Store/remove deliverable in inf_settings (key: dlv:{participant_id}:{step})
  const settingsKey = `dlv:${participant_id}:${step}`;

  if (undo) {
    // Upload step: special cascade check for payment
    if (step === 'upload') {
      const { data: part } = await supabaseAdmin
        .from('inf_participants')
        .select('settlement_status')
        .eq('id', participant_id)
        .single();
      if (part && part.settlement_status === 'paid') {
        return NextResponse.json({ error: NEXT_STEP_BLOCK.upload.label }, { status: 409 });
      }
      // Clear uploaded_at and published_url
      const { error: updateError } = await supabaseAdmin
        .from('inf_participants')
        .update({ uploaded_at: null, published_url: null, status: 'content_submitted' })
        .eq('id', participant_id);
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    } else {
      // Cascade protection: check if next step is already completed
      const block = NEXT_STEP_BLOCK[step];
      if (block) {
        const { data: part } = await supabaseAdmin
          .from('inf_participants')
          .select(block.column)
          .eq('id', participant_id)
          .single();
        if (part && (part as unknown as Record<string, unknown>)[block.column]) {
          return NextResponse.json({ error: block.label }, { status: 409 });
        }
      }

      // Undo: clear participant timestamp
      const { error: updateError } = await supabaseAdmin
        .from('inf_participants')
        .update({ [column]: null })
        .eq('id', participant_id);
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }

    // Remove deliverable
    await supabaseAdmin.from('inf_settings').delete().eq('key', settingsKey);

    // Log to access_logs
    await supabaseAdmin.from('inf_access_logs').insert({
      participant_id,
      field_name: column,
      action: 'undo_step',
    }).then(() => {});

    return NextResponse.json({ ok: true, column, value: null });
  }

  // Check for existing deliverable (for version tracking)
  const { data: existing } = await supabaseAdmin
    .from('inf_settings')
    .select('id, value')
    .eq('key', settingsKey)
    .maybeSingle();

  const prevVersion = (existing?.value as Record<string, unknown>)?.version as number || 0;
  const nextVersion = prevVersion + 1;
  const effectiveReceivedAt = received_at || now;

  const deliverable: Record<string, unknown> = {
    link_url: (link as string)?.trim() || null,
    received_at: effectiveReceivedAt,
    memo: (memo as string)?.trim() || null,
    status: effectiveStatus,
    revision_note: isRevisionRequest ? ((revision_note as string)?.trim() || null) : null,
    review_category: isRevisionRequest ? ((review_category as string)?.trim() || null) : null,
    version: nextVersion,
  };

  // File fields (for edit step with file upload)
  if (file_url) {
    deliverable.file_url = file_url;
    deliverable.original_filename = original_filename || null;
    deliverable.mime_type = mime_type || null;
    deliverable.file_size = file_size || null;
    deliverable.asset_type = 'file';
  } else {
    deliverable.asset_type = 'external_link';
  }

  // Content type (for upload/final step)
  if (content_type) {
    deliverable.content_type = content_type;
  }

  // Only set participant timestamp for approved (not revision_requested)
  if (!isRevisionRequest) {
    const updateData: Record<string, unknown> = { [column]: effectiveReceivedAt };

    // For upload step, also set published_url and status
    if (step === 'upload') {
      if (link) updateData.published_url = (link as string).trim();
      updateData.status = 'published';
    }

    const { error: updateError } = await supabaseAdmin
      .from('inf_participants')
      .update(updateData)
      .eq('id', participant_id);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  // Upsert deliverable
  if (existing) {
    // For revision on edit step: store version history
    const prevValue = existing.value as Record<string, unknown>;
    const history = (prevValue?.history as unknown[]) || [];
    // Save current state to history before overwriting
    const { history: _, ...prevWithoutHistory } = prevValue as Record<string, unknown>;
    history.push(prevWithoutHistory);
    deliverable.history = history;

    const { error: sErr } = await supabaseAdmin
      .from('inf_settings')
      .update({ value: deliverable, updated_at: now, updated_by: 'admin' })
      .eq('key', settingsKey);
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });
  } else {
    const { error: sErr } = await supabaseAdmin
      .from('inf_settings')
      .insert({ key: settingsKey, value: deliverable, updated_by: 'admin' });
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });
  }

  // Log save to access_logs
  await supabaseAdmin.from('inf_access_logs').insert({
    participant_id,
    field_name: column,
    action: isRevisionRequest ? 'revision_requested' : 'check_step',
  }).then(() => {});

  return NextResponse.json({
    ok: true,
    column,
    value: isRevisionRequest ? null : effectiveReceivedAt,
    status: effectiveStatus,
    version: nextVersion,
    deliverable,
  });
}
