import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createSession, setSessionCookie } from '@/lib/session';
import { checkLoginRateLimit, recordLoginAttempt } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getAuthConfig } from '@/lib/auth-store';

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);

    const rateLimit = await checkLoginRateLimit(ip);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.', retryAfter: rateLimit.retryAfterSeconds },
        { status: 429 },
      );
    }

    const { password } = await request.json();
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '비밀번호를 입력해주세요.' }, { status: 400 });
    }

    const config = await getAuthConfig();

    if (!config.setup_completed || !config.password_hash) {
      return NextResponse.json({ error: '초기 설정이 완료되지 않았습니다.' }, { status: 403 });
    }

    const valid = await bcrypt.compare(password, config.password_hash);

    if (!valid) {
      await recordLoginAttempt(ip, false);
      await logAudit('login_failed', ip);
      return NextResponse.json({ error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
    }

    await recordLoginAttempt(ip, true);
    const token = await createSession(config.session_version);
    await setSessionCookie(token);
    await logAudit('login', ip);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
