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

function detectBrand(vendorItemId: string): string {
  return HEEDA_VIDS.has(String(vendorItemId)) ? 'HEEDA' : 'OTHER';
}

/* ------------------------------------------------------------------ */
/*  Core inventory sync logic                                          */
/* ------------------------------------------------------------------ */

async function runInventorySync(triggerType: 'cron' | 'manual') {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  );

  // Create sync_logs entry
  const { data: logRow } = await supabase
    .from('sync_logs')
    .insert({ trigger_type: triggerType, status: 'running' })
    .select('id')
    .single();
  const logId = logRow?.id;

  try {
    // Fetch RG Inventory summaries
    const apiPath = `/v2/providers/rg_open_api/apis/api/v1/vendors/${VENDOR_ID}/rg/inventory/summaries`;
    const resp = await coupangGet(apiPath);
    const items = resp.data || [];

    const now = new Date().toISOString();
    const rows = items
      .filter((item: any) => HEEDA_VIDS.has(String(item.vendorItemId)))
      .map((item: any) => ({
        vendor_id: VENDOR_ID,
        vendor_item_id: String(item.vendorItemId),
        brand: detectBrand(String(item.vendorItemId)),
        country: 'KR',
        total_orderable_quantity: item.inventoryDetails?.totalOrderableQuantity ?? item.totalOrderableQuantity ?? 0,
        sales_count_last_thirty_days: item.salesCountMap?.SALES_COUNT_LAST_THIRTY_DAYS ?? item.salesCountLastThirtyDays ?? 0,
        snapshot_at: now,
      }));

    if (rows.length === 0) {
      if (logId) {
        await supabase.from('sync_logs').update({
          status: 'success',
          finished_at: now,
          fetched_count: items.length,
          inserted_count: 0,
        }).eq('id', logId);
      }

      return {
        ok: true,
        message: 'No HEEDA inventory items found',
        totalItems: items.length,
        heedaItems: 0,
        upserted: 0,
        syncedAt: now,
      };
    }

    // Upsert on vendor_item_id
    const { error } = await supabase
      .from('inventory_coupang')
      .upsert(rows, {
        onConflict: 'vendor_item_id',
        ignoreDuplicates: false,
      });

    if (error) {
      throw new Error(`Upsert error: ${error.message}`);
    }

    if (logId) {
      await supabase.from('sync_logs').update({
        status: 'success',
        finished_at: new Date().toISOString(),
        fetched_count: items.length,
        inserted_count: rows.length,
      }).eq('id', logId);
    }

    return {
      ok: true,
      totalItems: items.length,
      heedaItems: rows.length,
      upserted: rows.length,
      syncedAt: now,
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

// GET: Vercel cron trigger
export async function GET(request: NextRequest) {
  const authHeaderValue = request.headers.get('authorization');
  if (CRON_SECRET && authHeaderValue !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runInventorySync('cron');
    return NextResponse.json(result);
  } catch (err) {
    console.error('[sync-inventory] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

// POST: Manual trigger from dashboard
export async function POST() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  );

  // Rate limit: 60-second cooldown
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
    const result = await runInventorySync('manual');
    return NextResponse.json(result);
  } catch (err) {
    console.error('[sync-inventory] Manual sync error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
