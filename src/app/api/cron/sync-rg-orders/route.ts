import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const VENDOR_ID = process.env.COUPANG_VENDOR_ID!;
const ACCESS_KEY = process.env.COUPANG_ACCESS_KEY!;
const SECRET_KEY = process.env.COUPANG_SECRET_KEY!;
const BASE_URL = 'https://api-gateway.coupang.com';
const CRON_SECRET = process.env.CRON_SECRET || '';

const HEEDA_VIDS = new Set([
  '90554556327', '90621781347', '94426583769',
  '93924698351', '93924698352', '91329716230',
  '91007861343', '92197095172', '91007763848',
  '93943745189', '91541164600', '93943745188', '91541180389',
  '93993063704',
  // RG Inventory 추가 확인분
  '91329549543', '94749674229', '92815810724', '94159094137',
]);

/* ------------------------------------------------------------------ */
/*  HMAC Auth                                                          */
/* ------------------------------------------------------------------ */

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

function authHeader(method: string, apiPath: string, queryString = '') {
  const sd = signedDateUTC();
  const message = sd + method + apiPath + queryString;
  const signature = crypto.createHmac('sha256', SECRET_KEY).update(message).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${ACCESS_KEY}, signed-date=${sd}, signature=${signature}`;
}

const PROXY_URL = process.env.COUPANG_PROXY_URL || '';
const PROXY_KEY = process.env.COUPANG_PROXY_KEY || '';

async function coupangGet(apiPath: string, query: Record<string, string> = {}) {
  const qs = new URLSearchParams(query).toString();
  const url = `${BASE_URL}${apiPath}${qs ? '?' + qs : ''}`;
  const auth = authHeader('GET', apiPath, qs);
  const reqHeaders = { 'Content-type': 'application/json;charset=UTF-8', Authorization: auth };

  let resp: Response;
  if (PROXY_URL) {
    resp = await fetch(`${PROXY_URL}/forward`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Proxy-Key': PROXY_KEY },
      body: JSON.stringify({ url, method: 'GET', headers: reqHeaders }),
    });
  } else {
    resp = await fetch(url, { method: 'GET', headers: reqHeaders });
  }

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${body.slice(0, 300)}`);
  }
  return resp.json();
}

/* ------------------------------------------------------------------ */
/*  Brand detection                                                    */
/* ------------------------------------------------------------------ */

function detectBrand(vendorItemId: string, productName: string): string {
  if (HEEDA_VIDS.has(String(vendorItemId))) return 'HEEDA';
  const lower = (productName || '').toLowerCase();
  if (lower.includes('희다') || lower.includes('heeda') ||
      lower.includes('클렌징밤') || lower.includes('클렌징 밤') ||
      lower.includes('클렌징폼') || lower.includes('클렌징 폼') ||
      lower.includes('폼클렌징') || lower.includes('세럼')) return 'HEEDA';
  return 'OTHER';
}

/* ------------------------------------------------------------------ */
/*  Fetch RG orders with pagination                                    */
/* ------------------------------------------------------------------ */

interface RGOrderItem {
  vendorItemId: string;
  productName: string;
  unitSalesPrice: string;
  salesQuantity: number;
  currency: string;
}

interface RGOrder {
  vendorId: string;
  orderId: number;
  orderedAt?: number;
  paidAt: number;
  orderItems: RGOrderItem[];
}

async function fetchRGOrders(dateFrom: string, dateTo: string): Promise<RGOrder[]> {
  const apiPath = `/v2/providers/rg_open_api/apis/api/v1/vendors/${VENDOR_ID}/rg/orders`;
  const allOrders: RGOrder[] = [];
  let nextToken = '';

  while (true) {
    const query: Record<string, string> = { paidDateFrom: dateFrom, paidDateTo: dateTo };
    if (nextToken) query.nextToken = nextToken;

    const resp = await coupangGet(apiPath, query);
    const orders: RGOrder[] = resp.data || [];
    allOrders.push(...orders);

    if (!resp.nextToken || orders.length === 0) break;
    nextToken = resp.nextToken;
    await new Promise(r => setTimeout(r, 300));
  }

  return allOrders;
}

/* ------------------------------------------------------------------ */
/*  Convert to DB rows                                                 */
/* ------------------------------------------------------------------ */

interface SalesRow {
  order_id: string;
  vendor_item_id: string;
  sale_type: string;
  sale_date: string;
  brand: string;
  country: string;
  sale_amount: number;
  quantity: number;
  settlement_amount: number;
  product_name: string;
  raw_payload: Record<string, unknown>;
  updated_at: string;
}

