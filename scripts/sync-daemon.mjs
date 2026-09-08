#!/usr/bin/env node
/**
 * HEEDA Coupang Sync Daemon
 *
 * Runs on the local server (whitelisted IP) and syncs:
 * 1. Inventory (RG inventory summaries)
 * 2. Sales (RG orders)
 *
 * Automatic: runs every 4 hours
 * Manual: polls Supabase `sync_trigger` table for pending requests
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// Load env from .env.local
const envPath = new URL('../.env.local', import.meta.url).pathname;
const envContent = fs.readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const VENDOR_ID = process.env.COUPANG_VENDOR_ID;
const ACCESS_KEY = process.env.COUPANG_ACCESS_KEY;
const SECRET_KEY = process.env.COUPANG_SECRET_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BASE_URL = 'https://api-gateway.coupang.com';

if (!VENDOR_ID || !ACCESS_KEY || !SECRET_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[sync-daemon] Missing required env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const HEEDA_VIDS = new Set([
  '90554556327', '90621781347', '94426583769',
  '93924698351', '93924698352', '91329716230',
  '91007861343', '92197095172', '91007763848',
  '93943745189', '91541164600', '93943745188', '91541180389',
  '93993063704',
  '91329549543', '94749674229', '92815810724', '94159094137',
]);

/* ---- HMAC Auth ---- */

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
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${body.slice(0, 300)}`);
  }
  return resp.json();
}

/* ---- Logging helper ---- */
// sync_logs columns: id, platform, account_id, date, status, error_message, started_at, finished_at

async function createLog() {
  const { data } = await supabase
    .from('sync_logs')
    .insert({
      platform: 'coupang',
      account_id: VENDOR_ID,
      date: new Date().toISOString().slice(0, 10),
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  return data?.id;
}

async function updateLog(logId, status, errorMessage = null) {
  if (!logId) return;
  const update = { status, finished_at: new Date().toISOString() };
  if (errorMessage) update.error_message = errorMessage;
  await supabase.from('sync_logs').update(update).eq('id', logId);
}

/* ---- Inventory Sync ---- */

async function syncInventory(triggerType) {
  const logId = await createLog();

  try {
    const apiPath = `/v2/providers/rg_open_api/apis/api/v1/vendors/${VENDOR_ID}/rg/inventory/summaries`;
    const resp = await coupangGet(apiPath);
    const items = resp.data || [];
    const now = new Date().toISOString();

    const rows = items
      .filter(item => HEEDA_VIDS.has(String(item.vendorItemId)))
      .map(item => ({
        vendor_id: VENDOR_ID,
        vendor_item_id: String(item.vendorItemId),
        brand: 'HEEDA',
        country: 'KR',
        total_orderable_quantity: item.inventoryDetails?.totalOrderableQuantity ?? item.totalOrderableQuantity ?? 0,
        sales_count_last_thirty_days: item.salesCountMap?.SALES_COUNT_LAST_THIRTY_DAYS ?? item.salesCountLastThirtyDays ?? 0,
        raw_payload: item,
        snapshot_at: now,
      }));

    if (rows.length > 0) {
      // Delete existing HEEDA rows and re-insert (no unique constraint on vendor_item_id)
      const vids = rows.map(r => r.vendor_item_id);
      await supabase.from('inventory_coupang').delete().in('vendor_item_id', vids);
      const { error } = await supabase.from('inventory_coupang').insert(rows);
      if (error) throw new Error(`Insert error: ${error.message}`);
    }

    await updateLog(logId, 'success');
    return { ok: true, items: rows.length };
  } catch (err) {
    await updateLog(logId, 'error', err.message);
    throw err;
  }
}

/* ---- RG Orders Sync ---- */

async function syncOrders(triggerType) {
  const logId = await createLog();

  try {
    const nowUTC = new Date();
    const toDate = new Date(nowUTC); toDate.setDate(toDate.getDate() + 1);
    const fromDate = new Date(nowUTC); fromDate.setDate(fromDate.getDate() - 7);
    const fmt = d => `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;

    const apiPath = `/v2/providers/rg_open_api/apis/api/v1/vendors/${VENDOR_ID}/rg/orders`;
    const allOrders = [];
    let nextToken = '';
    while (true) {
      const query = { paidDateFrom: fmt(fromDate), paidDateTo: fmt(toDate) };
      if (nextToken) query.nextToken = nextToken;
      const resp = await coupangGet(apiPath, query);
      const orders = resp.data || [];
      allOrders.push(...orders);
      if (!resp.nextToken || orders.length === 0) break;
      nextToken = resp.nextToken;
      await new Promise(r => setTimeout(r, 300));
    }

    const heedaRows = [];
    for (const order of allOrders) {
      // Use orderedAt (order date) if available, fallback to paidAt (payment date)
      // Coupang BI uses orderedAt basis — we must match it
      const dateTs = order.orderedAt ?? order.paidAt;
      const kstDate = new Date(dateTs + 9 * 3_600_000);
      const saleDate = kstDate.toISOString().slice(0, 10);
      const paidKstDate = new Date(order.paidAt + 9 * 3_600_000).toISOString().slice(0, 10);
      for (const item of (order.orderItems || [])) {
        if (!HEEDA_VIDS.has(String(item.vendorItemId))) continue;
        const unitPrice = parseFloat(item.unitSalesPrice) || 0;
        const qty = Number(item.salesQuantity) || 1;
        heedaRows.push({
          order_id: String(order.orderId),
          vendor_item_id: String(item.vendorItemId),
          sale_type: 'SALE', sale_date: saleDate,
          brand: 'HEEDA', country: 'KR',
          sale_amount: unitPrice * qty, quantity: qty, settlement_amount: 0,
          product_name: item.productName || '',
          raw_payload: { source: 'rg_order_api', synced_by: triggerType,
            item: { vendorItemId: item.vendorItemId, productName: item.productName, unitSalesPrice: item.unitSalesPrice, salesQuantity: item.salesQuantity },
            order: { orderId: order.orderId, orderedAt: order.orderedAt, paidAt: order.paidAt, orderedDateKST: saleDate, paidDateKST: paidKstDate } },
          updated_at: new Date().toISOString(),
        });
      }
    }

    let inserted = 0;
    for (let i = 0; i < heedaRows.length; i += 100) {
      const batch = heedaRows.slice(i, i + 100);
      const { error } = await supabase.from('sales_coupang')
        .upsert(batch, { onConflict: 'order_id,vendor_item_id,sale_type', ignoreDuplicates: false });
      if (!error) inserted += batch.length;
    }

    await updateLog(logId, 'success');
    return { ok: true, orders: allOrders.length, inserted };
  } catch (err) {
    await updateLog(logId, 'error', err.message);
    throw err;
  }
}

