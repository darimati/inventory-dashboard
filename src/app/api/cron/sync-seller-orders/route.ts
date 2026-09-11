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

function detectBrand(productName: string): string {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('희다') || lower.includes('heeda') ||
      lower.includes('클렌징밤') || lower.includes('클렌징 밤') ||
      lower.includes('클렌징폼') || lower.includes('클렌징 폼') ||
      lower.includes('폼클렌징') || lower.includes('세럼')) return 'HEEDA';
  if (lower.includes('슈퍼맨스') || lower.includes('superlabs') ||
      lower.includes('supermans')) return 'SUPERLABS';
  return 'OTHER';
}

/* ------------------------------------------------------------------ */
/*  Fetch seller-shipped revenue history with pagination               */
/* ------------------------------------------------------------------ */

interface RevenueItem {
  orderId: string;
  vendorItemId: string;
  vendorItemName?: string;
  productName?: string;
  salePrice: number;
  settlementAmount: number;
  coupangDiscountCoupon?: number;
  cancelPrice?: number;
  recognitionDate?: string;
  quantity?: number;
}

async function fetchRevenueHistory(dateFrom: string, dateTo: string): Promise<RevenueItem[]> {
  const apiPath = `/v2/providers/openapi/apis/api/v1/revenue-history`;
  const allItems: RevenueItem[] = [];
  let token = '';

  while (true) {
    const query: Record<string, string> = {
      vendorId: VENDOR_ID,
      recognitionDateFrom: dateFrom,
      recognitionDateTo: dateTo,
      maxPerPage: '50',
      token: token,  // Required even on first page (empty string)
    };

    const resp = await coupangGet(apiPath, query);
    const data = resp.data || [];

    // Revenue History can return flat items or nested order→items
    for (const entry of data) {
      if (entry.items && Array.isArray(entry.items)) {
        // Nested: { orderId, items: [...] }
        for (const item of entry.items) {
          allItems.push({
            orderId: String(entry.orderId),
            vendorItemId: String(item.vendorItemId),
            vendorItemName: item.vendorItemName || item.productName || '',
            productName: item.productName || item.vendorItemName || '',
            salePrice: Number(item.salePrice) || 0,
            settlementAmount: Number(item.settlementAmount) || 0,
            coupangDiscountCoupon: Number(item.coupangDiscountCoupon) || 0,
            cancelPrice: Number(item.cancelPrice) || 0,
            recognitionDate: item.recognitionDate || entry.recognitionDate || '',
            quantity: Number(item.quantity) || 1,
          });
        }
      } else {
        // Flat item
        allItems.push({
          orderId: String(entry.orderId),
          vendorItemId: String(entry.vendorItemId),
          vendorItemName: entry.vendorItemName || entry.productName || '',
          productName: entry.productName || entry.vendorItemName || '',
          salePrice: Number(entry.salePrice) || 0,
          settlementAmount: Number(entry.settlementAmount) || 0,
          coupangDiscountCoupon: Number(entry.coupangDiscountCoupon) || 0,
          cancelPrice: Number(entry.cancelPrice) || 0,
          recognitionDate: entry.recognitionDate || '',
          quantity: Number(entry.quantity) || 1,
        });
      }
    }

    if (!resp.nextToken || data.length === 0) break;
    token = resp.nextToken;
    await new Promise(r => setTimeout(r, 300));
  }

  return allItems;
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

function revenueToRows(items: RevenueItem[], triggerType: string): SalesRow[] {
  return items.map(item => {
    const productName = item.productName || item.vendorItemName || '';
    const isCancellation = (item.cancelPrice ?? 0) > 0 && item.salePrice === 0;

    return {
      order_id: item.orderId,
      vendor_item_id: item.vendorItemId,
      sale_type: isCancellation ? 'CANCEL' : 'SALE',
      sale_date: item.recognitionDate || new Date().toISOString().slice(0, 10),
      brand: detectBrand(productName),
      country: 'KR',
      sale_amount: isCancellation ? -(item.cancelPrice ?? 0) : item.salePrice,
      quantity: item.quantity ?? 1,
      settlement_amount: item.settlementAmount,
      product_name: productName,
      raw_payload: {
        source: 'revenue_history_api',
        synced_by: triggerType,
        fulfillment: 'SELLER_SHIPPED',
        coupangDiscountCoupon: item.coupangDiscountCoupon,
        cancelPrice: item.cancelPrice,
        recognitionDate: item.recognitionDate,
      },
      updated_at: new Date().toISOString(),
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Core sync logic                                                    */
/* ------------------------------------------------------------------ */

async function runSync(triggerType: 'cron' | 'manual') {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  );

  const { data: logRow } = await supabase
    .from('sync_logs')
    .insert({ trigger_type: `seller_${triggerType}`, status: 'running' })
    .select('id')
    .single();
  const logId = logRow?.id;

  try {
    // Sync last 7 days (recognition dates)
    // Coupang API: dateTo must be <= yesterday
    const now = new Date();
    const toDate = new Date(now);
    toDate.setDate(toDate.getDate() - 1);
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - 7);

    const fmt = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const dateFrom = fmt(fromDate);
    const dateTo = fmt(toDate);

    const items = await fetchRevenueHistory(dateFrom, dateTo);
    const rows = revenueToRows(items, triggerType);

    if (rows.length === 0) {
      if (logId) {
        await supabase.from('sync_logs').update({
          status: 'success',
          finished_at: new Date().toISOString(),
          fetched_count: 0,
          inserted_count: 0,
        }).eq('id', logId);
      }

      return {
        ok: true,
        message: 'No seller-shipped revenue data found',
        period: { from: dateFrom, to: dateTo },
        totalItems: 0,
        inserted: 0,
        syncedAt: new Date().toISOString(),
      };
    }

    // Upsert into sales_coupang
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error } = await supabase
        .from('sales_coupang')
        .upsert(batch, {
          onConflict: 'order_id,vendor_item_id,sale_type',
          ignoreDuplicates: false,
        });

      if (error) {
        console.error(`[sync-seller-orders] Upsert batch error:`, error.message);
      } else {
        inserted += batch.length;
      }
    }

    if (logId) {
      await supabase.from('sync_logs').update({
        status: 'success',
        finished_at: new Date().toISOString(),
        fetched_count: items.length,
        inserted_count: inserted,
      }).eq('id', logId);
    }

    // Summarize by brand
    const brandSummary: Record<string, number> = {};
    for (const r of rows) {
      brandSummary[r.brand] = (brandSummary[r.brand] || 0) + 1;
    }

    return {
      ok: true,
      period: { from: dateFrom, to: dateTo },
      totalItems: items.length,
      inserted,
      brandSummary,
      syncedAt: new Date().toISOString(),
    };
  } catch (err) {
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

export async function GET(request: NextRequest) {
  const authHeaderValue = request.headers.get('authorization');
  if (CRON_SECRET && authHeaderValue !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runSync('cron');
    return NextResponse.json(result);
  } catch (err) {
    console.error('[sync-seller-orders] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function POST() {
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
    console.error('[sync-seller-orders] Manual sync error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
