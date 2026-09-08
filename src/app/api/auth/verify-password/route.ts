import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getCurrentUser } from '@/lib/auth';
import { getAuthConfig } from '@/lib/auth-store';

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { password } = await request.json();
  if (!password) {
    return NextResponse.json({ error: '비밀번호를 입력해주세요.' }, { status: 400 });
  }

  const config = await getAuthConfig();

  if (!config.password_hash) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  }

  const valid = await bcrypt.compare(password, config.password_hash);
  if (!valid) {
    return NextResponse.json({ error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  return NextResponse.json({ valid: true });
}
