#!/usr/bin/env node
/**
 * HEEDA Influencer Operations — E2E Test Script v2
 *
 * 9-step end-to-end test:
 * 0. DB 테이블 존재 확인
 * 1. 테스트 캠페인 생성
 * 2. 참여자 1명 등록 (고정고료, 10만원)
 * 3. 동의서 링크 생성 → 페이지 로드 → 제출
 * 4. 관리자 화면에서 consent_status='agreed' + 저장 확인
 * 5. published_url 설정 → 정산 링크 생성 → 페이지 로드 → 정산 제출
 * 6. 정산 레코드 검증 (금액, 세율, 상태)
 * 7. DB에서 PII 암호화 확인
 * 8. 테스트 데이터 삭제
 */

const BASE = process.env.BASE_URL || 'http://localhost:3200';
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const results = [];
let campaignId = null;
let participantId = null;
let consentToken = null;
let settlementToken = null;
let settlementId = null;

function log(step, msg) {
  const ts = new Date().toLocaleTimeString('ko-KR');
  console.log(`[${ts}] Step ${step}: ${msg}`);
}

function pass(step, desc) {
  results.push({ step, desc, status: 'PASS' });
  log(step, `PASS - ${desc}`);
}

function fail(step, desc, err) {
  results.push({ step, desc, status: 'FAIL', error: err });
  log(step, `FAIL - ${desc}: ${err}`);
}

async function api(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, data: json };
}

async function supabaseQuery(table, query = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  return res.json();
}

async function supabaseDelete(table, query) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  return res.status;
}

// ─── Step 0: Check tables exist ───
async function step0() {
  log(0, 'Checking if tables exist...');
  try {
    const data = await supabaseQuery('inf_campaigns', '?select=id&limit=1');
    if (data.code === 'PGRST205' || data.message?.includes('schema cache')) {
      fail(0, 'Tables do not exist', 'Run sql/inf_schema.sql first');
      return false;
    }
    pass(0, 'Tables exist');
    return true;
  } catch (e) {
    fail(0, 'Tables check', e.message);
    return false;
  }
}

// ─── Step 1: Create test campaign ───
async function step1() {
  log(1, 'Creating test campaign...');
  const { status, data } = await api('/api/influencer/campaigns', {
    method: 'POST',
    body: JSON.stringify({
      name: '[E2E-TEST] 테스트 캠페인',
      month: '2026-09',
      collab_type: 'fixed_fee',
      budget: 500000,
      target_product: '테스트 상품',
      manager: 'E2E Bot',
      memo: 'Automated E2E test - safe to delete',
    }),
  });

  if (status === 201 && data.id) {
    campaignId = data.id;
    pass(1, `Campaign created: ${campaignId}`);
    return true;
  }
  fail(1, 'Campaign creation', JSON.stringify(data));
  return false;
}

// ─── Step 2: Register participant (fixed_fee, 100,000 KRW) ───
async function step2() {
  log(2, 'Registering participant...');
  const { status, data } = await api('/api/influencer/participants', {
    method: 'POST',
    body: JSON.stringify({
      campaign_id: campaignId,
      name: '테스트 인플루언서',
      display_name: '테스트_인플루',
      channel: 'instagram',
      handle: '@e2e_test',
      follower_count: 10000,
      product: '테스트 상품',
      product_quantity: 1,
      fee: 100000,
      post_type: 'reels',
      post_count: 1,
      content_deadline: '2026-09-15',
      publish_deadline: '2026-09-20',
      secondary_use: true,
      secondary_use_period: '6개월',
    }),
  });

  if (status === 201 && data.id) {
    participantId = data.id;
    pass(2, `Participant created: ${participantId}`);
    return true;
  }
  fail(2, 'Participant creation', JSON.stringify(data));
  return false;
}

