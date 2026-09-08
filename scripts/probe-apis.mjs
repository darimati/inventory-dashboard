#!/usr/bin/env node
/**
 * Probe various Coupang APIs to find actual payment amounts for HEEDA items.
 */
import { createClient } from '@supabase/supabase-js';
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
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

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
  if (!resp.ok) {
    return { error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
  }
  try { return JSON.parse(body); } catch { return { rawText: body.slice(0, 500) }; }
}

async function main() {
  // Get a sample order_id from Aug that has unitSalesPrice format (no settlement)
  const { data: sampleRows } = await sb.from('sales_coupang')
    .select('order_id, vendor_item_id, sale_date, sale_amount, product_name')
    .eq('brand', 'HEEDA').eq('sale_type', 'SALE')
    .gte('sale_date', '2026-08-01').lte('sale_date', '2026-08-15')
    .limit(5);

  console.log('=== SAMPLE ORDER IDS FROM DB ===');
  for (const r of sampleRows || []) {
    console.log(`  ${r.order_id} | VID ${r.vendor_item_id} | ${r.sale_date} | ${r.sale_amount} | ${r.product_name}`);
  }

  const sampleOrderId = sampleRows?.[0]?.order_id;
  if (!sampleOrderId) { console.log('No sample data'); return; }

  // --- TEST 1: Single order query ---
  console.log('\n=== TEST 1: Single order query (orderId) ===');
  const orderPath = `/v2/providers/openapi/apis/api/v4/vendors/${VENDOR_ID}/ordersheets/${sampleOrderId}`;
  console.log(`  Path: ${orderPath}`);
  const orderResp = await coupangGet(orderPath);
  console.log('  Response:', JSON.stringify(orderResp).slice(0, 500));
  await new Promise(r => setTimeout(r, 1000));

  // --- TEST 2: Revenue-history with wider date range ---
  console.log('\n=== TEST 2: Revenue-history for Aug 1-15 ===');
  const revPath = `/v2/providers/openapi/apis/api/v1/revenue-history`;
  const revResp = await coupangGet(revPath, {
    vendorId: VENDOR_ID,
    recognitionDateFrom: '2026-08-01',
    recognitionDateTo: '2026-08-15',
    token: '',
    maxPerPage: '50',
  });
  const revOrders = revResp?.data || [];
  console.log(`  Total orders: ${revOrders.length}`);
  for (const order of revOrders) {
    const items = order.items || [];
    for (const item of items) {
      console.log(`  OrderId: ${order.orderId}, VID: ${item.vendorItemId}, Product: ${item.productName?.slice(0, 30)}, salePrice: ${item.salePrice}, settle: ${item.settlementAmount}`);
    }
  }
  await new Promise(r => setTimeout(r, 1000));

  // --- TEST 3: Settlement-histories for August ---
  console.log('\n=== TEST 3: Settlement-histories for 2026-08 ===');
  const settPath = `/v2/providers/marketplace_openapi/apis/api/v1/settlement-histories`;
  const settResp = await coupangGet(settPath, { revenueRecognitionYearMonth: '2026-08' });
  console.log('  Response:', JSON.stringify(settResp).slice(0, 800));
  await new Promise(r => setTimeout(r, 1000));

  // --- TEST 4: Try product sales stats / analytics ---
  console.log('\n=== TEST 4: Try various analytics endpoints ===');

  // 4a: sales count
  const salesCountPath = `/v2/providers/openapi/apis/api/v4/vendors/${VENDOR_ID}/salesCounts`;
  console.log(`  4a: ${salesCountPath}`);
  const scResp = await coupangGet(salesCountPath, {
    fromDate: '2026-08-01',
    toDate: '2026-08-15',
  });
  console.log('  Response:', JSON.stringify(scResp).slice(0, 500));
  await new Promise(r => setTimeout(r, 1000));

  // 4b: order list (different from ordersheets)
  const orderListPath = `/v2/providers/openapi/apis/api/v4/vendors/${VENDOR_ID}/orders`;
  console.log(`  4b: ${orderListPath}`);
  const olResp = await coupangGet(orderListPath, {
    createdAtFrom: '2026-08-01+09:00',
    createdAtTo: '2026-08-15+09:00',
    status: 'FINAL_DELIVERY',
    maxPerPage: '5',
  });
  console.log('  Response:', JSON.stringify(olResp).slice(0, 500));
  await new Promise(r => setTimeout(r, 1000));

  // --- TEST 5: Revenue-history with different date interpretation ---
  // Try "settlementDate" based approach
  console.log('\n=== TEST 5: Revenue-history for Jun 1-30 (where DB has many HEEDA items) ===');
  const revJun = await coupangGet(revPath, {
    vendorId: VENDOR_ID,
    recognitionDateFrom: '2026-06-01',
    recognitionDateTo: '2026-06-30',
    token: '',
    maxPerPage: '50',
  });
  const junOrders = revJun?.data || [];
  console.log(`  Total orders: ${junOrders.length}`);
  // Filter HEEDA
  let heedaJun = 0;
  for (const order of junOrders) {
    for (const item of (order.items || [])) {
      const pn = (item.productName || '').toLowerCase();
      const vid = String(item.vendorItemId);
      if (pn.includes('희다') || pn.includes('heeda') || pn.includes('클렌징') || pn.includes('세럼')) {
        heedaJun++;
        console.log(`  HEEDA: ${order.orderId}, VID: ${vid}, ${item.productName?.slice(0, 40)}, salePrice: ${item.salePrice}, settle: ${item.settlementAmount}`);
      }
    }
  }
  console.log(`  HEEDA items in Jun: ${heedaJun}`);

  // Count how many HEEDA items in DB for June
  const { count: junDbCount } = await sb.from('sales_coupang')
    .select('*', { count: 'exact', head: true })
    .eq('brand', 'HEEDA').eq('sale_type', 'SALE')
    .gte('sale_date', '2026-06-01').lte('sale_date', '2026-06-30');
  console.log(`  HEEDA items in DB for Jun: ${junDbCount}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
