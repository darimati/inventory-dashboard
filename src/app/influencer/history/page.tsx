import { Suspense } from 'react';
import HistoryClient from './HistoryClient';

export const metadata = { title: '기록 | 인플루언서 운영' };

export default function HistoryPage() {
  return (
    <Suspense>
      <HistoryClient />
    </Suspense>
  );
}
