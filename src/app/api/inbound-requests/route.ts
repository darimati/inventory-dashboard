import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

const VALID_REJECT_REASONS = ['3pl_error', 'coupang_reject', 'damaged', 'other'];

/**
 * GET /api/inbound-requests
 */
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status');
  const product = req.nextUrl.searchParams.get('product');

  let query = supabaseAdmin
    .from('rg_inbound_requests')
    .select('*')
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);
  if (product) query = query.eq('product', product);

  const { data, error } = await query;

  if (error) {
    if (error.message.includes('does not exist') || error.code === '42P01') {
      return NextResponse.json({ data: [], _tableNotReady: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}

/**
 * POST /api/inbound-requests
 * Body: { product, option?, quantity, warehouse?, coupang_deadline, coupang_inbound_id?, vendor_item_id?, memo?, pre_checked_steps? }
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 });
  }

  const { product, option, quantity, warehouse, coupang_deadline, coupang_inbound_id, vendor_item_id, memo, pre_checked_steps } = body as {
    product?: string; option?: string; quantity?: number;
    warehouse?: string; coupang_deadline?: string;
    coupang_inbound_id?: string; vendor_item_id?: string;
    memo?: string; pre_checked_steps?: number[];
  };

  if (!product || !quantity || quantity <= 0) {
    return NextResponse.json({ error: '품목과 수량이 필요합니다' }, { status: 400 });
  }
  if (!coupang_deadline) {
    return NextResponse.json({ error: '도착 기한이 필요합니다' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const insertData: Record<string, unknown> = {
    product,
    option: option || null,
    quantity,
    warehouse: warehouse || null,
    coupang_deadline,
    coupang_inbound_id: coupang_inbound_id || null,
    vendor_item_id: vendor_item_id || null,
    memo: memo || null,
    created_by: 'admin',
  };

  // Pre-check steps if specified (e.g. [2, 4] means ea_ordered_at and tracking_entered_at)
  if (pre_checked_steps && pre_checked_steps.length > 0) {
    const stepFieldMap: Record<number, string> = { 2: 'ea_ordered_at', 3: 'shipped_at', 4: 'tracking_entered_at', 5: 'arrived_at' };
    const statusPriority = [5, 3, 2]; // arrived > shipped > ea_ordered
    let highestStep = 0;
    for (const step of pre_checked_steps) {
      const field = stepFieldMap[step];
      if (field) {
        insertData[field] = now;
        if (step > highestStep) highestStep = step;
      }
    }
    // Set status based on highest checked step
    if (highestStep === 5) insertData.status = 'arrived';
    else if (highestStep === 3) insertData.status = 'shipped';
    else if (highestStep === 2) insertData.status = 'ea_ordered';
  }

  // Try insert; if new columns don't exist yet, retry without them
  let { data, error } = await supabaseAdmin
    .from('rg_inbound_requests')
    .insert(insertData)
    .select()
    .single();

  if (error && (error.message.includes('column') || error.code === '42703' || error.message.includes('does not exist'))) {
    // Fallback: strip new columns and retry — store inbound ID in memo
    const fallback = { ...insertData };
    const extras: string[] = [];
    if (fallback.coupang_inbound_id) extras.push(`입고ID: ${fallback.coupang_inbound_id}`);
    if (fallback.vendor_item_id) extras.push(`VID: ${fallback.vendor_item_id}`);
    delete fallback.coupang_inbound_id;
    delete fallback.vendor_item_id;
    if (extras.length > 0) {
      fallback.memo = [fallback.memo, extras.join(' / ')].filter(Boolean).join(' | ');
    }

    const retry = await supabaseAdmin
      .from('rg_inbound_requests')
      .insert(fallback)
      .select()
      .single();

    if (retry.error) {
      return NextResponse.json({ error: retry.error.message }, { status: 500 });
    }
    return NextResponse.json(retry.data);
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

/**
 * PATCH /api/inbound-requests
 * Actions: toggle_step, save_tracking, update, reject, cancel
 */
export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 });
  }

  const { id, action } = body as { id?: string; action?: string };
  if (!id || !action) {
    return NextResponse.json({ error: 'id와 action이 필요합니다' }, { status: 400 });
  }

  // Toggle a checklist step on/off
  // Steps: 2=ea_ordered, 3=shipped, 4=tracking_entered, 5=arrived
  // Step 1 (created) is always checked
  if (action === 'toggle_step') {
    const { step } = body as { step?: number };
    if (!step || step < 2 || step > 5) {
      return NextResponse.json({ error: 'step은 2~5 사이여야 합니다' }, { status: 400 });
    }

    // Get current state
    const { data: current, error: fetchErr } = await supabaseAdmin
      .from('rg_inbound_requests')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchErr || !current) {
      return NextResponse.json({ error: '입고 요청을 찾을 수 없습니다' }, { status: 404 });
    }

    const fieldMap: Record<number, string> = {
      2: 'ea_ordered_at',
      3: 'shipped_at',
      4: 'tracking_entered_at',
      5: 'arrived_at',
    };
    const field = fieldMap[step];
    const isChecked = !!current[field];
    const now = new Date().toISOString();

    const updateData: Record<string, unknown> = {
      [field]: isChecked ? null : now,
      updated_at: now,
    };

    // Derive status from checked steps
    if (step === 5) {
      updateData.status = isChecked ? (current.shipped_at ? 'shipped' : current.ea_ordered_at ? 'ea_ordered' : 'created') : 'arrived';
    } else if (step === 3) {
      if (isChecked) {
        // Unchecking shipped
        updateData.status = current.ea_ordered_at ? 'ea_ordered' : 'created';
      } else if (!current.arrived_at) {
        updateData.status = 'shipped';
      }
    } else if (step === 2) {
      if (isChecked) {
        updateData.status = 'created';
      } else if (!current.shipped_at && !current.arrived_at) {
        updateData.status = 'ea_ordered';
      }
    }
    // Step 4 (tracking) doesn't change status

    const { data, error } = await supabaseAdmin
      .from('rg_inbound_requests')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // Save tracking number
  if (action === 'save_tracking') {
    const { tracking_number } = body as { tracking_number?: string };

    const { data, error } = await supabaseAdmin
      .from('rg_inbound_requests')
      .update({
        tracking_number: tracking_number || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // Update fields
  if (action === 'update') {
    const { fields } = body as { fields?: Record<string, unknown> };
    if (!fields) {
      return NextResponse.json({ error: 'fields가 필요합니다' }, { status: 400 });
    }

    const allowed = ['product', 'option', 'quantity', 'warehouse', 'coupang_deadline', 'coupang_inbound_id', 'vendor_item_id', 'memo'];
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (key in fields) updateData[key] = fields[key];
    }

    let { data, error } = await supabaseAdmin
      .from('rg_inbound_requests')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    // Fallback if new columns don't exist
    if (error && (error.message.includes('column') || error.code === '42703')) {
      delete updateData.coupang_inbound_id;
      delete updateData.vendor_item_id;
      const retry = await supabaseAdmin.from('rg_inbound_requests').update(updateData).eq('id', id).select().single();
      if (retry.error) return NextResponse.json({ error: retry.error.message }, { status: 500 });
      return NextResponse.json(retry.data);
    }

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // Reject
  if (action === 'reject') {
    const { reject_reason, reject_memo, reship } = body as {
      reject_reason?: string; reject_memo?: string; reship?: boolean;
    };

    if (!reject_reason || !VALID_REJECT_REASONS.includes(reject_reason)) {
      return NextResponse.json({ error: '반송 사유가 필요합니다' }, { status: 400 });
    }

    const { data: original, error: fetchErr } = await supabaseAdmin
      .from('rg_inbound_requests')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !original) {
      return NextResponse.json({ error: '입고 요청을 찾을 수 없습니다' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const { error: updateErr } = await supabaseAdmin
      .from('rg_inbound_requests')
      .update({
        status: 'rejected',
        rejected_at: now,
        reject_reason,
        reject_memo: reject_memo || null,
        updated_at: now,
      })
      .eq('id', id);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    let reshipData = null;
    if (reship) {
      const { data: newReq, error: reshipErr } = await supabaseAdmin
        .from('rg_inbound_requests')
        .insert({
          product: original.product,
          option: original.option || null,
          quantity: original.quantity,
          warehouse: original.warehouse || null,
          coupang_deadline: original.coupang_deadline || null,
          reshipped_from_id: id,
          memo: `재출고`,
          created_by: 'admin',
        })
        .select()
        .single();

      if (reshipErr) return NextResponse.json({ error: reshipErr.message }, { status: 500 });
      reshipData = newReq;
    }

    const { data: updated } = await supabaseAdmin
      .from('rg_inbound_requests')
      .select('*')
      .eq('id', id)
      .single();

    return NextResponse.json({ rejected: updated, reship: reshipData });
  }

  // Cancel
  if (action === 'cancel') {
    const { error } = await supabaseAdmin
      .from('rg_inbound_requests')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: '알 수 없는 action입니다' }, { status: 400 });
}

/**
 * DELETE /api/inbound-requests
 * Body: { id }
 */
export async function DELETE(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 });
  }

  const { id } = body as { id?: string };
  if (!id) {
    return NextResponse.json({ error: 'id가 필요합니다' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('rg_inbound_requests')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
