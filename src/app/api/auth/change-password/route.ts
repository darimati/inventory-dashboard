import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '@/lib/supabase-server';
import { getCurrentUser, getClientIp } from '@/lib/auth';
import { createSession, setSessionCookie } from '@/lib/session';
import { logAudit } from '@/lib/audit';
import { getAuthConfig, updateAuthConfig } from '@/lib/auth-store';

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { code, newPassword } = await request.json();

    if (!code || !newPassword) {
      return NextResponse.json({ error: '인증 코드와 새 비밀번호를 입력해주세요.' }, { status: 400 });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return NextResponse.json({ error: '비밀번호는 8자 이상이어야 합니다.' }, { status: 400 });
    }

    // Find valid unexpired codes for password_change
    let matchedCodeId: string | null = null;
    try {
      const { data: codes } = await supabaseAdmin
        .from('password_reset_codes')
        .select('*')
        .eq('purpose', 'password_change')
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

    // Mark code used
    try {
      await supabaseAdmin
        .from('password_reset_codes')
        .update({ used_at: new Date().toISOString() })
        .eq('id', matchedCodeId);
    } catch {
      // table may not exist
    }

    const config = await getAuthConfig();
    const newVersion = config.session_version + 1;
    const newHash = await bcrypt.hash(newPassword, 12);

    await updateAuthConfig({ password_hash: newHash, session_version: newVersion });

    // Issue new session for current user
    const token = await createSession(newVersion);
    await setSessionCookie(token);
    await logAudit('password_change', ip);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
