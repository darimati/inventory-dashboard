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

// Get earliest HEEDA rows
const { data: early } = await sb.from('sales_coupang')
  .select('order_id, vendor_item_id, sale_date, sale_amount, settlement_amount, raw_payload')
  .eq('brand', 'HEEDA').eq('sale_type', 'SALE')
  .order('sale_date', { ascending: true }).limit(3);

console.log('=== EARLIEST HEEDA ROWS ===');
for (const r of early || []) {
  console.log(`\nDate: ${r.sale_date}, OrderID: ${r.order_id}, VID: ${r.vendor_item_id}`);
  console.log(`sale_amount: ${r.sale_amount}, settlement_amount: ${r.settlement_amount}`);
  const rp = r.raw_payload || {};
  console.log('raw_payload:', JSON.stringify(rp).slice(0, 800));
}

// Get August HEEDA rows
const { data: aug } = await sb.from('sales_coupang')
  .select('order_id, vendor_item_id, sale_date, sale_amount, settlement_amount, raw_payload')
  .eq('brand', 'HEEDA').eq('sale_type', 'SALE')
  .gte('sale_date', '2026-08-01').lte('sale_date', '2026-08-03')
  .limit(3);

console.log('\n\n=== AUGUST HEEDA ROWS ===');
for (const r of aug || []) {
  console.log(`\nDate: ${r.sale_date}, OrderID: ${r.order_id}, VID: ${r.vendor_item_id}`);
  console.log(`sale_amount: ${r.sale_amount}, settlement_amount: ${r.settlement_amount}`);
  const rp = r.raw_payload || {};
  console.log('raw_payload:', JSON.stringify(rp).slice(0, 800));
}

// Count rows by format type
const { data: allHeeda } = await sb.from('sales_coupang')
  .select('raw_payload, sale_date')
  .eq('brand', 'HEEDA').eq('sale_type', 'SALE');

let revenueHistFormat = 0;
let unknownFormat = 0;
let noPayload = 0;

for (const r of allHeeda || []) {
  const rp = r.raw_payload || {};
  if (rp.item) {
    revenueHistFormat++;
  } else if (rp.unitSalesPrice !== undefined || rp.paidDateKST !== undefined) {
    unknownFormat++;
  } else {
    noPayload++;
  }
}

console.log('\n\n=== FORMAT DISTRIBUTION ===');
console.log(`Revenue-history format (has .item): ${revenueHistFormat}`);
console.log(`Unknown format (unitSalesPrice/paidDateKST): ${unknownFormat}`);
console.log(`No/other payload: ${noPayload}`);
console.log(`Total: ${(allHeeda || []).length}`);

// Check if revenue-history items have settlementAmount
let withSettlement = 0;
let withoutSettlement = 0;
for (const r of allHeeda || []) {
  const rp = r.raw_payload || {};
  if (rp.item && rp.item.settlementAmount) {
    withSettlement++;
  } else if (rp.item) {
    withoutSettlement++;
  }
}
console.log(`\nRevenue-history items with settlementAmount: ${withSettlement}`);
console.log(`Revenue-history items without settlementAmount: ${withoutSettlement}`);
