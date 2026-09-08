import { Suspense } from 'react';
import ConsentsClient from './ConsentsClient';

export const metadata = { title: '동의서 | 인플루언서 운영' };

export default function ConsentsPage() {
  return (
    <Suspense>
      <ConsentsClient />
    </Suspense>
  );
}
