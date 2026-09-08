#!/usr/bin/env node
/**
 * 누락 주문 추적
 * 1. RG 반품/취소 주문 확인 (비즈니스 보고에는 있을 수 있음)
 * 2. HEEDA_VIDS에 없는 새 vendorItemId 탐색
 * 3. revenue-history에서 HEEDA 이름으로 추가 탐색 (VID 미등록)
 * 4. unitSalesPrice vs salePrice 비교 → 금액 차이 원인
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
    return { _error: true, status: resp.status, body: body.slice(0, 500) };
  }
  return resp.json();
}

async function main() {
  console.log('=== 누락 주문 추적 ===\n');

  // ---- 1. RG 반품 API 확인 ----
  console.log('--- 1. RG 반품/취소 주문 확인 ---');
  // RG returns endpoint (다양한 path 시도)
  const returnPaths = [
    `/v2/providers/rg_open_api/apis/api/v1/vendors/${VENDOR_ID}/rg/returns`,
    `/v2/providers/rg_open_api/apis/api/v1/vendors/${VENDOR_ID}/rg/cancellations`,
    `/v2/providers/rg_open_api/apis/api/v1/vendors/${VENDOR_ID}/rg/order-returns`,
  ];

  for (const rp of returnPaths) {
    const result = await coupangGet(rp, {
      paidDateFrom: '20260701',
      paidDateTo: '20260731',
    });
    if (result._error) {
      // 날짜 파라미터 다르게 시도
      const result2 = await coupangGet(rp, {
        startDate: '20260701',
        endDate: '20260731',
      });
      if (result2._error) {
        console.log(`  ${rp.split('/').pop()}: HTTP ${result._error ? result.status : result2.status} (endpoint 미존재)`);
      } else {
        console.log(`  ${rp.split('/').pop()}:`, JSON.stringify(result2).slice(0, 300));
      }
    } else {
      console.log(`  ${rp.split('/').pop()}:`, JSON.stringify(result).slice(0, 500));
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // ---- 2. 제품 목록에서 HEEDA_VIDS에 없는 HEEDA 상품 탐색 ----
  console.log('\n--- 2. 등록된 전체 상품 중 HEEDA_VIDS 미포함 HEEDA 상품 ---');
  const productPaths = [
    `/v2/providers/seller_api/apis/api/v1/vendors/${VENDOR_ID}/products`,
    `/v2/providers/openapi/apis/api/v1/vendors/${VENDOR_ID}/products`,
  ];

  const HEEDA_VIDS = new Set([
    '90554556327', '90621781347', '94426583769',
    '93924698351', '93924698352', '91329716230',
    '91007861343', '92197095172', '91007763848',
    '93943745189', '91541164600', '93943745188', '91541180389',
    '93993063704',
  ]);

  for (const pp of productPaths) {
    const result = await coupangGet(pp);
    if (result._error) {
      console.log(`  ${pp}: HTTP ${result.status}`);
    } else {
      const products = result.data || result.products || [];
      console.log(`  ${pp}: ${products.length}개 상품`);
      for (const p of products) {
        const vid = String(p.vendorItemId || p.sellerProductItemId || '');
        const name = p.productName || p.sellerProductName || p.title || '';
        const lower = name.toLowerCase();
        if ((lower.includes('희다') || lower.includes('heeda')) && !HEEDA_VIDS.has(vid)) {
          console.log(`    → 미등록 HEEDA! VID: ${vid}, "${name}"`);
        }
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // ---- 3. RG Inventory에서 vendorItemId 전수 확인 ----
  console.log('\n--- 3. RG Inventory 전체 vendorItemId 확인 ---');
  const invPath = `/v2/providers/rg_open_api/apis/api/v1/vendors/${VENDOR_ID}/rg/inventory/summaries`;
  const invResult = await coupangGet(invPath);
  if (invResult._error) {
    console.log(`  HTTP ${invResult.status}`);
  } else {
    const invItems = invResult.data || [];
    console.log(`  전체 RG 인벤토리: ${invItems.length}개`);
    for (const item of invItems) {
      const vid = String(item.vendorItemId || '');
      const name = item.productName || item.vendorItemName || '';
      const inSet = HEEDA_VIDS.has(vid);
      console.log(`  VID: ${vid}, HEEDA_VIDS: ${inSet ? 'Y' : '** N **'}, "${name}"`);
    }
  }

  // ---- 4. 7월 revenue-history 전문 (HEEDA가 아닌 것도 포함) ----
  console.log('\n--- 4. 7월 revenue-history 전문 (HEEDA 가능성 있는 건 탐색) ---');
  const revPath = '/v2/providers/openapi/apis/api/v1/revenue-history';
  let allRevItems = [];
  let token = '';
  while (true) {
    const resp = await coupangGet(revPath, {
      vendorId: VENDOR_ID,
      recognitionDateFrom: '2026-07-01',
      recognitionDateTo: '2026-07-31',
      token,
      maxPerPage: '50',
    });
    const data = resp.data || [];
    allRevItems = allRevItems.concat(data);
    if (data.length < 50) break;
    token = resp.nextToken || '';
    if (!token) break;
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`  전체 건수: ${allRevItems.length}`);
  let totalRevSale = 0;
  for (const entry of allRevItems) {
    const items = entry.items || [];
    if (items.length > 0) {
      for (const item of items) {
        const vid = String(item.vendorItemId || '');
        const name = item.productTitle || '';
        const sale = Number(item.salePrice) || 0;
        totalRevSale += sale;
        console.log(`  orderId: ${entry.orderId}, VID: ${vid}, "${name}", sale: ${sale.toLocaleString()}원, HEEDA_VID: ${HEEDA_VIDS.has(vid)}`);
      }
    } else {
      const vid = String(entry.vendorItemId || '');
      const name = entry.productTitle || '';
      const sale = Number(entry.salePrice) || 0;
      totalRevSale += sale;
      console.log(`  orderId: ${entry.orderId}, VID: ${vid}, "${name}", sale: ${sale.toLocaleString()}원, HEEDA_VID: ${HEEDA_VIDS.has(vid)}`);
    }
  }
  console.log(`  revenue-history 전체 salePrice 합계: ${totalRevSale.toLocaleString()}원`);

  // ---- 5. 금액 비교 분석 ----
  console.log('\n--- 5. 7월 금액 차이 분석 ---');
  console.log(`RG Order API unitSalesPrice 합계: 565,660원`);
  console.log(`Revenue-history HEEDA salePrice: 14,100원`);
  console.log(`합산: 579,760원`);
  console.log(`비즈니스 보고: 568,980원`);
  console.log(`차이: ${(579760 - 568980).toLocaleString()}원 (API가 더 많음)`);
  console.log(`→ unitSalesPrice(정가) > 실결제가 차이 추정: ${(565660 - (568980 - 14100)).toLocaleString()}원`);
  console.log(`→ RG 30건 기준 평균 할인: ${Math.round((565660 - (568980 - 14100)) / 30).toLocaleString()}원/건`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
