import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';
import { isPaidCollab } from '@/lib/types/influencer';

/* ------------------------------------------------------------------ */
/*  Event type sort order                                              */
/* ------------------------------------------------------------------ */
const TYPE_ORDER: Record<string, number> = {
  draft: 0,
  edit: 1,
  upload: 2,
  payment: 3,
  custom: 4,
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function toDateStr(d: Date): string {
  // KST (UTC+9) 기준 날짜 문자열 반환
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** Get last day of a given month (1-indexed). */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Find the next occurrence of `dayOfMonth` on or after `afterDate`.
 * If `dayOfMonth` exceeds the month's length, clamp to last day.
 */
function nextPaymentDate(afterDate: string, dayOfMonth: number): string {
  const d = new Date(afterDate + 'T00:00:00Z');
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth() + 1; // 1-indexed

  // Start from the same month; if the day hasn't passed, use it
  const lastDay = lastDayOfMonth(year, month);
  const effectiveDay = Math.min(dayOfMonth, lastDay);

  if (d.getUTCDate() <= effectiveDay) {
    // Payment date is still upcoming this month
    return `${year}-${String(month).padStart(2, '0')}-${String(effectiveDay).padStart(2, '0')}`;
  }

  // Move to next month
  month += 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  const nextLastDay = lastDayOfMonth(year, month);
  const nextEffectiveDay = Math.min(dayOfMonth, nextLastDay);
  return `${year}-${String(month).padStart(2, '0')}-${String(nextEffectiveDay).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/*  New-column fields (may not exist yet in DB)                        */
/* ------------------------------------------------------------------ */
const NEW_COLUMNS = [
  'confirmed_draft_date',
  'confirmed_edit_date',
  'confirmed_upload_date',
  'draft_received_at',
  'edit_received_at',
  'uploaded_at',
];

const BASE_SELECT = [
  'id', 'name', 'display_name', 'channel', 'campaign_id',
  'status', 'fee',
  'planned_draft_date', 'planned_edit_date', 'planned_upload_date',
  'published_url', 'settlement_status', 'planned_payment_date',
  'inf_campaigns(name, collab_type, status)',
].join(', ');

const FULL_SELECT = [BASE_SELECT, ...NEW_COLUMNS].join(', ');

/* ------------------------------------------------------------------ */
/*  GET  /api/influencer/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD     */
/* ------------------------------------------------------------------ */
export async function GET(req: NextRequest) {
  await requireAdmin();

  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start');
  const end = searchParams.get('end');

  if (!start || !end) {
    return NextResponse.json({ error: 'start and end required' }, { status: 400 });
  }

  const today = toDateStr(new Date());

  // ---- 1. Fetch participants with date overlap ----
  let hasNewColumns = true;

  const dateOrFilter = [
    `planned_draft_date.gte.${start},planned_draft_date.lte.${end}`,
    `planned_edit_date.gte.${start},planned_edit_date.lte.${end}`,
    `planned_upload_date.gte.${start},planned_upload_date.lte.${end}`,
  ].join(',');

  // Parallel fetch: participants + payment schedule setting
  const [participantsResult1, { data: paymentScheduleSetting }] = await Promise.all([
    supabaseAdmin
      .from('inf_participants')
      .select(FULL_SELECT)
      .neq('status', 'cancelled')
      .or(dateOrFilter),
    supabaseAdmin
      .from('inf_settings')
      .select('value')
      .eq('key', 'payment_schedule')
      .single(),
  ]);

  let participantsResult = participantsResult1;

  // Graceful fallback: if error mentions a column name, retry without new columns
  if (participantsResult.error && participantsResult.error.message.includes('column')) {
    hasNewColumns = false;
    participantsResult = await supabaseAdmin
      .from('inf_participants')
      .select(BASE_SELECT)
      .neq('status', 'cancelled')
      .or(dateOrFilter);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const participants = (participantsResult.data ?? []) as any[];

  const paymentSchedule = paymentScheduleSetting?.value as
    | { day_of_month?: number }
    | null;
  const dayOfMonth = paymentSchedule?.day_of_month ?? 25; // default 25th

  // ---- Generate events from participants ----
  interface CalendarEvent {
    id: string;
    type: 'draft' | 'edit' | 'upload' | 'payment' | 'custom';
    date: string;
    title: string;
    campaign_name: string;
    participant_id: string;
    campaign_id: string;
    is_confirmed: boolean;
    is_completed: boolean;
    is_overdue: boolean;
    channel: string | null;
    memo?: string | null;
    schedule_id?: string;
  }

  const events: CalendarEvent[] = [];

  for (const p of participants) {
    const campaign = p.inf_campaigns as { name: string; collab_type: string; status: string } | null;

    // [FIX] dashboard와 동일 대상: active/preparing 캠페인만
    const campStatus = campaign?.status ?? '';
    if (campStatus !== 'active' && campStatus !== 'preparing') continue;

    const collabType = campaign?.collab_type ?? null;
    const campaignName = campaign?.name ?? '';
    const title = p.name || p.display_name || '';
    const participantId = p.id as string;
    const campaignId = p.campaign_id as string;
    const channel = (p.channel as string) || null;
    const fee = Number(p.fee) || 0;
    const settlementStatus = (p.settlement_status as string) || '';

    // New columns (may be undefined if not present)
    const confirmedDraft = hasNewColumns ? (p.confirmed_draft_date as string | null) : null;
    const confirmedEdit = hasNewColumns ? (p.confirmed_edit_date as string | null) : null;
    const confirmedUpload = hasNewColumns ? (p.confirmed_upload_date as string | null) : null;
    const draftReceivedAt = hasNewColumns ? (p.draft_received_at as string | null) : null;
    const editReceivedAt = hasNewColumns ? (p.edit_received_at as string | null) : null;
    const uploadedAt = hasNewColumns ? (p.uploaded_at as string | null) : null;

    const paid = isPaidCollab(collabType) || fee > 0;

    // [FIX] 완료된 참여자 제외 (dashboard와 동일 기준)
    if (paid && settlementStatus === 'paid') continue;
    if (!paid && (uploadedAt || p.published_url)) continue;

    if (paid) {
      // Draft event
      const draftDate = confirmedDraft || (p.planned_draft_date as string | null);
      if (draftDate) {
        events.push({
          id: `${participantId}_draft`,
          type: 'draft',
          date: draftDate,
          title,
          campaign_name: campaignName,
          participant_id: participantId,
          campaign_id: campaignId,
          is_confirmed: !!confirmedDraft,
          is_completed: !!draftReceivedAt,
          is_overdue: draftDate < today && !draftReceivedAt,
          channel,
        });
      }

      // Edit event
      const editDate = confirmedEdit || (p.planned_edit_date as string | null);
      if (editDate) {
        events.push({
          id: `${participantId}_edit`,
          type: 'edit',
          date: editDate,
          title,
          campaign_name: campaignName,
          participant_id: participantId,
          campaign_id: campaignId,
          is_confirmed: !!confirmedEdit,
          is_completed: !!editReceivedAt,
          is_overdue: editDate < today && !editReceivedAt,
          channel,
        });
      }

      // Upload event
      const uploadDate = confirmedUpload || (p.planned_upload_date as string | null);
      if (uploadDate) {
        events.push({
          id: `${participantId}_upload`,
          type: 'upload',
          date: uploadDate,
          title,
          campaign_name: campaignName,
          participant_id: participantId,
          campaign_id: campaignId,
          is_confirmed: !!confirmedUpload,
          is_completed: !!uploadedAt || !!p.published_url,
          is_overdue: uploadDate < today && !uploadedAt && !p.published_url,
          channel,
        });
      }
    } else {
      // Free collab: upload event only
      const uploadDate = confirmedUpload || (p.planned_upload_date as string | null);
      if (uploadDate) {
        events.push({
          id: `${participantId}_upload`,
          type: 'upload',
          date: uploadDate,
          title,
          campaign_name: campaignName,
          participant_id: participantId,
          campaign_id: campaignId,
          is_confirmed: !!confirmedUpload,
          is_completed: !!uploadedAt || !!p.published_url,
          is_overdue: uploadDate < today && !uploadedAt && !p.published_url,
          channel,
        });
      }
    }

    // Payment event — use planned_payment_date if stored, otherwise calculate
    if (
      fee > 0 &&
      (settlementStatus === 'docs_submitted' || settlementStatus === 'payment_requested' || settlementStatus === 'payment_waiting')
    ) {
      let payDate: string | null = (p.planned_payment_date as string | null) || null;
      if (!payDate) {
        const uploadConfirmDate = uploadedAt
          ? uploadedAt.slice(0, 10)
          : (p.published_url ? (confirmedUpload || (p.planned_upload_date as string | null) || today) : null);
        if (uploadConfirmDate) {
          payDate = nextPaymentDate(uploadConfirmDate, dayOfMonth);
        }
      }
      if (payDate) {
        events.push({
          id: `${participantId}_payment`,
          type: 'payment',
          date: payDate,
          title,
          campaign_name: campaignName,
          participant_id: participantId,
          campaign_id: campaignId,
          is_confirmed: true,
          is_completed: false,
          is_overdue: payDate < today,
          channel,
        });
      }
    }
  }

  // ---- 2. Manual schedules from inf_schedules ----
  let manualEvents: CalendarEvent[] = [];
  try {
    const { data: schedules, error } = await supabaseAdmin
      .from('inf_schedules')
      .select('*')
      .gte('date', start)
      .lte('date', end);

    if (!error && schedules) {
      manualEvents = schedules.map((s) => ({
        id: s.id as string,
        type: 'custom' as const,
        date: s.date as string,
        title: (s.title as string) || '',
        campaign_name: (s.campaign_name as string) || null as string | null,
        participant_id: (s.participant_id as string) || null as string | null,
        campaign_id: (s.campaign_id as string) || null as string | null,
        is_confirmed: true,
        is_completed: false,
        is_overdue: false,
        channel: null,
        memo: (s.memo as string) || null,
        schedule_id: s.id as string,
      })) as CalendarEvent[];
    }
  } catch {
    // inf_schedules table may not exist yet
  }

  // ---- Merge & sort ----
  const allEvents = [...events, ...manualEvents].sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    return (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9);
  });

  return NextResponse.json({ events: allEvents });
}

/* ------------------------------------------------------------------ */
/*  POST  /api/influencer/calendar  — Create manual schedule           */
/* ------------------------------------------------------------------ */
export async function POST(req: NextRequest) {
  const user = await requireAdmin();
  const body = await req.json();

  const { title, date, campaign_id, participant_id, memo } = body;

  if (!title || !date) {
    return NextResponse.json({ error: 'title and date required' }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('inf_schedules')
      .insert({
        title,
        date,
        campaign_id: campaign_id || null,
        participant_id: participant_id || null,
        memo: memo || null,
        created_by: user.email || 'admin',
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const event = {
      id: data.id,
      type: 'custom',
      date: data.date,
      title: data.title,
      campaign_name: null,
      participant_id: data.participant_id || null,
      campaign_id: data.campaign_id || null,
      is_confirmed: true,
      is_completed: false,
      is_overdue: false,
      channel: null,
      memo: data.memo || null,
      schedule_id: data.id,
    };

    return NextResponse.json(event, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: 'inf_schedules table does not exist yet' },
      { status: 500 },
    );
  }
}

/* ------------------------------------------------------------------ */
/*  PUT  /api/influencer/calendar  — Update manual schedule            */
/* ------------------------------------------------------------------ */
export async function PUT(req: NextRequest) {
  await requireAdmin();
  const body = await req.json();

  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  try {
    const updateData: Record<string, unknown> = {};
    if (updates.title !== undefined) updateData.title = updates.title;
    if (updates.date !== undefined) updateData.date = updates.date;
    if (updates.campaign_id !== undefined) updateData.campaign_id = updates.campaign_id || null;
    if (updates.participant_id !== undefined) updateData.participant_id = updates.participant_id || null;
    if (updates.memo !== undefined) updateData.memo = updates.memo || null;

    const { data, error } = await supabaseAdmin
      .from('inf_schedules')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: 'inf_schedules table does not exist yet' },
      { status: 500 },
    );
  }
}

/* ------------------------------------------------------------------ */
/*  DELETE  /api/influencer/calendar  — Delete manual schedule         */
/* ------------------------------------------------------------------ */
export async function DELETE(req: NextRequest) {
  await requireAdmin();
  const body = await req.json();

  const { id } = body;

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  try {
    const { error } = await supabaseAdmin
      .from('inf_schedules')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: 'inf_schedules table does not exist yet' },
      { status: 500 },
    );
  }
}
