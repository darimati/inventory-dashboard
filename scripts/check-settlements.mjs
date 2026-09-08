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

async function main() {
  console.log('=== settlements_coupang 전체 조회 ===\n');
  
  // Get all settlement records
  const { data: settlements, error } = await sb
    .from('settlements_coupang')
    .select('*')
    .order('settlement_date', { ascending: true });
  
  if (error) { console.error('ERROR:', error); return; }
  
  console.log(`Total records: ${settlements.length}\n`);
  
  // Print each record with raw_payload details
  for (const s of settlements) {
    console.log(`--- Record ---`);
    console.log(`  year_month: ${s.revenue_recognition_year_month}`);
    console.log(`  settlement_date: ${s.settlement_date}`);
    console.log(`  settlement_type: ${s.settlement_type}`);
    console.log(`  status: ${s.status}`);
    console.log(`  final_amount: ${s.final_amount}`);
    console.log(`  settlement_amount: ${s.settlement_amount}`);
    console.log(`  revenue_from: ${s.revenue_recognition_date_from}`);
    console.log(`  revenue_to: ${s.revenue_recognition_date_to}`);
    
    // Check raw_payload for brand-specific info
    const rp = s.raw_payload || {};
    console.log(`  raw_payload keys: ${Object.keys(rp).join(', ')}`);
    
    // Check if there's any brand/product differentiation
    if (rp.brandName) console.log(`  brandName: ${rp.brandName}`);
    if (rp.productName) console.log(`  productName: ${rp.productName}`);
    if (rp.totalSale) console.log(`  totalSale: ${rp.totalSale}`);
    if (rp.serviceFee) console.log(`  serviceFee: ${rp.serviceFee}`);
    if (rp.settlementTargetAmount) console.log(`  settlementTargetAmount: ${rp.settlementTargetAmount}`);
    if (rp.totalUnitCount) console.log(`  totalUnitCount: ${rp.totalUnitCount}`);
    
    // Print FULL raw_payload for first 3 records
    if (settlements.indexOf(s) < 3) {
      console.log(`  FULL raw_payload: ${JSON.stringify(rp, null, 2)}`);
    }
    console.log();
  }
  
  // Summary: can we distinguish HEEDA vs SUPERLABS from settlement data?
  console.log('\n=== ANALYSIS ===');
  console.log('Settlement API returns aggregate data per vendor, NOT per brand/product.');
  console.log('Checking if any fields indicate brand segmentation...');
  
  const hasProductRef = settlements.some(s => {
    const rp = s.raw_payload || {};
    return rp.brandName || rp.productName || rp.vendorItemId;
  });
  console.log(`Has product/brand reference: ${hasProductRef}`);
  
  // Total settlement amounts
  const totalSettlement = settlements.reduce((sum, s) => sum + (Number(s.settlement_amount) || 0), 0);
  const totalFinal = settlements.reduce((sum, s) => sum + (Number(s.final_amount) || 0), 0);
  console.log(`\nTotal settlement_amount across all records: ${totalSettlement.toLocaleString()}`);
  console.log(`Total final_amount across all records: ${totalFinal.toLocaleString()}`);
  
  // Also check raw_payload for HEEDA items in sales_coupang that came from DB 
  console.log('\n\n=== sales_coupang: raw_payload 포맷별 분류 ===\n');
  
  // Get all HEEDA rows
  const { data: heedaRows } = await sb
    .from('sales_coupang')
    .select('order_id, vendor_item_id, sale_date, sale_amount, settlement_amount, raw_payload, updated_at')
    .eq('brand', 'HEEDA')
    .eq('sale_type', 'SALE')
    .order('sale_date', { ascending: true })
    .limit(500);
  
  let withSettlement = 0;
  let withoutSettlement = 0;
  let withUnitSalesPrice = 0;
  
  for (const r of (heedaRows || [])) {
    const rp = r.raw_payload || {};
    const item = rp.item || {};
    if (item.settlementAmount !== undefined && item.settlementAmount !== null && item.settlementAmount !== 0) {
      withSettlement++;
    } else {
      withoutSettlement++;
    }
    if (item.unitSalesPrice !== undefined) {
      withUnitSalesPrice++;
    }
  }
  
  console.log(`Total HEEDA SALE rows: ${(heedaRows || []).length}`);
  console.log(`With settlementAmount: ${withSettlement}`);
  console.log(`Without settlementAmount: ${withoutSettlement}`);
  console.log(`With unitSalesPrice field: ${withUnitSalesPrice}`);
  
  // Show sample of each format
  const sampleWithSettlement = (heedaRows || []).find(r => (r.raw_payload?.item?.settlementAmount || 0) > 0);
  const sampleWithout = (heedaRows || []).find(r => r.raw_payload?.item?.unitSalesPrice);
  
  if (sampleWithSettlement) {
    console.log('\n--- Sample WITH settlementAmount ---');
    console.log(JSON.stringify(sampleWithSettlement.raw_payload, null, 2));
  }
  if (sampleWithout) {
    console.log('\n--- Sample WITH unitSalesPrice (no settlement) ---');
    console.log(JSON.stringify(sampleWithout.raw_payload, null, 2));
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
