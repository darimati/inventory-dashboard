import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HEEDA 커머스 대시보드',
  description: '희다 커머스 통합 관리 대시보드',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="dns-prefetch" href="https://cdn.jsdelivr.net" />
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