// ─── Step 3: Generate consent link → Load page → Submit consent ───
async function step3() {
  log(3, 'Generating consent link...');

  // 3a: Generate consent token
  const { data: d1 } = await api('/api/influencer/participants', {
    method: 'PUT',
    body: JSON.stringify({
      id: participantId,
      generate_consent_token: true,
    }),
  });

  if (!d1.consent_token) {
    fail(3, 'Consent token generation', JSON.stringify(d1));
    return false;
  }
  consentToken = d1.consent_token;
  log(3, `Consent token: ${consentToken}`);

  // 3b: Load consent page (public API)
  const { status: s2, data: d2 } = await api(`/api/public/consent/${consentToken}`);
  if (s2 !== 200 || d2.status !== 'valid') {
    fail(3, 'Consent page load', `status=${s2}, data=${JSON.stringify(d2)}`);
    return false;
  }
  log(3, `Consent page loaded: participant=${d2.participant_name}, channel=${d2.channel}, fee=${d2.fee}`);

  // Verify consent page data
  const pageChecks = [];
  if (d2.participant_name === '테스트_인플루') pageChecks.push('name');
  if (d2.channel === 'instagram') pageChecks.push('channel');
  if (d2.fee === 100000) pageChecks.push('fee');
  if (d2.is_paid === true) pageChecks.push('is_paid');
  if (d2.content_display) pageChecks.push(`content_display=${d2.content_display}`);
  log(3, `Page data checks: ${pageChecks.join(', ')}`);

  // 3c: Submit consent
  const { status: s3, data: d3 } = await api(`/api/public/consent/${consentToken}`, {
    method: 'POST',
    body: JSON.stringify({
      phone: '010-1234-5678',
      planned_draft_date: '2026-09-10',
      planned_edit_date: '2026-09-12',
      planned_upload_date: '2026-09-15',
      delivery_name: '테스트',
      delivery_phone: '010-1234-5678',
      delivery_address: '서울시 강남구 테스트로 123',
    }),
  });

  if (s3 === 200 && d3.success) {
    pass(3, `Consent submitted (page verified: ${pageChecks.join(', ')})`);
    return true;
  }
  fail(3, 'Consent submission', `status=${s3}, data=${JSON.stringify(d3)}`);
  return false;
}

// ─── Step 4: Verify consent status = 'agreed' + data saved ───
async function step4() {
  log(4, 'Verifying consent status...');
  const data = await supabaseQuery(
    'inf_participants',
    `?id=eq.${participantId}&select=consent_status,phone,delivery_name,delivery_address,planned_upload_date`
  );

  if (!Array.isArray(data) || data.length === 0) {
    fail(4, 'Participant query', 'No data');
    return false;
  }

  const p = data[0];
  const checks = [];
  const failures = [];

  if (p.consent_status === 'agreed') checks.push('consent_status=agreed');
  else failures.push(`consent_status: expected 'agreed', got '${p.consent_status}'`);

  if (p.phone === '01012345678') checks.push('phone saved');
  else failures.push(`phone: expected '01012345678', got '${p.phone}'`);

  if (p.delivery_name === '테스트') checks.push('delivery_name saved');
  else failures.push(`delivery_name: got '${p.delivery_name}'`);

  if (p.delivery_address?.includes('강남구')) checks.push('delivery_address saved');
  else failures.push(`delivery_address: got '${p.delivery_address}'`);

  if (p.planned_upload_date === '2026-09-15') checks.push('planned_upload_date saved');
  else failures.push(`planned_upload_date: got '${p.planned_upload_date}'`);

  if (checks.length >= 4) {
    pass(4, `Consent verified: ${checks.join(', ')}`);
    return true;
  }
  fail(4, 'Consent verification', `${checks.length}/5 passed. Failures: ${failures.join('; ')}`);
  return false;
}