function rgOrderToRows(order: RGOrder, triggerType: string): SalesRow[] {
  const rows: SalesRow[] = [];
  // Use orderedAt (order date) if available, fallback to paidAt (payment date)
  // Coupang BI uses orderedAt basis — we must match it
  const dateTs = order.orderedAt ?? order.paidAt;
  const kstDate = new Date(dateTs + 9 * 3_600_000);
  const saleDate = kstDate.toISOString().slice(0, 10);
  const paidKstDate = new Date(order.paidAt + 9 * 3_600_000).toISOString().slice(0, 10);

  for (const item of (order.orderItems || [])) {
    const unitPrice = parseFloat(item.unitSalesPrice) || 0;
    const qty = Number(item.salesQuantity) || 1;

    rows.push({
      order_id: String(order.orderId),
      vendor_item_id: String(item.vendorItemId),
      sale_type: 'SALE',
      sale_date: saleDate,
      brand: detectBrand(String(item.vendorItemId), item.productName),
      country: 'KR',
      sale_amount: unitPrice * qty,
      quantity: qty,
      settlement_amount: 0,
      product_name: item.productName || '',
      raw_payload: {
        source: 'rg_order_api',
        synced_by: triggerType,
        item: {
          vendorItemId: item.vendorItemId,
          productName: item.productName,
          unitSalesPrice: item.unitSalesPrice,
          salesQuantity: item.salesQuantity,
          currency: item.currency,
        },
        order: {
          orderId: order.orderId,
          vendorId: order.vendorId,
          orderedAt: order.orderedAt,
          paidAt: order.paidAt,
          orderedDateKST: saleDate,
          paidDateKST: paidKstDate,
        },
      },
      updated_at: new Date().toISOString(),
    });
  }

  return rows;
}

/* ------------------------------------------------------------------ */
/*  Seller Orders (ordersheets) — captures seller-fulfilled orders     */
/*  that don't appear in the RG API but DO appear in Coupang BI        */
/* ------------------------------------------------------------------ */

interface SellerOrderItem {
  vendorItemId: string;
  sellerProductName: string;
  orderPrice: string;
  shippingCount: number;
  canceled: boolean;
  cancelCount: number;
}

interface SellerOrder {
  orderId: number;
  orderedAt: string; // KST datetime string e.g. "2026-09-04T16:30:29"
  paidAt: string;
  status: string;
  orderItems: SellerOrderItem[];
}

async function fetchSellerOrders(dateFrom: string, dateTo: string): Promise<SellerOrder[]> {
  const apiPath = `/v2/providers/openapi/apis/api/v4/vendors/${process.env.COUPANG_VENDOR_ID}/ordersheets`;
  const statuses = ['ACCEPT', 'INSTRUCT', 'DEPARTURE', 'FINAL_DELIVERY'];
  const seen = new Set<string>();
  const allOrders: SellerOrder[] = [];

  for (const status of statuses) {
    let nextToken = '';
    while (true) {
      const query: Record<string, string> = {
        createdAtFrom: dateFrom,
        createdAtTo: dateTo,
        status,
        maxPerPage: '50',
      };
      if (nextToken) query.nextToken = nextToken;

      const resp = await coupangGet(apiPath, query);
      const orders: SellerOrder[] = resp.data || [];
      for (const o of orders) {
        const key = String(o.orderId);
        if (!seen.has(key)) {
          seen.add(key);
          allOrders.push({ ...o, status });
        }
      }

      if (!resp.nextToken || orders.length === 0) break;
      nextToken = resp.nextToken;
      await new Promise(r => setTimeout(r, 300));
    }
    await new Promise(r => setTimeout(r, 300));
  }

  return allOrders;
}

function sellerOrderToRows(order: SellerOrder, triggerType: string): SalesRow[] {
  const rows: SalesRow[] = [];
  // Use orderedAt (KST string) for sale_date — matches Coupang BI basis
  const saleDate = order.orderedAt ? order.orderedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);

  for (const item of (order.orderItems || [])) {
    if (item.canceled) continue;
    const unitPrice = parseFloat(item.orderPrice) || 0;
    const qty = Number(item.shippingCount) || 1;

    rows.push({
      order_id: String(order.orderId),
      vendor_item_id: String(item.vendorItemId),
      sale_type: 'SALE',
      sale_date: saleDate,
      brand: detectBrand(String(item.vendorItemId), item.sellerProductName),
      country: 'KR',
      sale_amount: unitPrice * qty,
      quantity: qty,
      settlement_amount: 0,
      product_name: item.sellerProductName || '',
      raw_payload: {
        source: 'seller_order_api',
        synced_by: triggerType,
        item: {
          vendorItemId: item.vendorItemId,
          sellerProductName: item.sellerProductName,
          orderPrice: item.orderPrice,
          shippingCount: item.shippingCount,
        },
        order: {
          orderId: order.orderId,
          orderedAt: order.orderedAt,
          paidAt: order.paidAt,
          status: order.status,
        },
      },
      updated_at: new Date().toISOString(),
    });
  }

  return rows;
}

/* ------------------------------------------------------------------ */
/*  Core sync logic                                                    */
/* ------------------------------------------------------------------ */

