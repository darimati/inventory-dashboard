#!/usr/bin/env node
/**
 * 8월 주문수 vs HEEDA건수 불일치 원인 조사
 * 주문수(고유 orderId) < HEEDA건수(line items) → 한 주문에 여러 아이템
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
  '91329549543', '94749674229', '92815810724', '94159094137',
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
  const resp = await fetch(url, { method: 'GET', headers: { 'Content-type': 'application/json;charset=UTF-8', Authorization: auth } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function fetchAllOrders(dateFrom, dateTo) {
  const apiPath = `/v2/providers/rg_open_api/apis/api/v1/vendors/${VENDOR_ID}/rg/orders`;
  let allOrders = [], nextToken = '';
  while (true) {
    const query = { paidDateFrom: dateFrom, paidDateTo: dateTo };
    if (nextToken) query.nextToken = nextToken;
    const resp = await coupangGet(apiPath, query);
    allOrders = allOrders.concat(resp.data || []);
    if (!resp.nextToken || (resp.data || []).length === 0) break;
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

async function main() {
  console.log('=== 8월 주문수 vs HEEDA건수 디버그 ===\n');

  const orders = await fetchAllOrders('20260801', '20260831');
  console.log(`API 반환 주문 수 (order objects): ${orders.length}`);

  // 고유 orderId
  const orderIds = new Set(orders.map(o => o.orderId));
  console.log(`고유 orderId 수: ${orderIds.size}`);

  // 전체 line items
  let totalItems = 0;
  let heedaItems = 0;
  let otherItems = 0;
  const multiItemOrders = [];

  for (const order of orders) {
    const items = order.orderItems || [];
    totalItems += items.length;

    const heedaInOrder = [];
    const otherInOrder = [];

    for (const item of items) {
      const brand = detectBrand(item.vendorItemId, item.productName);
      if (brand === 'HEEDA') {
        heedaItems++;
        heedaInOrder.push(item);
      } else {
        otherItems++;
        otherInOrder.push(item);
      }
    }

    if (items.length > 1) {
      multiItemOrders.push({
        orderId: order.orderId,
        itemCount: items.length,
        heedaCount: heedaInOrder.length,
        otherCount: otherInOrder.length,
        items: items.map(i => ({
          vid: i.vendorItemId,
          name: i.productName,
          price: i.unitSalesPrice,
          qty: i.salesQuantity,
          brand: detectBrand(i.vendorItemId, i.productName),
        })),
      });
    }
  }

  console.log(`\n전체 line items: ${totalItems}`);
  console.log(`  HEEDA items: ${heedaItems}`);
  console.log(`  OTHER items: ${otherItems}`);

  console.log(`\n--- 복수 아이템 주문 (${multiItemOrders.length}건) ---`);
  for (const mo of multiItemOrders) {
    console.log(`\n  orderId: ${mo.orderId} — ${mo.itemCount}개 아이템 (HEEDA: ${mo.heedaCount}, OTHER: ${mo.otherCount})`);
    for (const item of mo.items) {
      console.log(`    VID: ${item.vid}, "${item.name}", ${item.price}원 × ${item.qty}, brand: ${item.brand}`);
    }
  }

  // 전체 월도 같은 문제가 있는지 확인
  console.log('\n=== 전월 주문수 vs line items 비교 ===');
  const months = [
    { from: '20260401', to: '20260430', label: '4월' },
    { from: '20260501', to: '20260531', label: '5월' },
    { from: '20260601', to: '20260630', label: '6월' },
    { from: '20260701', to: '20260731', label: '7월' },
  ];

  for (const m of months) {
    await new Promise(r => setTimeout(r, 1500));
    const mOrders = await fetchAllOrders(m.from, m.to);
    const mOrderIds = new Set(mOrders.map(o => o.orderId));
    let mItems = 0;
    let mHeeda = 0;
    let mMulti = 0;
    for (const o of mOrders) {
      const items = o.orderItems || [];
      mItems += items.length;
      if (items.length > 1) mMulti++;
      for (const i of items) {
        if (detectBrand(i.vendorItemId, i.productName) === 'HEEDA') mHeeda++;
      }
    }
    console.log(`${m.label}: 주문 ${mOrderIds.size}개, line items ${mItems}개, HEEDA items ${mHeeda}개, 복수아이템주문 ${mMulti}개`);
  }

  console.log('\n=== 결론 ===');
  console.log(`"주문수" = API가 반환한 order 객체 수 (= 고유 orderId): ${orders.length} (8월)`);
  console.log(`"HEEDA건" = order 안의 HEEDA line items 수: ${heedaItems} (8월)`);
  console.log(`차이 원인: ${multiItemOrders.length}개 주문에 복수 HEEDA 아이템 포함`);
  console.log(`→ 두 숫자는 다른 지표. "주문수"와 "건수"를 통일해야 함.`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
