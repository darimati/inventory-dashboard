#!/usr/bin/env node
/**
 * Deep check of revenue-history API with careful pagination
 * to see if HEEDA items are hiding in later pages.
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
    return { error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
  }
  return resp.json();
}

function isHeeda(vendorItemId, productName) {
  if (HEEDA_VIDS.has(String(vendorItemId))) return true;
  const lower = (productName || '').toLowerCase();
  return lower.includes('희다') || lower.includes('heeda') ||
    lower.includes('클렌징밤') || lower.includes('클렌징 밤') ||
    lower.includes('클렌징폼') || lower.includes('클렌징 폼') ||
    lower.includes('폼클렌징') || lower.includes('세럼');
}

async function fetchAllPages(dateFrom, dateTo) {
  const apiPath = '/v2/providers/openapi/apis/api/v1/revenue-history';
  let token = '';
  let page = 0;
  let totalItems = 0;
  let heedaItems = [];
  let allVids = new Set();

  while (true) {
    page++;
    const resp = await coupangGet(apiPath, {
      vendorId: VENDOR_ID,
      recognitionDateFrom: dateFrom,
      recognitionDateTo: dateTo,
      token: token,
      maxPerPage: '100',
    });

    if (resp.error) {
      console.log(`  Page ${page}: ${resp.error}`);
      break;
    }

    const orders = resp.data || [];
    if (orders.length === 0) break;

    for (const order of orders) {
      for (const item of (order.items || [])) {
        totalItems++;
        allVids.add(String(item.vendorItemId));
        if (isHeeda(item.vendorItemId, item.productName)) {
          heedaItems.push({
            orderId: order.orderId,
            vid: item.vendorItemId,
            product: (item.productName || '').slice(0, 40),
            salePrice: item.salePrice,
            settlementAmount: item.settlementAmount,
            cpnDiscount: item.coupangDiscountCoupon,
            date: order.recognitionDate,
          });
        }
      }
    }

    const nextToken = resp.nextToken || '';
    console.log(`  Page ${page}: ${orders.length} orders, nextToken=${nextToken ? 'YES' : 'NO'}`);
    if (!nextToken) break;
    token = nextToken;
    await new Promise(r => setTimeout(r, 500));
  }

  return { totalItems, heedaItems, allVids };
}

async function main() {
  // Check May with full pagination and larger pages
  console.log('=== MAY 2026 (full pagination, maxPerPage=100) ===');
  const may = await fetchAllPages('2026-05-01', '2026-05-31');
  console.log(`Total items: ${may.totalItems}, HEEDA: ${may.heedaItems.length}`);
  console.log(`Unique VIDs: ${may.allVids.size}`);
  for (const h of may.heedaItems) {
    console.log(`  ${h.date} | ${h.orderId} | VID ${h.vid} | ${h.product} | sale: ${h.salePrice} | settle: ${h.settlementAmount}`);
  }

  await new Promise(r => setTimeout(r, 1500));

  // Check June
  console.log('\n=== JUNE 2026 ===');
  const jun = await fetchAllPages('2026-06-01', '2026-06-30');
  console.log(`Total items: ${jun.totalItems}, HEEDA: ${jun.heedaItems.length}`);
  for (const h of jun.heedaItems) {
    console.log(`  ${h.date} | ${h.orderId} | VID ${h.vid} | ${h.product} | sale: ${h.salePrice} | settle: ${h.settlementAmount}`);
  }

  await new Promise(r => setTimeout(r, 1500));

  // Check July
  console.log('\n=== JULY 2026 ===');
  const jul = await fetchAllPages('2026-07-01', '2026-07-31');
  console.log(`Total items: ${jul.totalItems}, HEEDA: ${jul.heedaItems.length}`);
  for (const h of jul.heedaItems) {
    console.log(`  ${h.date} | ${h.orderId} | VID ${h.vid} | ${h.product} | sale: ${h.salePrice} | settle: ${h.settlementAmount}`);
  }

  await new Promise(r => setTimeout(r, 1500));

  // Check August
  console.log('\n=== AUGUST 2026 ===');
  const aug = await fetchAllPages('2026-08-01', '2026-08-31');
  console.log(`Total items: ${aug.totalItems}, HEEDA: ${aug.heedaItems.length}`);
  for (const h of aug.heedaItems) {
    console.log(`  ${h.date} | ${h.orderId} | VID ${h.vid} | ${h.product} | sale: ${h.salePrice} | settle: ${h.settlementAmount}`);
  }

  // List all unique VIDs across all months to understand which products the API knows about
  const allMonthVids = new Set([...may.allVids, ...jun.allVids, ...jul.allVids, ...aug.allVids]);
  console.log('\n=== ALL UNIQUE VIDs FROM REVENUE-HISTORY ===');
  console.log(`Total unique VIDs: ${allMonthVids.size}`);
  for (const vid of [...allMonthVids].sort()) {
    const isH = HEEDA_VIDS.has(vid) ? ' ← HEEDA' : '';
    console.log(`  ${vid}${isH}`);
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
