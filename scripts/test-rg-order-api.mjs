#!/usr/bin/env node
/**
 * Test Rocket Growth Order API
 * Path: /v2/providers/rg_open_api/apis/api/v1/vendors/{vendorId}/rg/orders
 * Params: paidDateFrom (YYYYMMDD), paidDateTo (YYYYMMDD)
 *
 * Also test RG Inventory API and product listing to confirm HEEDA = Rocket Growth
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

async function coupangRawRequest(method, apiPath, query = {}) {
  const qs = new URLSearchParams(query).toString();
  const url = `${BASE_URL}${apiPath}${qs ? '?' + qs : ''}`;
  const auth = authHeader(method, apiPath, qs);

  console.log(`\n>>> ${method} ${apiPath}`);
  console.log(`    Query: ${JSON.stringify(query)}`);

  const resp = await fetch(url, {
    method,
    headers: { 'Content-type': 'application/json;charset=UTF-8', Authorization: auth },
  });

  const bodyText = await resp.text();
  let bodyJson = null;
  try { bodyJson = JSON.parse(bodyText); } catch {}

  console.log(`    Status: ${resp.status} ${resp.statusText}`);
  return { status: resp.status, body: bodyJson || bodyText };
}

async function main() {
  // ================================================================
  // TEST 1: RG Order API — List Query
  // ================================================================
  console.log('='.repeat(70));
  console.log('TEST 1: RG Order API (List Query) — Aug 1-31');
  console.log('='.repeat(70));

  const rgOrderPath = `/v2/providers/rg_open_api/apis/api/v1/vendors/${VENDOR_ID}/rg/orders`;
  const result1 = await coupangRawRequest('GET', rgOrderPath, {
    paidDateFrom: '20260801',
    paidDateTo: '20260831',
  });

  console.log('RESPONSE BODY (full):');
  console.log(JSON.stringify(result1.body, null, 2).slice(0, 5000));

  if (result1.body?.data) {
    const orders = result1.body.data;
    console.log(`\nTotal orders: ${orders.length}`);
    let heedaCount = 0;
    let totalSales = 0;
    for (const order of orders) {
      const items = order.orderItems || order.items || [];
      for (const item of items) {
        const vid = String(item.vendorItemId);
        const isH = HEEDA_VIDS.has(vid);
        if (isH) heedaCount++;
        const unitPrice = Number(item.unitSalesPrice || item.salesPrice || 0);
        const qty = Number(item.salesQuantity || item.quantity || 1);
        totalSales += unitPrice * qty;
        console.log(`  ${isH ? 'HEEDA' : 'OTHER'} | VID: ${vid} | ${(item.productName || '').slice(0, 50)} | unitSalesPrice: ${item.unitSalesPrice} | qty: ${item.salesQuantity || item.quantity} | paidAt: ${order.paidAt}`);
      }
    }
    console.log(`\nSummary: ${orders.length} orders, HEEDA ${heedaCount}, total sales approx: ${totalSales}`);
  }

  await new Promise(r => setTimeout(r, 2000));

  // ================================================================
  // TEST 2: RG Order API — Single order query (if we have an orderId)
  // ================================================================
  if (result1.body?.data?.length > 0) {
    const sampleOrderId = result1.body.data[0].orderId;
    console.log('\n' + '='.repeat(70));
    console.log(`TEST 2: RG Order API (Single Query) — orderId: ${sampleOrderId}`);
    console.log('='.repeat(70));

    const rgSinglePath = `/v2/providers/rg_open_api/apis/api/v1/vendors/${VENDOR_ID}/rg/order/${sampleOrderId}`;
    const result2 = await coupangRawRequest('GET', rgSinglePath);
    console.log('RESPONSE BODY (full):');
    console.log(JSON.stringify(result2.body, null, 2).slice(0, 3000));
  }

  await new Promise(r => setTimeout(r, 2000));

  // ================================================================
  // TEST 3: RG Order API — shorter period (May)
  // ================================================================
  console.log('\n' + '='.repeat(70));
  console.log('TEST 3: RG Order API — May 2026');
  console.log('='.repeat(70));

  const result3 = await coupangRawRequest('GET', rgOrderPath, {
    paidDateFrom: '20260501',
    paidDateTo: '20260531',
  });

  if (result3.body?.data) {
    const orders = result3.body.data;
    console.log(`May: ${orders.length} orders`);
    let mayTotal = 0;
    for (const order of orders) {
      for (const item of (order.orderItems || order.items || [])) {
        const unitPrice = Number(item.unitSalesPrice || 0);
        const qty = Number(item.salesQuantity || 1);
        mayTotal += unitPrice * qty;
        console.log(`  VID: ${item.vendorItemId} | ${(item.productName || '').slice(0, 40)} | unit: ${item.unitSalesPrice} | qty: ${item.salesQuantity}`);
      }
    }
    console.log(`May total: ${mayTotal} (Wing ref: 958,550)`);
  } else {
    console.log('Response:', JSON.stringify(result3.body).slice(0, 1000));
  }

  await new Promise(r => setTimeout(r, 2000));

  // ================================================================
  // TEST 4: RG Order API — June 2026
  // ================================================================
  console.log('\n' + '='.repeat(70));
  console.log('TEST 4: RG Order API — June 2026');
  console.log('='.repeat(70));

  const result4 = await coupangRawRequest('GET', rgOrderPath, {
    paidDateFrom: '20260601',
    paidDateTo: '20260630',
  });

  if (result4.body?.data) {
    const orders = result4.body.data;
    console.log(`June: ${orders.length} orders`);
    let junTotal = 0;
    for (const order of orders) {
      for (const item of (order.orderItems || order.items || [])) {
        const unitPrice = Number(item.unitSalesPrice || 0);
        const qty = Number(item.salesQuantity || 1);
        junTotal += unitPrice * qty;
      }
    }
    console.log(`June total: ${junTotal} (Wing ref: 1,003,940)`);
  } else {
    console.log('Response:', JSON.stringify(result4.body).slice(0, 1000));
  }

  await new Promise(r => setTimeout(r, 2000));

  // ================================================================
  // TEST 5: RG Inventory API
  // ================================================================
  console.log('\n' + '='.repeat(70));
  console.log('TEST 5: RG Inventory API');
  console.log('='.repeat(70));

  const rgInventoryPath = `/v2/providers/rg_open_api/apis/api/v1/vendors/${VENDOR_ID}/rg/inventory/summaries`;
  const result5 = await coupangRawRequest('GET', rgInventoryPath);
  console.log('RESPONSE BODY:');
  console.log(JSON.stringify(result5.body, null, 2).slice(0, 3000));

  await new Promise(r => setTimeout(r, 2000));

  // ================================================================
  // TEST 6: Check product display to confirm HEEDA = Rocket Growth
  // ================================================================
  console.log('\n' + '='.repeat(70));
  console.log('TEST 6: Product list — confirm HEEDA products are RG');
  console.log('='.repeat(70));

  const productPath = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products`;
  const result6 = await coupangRawRequest('GET', productPath, {
    vendorId: VENDOR_ID,
    maxPerPage: '50',
    status: 'APPROVED',
  });

  if (result6.body?.data && Array.isArray(result6.body.data)) {
    for (const p of result6.body.data) {
      const name = p.sellerProductName || p.displayProductName || '';
      const isH = name.includes('희다') || name.includes('HEEDA');
      const isSL = name.includes('슈퍼랩스') || name.includes('SUPERLABS');
      // Print delivery/fulfillment related fields
      console.log(`  ${isH ? 'HEEDA' : isSL ? 'SUPERLABS' : 'OTHER'} | ${name.slice(0, 50)}`);
      console.log(`    sellerProductId: ${p.sellerProductId}`);
      console.log(`    ALL KEYS: ${Object.keys(p).join(', ')}`);
      // Print any field related to delivery/fulfillment
      for (const k of Object.keys(p)) {
        if (k.toLowerCase().includes('delivery') || k.toLowerCase().includes('fulfil') ||
            k.toLowerCase().includes('rocket') || k.toLowerCase().includes('growth') ||
            k.toLowerCase().includes('type') || k.toLowerCase().includes('ship') ||
            k.toLowerCase().includes('channel')) {
          console.log(`    ${k}: ${JSON.stringify(p[k])}`);
        }
      }
    }
  }

  // ================================================================
  // TEST 7: RG Order API — April 2026
  // ================================================================
  console.log('\n' + '='.repeat(70));
  console.log('TEST 7: RG Order API — April 2026');
  console.log('='.repeat(70));

  const result7 = await coupangRawRequest('GET', rgOrderPath, {
    paidDateFrom: '20260401',
    paidDateTo: '20260430',
  });

  if (result7.body?.data) {
    const orders = result7.body.data;
    console.log(`April: ${orders.length} orders`);
    let aprTotal = 0;
    for (const order of orders) {
      for (const item of (order.orderItems || order.items || [])) {
        const unitPrice = Number(item.unitSalesPrice || 0);
        const qty = Number(item.salesQuantity || 1);
        aprTotal += unitPrice * qty;
      }
    }
    console.log(`April total: ${aprTotal}`);
  } else {
    console.log('Response:', JSON.stringify(result7.body).slice(0, 1000));
  }

  await new Promise(r => setTimeout(r, 2000));

  // ================================================================
  // TEST 8: RG Order API — July 2026
  // ================================================================
  console.log('\n' + '='.repeat(70));
  console.log('TEST 8: RG Order API — July 2026');
  console.log('='.repeat(70));

  const result8 = await coupangRawRequest('GET', rgOrderPath, {
    paidDateFrom: '20260701',
    paidDateTo: '20260731',
  });

  if (result8.body?.data) {
    const orders = result8.body.data;
    console.log(`July: ${orders.length} orders`);
    let julTotal = 0;
    for (const order of orders) {
      for (const item of (order.orderItems || order.items || [])) {
        const unitPrice = Number(item.unitSalesPrice || 0);
        const qty = Number(item.salesQuantity || 1);
        julTotal += unitPrice * qty;
      }
    }
    console.log(`July total: ${julTotal}`);
  } else {
    console.log('Response:', JSON.stringify(result8.body).slice(0, 1000));
  }

  // ================================================================
  // FINAL: Compare RG Order API fields with existing DB unitSalesPrice format
  // ================================================================
  console.log('\n' + '='.repeat(70));
  console.log('COMPARISON: RG Order API response vs DB raw_payload format');
  console.log('='.repeat(70));
  console.log('DB unitSalesPrice format:');
  console.log('  {item: {unitSalesPrice: "12900.0", salesQuantity, currency, productName, vendorItemId}');
  console.log('   order: {paidAt: 1781863044000, paidDateKST: "2026-06-19"}}');
  console.log('\nIf RG Order API returns matching field names, this confirms the unknown loader used RG Order API.');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
