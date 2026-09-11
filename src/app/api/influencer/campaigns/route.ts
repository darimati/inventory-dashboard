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
  await requireAdmin();
  const body = await req.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
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
  const hasSettlementStatus = participants.some((p: any) =>
    ['docs_submitted', 'payment_requested', 'paid'].includes(p.settlement_status)
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

  // Require name confirmation for settlement-included deletions
  if (hasSettlement && confirm_name !== campaign.name) {
    return NextResponse.json({
      error: '정산 정보가 포함된 캠페인입니다. 캠페인 이름을 정확히 입력해주세요.',
      code: 'confirm_required',
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
