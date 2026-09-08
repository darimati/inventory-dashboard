import { supabaseAdmin } from './supabase-server';

export interface CleanupResult {
  scanned: number;
  cleaned: number;
  ids: string[];
}

/**
 * 지급 완료(paid) 후 6개월 경과한 참여자의 PII를 null 처리합니다.
 * 대상 필드: ssn_enc, business_reg_enc, bank_account_enc
 */
export async function cleanupExpiredPII(): Promise<CleanupResult> {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const cutoff = sixMonthsAgo.toISOString().slice(0, 10);

  // Find participants with paid settlements older than 6 months that still have PII
  const { data: candidates, error: findErr } = await supabaseAdmin
    .from('inf_settlements')
    .select('participant_id')
    .eq('payment_status', 'paid')
    .lte('paid_date', cutoff);

  if (findErr || !candidates) {
    return { scanned: 0, cleaned: 0, ids: [] };
  }

  const participantIds = [...new Set(candidates.map((c: any) => c.participant_id))];

  if (participantIds.length === 0) {
    return { scanned: 0, cleaned: 0, ids: [] };
  }

  // Check which ones still have PII data
  const { data: withPII, error: piiErr } = await supabaseAdmin
    .from('inf_participants')
    .select('id')
    .in('id', participantIds)
    .or('ssn_enc.not.is.null,business_reg_enc.not.is.null,bank_account_enc.not.is.null');

  if (piiErr || !withPII || withPII.length === 0) {
    return { scanned: participantIds.length, cleaned: 0, ids: [] };
  }

  const toClean = withPII.map((p: any) => p.id);

  // Null out PII fields
  const { error: updateErr } = await supabaseAdmin
    .from('inf_participants')
    .update({
      ssn_enc: null,
      business_reg_enc: null,
      bank_account_enc: null,
    })
    .in('id', toClean);

  if (updateErr) {
    throw new Error(`PII cleanup failed: ${updateErr.message}`);
  }

  return {
    scanned: participantIds.length,
    cleaned: toClean.length,
    ids: toClean,
  };
}
