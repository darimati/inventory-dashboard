#!/usr/bin/env node
/**
 * 월별 데이터 정합성 체크 — DB vs Coupang Wing
 */
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

// Wing 기준값 (스크린샷에서 추출)
const WING_DATA = {
  '2026-05': { sales: 958550, orders: 68 },
  '2026-06': { sales: 1003940, orders: 67 },
  '2026-08': { sales: 2467500, orders: null }, // 정확한 건수 미확인
};

async function checkMonth(yearMonth) {
  const [year, month] = yearMonth.split('-');
  const startDate = `${yearMonth}-01`;
  const lastDay = new Date(Number(year), Number(month), 0).getDate();
  const endDate = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;

  const { data: rows } = await sb.from('sales_coupang')
    .select('order_id, vendor_item_id, sale_date, sale_amount, sale_type, product_name, raw_payload, settlement_amount')
    .eq('brand', 'HEEDA').eq('country', 'KR')
    .gte('sale_date', startDate).lte('sale_date', endDate);

  const allRows = rows || [];
  const sales = allRows.filter(r => r.sale_type === 'SALE');
  const cancels = allRows.filter(r => r.sale_type !== 'SALE');

  let totalSaleAmount = 0;
  const orderIds = new Set();
  const byProduct = {};
  const byDate = {};

  for (const r of sales) {
    const amt = Number(r.sale_amount) || 0;
    totalSaleAmount += amt;
    orderIds.add(String(r.order_id));

    const pn = r.product_name || 'UNKNOWN';
    if (!byProduct[pn]) byProduct[pn] = { count: 0, total: 0 };
    byProduct[pn].count++;
    byProduct[pn].total += amt;

    if (!byDate[r.sale_date]) byDate[r.sale_date] = { count: 0, total: 0 };
    byDate[r.sale_date].count++;
    byDate[r.sale_date].total += amt;
  }

  // Check raw_payload formats
  let unitSalesPriceFormat = 0;
  let revHistFormat = 0;
  for (const r of sales) {
    const item = (r.raw_payload || {}).item || {};
    if (item.unitSalesPrice !== undefined) unitSalesPriceFormat++;
    if (item.salePrice !== undefined && item.settlementAmount !== undefined) revHistFormat++;
  }

  const wing = WING_DATA[yearMonth];

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${yearMonth} 데이터 정합성 체크`);
  console.log(`${'='.repeat(60)}`);
  console.log(`DB SALE 건수: ${sales.length}건 (주문 ${orderIds.size}건)`);
  console.log(`DB 취소/반품: ${cancels.length}건`);
  console.log(`DB sale_amount 합계: ${totalSaleAmount.toLocaleString()}원`);

  if (wing) {
    console.log(`\nWing 매출: ${wing.sales.toLocaleString()}원 (${wing.orders || '?'}건)`);
    console.log(`차이: ${(totalSaleAmount - wing.sales).toLocaleString()}원 (${((totalSaleAmount - wing.sales) / wing.sales * 100).toFixed(1)}%)`);
    if (wing.orders) {
      console.log(`건수 차이: DB ${sales.length}건 vs Wing ${wing.orders}건 (${sales.length - wing.orders}건)`);
    }
  }

  console.log(`\n데이터 형식: unitSalesPrice ${unitSalesPriceFormat}건, revenue-history ${revHistFormat}건`);

  // Date coverage
  const sortedDates = Object.keys(byDate).sort();
  const allDays = [];
  for (let d = 1; d <= lastDay; d++) {
    allDays.push(`${yearMonth}-${String(d).padStart(2, '0')}`);
  }
  const missingDates = allDays.filter(d => !byDate[d]);
  console.log(`\n날짜 범위: ${sortedDates[0] || 'N/A'} ~ ${sortedDates[sortedDates.length - 1] || 'N/A'}`);
  console.log(`데이터 있는 날: ${sortedDates.length}/${lastDay}일`);
  if (missingDates.length > 0 && missingDates.length <= 10) {
    console.log(`누락 날짜: ${missingDates.join(', ')}`);
  } else if (missingDates.length > 10) {
    console.log(`누락 날짜: ${missingDates.length}일 (${missingDates.slice(0, 5).join(', ')}...)`);
  }

  // Top products
  console.log('\n상품별 매출:');
  const sortedProducts = Object.entries(byProduct).sort((a, b) => b[1].total - a[1].total);
  for (const [name, info] of sortedProducts) {
    console.log(`  ${info.count}건 | ${info.total.toLocaleString()}원 | ${name.slice(0, 60)}`);
  }

  // Check for duplicates
  const keys = sales.map(r => `${r.order_id}|${r.vendor_item_id}`);
  const keyCounts = {};
  for (const k of keys) {
    keyCounts[k] = (keyCounts[k] || 0) + 1;
  }
  const dupes = Object.entries(keyCounts).filter(([, c]) => c > 1);
  if (dupes.length > 0) {
    console.log(`\n⚠️ 중복 의심: ${dupes.length}건`);
    for (const [key, count] of dupes.slice(0, 5)) {
      console.log(`  ${key}: ${count}회`);
    }
  }

  return { totalSaleAmount, salesCount: sales.length, orderCount: orderIds.size, wing };
}

async function main() {
  const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];

  const results = {};
  for (const m of months) {
    results[m] = await checkMonth(m);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('월별 요약');
  console.log(`${'='.repeat(60)}`);
  console.log('월     | DB 매출         | Wing 매출       | 차이         | DB건수');
  for (const [m, r] of Object.entries(results)) {
    const wingStr = r.wing ? r.wing.sales.toLocaleString().padStart(12) : '      미확인';
    const diffStr = r.wing ? (r.totalSaleAmount - r.wing.sales).toLocaleString().padStart(10) : '         -';
    console.log(`${m} | ${r.totalSaleAmount.toLocaleString().padStart(12)}원 | ${wingStr}원 | ${diffStr}원 | ${r.salesCount}건`);
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
