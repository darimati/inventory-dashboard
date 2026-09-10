import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';

const BUCKET = 'deliverables';

/**
 * POST /api/influencer/submissions/upload-url
 * Generate a signed upload URL for direct file upload to Supabase Storage.
 * Body: { participant_id, version, filename }
 * Returns: { signedUrl, path, token }
 */
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 }); }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 }); }

  const { participant_id, version, filename } = body as {
    participant_id?: string;
    version?: number;
    filename?: string;
  };

  if (!participant_id || !filename) {
    return NextResponse.json({ error: 'participant_id and filename required' }, { status: 400 });
  }

  const v = version || 1;
  const ext = filename.split('.').pop()?.toLowerCase() || 'bin';
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const storagePath = `${participant_id}/rough_cut/v${v}/${safeName}`;

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error) {
    return NextResponse.json({ error: '업로드 URL 생성 실패: ' + error.message }, { status: 500 });
  }

  return NextResponse.json({
    signedUrl: data.signedUrl,
    path: storagePath,
    token: data.token,
  });
}
