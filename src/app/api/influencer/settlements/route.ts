import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';
import { decrypt, maskSSN, maskBankAccount, maskBusinessReg } from '@/lib/encryption';

export async function GET(req: NextRequest) {
  const tab = req.nextUrl.searchParams.get('tab');
  const action = req.nextUrl.searchParams.get('action');

  // File download signed URL
  if (action === 'file_url') {
    await requireAdmin();
    const participantId = req.nextUrl.searchParams.get('participant_id');
    if (!participantId) return NextResponse.json({ error: 'participant_id required' }, { status: 400 });

    const { data: p } = await supabaseAdmin
      .from('inf_participants')
      .select('biz_reg_file_path')
      .eq('id', participantId)
      .single();

    if (!p?.biz_reg_file_path) return NextResponse.json({ url: null });

    const { data } = await supabaseAdmin.storage
      .from('settlement-docs')
      .createSignedUrl(p.biz_reg_file_path, 300);

    return NextResponse.json({ url: data?.signedUrl ?? null });
  }

  if (tab === 'pending_docs') {
    // Tab 1: Participants who are paid, consent agreed, but settlement not submitted
    const { data: participants, error } = await supabaseAdmin
      .from('inf_participants')
      .select('id, name, display_name, handle, channel, fee, published_url, planned_upload_date, settlement_status, settlement_token, consent_status, campaign_id, inf_campaigns(name)')
      .in('settlement_status', ['none', 'docs_requested'])
      .gt('fee', 0)
      .not('published_url', 'is', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[settlements GET pending_docs]', error.message);
      return NextResponse.json([]);
    }

    const rows = (participants ?? []).map((p: any) => ({
      id: p.id,
      name: p.name || p.display_name,
      handle: p.handle ?? null,
      channel: p.channel,
      campaign_name: p.inf_campaigns?.name ?? '',
      fee: p.fee,
      published_url: p.published_url,
      planned_upload_date: p.planned_upload_date,
      settlement_status: p.settlement_status,
      settlement_token: p.settlement_token,
      consent_status: p.consent_status,
    }));

    return NextResponse.json(rows);
  }

  // Default: settlement records (Tab 2 + Tab 3)
  let settlementQuery = await supabaseAdmin
    .from('inf_settlements')
    .select(`
      *,
      inf_participants(
        id, name, display_name, handle, channel, fee, bank_name, bank_holder, business_name,
        ssn_enc, bank_account_enc, business_reg_enc, real_name_enc,
        campaign_id, published_url, planned_upload_date, post_type, post_count,
        inf_campaigns(name)
      )
    `)
    .order('created_at', { ascending: false });

  // Fallback if encrypted columns don't exist
  if (settlementQuery.error?.message?.includes('column')) {
    settlementQuery = await supabaseAdmin
      .from('inf_settlements')
      .select(`
        *,
        inf_participants(
          id, name, display_name, handle, channel, fee, bank_name, bank_holder, business_name,
          campaign_id, published_url, planned_upload_date, post_type, post_count,
          inf_campaigns(name)
        )
      `)
      .order('created_at', { ascending: false });
  }

  const { data, error } = settlementQuery;

  if (error) {
    console.error('[settlements GET]', error.message);
    return NextResponse.json([]);
  }

  const masked = (data ?? []).map((s: any) => {
    const p = s.inf_participants;
    let ssnMasked = null;
    let bankAccountMasked = null;
    let businessRegMasked = null;
    let realName = null;

    try { if (p?.ssn_enc) ssnMasked = maskSSN(decrypt(p.ssn_enc)); } catch { /* ignore */ }
    try { if (p?.bank_account_enc) bankAccountMasked = maskBankAccount(decrypt(p.bank_account_enc)); } catch { /* ignore */ }
    try { if (p?.business_reg_enc) businessRegMasked = maskBusinessReg(decrypt(p.business_reg_enc)); } catch { /* ignore */ }
    try { if (p?.real_name_enc) realName = decrypt(p.real_name_enc); } catch { /* ignore */ }

    return {
      ...s,
      participant_id: p?.id ?? '',
      participant_name: p?.name || p?.display_name || '',
      participant_handle: p?.handle ?? null,
      campaign_name: p?.inf_campaigns?.name ?? '',
      channel: p?.channel ?? '',
      bank_name: p?.bank_name ?? '',
      bank_holder: p?.bank_holder ?? '',
      business_name: p?.business_name ?? '',
      real_name: realName ?? '',
      published_url: p?.published_url ?? '',
      content_formats: p?.post_type ? [{ format: p.post_type, count: p.post_count ?? 1 }] : [],
      ssn_masked: ssnMasked,
      bank_account_masked: bankAccountMasked,
      business_reg_masked: businessRegMasked,
      has_ssn: !!p?.ssn_enc,
      has_bank_account: !!p?.bank_account_enc,
      has_business_reg: !!p?.business_reg_enc,
      has_biz_reg_file: !!p?.biz_reg_file_path,
      invoice_status: s.invoice_status ?? null,
      // submitted_at = settlement created_at (when influencer submitted their info)
      submitted_at: s.created_at ?? null,
      inf_participants: undefined,
    };
  });

  return NextResponse.json(masked);
}

