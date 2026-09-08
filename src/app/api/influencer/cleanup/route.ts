import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { cleanupExpiredPII } from '@/lib/pii-cleanup';

export async function POST() {
  await requireAdmin();

  const result = await cleanupExpiredPII();

  return NextResponse.json(result);
}
