import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';
import { decrypt, maskSSN, maskBankAccount, maskBusinessReg } from '@/lib/encryption';
import { calcTaxBreakdown } from '@/lib/influencer/metrics';
import { isValidSettlementTransition } from '@/lib/types/influencer';
import { getNextPaymentDate } from '@/lib/korean-holidays';

export async function GET(req: NextRequest) {
  const tab = req.nextUrl.searchParams.get('tab');
  const action = req.nextUrl.searchParams.get('action');
  const includeArchived = req.nextUrl.searchParams.get('include_archived') === 'true';

  // File download signed URL
  if (action === 'file_url') {
    await requireAdmin();
    const participantId = req.nextUrl.searchParams.get('participant_id');
    const docType = req.nextUrl.searchParams.get('doc_type') || 'biz_reg_cert';
    if (!participantId) return NextResponse.json({ error: 'participant_id required' }, { status: 400 });

    const pathColumn = docType === 'identity_doc' ? 'identity_doc_file_path' : 'biz_reg_file_path';
    const { data: p } = await supabaseAdmin
      .from('inf_participants')
      .select(pathColumn)
      .eq('id', participantId)
      .single();

    const filePath = (p as Record<string, string | null>)?.[pathColumn];
    if (!filePath) return NextResponse.json({ url: null });

    const { data } = await supabaseAdmin.storage
      .from('settlement-docs')
      .createSignedUrl(filePath, 300);

    return NextResponse.json({ url: data?.signedUrl ?? null });
  }

  if (tab === 'pending_docs') {
    // Tab 1: Participants who are paid, consent agreed, but settlement not submitted
    let pendingQuery = supabaseAdmin
      .from('inf_participants')
      .select('id, name, display_name, handle, channel, fee, published_url, planned_upload_date, settlement_status, settlement_token, consent_status, campaign_id, inf_campaigns(name)')
      .in('settlement_status', ['none', 'docs_requested'])
      .gt('fee', 0)
      .not('published_url', 'is', null)
      .order('created_at', { ascending: false });

    // Exclude archived participants (graceful — column may not exist)
    if (!includeArchived) {
      pendingQuery = pendingQuery.eq('is_archived', false);
    }

    let { data: participants, error } = await pendingQuery;

    // Fallback if is_archived column doesn't exist
    if (error?.message?.includes('is_archived')) {
      const fallback = await supabaseAdmin
        .from('inf_participants')
        .select('id, name, display_name, handle, channel, fee, published_url, planned_upload_date, settlement_status, settlement_token, consent_status, campaign_id, inf_campaigns(name)')
        .in('settlement_status', ['none', 'docs_requested'])
        .gt('fee', 0)
        .not('published_url', 'is', null)
        .order('created_at', { ascending: false });
      participants = fallback.data;
      error = fallback.error;
    }

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

  // Always return plaintext (masking removed per spec)
  const unmask = true;

  // Default: settlement records (Tab 2 + Tab 3 + Tab 4)
  let settlementQuery = await supabaseAdmin
    .from('inf_settlements')
    .select(`
      *,
      inf_participants(
        id, name, display_name, handle, channel, fee, bank_name, bank_holder, business_name,
        ssn_enc, bank_account_enc, business_reg_enc, real_name_enc,
        campaign_id, published_url, planned_upload_date, planned_payment_date, post_type, post_count,
        settlement_status, biz_reg_file_path, identity_doc_file_path,
        inf_campaigns(name)
      )
    `)
    .order('created_at', { ascending: false });

  // Fallback if new columns don't exist
  if (settlementQuery.error?.message?.includes('column')) {
    settlementQuery = await supabaseAdmin
      .from('inf_settlements')
      .select(`
        *,
        inf_participants(
          id, name, display_name, handle, channel, fee, bank_name, bank_holder, business_name,
          ssn_enc, bank_account_enc, business_reg_enc, real_name_enc,
          campaign_id, published_url, planned_upload_date, planned_payment_date, post_type, post_count,
          settlement_status,
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

  // Log PII access (fire-and-forget)
  {
    const adminUser = await requireAdmin();
    const pids = (data ?? []).map((s: any) => s.inf_participants?.id).filter(Boolean);
    if (pids.length > 0) {
      const logs = pids.map((pid: string) => ({
        actor_id: adminUser.id,
        participant_id: pid,
        field_name: 'unmask_all',
        action: 'unmask_view',
      }));
      supabaseAdmin.from('inf_access_logs').insert(logs).then(() => {});
    }
  }

  const rows = (data ?? []).map((s: any) => {
    const p = s.inf_participants;
    let ssnDisplay = null;
    let bankAccountDisplay = null;
    let businessRegDisplay = null;
    let realName = null;

    try {
      if (p?.ssn_enc) {
        const decrypted = decrypt(p.ssn_enc);
        ssnDisplay = unmask ? decrypted : maskSSN(decrypted);
      }
    } catch (e) { console.error(`[settlements] ssn decrypt fail pid=${p?.id}`, (e as Error).message); }
    try {
      if (p?.bank_account_enc) {
        const decrypted = decrypt(p.bank_account_enc);
        bankAccountDisplay = unmask ? decrypted : maskBankAccount(decrypted);
      }
    } catch (e) { console.error(`[settlements] bank_account decrypt fail pid=${p?.id}`, (e as Error).message); }
    try {
      if (p?.business_reg_enc) {
        const decrypted = decrypt(p.business_reg_enc);
        businessRegDisplay = unmask ? decrypted : maskBusinessReg(decrypted);
      }
    } catch (e) { console.error(`[settlements] business_reg decrypt fail pid=${p?.id}`, (e as Error).message); }
    try { if (p?.real_name_enc) realName = decrypt(p.real_name_enc); } catch (e) { console.error(`[settlements] real_name decrypt fail pid=${p?.id}`, (e as Error).message); }

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
      ssn_masked: ssnDisplay,
      bank_account_masked: bankAccountDisplay,
      business_reg_masked: businessRegDisplay,
      has_ssn: !!p?.ssn_enc,
      has_bank_account: !!p?.bank_account_enc,
      has_business_reg: !!p?.business_reg_enc,
      has_biz_reg_file: !!p?.biz_reg_file_path,
      has_identity_doc: !!p?.identity_doc_file_path,
      planned_payment_date: p?.planned_payment_date ?? null,
      settlement_status: p?.settlement_status ?? null,
      invoice_status: s.invoice_status ?? null,
      revision_message: s.revision_message ?? null,
      actual_paid_date: s.actual_paid_date ?? null,
      income_tax_amount: s.income_tax_amount ?? null,
      local_tax_amount: s.local_tax_amount ?? null,
      submitted_at: s.created_at ?? null,
      inf_participants: undefined,
    };
  });

  return NextResponse.json(rows);
}

export async function PUT(req: NextRequest) {
  const user = await requireAdmin();
  const body = await req.json();

  // Settlement status transition action (confirm / revision_request / mark_paid)
  if (body.action === 'confirm' || body.action === 'revision_request' || body.action === 'mark_paid') {
    const { settlement_id } = body;
    if (!settlement_id) return NextResponse.json({ error: 'settlement_id required' }, { status: 400 });

    const { data: settlement } = await supabaseAdmin
      .from('inf_settlements')
      .select('id, participant_id, payment_status, gross_amount, tax_type')
      .eq('id', settlement_id)
      .single();

    if (!settlement) return NextResponse.json({ error: 'Settlement not found' }, { status: 404 });

    // Get current participant settlement_status
    const { data: participant } = await supabaseAdmin
      .from('inf_participants')
      .select('settlement_status')
      .eq('id', settlement.participant_id)
      .single();

    const currentStatus = participant?.settlement_status || 'docs_submitted';

    if (body.action === 'confirm') {
      // docs_submitted → payment_waiting
      if (!isValidSettlementTransition(currentStatus, 'payment_waiting')) {
        return NextResponse.json({ error: `현재 상태(${currentStatus})에서 확인 완료로 전환할 수 없습니다.` }, { status: 400 });
      }

      // Validate net_amount matches calculated value
      const tax = calcTaxBreakdown(settlement.gross_amount, settlement.tax_type);
      const settUpdate: Record<string, unknown> = {
        payment_status: 'confirmed',
        income_tax_amount: tax.incomeTax,
        local_tax_amount: tax.localTax,
        net_amount: tax.netAmount,
      };

      await supabaseAdmin.from('inf_settlements').update(settUpdate).eq('id', settlement_id);

      // Calculate planned_payment_date at confirmation time (1회 확정)
      const paymentDate = getNextPaymentDate(new Date());
      await supabaseAdmin.from('inf_participants').update({
        settlement_status: 'payment_waiting',
        planned_payment_date: paymentDate.toISOString().slice(0, 10),
      }).eq('id', settlement.participant_id);

      await supabaseAdmin.from('inf_access_logs').insert({
        actor_id: user.id, participant_id: settlement.participant_id,
        field_name: 'settlement_status', action: 'confirm',
      });

      return NextResponse.json({ success: true, new_status: 'payment_waiting' });
    }

    if (body.action === 'revision_request') {
      // docs_submitted → docs_requested (수정 요청)
      if (!isValidSettlementTransition(currentStatus, 'docs_requested')) {
        return NextResponse.json({ error: `현재 상태(${currentStatus})에서 수정 요청으로 전환할 수 없습니다.` }, { status: 400 });
      }

      const revisionMessage = body.revision_message || null;
      await supabaseAdmin.from('inf_settlements').update({
        revision_message: revisionMessage,
      }).eq('id', settlement_id);
      await supabaseAdmin.from('inf_participants').update({ settlement_status: 'docs_requested' }).eq('id', settlement.participant_id);

      await supabaseAdmin.from('inf_access_logs').insert({
        actor_id: user.id, participant_id: settlement.participant_id,
        field_name: 'settlement_status', action: 'revision_request',
      });

      return NextResponse.json({ success: true, new_status: 'docs_requested' });
    }

    if (body.action === 'mark_paid') {
      // payment_waiting → paid
      if (!isValidSettlementTransition(currentStatus, 'paid')) {
        return NextResponse.json({ error: `현재 상태(${currentStatus})에서 지급 완료로 전환할 수 없습니다.` }, { status: 400 });
      }

      const actualPaidDate = body.actual_paid_date || new Date().toISOString().slice(0, 10);
      const memo = body.memo ?? null;

      // Recalculate and lock net_amount
      const tax = calcTaxBreakdown(settlement.gross_amount, settlement.tax_type);

      await supabaseAdmin.from('inf_settlements').update({
        payment_status: 'paid',
        paid_date: actualPaidDate,
        actual_paid_date: actualPaidDate,
        net_amount: tax.netAmount,
        income_tax_amount: tax.incomeTax,
        local_tax_amount: tax.localTax,
        memo,
      }).eq('id', settlement_id);
      await supabaseAdmin.from('inf_participants').update({ settlement_status: 'paid' }).eq('id', settlement.participant_id);

      await supabaseAdmin.from('inf_access_logs').insert({
        actor_id: user.id, participant_id: settlement.participant_id,
        field_name: 'payment_status', action: 'mark_paid',
      });

      return NextResponse.json({ success: true, new_status: 'paid' });
    }
  }

  // Batch update (legacy)
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
        // Sync settlement_status on participant
        if (body.payment_status === 'paid' && data.participant_id) {
          await supabaseAdmin
            .from('inf_participants')
            .update({ settlement_status: 'paid' })
            .eq('id', data.participant_id);
        } else if (body.payment_status === 'confirmed' && data.participant_id) {
          await supabaseAdmin
            .from('inf_participants')
            .update({ settlement_status: 'payment_waiting' })
            .eq('id', data.participant_id);
        }
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

  // Single update (generic)
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  // Block manual net_amount changes — it's always calculated
  if (updates.net_amount !== undefined) {
    // Fetch settlement to recalculate
    const { data: existing } = await supabaseAdmin
      .from('inf_settlements')
      .select('gross_amount, tax_type')
      .eq('id', id)
      .single();
    if (existing) {
      const tax = calcTaxBreakdown(updates.gross_amount ?? existing.gross_amount, updates.tax_type ?? existing.tax_type);
      if (Number(updates.net_amount) !== tax.netAmount) {
        return NextResponse.json({
          error: '실지급액은 자동 계산됩니다. 수동 수정 불가.',
          expected: tax.netAmount,
        }, { status: 400 });
      }
    }
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

  // Sync settlement_status on participant
  if (updates.payment_status && data.participant_id) {
    const statusMap: Record<string, string> = {
      'paid': 'paid',
      'confirmed': 'payment_waiting',
      'waiting': 'docs_submitted',
    };
    const newParticipantStatus = statusMap[updates.payment_status];
    if (newParticipantStatus) {
      await supabaseAdmin
        .from('inf_participants')
        .update({ settlement_status: newParticipantStatus })
        .eq('id', data.participant_id);
    }
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

    try {
      const decrypted = decrypt((p as any)[encField]);
      // Fire-and-forget: log access without blocking response
      supabaseAdmin.from('inf_access_logs').insert({
        actor_id: user.id,
        participant_id,
        field_name: field,
        action: 'decrypt',
      }).then(() => {});
      return NextResponse.json({ value: decrypted });
    } catch (e) {
      console.error(`[settlements] decrypt action fail pid=${participant_id} field=${field}`, (e as Error).message);
      return NextResponse.json({ error: '복호화에 실패했습니다. 암호화 키를 확인해주세요.' }, { status: 500 });
    }
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

  // Idempotent: check existing settlement for this participant
  if (body.participant_id) {
    const { data: existing } = await supabaseAdmin
      .from('inf_settlements')
      .select('id')
      .eq('participant_id', body.participant_id)
      .single();

    if (existing) {
      return NextResponse.json({ error: '이미 정산 레코드가 존재합니다.', existing_id: existing.id }, { status: 409 });
    }
  }

  // Calculate tax using single source
  const grossAmount = body.gross_amount || 0;
  const taxType = body.tax_type || 'business_income';
  const tax = calcTaxBreakdown(grossAmount, taxType);

  const insertData: Record<string, unknown> = {
    participant_id: body.participant_id,
    gross_amount: grossAmount,
    tax_type: taxType,
    tax_rate: tax.totalTax > 0 ? (taxType === 'business_income' ? 3.3 : 0) : 0,
    tax_amount: tax.totalTax,
    income_tax_amount: tax.incomeTax,
    local_tax_amount: tax.localTax,
    net_amount: tax.netAmount,
    payment_status: 'waiting',
    planned_date: body.planned_date || null,
    upload_link: body.upload_link || null,
    memo: body.memo || null,
    created_by: user.id,
  };

  let result = await supabaseAdmin
    .from('inf_settlements')
    .insert(insertData)
    .select()
    .single();

  // Fallback if new columns don't exist
  if (result.error?.message?.includes('column')) {
    delete insertData.income_tax_amount;
    delete insertData.local_tax_amount;
    result = await supabaseAdmin
      .from('inf_settlements')
      .insert(insertData)
      .select()
      .single();
  }

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json(result.data, { status: 201 });
}
