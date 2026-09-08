#!/usr/bin/env node
/**
 * 통합 재적재 — RG Order API + Revenue-history API
 * 두 소스를 합산하여 HEEDA 전체 주문을 적재
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
  '91329549543', '94749674229', '92815810724', '94159094137',
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
  const resp = await fetch(url, { method: 'GET', headers: { 'Content-type': 'application/json;charset=UTF-8', Authorization: auth } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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

/* ---- RG Order API ---- */
async function fetchRGOrders(dateFrom, dateTo) {
  const apiPath = `/v2/providers/rg_open_api/apis/api/v1/vendors/${VENDOR_ID}/rg/orders`;
  let allOrders = [], nextToken = '';
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

/* ---- Revenue-history API ---- */
async function fetchRevenueHistory(dateFrom, dateTo) {
  const apiPath = '/v2/providers/openapi/apis/api/v1/revenue-history';
  let allData = [], token = '';
  while (true) {
    const resp = await coupangGet(apiPath, { vendorId: VENDOR_ID, recognitionDateFrom: dateFrom, recognitionDateTo: dateTo, token, maxPerPage: '50' });
    allData = allData.concat(resp.data || []);
    if ((resp.data || []).length < 50) break;
    token = resp.nextToken || '';
    if (!token) break;
    await new Promise(r => setTimeout(r, 300));
  }
  return allData;
}

async function main() {
  console.log('=== 통합 재적재 (RG Order + Revenue-history) ===\n');

  const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
  const summary = [];

  for (const ym of months) {
    const [year, month] = ym.split('-');
    const lastDay = new Date(Number(year), Number(month), 0).getDate();
    const rgFrom = `${year}${month}01`;
    const rgTo = `${year}${month}${String(lastDay).padStart(2, '0')}`;
    const revFrom = `${ym}-01`;
    const revTo = `${ym}-${String(lastDay).padStart(2, '0')}`;

    console.log(`--- ${ym} ---`);

    // 1. RG Order API
    const rgOrders = await fetchRGOrders(rgFrom, rgTo);
    const rgRows = [];
    for (const order of rgOrders) {
      const kstDate = new Date(order.paidAt + 9 * 3_600_000);
      const saleDate = kstDate.toISOString().slice(0, 10);
      for (const item of (order.orderItems || [])) {
        const brand = detectBrand(item.vendorItemId, item.productName);
        if (brand !== 'HEEDA') continue;
        const unitPrice = parseFloat(item.unitSalesPrice) || 0;
        const qty = Number(item.salesQuantity) || 1;
        rgRows.push({
          order_id: String(order.orderId),
          vendor_item_id: String(item.vendorItemId),
          sale_type: 'SALE',
          sale_date: saleDate,
          brand: 'HEEDA',
          country: 'KR',
          sale_amount: unitPrice * qty,
          quantity: qty,
          settlement_amount: 0,
          product_name: item.productName || '',
          raw_payload: { source: 'rg_order_api', item: { vendorItemId: item.vendorItemId, unitSalesPrice: item.unitSalesPrice, salesQuantity: item.salesQuantity }, order: { orderId: order.orderId, paidAt: order.paidAt } },
          updated_at: new Date().toISOString(),
        });
      }
    }

    // 2. Revenue-history API → HEEDA만
    await new Promise(r => setTimeout(r, 1500));
    const revData = await fetchRevenueHistory(revFrom, revTo);
    const revRows = [];
    const rgOrderIds = new Set(rgRows.map(r => r.order_id));

    for (const entry of revData) {
      const items = entry.items || [];
      const entryList = items.length > 0 ? items : [entry];
      for (const item of entryList) {
        const vid = String(item.vendorItemId || '');
        const name = item.productTitle || item.productName || '';
        const brand = detectBrand(vid, name);
        if (brand !== 'HEEDA') continue;

        const orderId = String(entry.orderId || '');
        // 중복 체크: RG API에 이미 있는 주문은 제외
        if (rgOrderIds.has(orderId)) continue;

        const salePrice = Number(item.salePrice) || 0;
        const qty = Number(item.quantity) || 1;
        const settlementAmt = Number(item.settlementAmount) || 0;

        revRows.push({
          order_id: orderId,
          vendor_item_id: vid,
          sale_type: 'SALE',
          sale_date: item.recognitionDate || entry.recognitionDate || '',
          brand: 'HEEDA',
          country: 'KR',
          sale_amount: salePrice,
          quantity: qty,
          settlement_amount: settlementAmt,
          product_name: name,
          raw_payload: { source: 'revenue_history', salePrice, settlementAmount: settlementAmt, coupangDiscountCoupon: Number(item.coupangDiscountCoupon) || 0 },
          updated_at: new Date().toISOString(),
        });
      }
    }

    const allRows = [...rgRows, ...revRows];
    const rgTotal = rgRows.reduce((s, r) => s + r.sale_amount, 0);
    const revTotal = revRows.reduce((s, r) => s + r.sale_amount, 0);

    console.log(`  RG: ${rgRows.length}건 / ${rgTotal.toLocaleString()}원`);
    console.log(`  RevHistory: ${revRows.length}건 / ${revTotal.toLocaleString()}원`);
    console.log(`  합계: ${allRows.length}건 / ${(rgTotal + revTotal).toLocaleString()}원`);

    // 3. DB 삭제 + 삽입
    await supabase.from('sales_coupang').delete()
      .eq('brand', 'HEEDA')
      .gte('sale_date', `${ym}-01`)
      .lte('sale_date', `${ym}-${String(lastDay).padStart(2, '0')}`);

    let inserted = 0;
    for (let i = 0; i < allRows.length; i += 100) {
      const batch = allRows.slice(i, i + 100);
      const { error } = await supabase.from('sales_coupang')
        .upsert(batch, { onConflict: 'order_id,vendor_item_id,sale_type', ignoreDuplicates: false });
      if (error) console.error(`  batch error: ${error.message}`);
      else inserted += batch.length;
    }
    console.log(`  DB: ${inserted}건 삽입`);

    summary.push({ ym, rg: rgRows.length, rev: revRows.length, total: allRows.length, rgTotal, revTotal });
    await new Promise(r => setTimeout(r, 2000));
  }

  // DB 검증
  console.log('\n=== DB 검증 ===');
  for (const s of summary) {
    const [y, m] = s.ym.split('-');
    const lastDay = new Date(Number(y), Number(m), 0).getDate();
    const { data: dbRows } = await supabase.from('sales_coupang').select('sale_amount')
      .eq('brand', 'HEEDA')
      .gte('sale_date', `${s.ym}-01`)
      .lte('sale_date', `${s.ym}-${String(lastDay).padStart(2, '0')}`);
    const dbCount = (dbRows || []).length;
    const dbTotal = (dbRows || []).reduce((sum, r) => sum + (Number(r.sale_amount) || 0), 0);
    console.log(`${s.ym}: ${dbCount}건 / ${dbTotal.toLocaleString()}원 (RG ${s.rg} + RevH ${s.rev})`);
  }

  console.log('\n=== 최종 요약 ===');
  console.log('월     | RG건 | RevH건 | 합계건 | RG금액(정가)   | RevH금액(실가) | 합계');
  for (const s of summary) {
    console.log(`${s.ym} | ${String(s.rg).padStart(4)} | ${String(s.rev).padStart(6)} | ${String(s.total).padStart(6)} | ${s.rgTotal.toLocaleString().padStart(14)}원 | ${s.revTotal.toLocaleString().padStart(14)}원 | ${(s.rgTotal + s.revTotal).toLocaleString().padStart(12)}원`);
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
