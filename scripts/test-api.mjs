import crypto from 'node:crypto';
import fs from 'node:fs';

// Parse .env.local manually
const envContent = fs.readFileSync('.env.local', 'utf8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

const VENDOR_ID = process.env.COUPANG_VENDOR_ID;
const ACCESS_KEY = process.env.COUPANG_ACCESS_KEY;
const SECRET_KEY = process.env.COUPANG_SECRET_KEY;

if (!ACCESS_KEY || !SECRET_KEY) { console.log('Missing credentials'); process.exit(1); }

const now = new Date();
const y = String(now.getUTCFullYear()).slice(2);
const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
const d = String(now.getUTCDate()).padStart(2, '0');
const h = String(now.getUTCHours()).padStart(2, '0');
const mi = String(now.getUTCMinutes()).padStart(2, '0');
const s = String(now.getUTCSeconds()).padStart(2, '0');
const sd = `${y}${mo}${d}T${h}${mi}${s}Z`;

const apiPath = `/v2/providers/rg_open_api/apis/api/v1/vendors/${VENDOR_ID}/rg/inventory/summaries`;
const message = sd + 'GET' + apiPath;
const signature = crypto.createHmac('sha256', SECRET_KEY).update(message).digest('hex');
const auth = `CEA algorithm=HmacSHA256, access-key=${ACCESS_KEY}, signed-date=${sd}, signature=${signature}`;

console.log('Testing from IP: calling Coupang API...');
const resp = await fetch(`https://api-gateway.coupang.com${apiPath}`, {
  headers: { 'Content-type': 'application/json;charset=UTF-8', Authorization: auth }
});
console.log('Status:', resp.status);
const text = await resp.text();
console.log(text.slice(0, 600));
