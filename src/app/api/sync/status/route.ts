import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('sync_logs')
    .select('id, trigger_type, status, started_at, finished_at, fetched_count, inserted_count, error_message')
    .order('started_at', { ascending: false })
    .limit(1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const lastSync = data && data.length > 0 ? data[0] : null;
  return NextResponse.json({ lastSync });
}
