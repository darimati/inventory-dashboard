#!/usr/bin/env node
/**
 * Revenue-history HEEDA 주문이 RG Order API에도 있는지 교차 확인
 * + 비즈니스 보고 수치와의 최종 비교
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(import.meta.dirname, '..', '.env.local');
const envText = fs.readFileSync(envPath, 'utf-8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const VENDOR_ID = process.env.COUPANG_VENDOR_ID;
const ACCESS_KEY = process.env.COUPANG_ACCESS_KEY;
const SECRET_KEY = process.env.COUPANG_SECRET_KEY;
const BASE_URL = 'https://api-gateway.coupang.com';

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
  const signature = crypto.createHmac('sha256', SECRET_KEY).update(message).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${ACCESS_KEY}, signed-date=${sd}, signature=${signature}`;
}

async function coupangGet(apiPath, query = {}) {
  const qs = new URLSearchParams(query).toString();
  const url = `${BASE_URL}${apiPath}${qs ? '?' + qs : ''}`;
  const auth = authHeader('GET', apiPath, qs);
  const resp = await fetch(url, {
    method: 'GET',
    headers: { 'Content-type': 'application/json;charset=UTF-8', Authorization: auth },
  });
  if (!resp.ok) {
    const body = await resp.text();
    return { error: resp.status, body: body.slice(0, 200) };
  }
  return resp.json();
}

async function main() {
  // Revenue-history에서 발견된 HEEDA 주문들
  const revHistoryOrders = [
    { month: '4월', orderId: '12100184828046', vid: '90554556327', salePrice: 12900, date: '2026-04-28' },
    { month: '5월', orderId: '22100184682061', vid: '90554556327', salePrice: 12900, date: '2026-05-02' },
    { month: '7월', orderId: '25101512042234', vid: '91007763848', salePrice: 14100, date: '2026-07-18' },
  ];

  console.log('=== Revenue-history HEEDA 주문 → RG Order API 교차 확인 ===\n');

  for (const rh of revHistoryOrders) {
    console.log(`--- ${rh.month}: orderId ${rh.orderId} ---`);

    // 1. RG Order API로 단건 조회
    const rgPath = `/v2/providers/rg_open_api/apis/api/v1/vendors/${VENDOR_ID}/rg/order/${rh.orderId}`;
    const rgResult = await coupangGet(rgPath);

    if (rgResult.error) {
      console.log(`  RG 단건 조회: HTTP ${rgResult.error} — ${rgResult.body}`);
      console.log(`  → RG에 없음 (판매자배송 전용 주문)`);
    } else {
      console.log(`  RG 단건 조회: 있음`);
      console.log(`  RG data:`, JSON.stringify(rgResult.data || rgResult, null, 2).slice(0, 500));
    }

    // 2. 해당 날짜 전후 RG Order API 리스트에 이 orderId가 있는지
    const dateNum = rh.date.replace(/-/g, '');
    const rgListPath = `/v2/providers/rg_open_api/apis/api/v1/vendors/${VENDOR_ID}/rg/orders`;
    const listResult = await coupangGet(rgListPath, { paidDateFrom: dateNum, paidDateTo: dateNum });
    const listOrders = listResult.data || [];
    const found = listOrders.find(o => String(o.orderId) === rh.orderId);

    console.log(`  RG 리스트 조회 (${dateNum}): ${listOrders.length}건, 해당 ID 발견: ${found ? 'YES' : 'NO'}`);
    if (found) {
      console.log(`  RG unitSalesPrice: ${found.orderItems?.[0]?.unitSalesPrice}`);
    }

    console.log(`  Revenue-history salePrice: ${rh.salePrice.toLocaleString()}원`);
    console.log();
    await new Promise(r => setTimeout(r, 1500));
  }

  // ---- 비즈니스 보고와의 비교표 만들기 ----
  // zoey가 알려준 비즈니스 보고 수치: 7월 = 32건/568,980원
  // 다른 월은 아직 수치 없음 → API 기준으로 rev-history 합산 표시
  console.log('\n=== 월별 종합 (RG Order API + Revenue-history HEEDA) ===');

  const apiMonthly = {
    '2026-04': { orders: 48, total: 800200 },
    '2026-05': { orders: 66, total: 923850 },
    '2026-06': { orders: 64, total: 1003820 },
    '2026-07': { orders: 30, total: 565660 },
    '2026-08': { orders: 145, total: 2691100 },
  };

  const revHistoryMonthly = {
    '2026-04': { orders: 1, total: 12900 },
    '2026-05': { orders: 1, total: 12900 },
    '2026-06': { orders: 0, total: 0 },
    '2026-07': { orders: 1, total: 14100 },
    '2026-08': { orders: 0, total: 0 },
  };

  console.log('월     | RG API건 | RG금액       | RevHist건 | RevHist금액 | 합계건 | 합계금액');
  for (const ym of Object.keys(apiMonthly)) {
    const rg = apiMonthly[ym];
    const rh = revHistoryMonthly[ym];
    const totalOrders = rg.orders + rh.orders;
    const totalAmount = rg.total + rh.total;
    const label = ym.slice(5) + '월';
    console.log(`${ym} | ${String(rg.orders).padStart(8)} | ${rg.total.toLocaleString().padStart(12)}원 | ${String(rh.orders).padStart(9)} | ${rh.total.toLocaleString().padStart(11)}원 | ${String(totalOrders).padStart(6)} | ${totalAmount.toLocaleString().padStart(12)}원`);
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
