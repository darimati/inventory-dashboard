#!/usr/bin/env node
/**
 * Coupang Ordersheets → settlement_amount 동기화 스크립트.
 *
 * Ordersheets API에서 FINAL_DELIVERY / DELIVER 상태의 주문을 조회하여
 * 실결제금액(orderPrice)을 sales_coupang.settlement_amount에 저장한다.
 *
 * settlement_amount > 0인 행에 대해:
 *   쿠폰할인 = sale_amount - settlement_amount
 *
 * 사용법:
 *   node scripts/sync-coupons.mjs                # 최근 7일 주문 동기화
 *   node scripts/sync-coupons.mjs --days 14      # 최근 14일
 *   node scripts/sync-coupons.mjs --dry-run      # 조회만
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
/*  CLI args                                                            */
/* ------------------------------------------------------------------ */
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const daysIdx = args.indexOf('--days');
const LOOKBACK_DAYS = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) || 7 : 7;

/* ------------------------------------------------------------------ */
/*  HMAC auth (same as backfill-sales.mjs)                              */
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
/*  HEEDA VIDs (same set as backfill-sales.mjs)                         */
/* ------------------------------------------------------------------ */
const HEEDA_VIDS = new Set([
  '90554556327', '90621781347', '94426583769',
  '93924698351', '93924698352', '91329716230',
  '91007861343', '92197095172', '91007763848',
  '93943745189', '91541164600',
  '93943745188', '91541180389',
  '93993063704',
]);