async function runSync(triggerType: 'cron' | 'manual') {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  );

  // Create sync_logs entry
  const { data: logRow } = await supabase
    .from('sync_logs')
    .insert({ platform: 'coupang', account_id: process.env.COUPANG_VENDOR_ID, date: new Date().toISOString().slice(0, 10), status: 'running', started_at: new Date().toISOString() })
    .select('id')
    .single();
  const logId = logRow?.id;

  try {
    // Sync last 7 days to ensure all orders are captured
    const nowUTC = new Date();

    const toDate = new Date(nowUTC);
    toDate.setDate(toDate.getDate() + 1);
    const fromDate = new Date(nowUTC);
    fromDate.setDate(fromDate.getDate() - 7);

    const fmtRG = (d: Date) => {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}${m}${day}`;
    };
    const fmtSeller = (d: Date) => {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const dateFrom = fmtRG(fromDate);
    const dateTo = fmtRG(toDate);

    // 1. RG Orders (Rocket Growth — warehouse-fulfilled)
    const rgOrders = await fetchRGOrders(dateFrom, dateTo);
    const rgRows = rgOrders.flatMap(o => rgOrderToRows(o, triggerType));
    const heedaRgRows = rgRows.filter(r => r.brand === 'HEEDA');

    // 2. Seller Orders (seller-fulfilled — not in RG API)
    const sellerOrders = await fetchSellerOrders(fmtSeller(fromDate), fmtSeller(toDate));
    const sellerRows = sellerOrders.flatMap(o => sellerOrderToRows(o, triggerType));
    const heedaSellerRows = sellerRows.filter(r => r.brand === 'HEEDA');

    const allHeedaRows = [...heedaRgRows, ...heedaSellerRows];

    if (allHeedaRows.length === 0) {
      if (logId) {
        await supabase.from('sync_logs').update({
          status: 'success',
          finished_at: new Date().toISOString(),
        }).eq('id', logId);
      }

      return {
        ok: true,
        message: 'No HEEDA orders found for sync period',
        period: { from: dateFrom, to: dateTo },
        rgOrders: rgOrders.length,
        sellerOrders: sellerOrders.length,
        heedaRows: 0,
        inserted: 0,
        syncedAt: new Date().toISOString(),
      };
    }

    // Upsert all HEEDA rows (both RG and seller)
    let inserted = 0;
    for (let i = 0; i < allHeedaRows.length; i += 100) {
      const batch = allHeedaRows.slice(i, i + 100);
      const { error } = await supabase
        .from('sales_coupang')
        .upsert(batch, {
          onConflict: 'order_id,vendor_item_id,sale_type',
          ignoreDuplicates: false,
        });

      if (error) {
        console.error(`[sync-rg-orders] Upsert batch error:`, error.message);
      } else {
        inserted += batch.length;
      }
    }

    // Update sync_logs
    if (logId) {
      await supabase.from('sync_logs').update({
        status: 'success',
        finished_at: new Date().toISOString(),
      }).eq('id', logId);
    }

    return {
      ok: true,
      period: { from: dateFrom, to: dateTo },
      rgOrders: rgOrders.length,
      sellerOrders: sellerOrders.length,
      heedaRgRows: heedaRgRows.length,
      heedaSellerRows: heedaSellerRows.length,
      inserted,
      syncedAt: new Date().toISOString(),
    };
  } catch (err) {
    // Update sync_logs with error
    if (logId) {
      await supabase.from('sync_logs').update({
        status: 'error',
        finished_at: new Date().toISOString(),
        error_message: err instanceof Error ? err.message : 'Unknown error',
      }).eq('id', logId);
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/*  Route handlers                                                     */
/* ------------------------------------------------------------------ */

// GET: Vercel cron trigger
export async function GET(request: NextRequest) {
  const authHeaderValue = request.headers.get('authorization');
  if (CRON_SECRET && authHeaderValue !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runSync('cron');
    return NextResponse.json(result);
  } catch (err) {
    console.error('[sync-rg-orders] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

// POST: Manual trigger from dashboard
export async function POST(request: NextRequest) {
  // Rate limit: check last sync_logs entry within 60 seconds
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  );

  const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString();
  const { data: recentSync } = await supabase
    .from('sync_logs')
    .select('id, started_at')
    .gte('started_at', sixtySecondsAgo)
    .order('started_at', { ascending: false })
    .limit(1);

  if (recentSync && recentSync.length > 0) {
    const lastStart = new Date(recentSync[0].started_at).getTime();
    const cooldownRemaining = Math.ceil((60_000 - (Date.now() - lastStart)) / 1000);
    return NextResponse.json(
      { error: 'cooldown', remainingSeconds: cooldownRemaining },
      { status: 429 },
    );
  }

  try {
    const result = await runSync('manual');
    return NextResponse.json(result);
  } catch (err) {
    console.error('[sync-rg-orders] Manual sync error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
