import SettlementFormClient from './SettlementFormClient';
import type { Viewport } from 'next';

export const metadata = { title: '정산 정보 제출 | HEEDA' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1 };

export default async function SettlementFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SettlementFormClient token={token} />;
}
