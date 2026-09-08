#!/usr/bin/env node
/**
 * 7월 데이터 수정 재적재 — 분할 없이 전체 기간 조회
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
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

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

function detectBrand(vendorItemId, productName) {
  if (HEEDA_VIDS.has(String(vendorItemId))) return 'HEEDA';
  const lower = (productName || '').toLowerCase();
  if (lower.includes('희다') || lower.includes('heeda') ||
      lower.includes('클렌징밤') || lower.includes('클렌징 밤') ||
      lower.includes('클렌징폼') || lower.includes('클렌징 폼') ||
      lower.includes('폼클렌징') || lower.includes('세럼')) return 'HEEDA';
  return 'OTHER';
}

async function fetchAllOrders(dateFrom, dateTo) {
  const apiPath = `/v2/providers/rg_open_api/apis/api/v1/vendors/${VENDOR_ID}/rg/orders`;
  let allOrders = [];
  let nextToken = '';
  while (true) {
    const query = { paidDateFrom: dateFrom, paidDateTo: dateTo };
    if (nextToken) query.nextToken = nextToken;
    const resp = await coupangGet(apiPath, query);
    const orders = resp.data || [];
    allOrders = allOrders.concat(orders);
    console.log(`  Page: ${orders.length} orders, nextToken: ${resp.nextToken ? 'YES' : 'NO'}`);
    if (!resp.nextToken || orders.length === 0) break;
    nextToken = resp.nextToken;
    await new Promise(r => setTimeout(r, 500));
  }
  return allOrders;
}

async function main() {
  console.log('=== 7월 수정 재적재 (분할 없음) ===\n');

  // 1. 전체 기간 조회
  const orders = await fetchAllOrders('20260701', '20260731');
  console.log(`API 조회: ${orders.length}건\n`);

  // 2. DB 행 변환
  const rows = [];
  for (const order of orders) {
    const kstDate = new Date(order.paidAt + 9 * 3_600_000);
    const saleDate = kstDate.toISOString().slice(0, 10);

    for (const item of (order.orderItems || [])) {
      const unitPrice = parseFloat(item.unitSalesPrice) || 0;
      const qty = Number(item.salesQuantity) || 1;
      rows.push({
        order_id: String(order.orderId),
        vendor_item_id: String(item.vendorItemId),
        sale_type: 'SALE',
        sale_date: saleDate,
        brand: detectBrand(item.vendorItemId, item.productName),
        country: 'KR',
        sale_amount: unitPrice * qty,
        quantity: qty,
        settlement_amount: 0,
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
  }

  const heedaRows = rows.filter(r => r.brand === 'HEEDA');
  const totalAmount = heedaRows.reduce((s, r) => s + r.sale_amount, 0);

  console.log(`HEEDA rows: ${heedaRows.length}건, ${totalAmount.toLocaleString()}원`);

  // 일별 상세
  const byDate = {};
  for (const r of heedaRows) {
    if (!byDate[r.sale_date]) byDate[r.sale_date] = { count: 0, amount: 0 };
    byDate[r.sale_date].count++;
    byDate[r.sale_date].amount += r.sale_amount;
  }
  for (const d of Object.keys(byDate).sort()) {
    console.log(`  ${d}: ${byDate[d].count}건, ${byDate[d].amount.toLocaleString()}원`);
  }

  // 3. 기존 삭제 + 재삽입
  console.log('\nDB 기존 7월 HEEDA 삭제...');
  const { error: delError } = await supabase
    .from('sales_coupang')
    .delete()
    .eq('brand', 'HEEDA')
    .gte('sale_date', '2026-07-01')
    .lte('sale_date', '2026-07-31');

  if (delError) {
    console.error('삭제 실패:', delError.message);
    process.exit(1);
  }

  console.log('새 데이터 삽입...');
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
      console.error(`배치 에러: ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }
  console.log(`삽입 완료: ${inserted}건`);

  // 4. 검증
  const { data: dbCheck } = await supabase
    .from('sales_coupang')
    .select('order_id, sale_amount')
    .eq('brand', 'HEEDA')
    .gte('sale_date', '2026-07-01')
    .lte('sale_date', '2026-07-31');

  const dbCount = (dbCheck || []).length;
  const dbTotal = (dbCheck || []).reduce((s, r) => s + (Number(r.sale_amount) || 0), 0);
  console.log(`\nDB 검증: ${dbCount}건, ${dbTotal.toLocaleString()}원`);
  console.log(`비즈니스 보고: 32건, 568,980원`);
  console.log(`차이: ${32 - dbCount}건, ${(568980 - dbTotal).toLocaleString()}원`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
