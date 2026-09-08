import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '@/lib/supabase-server';
import { getClientIp } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getAuthConfig, updateAuthConfig } from '@/lib/auth-store';

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const { email, code, newPassword } = await request.json();

    if (!email || !code || !newPassword) {
      return NextResponse.json({ error: '모든 필드를 입력해주세요.' }, { status: 400 });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return NextResponse.json({ error: '비밀번호는 8자 이상이어야 합니다.' }, { status: 400 });
    }

    const config = await getAuthConfig();

    if (!config.admin_email || config.admin_email !== email) {
      return NextResponse.json({ error: '인증 코드가 유효하지 않습니다.' }, { status: 400 });
    }

    // Find valid code
    let matchedCodeId: string | null = null;
    try {
      const { data: codes } = await supabaseAdmin
        .from('password_reset_codes')
        .select('*')
        .eq('purpose', 'password_reset')
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(5);

      for (const c of codes ?? []) {
        if (await bcrypt.compare(code, c.code_hash)) {
          matchedCodeId = c.id;
          break;
        }
      }
    } catch {
      // password_reset_codes table may not exist
    }

    if (!matchedCodeId) {
      return NextResponse.json({ error: '인증 코드가 유효하지 않습니다.' }, { status: 400 });
    }

    try {
      await supabaseAdmin
        .from('password_reset_codes')
        .update({ used_at: new Date().toISOString() })
        .eq('id', matchedCodeId);
    } catch {
      // table may not exist
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await updateAuthConfig({
      password_hash: newHash,
      session_version: config.session_version + 1,
    });

    await logAudit('password_change', ip, 'via password reset');

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
