#!/usr/bin/env node
/**
 * Try ordersheets API for historical FINAL_DELIVERY orders
 * to see if we can get orderPrice (actual payment) for past orders.
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
  const body = await resp.text();
  if (!resp.ok) return { error: `HTTP ${resp.status}: ${body.slice(0, 500)}` };
  try { return JSON.parse(body); } catch { return { rawText: body.slice(0, 500) }; }
}

function priceToNumber(priceObj) {
  if (!priceObj) return 0;
  if (typeof priceObj === 'number') return priceObj;
  return (Number(priceObj.units) || 0) + (Number(priceObj.nanos) || 0) / 1e9;
}

const HEEDA_VIDS = new Set([
  '90554556327', '90621781347', '94426583769',
  '93924698351', '93924698352', '91329716230',
  '91007861343', '92197095172', '91007763848',
  '93943745189', '91541164600', '93943745188', '91541180389',
  '93993063704',
]);

function isHeeda(vid, name) {
  if (HEEDA_VIDS.has(String(vid))) return true;
  const lower = (name || '').toLowerCase();
  return lower.includes('희다') || lower.includes('heeda') ||
    lower.includes('클렌징') || lower.includes('세럼');
}

async function tryOrdersheets(dateFrom, dateTo, status) {
  const apiPath = `/v2/providers/openapi/apis/api/v5/vendors/${VENDOR_ID}/ordersheets`;
  let allItems = [];
  let nextToken = '';
  let page = 0;

  while (page < 10) {
    page++;
    const query = {
      createdAtFrom: dateFrom,
      createdAtTo: dateTo,
      status: status,
      searchType: 'timeFrame',
    };
    if (nextToken) query.nextToken = nextToken;

    const resp = await coupangGet(apiPath, query);
    if (resp.error) {
      console.log(`  Error: ${resp.error.slice(0, 200)}`);
      break;
    }

    const orders = resp.data || [];
    for (const order of orders) {
      for (const item of (order.orderItems || [])) {
        if (isHeeda(item.vendorItemId, item.vendorItemName)) {
          allItems.push({
            orderId: order.orderId,
            shipmentBoxId: order.shipmentBoxId,
            vid: item.vendorItemId,
            name: (item.vendorItemName || '').slice(0, 50),
            salesPrice: priceToNumber(item.salesPrice),
            orderPrice: priceToNumber(item.orderPrice),
            orderedAt: order.orderedAt,
            paidAt: order.paidAt,
            status: order.status,
            coupangDiscount: priceToNumber(item.coupangDiscount),
            instantCoupon: priceToNumber(item.instantCouponDiscount),
            downloadCoupon: priceToNumber(item.downloadableCouponDiscount),
          });
        }
      }
    }

    console.log(`  Page ${page}: ${orders.length} orders total (${allItems.length} HEEDA items so far)`);
    nextToken = resp.nextToken || '';
    if (!nextToken || orders.length === 0) break;
    await new Promise(r => setTimeout(r, 500));
  }

  return allItems;
}

async function main() {
  // Ordersheets API requires < 1 day range. Query single day at a time.
  const statuses = ['FINAL_DELIVERY'];

  // Try recent single days
  const testDates = ['2026-08-30', '2026-08-20', '2026-08-10', '2026-06-15', '2026-05-15'];

  for (const date of testDates) {
    for (const status of statuses) {
      console.log(`\n=== ${date} — status: ${status} ===`);
      const from = `${date}T00:00+09:00`;
      const to = `${date}T23:59+09:00`;
      const items = await tryOrdersheets(from, to, status);
      console.log(`HEEDA items: ${items.length}`);
      for (const item of items.slice(0, 5)) {
        console.log(`  orderId: ${item.orderId} | VID ${item.vid} | ${item.name}`);
        console.log(`    salesPrice: ${item.salesPrice} | orderPrice: ${item.orderPrice}`);
        console.log(`    cpnDiscount: ${item.coupangDiscount} | instantCoupon: ${item.instantCoupon} | downloadCoupon: ${item.downloadCoupon}`);
      }
      await new Promise(r => setTimeout(r, 1200));
    }
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
