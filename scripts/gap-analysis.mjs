#!/usr/bin/env node
/**
 * 전체 월 오차 분석 — API paidDate 기준 vs KST 날짜 기준
 * API 제한: 조회 범위 최대 1개월
 * → 각 월을 ±2일 확장해서 조회, 중복 제거 후 분석
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

const HEEDA_VIDS = new Set([
  '90554556327', '90621781347', '94426583769',
  '93924698351', '93924698352', '91329716230',
  '91007861343', '92197095172', '91007763848',
  '93943745189', '91541164600', '93943745188', '91541180389',
  '93993063704',
]);

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
    throw new Error(`HTTP ${resp.status}: ${body.slice(0, 300)}`);
  }
  return resp.json();
}

async function fetchAllOrders(dateFrom, dateTo) {
  const apiPath = `/v2/providers/rg_open_api/apis/api/v1/vendors/${VENDOR_ID}/rg/orders`;
  let allOrders = [];
  let nextToken = '';
  while (true) {
    const query = { paidDateFrom: dateFrom, paidDateTo: dateTo };
    if (nextToken) query.nextToken = nextToken;
    const resp = await coupangGet(apiPath, query);
    const orders = resp.data || [];
    allOrders = allOrders.concat(orders);
    if (!resp.nextToken || orders.length === 0) break;
    nextToken = resp.nextToken;
    await new Promise(r => setTimeout(r, 300));
  }
  return allOrders;
}

function detectBrand(vendorItemId, productName) {
  if (HEEDA_VIDS.has(String(vendorItemId))) return 'HEEDA';
  const lower = (productName || '').toLowerCase();
  if (lower.includes('희다') || lower.includes('heeda') ||
      lower.includes('클렌징밤') || lower.includes('클렌징 밤') ||
      lower.includes('클렌징폼') || lower.includes('클렌징 폼') ||
      lower.includes('폼클렌징') || lower.includes('세럼')) return 'HEEDA';
  return 'OTHER';
}

function yyyymmdd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

async function main() {
  console.log('=== 전체 월 오차 분석 ===\n');

  // 각 월을 ±2일 확장 조회 → 전체 주문 수집 → orderId 중복 제거
  const allOrderMap = new Map(); // orderId → order object

  // API 최대 31일 제한 → 각 월 정규 조회 + 경계일 별도 조회
  const ranges = [
    // 경계: 3월 마지막 3일
    { from: '20260328', to: '20260331', label: '3월 경계' },
    // 4월 정규
    { from: '20260401', to: '20260430', label: '4월' },
    // 5월 정규
    { from: '20260501', to: '20260531', label: '5월' },
    // 6월 정규
    { from: '20260601', to: '20260630', label: '6월' },
    // 7월 정규
    { from: '20260701', to: '20260731', label: '7월' },
    // 8월 정규
    { from: '20260801', to: '20260831', label: '8월' },
    // 경계: 9월 첫 2일
    { from: '20260901', to: '20260902', label: '9월 경계' },
  ];

  for (const r of ranges) {
    console.log(`조회: ${r.label} (${r.from}~${r.to})`);
    const orders = await fetchAllOrders(r.from, r.to);
    console.log(`  → ${orders.length}건`);
    for (const o of orders) {
      if (!allOrderMap.has(o.orderId)) {
        allOrderMap.set(o.orderId, o);
      }
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\n전체 고유 주문: ${allOrderMap.size}\n`);

  // 모든 주문을 line item 단위로 분석
  const items = [];
  for (const [orderId, order] of allOrderMap) {
    const paidAtMs = order.paidAt;
    const utcDate = new Date(paidAtMs);
    const kstDate = new Date(paidAtMs + 9 * 3_600_000);
    const utcDay = utcDate.toISOString().slice(0, 10);
    const kstDay = kstDate.toISOString().slice(0, 10);

    for (const item of (order.orderItems || [])) {
      const brand = detectBrand(item.vendorItemId, item.productName);
      const unitPrice = parseFloat(item.unitSalesPrice) || 0;
      const qty = Number(item.salesQuantity) || 1;
      items.push({
        orderId,
        vendorItemId: String(item.vendorItemId),
        productName: item.productName,
        brand,
        unitPrice,
        qty,
        lineTotal: unitPrice * qty,
        paidAtMs,
        utcDay,
        kstDay,
        utcMonth: utcDay.slice(0, 7),
        kstMonth: kstDay.slice(0, 7),
        monthMismatch: utcDay.slice(0, 7) !== kstDay.slice(0, 7),
      });
    }
  }

  // ---- UTC/KST 월 경계 불일치 ----
  const mismatches = items.filter(d => d.monthMismatch && d.brand === 'HEEDA');
  console.log(`=== UTC/KST 월 경계 불일치 HEEDA 주문: ${mismatches.length}건 ===`);
  for (const d of mismatches) {
    console.log(`  orderId: ${d.orderId}, UTC: ${d.utcDay} (${d.utcMonth}), KST: ${d.kstDay} (${d.kstMonth}), ${d.lineTotal.toLocaleString()}원, "${d.productName}"`);
  }

  // ---- 월별 집계 비교 ----
  const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];

  console.log('\n=== 월별 HEEDA 집계 (UTC vs KST vs API paidDate) ===\n');

  const results = [];

  for (const ym of months) {
    const [y, m] = ym.split('-');
    const lastDay = new Date(Number(y), Number(m), 0).getDate();

    // KST 기준 이 월에 속하는 주문
    const byKST = items.filter(d => d.kstMonth === ym && d.brand === 'HEEDA');
    const kstOrderIds = new Set(byKST.map(d => d.orderId));
    const kstTotal = byKST.reduce((s, d) => s + d.lineTotal, 0);

    // UTC 기준
    const byUTC = items.filter(d => d.utcMonth === ym && d.brand === 'HEEDA');
    const utcOrderIds = new Set(byUTC.map(d => d.orderId));
    const utcTotal = byUTC.reduce((s, d) => s + d.lineTotal, 0);

    // API paidDate 기준 (정규 조회)
    const dateFrom = `${y}${m}01`;
    const dateTo = `${y}${m}${String(lastDay).padStart(2, '0')}`;
    await new Promise(r => setTimeout(r, 1500));
    const apiOrders = await fetchAllOrders(dateFrom, dateTo);
    const apiItems = apiOrders.flatMap(o =>
      (o.orderItems || []).filter(i => detectBrand(i.vendorItemId, i.productName) === 'HEEDA').map(i => ({
        orderId: o.orderId,
        lineTotal: (parseFloat(i.unitSalesPrice) || 0) * (Number(i.salesQuantity) || 1),
      }))
    );
    const apiOrderIds = new Set(apiItems.map(i => i.orderId));
    const apiTotal = apiItems.reduce((s, i) => s + i.lineTotal, 0);

    console.log(`${ym}:`);
    console.log(`  API paidDate(${dateFrom}~${dateTo}): ${apiOrderIds.size}주문, ${apiItems.length}건, ${apiTotal.toLocaleString()}원`);
    console.log(`  KST 기준: ${kstOrderIds.size}주문, ${byKST.length}건, ${kstTotal.toLocaleString()}원`);
    console.log(`  UTC 기준: ${utcOrderIds.size}주문, ${byUTC.length}건, ${utcTotal.toLocaleString()}원`);

    // 차이 분석
    const apiNotKST = [...apiOrderIds].filter(id => !kstOrderIds.has(id));
    const kstNotAPI = [...kstOrderIds].filter(id => !apiOrderIds.has(id));

    if (apiNotKST.length > 0) {
      console.log(`  → API에만 (KST 다른 월): ${apiNotKST.join(', ')}`);
      for (const id of apiNotKST) {
        const d = items.find(i => i.orderId === id);
        if (d) console.log(`    orderId ${id}: UTC ${d.utcDay}, KST ${d.kstDay}, ${d.lineTotal.toLocaleString()}원`);
      }
    }
    if (kstNotAPI.length > 0) {
      console.log(`  → KST에만 (API 조회 누락): ${kstNotAPI.join(', ')}`);
      for (const id of kstNotAPI) {
        const d = items.find(i => i.orderId === id);
        if (d) console.log(`    orderId ${id}: UTC ${d.utcDay}, KST ${d.kstDay}, ${d.lineTotal.toLocaleString()}원`);
      }
    }

    results.push({ ym, api: apiItems.length, apiOrders: apiOrderIds.size, apiTotal, kst: byKST.length, kstOrders: kstOrderIds.size, kstTotal, utc: byUTC.length, utcOrders: utcOrderIds.size, utcTotal });
  }

  // ---- 최종 요약 ----
  console.log('\n' + '='.repeat(70));
  console.log('최종 요약');
  console.log('='.repeat(70));
  console.log('월     | API(paidDate) |    KST기준    |    UTC기준    | API금액        | KST금액');
  for (const r of results) {
    console.log(`${r.ym} | ${String(r.apiOrders).padStart(3)}주문 ${String(r.api).padStart(3)}건 | ${String(r.kstOrders).padStart(3)}주문 ${String(r.kst).padStart(3)}건 | ${String(r.utcOrders).padStart(3)}주문 ${String(r.utc).padStart(3)}건 | ${r.apiTotal.toLocaleString().padStart(13)}원 | ${r.kstTotal.toLocaleString().padStart(13)}원`);
  }

  // API paidDate 기준이 UTC인지 KST인지 판별
  console.log('\n=== paidDate 파라미터 기준 판별 ===');
  let matchUTC = 0, matchKST = 0;
  for (const r of results) {
    if (r.api === r.utc) matchUTC++;
    if (r.api === r.kst) matchKST++;
  }
  console.log(`UTC 일치: ${matchUTC}/5, KST 일치: ${matchKST}/5`);
  if (matchUTC > matchKST) {
    console.log('→ API paidDate 필터는 UTC 기준으로 추정');
    console.log('→ KST 기준으로 적재하려면 전월 마지막 날 ~ 익월 첫 날을 포함해서 조회 후 KST 날짜로 분류해야 함');
  } else if (matchKST > matchUTC) {
    console.log('→ API paidDate 필터는 KST 기준으로 추정');
  } else {
    console.log('→ 기준 불명확, 월별 상세 비교 필요');
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
