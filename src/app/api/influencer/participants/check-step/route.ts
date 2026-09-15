import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';

const STEP_COLUMNS: Record<string, string> = {
  draft: 'draft_received_at',
  edit: 'edit_received_at',
  upload: 'uploaded_at',
};

// Cascade protection: which next-step field blocks undo/delete
const NEXT_STEP_BLOCK: Record<string, { column: string; label: string }> = {
  draft: { column: 'edit_received_at', label: '가편집본이 완료된 상태에서는 기획안을 삭제할 수 없습니다' },
  edit: { column: 'uploaded_at', label: '업로드가 완료된 상태에서는 가편집본을 삭제할 수 없습니다' },
  upload: { column: 'settlement_status', label: '지급 완료 상태에서는 업로드를 삭제할 수 없습니다' },
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
  const settingsKey = `dlv:${participant_id}:${step}`;

  // ── DELETE / UNDO ──────────────────────────────────────────
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

      // Clear participant timestamp
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

    // Log
    await supabaseAdmin.from('inf_access_logs').insert({
      participant_id,
      field_name: column,
      action: 'delete_step',
    }).then(() => {});

    return NextResponse.json({ ok: true, column, value: null });
  }

  // ── REGISTER / UPDATE ──────────────────────────────────────
  const effectiveReceivedAt = received_at || now;

  const deliverable: Record<string, unknown> = {
    link_url: (link as string)?.trim() || null,
    received_at: effectiveReceivedAt,
    memo: (memo as string)?.trim() || null,
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

  // Content type (for upload step)
  if (content_type) {
    deliverable.content_type = content_type;
  }

  // Set participant timestamp (registration = completion)
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

  // Upsert deliverable (overwrite if exists — no version tracking)
  const { data: existing } = await supabaseAdmin
    .from('inf_settings')
    .select('id')
    .eq('key', settingsKey)
    .maybeSingle();

  if (existing) {
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

  // Log
  await supabaseAdmin.from('inf_access_logs').insert({
    participant_id,
    field_name: column,
    action: 'register_step',
  }).then(() => {});

  return NextResponse.json({
    ok: true,
    column,
    value: effectiveReceivedAt,
    deliverable,
  });
}
