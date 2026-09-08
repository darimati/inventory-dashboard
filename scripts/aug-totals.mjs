#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(import.meta.dirname, '..', '.env.local');
const envText = fs.readFileSync(envPath, 'utf-8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Get full August data
const { data: augRows } = await sb.from('sales_coupang')
  .select('order_id, vendor_item_id, sale_date, sale_amount, settlement_amount, sale_type, raw_payload')
  .eq('brand', 'HEEDA').eq('country', 'KR')
  .gte('sale_date', '2026-08-01').lte('sale_date', '2026-08-31');

const sales = (augRows || []).filter(r => r.sale_type === 'SALE');

let totalSaleAmount = 0;
let totalSettlement = 0;
let withSettlement = 0;
const orderIds = new Set();

for (const r of sales) {
  totalSaleAmount += Number(r.sale_amount) || 0;
  orderIds.add(String(r.order_id));
  const s = Number(r.settlement_amount) || 0;
  if (s > 0) {
    withSettlement++;
    totalSettlement += s;
  }
}

console.log('=== AUGUST HEEDA TOTALS (8/1~8/31) ===');
console.log(`총 행수: ${sales.length}건`);
console.log(`주문수: ${orderIds.size}건`);
console.log(`DB sale_amount 합계: ${totalSaleAmount.toLocaleString()}원`);
console.log(`settlement_amount 보유: ${withSettlement}건 (합계: ${totalSettlement.toLocaleString()}원)`);
console.log(`쿠팡 윙 기준 목표: 2,467,500원`);
console.log(`차이: ${(totalSaleAmount - 2467500).toLocaleString()}원`);

// Check which dates have data
const byDate = {};
for (const r of sales) {
  if (!byDate[r.sale_date]) byDate[r.sale_date] = { count: 0, total: 0 };
  byDate[r.sale_date].count++;
  byDate[r.sale_date].total += Number(r.sale_amount) || 0;
}

const sortedDates = Object.keys(byDate).sort();
console.log(`\n데이터 존재 날짜: ${sortedDates[0]} ~ ${sortedDates[sortedDates.length - 1]}`);
console.log(`데이터 있는 날: ${sortedDates.length}일`);

// Missing dates in August
const allAugDates = [];
for (let d = 1; d <= 31; d++) {
  allAugDates.push(`2026-08-${String(d).padStart(2, '0')}`);
}
const missing = allAugDates.filter(d => !byDate[d]);
if (missing.length > 0) {
  console.log(`누락 날짜: ${missing.join(', ')}`);
}

// Check raw_payload: how many have unitSalesPrice vs salePrice
let unitSalesPriceCount = 0;
let salePriceCount = 0;
for (const r of sales) {
  const rp = r.raw_payload || {};
  const item = rp.item || {};
  if (item.unitSalesPrice !== undefined) unitSalesPriceCount++;
  if (item.salePrice !== undefined) salePriceCount++;
}
console.log(`\nunitSalesPrice 포맷: ${unitSalesPriceCount}건`);
console.log(`salePrice 포맷 (revenue-history): ${salePriceCount}건`);

// Try to figure out data source by checking paidDateKST in order
let paidDateCount = 0;
for (const r of sales) {
  const rp = r.raw_payload || {};
  const order = rp.order || {};
  if (order.paidDateKST) paidDateCount++;
}
console.log(`paidDateKST 존재: ${paidDateCount}건`);
