#!/usr/bin/env node
/**
 * Coupang Open API → Supabase sales_coupang 백필 스크립트.
 *
 * 사용법:
 *   node scripts/backfill-sales.mjs                    # 누락 날짜 자동 감지 후 백필
 *   node scripts/backfill-sales.mjs --dry-run          # 실제 삽입 없이 조회만
 *   node scripts/backfill-sales.mjs --from 2026-05-01 --to 2026-05-31   # 특정 구간
 *
 * 환경변수 (.env.local):
 *   COUPANG_VENDOR_ID, COUPANG_ACCESS_KEY, COUPANG_SECRET_KEY
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/*  Parse .env.local                                                    */
/* ------------------------------------------------------------------ */
const envPath = path.resolve(import.meta.dirname, '..', '.env.local');
const envText = fs.readFileSync(envPath, 'utf-8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const VENDOR_ID = process.env.COUPANG_VENDOR_ID;
const ACCESS_KEY = process.env.COUPANG_ACCESS_KEY;
const SECRET_KEY = process.env.COUPANG_SECRET_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!VENDOR_ID || !ACCESS_KEY || !SECRET_KEY) {
  console.error('ERROR: Coupang credentials missing in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const BASE_URL = 'https://api-gateway.coupang.com';

/* ------------------------------------------------------------------ */
/*  Brand detection — HEEDA vendor_item_ids + name pattern               */
/* ------------------------------------------------------------------ */
const HEEDA_VIDS = new Set([
  // 클렌징밤
  '90554556327', '90621781347', '94426583769',       // 단품
  '93924698351', '93924698352', '91329716230',       // 2개/3개/4개 세트
  // 클렌징폼
  '91007861343', '92197095172',                       // 단품 (촉촉 숯 수분)
  '91007763848',                                      // 단품 (히알루론산 약산성)
  '93943745189', '91541164600',                       // 2개세트
  '93943745188', '91541180389',                       // 3개세트
  // 세럼
  '93993063704',                                      // 단품
]);

function detectBrand(vendorItemId, productName) {
  if (HEEDA_VIDS.has(String(vendorItemId))) return 'HEEDA';
  const lower = (productName || '').toLowerCase();
  if (lower.includes('슈퍼랩스') || lower.includes('superlabs') || lower.includes('super labs')) return 'SUPERLABS';
  // 클렌징밤, 클렌징폼(폼클렌징 포함), 세럼 → 비활성 SKU도 모두 HEEDA
  if (lower.includes('희다') || lower.includes('heeda') ||
      lower.includes('클렌징밤') || lower.includes('클렌징 밤') ||
      lower.includes('클렌징폼') || lower.includes('클렌징 폼') || lower.includes('폼클렌징') ||
      lower.includes('세럼')) return 'HEEDA';
  return 'OTHER';
}

/* ------------------------------------------------------------------ */
/*  CLI args                                                            */
/* ------------------------------------------------------------------ */
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
let CLI_FROM = null;
let CLI_TO = null;
const fromIdx = args.indexOf('--from');
if (fromIdx >= 0) CLI_FROM = args[fromIdx + 1];
const toIdx = args.indexOf('--to');
if (toIdx >= 0) CLI_TO = args[toIdx + 1];

/* ------------------------------------------------------------------ */
/*  HMAC auth (same as bolt.a _coupang_api.py)                          */
/* ------------------------------------------------------------------ */
function signedDateUTC() {
  const now = new Date();
  const y = String(now.getUTCFullYear()).slice(2);
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const h = String(now.getUTCHours()).padStart(2, '0');
  const mi = String(now.getUTCMinutes()).padStart(2, '0');
  const s = String(now.getUTCSeconds()).padStart(2, '0');
  return `${y}${mo}${d}T${h}${mi}${s}Z`;
}

function authHeader(method, apiPath, queryString = '') {
  const sd = signedDateUTC();
  const message = sd + method + apiPath + queryString;
  const signature = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(message)
    .digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${ACCESS_KEY}, signed-date=${sd}, signature=${signature}`;
}

async function coupangRequest(method, apiPath, query = {}) {
  const qs = new URLSearchParams(query).toString();
  const url = `${BASE_URL}${apiPath}${qs ? '?' + qs : ''}`;
  const auth = authHeader(method, apiPath, qs);

  const resp = await fetch(url, {
    method,
    headers: {
      'Content-type': 'application/json;charset=UTF-8',
      Authorization: auth,
    },
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${resp.statusText} — ${method} ${apiPath}\n${body.slice(0, 500)}`);
  }

  return resp.json();
}

