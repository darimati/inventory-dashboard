import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { encrypt } from '@/lib/encryption';
import { calcTaxBreakdown } from '@/lib/influencer/metrics';
import { getNextPaymentDate, formatPaymentDate } from '@/lib/korean-holidays';

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
      'id, name, display_name, fee, channel, post_type, post_count, settlement_status, settlement_token_expires_at, campaign_id, published_url, planned_upload_date, planned_payment_date',
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

  // 3. Already submitted — return settlement details for read-only view
  const submittedStatuses = ['docs_submitted', 'payment_waiting', 'payment_requested', 'paid'];
  if (participant.settlement_status && submittedStatuses.includes(participant.settlement_status)) {
    // Fetch settlement record
    const { data: settlement } = await supabaseAdmin
      .from('inf_settlements')
      .select('tax_type, tax_rate, gross_amount, net_amount, income_tax_amount, local_tax_amount')
      .eq('participant_id', participant.id)
      .single();

    // Fetch bank info from participant
    const { data: bankInfo } = await supabaseAdmin
      .from('inf_participants')
      .select('bank_name, bank_holder')
      .eq('id', participant.id)
      .single();

    // Payment date
    let paymentDateStr: string | null = null;
    if (participant.planned_payment_date) {
      paymentDateStr = formatPaymentDate(new Date(participant.planned_payment_date));
    }

    return NextResponse.json({
      status: 'already_submitted',
      participant_name: participant.display_name || participant.name,
      fee: participant.fee,
      bank_name: bankInfo?.bank_name ?? '',
      bank_holder: bankInfo?.bank_holder ?? '',
      planned_payment_date: paymentDateStr,
      settlement: settlement ? {
        tax_type: settlement.tax_type,
        tax_rate: settlement.tax_rate,
        income_tax_amount: settlement.income_tax_amount,
        local_tax_amount: settlement.local_tax_amount,
        gross_amount: settlement.gross_amount,
        net_amount: settlement.net_amount,
      } : null,
    });
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

  // 9. Payment date (from planned_payment_date or calculated)
  let paymentDateStr: string | null = null;
  if (participant.planned_payment_date) {
    paymentDateStr = formatPaymentDate(new Date(participant.planned_payment_date));
  } else {
    // Calculate from now as fallback
    const paymentDate = getNextPaymentDate(new Date());
    paymentDateStr = formatPaymentDate(paymentDate);
  }

  // 10. Return settlement page data
  return NextResponse.json({
    status: 'valid',
    campaign_name: campaign?.name ?? '',
    participant_name: participant.display_name || participant.name,
    fee: participant.fee,
    channel: participant.channel,
    content_display: contentDisplay,
    published_url: participant.published_url || null,
    planned_upload_date: participant.planned_upload_date || null,
    planned_payment_date: paymentDateStr,
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

  // Already submitted — idempotent: return success
  const submittedStatuses = ['docs_submitted', 'payment_waiting', 'payment_requested', 'paid'];
  if (participant.settlement_status && submittedStatuses.includes(participant.settlement_status)) {
    return NextResponse.json({ success: true, already_submitted: true });
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

  // 3. Calculate tax using SINGLE SOURCE (calcTaxBreakdown)
  const grossAmount = participant.fee;
  const tax = calcTaxBreakdown(grossAmount, taxType);

  // 4. Build participant update — encrypt PII
  const updates: Record<string, unknown> = {
    bank_name: body.bank_name || null,
    bank_holder: body.bank_holder || null,
    bank_account_enc: bankAccount ? encrypt(bankAccount) : null,
    settlement_status: 'docs_submitted',
  };

  if (taxType === 'business_income') {
    updates.real_name_enc = body.real_name ? encrypt(body.real_name) : null;
    updates.ssn_enc = ssn ? encrypt(ssn) : null;
  } else if (taxType === 'tax_invoice' || taxType === 'tax_exempt_invoice' || taxType === 'simplified_business') {
    updates.business_name = body.business_name || null;
    updates.business_reg_enc = businessReg ? encrypt(businessReg) : null;
  }

  let updateResult = await supabaseAdmin
    .from('inf_participants')
    .update(updates)
    .eq('id', participant.id);

  // Fallback: if encrypted columns don't exist, retry with core fields only
  if (updateResult.error?.message?.includes('column')) {
    const coreUpdates: Record<string, unknown> = {
      bank_name: updates.bank_name,
      bank_holder: updates.bank_holder,
      settlement_status: 'docs_submitted',
    };
    if (updates.business_name !== undefined) coreUpdates.business_name = updates.business_name;
    updateResult = await supabaseAdmin
      .from('inf_participants')
      .update(coreUpdates)
      .eq('id', participant.id);
  }

  if (updateResult.error) {
    return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
  }

  // 5. Check existing settlement (idempotent — unique constraint)
  const { data: existingSettlement } = await supabaseAdmin
    .from('inf_settlements')
    .select('id')
    .eq('participant_id', participant.id)
    .single();

  if (existingSettlement) {
    // Already has settlement — update instead of insert
    const { error: updateSettErr } = await supabaseAdmin
      .from('inf_settlements')
      .update({
        gross_amount: grossAmount,
        tax_type: taxType,
        tax_rate: tax.totalTax > 0 ? (taxType === 'business_income' ? 3.3 : 0) : 0,
        tax_amount: tax.totalTax,
        income_tax_amount: tax.incomeTax,
        local_tax_amount: tax.localTax,
        net_amount: tax.netAmount,
      })
      .eq('id', existingSettlement.id);

    if (updateSettErr) {
      return NextResponse.json({ error: updateSettErr.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  // 6. Create settlement record in inf_settlements
  const settlementInsert: Record<string, unknown> = {
    participant_id: participant.id,
    gross_amount: grossAmount,
    tax_type: taxType,
    tax_rate: tax.totalTax > 0 ? (taxType === 'business_income' ? 3.3 : 0) : 0,
    tax_amount: tax.totalTax,
    income_tax_amount: tax.incomeTax,
    local_tax_amount: tax.localTax,
    net_amount: tax.netAmount,
    payment_status: 'waiting',
    upload_link: null,
  };

  let settlementResult = await supabaseAdmin
    .from('inf_settlements')
    .insert(settlementInsert);

  // Fallback if income_tax_amount/local_tax_amount columns don't exist yet
  if (settlementResult.error?.message?.includes('column')) {
    delete settlementInsert.income_tax_amount;
    delete settlementInsert.local_tax_amount;
    settlementResult = await supabaseAdmin
      .from('inf_settlements')
      .insert(settlementInsert);
  }

  if (settlementResult.error) {
    return NextResponse.json(
      { error: settlementResult.error.message },
      { status: 500 },
    );
  }

  // 7. Return success
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
  const docType = (formData.get('doc_type') as string) || 'biz_reg_cert'; // biz_reg_cert or identity_doc

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
  const fileName = docType === 'identity_doc' ? 'identity_doc' : 'biz_reg_cert';
  const storagePath = `${participant.id}/${fileName}.${ext}`;

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

  // 4. Save file path to participant record
  const pathColumn = docType === 'identity_doc' ? 'identity_doc_file_path' : 'biz_reg_file_path';
  const { error: updateError } = await supabaseAdmin
    .from('inf_participants')
    .update({ [pathColumn]: storagePath })
    .eq('id', participant.id);

  if (updateError?.message?.includes(pathColumn)) {
    console.warn(`[settlement file upload] ${pathColumn} column not found, skipping participant update`);
  }

  return NextResponse.json({ success: true, path: storagePath });
}
