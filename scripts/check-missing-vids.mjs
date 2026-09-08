#!/usr/bin/env node
/**
 * RG Inventory에 있지만 HEEDA_VIDS에 없는 10개 VID의 주문 확인
 * + 상품명 확인을 위해 RG Order API에서 해당 VID 주문 찾기
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

const CURRENT_HEEDA_VIDS = new Set([
  '90554556327', '90621781347', '94426583769',
  '93924698351', '93924698352', '91329716230',
  '91007861343', '92197095172', '91007763848',
  '93943745189', '91541164600', '93943745188', '91541180389',
  '93993063704',
]);

// RG Inventory에는 있지만 HEEDA_VIDS에 없는 VID
const MISSING_VIDS = [
  '91666151242', '91578454326', '90919842910',
  '92822999648', '91329549543', '91484240979',
  '91648881277', '94749674229', '92815810724',
  '90862383222',
];

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
  if (!resp.ok) return { _error: true, status: resp.status };
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
    allOrders = allOrders.concat(resp.data || []);
    if (!resp.nextToken || (resp.data || []).length === 0) break;
    nextToken = resp.nextToken;
    await new Promise(r => setTimeout(r, 300));
  }
  return allOrders;
}

async function main() {
  console.log('=== 미등록 VID 주문 확인 ===\n');
  console.log(`현재 HEEDA_VIDS: ${CURRENT_HEEDA_VIDS.size}개`);
  console.log(`RG Inventory 미등록: ${MISSING_VIDS.length}개`);
  console.log(`미등록 VID: ${MISSING_VIDS.join(', ')}\n`);

  const months = [
    { from: '20260401', to: '20260430', label: '4월' },
    { from: '20260501', to: '20260531', label: '5월' },
    { from: '20260601', to: '20260630', label: '6월' },
    { from: '20260701', to: '20260731', label: '7월' },
    { from: '20260801', to: '20260831', label: '8월' },
  ];

  const missingVidSet = new Set(MISSING_VIDS);
  const missingVidOrders = {}; // vid → [{ month, orderId, productName, price, qty }]
  const monthStats = {};

  for (const m of months) {
    console.log(`--- ${m.label} ---`);
    const orders = await fetchAllOrders(m.from, m.to);

    let currentVidCount = 0;
    let missingVidCount = 0;
    let unknownVidCount = 0;

    for (const order of orders) {
      for (const item of (order.orderItems || [])) {
        const vid = String(item.vendorItemId);

        if (CURRENT_HEEDA_VIDS.has(vid)) {
          currentVidCount++;
        } else if (missingVidSet.has(vid)) {
          missingVidCount++;
          if (!missingVidOrders[vid]) missingVidOrders[vid] = [];
          missingVidOrders[vid].push({
            month: m.label,
            orderId: order.orderId,
            productName: item.productName,
            price: parseFloat(item.unitSalesPrice) || 0,
            qty: Number(item.salesQuantity) || 1,
          });
        } else {
          unknownVidCount++;
          console.log(`  ⚠ 완전 미등록 VID: ${vid}, "${item.productName}", ${item.unitSalesPrice}원`);
        }
      }
    }

    console.log(`  전체: ${orders.length}건, 기존HEEDA: ${currentVidCount}, 미등록VID: ${missingVidCount}, 기타: ${unknownVidCount}`);
    monthStats[m.label] = { total: orders.length, current: currentVidCount, missing: missingVidCount, unknown: unknownVidCount };
    await new Promise(r => setTimeout(r, 2000));
  }

  // ---- 미등록 VID 상세 ----
  console.log('\n=== 미등록 VID 주문 상세 ===');
  for (const [vid, orders] of Object.entries(missingVidOrders)) {
    console.log(`\nVID ${vid}: ${orders.length}건`);
    for (const o of orders) {
      console.log(`  ${o.month}: orderId ${o.orderId}, "${o.productName}", ${o.price.toLocaleString()}원 × ${o.qty}`);
    }
  }

  // ---- 요약 ----
  console.log('\n=== 요약 ===');
  console.log('월   | 전체 | 기존HEEDA | 미등록VID | 기타');
  for (const [label, s] of Object.entries(monthStats)) {
    console.log(`${label} | ${String(s.total).padStart(4)} | ${String(s.current).padStart(9)} | ${String(s.missing).padStart(9)} | ${String(s.unknown).padStart(4)}`);
  }

  if (Object.keys(missingVidOrders).length > 0) {
    console.log('\n⚠ HEEDA_VIDS에 추가해야 할 VID 목록:');
    for (const vid of Object.keys(missingVidOrders)) {
      const sample = missingVidOrders[vid][0];
      console.log(`  '${vid}',  // "${sample.productName}" (${missingVidOrders[vid].length}건)`);
    }
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
