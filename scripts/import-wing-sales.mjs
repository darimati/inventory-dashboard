#!/usr/bin/env node
/**
 * 쿠팡 윙 매출 데이터 임포트 스크립트
 *
 * Wing에서 다운로드한 엑셀/CSV 파일을 읽어 sales_coupang 테이블에 적재.
 * 기존 데이터와 중복 시 upsert로 업데이트.
 *
 * 사용법:
 *   node scripts/import-wing-sales.mjs <file.xlsx|file.csv>
 *   node scripts/import-wing-sales.mjs <file.xlsx> --dry-run
 *   node scripts/import-wing-sales.mjs <file.xlsx> --clear-month 2026-05
 *
 * 지원 형식:
 *   1. Wing 주문내역 엑셀 (주문번호, 결제일, 상품명, 옵션ID, 판매단가, 결제금액 등)
 *   2. Wing 판매분석 CSV (상품별 집계 — 일별 분할 불가, 주의)
 *   3. 커스텀 CSV (order_id, sale_date, vendor_item_id, product_name, sale_amount, settlement_amount)
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

const HEEDA_VIDS = new Set([
  '90554556327', '90621781347', '94426583769',
  '93924698351', '93924698352', '91329716230',
  '91007861343', '92197095172', '91007763848',
  '93943745189', '91541164600', '93943745188', '91541180389',
  '93993063704',
]);

function detectBrand(vendorItemId, productName) {
  if (HEEDA_VIDS.has(String(vendorItemId))) return 'HEEDA';
  const lower = (productName || '').toLowerCase();
  if (lower.includes('슈퍼랩스') || lower.includes('superlabs')) return 'SUPERLABS';
  if (lower.includes('희다') || lower.includes('heeda') ||
      lower.includes('클렌징밤') || lower.includes('클렌징 밤') ||
      lower.includes('클렌징폼') || lower.includes('클렌징 폼') ||
      lower.includes('폼클렌징') || lower.includes('세럼')) return 'HEEDA';
  return 'OTHER';
}

// --- Parse helpers ---

function parseDate(str) {
  if (!str) return null;
  // Handle various date formats
  const s = String(str).trim();
  // yyyy-MM-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // yyyy.MM.dd
  if (/^\d{4}\.\d{2}\.\d{2}$/.test(s)) return s.replace(/\./g, '-');
  // yyyy/MM/dd
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s.replace(/\//g, '-');
  // yyyy-MM-dd HH:mm:ss or yyyy-MM-ddTHH:mm:ss
  const m = s.match(/^(\d{4}[-/.]\d{2}[-/.]\d{2})/);
  if (m) return m[1].replace(/[/.]/g, '-');
  // Excel serial number
  const num = Number(s);
  if (num > 40000 && num < 50000) {
    const date = new Date((num - 25569) * 86400000);
    return date.toISOString().slice(0, 10);
  }
  return null;
}

function parseNumber(str) {
  if (str === null || str === undefined || str === '') return 0;
  if (typeof str === 'number') return str;
  return Number(String(str).replace(/[,원₩\s]/g, '')) || 0;
}

// --- CSV parser (simple, handles quoted fields) ---

function parseCSV(text) {
  const lines = text.split('\n');
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    rows.push(cells);
  }
  return rows;
}

// --- Excel parser (requires xlsx package) ---

async function parseExcel(filePath) {
  let XLSX;
  try {
    XLSX = (await import('xlsx')).default || (await import('xlsx'));
  } catch {
    console.error('xlsx 패키지가 필요합니다: npm install xlsx');
    process.exit(1);
  }
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1 });
}

// --- Column mapping ---

// Wing 주문내역 엑셀의 가능한 칼럼명
const COLUMN_MAP = {
  // 주문번호
  '주문번호': 'order_id',
  '주문 번호': 'order_id',
  'orderId': 'order_id',
  'order_id': 'order_id',

  // 결제일
  '결제일': 'sale_date',
  '결제일시': 'sale_date',
  '결제시각': 'sale_date',
  '주문일': 'sale_date',
  '주문일시': 'sale_date',
  '주문시각': 'sale_date',
  'sale_date': 'sale_date',
  'paidDate': 'sale_date',

  // 옵션ID (vendor_item_id)
  '옵션ID': 'vendor_item_id',
  '옵션 ID': 'vendor_item_id',
  'vendorItemId': 'vendor_item_id',
  'vendor_item_id': 'vendor_item_id',
  '옵션id': 'vendor_item_id',

  // 상품명
  '노출 상품명': 'product_name',
  '상품명': 'product_name',
  '옵션명': 'product_name',
  'productName': 'product_name',
  'product_name': 'product_name',

  // 판매단가 (정가)
  '판매단가': 'unit_price',
  '판매가': 'unit_price',
  'salesPrice': 'unit_price',
  'unitSalesPrice': 'unit_price',
  'unit_price': 'unit_price',

  // 결제금액 (실결제)
  '결제금액': 'order_price',
  '실결제금액': 'order_price',
  'orderPrice': 'order_price',
  'order_price': 'order_price',
  'sale_amount': 'order_price',

  // 수량
  '수량': 'quantity',
  '주문수량': 'quantity',
  'quantity': 'quantity',

  // 주문상태
  '주문상태': 'status',
  'status': 'status',
};

function mapColumns(headers) {
  const mapping = {};
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || '').trim();
    const mapped = COLUMN_MAP[h];
    if (mapped) {
      mapping[mapped] = i;
    }
  }
  return mapping;
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const DRY_RUN = args.includes('--dry-run');
  const clearMonthIdx = args.indexOf('--clear-month');
  const clearMonth = clearMonthIdx >= 0 ? args[clearMonthIdx + 1] : null;
  const filePath = args.find(a => !a.startsWith('--'));

  if (!filePath) {
    console.log('사용법: node scripts/import-wing-sales.mjs <file.xlsx|file.csv> [--dry-run] [--clear-month YYYY-MM]');
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`파일 없음: ${absPath}`);
    process.exit(1);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Wing 매출 데이터 임포트`);
  console.log(`파일: ${absPath}`);
  console.log(`모드: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`${'='.repeat(60)}\n`);

  // Parse file
  let rows;
  const ext = path.extname(absPath).toLowerCase();
  if (ext === '.csv' || ext === '.tsv') {
    const text = fs.readFileSync(absPath, 'utf-8');
    rows = parseCSV(text);
  } else {
    rows = await parseExcel(absPath);
  }

  if (rows.length < 2) {
    console.error('데이터 없음 (헤더만 있거나 비어있음)');
    process.exit(1);
  }

  // Map columns
  const headers = rows[0];
  console.log(`칼럼: ${headers.join(' | ')}`);

  const colMap = mapColumns(headers);
  console.log(`\n매핑된 칼럼:`);
  for (const [field, idx] of Object.entries(colMap)) {
    console.log(`  ${field} → ${headers[idx]} (col ${idx})`);
  }

  // Validate required columns
  if (colMap.order_id === undefined) {
    console.error('\n❌ 주문번호 칼럼을 찾을 수 없습니다');
    console.log('가능한 칼럼명: 주문번호, orderId, order_id');
    process.exit(1);
  }
  if (colMap.sale_date === undefined) {
    console.error('\n❌ 날짜 칼럼을 찾을 수 없습니다');
    process.exit(1);
  }
  if (colMap.order_price === undefined && colMap.unit_price === undefined) {
    console.error('\n❌ 금액 칼럼을 찾을 수 없습니다 (결제금액 또는 판매단가)');
    process.exit(1);
  }

  // Parse data rows
  const dataRows = rows.slice(1);
  const records = [];
  let skipped = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const orderId = String(row[colMap.order_id] || '').trim();
    if (!orderId || orderId === '0') { skipped++; continue; }

    const saleDate = parseDate(row[colMap.sale_date]);
    if (!saleDate) { skipped++; continue; }

    const vid = colMap.vendor_item_id !== undefined ? String(row[colMap.vendor_item_id] || '').trim() : '';
    const productName = colMap.product_name !== undefined ? String(row[colMap.product_name] || '').trim() : '';
    const unitPrice = colMap.unit_price !== undefined ? parseNumber(row[colMap.unit_price]) : 0;
    const orderPrice = colMap.order_price !== undefined ? parseNumber(row[colMap.order_price]) : unitPrice;
    const quantity = colMap.quantity !== undefined ? parseNumber(row[colMap.quantity]) || 1 : 1;
    const status = colMap.status !== undefined ? String(row[colMap.status] || '').trim() : '';

    // Skip cancelled orders
    if (status && (status.includes('취소') || status.includes('반품'))) {
      continue;
    }

    const brand = detectBrand(vid, productName);

    records.push({
      order_id: orderId,
      vendor_item_id: vid || 'UNKNOWN',
      sale_type: 'SALE',
      sale_date: saleDate,
      brand,
      country: 'KR',
      sale_amount: orderPrice || unitPrice,  // Prefer actual payment (orderPrice)
      quantity,
      settlement_amount: orderPrice > 0 && unitPrice > 0 && orderPrice !== unitPrice ? orderPrice : null,
      product_name: productName,
      raw_payload: {
        source: 'wing_import',
        importedAt: new Date().toISOString(),
        unitPrice,
        orderPrice,
        originalRow: i + 2,
      },
      updated_at: new Date().toISOString(),
    });
  }

  console.log(`\n파싱 결과: ${records.length}건 유효, ${skipped}건 스킵`);

  // Brand breakdown
  const brandCounts = {};
  for (const r of records) {
    if (!brandCounts[r.brand]) brandCounts[r.brand] = { count: 0, total: 0 };
    brandCounts[r.brand].count++;
    brandCounts[r.brand].total += r.sale_amount;
  }

  console.log('\n브랜드별:');
  for (const [brand, info] of Object.entries(brandCounts)) {
    console.log(`  ${brand}: ${info.count}건, ${info.total.toLocaleString()}원`);
  }

  // Monthly breakdown
  const monthCounts = {};
  for (const r of records) {
    const ym = r.sale_date.slice(0, 7);
    if (!monthCounts[ym]) monthCounts[ym] = { count: 0, total: 0 };
    monthCounts[ym].count++;
    monthCounts[ym].total += r.sale_amount;
  }

  console.log('\n월별:');
  for (const [ym, info] of Object.entries(monthCounts).sort()) {
    console.log(`  ${ym}: ${info.count}건, ${info.total.toLocaleString()}원`);
  }

  if (DRY_RUN) {
    console.log('\n--- DRY RUN 완료 (DB 변경 없음) ---');
    return;
  }

  // Clear existing data for specified month if requested
  if (clearMonth) {
    const clearStart = `${clearMonth}-01`;
    const [y, m] = clearMonth.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const clearEnd = `${clearMonth}-${String(lastDay).padStart(2, '0')}`;

    console.log(`\n기존 ${clearMonth} 데이터 삭제 중...`);
    const { error, count } = await sb.from('sales_coupang')
      .delete()
      .eq('brand', 'HEEDA')
      .gte('sale_date', clearStart)
      .lte('sale_date', clearEnd);

    if (error) {
      console.error(`삭제 오류: ${error.message}`);
    } else {
      console.log(`삭제 완료: ${clearMonth} HEEDA 데이터`);
    }
  }

  // Upsert records
  console.log(`\nDB 삽입/업데이트 중...`);
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < records.length; i += 50) {
    const batch = records.slice(i, i + 50);
    const { error } = await sb.from('sales_coupang')
      .upsert(batch, {
        onConflict: 'order_id,vendor_item_id,sale_type',
        ignoreDuplicates: false,
      });

    if (error) {
      console.error(`  batch ${Math.floor(i / 50) + 1} 오류: ${error.message}`);
      errors++;
    } else {
      inserted += batch.length;
    }
  }

  console.log(`\n완료: ${inserted}건 삽입/업데이트, ${errors}건 오류`);

  // Verify
  const { count: totalCount } = await sb.from('sales_coupang')
    .select('*', { count: 'exact', head: true })
    .eq('brand', 'HEEDA').eq('sale_type', 'SALE');

  console.log(`DB 현재 HEEDA SALE 레코드: ${totalCount}건`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
