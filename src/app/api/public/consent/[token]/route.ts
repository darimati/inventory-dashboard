import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { isPaidCollab } from '@/lib/types/influencer';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // 1. Look up participant by consent_token
  const { data: participant, error } = await supabaseAdmin
    .from('inf_participants')
    .select('*')
    .eq('consent_token', token)
    .single();

  if (error || !participant) {
    return NextResponse.json(
      { error: '유효하지 않은 링크입니다' },
      { status: 404 },
    );
  }

  if (participant.consent_status === 'agreed') {
    const fmtPhone = participant.phone
      ? participant.phone.replace(/(\d{3})(\d{3,4})(\d{4})/, '$1-$2-$3')
      : null;
    return NextResponse.json({
      status: 'already_submitted',
      participant_name: participant.display_name ?? participant.name,
      channel_name: participant.name,
      phone: fmtPhone,
      planned_draft_date: participant.planned_draft_date ?? null,
      planned_edit_date: participant.planned_edit_date ?? null,
      planned_upload_date: participant.planned_upload_date ?? null,
      consent_agreed_at: participant.consent_agreed_at ?? null,
    });
  }

  if (
    participant.consent_token_expires_at &&
    new Date(participant.consent_token_expires_at) < new Date()
  ) {
    await supabaseAdmin
      .from('inf_participants')
      .update({ consent_status: 'expired' })
      .eq('id', participant.id);
    return NextResponse.json({ status: 'expired' });
  }

  // 4.5. Fetch campaign for advertised_products + collab_type
  const { data: campaign } = await supabaseAdmin
    .from('inf_campaigns')
    .select('advertised_products, collab_type')
    .eq('id', participant.campaign_id)
    .single();

  const advertisedProducts: string[] = (campaign?.advertised_products as string[]) ?? [];

  // 5. Fetch consent text settings + progress conditions
  const { data: settings } = await supabaseAdmin
    .from('inf_settings')
    .select('key, value')
    .in('key', ['consent_advertising', 'consent_advertising_paid', 'consent_advertising_unpaid', 'consent_secondary_use', 'consent_privacy', 'consent_progress_conditions']);

  const settingsMap: Record<string, unknown> = {};
  for (const s of settings ?? []) {
    settingsMap[s.key] = s.value;
  }

  // 6. Determine collab type: participant > campaign > fee fallback
  const productName = participant.product_set_name || participant.product || null;
  const collabType = participant.collab_type || campaign?.collab_type || null;
  const isPaid = collabType ? isPaidCollab(collabType) : (participant.fee > 0);
  const collabLabel = collabType
    ? (isPaid ? '고정고료' : '무가시딩')
    : (participant.fee > 0 ? '고정고료' : '무가시딩');

  // 7. Build content format display from legacy or v3 columns
  let contentDisplay: string | null = null;
  if (participant.content_formats && Array.isArray(participant.content_formats) && participant.content_formats.length > 0) {
    const FORMAT_LABELS: Record<string, string> = { reels: '릴스', feed: '피드', story: '스토리', shorts: '숏츠', video: '영상' };
    contentDisplay = participant.content_formats
      .map((f: { format: string; count: number }) => `${FORMAT_LABELS[f.format] ?? f.format} ${f.count}건`)
      .join(', ');
  } else if (participant.post_type) {
    const FORMAT_LABELS: Record<string, string> = { reels: '릴스', feed: '피드', story: '스토리', shorts: '숏츠', video: '영상' };
    const label = FORMAT_LABELS[participant.post_type] ?? participant.post_type;
    contentDisplay = `${label} ${participant.post_count ?? 1}건`;
  }

  return NextResponse.json({
    status: 'valid',
    collab_type: collabType ?? (participant.fee > 0 ? 'fixed_fee' : 'free_seeding'),
    collab_label: collabLabel,
    is_paid: isPaid,
    participant_name: participant.display_name ?? participant.name,
    channel_name: participant.name,
    fee: participant.fee,
    channel: participant.channel,
    product_name: productName,
    advertised_products: advertisedProducts,
    content_display: contentDisplay,
    secondary_use: participant.secondary_use ?? false,
    secondary_use_period: participant.secondary_use_period,
    // Privacy: use DB only if body is non-empty, else client default
    consent_privacy: (() => {
      const db = settingsMap.consent_privacy as { title: string; body: string } | undefined;
      return db?.body ? db : null;
    })(),
    // Ad consent: select paid/unpaid variant — check specific keys, then single key, then null (client default)
    consent_advertising: (() => {
      const specificKey = isPaid ? 'consent_advertising_paid' : 'consent_advertising_unpaid';
      const specific = settingsMap[specificKey] as { title: string; body: string } | undefined;
      if (specific?.body) return specific;
      const single = settingsMap.consent_advertising as { title: string; body: string } | undefined;
      // Skip old default text (contains '업체로부터' or '작성되었으며')
      if (single?.body && !single.body.includes('업체로부터') && !single.body.includes('작성되었으며')) return single;
      return null;
    })(),
    // Secondary use: use DB if non-empty and not old text, else null (client default)
    consent_secondary_use: (() => {
      const db = settingsMap.consent_secondary_use as { title: string; body: string } | undefined;
      if (!db?.body) return null;
      if (db.body.includes('콘텐츠(사진, 영상, 텍스트 등)')) return null; // old text
      return db;
    })(),
    progress_conditions: (settingsMap.consent_progress_conditions as { conditions: { text: string; paid_only: boolean }[] })?.conditions ?? [],
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = await req.json();

  // 1. Validate token
  const { data: participant, error } = await supabaseAdmin
    .from('inf_participants')
    .select('id, campaign_id, consent_status, consent_token_expires_at, fee, secondary_use, secondary_use_period')
    .eq('consent_token', token)
    .single();

  if (error || !participant) {
    return NextResponse.json(
      { error: '유효하지 않은 링크입니다' },
      { status: 404 },
    );
  }

  if (participant.consent_status === 'agreed') {
    return NextResponse.json(
      { error: '이미 동의가 완료되었습니다' },
      { status: 400 },
    );
  }

  if (
    participant.consent_token_expires_at &&
    new Date(participant.consent_token_expires_at) < new Date()
  ) {
    await supabaseAdmin
      .from('inf_participants')
      .update({ consent_status: 'expired' })
      .eq('id', participant.id);
    return NextResponse.json(
      { error: '링크가 만료되었습니다' },
      { status: 410 },
    );
  }

  // 2. Strip hyphens/spaces from phone number
  const phone = body.phone
    ? String(body.phone).replace(/[-\s]/g, '')
    : null;

  // 3. Get consent IP
  const consentIp =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null;

  // 4. Build consent snapshot — capture current consent texts at submission time
  // Fetch campaign collab_type for accurate isPaid determination
  const { data: campaignData } = await supabaseAdmin
    .from('inf_campaigns')
    .select('collab_type')
    .eq('id', participant.campaign_id)
    .maybeSingle();
  const postCollabType = campaignData?.collab_type || null;
  const isPaid = postCollabType ? isPaidCollab(postCollabType) : (participant.fee > 0);

  const { data: snapSettings } = await supabaseAdmin
    .from('inf_settings')
    .select('key, value')
    .in('key', [
      'consent_advertising', 'consent_advertising_paid', 'consent_advertising_unpaid',
      'consent_secondary_use', 'consent_privacy', 'consent_progress_conditions',
    ]);

  const snapMap: Record<string, unknown> = {};
  for (const s of snapSettings ?? []) snapMap[s.key] = s.value;

  const privacyDb = snapMap.consent_privacy as { title: string; body: string } | undefined;
  const adPaidDb = snapMap.consent_advertising_paid as { title: string; body: string } | undefined;
  const adUnpaidDb = snapMap.consent_advertising_unpaid as { title: string; body: string } | undefined;
  const adDb = snapMap.consent_advertising as { title: string; body: string } | undefined;
  const secDb = snapMap.consent_secondary_use as { title: string; body: string } | undefined;
  const condDb = snapMap.consent_progress_conditions as { conditions: { text: string; paid_only: boolean }[] } | undefined;

  const consentSnapshot: Record<string, unknown> = {
    privacy: privacyDb?.body ? privacyDb : null,
    advertising: (() => {
      const specificKey = isPaid ? 'consent_advertising_paid' : 'consent_advertising_unpaid';
      const specific = snapMap[specificKey] as { title: string; body: string } | undefined;
      if (specific?.body) return specific;
      if (adDb?.body && !adDb.body.includes('업체로부터') && !adDb.body.includes('작성되었으며')) return adDb;
      return null;
    })(),
    conditions: condDb?.conditions ?? null,
    secondary_use: (isPaid && participant.secondary_use && secDb?.body && !secDb.body.includes('콘텐츠(사진, 영상, 텍스트 등)'))
      ? secDb : null,
  };

  // 5. Update participant — schedule, phone, personal info, consent status
  const updates: Record<string, unknown> = {
    planned_draft_date: body.planned_draft_date || null,
    planned_edit_date: body.planned_edit_date || null,
    planned_upload_date: body.planned_upload_date || null,
    phone: phone,
    delivery_name: body.delivery_name || null,
    delivery_phone: body.delivery_phone
      ? String(body.delivery_phone).replace(/[-\s]/g, '')
      : null,
    delivery_address: body.delivery_address || null,
    consent_status: 'agreed',
    consent_agreed_at: new Date().toISOString(),
    consent_ip: consentIp,
    consent_snapshot: consentSnapshot,
  };

  // Save real name → display_name, channel name → name (if provided)
  if (body.real_name) {
    updates.display_name = body.real_name;
  }
  if (body.channel_name) {
    updates.name = body.channel_name;
  }

  let updateResult = await supabaseAdmin
    .from('inf_participants')
    .update(updates)
    .eq('id', participant.id);

  // If consent_snapshot column doesn't exist yet, retry without it
  if (updateResult.error?.message?.includes('consent_snapshot')) {
    delete updates.consent_snapshot;
    updateResult = await supabaseAdmin
      .from('inf_participants')
      .update(updates)
      .eq('id', participant.id);
  }

  if (updateResult.error) {
    return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