/* ------------------------------------------------------------------ */
/*  Revenue History API (매출내역 조회)                                  */
/* ------------------------------------------------------------------ */
async function fetchRevenueHistory(dateFrom, dateTo) {
  const apiPath = `/v2/providers/openapi/apis/api/v1/revenue-history`;
  const allItems = [];
  let token = '';
  let page = 0;

  while (true) {
    page++;
    const query = {
      vendorId: VENDOR_ID,
      recognitionDateFrom: dateFrom,
      recognitionDateTo: dateTo,
      token: token,
      maxPerPage: '50',
    };

    const resp = await coupangRequest('GET', apiPath, query);

    if (!resp.data) {
      console.log(`  [revenue-history] ${dateFrom}~${dateTo} page ${page}: no data field in response`);
      break;
    }

    const orders = resp.data || [];
    for (const order of orders) {
      const items = order.items || [];
      for (const item of items) {
        allItems.push({
          orderId: order.orderId,
          saleType: order.saleType || 'SALE',
          saleDate: order.recognitionDate || dateFrom,
          item,
          order: {
            deliveryFee: order.deliveryFee,
            settlementDate: order.settlementDate,
            recognitionDate: order.recognitionDate,
            finalSettlementDate: order.finalSettlementDate,
          },
        });
      }
    }

    // Pagination
    const nextToken = resp.nextToken || '';
    if (!nextToken || orders.length === 0) break;
    token = nextToken;
  }

  return allItems;
}

/* ------------------------------------------------------------------ */
/*  Settlement History API (정산내역 조회)                               */
/* ------------------------------------------------------------------ */
async function fetchSettlementHistory(yearMonth) {
  // yearMonth format: "2026-05"
  const apiPath = `/v2/providers/marketplace_openapi/apis/api/v1/settlement-histories`;
  const query = {
    revenueRecognitionYearMonth: yearMonth,
  };

  const resp = await coupangRequest('GET', apiPath, query);
  return resp.data || [];
}

/* ------------------------------------------------------------------ */
/*  Find missing dates in sales_coupang                                 */
/* ------------------------------------------------------------------ */
async function findMissingDates(startDate, endDate) {
  // Get all distinct dates with data
  const { data: rows } = await supabase
    .from('sales_coupang')
    .select('sale_date')
    .gte('sale_date', startDate)
    .lte('sale_date', endDate)
    .order('sale_date', { ascending: true });

  const existingDates = new Set((rows || []).map(r => r.sale_date));

  // Generate all dates in range
  const allDates = [];
  const d = new Date(startDate);
  const end = new Date(endDate);
  while (d <= end) {
    allDates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }

  // Filter to missing
  const missing = allDates.filter(dt => !existingDates.has(dt));
  return { missing, existingDates, totalDays: allDates.length };
}

