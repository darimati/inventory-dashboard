import ConsentClient from './ConsentClient';
import type { Viewport } from 'next';

export const metadata = { title: '동의서 확인 | HEEDA' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1 };

export default async function ConsentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ConsentClient token={token} />;
}