/* ---- Full Sync ---- */

async function runFullSync(triggerType = 'daemon') {
  const ts = new Date().toISOString().slice(0, 19);
  console.log(`[${ts}] Starting ${triggerType} sync...`);

  try {
    const inv = await syncInventory(triggerType);
    console.log(`  Inventory: ${inv.items} items`);
  } catch (err) {
    console.error(`  Inventory error: ${err.message}`);
  }

  // Small delay between syncs
  await new Promise(r => setTimeout(r, 2000));

  try {
    const ord = await syncOrders(triggerType);
    console.log(`  RG Orders: ${ord.orders} fetched, ${ord.inserted} inserted`);
  } catch (err) {
    console.error(`  RG Orders error: ${err.message}`);
  }

  await new Promise(r => setTimeout(r, 2000));

  try {
    const sel = await syncSellerOrders(triggerType);
    console.log(`  Seller Orders: ${sel.orders} fetched, ${sel.inserted} inserted`);
  } catch (err) {
    console.error(`  Seller Orders error: ${err.message}`);
  }

  console.log(`[${ts}] Sync complete.`);
}

/* ---- Manual Trigger Polling ---- */
// Uses sync_logs table: dashboard inserts row with trigger_type='manual_request', status='pending'
// Daemon polls for these rows, picks them up, runs sync, updates status

async function checkManualTriggers() {
  try {
    const { data, error } = await supabase
      .from('sync_logs')
      .select('id')
      .eq('status', 'manual_request_pending')
      .order('id', { ascending: true })
      .limit(1);

    if (error || !data || data.length === 0) return;

    const logId = data[0].id;
    console.log(`[manual-trigger] Picked up request ${logId}`);

    // Mark as processing
    await supabase.from('sync_logs').update({
      status: 'running',
      started_at: new Date().toISOString(),
    }).eq('id', logId);

    await runFullSync('manual');

    // Mark the trigger row as done
    await supabase.from('sync_logs').update({
      status: 'success',
      finished_at: new Date().toISOString(),
    }).eq('id', logId);
  } catch (err) {
    console.error(`[manual-trigger] Error: ${err.message}`);
  }
}

