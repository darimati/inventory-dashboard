import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { encrypt } from '@/lib/encryption';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // 1. Look up participant by settlement_token
  const { data: participant, error } = await supabaseAdmin
    .from('inf_participants')
    .select(
      'id, name, display_name, fee, channel, post_type, post_count, settlement_status, settlement_token_expires_at, campaign_id, published_url, planned_upload_date',
    )
    .eq('settlement_token', token)
    .single();

  // 2. Not found
  if (error || !participant) {
    return NextResponse.json(
      { error: '유효하지 않은 링크입니다.' },
      { status: 404 },
    );
  }

  // 3. Already submitted
  if (participant.settlement_status === 'docs_submitted') {
    return NextResponse.json({ status: 'already_submitted' });
  }

  // 4. Check expiry
  if (
    participant.settlement_token_expires_at &&
    new Date(participant.settlement_token_expires_at) < new Date()
  ) {
    await supabaseAdmin
      .from('inf_participants')
      .update({ settlement_status: 'expired' })
      .eq('id', participant.id);
    return NextResponse.json({ status: 'expired' });
  }

  // 5. Validate fee
  if (!participant.fee || participant.fee <= 0) {
    return NextResponse.json(
      { error: '고료가 설정되지 않았습니다.' },
      { status: 400 },
    );
  }

  // 6. Join with inf_campaigns to get campaign name
  const { data: campaign } = await supabaseAdmin
    .from('inf_campaigns')
    .select('name')
    .eq('id', participant.campaign_id)
    .single();

  // 7. Fetch settlement_guidance + tax_rates + company_info from inf_settings
  const { data: settingsData } = await supabaseAdmin
    .from('inf_settings')
    .select('key, value')
    .in('key', ['settlement_guidance', 'tax_rates', 'company_info']);

  const settingsMap: Record<string, unknown> = {};
  for (const s of settingsData ?? []) settingsMap[s.key] = s.value;

  const guidance = (settingsMap.settlement_guidance as {
    input_notice: string;
    settlement_notice: string;
  }) ?? { input_notice: '', settlement_notice: '' };

  const taxRates = (settingsMap.tax_rates as Record<string, number>) ?? {
    business_income: 3.3, tax_invoice: 0, tax_exempt_invoice: 0, simplified_business: 0,
  };

  const companyInfo = (settingsMap.company_info as {
    name: string; biz_reg: string; representative: string; address: string;
  }) ?? null;

  // 8. Build content display from post_type/post_count
  let contentDisplay: string | null = null;
  if (participant.post_type) {
    const FORMAT_LABELS: Record<string, string> = { reels: '릴스', feed: '피드', story: '스토리', shorts: '숏츠', video: '영상' };
    contentDisplay = `${FORMAT_LABELS[participant.post_type] ?? participant.post_type} ${participant.post_count ?? 1}건`;
  }

  // 9. Return settlement page data
  return NextResponse.json({
    status: 'valid',
    campaign_name: campaign?.name ?? '',
    participant_name: participant.display_name || participant.name,
    fee: participant.fee,
    channel: participant.channel,
    content_display: contentDisplay,
    published_url: participant.published_url || null,
    planned_upload_date: participant.planned_upload_date || null,
    tax_rates: taxRates,
    guidance,
    company_info: companyInfo,
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
    .select('id, fee, settlement_status, settlement_token_expires_at')
    .eq('settlement_token', token)
    .single();

  if (error || !participant) {
    return NextResponse.json(
      { error: '유효하지 않은 링크입니다.' },
      { status: 404 },
    );
  }

  if (participant.settlement_status === 'docs_submitted') {
    return NextResponse.json(
      { error: '이미 제출이 완료되었습니다.' },
      { status: 400 },
    );
  }

  if (
    participant.settlement_token_expires_at &&
    new Date(participant.settlement_token_expires_at) < new Date()
  ) {
    await supabaseAdmin
      .from('inf_participants')
      .update({ settlement_status: 'expired' })
      .eq('id', participant.id);
    return NextResponse.json(
      { error: '링크가 만료되었습니다.' },
      { status: 410 },
    );
  }

  // 2. Strip hyphens/spaces from sensitive fields
  const taxType: string = body.tax_type;
  const ssn = body.ssn ? String(body.ssn).replace(/[-\s]/g, '') : '';
  const businessReg = body.business_reg
    ? String(body.business_reg).replace(/[-\s]/g, '')
    : '';
  const bankAccount = body.bank_account
    ? String(body.bank_account).replace(/[-\s]/g, '')
    : '';

  // 3. Determine tax rate from inf_settings
  const { data: taxRateSetting } = await supabaseAdmin
    .from('inf_settings')
    .select('value')
    .eq('key', 'tax_rates')
    .single();

  const taxRates = (taxRateSetting?.value as Record<string, number>) ?? {
    business_income: 3.3,
    tax_invoice: 0,
    tax_exempt_invoice: 0,
    simplified_business: 0,
  };
  const taxRate = taxRates[taxType] ?? 0;

  // 4. Get gross_amount from participant fee
  const grossAmount = participant.fee;

  // 5. Calculate tax and net amounts
  const taxAmount = Math.round(grossAmount * taxRate / 100);
  const netAmount = grossAmount - taxAmount;

  // 6. Build participant update — encrypt PII
  const updates: Record<string, unknown> = {
    bank_name: body.bank_name || null,
    bank_holder: body.bank_holder || null,
    bank_account_enc: bankAccount ? encrypt(bankAccount) : null,
    settlement_status: 'docs_submitted',
    settlement_token: null,
    settlement_token_expires_at: null,
  };

  if (taxType === 'business_income') {
    updates.real_name_enc = body.real_name ? encrypt(body.real_name) : null;
    updates.ssn_enc = ssn ? encrypt(ssn) : null;
  } else if (taxType === 'tax_invoice' || taxType === 'tax_exempt_invoice' || taxType === 'simplified_business') {
    updates.business_name = body.business_name || null;
    updates.business_reg_enc = businessReg ? encrypt(businessReg) : null;
  }

  const { error: updateError } = await supabaseAdmin
    .from('inf_participants')
    .update(updates)
    .eq('id', participant.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // 7. Create settlement record in inf_settlements
  const settlementInsert: Record<string, unknown> = {
    participant_id: participant.id,
    gross_amount: grossAmount,
    tax_type: taxType,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    net_amount: netAmount,
    payment_status: 'waiting',
    upload_link: null,
  };

  // Try adding tax_rate_snapshot (column may not exist yet)
  settlementInsert.tax_rate_snapshot = taxRates;

  let settlementResult = await supabaseAdmin
    .from('inf_settlements')
    .insert(settlementInsert);

  // Fallback if tax_rate_snapshot column doesn't exist
  if (settlementResult.error?.message?.includes('tax_rate_snapshot')) {
    delete settlementInsert.tax_rate_snapshot;
    settlementResult = await supabaseAdmin
      .from('inf_settlements')
      .insert(settlementInsert);
  }

  const settlementError = settlementResult.error;

  if (settlementError) {
    return NextResponse.json(
      { error: settlementError.message },
      { status: 500 },
    );
  }

  // 8. Return success
  return NextResponse.json({ success: true });
}

/* ── PUT: File upload (biz reg cert) ─────────────── */

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // 1. Validate token
  const { data: participant, error } = await supabaseAdmin
    .from('inf_participants')
    .select('id, settlement_status')
    .eq('settlement_token', token)
    .single();

  // Also allow upload after submission (token cleared) — lookup by recent submission
  if (error || !participant) {
    return NextResponse.json({ error: '유효하지 않은 링크입니다.' }, { status: 404 });
  }

  // 2. Parse multipart form data
  const formData = await req.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return NextResponse.json({ error: '파일을 선택해주세요.' }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'JPG, PNG, WebP, PDF 파일만 업로드 가능합니다.' }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: '파일 크기는 5MB 이하만 가능합니다.' }, { status: 400 });
  }

  // 3. Upload to Supabase Storage
  const ext = file.name.split('.').pop() ?? 'jpg';
  const storagePath = `${participant.id}/biz_reg_cert.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabaseAdmin.storage
    .from('settlement-docs')
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: true,
    });

  if (uploadError) {
    // Bucket might not exist — try to create it
    if (uploadError.message?.includes('not found') || uploadError.message?.includes('Bucket')) {
      await supabaseAdmin.storage.createBucket('settlement-docs', {
        public: false,
        fileSizeLimit: MAX_FILE_SIZE,
      });
      // Retry upload
      const { error: retryError } = await supabaseAdmin.storage
        .from('settlement-docs')
        .upload(storagePath, buffer, { contentType: file.type, upsert: true });

      if (retryError) {
        return NextResponse.json({ error: '파일 업로드에 실패했습니다.' }, { status: 500 });
      }
    } else {
      return NextResponse.json({ error: '파일 업로드에 실패했습니다.' }, { status: 500 });
    }
  }

  // 4. Save file path to participant record (graceful — column may not exist)
  const { error: updateError } = await supabaseAdmin
    .from('inf_participants')
    .update({ biz_reg_file_path: storagePath })
    .eq('id', participant.id);

  if (updateError?.message?.includes('biz_reg_file_path')) {
    // Column doesn't exist yet — file is still saved in storage
    console.warn('[settlement file upload] biz_reg_file_path column not found, skipping participant update');
  }

  return NextResponse.json({ success: true, path: storagePath });
}