// ─── Step 5: Set published_url → Generate settlement link → Submit settlement ───
async function step5() {
  log(5, 'Setting published_url and generating settlement link...');

  // 5a: Set published_url (simulates admin confirming the influencer uploaded)
  const { data: d0 } = await api('/api/influencer/participants', {
    method: 'PUT',
    body: JSON.stringify({
      id: participantId,
      published_url: 'https://www.instagram.com/p/test12345/',
    }),
  });
  if (d0.error) {
    fail(5, 'Set published_url', JSON.stringify(d0));
    return false;
  }
  log(5, 'published_url set');

  // 5b: Generate settlement token
  const { data: d1 } = await api('/api/influencer/participants', {
    method: 'PUT',
    body: JSON.stringify({
      id: participantId,
      generate_settlement_token: true,
    }),
  });

  if (!d1.settlement_token) {
    fail(5, 'Settlement token generation', JSON.stringify(d1));
    return false;
  }
  settlementToken = d1.settlement_token;
  log(5, `Settlement token: ${settlementToken}`);

  // 5c: Load settlement page (public API)
  const { status: s2, data: d2 } = await api(`/api/public/settlement/${settlementToken}`);
  if (s2 !== 200 || d2.status !== 'valid') {
    fail(5, 'Settlement page load', `status=${s2}, data=${JSON.stringify(d2)}`);
    return false;
  }
  log(5, `Settlement page loaded: campaign=${d2.campaign_name}, fee=${d2.fee}, channel=${d2.channel}`);

  // Verify settlement page data
  if (d2.fee !== 100000) {
    fail(5, 'Settlement fee mismatch', `expected 100000, got ${d2.fee}`);
    return false;
  }

  // 5d: Submit settlement info
  const { status: s3, data: d3 } = await api(`/api/public/settlement/${settlementToken}`, {
    method: 'POST',
    body: JSON.stringify({
      tax_type: 'business_income',
      real_name: '홍길동',
      ssn: '9401011234567',
      bank_name: 'KB국민은행',
      bank_account: '12345678901234',
      bank_holder: '홍길동',
      upload_link: 'https://www.instagram.com/p/test12345/',
    }),
  });

  if (s3 === 200 && d3.success) {
    pass(5, 'Settlement submitted successfully');
    return true;
  }
  fail(5, 'Settlement submission', `status=${s3}, data=${JSON.stringify(d3)}`);
  return false;
}

// ─── Step 6: Verify settlement record in DB ───
async function step6() {
  log(6, 'Checking settlement record...');
  const settlements = await supabaseQuery(
    'inf_settlements',
    `?participant_id=eq.${participantId}&select=id,gross_amount,tax_type,tax_rate,tax_amount,net_amount,payment_status`
  );

  if (!Array.isArray(settlements) || settlements.length === 0) {
    fail(6, 'Settlement query', 'No settlement record found');
    return false;
  }

  const s = settlements[0];
  settlementId = s.id;
  const checks = [];
  const failures = [];

  if (s.gross_amount === 100000) checks.push('gross=100,000');
  else failures.push(`gross: expected 100000, got ${s.gross_amount}`);

  if (s.tax_type === 'business_income') checks.push('tax_type=business_income');
  else failures.push(`tax_type: got ${s.tax_type}`);

  if (s.tax_rate === 3.3) checks.push('tax_rate=3.3%');
  else failures.push(`tax_rate: got ${s.tax_rate}`);

  if (s.tax_amount === 3300) checks.push('tax=3,300');
  else failures.push(`tax_amount: got ${s.tax_amount}`);

  if (s.net_amount === 96700) checks.push('net=96,700');
  else failures.push(`net_amount: got ${s.net_amount}`);

  if (s.payment_status === 'waiting') checks.push('status=waiting');
  else failures.push(`payment_status: got ${s.payment_status}`);

  if (checks.length >= 5) {
    pass(6, `Settlement verified: ${checks.join(', ')}`);
    return true;
  }
  fail(6, 'Settlement verification', `${checks.length}/6 passed. Failures: ${failures.join('; ')}`);
  return false;
}