/* ---- Seller Orders Sync ---- */
// Captures seller-fulfilled orders (not Rocket Growth).
// These appear in Coupang BI but NOT in the RG Orders API.
// Must query all statuses since orders move quickly past ACCEPT.

async function syncSellerOrders(triggerType) {
  const logId = await createLog();

  try {
    const nowUTC = new Date();
    const toDate = new Date(nowUTC); toDate.setDate(toDate.getDate() + 1);
    const fromDate = new Date(nowUTC); fromDate.setDate(fromDate.getDate() - 7);
    const fmt = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;

    const apiPath = `/v2/providers/openapi/apis/api/v4/vendors/${VENDOR_ID}/ordersheets`;
    const statuses = ['ACCEPT', 'INSTRUCT', 'DEPARTURE', 'FINAL_DELIVERY'];
    const seen = new Set(); // deduplicate by orderId_vendorItemId

    const heedaRows = [];
    for (const status of statuses) {
      let nextToken = '';
      while (true) {
        const query = {
          createdAtFrom: fmt(fromDate),
          createdAtTo: fmt(toDate),
          status,
          maxPerPage: '50',
        };
        if (nextToken) query.nextToken = nextToken;
        const resp = await coupangGet(apiPath, query);
        const orders = resp.data || [];

        for (const order of orders) {
          // Use orderedAt (KST string) for sale_date — matches Coupang BI basis
          const saleDate = order.orderedAt ? order.orderedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
          for (const item of (order.orderItems || [])) {
            if (!HEEDA_VIDS.has(String(item.vendorItemId))) continue;
            if (item.canceled) continue;
            const key = `${order.orderId}_${item.vendorItemId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const unitPrice = parseFloat(item.orderPrice) || 0;
            const qty = Number(item.shippingCount) || 1;
            heedaRows.push({
              order_id: String(order.orderId),
              vendor_item_id: String(item.vendorItemId),
              sale_type: 'SALE', sale_date: saleDate,
              brand: 'HEEDA', country: 'KR',
              sale_amount: unitPrice * qty, quantity: qty, settlement_amount: 0,
              product_name: item.sellerProductName || '',
              raw_payload: {
                source: 'seller_order_api', synced_by: triggerType,
                item: { vendorItemId: item.vendorItemId, sellerProductName: item.sellerProductName, orderPrice: item.orderPrice, shippingCount: item.shippingCount },
                order: { orderId: order.orderId, orderedAt: order.orderedAt, paidAt: order.paidAt, status },
              },
              updated_at: new Date().toISOString(),
            });
          }
        }

        if (!resp.nextToken || orders.length === 0) break;
        nextToken = resp.nextToken;
        await new Promise(r => setTimeout(r, 300));
      }
      await new Promise(r => setTimeout(r, 300));
    }

    let inserted = 0;
    for (let i = 0; i < heedaRows.length; i += 100) {
      const batch = heedaRows.slice(i, i + 100);
      const { error } = await supabase.from('sales_coupang')
        .upsert(batch, { onConflict: 'order_id,vendor_item_id,sale_type', ignoreDuplicates: false });
      if (!error) inserted += batch.length;
    }

    await updateLog(logId, 'success');
    return { ok: true, statuses: statuses.length, rows: heedaRows.length, inserted };
  } catch (err) {
    await updateLog(logId, 'error', err.message);
    throw err;
  }
}

/* ---- Main Loop ---- */

const FOUR_HOURS = 4 * 60 * 60 * 1000;
const POLL_INTERVAL = 10_000; // Check for manual triggers every 10 seconds

console.log('[sync-daemon] Starting HEEDA Coupang sync daemon');
console.log(`  Auto sync: every 4 hours`);
console.log(`  Manual trigger poll: every 10 seconds`);
console.log(`  Server IP: from whitelisted host`);

// Run initial sync
await runFullSync('daemon');

// Set up periodic auto-sync
setInterval(() => runFullSync('daemon'), FOUR_HOURS);

// Poll for manual triggers
setInterval(checkManualTriggers, POLL_INTERVAL);

// Keep alive
process.on('SIGINT', () => { console.log('\n[sync-daemon] Shutting down'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\n[sync-daemon] Shutting down'); process.exit(0); });
