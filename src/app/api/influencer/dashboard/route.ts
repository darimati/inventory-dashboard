import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import type { DashboardData, DashboardCampaignSummary, CampaignStatus, WeeklyTaskItem, WeeklyTaskSummary, WeeklyStep } from '@/lib/types/influencer';
import { isUnpaidCollab, getScheduleDate, getCurrentStep } from '@/lib/types/influencer';
import { daysBetween } from '@/lib/dday';

export async function GET() {
  const now = new Date();
  const year = now.getFullYear();
  const monthStart = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const yearStart = `${year}-01-01`;

  const threeDaysAgo = new Date(now.getTime() - 3 * 86400000).toISOString();

  const [
    { count: activeCampaigns },
    { count: totalParticipants },
    { count: pendingConsent },
    { count: pendingSettlement },
    { data: monthlyParts },
    { data: annualParts },
    { data: budgetSetting },
    { data: annualBudgetSetting },
    { data: campaignsRaw },
    { data: monthlyPaidSettlements },
    { data: annualPaidSettlements },
    { data: waitingSettlements },
    { data: pendingDocsParticipants },
  ] = await Promise.all([
    supabaseAdmin
      .from('inf_campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active'),
    supabaseAdmin
      .from('inf_participants')
      .select('*', { count: 'exact', head: true })
      .neq('status', 'cancelled'),
    supabaseAdmin
      .from('inf_participants')
      .select('*', { count: 'exact', head: true })
      .in('consent_status', ['not_sent', 'sent']),
    supabaseAdmin
      .from('inf_settlements')
      .select('*', { count: 'exact', head: true })
      .in('payment_status', ['waiting', 'requested']),
    supabaseAdmin
      .from('inf_participants')
      .select('*')
      .gte('created_at', monthStart)
      .neq('status', 'cancelled'),
    supabaseAdmin
      .from('inf_participants')
      .select('*')
      .gte('created_at', yearStart)
      .neq('status', 'cancelled'),
    supabaseAdmin
      .from('inf_settings')
      .select('value')
      .eq('key', 'default_budget')
      .single(),
    supabaseAdmin
      .from('inf_settings')
      .select('value')
      .eq('key', 'annual_budget')
      .single(),
    supabaseAdmin
      .from('inf_campaigns')
      .select('*, inf_participants(*)')
      .in('status', ['active', 'preparing'])
      .order('created_at', { ascending: false }),
    // Monthly paid settlements (by paid_date)
    supabaseAdmin
      .from('inf_settlements')
      .select('net_amount, gross_amount, paid_date')
      .eq('payment_status', 'paid')
      .gte('paid_date', monthStart),
    // Annual paid settlements
    supabaseAdmin
      .from('inf_settlements')
      .select('net_amount, gross_amount, paid_date')
      .eq('payment_status', 'paid')
      .gte('paid_date', yearStart),
    // Waiting settlements with planned_date
    supabaseAdmin
      .from('inf_settlements')
      .select('id, net_amount, gross_amount, planned_date, created_at, participant_id')
      .in('payment_status', ['waiting', 'requested']),
    // Participants with settlement link sent > 3 days ago, still pending
    supabaseAdmin
      .from('inf_participants')
      .select('id, name, display_name, settlement_token_expires_at')
      .eq('settlement_status', 'docs_requested')
      .gt('fee', 0)
      .lt('settlement_token_expires_at', new Date(now.getTime() + 11 * 86400000).toISOString()),
  ]);

  // 계약 총액 (모든 참여 확정, 세전) — created_at 기준 월/연
  const monthlyContractProductCost = (monthlyParts ?? []).reduce(
    (sum, r) => sum + (Number(r.product_cost) || 0), 0,
  );
  const monthlyContractFee = (monthlyParts ?? []).reduce(
    (sum, r) => sum + (Number(r.fee) || 0), 0,
  );
  const monthlyContractTotal = monthlyContractProductCost + monthlyContractFee;
  const monthlyBudget = (budgetSetting?.value as Record<string, number>)?.monthly ?? 0;

  const annualContractProductCost = (annualParts ?? []).reduce(
    (sum, r) => sum + (Number(r.product_cost) || 0), 0,
  );
  const annualContractFee = (annualParts ?? []).reduce(
    (sum, r) => sum + (Number(r.fee) || 0), 0,
  );
  const annualContractTotal = annualContractProductCost + annualContractFee;
  const annualBudget = (annualBudgetSetting?.value as Record<string, number>)?.amount ?? 0;

  // 집행 예정 (업로드 확인 완료 · 미지급, 세전)
  const monthlyConfirmedFee = (monthlyParts ?? []).reduce(
    (sum, r) => (r.published_url && r.settlement_status !== 'paid')
      ? sum + (Number(r.fee) || 0) : sum, 0,
  );
  const annualConfirmedFee = (annualParts ?? []).reduce(
    (sum, r) => (r.published_url && r.settlement_status !== 'paid')
      ? sum + (Number(r.fee) || 0) : sum, 0,
  );

  // Product-level execution breakdown (using product column)
  const productExecution: Record<string, { count: number; fee: number }> = {};
  for (const p of annualParts ?? []) {
    const key = (p.product as string) || '기타';
    if (!productExecution[key]) {
      productExecution[key] = { count: 0, fee: 0 };
    }
    productExecution[key].count += 1;
    productExecution[key].fee += Number(p.fee) || 0;
  }

  // Campaign summaries
  const campaigns: DashboardCampaignSummary[] = (campaignsRaw ?? []).map((c: Record<string, unknown>) => {
    const parts = (c.inf_participants as Record<string, unknown>[]) ?? [];
    const activeParts = parts.filter((p) => p.status !== 'cancelled');
    return {
      id: c.id as string,
      name: c.name as string,
      month: (c.month as string) || null,
      status: c.status as CampaignStatus,
      budget: Number(c.budget) || 0,
      participantCount: activeParts.length,
      consentAgreed: activeParts.filter((p) => p.consent_status === 'agreed').length,
      uploadDone: activeParts.filter((p) => !!p.published_url).length,
      totalFee: activeParts.reduce((s, p) => s + (Number(p.fee) || 0), 0),
      totalProductCost: activeParts.reduce((s, p) => s + (Number(p.product_cost) || 0), 0),
    };
  });

  // Settlement payment metrics
  const monthlyPaid = (monthlyPaidSettlements ?? []).reduce(
    (sum, r) => sum + (Number(r.net_amount) || Number(r.gross_amount) || 0), 0,
  );
  const monthlyPaidCount = (monthlyPaidSettlements ?? []).length;
  const annualPaid = (annualPaidSettlements ?? []).reduce(
    (sum, r) => sum + (Number(r.net_amount) || Number(r.gross_amount) || 0), 0,
  );

  const totalWaitingAmount = (waitingSettlements ?? []).reduce(
    (sum, r) => sum + (Number(r.net_amount) || Number(r.gross_amount) || 0), 0,
  );
  const totalWaitingCount = (pendingSettlement ?? 0) + (pendingDocsParticipants ?? []).length;

  // ─── Today's Checklist (expanded) ───
  // KST (UTC+9) 기준 오늘 날짜
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const todayStr = kstNow.toISOString().slice(0, 10);
  const kstThreshold = new Date(kstNow.getTime() + 3 * 86400000);
  const dueThreshold = kstThreshold.toISOString().slice(0, 10);

  // Extract all active participants for content schedule checks
  const allActiveParts = (campaignsRaw ?? []).flatMap(
    (c: Record<string, unknown>) => {
      const parts = (c.inf_participants as Record<string, unknown>[]) ?? [];
      return parts.filter((p) => p.status !== 'cancelled');
    },
  );

  // Helper: effective date (confirmed ?? planned)
  const effectiveDate = (p: Record<string, unknown>, confirmed: string, planned: string) =>
    (p[confirmed] as string | null) || (p[planned] as string | null);

  // Content schedule checks
  const uploadOverdue = allActiveParts.filter(p => {
    const d = effectiveDate(p, 'confirmed_upload_date', 'planned_upload_date');
    return d && d < todayStr && !p.uploaded_at;
  }).length;
  const draftOverdue = allActiveParts.filter(p => {
    const d = effectiveDate(p, 'confirmed_draft_date', 'planned_draft_date');
    return d && d < todayStr && !p.draft_received_at;
  }).length;
  const editOverdue = allActiveParts.filter(p => {
    const d = effectiveDate(p, 'confirmed_edit_date', 'planned_edit_date');
    return d && d < todayStr && !p.edit_received_at;
  }).length;
  const uploadToday = allActiveParts.filter(p => {
    const d = effectiveDate(p, 'confirmed_upload_date', 'planned_upload_date');
    return d && d === todayStr && !p.uploaded_at;
  }).length;
  const draftToday = allActiveParts.filter(p => {
    const d = effectiveDate(p, 'confirmed_draft_date', 'planned_draft_date');
    return d && d === todayStr && !p.draft_received_at;
  }).length;
  const editToday = allActiveParts.filter(p => {
    const d = effectiveDate(p, 'confirmed_edit_date', 'planned_edit_date');
    return d && d === todayStr && !p.edit_received_at;
  }).length;
  const consentExpiring = allActiveParts.filter(p => {
    if (p.consent_status === 'agreed' || p.consent_status === 'expired') return false;
    const exp = p.consent_token_expires_at as string | null;
    if (!exp) return false;
    const expDate = (exp as string).slice(0, 10);
    return expDate >= todayStr && expDate <= dueThreshold;
  }).length;

  // Settlement checks (existing)
  const overdueInfoCount = (pendingDocsParticipants ?? []).filter(p => {
    if (!p.settlement_token_expires_at) return false;
    const sentAt = new Date(p.settlement_token_expires_at).getTime() - 14 * 86400000;
    return (now.getTime() - sentAt) > 3 * 86400000;
  }).length;
  const dueSoonCount = (waitingSettlements ?? []).filter(s => {
    if (!s.planned_date) return false;
    return s.planned_date <= dueThreshold && s.planned_date >= todayStr;
  }).length;
  const overduePaymentCount = (waitingSettlements ?? []).filter(s => {
    if (!s.planned_date) return false;
    return s.planned_date < todayStr;
  }).length;

  // Build checklist: RED (overdue) → AMBER (due today / soon) → GRAY (info)
  const todayChecklist: { type: string; label: string; count: number }[] = [];

  if (uploadOverdue > 0) todayChecklist.push({ type: 'upload_overdue', label: '업로드 지연 (마감일 경과)', count: uploadOverdue });
  if (draftOverdue > 0) todayChecklist.push({ type: 'draft_overdue', label: '초안 미제출 (마감일 경과)', count: draftOverdue });
  if (editOverdue > 0) todayChecklist.push({ type: 'edit_overdue', label: '수정본 미제출 (마감일 경과)', count: editOverdue });
  if (overduePaymentCount > 0) todayChecklist.push({ type: 'payment_overdue', label: '지급 지연 (예정일 경과)', count: overduePaymentCount });

  if (uploadToday > 0) todayChecklist.push({ type: 'upload_due_today', label: '오늘 업로드 마감', count: uploadToday });
  if (draftToday > 0) todayChecklist.push({ type: 'draft_due_today', label: '오늘 초안 마감', count: draftToday });
  if (editToday > 0) todayChecklist.push({ type: 'edit_due_today', label: '오늘 수정본 마감', count: editToday });
  if (consentExpiring > 0) todayChecklist.push({ type: 'consent_expiring', label: '동의서 만료 임박 (D-3 이내)', count: consentExpiring });
  if (dueSoonCount > 0) todayChecklist.push({ type: 'payment_due_soon', label: '지급 예정일 임박 (D-3 이내)', count: dueSoonCount });

  if (overdueInfoCount > 0) todayChecklist.push({ type: 'settlement_info_overdue', label: '정산 정보 미회수 (3일 경과)', count: overdueInfoCount });

  // ─── Submission asset alerts ───
  const [
    { count: proposalUnreviewed },
    { count: roughCutUnreviewed },
    { count: revisionWaiting },
  ] = await Promise.all([
    supabaseAdmin
      .from('campaign_submission_assets')
      .select('*', { count: 'exact', head: true })
      .eq('stage', 'proposal')
      .eq('status', 'received'),
    supabaseAdmin
      .from('campaign_submission_assets')
      .select('*', { count: 'exact', head: true })
      .eq('stage', 'rough_cut')
      .eq('status', 'received'),
    supabaseAdmin
      .from('campaign_submission_assets')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'revision_requested'),
  ]);

  // Upload overdue: participants with publish_deadline passed and no final_upload submission
  const { data: finalUploads } = await supabaseAdmin
    .from('campaign_submission_assets')
    .select('participant_id')
    .eq('stage', 'final_upload');
  const finalUploadPids = new Set((finalUploads ?? []).map(a => a.participant_id));
  const uploadOverdueSubmission = allActiveParts.filter(p => {
    const deadline = (p.publish_deadline as string | null) || effectiveDate(p, 'confirmed_upload_date', 'planned_upload_date');
    return deadline && deadline < todayStr && !finalUploadPids.has(p.id as string);
  }).length;

  if ((proposalUnreviewed ?? 0) > 0) todayChecklist.push({ type: 'proposal_unreviewed', label: '기획안 확인 필요', count: proposalUnreviewed ?? 0 });
  if ((roughCutUnreviewed ?? 0) > 0) todayChecklist.push({ type: 'rough_cut_unreviewed', label: '가편집본 확인 필요', count: roughCutUnreviewed ?? 0 });
  if ((revisionWaiting ?? 0) > 0) todayChecklist.push({ type: 'revision_waiting', label: '수정본 대기', count: revisionWaiting ?? 0 });
  if (uploadOverdueSubmission > 0) todayChecklist.push({ type: 'upload_overdue_submission', label: '업로드 예정일 경과', count: uploadOverdueSubmission });

  // ─── Weekly Tasks — 1 participant = 1 row ───

  // Fetch all deliverable records for revision_requested detection
  const { data: allDeliverables } = await supabaseAdmin
    .from('inf_settings')
    .select('key, value')
    .like('key', 'dlv:%');

  const dlvMap: Record<string, Record<string, unknown>> = {};
  for (const d of allDeliverables ?? []) {
    const parts = d.key.split(':');
    if (parts.length >= 3) {
      const pid = parts[1];
      const st = parts[2];
      const k = `${pid}:${st}`;
      dlvMap[k] = d.value as Record<string, unknown>;
    }
  }

  const weeklyTasks: WeeklyTaskItem[] = [];

  for (const c of campaignsRaw ?? []) {
    const campName = c.name as string;
    const campId = c.id as string;
    const collabType = c.collab_type as string | null;
    const isFree = isUnpaidCollab(collabType);
    const parts = (c.inf_participants as Record<string, unknown>[]) ?? [];

    for (const p of parts) {
      if (p.status === 'cancelled') continue;

      const step = getCurrentStep(p, isFree);
      // Skip if all done (payment + paid)
      if (step === 'payment' && p.settlement_status === 'paid') continue;

      // Determine date for the current step
      let scheduledDate: string | null = null;
      let isConfirmed = false;
      if (step === 'draft' || step === 'edit' || step === 'upload') {
        const sd = getScheduleDate(p, step);
        scheduledDate = sd.date;
        isConfirmed = sd.isConfirmed;
      }

      const diff = scheduledDate ? daysBetween(new Date(), scheduledDate) : null;
      const isOverdue = diff !== null && diff < 0;
      const overdueDays = isOverdue ? Math.abs(diff!) : 0;
      const daysUntil = diff; // raw diff: positive=future, 0=today, negative=past; null=no date

      // Deliverable status for this step
      const dlvKey = `${p.id}:${step}`;
      const dlv = dlvMap[dlvKey] || null;

      weeklyTasks.push({
        participant_id: p.id as string,
        campaign_id: campId,
        display_name: ((p.display_name || p.name || '') as string),
        channel: (p.channel || null) as string | null,
        campaign_name: campName,
        step,
        scheduled_date: scheduledDate,
        is_confirmed: isConfirmed,
        is_overdue: isOverdue,
        overdue_days: overdueDays,
        days_until: daysUntil,
        deliverable_status: dlv ? (dlv.status as string) : null,
        deliverable_version: dlv ? (dlv.version as number) : undefined,
      });
    }
  }

  // Sort: overdue first, then by date ascending, nulls last
  weeklyTasks.sort((a, b) => {
    if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1;
    const da = a.scheduled_date || '9999-12-31';
    const db = b.scheduled_date || '9999-12-31';
    if (da !== db) return da.localeCompare(db);
    return a.display_name.localeCompare(b.display_name, 'ko');
  });

  // Summary cards (5 steps)
  const stepOrder: WeeklyStep[] = ['draft', 'edit', 'upload', 'performance', 'payment'];
  const weeklyTaskSummary: WeeklyTaskSummary[] = stepOrder.map(step => {
    const items = weeklyTasks.filter(t => t.step === step);
    // Build subtitle: "이름 MM/DD · 이름 MM/DD" (up to 2, with dates)
    const subtitleParts = items.slice(0, 2).map(t => {
      if (t.scheduled_date) {
        const d = new Date(t.scheduled_date + 'T00:00:00');
        return `${t.display_name} ${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
      }
      return t.display_name;
    });
    return {
      step,
      count: items.length,
      overdue_count: items.filter(t => t.is_overdue).length,
      subtitle: items.length > 0 ? subtitleParts.join(' · ') + (items.length > 2 ? ` 외 ${items.length - 2}명` : '') : '—',
    };
  });

  const data: DashboardData = {
    activeCampaigns: activeCampaigns ?? 0,
    totalParticipants: totalParticipants ?? 0,
    pendingConsent: pendingConsent ?? 0,
    pendingSettlement: pendingSettlement ?? 0,
    // 계약 총액 (세전)
    monthlyContractTotal,
    monthlyContractFee,
    monthlyContractProductCost,
    annualContractTotal,
    annualContractFee,
    annualContractProductCost,
    // 집행 예정 (세전)
    monthlyConfirmedFee,
    annualConfirmedFee,
    // 예산
    monthlyBudget,
    annualBudget,
    productExecution,
    campaigns,
    // 정산 지표 (실제 지급 레코드 기반)
    settlementWaitingCount: totalWaitingCount,
    settlementWaitingAmount: totalWaitingAmount,
    monthlyPaidAmount: monthlyPaid,
    monthlyPaidCount,
    annualPaidAmount: annualPaid,
    todayChecklist,
    weeklyTasks,
    weeklyTaskSummary,
  };

  return NextResponse.json(data);
}
