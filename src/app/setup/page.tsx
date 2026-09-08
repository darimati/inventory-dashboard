import SetupClient from './SetupClient';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '초기 설정 | HEEDA',
};

export default function SetupPage() {
  return <SetupClient />;
}
