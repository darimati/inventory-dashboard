#!/usr/bin/env node
/**
 * 전체 월(4~8월) 재적재 — 분할 없이 페이지네이션만으로 조회
 * 이전 reload-rg-orders.mjs의 반월 분할이 경계 주문을 누락하는 버그 수정
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
  let page = 0;
  while (true) {
    page++;
    const query = { paidDateFrom: dateFrom, paidDateTo: dateTo };
    if (nextToken) query.nextToken = nextToken;
    const resp = await coupangGet(apiPath, query);
    const orders = resp.data || [];
    allOrders = allOrders.concat(orders);
    console.log(`    p${page}: ${orders.length}건${resp.nextToken ? ' →' : ''}`);
    if (!resp.nextToken || orders.length === 0) break;
    nextToken = resp.nextToken;
    await new Promise(r => setTimeout(r, 300));
  }
  return allOrders;
}

function orderToRows(order) {
  const rows = [];
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
        item: { vendorItemId: item.vendorItemId, productName: item.productName, unitSalesPrice: item.unitSalesPrice, salesQuantity: item.salesQuantity, currency: item.currency },
        order: { orderId: order.orderId, vendorId: order.vendorId, paidAt: order.paidAt, paidDateKST: saleDate },
      },
      updated_at: new Date().toISOString(),
    });
  }
  return rows;
}

async function main() {
  console.log('=== 전체 재적재 (분할 없이 페이지네이션만) ===\n');

  const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
  const summary = [];

  for (const ym of months) {
    const [year, month] = ym.split('-');
    const lastDay = new Date(Number(year), Number(month), 0).getDate();
    const dateFrom = `${year}${month}01`;
    const dateTo = `${year}${month}${String(lastDay).padStart(2, '0')}`;

    console.log(`--- ${ym} (${dateFrom}~${dateTo}) ---`);
    const orders = await fetchAllOrders(dateFrom, dateTo);

    const allRows = orders.flatMap(o => orderToRows(o));
    const heedaRows = allRows.filter(r => r.brand === 'HEEDA');
    const totalAmount = heedaRows.reduce((s, r) => s + r.sale_amount, 0);

    console.log(`  API: ${orders.length}건, HEEDA: ${heedaRows.length}건, ${totalAmount.toLocaleString()}원`);

    // Delete + upsert
    await supabase
      .from('sales_coupang')
      .delete()
      .eq('brand', 'HEEDA')
      .gte('sale_date', `${ym}-01`)
      .lte('sale_date', `${ym}-${String(lastDay).padStart(2, '0')}`);

    let inserted = 0;
    for (let i = 0; i < heedaRows.length; i += 100) {
      const batch = heedaRows.slice(i, i + 100);
      const { error } = await supabase
        .from('sales_coupang')
        .upsert(batch, { onConflict: 'order_id,vendor_item_id,sale_type', ignoreDuplicates: false });
      if (error) console.error(`  batch error: ${error.message}`);
      else inserted += batch.length;
    }
    console.log(`  DB 삽입: ${inserted}건`);

    summary.push({ ym, apiOrders: orders.length, heedaRows: heedaRows.length, totalAmount });
    await new Promise(r => setTimeout(r, 2000));
  }

  // DB 검증
  console.log('\n=== DB 검증 ===');
  for (const s of summary) {
    const [year, month] = s.ym.split('-');
    const lastDay = new Date(Number(year), Number(month), 0).getDate();
    const { data: dbRows } = await supabase
      .from('sales_coupang')
      .select('sale_amount')
      .eq('brand', 'HEEDA')
      .gte('sale_date', `${s.ym}-01`)
      .lte('sale_date', `${s.ym}-${String(lastDay).padStart(2, '0')}`);
    const dbCount = (dbRows || []).length;
    const dbTotal = (dbRows || []).reduce((sum, r) => sum + (Number(r.sale_amount) || 0), 0);
    console.log(`${s.ym}: API ${s.heedaRows}건/${s.totalAmount.toLocaleString()}원 → DB ${dbCount}건/${dbTotal.toLocaleString()}원`);
  }

  console.log('\n=== 요약 ===');
  console.log('월     | API주문 | HEEDA건 | 금액');
  for (const s of summary) {
    console.log(`${s.ym} | ${String(s.apiOrders).padStart(7)} | ${String(s.heedaRows).padStart(7)} | ${s.totalAmount.toLocaleString()}원`);
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
