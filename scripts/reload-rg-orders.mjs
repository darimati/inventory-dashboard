#!/usr/bin/env node
/**
 * RG Order API 기반 HEEDA 주문 전체 재적재 스크립트
 *
 * 사용법:
 *   node scripts/reload-rg-orders.mjs                  # 4~8월 전체 재적재
 *   node scripts/reload-rg-orders.mjs --dry-run        # 실제 삽입 없이 조회만
 *   node scripts/reload-rg-orders.mjs --month 2026-07  # 특정 월만
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
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BASE_URL = 'https://api-gateway.coupang.com';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const HEEDA_VIDS = new Set([
  '90554556327', '90621781347', '94426583769',
  '93924698351', '93924698352', '91329716230',
  '91007861343', '92197095172', '91007763848',
  '93943745189', '91541164600', '93943745188', '91541180389',
  '93993063704',
  // RG Inventory 추가 확인분
  '91329549543', '94749674229', '92815810724', '94159094137',
]);

/* ------------------------------------------------------------------ */
/*  CLI args                                                            */
/* ------------------------------------------------------------------ */
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const monthIdx = args.indexOf('--month');
const SINGLE_MONTH = monthIdx >= 0 ? args[monthIdx + 1] : null;

/* ------------------------------------------------------------------ */
/*  HMAC auth                                                           */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/*  Brand detection                                                     */
/* ------------------------------------------------------------------ */
function detectBrand(vendorItemId, productName) {
  if (HEEDA_VIDS.has(String(vendorItemId))) return 'HEEDA';
  const lower = (productName || '').toLowerCase();
  if (lower.includes('희다') || lower.includes('heeda') ||
      lower.includes('클렌징밤') || lower.includes('클렌징 밤') ||
      lower.includes('클렌징폼') || lower.includes('클렌징 폼') ||
      lower.includes('폼클렌징') || lower.includes('세럼')) return 'HEEDA';
  return 'OTHER';
}

/* ------------------------------------------------------------------ */
/*  Fetch all RG orders for a date range (with pagination)              */
/* ------------------------------------------------------------------ */
async function fetchRGOrders(dateFrom, dateTo) {
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

    console.log(`    Page ${page}: ${orders.length} orders${resp.nextToken ? ' (more pages)' : ''}`);

    if (!resp.nextToken || orders.length === 0) break;
    nextToken = resp.nextToken;
    await new Promise(r => setTimeout(r, 500));
  }

  return allOrders;
}

/* ------------------------------------------------------------------ */
/*  Convert RG order to DB row                                          */
/* ------------------------------------------------------------------ */
function rgOrderToRows(order) {
  const rows = [];
  const paidAt = order.paidAt;
  const paidDate = new Date(paidAt);
  // Convert to KST
  const kstDate = new Date(paidAt + 9 * 3_600_000);
  const saleDate = kstDate.toISOString().slice(0, 10);

  for (const item of (order.orderItems || [])) {
    const unitPrice = parseFloat(item.unitSalesPrice) || 0;
    const qty = Number(item.salesQuantity) || 1;
    const saleAmount = unitPrice * qty;

    rows.push({
      order_id: String(order.orderId),
      vendor_item_id: String(item.vendorItemId),
      sale_type: 'SALE',
      sale_date: saleDate,
      brand: detectBrand(item.vendorItemId, item.productName),
      country: 'KR',
      sale_amount: saleAmount,
      quantity: qty,
      settlement_amount: 0, // RG Order API에 정산 정보 없음
      product_name: item.productName || '',
      raw_payload: {
        source: 'rg_order_api',
        item: {
          vendorItemId: item.vendorItemId,
          productName: item.productName,
          unitSalesPrice: item.unitSalesPrice,
          salesQuantity: item.salesQuantity,
          currency: item.currency,
        },
        order: {
          orderId: order.orderId,
          vendorId: order.vendorId,
          paidAt: order.paidAt,
          paidDateKST: saleDate,
        },
      },
      updated_at: new Date().toISOString(),
    });
  }

  return rows;
}