function isHeedaItem(vendorItemId, productName) {
  if (HEEDA_VIDS.has(String(vendorItemId))) return true;
  const lower = (productName || '').toLowerCase();
  if (lower.includes('희다') || lower.includes('heeda') ||
      lower.includes('클렌징밤') || lower.includes('클렌징 밤') ||
      lower.includes('클렌징폼') || lower.includes('클렌징 폼') || lower.includes('폼클렌징') ||
      lower.includes('세럼')) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/*  Price helpers                                                       */
/* ------------------------------------------------------------------ */
function priceToNumber(price) {
  if (typeof price === 'number') return price;
  if (!price) return 0;
  // Coupang uses {currencyCode, units, nanos} format
  return (Number(price.units) || 0) + (Number(price.nanos) || 0) / 1e9;
}

/* ------------------------------------------------------------------ */
/*  Fetch ordersheets                                                   */
/* ------------------------------------------------------------------ */
async function fetchOrdersheets(status, createdAtFrom, createdAtTo) {
  const apiPath = `/v2/providers/openapi/apis/api/v5/vendors/${VENDOR_ID}/ordersheets`;
  const allItems = [];
  let searchAfter = '';
  let page = 0;

  while (true) {
    page++;
    const query = {
      createdAtFrom,
      createdAtTo,
      status,
      maxPerPage: '50',
    };
    if (searchAfter) query.searchAfter = searchAfter;

    let resp;
    try {
      resp = await coupangRequest('GET', apiPath, query);
    } catch (err) {
      console.error(`  [ordersheets] ${status} page ${page}: ${err.message}`);
      break;
    }

    const data = resp.data || [];
    if (data.length === 0) break;

    for (const order of data) {
      const orderId = order.orderId;
      // Items are directly in order.orderItems (not nested in shipmentBoxes)
      const orderItems = order.orderItems || [];

      for (const item of orderItems) {
        const vid = String(item.vendorItemId || '');
        const productName = item.vendorItemName || '';

        if (!isHeedaItem(vid, productName)) continue;

        // All price/discount fields use {currencyCode, units, nanos} format
        const salesPrice = priceToNumber(item.salesPrice) || Number(item.unitPrice) || 0;
        const orderPrice = priceToNumber(item.orderPrice) || 0;
        const coupangDiscount = priceToNumber(item.coupangDiscount);
        const instantCouponDiscount = priceToNumber(item.instantCouponDiscount);
        const downloadableCouponDiscount = priceToNumber(item.downloadableCouponDiscount);
        const totalDiscount = coupangDiscount + instantCouponDiscount + downloadableCouponDiscount;

        allItems.push({
          orderId,
          vendorItemId: vid,
          productName,
          salesPrice,
          orderPrice,
          coupangDiscount,
          instantCouponDiscount,
          downloadableCouponDiscount,
          totalDiscount,
          quantity: Number(item.shippingCount) || 1,
          paidAt: order.paidAt || order.orderedAt || '',
        });
      }
    }

    searchAfter = resp.nextToken || '';
    if (!searchAfter) break;

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  return allItems;
}

/* ------------------------------------------------------------------ */
/*  Main                                                                */
/* ------------------------------------------------------------------ */
async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`쿠폰 할인 데이터 동기화 (ordersheets → settlement_amount)`);
  console.log(`Vendor: ${VENDOR_ID}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Lookback: ${LOOKBACK_DAYS}일`);
  console.log(`${'='.repeat(60)}\n`);

  // Date range: last N days (Coupang requires yyyy-MM-dd+09:00 format for KST)
  const kst = new Date(Date.now() + 9 * 3_600_000);
  const toDate = kst.toISOString().slice(0, 10);
  const fromDate = new Date(kst);
  fromDate.setDate(fromDate.getDate() - LOOKBACK_DAYS);
  const fromDateStr = fromDate.toISOString().slice(0, 10);

  // Coupang ordersheets API needs ISO date with timezone: yyyy-MM-dd+09:00
  const apiFromDate = `${fromDateStr}+09:00`;
  const apiToDate = `${toDate}+09:00`;

  console.log(`[1] Ordersheets 조회: ${fromDateStr} ~ ${toDate}`);

  // Try multiple statuses to catch orders at different stages
  const statuses = ['FINAL_DELIVERY', 'DEPARTURE', 'INSTRUCT', 'ACCEPT'];
  let allItems = [];

  for (const status of statuses) {
    console.log(`\n   ▶ Status: ${status}`);
    try {
      const items = await fetchOrdersheets(status, apiFromDate, apiToDate);
      console.log(`     HEEDA items: ${items.length}건`);
      allItems.push(...items);
    } catch (err) {
      console.error(`     ✗ ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  // Deduplicate by orderId + vendorItemId
  const seen = new Set();
  const uniqueItems = [];
  for (const item of allItems) {
    const key = `${item.orderId}|${item.vendorItemId}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueItems.push(item);
    }
  }

  console.log(`\n[2] 수집 결과: ${uniqueItems.length}건 (중복 제거 후)`);

  if (uniqueItems.length === 0) {
    console.log('   현재 조회 가능한 HEEDA 주문이 없습니다.');
    console.log('   (주문이 배송 완료 후 일정 기간이 지나면 ordersheets에서 사라집니다)');
    console.log(`\n${'='.repeat(60)}\n`);
    return;
  }

  // Show sample
  console.log('\n   샘플 (최대 3건):');
  for (const item of uniqueItems.slice(0, 3)) {
    console.log(`     주문 ${item.orderId} | VID ${item.vendorItemId}`);
    console.log(`       상품명: ${item.productName}`);
    console.log(`       정상가: ${item.salesPrice.toLocaleString()}원`);
    console.log(`       결제가: ${item.orderPrice.toLocaleString()}원`);
    console.log(`       할인: 쿠팡 ${item.coupangDiscount}, 즉시 ${item.instantCouponDiscount}, 다운로드 ${item.downloadableCouponDiscount}`);
    console.log(`       총할인: ${item.totalDiscount.toLocaleString()}원`);
  }

  // Summary
  const totalSalesPrice = uniqueItems.reduce((s, i) => s + i.salesPrice, 0);
  const totalOrderPrice = uniqueItems.reduce((s, i) => s + i.orderPrice, 0);
  const totalDiscount = uniqueItems.reduce((s, i) => s + i.totalDiscount, 0);
  const itemsWithDiscount = uniqueItems.filter(i => i.totalDiscount > 0);

  console.log(`\n   정상가 합계: ${totalSalesPrice.toLocaleString()}원`);
  console.log(`   결제가 합계: ${totalOrderPrice.toLocaleString()}원`);
  console.log(`   총 할인액: ${totalDiscount.toLocaleString()}원`);
  console.log(`   할인 적용 건: ${itemsWithDiscount.length}/${uniqueItems.length}건`);

  // [3] Update settlement_amount in DB
  console.log(`\n[3] DB 업데이트 (settlement_amount)`);

  let updated = 0;
  let notFound = 0;
  let errors = 0;

  for (const item of uniqueItems) {
    if (DRY_RUN) {
      // Check if the row exists
      const { data } = await supabase
        .from('sales_coupang')
        .select('order_id, sale_amount, settlement_amount')
        .eq('order_id', item.orderId)
        .eq('vendor_item_id', item.vendorItemId)
        .eq('sale_type', 'SALE')
        .limit(1);

      if (data && data.length > 0) {
        const existing = data[0];
        const currentSettlement = Number(existing.settlement_amount) || 0;
        if (currentSettlement === 0 && item.orderPrice > 0) {
          console.log(`     [DRY] 주문 ${item.orderId}: settlement ${currentSettlement} → ${item.orderPrice}`);
          updated++;
        }
      } else {
        notFound++;
      }
    } else {
      // Update settlement_amount where order matches
      const { data, error } = await supabase
        .from('sales_coupang')
        .update({
          settlement_amount: item.orderPrice,
          updated_at: new Date().toISOString(),
        })
        .eq('order_id', item.orderId)
        .eq('vendor_item_id', item.vendorItemId)
        .eq('sale_type', 'SALE')
        .select('order_id');

      if (error) {
        errors++;
        console.error(`     ✗ 주문 ${item.orderId}: ${error.message}`);
      } else if (data && data.length > 0) {
        updated++;
      } else {
        notFound++;
      }
    }
  }

  console.log(`\n   업데이트: ${updated}건`);
  console.log(`   DB 미매칭: ${notFound}건 (ordersheets에만 있고 sales_coupang에 없는 주문)`);
  if (errors > 0) console.log(`   오류: ${errors}건`);

  // [4] Coverage report
  console.log(`\n[4] 쿠폰 데이터 커버리지`);
  const { data: coverageData } = await supabase
    .from('sales_coupang')
    .select('settlement_amount, sale_amount')
    .eq('brand', 'HEEDA')
    .eq('country', 'KR')
    .eq('sale_type', 'SALE');

  const totalRows = (coverageData || []).length;
  const withCouponData = (coverageData || []).filter(r => Number(r.settlement_amount) > 0).length;
  const totalSaleAmount = (coverageData || []).reduce((s, r) => s + (Number(r.sale_amount) || 0), 0);
  const totalSettlementAmount = (coverageData || [])
    .filter(r => Number(r.settlement_amount) > 0)
    .reduce((s, r) => s + (Number(r.settlement_amount) || 0), 0);
  const totalSaleOfCovered = (coverageData || [])
    .filter(r => Number(r.settlement_amount) > 0)
    .reduce((s, r) => s + (Number(r.sale_amount) || 0), 0);
  const couponTotal = totalSaleOfCovered - totalSettlementAmount;

  console.log(`   전체 HEEDA 매출 행: ${totalRows}건`);
  console.log(`   쿠폰 데이터 보유: ${withCouponData}건 (${totalRows > 0 ? ((withCouponData / totalRows) * 100).toFixed(1) : 0}%)`);
  console.log(`   커버 구간 정상가 합계: ${totalSaleOfCovered.toLocaleString()}원`);
  console.log(`   커버 구간 결제가 합계: ${totalSettlementAmount.toLocaleString()}원`);
  console.log(`   커버 구간 쿠폰할인 합계: ${couponTotal.toLocaleString()}원`);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`동기화 완료`);
  console.log(`${'='.repeat(60)}\n`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