/* ------------------------------------------------------------------ */
/*  Insert sales rows into Supabase                                     */
/* ------------------------------------------------------------------ */
async function upsertSalesRows(items) {
  if (items.length === 0) return 0;

  const rows = items.map(it => ({
    order_id: it.orderId,
    vendor_item_id: it.item.vendorItemId,
    sale_type: it.saleType,
    sale_date: it.saleDate,
    brand: detectBrand(it.item.vendorItemId, it.item.productName),
    country: 'KR',
    sale_amount: it.item.salePrice || it.item.saleAmount || 0,
    quantity: it.item.quantity || 1,
    settlement_amount: it.item.settlementAmount || 0,
    product_name: it.item.productName || '',
    raw_payload: { item: it.item, order: it.order },
    updated_at: new Date().toISOString(),
  }));

  // Upsert in batches of 100
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error, count } = await supabase
      .from('sales_coupang')
      .upsert(batch, {
        onConflict: 'order_id,vendor_item_id,sale_type',
        ignoreDuplicates: false,
      });

    if (error) {
      console.error(`  [upsert] batch ${i / 100 + 1} error:`, error.message);
    } else {
      inserted += batch.length;
    }
  }

  return inserted;
}

/* ------------------------------------------------------------------ */
/*  Upsert settlement rows                                              */
/* ------------------------------------------------------------------ */
async function upsertSettlementRows(settlements, yearMonth) {
  if (settlements.length === 0) return 0;

  const rows = settlements.map(s => ({
    vendor_id: VENDOR_ID,
    revenue_recognition_year_month: yearMonth,
    settlement_date: s.settlementDate || '',
    settlement_type: s.settlementType || '',
    status: s.status || '',
    final_amount: s.finalAmount || 0,
    settlement_amount: s.settlementTargetAmount || s.totalSale || 0,
    revenue_recognition_date_from: s.revenueRecognitionDateFrom || '',
    revenue_recognition_date_to: s.revenueRecognitionDateTo || '',
    raw_payload: s,
    updated_at: new Date().toISOString(),
  }));

  let inserted = 0;
  for (const row of rows) {
    const { error } = await supabase
      .from('settlements_coupang')
      .upsert(row, {
        onConflict: 'vendor_id,revenue_recognition_year_month,settlement_date,settlement_type',
        ignoreDuplicates: false,
      });

    if (error) {
      console.error(`  [settlement upsert] error:`, error.message);
    } else {
      inserted++;
    }
  }

  return inserted;
}

