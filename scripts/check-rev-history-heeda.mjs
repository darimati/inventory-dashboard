#!/usr/bin/env node
/**
 * Revenue-history API에서 HEEDA VID 주문을 월별로 확인
 * 일부 HEEDA 상품이 판매자배송으로도 등록되어 있을 수 있음
 * → RG Order API에는 없고 revenue-history에만 있는 HEEDA 주문 찾기
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

async function fetchRevenueHistory(dateFrom, dateTo) {
  const apiPath = '/v2/providers/openapi/apis/api/v1/revenue-history';
  let allItems = [];
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
    const resp = await coupangGet(apiPath, query);
    const data = resp.data || [];
    allItems = allItems.concat(data);
    console.log(`  p${page}: ${data.length}건`);
    if (data.length < 50 || !resp.nextToken) break;
    token = resp.nextToken || '';
    await new Promise(r => setTimeout(r, 300));
  }
  return allItems;
}

async function main() {
  console.log('=== Revenue-history HEEDA 주문 확인 ===\n');

  const months = [
    { from: '2026-04-01', to: '2026-04-30', label: '4월' },
    { from: '2026-05-01', to: '2026-05-31', label: '5월' },
    { from: '2026-06-01', to: '2026-06-30', label: '6월' },
    { from: '2026-07-01', to: '2026-07-31', label: '7월' },
    { from: '2026-08-01', to: '2026-08-31', label: '8월' },
  ];

  for (const m of months) {
    console.log(`\n--- ${m.label} (${m.from} ~ ${m.to}) ---`);
    const data = await fetchRevenueHistory(m.from, m.to);
    console.log(`  전체 revenue-history 건수: ${data.length}`);

    // 모든 item을 추출
    const allItems = [];
    for (const entry of data) {
      const orderId = entry.orderId || entry.orderNumber || '';
      const items = entry.items || entry.orderItems || [];
      if (items.length > 0) {
        for (const item of items) {
          allItems.push({
            orderId: String(orderId),
            vendorItemId: String(item.vendorItemId || ''),
            productName: item.productTitle || item.productName || '',
            salePrice: Number(item.salePrice) || 0,
            settlementAmount: Number(item.settlementAmount) || 0,
            coupangDiscount: Number(item.coupangDiscountCoupon) || 0,
            recognitionDate: item.recognitionDate || entry.recognitionDate || '',
          });
        }
      } else {
        // 항목이 없는 경우 entry 자체가 item
        allItems.push({
          orderId: String(orderId),
          vendorItemId: String(entry.vendorItemId || ''),
          productName: entry.productTitle || entry.productName || '',
          salePrice: Number(entry.salePrice) || 0,
          settlementAmount: Number(entry.settlementAmount) || 0,
          coupangDiscount: Number(entry.coupangDiscountCoupon) || 0,
          recognitionDate: entry.recognitionDate || '',
        });
      }
    }

    // HEEDA VID 포함 건
    const heedaItems = allItems.filter(i => HEEDA_VIDS.has(i.vendorItemId));
    // 이름 기반 HEEDA 탐지
    const heedaByName = allItems.filter(i => {
      if (HEEDA_VIDS.has(i.vendorItemId)) return false; // 이미 VID로 잡힌 것 제외
      const n = (i.productName || '').toLowerCase();
      return n.includes('희다') || n.includes('heeda') || n.includes('클렌징밤') || n.includes('세럼');
    });

    console.log(`  HEEDA (VID 매칭): ${heedaItems.length}건`);
    if (heedaItems.length > 0) {
      let totalSale = 0;
      for (const h of heedaItems) {
        console.log(`    orderId: ${h.orderId}, VID: ${h.vendorItemId}, ${h.productName}, sale: ${h.salePrice.toLocaleString()}원, settlement: ${h.settlementAmount.toLocaleString()}원, coupon: ${h.coupangDiscount.toLocaleString()}원, date: ${h.recognitionDate}`);
        totalSale += h.salePrice;
      }
      console.log(`    합계 salePrice: ${totalSale.toLocaleString()}원`);
    }
    if (heedaByName.length > 0) {
      console.log(`  HEEDA (이름 매칭): ${heedaByName.length}건`);
      for (const h of heedaByName) {
        console.log(`    orderId: ${h.orderId}, VID: ${h.vendorItemId}, ${h.productName}, sale: ${h.salePrice.toLocaleString()}원`);
      }
    }

    await new Promise(r => setTimeout(r, 2000));
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
