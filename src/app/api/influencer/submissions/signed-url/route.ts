import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';

const BUCKET = 'deliverables';
const EXPIRY_SECONDS = 600; // 10 minutes

/**
 * GET /api/influencer/submissions/signed-url?path=<storage_path>
 * Generate a signed download URL for a file in Supabase Storage.
 */
export async function GET(req: NextRequest) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 }); }

  const { searchParams } = new URL(req.url);
  const path = searchParams.get('path');

  if (!path) {
    return NextResponse.json({ error: 'path required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(path, EXPIRY_SECONDS);

  if (error) {
    return NextResponse.json({ error: '서명 URL 생성 실패: ' + error.message }, { status: 500 });
  }

  return NextResponse.json({ url: data.signedUrl });
}
