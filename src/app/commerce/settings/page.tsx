export const dynamic = 'force-dynamic';

import { supabaseAdmin } from '@/lib/supabase-server';
import SettingsClient from './SettingsClient';

export const metadata = { title: '설정 | HEEDA Commerce' };

export default async function SettingsPage() {
  const [{ data: promotions }, { data: syncLogs }, ltResult, invThreshResult, noticesResult, skuResult, primarySkusResult] = await Promise.all([
    supabaseAdmin
      .from('promotions_coupang')
      .select('*')
      .order('start_date', { ascending: false }),
    supabaseAdmin
      .from('sync_logs')
      .select('id, trigger_type, status, started_at, finished_at, fetched_count, inserted_count, error_message')
      .order('started_at', { ascending: false })
      .limit(20),
    Promise.resolve(
      supabaseAdmin
        .from('inf_settings')
        .select('value')
        .eq('key', 'commerce:lead_times')
        .maybeSingle()
    ).catch(() => ({ data: null, error: null })),
    Promise.resolve(
      supabaseAdmin
        .from('inf_settings')
        .select('value')
        .eq('key', 'commerce:inventory_thresholds')
        .maybeSingle()
    ).catch(() => ({ data: null, error: null })),
    Promise.resolve(
      supabaseAdmin
        .from('inf_settings')
        .select('value')
        .eq('key', 'commerce:product_notices')
        .maybeSingle()
    ).catch(() => ({ data: null, error: null })),
    Promise.resolve(
      supabaseAdmin
        .from('inf_settings')
        .select('value')
        .eq('key', 'commerce:sku_classifications')
        .maybeSingle()
    ).catch(() => ({ data: null, error: null })),
    Promise.resolve(
      supabaseAdmin
        .from('inf_settings')
        .select('value')
        .eq('key', 'commerce:primary_skus')
        .maybeSingle()
    ).catch(() => ({ data: null, error: null })),
  ]);

  const leadTimes = ((ltResult as any)?.data?.value as { production: number; transfer: number }) ?? { production: 14, transfer: 7 };
  const inventoryThresholds = ((invThreshResult as any)?.data?.value as {
    transferSafetyDays: number; transferTargetDays: number;
    orderTargetDays: number; transferLeadTime: number; productionLeadTime: number;
  }) ?? null;
  const productNotices = ((noticesResult as any)?.data?.value as Record<string, { type: string; message: string; resumeDate?: string }>) ?? {};
  const skuClassifications = ((skuResult as any)?.data?.value as Record<string, any>) ?? {};
  const primarySkus = ((primarySkusResult as any)?.data?.value as Record<string, string>) ?? {
    '클렌징밤': '18396', '클렌징폼': '18279', '세럼': '18919',
  };

  return <SettingsClient promotions={promotions ?? []} syncLogs={syncLogs ?? []} leadTimes={leadTimes} inventoryThresholds={inventoryThresholds} productNotices={productNotices} skuClassifications={skuClassifications} primarySkus={primarySkus} />;
}
