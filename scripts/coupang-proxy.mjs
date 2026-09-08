#!/usr/bin/env node
/**
 * Coupang API Forward Proxy
 *
 * Vercel 서버리스 함수의 아웃바운드 IP가 매번 바뀌어서
 * 쿠팡 Open API IP 화이트리스트에 등록할 수 없는 문제를 해결한다.
 *
 * 이 프록시를 고정 IP 서버에서 실행하고, 해당 IP를 쿠팡에 등록하면
 * Vercel → 프록시 → 쿠팡 경로로 안정적으로 API 호출이 가능하다.
 *
 * 환경변수:
 *   PROXY_PORT  (default: 7870)
 *   PROXY_KEY   — Vercel에서 보내는 인증 키 (필수)
 *
 * 실행:
 *   PROXY_KEY=my-secret node scripts/coupang-proxy.mjs
 *
 * Vercel 환경변수:
 *   COUPANG_PROXY_URL=http://<이 서버 IP>:7870
 *   COUPANG_PROXY_KEY=my-secret
 */

import http from 'node:http';

const PORT = parseInt(process.env.PROXY_PORT || '7870', 10);
const PROXY_KEY = process.env.PROXY_KEY || '';

if (!PROXY_KEY) {
  console.error('[coupang-proxy] PROXY_KEY is required');
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Key' });
    res.end();
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }));
    return;
  }

  // Only POST /forward
  if (req.method !== 'POST' || !req.url?.startsWith('/forward')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  // Auth check
  const authKey = req.headers['x-proxy-key'];
  if (authKey !== PROXY_KEY) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  // Read body
  let body = '';
  for await (const chunk of req) body += chunk;

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  const { url, method = 'GET', headers = {} } = payload;

  if (!url || !url.startsWith('https://api-gateway.coupang.com')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Only api-gateway.coupang.com URLs allowed' }));
    return;
  }

  try {
    console.log(`[proxy] ${method} ${url}`);
    const upstream = await fetch(url, { method, headers });
    const data = await upstream.text();

    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
    });
    res.end(data);
  } catch (err) {
    console.error(`[proxy] Error:`, err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Upstream error', message: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`[coupang-proxy] Listening on port ${PORT}`);
  console.log(`[coupang-proxy] POST /forward — forward requests to Coupang API`);
  console.log(`[coupang-proxy] GET  /health  — health check`);
});
