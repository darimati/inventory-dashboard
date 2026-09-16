import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';
import { randomBytes } from 'crypto';

export async function POST(req: NextRequest) {
  const user = await requireAdmin();
  const body = await req.json();

  // Auto-calculate product_cost from provided_products
  let productCost = body.product_cost || 0;
  if (body.provided_products && Array.isArray(body.provided_products) && body.provided_products.length > 0) {
    productCost = body.provided_products.reduce(
      (sum: number, p: { quantity?: number; unit_cost?: number }) =>
        sum + (p.quantity ?? 0) * (p.unit_cost ?? 0),
      0
    );
  }

  // Map content_formats to legacy post_type/post_count for pre-migration DB
  const firstFormat = (body.content_formats && body.content_formats.length > 0)
    ? body.content_formats[0]
    : null;

  const baseData: Record<string, unknown> = {
    campaign_id: body.campaign_id,
    name: body.name,
    display_name: body.display_name || null,
    channel: body.channel || null,
    handle: body.handle || null,
    profile_url: body.profile_url || null,
    product: body.product_set_name || body.product || null,
    product_quantity: body.product_quantity || 1,
    product_cost: productCost,
    fee: body.fee || 0,
    collab_type: body.collab_type || null,
    post_type: firstFormat?.format || body.post_type || null,
    post_count: firstFormat?.count || body.post_count || 1,
    content_deadline: body.content_deadline || null,
    publish_deadline: body.publish_deadline || null,
    secondary_use: body.secondary_use ?? false,
    secondary_use_period: body.secondary_use_period || null,
    memo: body.memo || null,
    created_by: user.id,
  };

  // Try with v3 columns first, fall back to base if migration not run
  const v3Data: Record<string, unknown> = {
    ...baseData,
    provided_products: body.provided_products || [],
    product_set_name: body.product_set_name || null,
    rs_ratio: body.rs_ratio || null,
    content_formats: body.content_formats || [],
  };

  let result = await supabaseAdmin
    .from('inf_participants')
    .insert(v3Data)
    .select()
    .single();

  // If v3 columns don't exist yet, retry with base only
  if (result.error && result.error.message.includes('column')) {
    result = await supabaseAdmin
      .from('inf_participants')
      .insert(baseData)
      .select()
      .single();
  }

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json(result.data, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const user = await requireAdmin();
  const body = await req.json();

  // Handle archive/unarchive actions
  if (body.action === 'archive' || body.action === 'unarchive') {
    if (!body.id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }
    const isArchived = body.action === 'archive';
    const { data, error } = await supabaseAdmin
      .from('inf_participants')
      .update({ is_archived: isArchived })
      .eq('id', body.id)
      .select()
      .single();
    if (error) {
      // Column may not exist yet — skip gracefully
      if (error.message?.includes('is_archived')) {
        return NextResponse.json({ error: 'is_archived 컬럼이 아직 없습니다. 마이그레이션을 먼저 실행해주세요.' }, { status: 500 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await supabaseAdmin.from('inf_access_logs').insert({
      actor_id: user.id,
      participant_id: body.id,
      field_name: 'is_archived',
      action: body.action,
    });
    return NextResponse.json(data);
  }

  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  // Auto-calculate product_cost if provided_products is being updated
  if (updates.provided_products && Array.isArray(updates.provided_products)) {
    updates.product_cost = updates.provided_products.reduce(
      (sum: number, p: { quantity?: number; unit_cost?: number }) =>
        sum + (p.quantity ?? 0) * (p.unit_cost ?? 0),
      0
    );
  }

  // Map content_formats to legacy post_type/post_count for pre-migration DB
  if (updates.content_formats && Array.isArray(updates.content_formats) && updates.content_formats.length > 0) {
    const firstFmt = updates.content_formats[0];
    updates.post_type = firstFmt?.format || updates.post_type || null;
    updates.post_count = firstFmt?.count || updates.post_count || 1;
  }

  // Sync product_set_name to legacy product column
  if (updates.product_set_name !== undefined) {
    updates.product = updates.product_set_name || null;
  }

  // Date order validation: confirmed dates must be in order (draft ≤ edit ≤ upload)
  if (updates.confirmed_draft_date || updates.confirmed_edit_date || updates.confirmed_upload_date) {
    const dates = [
      updates.confirmed_draft_date,
      updates.confirmed_edit_date,
      updates.confirmed_upload_date,
    ].filter(Boolean) as string[];
    for (let i = 1; i < dates.length; i++) {
      if (dates[i] < dates[i - 1]) {
        return NextResponse.json(
          { error: '일정 순서가 올바르지 않습니다. (기획안 ≤ 가편집본 ≤ 업로드)' },
          { status: 400 }
        );
      }
    }
  }

  // Generate consent token if requested
  if (updates.generate_consent_token) {
    delete updates.generate_consent_token;
    updates.consent_token = randomBytes(32).toString('hex');
    updates.consent_token_expires_at = new Date(Date.now() + 30 * 86400000).toISOString();
    updates.consent_status = 'sent';
  }

  // Generate settlement token if requested
  if (updates.generate_settlement_token) {
    // Validate fee and published_url before generating
    const { data: participant } = await supabaseAdmin
      .from('inf_participants')
      .select('fee, published_url, settlement_status')
      .eq('id', id)
      .single();

    if (participant) {
      if (participant.fee > 0 && !participant.published_url) {
        return NextResponse.json(
          { error: '게시 URL이 등록되지 않았습니다.' },
          { status: 400 }
        );
      }
    }

    delete updates.generate_settlement_token;
    updates.settlement_token = randomBytes(32).toString('hex');
    updates.settlement_token_expires_at = new Date(Date.now() + 30 * 86400000).toISOString();
    // Don't overwrite status if already submitted or beyond
    const submitted = ['docs_submitted', 'payment_waiting', 'payment_requested', 'paid'];
    if (!participant?.settlement_status || !submitted.includes(participant.settlement_status)) {
      updates.settlement_status = 'docs_requested';
    }
    // planned_payment_date is calculated at confirm time (settlements confirm handler)
  }

  // Auto-generate settlement token on upload confirmation (fee > 0)
  if (updates.uploaded_at && !updates.generate_settlement_token) {
    const { data: participant } = await supabaseAdmin
      .from('inf_participants')
      .select('fee, settlement_token, settlement_status')
      .eq('id', id)
      .single();

    if (participant && (Number(participant.fee) || 0) > 0 && !participant.settlement_token) {
      const needsToken = !participant.settlement_status || participant.settlement_status === 'none' || participant.settlement_status === 'not_sent';
      if (needsToken) {
        updates.settlement_token = randomBytes(32).toString('hex');
        updates.settlement_token_expires_at = new Date(Date.now() + 30 * 86400000).toISOString();
        updates.settlement_status = 'docs_requested';
        // planned_payment_date is calculated at confirm time (settlements confirm handler)
      }
    }
  }

  let result = await supabaseAdmin
    .from('inf_participants')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  // If v3 columns don't exist, strip them and retry
  if (result.error && result.error.message.includes('column')) {
    const v3Keys = ['provided_products', 'product_set_name', 'rs_ratio', 'content_formats'];
    const safeUpdates = { ...updates };
    for (const k of v3Keys) delete safeUpdates[k];
    result = await supabaseAdmin
      .from('inf_participants')
      .update(safeUpdates)
      .eq('id', id)
      .select()
      .single();
  }

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json(result.data);
}

export async function DELETE(req: NextRequest) {
  const user = await requireAdmin();
  const { id, confirm_name } = await req.json();

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const { data: p } = await supabaseAdmin
    .from('inf_participants')
    .select('id, name, consent_status, settlement_status')
    .eq('id', id)
    .single();

  if (!p) {
    return NextResponse.json({ error: 'participant not found' }, { status: 404 });
  }

  // Check settlements
  const { data: settlements } = await supabaseAdmin
    .from('inf_settlements')
    .select('id, payment_status')
    .eq('participant_id', id);
  const settlementCount = settlements?.length ?? 0;

  // Block deletion if paid settlement exists — cannot delete (RESTRICT FK)
  const hasPaidSettlement = settlements?.some(s => s.payment_status === 'paid') ?? false;
  if (hasPaidSettlement) {
    return NextResponse.json({
      error: '지급 완료된 정산이 있는 참여자는 삭제할 수 없습니다. 보관 처리를 사용하세요.',
      code: 'paid_settlement',
      action: 'archive',
    }, { status: 400 });
  }

  const hasSettlementStatus = ['docs_submitted', 'payment_waiting', 'payment_requested', 'paid'].includes(p.settlement_status);
  const hasConsent = p.consent_status === 'agreed';
  const hasRecords = settlementCount > 0 || hasSettlementStatus || hasConsent;

  // Block deletion if records exist — suggest archive instead
  if (hasRecords && confirm_name !== p.name) {
    const reason = hasSettlementStatus || settlementCount > 0
      ? '정산 기록이 있는 참여자입니다. 보관 처리를 사용하거나, 삭제하려면 이름을 정확히 입력해주세요.'
      : '동의서 제출 기록이 있는 참여자입니다. 보관 처리를 사용하거나, 삭제하려면 이름을 정확히 입력해주세요.';
    return NextResponse.json({
      error: reason,
      code: 'confirm_required',
      action: 'archive',
      details: {
        consent: hasConsent,
        settlement_status: hasSettlementStatus,
        settlement_records: settlementCount,
      },
    }, { status: 400 });
  }

  // Log BEFORE deleting
  await supabaseAdmin.from('inf_access_logs').insert({
    actor_id: user.id,
    participant_id: id,
    field_name: 'participant_delete',
    action: `name=${p.name}, consent=${p.consent_status}, settlement=${p.settlement_status}, settlement_records=${settlementCount}`,
  });

  // Delete settlements first (RESTRICT FK requires manual cleanup)
  if (settlementCount > 0) {
    await supabaseAdmin.from('inf_settlements').delete().eq('participant_id', id);
  }

  const { error } = await supabaseAdmin
    .from('inf_participants')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
