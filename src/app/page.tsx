import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function RootPage() {
  const cookieStore = await cookies();
  const ws = cookieStore.get('heeda-ws')?.value;
  redirect(ws === 'influencer' ? '/influencer' : '/commerce');
}
