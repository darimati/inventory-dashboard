'use client';

import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import CalendarView from '../CalendarView';

export default function CalendarClient() {
  const router = useRouter();

  return (
    <AppShell showFilter={false}>
      <CalendarView
        onParticipantClick={(participantId, campaignId) => {
          router.push(`/influencer/manage?campaign=${campaignId}&open=${participantId}`);
        }}
      />
    </AppShell>
  );
}
