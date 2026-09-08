import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year');

    let query = supabaseAdmin
      .from('settlements_coupang')
      .select('vendor_id, revenue_recognition_year_month, settlement_date, settlement_type, status, final_amount, settlement_amount, updated_at, revenue_recognition_date_from, revenue_recognition_date_to')
      .order('settlement_date', { ascending: false });

    if (year) {
      // revenue_recognition_year_month is stored as e.g. "2026-08" or "202608"
      // Filter rows whose revenue_recognition_year_month starts with the given year
      query = query.like('revenue_recognition_year_month', `${year}%`);
    }

    const { data: rows, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const data = rows ?? [];

    const totalFinalAmount = data.reduce((sum, r) => sum + (r.final_amount ?? 0), 0);
    const totalCount = data.length;

    const summary = {
      total_final_amount: totalFinalAmount,
      total_count: totalCount,
    };

    return NextResponse.json({ data, summary });
  } catch (err) {
    console.error('[API /settlements] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
