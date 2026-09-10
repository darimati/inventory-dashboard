import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';

const BUCKET = 'influencer-files';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
  }

  const path = req.nextUrl.searchParams.get('path');
  if (!path) {
    return NextResponse.json({ error: 'path 파라미터가 필요합니다' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(path, 300); // 5분

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ url: data.signedUrl });
}