/* ------------------------------------------------------------------ */
/*  Main                                                                */
/* ------------------------------------------------------------------ */
async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Coupang → Supabase 백필 스크립트`);
  console.log(`Vendor: ${VENDOR_ID}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`${'='.repeat(60)}\n`);

  // --- Determine date range ---
  const dataStart = CLI_FROM || '2026-04-19';
  // KST today
  const kst = new Date(Date.now() + 9 * 3_600_000);
  const today = kst.toISOString().slice(0, 10);
  const dataEnd = CLI_TO || today;

  console.log(`[1] 누락 날짜 확인: ${dataStart} ~ ${dataEnd}`);
  const { missing, existingDates, totalDays } = await findMissingDates(dataStart, dataEnd);
  console.log(`   전체 ${totalDays}일 중 ${existingDates.size}일 적재, ${missing.length}일 누락`);

  if (missing.length === 0) {
    console.log('   ✓ 누락 없음. 백필 불필요.');
  } else {
    // Group missing dates by month for reporting
    const byMonth = {};
    for (const dt of missing) {
      const ym = dt.slice(0, 7);
      if (!byMonth[ym]) byMonth[ym] = [];
      byMonth[ym].push(dt);
    }
    console.log('   누락 날짜 월별:');
    for (const [ym, dates] of Object.entries(byMonth).sort()) {
      console.log(`     ${ym}: ${dates.length}일 누락`);
    }
  }

  // --- Backfill sales data ---
  console.log(`\n[2] 매출 데이터 백필 (revenue-history API)`);
  console.log(`   Coupang API는 최대 31일 구간 제한 → 구간 분할 호출`);

  // Revenue-history API uses recognitionDate, not sale_date.
  // We need to fetch ALL dates to catch any with different recognition dates.
  // Split into 31-day chunks
  const datesToFetch = missing.length > 0 ? missing : [];

  if (datesToFetch.length === 0 && !CLI_FROM) {
    console.log('   누락 없음 — 스킵');
  } else {
    // Create 31-day windows covering all missing dates
    const windows = [];
    if (CLI_FROM && CLI_TO) {
      // Explicit range — split into 31-day chunks
      let ws = new Date(CLI_FROM);
      const we = new Date(CLI_TO);
      while (ws <= we) {
        const windowEnd = new Date(ws);
        windowEnd.setDate(windowEnd.getDate() + 29);
        const actualEnd = windowEnd > we ? we : windowEnd;
        windows.push([
          ws.toISOString().slice(0, 10),
          actualEnd.toISOString().slice(0, 10),
        ]);
        ws = new Date(actualEnd);
        ws.setDate(ws.getDate() + 1);
      }
    } else {
      // Auto-detect: create windows covering missing dates
      // Group consecutive missing dates and create minimal windows
      const sortedMissing = [...datesToFetch].sort();
      let windowStart = null;
      let windowEnd = null;

      for (const dt of sortedMissing) {
        if (!windowStart) {
          windowStart = dt;
          windowEnd = dt;
        } else {
          const daysDiff = (new Date(dt) - new Date(windowEnd)) / 86_400_000;
          if (daysDiff <= 2) {
            // Extend current window (allow 1-day gaps to merge nearby)
            windowEnd = dt;
          } else {
            windows.push([windowStart, windowEnd]);
            windowStart = dt;
            windowEnd = dt;
          }
        }

        // Enforce 31-day max
        if (windowStart && (new Date(windowEnd) - new Date(windowStart)) / 86_400_000 >= 29) {
          windows.push([windowStart, windowEnd]);
          windowStart = null;
          windowEnd = null;
        }
      }
      if (windowStart) windows.push([windowStart, windowEnd]);
    }

    console.log(`   ${windows.length}개 구간으로 분할 호출`);

    let totalFetched = 0;
    let totalInserted = 0;

    for (const [wFrom, wTo] of windows) {
      console.log(`\n   ▶ 구간: ${wFrom} ~ ${wTo}`);
      try {
        const items = await fetchRevenueHistory(wFrom, wTo);
        console.log(`     API 응답: ${items.length}건`);
        totalFetched += items.length;

        if (!DRY_RUN && items.length > 0) {
          const inserted = await upsertSalesRows(items);
          totalInserted += inserted;
          console.log(`     DB 삽입: ${inserted}건`);
        }
      } catch (err) {
        console.error(`     ✗ API 오류: ${err.message}`);
      }

      // Rate limit: 1 req/sec
      await new Promise(r => setTimeout(r, 1200));
    }

    console.log(`\n   매출 백필 완료: ${totalFetched}건 조회, ${DRY_RUN ? '0 (dry-run)' : totalInserted + '건'} 삽입`);
  }

  // --- Backfill settlement data ---
  console.log(`\n[3] 정산 데이터 백필 (settlement-histories API)`);

  // Determine months to check
  const monthsToCheck = new Set();
  const startMonth = dataStart.slice(0, 7);
  const endMonth = dataEnd.slice(0, 7);
  let currentMonth = startMonth;
  while (currentMonth <= endMonth) {
    monthsToCheck.add(currentMonth);
    const [y, m] = currentMonth.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    currentMonth = next;
  }

  // Get existing settlement records
  const { data: existingSettlements } = await supabase
    .from('settlements_coupang')
    .select('revenue_recognition_year_month, settlement_date, settlement_type');

  const existingSettlementKeys = new Set(
    (existingSettlements || []).map(s =>
      `${s.revenue_recognition_year_month}|${s.settlement_date}|${s.settlement_type}`
    )
  );
  console.log(`   기존 정산 레코드: ${existingSettlementKeys.size}건`);

  let settlementFetched = 0;
  let settlementInserted = 0;

  for (const ym of [...monthsToCheck].sort()) {
    try {
      const settlements = await fetchSettlementHistory(ym);
      const newSettlements = settlements.filter(s => {
        const key = `${ym}|${s.settlementDate}|${s.settlementType}`;
        return !existingSettlementKeys.has(key);
      });

      if (settlements.length > 0) {
        console.log(`   ${ym}: API ${settlements.length}건 (신규 ${newSettlements.length}건)`);
      }

      settlementFetched += settlements.length;

      if (!DRY_RUN && newSettlements.length > 0) {
        const inserted = await upsertSettlementRows(newSettlements, ym);
        settlementInserted += inserted;
      }
    } catch (err) {
      console.error(`   ${ym}: ✗ ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 1200));
  }

  console.log(`\n   정산 백필 완료: ${settlementFetched}건 조회, ${DRY_RUN ? '0 (dry-run)' : settlementInserted + '건'} 삽입`);

  // --- Post-backfill report ---
  console.log(`\n[4] 백필 후 월별 적재율 보고`);
  const { missing: postMissing, existingDates: postDates, totalDays: postTotal } =
    await findMissingDates(dataStart, dataEnd);

  const monthReport = {};
  // Compute per-month coverage
  const allDatesInRange = [];
  const d = new Date(dataStart);
  const end = new Date(dataEnd);
  while (d <= end) {
    allDatesInRange.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }

  for (const dt of allDatesInRange) {
    const ym = dt.slice(0, 7);
    if (!monthReport[ym]) monthReport[ym] = { total: 0, covered: 0 };
    monthReport[ym].total++;
    if (postDates.has(dt)) monthReport[ym].covered++;
  }

  console.log('   월별 적재율:');
  for (const [ym, info] of Object.entries(monthReport).sort()) {
    const pct = Math.round((info.covered / info.total) * 100);
    console.log(`     ${ym}: ${info.covered}/${info.total}일 (${pct}%)`);
  }

  // Settlement count
  const { data: finalSettlements } = await supabase
    .from('settlements_coupang')
    .select('revenue_recognition_year_month, settlement_date, settlement_type, final_amount, settlement_amount')
    .order('settlement_date', { ascending: true });

  console.log(`\n   정산 레코드 총 ${(finalSettlements || []).length}건`);

  // August data verification
  console.log(`\n[5] 8월 데이터 정합성 검증`);
  const { data: augRows } = await supabase
    .from('sales_coupang')
    .select('order_id, sale_amount, quantity, vendor_item_id, sale_date, sale_type')
    .eq('brand', 'HEEDA')
    .eq('country', 'KR')
    .gte('sale_date', '2026-08-01')
    .lte('sale_date', '2026-08-31');

  const augSales = (augRows || []).filter(r => r.sale_type === 'SALE');
  const augTotalSales = augSales.reduce((s, r) => s + (Number(r.sale_amount) || 0), 0);
  const augOrderIds = new Set(augSales.map(r => String(r.order_id)));
  const augTotalOrders = augOrderIds.size;

  console.log(`   8월 매출: ${augTotalSales.toLocaleString()}원 (대조 목표: 2,871,200원)`);
  console.log(`   8월 주문: ${augTotalOrders}건 (대조 목표: 156건)`);
  console.log(`   매출 차이: ${(augTotalSales - 2_871_200).toLocaleString()}원`);
  console.log(`   주문 차이: ${augTotalOrders - 156}건`);

  if (augTotalSales !== 2_871_200 || augTotalOrders !== 156) {
    // Show per-day breakdown to identify gaps
    const byDate = {};
    for (const r of augSales) {
      if (!byDate[r.sale_date]) byDate[r.sale_date] = { sales: 0, orders: new Set() };
      byDate[r.sale_date].sales += Number(r.sale_amount) || 0;
      byDate[r.sale_date].orders.add(String(r.order_id));
    }

    // Check which dates are missing
    const augMissing = [];
    for (let dd = 1; dd <= 31; dd++) {
      const dateStr = `2026-08-${String(dd).padStart(2, '0')}`;
      if (!byDate[dateStr]) augMissing.push(dateStr);
    }
    if (augMissing.length > 0) {
      console.log(`   8월 누락 날짜: ${augMissing.join(', ')}`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`백필 완료`);
  console.log(`${'='.repeat(60)}\n`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
