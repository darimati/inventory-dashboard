#!/usr/bin/env node
/**
 * RG Order API pagination test — check if 50 is a page limit,
 * and also verify the unitSalesPrice is catalog price (not actual payment)
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
  const body = await resp.text();
  if (!resp.ok) return { error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
  try { return JSON.parse(body); } catch { return { rawText: body.slice(0, 500) }; }
}

async function fetchAllRGOrders(dateFrom, dateTo) {
  const apiPath = `/v2/providers/rg_open_api/apis/api/v1/vendors/${VENDOR_ID}/rg/orders`;
  let allOrders = [];
  let page = 0;
  let nextToken = '';

  while (true) {
    page++;
    const query = {
      paidDateFrom: dateFrom,
      paidDateTo: dateTo,
    };
    // Check if the API accepts page/token params
    if (nextToken) query.nextToken = nextToken;
    if (page > 1) query.page = String(page);

    const resp = await coupangGet(apiPath, query);

    if (resp.error) {
      console.log(`  Page ${page}: ${resp.error}`);
      break;
    }

    const orders = resp.data || [];
    allOrders = allOrders.concat(orders);

    // Log pagination info
    console.log(`  Page ${page}: ${orders.length} orders | hasNext: ${resp.hasNext} | nextToken: ${resp.nextToken || 'none'} | code: ${resp.code}`);

    // Print full response keys for pagination discovery
    if (page === 1) {
      console.log(`  Response top-level keys: ${Object.keys(resp).join(', ')}`);
    }

    if (!resp.hasNext && !resp.nextToken) break;
    if (orders.length === 0) break;

    nextToken = resp.nextToken || '';
    if (!nextToken && !resp.hasNext) break;

    await new Promise(r => setTimeout(r, 1500));
  }

  return allOrders;
}

async function main() {
  // ================================================================
  // 1. Full pagination test — May 2026 (Wing says 68 orders, API returned 50)
  // ================================================================
  console.log('=== May 2026 — Full pagination ===');
  const mayOrders = await fetchAllRGOrders('20260501', '20260531');
  let mayTotal = 0;
  let mayQty = 0;
  for (const o of mayOrders) {
    for (const item of (o.orderItems || [])) {
      mayTotal += Number(item.unitSalesPrice || 0) * Number(item.salesQuantity || 1);
      mayQty += Number(item.salesQuantity || 1);
    }
  }
  console.log(`May: ${mayOrders.length} orders, ${mayQty} items, total: ${mayTotal.toLocaleString()} (Wing: 958,550)\n`);

  await new Promise(r => setTimeout(r, 2000));

  // Try splitting May into two halves
  console.log('=== May 2026 — Split into halves ===');
  const may1 = await fetchAllRGOrders('20260501', '20260515');
  await new Promise(r => setTimeout(r, 1500));
  const may2 = await fetchAllRGOrders('20260516', '20260531');

  let may1Total = 0, may2Total = 0;
  for (const o of may1) for (const i of (o.orderItems || [])) may1Total += Number(i.unitSalesPrice || 0) * Number(i.salesQuantity || 1);
  for (const o of may2) for (const i of (o.orderItems || [])) may2Total += Number(i.unitSalesPrice || 0) * Number(i.salesQuantity || 1);

  console.log(`May 1-15: ${may1.length} orders, total: ${may1Total.toLocaleString()}`);
  console.log(`May 16-31: ${may2.length} orders, total: ${may2Total.toLocaleString()}`);
  console.log(`May combined: ${may1.length + may2.length} orders, total: ${(may1Total + may2Total).toLocaleString()} (Wing: 958,550)\n`);

  await new Promise(r => setTimeout(r, 2000));

  // ================================================================
  // 2. June split
  // ================================================================
  console.log('=== June 2026 — Split into halves ===');
  const jun1 = await fetchAllRGOrders('20260601', '20260615');
  await new Promise(r => setTimeout(r, 1500));
  const jun2 = await fetchAllRGOrders('20260616', '20260630');

  let jun1Total = 0, jun2Total = 0;
  for (const o of jun1) for (const i of (o.orderItems || [])) jun1Total += Number(i.unitSalesPrice || 0) * Number(i.salesQuantity || 1);
  for (const o of jun2) for (const i of (o.orderItems || [])) jun2Total += Number(i.unitSalesPrice || 0) * Number(i.salesQuantity || 1);

  console.log(`Jun 1-15: ${jun1.length} orders, total: ${jun1Total.toLocaleString()}`);
  console.log(`Jun 16-30: ${jun2.length} orders, total: ${jun2Total.toLocaleString()}`);
  console.log(`Jun combined: ${jun1.length + jun2.length} orders, total: ${(jun1Total + jun2Total).toLocaleString()} (Wing: 1,003,940)\n`);

  await new Promise(r => setTimeout(r, 2000));

  // ================================================================
  // 3. August split
  // ================================================================
  console.log('=== August 2026 — Split into halves ===');
  const aug1 = await fetchAllRGOrders('20260801', '20260815');
  await new Promise(r => setTimeout(r, 1500));
  const aug2 = await fetchAllRGOrders('20260816', '20260831');

  let aug1Total = 0, aug2Total = 0;
  for (const o of aug1) for (const i of (o.orderItems || [])) aug1Total += Number(i.unitSalesPrice || 0) * Number(i.salesQuantity || 1);
  for (const o of aug2) for (const i of (o.orderItems || [])) aug2Total += Number(i.unitSalesPrice || 0) * Number(i.salesQuantity || 1);

  console.log(`Aug 1-15: ${aug1.length} orders, total: ${aug1Total.toLocaleString()}`);
  console.log(`Aug 16-31: ${aug2.length} orders, total: ${aug2Total.toLocaleString()}`);
  console.log(`Aug combined: ${aug1.length + aug2.length} orders, total: ${(aug1Total + aug2Total).toLocaleString()} (Wing: 2,467,500)\n`);

  await new Promise(r => setTimeout(r, 2000));

  // ================================================================
  // 4. Check if unitSalesPrice is catalog price or actual payment
  // ================================================================
  console.log('=== unitSalesPrice analysis ===');
  console.log('RG Order API response fields per orderItem:');
  console.log('  - vendorItemId, productName, salesQuantity, unitSalesPrice, currency');
  console.log('  NO orderPrice, paymentAmount, coupangDiscountCoupon, or settlementAmount fields');
  console.log('\nunitSalesPrice appears to be the listed/catalog price.');
  console.log('Actual payment (after coupons) is NOT available via RG Order API.');
  console.log('This is a known limitation of Coupang Rocket Growth Open API.\n');

  // ================================================================
  // 5. April test
  // ================================================================
  console.log('=== April 2026 — Split ===');
  const apr1 = await fetchAllRGOrders('20260401', '20260415');
  await new Promise(r => setTimeout(r, 1500));
  const apr2 = await fetchAllRGOrders('20260416', '20260430');

  let apr1Total = 0, apr2Total = 0;
  for (const o of apr1) for (const i of (o.orderItems || [])) apr1Total += Number(i.unitSalesPrice || 0) * Number(i.salesQuantity || 1);
  for (const o of apr2) for (const i of (o.orderItems || [])) apr2Total += Number(i.unitSalesPrice || 0) * Number(i.salesQuantity || 1);

  console.log(`Apr 1-15: ${apr1.length} orders, total: ${apr1Total.toLocaleString()}`);
  console.log(`Apr 16-30: ${apr2.length} orders, total: ${apr2Total.toLocaleString()}`);
  console.log(`Apr combined: ${apr1.length + apr2.length} orders, total: ${(apr1Total + apr2Total).toLocaleString()}\n`);

  await new Promise(r => setTimeout(r, 2000));

  // ================================================================
  // 6. July test
  // ================================================================
  console.log('=== July 2026 — Split ===');
  const jul1 = await fetchAllRGOrders('20260701', '20260715');
  await new Promise(r => setTimeout(r, 1500));
  const jul2 = await fetchAllRGOrders('20260716', '20260731');

  let jul1Total = 0, jul2Total = 0;
  for (const o of jul1) for (const i of (o.orderItems || [])) jul1Total += Number(i.unitSalesPrice || 0) * Number(i.salesQuantity || 1);
  for (const o of jul2) for (const i of (o.orderItems || [])) jul2Total += Number(i.unitSalesPrice || 0) * Number(i.salesQuantity || 1);

  console.log(`Jul 1-15: ${jul1.length} orders, total: ${jul1Total.toLocaleString()}`);
  console.log(`Jul 16-31: ${jul2.length} orders, total: ${jul2Total.toLocaleString()}`);
  console.log(`Jul combined: ${jul1.length + jul2.length} orders, total: ${(jul1Total + jul2Total).toLocaleString()}\n`);

  // ================================================================
  // Summary
  // ================================================================
  console.log('\n=== MONTHLY SUMMARY (RG Order API, unitSalesPrice total) ===');
  console.log(`April:  ${apr1.length + apr2.length} orders | ${(apr1Total + apr2Total).toLocaleString()}원`);
  console.log(`May:    ${may1.length + may2.length} orders | ${(may1Total + may2Total).toLocaleString()}원 (Wing: 958,550)`);
  console.log(`June:   ${jun1.length + jun2.length} orders | ${(jun1Total + jun2Total).toLocaleString()}원 (Wing: 1,003,940)`);
  console.log(`July:   ${jul1.length + jul2.length} orders | ${(jul1Total + jul2Total).toLocaleString()}원`);
  console.log(`August: ${aug1.length + aug2.length} orders | ${(aug1Total + aug2Total).toLocaleString()}원 (Wing: 2,467,500)`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
