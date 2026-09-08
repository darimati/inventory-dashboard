import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getClientIp } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getAuthConfig, updateAuthConfig } from '@/lib/auth-store';

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const { setupKey, password, email } = await request.json();

    if (!setupKey || setupKey !== process.env.SETUP_KEY) {
      return NextResponse.json({ error: '설정 키가 올바르지 않습니다.' }, { status: 403 });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: '비밀번호는 8자 이상이어야 합니다.' }, { status: 400 });
    }

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: '유효한 이메일을 입력해주세요.' }, { status: 400 });
    }

    const config = await getAuthConfig();

    if (config.setup_completed) {
      return NextResponse.json({ error: '이미 초기 설정이 완료되었습니다.' }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await updateAuthConfig({
      password_hash: passwordHash,
      admin_email: email,
      setup_completed: true,
    });

    await logAudit('setup', ip, `email: ${email}`);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
