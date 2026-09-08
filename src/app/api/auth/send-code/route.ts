import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '@/lib/supabase-server';
import { getClientIp } from '@/lib/auth';
import { checkEmailCodeRateLimit } from '@/lib/rate-limit';
import { sendVerificationCode } from '@/lib/email';
import { getAuthConfig } from '@/lib/auth-store';

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const { purpose } = await request.json();

    if (!['password_change', 'password_reset'].includes(purpose)) {
      return NextResponse.json({ error: 'Invalid purpose' }, { status: 400 });
    }

    const rateLimit = await checkEmailCodeRateLimit(ip);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: '인증 코드 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', retryAfter: rateLimit.retryAfterSeconds },
        { status: 429 },
      );
    }

    const config = await getAuthConfig();

    if (!config.admin_email) {
      return NextResponse.json({ error: '관리자 이메일이 설정되지 않았습니다.' }, { status: 400 });
    }

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await bcrypt.hash(code, 10);

    try {
      await supabaseAdmin.from('password_reset_codes').insert({
        code_hash: codeHash,
        purpose,
        ip_address: ip,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
    } catch {
      // password_reset_codes table may not exist yet
    }

    const result = await sendVerificationCode(config.admin_email, code, purpose);
    if (!result.success) {
      return NextResponse.json({ error: '인증 코드 발송에 실패했습니다.' }, { status: 500 });
    }

    // Return masked email
    const [local, domain] = config.admin_email.split('@');
    const masked = local.slice(0, 2) + '***@' + domain;

    return NextResponse.json({ success: true, email: masked });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
