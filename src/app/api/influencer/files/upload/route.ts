import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf', 'video/'];
const BUCKET = 'influencer-files';

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return NextResponse.json({ error: '파일이 필요합니다' }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `파일 크기가 100MB를 초과합니다 (${Math.round(file.size / 1024 / 1024)}MB)` },
      { status: 400 },
    );
  }

  const isAllowed = ALLOWED_MIME_PREFIXES.some((prefix) => file.type.startsWith(prefix));
  if (!isAllowed) {
    return NextResponse.json(
      { error: `허용되지 않는 파일 형식입니다: ${file.type}. 이미지, PDF, 또는 동영상만 업로드 가능합니다.` },
      { status: 400 },
    );
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const storagePath = `deliverables/${timestamp}-${random}.${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error('[file upload]', uploadError.message);
    return NextResponse.json({ error: '파일 업로드에 실패했습니다: ' + uploadError.message }, { status: 500 });
  }

  return NextResponse.json({
    url: storagePath,
    original_filename: file.name,
    mime_type: file.type,
    file_size: file.size,
  });
}
