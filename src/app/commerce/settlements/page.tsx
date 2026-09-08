export const dynamic = 'force-dynamic';

import { supabaseAdmin } from '@/lib/supabase-server';
import SettlementsClient from './SettlementsClient';

export const metadata = { title: '정산 | HEEDA Commerce' };

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface RawPayload {
  totalSale?: number;
  serviceFee?: number;
  sellerDiscountCoupon?: number;
  downloadableCoupon?: number;
  couranteeFee?: number;
  deductionAmount?: number;
  debtOfLastWeek?: number;
  settlementTargetAmount?: number;
  lastAmount?: number;
  sellerServiceFee?: number;
  storeFeeDiscount?: number;
  pendingReleasedAmount?: number;
  dedicatedDeliveryAmount?: number;
  couranteeCustomerReward?: number;
}

interface SettlementRow {
  vendor_id: string;
  revenue_recognition_year_month: string;
  settlement_date: string;
  settlement_type: string;
  status: string;
  final_amount: number;
  settlement_amount: number;
  revenue_recognition_date_from: string;
  revenue_recognition_date_to: string;
  updated_at: string;
  raw_payload: RawPayload | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Normalise revenue_recognition_year_month to "YYYY-MM" format */
function normalizeYearMonth(ym: string): string {
  if (!ym) return '';
  // "202608" -> "2026-08"
  if (ym.length === 6 && !ym.includes('-')) {
    return `${ym.slice(0, 4)}-${ym.slice(4, 6)}`;
  }
  // Already "2026-08"
  return ym;
}

/** Get KST current year-month as "YYYY-MM" */
function getCurrentYearMonth(): string {
  const kst = new Date(Date.now() + 9 * 3_600_000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Get KST current year */
function getCurrentYear(): number {
  const kst = new Date(Date.now() + 9 * 3_600_000);
  return kst.getUTCFullYear();
}

/** Check if a status means "paid / completed" */
function isPaidStatus(status: string): boolean {
  const s = (status || '').trim();
  return (
    s === '정산완료' ||
    s === '지급완료' ||
    s === 'COMPLETED' ||
    s === 'PAID' ||
    s === 'completed' ||
    s === 'paid' ||
    s === 'DONE' ||
    s === 'done'
  );
}

/** Check if a status means "pending / waiting" */
function isPendingStatus(status: string): boolean {
  const s = (status || '').trim();
  return (
    s === '대기' ||
    s === '미정산' ||
    s === 'PENDING' ||
    s === 'WAITING' ||
    s === 'pending' ||
    s === 'waiting'
  );
}

/* ------------------------------------------------------------------ */
/*  Page (Server Component)                                            */
/* ------------------------------------------------------------------ */

export default async function SettlementsPage() {
  /* --- Query settlements_coupang --- */
  const { data: rawRows } = await supabaseAdmin
    .from('settlements_coupang')
    .select(
      'vendor_id, revenue_recognition_year_month, settlement_date, settlement_type, status, final_amount, settlement_amount, revenue_recognition_date_from, revenue_recognition_date_to, updated_at, raw_payload',
    )
    .order('settlement_date', { ascending: false });

  const rows = (rawRows ?? []) as SettlementRow[];

  /* --- Determine available years for the year filter --- */
  const yearSet = new Set<number>();
  for (const r of rows) {
    const ym = normalizeYearMonth(r.revenue_recognition_year_month);
    if (ym.length >= 4) {
      yearSet.add(parseInt(ym.slice(0, 4)));
    }
  }
  const currentYear = getCurrentYear();
  yearSet.add(currentYear);
  const availableYears = Array.from(yearSet).sort((a, b) => b - a);

  /* --- Compute KPI totals (across ALL data, client will re-filter by year) --- */
  const currentYM = getCurrentYearMonth();

  /* Aggregate per-year data so the client can filter */
  const settlementData = rows.map((r) => {
    const ym = normalizeYearMonth(r.revenue_recognition_year_month);
    const rp = (r.raw_payload || {}) as RawPayload;
    const totalSale = rp.totalSale ?? 0;
    const settlementAmt = totalSale || (Number(r.settlement_amount) || 0);
    const finalAmt = Number(r.final_amount) || 0;
    const deduction = settlementAmt - finalAmt;

    return {
      vendorId: r.vendor_id,
      revenueYearMonth: ym,
      settlementDate: r.settlement_date,
      settlementType: r.settlement_type,
      status: r.status || '',
      finalAmount: finalAmt,
      settlementAmount: settlementAmt,
      deduction,
      revenueFrom: r.revenue_recognition_date_from,
      revenueTo: r.revenue_recognition_date_to,
      updatedAt: r.updated_at,
      isPaid: isPaidStatus(r.status),
      isPending: isPendingStatus(r.status),
      isCurrentMonth: ym === currentYM,
      // Itemized deduction breakdown from raw_payload
      breakdown: {
        totalSale: rp.totalSale ?? 0,
        serviceFee: rp.serviceFee ?? 0,
        sellerDiscountCoupon: rp.sellerDiscountCoupon ?? 0,
        downloadableCoupon: rp.downloadableCoupon ?? 0,
        couranteeFee: rp.couranteeFee ?? 0,
        deductionAmount: rp.deductionAmount ?? 0,
        debtOfLastWeek: rp.debtOfLastWeek ?? 0,
        lastAmount: rp.lastAmount ?? 0,
        pendingReleasedAmount: rp.pendingReleasedAmount ?? 0,
        storeFeeDiscount: rp.storeFeeDiscount ?? 0,
      },
    };
  });

  return (
    <SettlementsClient
      settlements={settlementData}
      availableYears={availableYears}
      currentYear={currentYear}
      currentYearMonth={currentYM}
    />
  );
}
