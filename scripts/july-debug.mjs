#!/usr/bin/env node
/**
 * 7월 데이터 불일치 진단
 * 비즈니스 보고: 32건 / 568,980원
 * API 적재: 27건 / 517,360원
 * 차이: 5건 / 51,620원
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

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
  let page = 0;
  while (true) {
    page++;
    const query = { paidDateFrom: dateFrom, paidDateTo: dateTo };
    if (nextToken) query.nextToken = nextToken;
    const resp = await coupangGet(apiPath, query);
    const orders = resp.data || [];
    allOrders = allOrders.concat(orders);
    console.log(`  Page ${page}: ${orders.length} orders, nextToken: ${resp.nextToken ? 'YES' : 'NO'}`);
    if (!resp.nextToken || orders.length === 0) break;
    nextToken = resp.nextToken;
    await new Promise(r => setTimeout(r, 500));
  }
  return allOrders;
}

async function main() {
  console.log('=== 7월 데이터 불일치 진단 ===\n');

  // ---- TEST 1: 7월 전체를 한 번에 조회 (분할 안 함) ----
  console.log('--- TEST 1: 전체 기간 한 번에 조회 (분할 없음) ---');
  const ordersWhole = await fetchAllOrders('20260701', '20260731');
  console.log(`전체 주문수: ${ordersWhole.length}`);

  // 전체 order items 추출
  let allItems = [];
  const orderMap = new Map();
  for (const order of ordersWhole) {
    const paidAt = order.paidAt;
    const kstDate = new Date(paidAt + 9 * 3_600_000);
    const saleDate = kstDate.toISOString().slice(0, 10);

    for (const item of (order.orderItems || [])) {
      const vid = String(item.vendorItemId);
      const isHeeda = HEEDA_VIDS.has(vid);
      const unitPrice = parseFloat(item.unitSalesPrice) || 0;
      const qty = Number(item.salesQuantity) || 1;
      allItems.push({
        orderId: order.orderId,
        vendorItemId: vid,
        productName: item.productName,
        unitSalesPrice: unitPrice,
        salesQuantity: qty,
        lineTotal: unitPrice * qty,
        isHeeda,
        saleDate,
        paidAtRaw: paidAt,
      });
    }

    if (!orderMap.has(order.orderId)) {
      orderMap.set(order.orderId, { saleDate, items: [] });
    }
    orderMap.get(order.orderId).items.push(...(order.orderItems || []));
  }

  console.log(`\n전체 line items: ${allItems.length}`);
  console.log(`고유 주문 ID: ${orderMap.size}`);

  const heedaItems = allItems.filter(i => i.isHeeda);
  const otherItems = allItems.filter(i => !i.isHeeda);

  console.log(`\nHEEDA items: ${heedaItems.length}, 금액: ${heedaItems.reduce((s, i) => s + i.lineTotal, 0).toLocaleString()}원`);
  console.log(`OTHER items: ${otherItems.length}, 금액: ${otherItems.reduce((s, i) => s + i.lineTotal, 0).toLocaleString()}원`);
  console.log(`전체 합계: ${allItems.reduce((s, i) => s + i.lineTotal, 0).toLocaleString()}원`);

  // 고유 주문 단위 카운트
  const heedaOrderIds = new Set(heedaItems.map(i => i.orderId));
  const otherOrderIds = new Set(otherItems.map(i => i.orderId));
  console.log(`\nHEEDA 주문 ID 수: ${heedaOrderIds.size}`);
  console.log(`OTHER 주문 ID 수: ${otherOrderIds.size}`);

  // OTHER items 상세
  if (otherItems.length > 0) {
    console.log(`\n--- OTHER (비-HEEDA) 주문 상세 ---`);
    for (const item of otherItems) {
      console.log(`  orderId: ${item.orderId}, VID: ${item.vendorItemId}, "${item.productName}", ${item.unitSalesPrice}원 × ${item.salesQuantity}, date: ${item.saleDate}`);
    }
  }

  // ---- TEST 2: 1~15일, 16~31일 분할 조회 ----
  console.log('\n--- TEST 2: 반월 분할 조회 ---');
  await new Promise(r => setTimeout(r, 2000));
  const orders1h = await fetchAllOrders('20260701', '20260715');
  await new Promise(r => setTimeout(r, 1500));
  const orders2h = await fetchAllOrders('20260716', '20260731');

  const combined = [...orders1h, ...orders2h];
  const combinedIds = new Set(combined.map(o => o.orderId));
  const wholeIds = new Set(ordersWhole.map(o => o.orderId));

  console.log(`1~15일: ${orders1h.length}건, 16~31일: ${orders2h.length}건, 합계: ${combined.length}건`);
  console.log(`분할 고유 ID: ${combinedIds.size}, 전체 고유 ID: ${wholeIds.size}`);

  // 분할에서만 있는 ID
  const onlyInSplit = [...combinedIds].filter(id => !wholeIds.has(id));
  const onlyInWhole = [...wholeIds].filter(id => !combinedIds.has(id));
  if (onlyInSplit.length > 0) console.log(`분할에만 있는 ID: ${onlyInSplit}`);
  if (onlyInWhole.length > 0) console.log(`전체에만 있는 ID: ${onlyInWhole}`);

  // ---- TEST 3: DB 현재 상태 ----
  console.log('\n--- TEST 3: DB 현재 HEEDA 7월 데이터 ---');
  const { data: dbRows, error } = await supabase
    .from('sales_coupang')
    .select('order_id, vendor_item_id, sale_date, sale_amount, quantity, product_name, brand, raw_payload')
    .eq('brand', 'HEEDA')
    .gte('sale_date', '2026-07-01')
    .lte('sale_date', '2026-07-31')
    .order('sale_date', { ascending: true });

  if (error) {
    console.error('DB error:', error.message);
  } else {
    console.log(`DB HEEDA 7월: ${dbRows.length}건`);
    const dbTotal = dbRows.reduce((s, r) => s + (Number(r.sale_amount) || 0), 0);
    console.log(`DB 합계: ${dbTotal.toLocaleString()}원`);
    const dbOrderIds = new Set(dbRows.map(r => r.order_id));
    console.log(`DB 고유 주문 ID: ${dbOrderIds.size}`);
  }

  // ---- TEST 4: 한 주문에 복수 아이템이 있는 경우 ----
  console.log('\n--- TEST 4: 복수 아이템 주문 (line items > 1) ---');
  for (const [orderId, info] of orderMap) {
    if (info.items.length > 1) {
      console.log(`  Order ${orderId} (${info.saleDate}): ${info.items.length} items`);
      for (const item of info.items) {
        console.log(`    VID: ${item.vendorItemId}, "${item.productName}", ${item.unitSalesPrice}원 × ${item.salesQuantity}`);
      }
    }
  }

  // ---- TEST 5: 날짜 경계 확인 (6/30 UTC가 7/1 KST인 경우) ----
  console.log('\n--- TEST 5: 6/30 및 8/1 경계 확인 ---');
  await new Promise(r => setTimeout(r, 2000));
  const ordersBoundaryJun = await fetchAllOrders('20260629', '20260701');
  console.log(`6/29~7/1: ${ordersBoundaryJun.length}건`);
  for (const o of ordersBoundaryJun) {
    const kst = new Date(o.paidAt + 9 * 3_600_000).toISOString();
    console.log(`  orderId: ${o.orderId}, paidAt: ${o.paidAt}, KST: ${kst}`);
  }

  await new Promise(r => setTimeout(r, 1500));
  const ordersBoundaryAug = await fetchAllOrders('20260730', '20260801');
  console.log(`7/30~8/1: ${ordersBoundaryAug.length}건`);
  for (const o of ordersBoundaryAug) {
    const kst = new Date(o.paidAt + 9 * 3_600_000).toISOString();
    console.log(`  orderId: ${o.orderId}, paidAt: ${o.paidAt}, KST: ${kst}`);
  }

  // ---- 요약 ----
  console.log('\n' + '='.repeat(60));
  console.log('진단 요약');
  console.log('='.repeat(60));
  console.log(`비즈니스 보고: 32건, 568,980원`);
  console.log(`API 전체 조회 (필터 없음): ${ordersWhole.length}건 (${orderMap.size} 고유 주문)`);
  console.log(`  → HEEDA: ${heedaItems.length}건, ${heedaItems.reduce((s, i) => s + i.lineTotal, 0).toLocaleString()}원`);
  console.log(`  → OTHER: ${otherItems.length}건, ${otherItems.reduce((s, i) => s + i.lineTotal, 0).toLocaleString()}원`);
  console.log(`  → 전체: ${allItems.length}건, ${allItems.reduce((s, i) => s + i.lineTotal, 0).toLocaleString()}원`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
