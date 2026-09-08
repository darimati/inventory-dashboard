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

// Check when records were inserted (updated_at)
const { data: allHeeda } = await sb.from('sales_coupang')
  .select('sale_date, updated_at, sale_amount, raw_payload, order_id')
  .eq('brand', 'HEEDA').eq('sale_type', 'SALE')
  .order('updated_at', { ascending: true });

console.log('=== HEEDA RECORD INSERTION TIMELINE ===');
console.log(`Total records: ${(allHeeda || []).length}\n`);

// Group by updated_at date (when inserted)
const byInsertDate = {};
for (const r of allHeeda || []) {
  const insertDate = (r.updated_at || '').slice(0, 10);
  const item = (r.raw_payload || {}).item || {};
  const format = item.unitSalesPrice !== undefined ? 'unitSalesPrice' :
                 item.salePrice !== undefined ? 'revenue-history' : 'unknown';

  if (!byInsertDate[insertDate]) byInsertDate[insertDate] = { count: 0, formats: {}, saleDates: new Set() };
  byInsertDate[insertDate].count++;
  byInsertDate[insertDate].formats[format] = (byInsertDate[insertDate].formats[format] || 0) + 1;
  byInsertDate[insertDate].saleDates.add(r.sale_date);
}

console.log('삽입일(updated_at) | 건수 | 형식 | 매출날짜범위');
for (const [insertDate, info] of Object.entries(byInsertDate).sort()) {
  const saleDates = [...info.saleDates].sort();
  const range = saleDates.length === 1 ? saleDates[0] : `${saleDates[0]}~${saleDates[saleDates.length - 1]}`;
  const fmtStr = Object.entries(info.formats).map(([k, v]) => `${k}:${v}`).join(', ');
  console.log(`${insertDate} | ${String(info.count).padStart(3)}건 | ${fmtStr} | ${range}`);
}

// Also check if there are records with very different order_id patterns
console.log('\n=== ORDER ID PATTERNS ===');
const orderIdPatterns = {};
for (const r of allHeeda || []) {
  const oid = String(r.order_id);
  const len = oid.length;
  const prefix = oid.slice(0, 2);
  const key = `len=${len}, prefix=${prefix}xx`;
  if (!orderIdPatterns[key]) orderIdPatterns[key] = { count: 0, examples: [] };
  orderIdPatterns[key].count++;
  if (orderIdPatterns[key].examples.length < 2) orderIdPatterns[key].examples.push(oid);
}

for (const [pattern, info] of Object.entries(orderIdPatterns).sort()) {
  console.log(`${pattern}: ${info.count}건 (ex: ${info.examples.join(', ')})`);
}
