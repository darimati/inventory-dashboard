import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local manually
const envPath = resolve(import.meta.dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const { data, error } = await sb.from('settlements_coupang')
  .select('raw_payload, settlement_date, revenue_recognition_year_month, settlement_type, status, final_amount, settlement_amount')
  .order('settlement_date', { ascending: false })
  .limit(50);

if (error) { console.error(error); process.exit(1); }

// Collect all unique keys from raw_payload
const allKeys = new Map();
for (const row of data) {
  if (!row.raw_payload) continue;
  for (const [key, val] of Object.entries(row.raw_payload)) {
    if (!allKeys.has(key)) allKeys.set(key, { count: 0, nonZero: 0, samples: [] });
    const info = allKeys.get(key);
    info.count++;
    if (typeof val === 'number' && val !== 0) {
      info.nonZero++;
      if (info.samples.length < 3) info.samples.push(val);
    }
  }
}

console.log('=== raw_payload keys (sorted by non-zero count) ===');
for (const [key, info] of [...allKeys.entries()].sort((a, b) => b.nonZero - a.nonZero)) {
  console.log(`${key} | total: ${info.count} | nonZero: ${info.nonZero} | samples: [${info.samples.join(', ')}]`);
}

console.log('\n=== Settlement types ===');
const types = new Map();
for (const row of data) {
  const t = row.settlement_type || 'null';
  types.set(t, (types.get(t) || 0) + 1);
}
for (const [t, c] of types) console.log(`${t}: ${c}건`);

console.log('\n=== Sample rows (first 5) ===');
for (const row of data.slice(0, 5)) {
  console.log(`${row.settlement_date} | ${row.revenue_recognition_year_month} | ${row.settlement_type} | ${row.status}`);
  console.log(`  settlement: ${row.settlement_amount} | final: ${row.final_amount}`);
  if (row.raw_payload) {
    const p = row.raw_payload;
    const nonZero = Object.entries(p).filter(([, v]) => typeof v === 'number' && v !== 0);
    for (const [k, v] of nonZero) {
      console.log(`  ${k}: ${v}`);
    }
  }
  console.log('---');
}