/* ------------------------------------------------------------------ */
/*  Main                                                                */
/* ------------------------------------------------------------------ */
async function main() {
  console.log('='.repeat(60));
  console.log('RG Order API → Supabase HEEDA 재적재');
  console.log(`Vendor: ${VENDOR_ID}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('='.repeat(60));

  // Define months to process
  const months = SINGLE_MONTH
    ? [SINGLE_MONTH]
    : ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];

  const results = {};

  for (const ym of months) {
    const [year, month] = ym.split('-');
    const lastDay = new Date(Number(year), Number(month), 0).getDate();
    const dateFrom = `${year}${month}01`;
    const dateTo = `${year}${month}${String(lastDay).padStart(2, '0')}`;

    console.log(`\n--- ${ym} (${dateFrom} ~ ${dateTo}) ---`);

    // Full month query with pagination (no split — split causes boundary order loss)
    const allOrders = await fetchRGOrders(dateFrom, dateTo);
    console.log(`  Total: ${allOrders.length} orders`);
    await new Promise(r => setTimeout(r, 1500));

    // Convert to DB rows
    const allRows = [];
    for (const order of allOrders) {
      allRows.push(...rgOrderToRows(order));
    }

    // Filter HEEDA only
    const heedaRows = allRows.filter(r => r.brand === 'HEEDA');
    const totalAmount = heedaRows.reduce((s, r) => s + r.sale_amount, 0);

    console.log(`  HEEDA rows: ${heedaRows.length}, total: ${totalAmount.toLocaleString()}원`);

    // Daily breakdown for verification
    const byDate = {};
    for (const r of heedaRows) {
      if (!byDate[r.sale_date]) byDate[r.sale_date] = { count: 0, amount: 0 };
      byDate[r.sale_date].count++;
      byDate[r.sale_date].amount += r.sale_amount;
    }
    const sortedDates = Object.keys(byDate).sort();
    console.log(`  Days with data: ${sortedDates.length}`);
    for (const d of sortedDates) {
      console.log(`    ${d}: ${byDate[d].count}건, ${byDate[d].amount.toLocaleString()}원`);
    }

    results[ym] = {
      orders: allOrders.length,
      heedaRows: heedaRows.length,
      totalAmount,
      days: sortedDates.length,
    };

    if (!DRY_RUN && heedaRows.length > 0) {
      // Step 1: Delete existing HEEDA data for this month
      console.log(`  Deleting existing HEEDA data for ${ym}...`);
      const { error: delError } = await supabase
        .from('sales_coupang')
        .delete()
        .eq('brand', 'HEEDA')
        .gte('sale_date', `${ym}-01`)
        .lte('sale_date', `${ym}-${String(lastDay).padStart(2, '0')}`);

      if (delError) {
        console.error(`  Delete error: ${delError.message}`);
        continue;
      }

      // Step 2: Insert new data in batches
      let inserted = 0;
      for (let i = 0; i < heedaRows.length; i += 100) {
        const batch = heedaRows.slice(i, i + 100);
        const { error } = await supabase
          .from('sales_coupang')
          .upsert(batch, {
            onConflict: 'order_id,vendor_item_id,sale_type',
            ignoreDuplicates: false,
          });

        if (error) {
          console.error(`  Upsert batch ${Math.floor(i / 100) + 1} error: ${error.message}`);
        } else {
          inserted += batch.length;
        }
      }
      console.log(`  Inserted: ${inserted}건`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('재적재 결과 요약');
  console.log('='.repeat(60));
  console.log('월    | 주문수 | HEEDA건수 | 합계금액');
  console.log('-'.repeat(50));
  for (const [ym, r] of Object.entries(results)) {
    console.log(`${ym} | ${String(r.orders).padStart(6)} | ${String(r.heedaRows).padStart(9)} | ${r.totalAmount.toLocaleString()}원`);
  }

  // Post-reload verification
  if (!DRY_RUN) {
    console.log('\n--- 재적재 후 DB 검증 ---');
    for (const ym of months) {
      const [year, month] = ym.split('-');
      const lastDay = new Date(Number(year), Number(month), 0).getDate();
      const { data: dbRows, error } = await supabase
        .from('sales_coupang')
        .select('order_id, sale_amount, sale_date, quantity')
        .eq('brand', 'HEEDA')
        .eq('sale_type', 'SALE')
        .gte('sale_date', `${ym}-01`)
        .lte('sale_date', `${ym}-${String(lastDay).padStart(2, '0')}`);

      if (error) {
        console.error(`  ${ym}: DB query error: ${error.message}`);
        continue;
      }

      const dbCount = (dbRows || []).length;
      const dbTotal = (dbRows || []).reduce((s, r) => s + (Number(r.sale_amount) || 0), 0);
      const dbDates = new Set((dbRows || []).map(r => r.sale_date));

      console.log(`${ym}: DB ${dbCount}건, ${dbTotal.toLocaleString()}원, ${dbDates.size}일`);
    }
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
