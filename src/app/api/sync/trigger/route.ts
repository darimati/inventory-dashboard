import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

// sync_logs columns: id, platform, account_id, date, status, error_message, started_at, finished_at

// POST: Insert a pending manual sync request into sync_logs
// The sync daemon running on the whitelisted server picks it up
export async function POST() {
  // Rate limit: 30-second cooldown based on recent sync_logs entries
  const { data: recent } = await supabaseAdmin
    .from('sync_logs')
    .select('id, status')
    .order('id', { ascending: false })
    .limit(1);

  if (recent && recent.length > 0) {
    const lastStatus = recent[0].status;
    if (lastStatus === 'manual_request_pending' || lastStatus === 'running') {
      return NextResponse.json(
        { error: 'cooldown', remainingSeconds: 30, message: '이미 동기화 진행 중입니다' },
        { status: 429 },
      );
    }
  }

  // Insert a pending request — daemon will pick it up within ~10 seconds
  const { data, error } = await supabaseAdmin
    .from('sync_logs')
    .insert({
      platform: 'coupang',
      account_id: process.env.COUPANG_VENDOR_ID || 'A00429105',
      date: new Date().toISOString().slice(0, 10),
      status: 'manual_request_pending',
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message: '동기화 요청 접수. 약 10초 이내 시작됩니다.',
    logId: data?.id,
  });
}

// GET: Check status of a sync request
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const logId = searchParams.get('id');

  if (logId) {
    const { data, error } = await supabaseAdmin
      .from('sync_logs')
      .select('id, platform, account_id, date, status, error_message, started_at, finished_at')
      .eq('id', logId)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ sync: data });
  }

  // Return latest sync status
  const { data, error } = await supabaseAdmin
    .from('sync_logs')
    .select('id, platform, account_id, date, status, error_message, started_at, finished_at')
    .order('id', { ascending: false })
    .limit(5);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ syncs: data });
}
