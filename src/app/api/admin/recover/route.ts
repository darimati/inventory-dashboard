import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getClientIp } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getAuthConfig, updateAuthConfig } from '@/lib/auth-store';

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const { recoverySecret, password, email } = await request.json();

    if (!recoverySecret || recoverySecret !== process.env.RECOVERY_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: '비밀번호는 8자 이상이어야 합니다.' }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const config = await getAuthConfig();

    await updateAuthConfig({
      password_hash: passwordHash,
      session_version: config.session_version + 1,
      setup_completed: true,
      ...(email ? { admin_email: email } : {}),
    });

    await logAudit('recovery', ip);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
