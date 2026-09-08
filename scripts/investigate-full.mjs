#!/usr/bin/env node
/**
 * Full investigation script — Tasks 1, 2, 5, 6, 9
 * 1. revenue-history 요청/응답 전문 로그
 * 2. vendorItemId 필터 없이 전체 조회 시 HEEDA 포함 여부
 * 5. 짧은 기간(4/19~4/30) 조회 결과
 * 6. recognitionDate 미인식분 누락 가능성
 * 9. API 키 권한/범위 확인
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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

async function coupangRawRequest(method, apiPath, query = {}) {
  const qs = new URLSearchParams(query).toString();
  const url = `${BASE_URL}${apiPath}${qs ? '?' + qs : ''}`;
  const auth = authHeader(method, apiPath, qs);

  const reqLog = {
    method,
    url,
    apiPath,
    queryString: qs,
    queryParams: { ...query },
    headers: {
      'Content-type': 'application/json;charset=UTF-8',
      Authorization: auth.replace(/signature=\w+/, 'signature=<REDACTED>'),
    },
  };

  const resp = await fetch(url, {
    method,
    headers: { 'Content-type': 'application/json;charset=UTF-8', Authorization: auth },
  });

  const bodyText = await resp.text();
  let bodyJson = null;
  try { bodyJson = JSON.parse(bodyText); } catch {}

  return {
    request: reqLog,
    response: {
      status: resp.status,
      statusText: resp.statusText,
      headers: Object.fromEntries(resp.headers.entries()),
      body: bodyJson || bodyText.slice(0, 3000),
    },
  };
}

function isHeeda(vendorItemId, productName) {
  if (HEEDA_VIDS.has(String(vendorItemId))) return true;
  const lower = (productName || '').toLowerCase();
  return lower.includes('희다') || lower.includes('heeda') ||
    lower.includes('클렌징밤') || lower.includes('클렌징 밤') ||
    lower.includes('클렌징폼') || lower.includes('클렌징 폼') ||
    lower.includes('폼클렌징') || lower.includes('세럼');
}

const output = {};

async function main() {
  // ================================================================
  // TASK 1: revenue-history 요청 파라미터 전문 + 응답 전문 로그
  // ================================================================
  console.log('\n' + '='.repeat(70));
  console.log('TASK 1: revenue-history 요청/응답 전문 로그');
  console.log('='.repeat(70));

  const revPath = '/v2/providers/openapi/apis/api/v1/revenue-history';

  // Test with August (recent data)
  const query1 = {
    vendorId: VENDOR_ID,
    recognitionDateFrom: '2026-08-01',
    recognitionDateTo: '2026-08-15',
    token: '',
    maxPerPage: '50',
  };

  console.log('\n[1a] Request (Aug 1-15):');
  const result1 = await coupangRawRequest('GET', revPath, query1);
  console.log('REQUEST:', JSON.stringify(result1.request, null, 2));
  console.log('\nRESPONSE STATUS:', result1.response.status, result1.response.statusText);
  console.log('RESPONSE HEADERS:', JSON.stringify(result1.response.headers, null, 2));
  console.log('RESPONSE BODY (full):');
  console.log(JSON.stringify(result1.response.body, null, 2));

  output.task1_aug = result1;

  // Classify each item in response
  const augOrders = result1.response.body?.data || [];
  console.log(`\n[1a] Items in response:`);
  let augHeedaCount = 0;
  let augSuperlabsCount = 0;
  let augOtherCount = 0;
  for (const order of augOrders) {
    for (const item of (order.items || [])) {
      const vid = String(item.vendorItemId);
      const isH = isHeeda(vid, item.productName);
      const brand = isH ? 'HEEDA' :
        ((item.productName || '').toLowerCase().includes('superlabs') ||
         (item.productName || '').toLowerCase().includes('슈퍼랩스')) ? 'SUPERLABS' : 'OTHER';
      if (brand === 'HEEDA') augHeedaCount++;
      else if (brand === 'SUPERLABS') augSuperlabsCount++;
      else augOtherCount++;
      console.log(`  ${brand} | VID: ${vid} | ${(item.productName || '').slice(0, 50)} | salePrice: ${item.salePrice} | settlementAmount: ${item.settlementAmount} | coupangDiscountCoupon: ${item.coupangDiscountCoupon}`);
    }
  }
  console.log(`\n  Summary: HEEDA=${augHeedaCount}, SUPERLABS=${augSuperlabsCount}, OTHER=${augOtherCount}`);

  await new Promise(r => setTimeout(r, 1500));

  // ================================================================
  // TASK 2: vendorItemId 필터 없이 전체 조회 (이미 필터 없이 하고 있음 확인)
  // ================================================================
  console.log('\n' + '='.repeat(70));
  console.log('TASK 2: vendorItemId 필터 없이 전체 조회 → HEEDA 포함 여부');
  console.log('='.repeat(70));

  console.log('\nNOTE: revenue-history API에 vendorItemId 파라미터는 없음.');
  console.log('이미 vendorId(셀러 ID) 기준 전체 조회이며, 아이템 필터링은 응답 후 코드에서 수행.');
  console.log('위 Task 1 결과가 곧 "필터 없는 전체 조회" 결과임.');
  console.log(`결과: Aug 1-15 전체 ${augOrders.length}개 주문, HEEDA ${augHeedaCount}건, SUPERLABS ${augSuperlabsCount}건`);

  output.task2 = {
    note: 'revenue-history API has no vendorItemId filter param. Already querying all items for vendorId.',
    augTotalOrders: augOrders.length,
    augHeedaCount,
    augSuperlabsCount,
  };

  // ================================================================
  // TASK 5: 짧은 기간(4/19~4/30) 조회 결과
  // ================================================================
  console.log('\n' + '='.repeat(70));
  console.log('TASK 5: 짧은 기간 (4/19~4/30) 조회');
  console.log('='.repeat(70));

  const query5 = {
    vendorId: VENDOR_ID,
    recognitionDateFrom: '2026-04-19',
    recognitionDateTo: '2026-04-30',
    token: '',
    maxPerPage: '100',
  };

  const result5 = await coupangRawRequest('GET', revPath, query5);
  console.log('\n[5] Request (Apr 19-30):');
  console.log('REQUEST PARAMS:', JSON.stringify(query5, null, 2));
  console.log('RESPONSE STATUS:', result5.response.status);
  console.log('RESPONSE BODY:');
  console.log(JSON.stringify(result5.response.body, null, 2));

  const aprOrders = result5.response.body?.data || [];
  let aprHeedaCount = 0;
  console.log(`\n[5] Items (Apr 19-30):`);
  for (const order of aprOrders) {
    for (const item of (order.items || [])) {
      const vid = String(item.vendorItemId);
      const h = isHeeda(vid, item.productName);
      if (h) aprHeedaCount++;
      console.log(`  ${h ? 'HEEDA' : 'SUPERLABS/OTHER'} | VID: ${vid} | ${(item.productName || '').slice(0, 50)} | salePrice: ${item.salePrice} | recognitionDate: ${order.recognitionDate}`);
    }
  }
  console.log(`\n  Apr 19-30 결과: ${aprOrders.length} orders, HEEDA ${aprHeedaCount}건`);

  output.task5 = { totalOrders: aprOrders.length, heedaCount: aprHeedaCount };

  await new Promise(r => setTimeout(r, 1500));

  // Now try May 1-15
  console.log('\n--- Also testing May 1-15 ---');
  const result5b = await coupangRawRequest('GET', revPath, {
    vendorId: VENDOR_ID,
    recognitionDateFrom: '2026-05-01',
    recognitionDateTo: '2026-05-15',
    token: '',
    maxPerPage: '100',
  });
  const mayOrders = result5b.response.body?.data || [];
  let mayHeedaCount = 0;
  for (const order of mayOrders) {
    for (const item of (order.items || [])) {
      if (isHeeda(item.vendorItemId, item.productName)) mayHeedaCount++;
    }
  }
  console.log(`May 1-15: ${mayOrders.length} orders, HEEDA ${mayHeedaCount}건`);

  await new Promise(r => setTimeout(r, 1500));

  // July 1-15
  console.log('\n--- Also testing Jul 1-15 ---');
  const result5c = await coupangRawRequest('GET', revPath, {
    vendorId: VENDOR_ID,
    recognitionDateFrom: '2026-07-01',
    recognitionDateTo: '2026-07-15',
    token: '',
    maxPerPage: '100',
  });
  const julOrders = result5c.response.body?.data || [];
  let julHeedaCount = 0;
  for (const order of julOrders) {
    for (const item of (order.items || [])) {
      if (isHeeda(item.vendorItemId, item.productName)) julHeedaCount++;
    }
  }
  console.log(`Jul 1-15: ${julOrders.length} orders, HEEDA ${julHeedaCount}건`);

  // ================================================================
  // TASK 6: recognitionDate 분석 — 기존 HEEDA 응답의 패턴 확인
  // ================================================================
  console.log('\n' + '='.repeat(70));
  console.log('TASK 6: recognitionDate 기준 분석');
  console.log('='.repeat(70));

  // Check if the 2 HEEDA VIDs that DO appear have specific recognition patterns
  // Scan May through August for any HEEDA items
  const allHeedaFromAPI = [];
  const months = [
    ['2026-04-01', '2026-04-30'],
    ['2026-05-01', '2026-05-31'],
    ['2026-06-01', '2026-06-30'],
    ['2026-07-01', '2026-07-31'],
    ['2026-08-01', '2026-08-31'],
  ];

  for (const [from, to] of months) {
    await new Promise(r => setTimeout(r, 1500));
    const r = await coupangRawRequest('GET', revPath, {
      vendorId: VENDOR_ID,
      recognitionDateFrom: from,
      recognitionDateTo: to,
      token: '',
      maxPerPage: '100',
    });
    const orders = r.response.body?.data || [];
    for (const order of orders) {
      for (const item of (order.items || [])) {
        if (isHeeda(item.vendorItemId, item.productName)) {
          allHeedaFromAPI.push({
            orderId: order.orderId,
            vid: String(item.vendorItemId),
            productName: (item.productName || '').slice(0, 60),
            salePrice: item.salePrice,
            saleAmount: item.saleAmount,
            settlementAmount: item.settlementAmount,
            recognitionDate: order.recognitionDate,
            settlementDate: order.settlementDate,
            finalSettlementDate: order.finalSettlementDate,
            saleType: order.saleType,
            deliveryType: item.deliveryType || order.deliveryType || 'N/A',
            deliveryFee: order.deliveryFee,
            // Capture any field that hints at fulfillment method
            rawItemKeys: Object.keys(item).join(', '),
            rawOrderKeys: Object.keys(order).join(', '),
          });
        }
      }
    }
  }

  console.log(`\n[6] All HEEDA items found in revenue-history API (Apr-Aug):`);
  console.log(`Total: ${allHeedaFromAPI.length}건`);
  for (const h of allHeedaFromAPI) {
    console.log(`  recognitionDate: ${h.recognitionDate} | settlementDate: ${h.settlementDate} | finalSettlementDate: ${h.finalSettlementDate}`);
    console.log(`    orderId: ${h.orderId} | VID: ${h.vid}`);
    console.log(`    product: ${h.productName}`);
    console.log(`    salePrice: ${h.salePrice} | saleAmount: ${h.saleAmount} | settlementAmount: ${h.settlementAmount}`);
    console.log(`    saleType: ${h.saleType} | deliveryType: ${h.deliveryType}`);
    console.log(`    item fields: ${h.rawItemKeys}`);
    console.log(`    order fields: ${h.rawOrderKeys}`);
    console.log();
  }

  // Unique VIDs that appear as HEEDA
  const heedaVidsInAPI = new Set(allHeedaFromAPI.map(h => h.vid));
  console.log(`HEEDA VIDs that appear in API: ${[...heedaVidsInAPI].join(', ')}`);
  console.log(`HEEDA VIDs that DON'T appear: ${[...HEEDA_VIDS].filter(v => !heedaVidsInAPI.has(v)).join(', ')}`);

  // Check if recognitionDate is far from sale_date
  console.log('\nrecognitionDate analysis:');
  console.log('- If items have no recognitionDate, they won\'t appear in this API');
  console.log('- 로켓그로스는 인식일이 일반 판매자배송과 다를 수 있음');

  output.task6 = {
    totalHeedaInAPI: allHeedaFromAPI.length,
    heedaVidsInAPI: [...heedaVidsInAPI],
    missingVids: [...HEEDA_VIDS].filter(v => !heedaVidsInAPI.has(v)),
    details: allHeedaFromAPI,
  };

  // ================================================================
  // TASK 9: API 키 권한 범위 확인
  // ================================================================
  console.log('\n' + '='.repeat(70));
  console.log('TASK 9: API 키 권한/범위 확인');
  console.log('='.repeat(70));

  // Try to access various endpoints to map out what this API key can access
  console.log(`\nVendor ID: ${VENDOR_ID}`);
  console.log(`Access Key: ${ACCESS_KEY.slice(0, 8)}...`);
  console.log(`Key appears to be a UUID format = standard WING Open API key`);

  // Check seller info endpoint
  await new Promise(r => setTimeout(r, 1500));
  console.log('\n[9a] Seller/Vendor info endpoint:');
  const sellerPath = `/v2/providers/openapi/apis/api/v4/vendors/${VENDOR_ID}/seller-info`;
  const sellerResp = await coupangRawRequest('GET', sellerPath);
  console.log(`  Status: ${sellerResp.response.status}`);
  console.log(`  Body: ${JSON.stringify(sellerResp.response.body).slice(0, 500)}`);

  await new Promise(r => setTimeout(r, 1500));

  // Check product list endpoint to see if HEEDA products are visible
  console.log('\n[9b] Product list (to verify HEEDA products visible):');
  const productPath = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products`;
  const productResp = await coupangRawRequest('GET', productPath, {
    vendorId: VENDOR_ID,
    maxPerPage: '10',
    status: 'APPROVED',
  });
  console.log(`  Status: ${productResp.response.status}`);
  const products = productResp.response.body?.data || [];
  if (Array.isArray(products)) {
    for (const p of products.slice(0, 10)) {
      console.log(`  Product: ${(p.displayProductName || p.productName || JSON.stringify(p)).slice(0, 80)}`);
    }
  } else {
    console.log(`  Body: ${JSON.stringify(productResp.response.body).slice(0, 500)}`);
  }

  await new Promise(r => setTimeout(r, 1500));

  // Try Rocket Growth specific endpoints
  console.log('\n[9c] Rocket Growth return management (to test RG API access):');
  const rgPath = `/v2/providers/openapi/apis/api/v1/vendors/${VENDOR_ID}/rocket-growth/returns`;
  const rgResp = await coupangRawRequest('GET', rgPath, {
    createdAtFrom: '2026-08-01T00:00+09:00',
    createdAtTo: '2026-08-31T23:59+09:00',
  });
  console.log(`  Status: ${rgResp.response.status}`);
  console.log(`  Body: ${JSON.stringify(rgResp.response.body).slice(0, 500)}`);

  await new Promise(r => setTimeout(r, 1500));

  // Try ordersheets to see HEEDA orders
  console.log('\n[9d] Ordersheets — check if HEEDA orders show different status:');
  const osPath = `/v2/providers/openapi/apis/api/v5/vendors/${VENDOR_ID}/ordersheets`;
  // Try recent date with various statuses to see if RG uses different status values
  for (const status of ['ACCEPT', 'INSTRUCT', 'DEPARTURE', 'DELIVERING', 'FINAL_DELIVERY']) {
    await new Promise(r => setTimeout(r, 1000));
    const osResp = await coupangRawRequest('GET', osPath, {
      createdAtFrom: '2026-08-25T00:00+09:00',
      createdAtTo: '2026-08-25T23:59+09:00',
      status,
      maxPerPage: '10',
    });
    const osOrders = osResp.response.body?.data || [];
    console.log(`  Status=${status}: ${osOrders.length} orders`);
    for (const o of osOrders.slice(0, 3)) {
      const vid = o.vendorItemId || o.items?.[0]?.vendorItemId || 'N/A';
      const pn = o.vendorItemName || o.items?.[0]?.vendorItemName || '';
      console.log(`    orderId: ${o.orderId}, VID: ${vid}, ${pn.slice(0, 40)}, deliveryCompanyCode: ${o.deliveryCompanyCode || 'N/A'}, shipmentType: ${o.shipmentType || 'N/A'}`);
    }
  }

  // ================================================================
  // TASK 3 (partial): Check fulfillment type from response fields
  // ================================================================
  console.log('\n' + '='.repeat(70));
  console.log('TASK 3 (from API): Fulfillment/delivery type 확인');
  console.log('='.repeat(70));

  // Look at the SUPERLABS items in revenue-history to see their delivery/fulfillment fields
  const augResult = await coupangRawRequest('GET', revPath, {
    vendorId: VENDOR_ID,
    recognitionDateFrom: '2026-08-01',
    recognitionDateTo: '2026-08-31',
    token: '',
    maxPerPage: '100',
  });
  const augAllOrders = augResult.response.body?.data || [];

  console.log('\nAll items in Aug with delivery-related fields:');
  for (const order of augAllOrders) {
    for (const item of (order.items || [])) {
      const brand = isHeeda(item.vendorItemId, item.productName) ? 'HEEDA' : 'SUPERLABS';
      // Print ALL keys from order and item to find fulfillment hints
      console.log(`  ${brand} | VID: ${item.vendorItemId}`);
      console.log(`    ORDER keys: ${Object.keys(order).join(', ')}`);
      console.log(`    ITEM keys: ${Object.keys(item).join(', ')}`);
      // Print specific delivery-related values
      for (const k of Object.keys(order)) {
        if (k.toLowerCase().includes('delivery') || k.toLowerCase().includes('ship') ||
            k.toLowerCase().includes('fulfil') || k.toLowerCase().includes('rocket') ||
            k.toLowerCase().includes('growth') || k.toLowerCase().includes('type')) {
          console.log(`    order.${k} = ${JSON.stringify(order[k])}`);
        }
      }
      for (const k of Object.keys(item)) {
        if (k.toLowerCase().includes('delivery') || k.toLowerCase().includes('ship') ||
            k.toLowerCase().includes('fulfil') || k.toLowerCase().includes('rocket') ||
            k.toLowerCase().includes('growth') || k.toLowerCase().includes('type')) {
          console.log(`    item.${k} = ${JSON.stringify(item[k])}`);
        }
      }
    }
  }

  // ================================================================
  // Save all output
  // ================================================================
  const outputPath = path.resolve(import.meta.dirname, 'investigate-output.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nOutput saved to: ${outputPath}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
