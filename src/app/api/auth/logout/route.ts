import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/session';
import { getClientIp } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  await clearSessionCookie();
  await logAudit('logout', ip);
  return NextResponse.json({ success: true });
}