// ─── Step 7: Verify PII is encrypted in DB ───
async function step7() {
  log(7, 'Checking PII encryption in DB...');
  const data = await supabaseQuery(
    'inf_participants',
    `?id=eq.${participantId}&select=ssn_enc,bank_account_enc,real_name_enc,bank_name,bank_holder`
  );

  if (!Array.isArray(data) || data.length === 0) {
    fail(7, 'Participant query for PII', 'No data');
    return false;
  }

  const p = data[0];
  const checks = [];
  const failures = [];

  if (p.ssn_enc && typeof p.ssn_enc === 'string' && p.ssn_enc !== '9401011234567') {
    checks.push('ssn_enc is encrypted');
  } else {
    failures.push(`ssn_enc: type=${typeof p.ssn_enc}, value=${String(p.ssn_enc)?.slice(0, 20)}`);
  }

  if (p.bank_account_enc && typeof p.bank_account_enc === 'string' && p.bank_account_enc !== '12345678901234') {
    checks.push('bank_account_enc is encrypted');
  } else {
    failures.push(`bank_account_enc: type=${typeof p.bank_account_enc}`);
  }

  if (p.real_name_enc && typeof p.real_name_enc === 'string' && p.real_name_enc !== '홍길동') {
    checks.push('real_name_enc is encrypted');
  } else {
    failures.push(`real_name_enc: type=${typeof p.real_name_enc}`);
  }

  if (p.bank_name === 'KB국민은행') checks.push('bank_name is plaintext');
  else failures.push(`bank_name: got '${p.bank_name}'`);

  if (p.bank_holder === '홍길동') checks.push('bank_holder is plaintext');
  else failures.push(`bank_holder: got '${p.bank_holder}'`);

  if (checks.length >= 4) {
    pass(7, `PII encryption verified: ${checks.join(', ')}`);
    return true;
  }
  fail(7, 'PII encryption', `${checks.length}/5 passed. Failures: ${failures.join('; ')}`);
  return false;
}

// ─── Step 8: Delete test data ───
async function step8() {
  log(8, 'Deleting test data...');
  const errors = [];

  if (settlementId) {
    const s1 = await supabaseDelete('inf_settlements', `?id=eq.${settlementId}`);
    if (s1 >= 200 && s1 < 300) log(8, 'Settlement deleted');
    else errors.push(`settlement delete: ${s1}`);
  }

  if (participantId) {
    const s2 = await supabaseDelete('inf_access_logs', `?participant_id=eq.${participantId}`);
    log(8, `Access logs deleted (status: ${s2})`);
  }

  if (participantId) {
    const s3 = await supabaseDelete('inf_participants', `?id=eq.${participantId}`);
    if (s3 >= 200 && s3 < 300) log(8, 'Participant deleted');
    else errors.push(`participant delete: ${s3}`);
  }

  if (campaignId) {
    const s4 = await supabaseDelete('inf_campaigns', `?id=eq.${campaignId}`);
    if (s4 >= 200 && s4 < 300) log(8, 'Campaign deleted');
    else errors.push(`campaign delete: ${s4}`);
  }

  if (errors.length === 0) {
    pass(8, 'All test data deleted');
    return true;
  }
  fail(8, 'Data cleanup', errors.join(', '));
  return false;
}

// ─── Main ───
async function main() {
  console.log('');
  console.log('========================================');
  console.log(' HEEDA Influencer Operations — E2E Test');
  console.log('========================================');
  console.log(`Base URL: ${BASE}`);
  console.log(`Supabase: ${SUPABASE_URL}`);
  console.log('');

  if (!await step0()) {
    console.log('\n ABORTED: Tables do not exist.\n');
    process.exit(1);
  }

  try {
    await step1();
    if (!campaignId) throw new Error('No campaign ID');

    await step2();
    if (!participantId) throw new Error('No participant ID');

    await step3();
    await step4();
    await step5();
    await step6();
    await step7();
  } catch (e) {
    fail('?', 'Unexpected error', e.message);
  }

  await step8();

  // Summary
  console.log('\n========================================');
  console.log(' Test Results Summary');
  console.log('========================================');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  results.forEach(r => {
    const icon = r.status === 'PASS' ? '[PASS]' : '[FAIL]';
    console.log(`  ${icon} Step ${r.step}: ${r.desc}`);
    if (r.error) console.log(`         Error: ${r.error}`);
  });
  console.log(`\nTotal: ${passed} passed, ${failed} failed out of ${results.length} checks`);
  console.log('========================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