export async function PUT(req: NextRequest) {
  const user = await requireAdmin();
  const body = await req.json();

  // Batch update
  if (body.batch && Array.isArray(body.ids)) {
    const updates: Record<string, unknown> = {};
    if (body.payment_status) updates.payment_status = body.payment_status;
    if (body.payment_status === 'paid') updates.paid_date = new Date().toISOString().slice(0, 10);

    const results = [];
    for (const id of body.ids) {
      const { data, error } = await supabaseAdmin
        .from('inf_settlements')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (!error && data) {
        // Sync settlement_status on participant when marking paid
        if (body.payment_status === 'paid' && data.participant_id) {
          await supabaseAdmin
            .from('inf_participants')
            .update({ settlement_status: 'paid' })
            .eq('id', data.participant_id);
        }
        // Log access for batch operations
        await supabaseAdmin.from('inf_access_logs').insert({
          actor_id: user.id,
          participant_id: data.participant_id,
          field_name: 'payment_status',
          action: `batch_update_${body.payment_status}`,
        });
        results.push(data);
      }
    }
    return NextResponse.json(results);
  }

  // Single update
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  if (updates.payment_status === 'paid' && !updates.paid_date) {
    updates.paid_date = new Date().toISOString().slice(0, 10);
  }

  const { data, error } = await supabaseAdmin
    .from('inf_settlements')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Sync settlement_status on participant when marking paid
  if (updates.payment_status === 'paid' && data.participant_id) {
    await supabaseAdmin
      .from('inf_participants')
      .update({ settlement_status: 'paid' })
      .eq('id', data.participant_id);
  }

  // Log status change
  if (updates.payment_status) {
    await supabaseAdmin.from('inf_access_logs').insert({
      actor_id: user.id,
      participant_id: data.participant_id,
      field_name: 'payment_status',
      action: `update_${updates.payment_status}`,
    });
  }

  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const user = await requireAdmin();
  const body = await req.json();

  if (body.action === 'decrypt') {
    const { participant_id, field } = body;
    if (!participant_id || !field) {
      return NextResponse.json({ error: 'participant_id and field required' }, { status: 400 });
    }

    const encField = field === 'ssn' ? 'ssn_enc'
      : field === 'bank_account' ? 'bank_account_enc'
      : field === 'real_name' ? 'real_name_enc'
      : 'business_reg_enc';

    const { data: p } = await supabaseAdmin
      .from('inf_participants')
      .select(encField)
      .eq('id', participant_id)
      .single();

    if (!p || !(p as any)[encField]) {
      return NextResponse.json({ error: 'No data' }, { status: 404 });
    }

    await supabaseAdmin.from('inf_access_logs').insert({
      actor_id: user.id,
      participant_id,
      field_name: field,
      action: 'decrypt',
    });

    const decrypted = decrypt((p as any)[encField]);
    return NextResponse.json({ value: decrypted });
  }

  if (body.action === 'export_excel') {
    // Return data for excel export — decrypted bank info with logging
    const ids = body.ids;
    if (!ids || !Array.isArray(ids)) {
      return NextResponse.json({ error: 'ids required' }, { status: 400 });
    }

    const { data: settlements } = await supabaseAdmin
      .from('inf_settlements')
      .select(`
        *,
        inf_participants(
          id, name, display_name, bank_name, bank_holder,
          bank_account_enc, campaign_id,
          inf_campaigns(name)
        )
      `)
      .in('id', ids);

    const exportRows = [];
    for (const s of settlements ?? []) {
      const p = (s as any).inf_participants;
      let bankAccount = '';
      try {
        if (p?.bank_account_enc) bankAccount = decrypt(p.bank_account_enc);
      } catch { /* ignore */ }

      // Log export access
      await supabaseAdmin.from('inf_access_logs').insert({
        actor_id: user.id,
        participant_id: p?.id,
        field_name: 'bank_account',
        action: 'export_excel',
      });

      exportRows.push({
        name: p?.display_name ?? p?.name ?? '',
        campaign: p?.inf_campaigns?.name ?? '',
        bank_name: p?.bank_name ?? '',
        bank_holder: p?.bank_holder ?? '',
        bank_account: bankAccount,
        gross_amount: s.gross_amount,
        tax_amount: s.tax_amount,
        net_amount: s.net_amount,
      });
    }

    return NextResponse.json(exportRows);
  }

  const { data, error } = await supabaseAdmin
    .from('inf_settlements')
    .insert({
      participant_id: body.participant_id,
      gross_amount: body.gross_amount,
      tax_type: body.tax_type || null,
      tax_rate: body.tax_rate || null,
      tax_amount: body.tax_amount || null,
      net_amount: body.net_amount || null,
      payment_status: 'waiting',
      planned_date: body.planned_date || null,
      upload_link: body.upload_link || null,
      memo: body.memo || null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
