import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status');

  let campaignQuery = supabaseAdmin
    .from('inf_campaigns')
    .select('*, inf_participants(*)')
    .order('created_at', { ascending: false });

  if (status && status !== 'all') {
    campaignQuery = campaignQuery.eq('status', status);
  }

  // Parallel fetch: campaigns + deliverable settings
  const [{ data, error }, { data: dlvSettings }] = await Promise.all([
    campaignQuery,
    supabaseAdmin
      .from('inf_settings')
      .select('key, value')
      .like('key', 'dlv:%'),
  ]);

  if (error) {
    console.error('[campaigns GET]', error.message);
    return NextResponse.json([]);
  }

  // Attach deliverables from inf_settings (dlv:{participant_id}:{step})
  const campaigns = data ?? [];
  if (dlvSettings && dlvSettings.length > 0) {
    const dlvMap: Record<string, Record<string, unknown>> = {};
    for (const s of dlvSettings) {
      const parts = s.key.split(':');
      if (parts.length >= 3) {
        const pid = parts[1];
        const step = parts[2];
        if (!dlvMap[pid]) dlvMap[pid] = {};
        dlvMap[pid][step] = s.value;
      }
    }
    for (const c of campaigns) {
      for (const p of ((c as any).inf_participants ?? [])) {
        (p as any)._deliverables = dlvMap[p.id] || {};
      }
    }
  }

  return NextResponse.json(campaigns);
}

export async function POST(req: NextRequest) {
  const user = await requireAdmin();
  const body = await req.json();

  const insertData: Record<string, unknown> = {
    name: body.name,
    month: body.month || null,
    collab_type: body.collab_type || 'free_seeding',
    budget: body.budget || 0,
    target_product: body.target_product || null,
    manager: body.manager || null,
    status: body.status || 'active',
    memo: body.memo || null,
    created_by: user.id,
  };
  if (Array.isArray(body.advertised_products) && body.advertised_products.length > 0) {
    insertData.advertised_products = body.advertised_products;
  }

  let result = await supabaseAdmin
    .from('inf_campaigns')
    .insert(insertData)
    .select()
    .single();

  // If v3 columns don't exist, strip them and retry
  if (result.error && result.error.message.includes('column')) {
    const v3Keys = ['collab_type', 'advertised_products', 'target_product'];
    const safeData = { ...insertData };
    for (const k of v3Keys) delete safeData[k];
    result = await supabaseAdmin
      .from('inf_campaigns')
      .insert(safeData)
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
      .from('inf_campaigns')
      .update({ is_archived: isArchived })
      .eq('id', body.id)
      .select()
      .single();
    if (error) {
      if (error.message?.includes('is_archived')) {
        return NextResponse.json({ error: 'is_archived 컬럼이 아직 없습니다. 마이그레이션을 먼저 실행해주세요.' }, { status: 500 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    // Log archive action for all participants
    const { data: parts } = await supabaseAdmin
      .from('inf_participants')
      .select('id')
      .eq('campaign_id', body.id);
    for (const p of parts ?? []) {
      await supabaseAdmin.from('inf_access_logs').insert({
        actor_id: user.id,
        participant_id: p.id,
        field_name: 'campaign_is_archived',
        action: body.action,
      });
    }
    return NextResponse.json(data);
  }

  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  // Log budget changes to inf_budget_history
  if (updates.budget !== undefined) {
    const { data: current } = await supabaseAdmin
      .from('inf_campaigns')
      .select('budget')
      .eq('id', id)
      .single();
    if (current && Number(current.budget) !== Number(updates.budget)) {
      try {
        await supabaseAdmin.from('inf_budget_history').insert({
          campaign_id: id,
          field_name: 'budget',
          old_value: current.budget,
          new_value: updates.budget,
          reason: updates.budget_change_reason || null,
          changed_by: user.id,
        });
      } catch { /* Graceful — table may not exist yet */ }
      delete updates.budget_change_reason;
    }
  }

  let result = await supabaseAdmin
    .from('inf_campaigns')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  // If v3 columns don't exist, strip them and retry
  if (result.error && result.error.message.includes('column')) {
    const v3Keys = ['advertised_products'];
    const safeUpdates = { ...updates };
    for (const k of v3Keys) delete safeUpdates[k];
    result = await supabaseAdmin
      .from('inf_campaigns')
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

  const { data: campaign } = await supabaseAdmin
    .from('inf_campaigns')
    .select('name')
    .eq('id', id)
    .single();

  if (!campaign) {
    return NextResponse.json({ error: 'campaign not found' }, { status: 404 });
  }

  const { data: parts } = await supabaseAdmin
    .from('inf_participants')
    .select('id, name, consent_status, settlement_status')
    .eq('campaign_id', id);

  const participants = parts ?? [];
  const participantIds = participants.map((p: any) => p.id);
  const consentCount = participants.filter((p: any) => p.consent_status === 'agreed').length;
  const hasPaidParticipant = participants.some((p: any) => p.settlement_status === 'paid');
  if (hasPaidParticipant) {
    return NextResponse.json({
      error: '지급 완료된 참여자가 있는 캠페인은 삭제할 수 없습니다. 보관 처리를 사용하세요.',
      code: 'paid_settlement',
      action: 'archive',
    }, { status: 400 });
  }

  const hasSettlementStatus = participants.some((p: any) =>
    ['docs_submitted', 'payment_waiting', 'payment_requested', 'paid'].includes(p.settlement_status)
  );

  let settlementCount = 0;
  if (participantIds.length > 0) {
    const { count } = await supabaseAdmin
      .from('inf_settlements')
      .select('id', { count: 'exact', head: true })
      .in('participant_id', participantIds);
    settlementCount = count ?? 0;
  }

  const hasSettlement = hasSettlementStatus || settlementCount > 0;
  const hasRecords = participants.length > 0;

  // Block deletion if participants exist — suggest archive instead
  if (hasRecords && confirm_name !== campaign.name) {
    const reason = hasSettlement
      ? '정산 기록이 있는 캠페인입니다. 보관 처리를 사용하거나, 삭제하려면 캠페인 이름을 정확히 입력해주세요.'
      : '참여자가 있는 캠페인입니다. 보관 처리를 사용하거나, 삭제하려면 캠페인 이름을 정확히 입력해주세요.';
    return NextResponse.json({
      error: reason,
      code: 'confirm_required',
      action: 'archive',
      details: {
        participants: participants.length,
        consent: consentCount,
        settlements: settlementCount,
      },
    }, { status: 400 });
  }

  // Log BEFORE deleting (FK constraints on participant_id)
  for (const p of participants) {
    await supabaseAdmin.from('inf_access_logs').insert({
      actor_id: user.id,
      participant_id: (p as any).id,
      field_name: 'campaign_cascade_delete',
      action: `campaign=${campaign.name}, consent=${(p as any).consent_status}, settlement=${(p as any).settlement_status}`,
    });
  }

  // Cascade delete: settlements → participants → campaign
  if (participantIds.length > 0) {
    await supabaseAdmin.from('inf_settlements').delete().in('participant_id', participantIds);
    await supabaseAdmin.from('inf_participants').delete().in('id', participantIds);
  }

  const { error } = await supabaseAdmin.from('inf_campaigns').delete().eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    deleted: { participants: participants.length, consent: consentCount, settlements: settlementCount },
  });
}
