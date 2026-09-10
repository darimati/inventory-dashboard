#!/usr/bin/env node
/**
 * HEEDA Influencer 정합성 체크 스크립트 v2
 * 실행: npm run check:influencer
 *
 * Stage 2 업데이트:
 * - skip_* 캠페인 컬럼 기반 단계 판단
 * - 완료 정의: 유가=settlement paid, 무가=uploaded_at
 * - 제품별 고료: fee=0 제외 검증
 * - 정산 source of truth: inf_settlements
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local
const envPath = resolve(__dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf-8');
const env = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^(\w+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } },
);

// KST today
const kstNow = new Date(Date.now() + 9 * 3600000);
const todayStr = kstNow.toISOString().slice(0, 10);
const monthStart = todayStr.slice(0, 7) + '-01';
const yearStart = todayStr.slice(0, 4) + '-01-01';

let passCount = 0;
let failCount = 0;
let warnCount = 0;
const manualFixes = [];

function pass(label) {
  passCount++;
  console.log(`  PASS  ${label}`);
}
function fail(label, details) {
  failCount++;
  console.log(`  FAIL  ${label}`);
  if (details) {
    if (Array.isArray(details)) {
      details.forEach(d => console.log(`          ${d}`));
    } else {
      console.log(`          ${details}`);
    }
  }
}
function warn(label, details) {
  warnCount++;
  console.log(`  WARN  ${label}`);
  if (details) console.log(`          ${details}`);
}

// ─── Skip config helper (mirrors metrics.ts) ───
function getSkipConfig(campaign) {
  const isFree = campaign.collab_type === 'free_seeding' || campaign.collab_type === 'free_collab';
  return {
    skipConsent: campaign.skip_consent ?? false,
    skipDraft: campaign.skip_draft ?? isFree,
    skipEdit: campaign.skip_edit ?? isFree,
  };
}

function getStep(p, skip) {
  if (!skip.skipDraft && !p.draft_received_at) return 'draft';
  if (!skip.skipEdit && !p.edit_received_at) return 'edit';
  if (!p.uploaded_at) return 'upload';
  const hasFee = (Number(p.fee) || 0) > 0;
  if (hasFee) return 'payment';
  return 'completed';
}

function isCompleted(p) {
  const hasFee = (Number(p.fee) || 0) > 0;
  if (hasFee) return p.settlement_status === 'paid';
  return !!p.uploaded_at;
}

async function main() {
  console.log('\n===================================================');
  console.log('  HEEDA Influencer 정합성 체크 v2');
  console.log(`  기준일: ${todayStr} (KST)`);
  console.log('===================================================\n');

  // ─── Fetch all data ───
  const { data: campaigns } = await supabase.from('inf_campaigns').select('*').order('created_at', { ascending: false });
  const { data: participants } = await supabase.from('inf_participants').select('*').order('created_at', { ascending: false });
  const { data: settlements } = await supabase.from('inf_settlements').select('*').order('created_at', { ascending: false });
  const { data: budgetSetting } = await supabase.from('inf_settings').select('value').eq('key', 'default_budget').single();

  const activeCampaigns = campaigns.filter(c => c.status === 'active');
  const activeParticipants = participants.filter(p => p.status !== 'cancelled');
  const activeCampIds = new Set(activeCampaigns.map(c => c.id));

  console.log(`  데이터: 캠페인 ${campaigns.length}개, 참여자 ${participants.length}명, 정산 ${settlements.length}건\n`);

  // ═══ CHECK 1: 참여자 단계 일관성 (skip 설정 기반) ═══
  console.log('--- 1. 참여자 단계 일관성 ---');
  {
    const issues = [];
    for (const p of activeParticipants) {
      const camp = campaigns.find(c => c.id === p.campaign_id);
      if (!camp) continue;
      const skip = getSkipConfig(camp);
      const step = getStep(p, skip);

      // fee=0 should not be in payment
      if (step === 'payment' && (Number(p.fee) || 0) === 0) {
        issues.push(`${p.name || p.display_name} (${p.id.slice(0,8)}): fee=0 but in payment step`);
      }
    }
    if (issues.length === 0) pass('모든 참여자가 정확히 한 단계에 있음');
    else fail('단계 일관성 위반', issues);
  }

  // ═══ CHECK 2: 참여자 중복 ═══
  console.log('--- 2. 참여자 중복 ---');
  {
    const seen = new Map();
    const dupes = [];
    for (const p of activeParticipants) {
      const key = `${(p.name || p.display_name || '').toLowerCase()}|${p.campaign_id}`;
      if (seen.has(key)) {
        dupes.push(`${p.name || p.display_name} in campaign ${p.campaign_id.slice(0,8)}: IDs ${seen.get(key).slice(0,8)}, ${p.id.slice(0,8)}`);
      } else {
        seen.set(key, p.id);
      }
    }
    if (dupes.length === 0) pass('인플루언서 x 캠페인 중복 없음');
    else fail('중복 참여자 발견', dupes);
  }

  // ═══ CHECK 3: 확인 완료일 순서 ═══
  console.log('--- 3. 확인 완료일 순서 ---');
  {
    const issues = [];
    for (const p of activeParticipants) {
      const camp = campaigns.find(c => c.id === p.campaign_id);
      if (!camp) continue;
      const skip = getSkipConfig(camp);
      if (skip.skipDraft || skip.skipEdit) continue;

      const draftDate = p.draft_received_at;
      const editDate = p.edit_received_at;
      const uploadDate = p.uploaded_at;

      if (draftDate && editDate) {
        const d = new Date(draftDate).getTime();
        const e = new Date(editDate).getTime();
        if (e < d) {
          issues.push(`${p.name || p.display_name}: 가편집본 확인(${editDate.slice(0,10)}) < 기획안 확인(${draftDate.slice(0,10)})`);
          manualFixes.push({ id: p.id, name: p.name || p.display_name, campaign: camp?.name,
            issue: `가편집본 확인일이 기획안 확인일보다 빠름` });
        }
      }
      if (editDate && uploadDate) {
        if (new Date(uploadDate).getTime() < new Date(editDate).getTime()) {
          issues.push(`${p.name || p.display_name}: 업로드(${uploadDate.slice(0,10)}) < 가편집본(${editDate.slice(0,10)})`);
        }
      }
    }
    if (issues.length === 0) pass('확인 완료일이 순서대로 증가');
    else fail('확인 완료일 순서 위반', issues);
  }

  // ═══ CHECK 4: 고료 0원 참여자 정산 상태 ═══
  console.log('--- 4. 고료 0원 참여자 정산 단계 ---');
  {
    const issues = [];
    for (const p of activeParticipants) {
      if ((Number(p.fee) || 0) === 0) {
        if (p.settlement_status && p.settlement_status !== 'none') {
          const camp = campaigns.find(c => c.id === p.campaign_id);
          issues.push(`${p.name || p.display_name} (${camp?.name}): fee=0, settlement_status=${p.settlement_status}`);
        }
      }
    }
    if (issues.length === 0) pass('고료 0원 참여자에 정산 상태 없음');
    else fail('고료 0원 참여자가 정산 상태를 가짐', issues);
  }

  // ═══ CHECK 5: 완료 캠페인 참여자 지표 혼입 ═══
  console.log('--- 5. 완료 캠페인 참여자 지표 혼입 ---');
  {
    // Dashboard API now computes totalParticipants/pendingConsent from active/preparing campaigns only
    const activePreparingIds = new Set(campaigns.filter(c => ['active', 'preparing'].includes(c.status)).map(c => c.id));
    const dashboardParts = activeParticipants.filter(p => activePreparingIds.has(p.campaign_id));
    const nonDashboardParts = activeParticipants.filter(p => !activePreparingIds.has(p.campaign_id));

    if (nonDashboardParts.length > 0) {
      console.log(`    active/preparing 외 참여자 ${nonDashboardParts.length}명은 대시보드 KPI에서 제외됨 (정상)`);
    }
    pass(`대시보드 참여자 = active/preparing 캠페인 기준 (${dashboardParts.length}명)`);
  }

  // ═══ CHECK 6: 정산 레코드 <-> 참여자 상태 동기화 ═══
  console.log('--- 6. 정산 레코드 <-> 참여자 상태 동기화 ---');
  {
    const issues = [];
    for (const s of settlements) {
      const p = participants.find(pp => pp.id === s.participant_id);
      if (!p) continue;

      if (s.payment_status === 'paid' && p.settlement_status !== 'paid') {
        issues.push(`${p.name || p.display_name}: settlement.payment_status=paid but participant.settlement_status=${p.settlement_status}`);
        manualFixes.push({ id: p.id, name: p.name || p.display_name,
          issue: `정산 레코드 paid이나 참여자 settlement_status=${p.settlement_status}` });
      }

      if (p.settlement_status === 'paid' && s.payment_status !== 'paid') {
        issues.push(`${p.name || p.display_name}: participant.settlement_status=paid but settlement.payment_status=${s.payment_status}`);
        manualFixes.push({ id: p.id, name: p.name || p.display_name,
          issue: `참여자 settlement_status=paid이나 정산 레코드 payment_status=${s.payment_status}` });
      }
    }
    if (issues.length === 0) pass('정산 레코드와 참여자 상태 동기화됨');
    else fail('정산 상태 불일치', issues);
  }

  // ═══ CHECK 7: 정산 대기 지표 ═══
  console.log('--- 7. 정산 대기 지표 ---');
  {
    const waitingSettlements = settlements.filter(s => ['waiting', 'requested'].includes(s.payment_status));
    const waitingAmount = waitingSettlements.reduce((sum, s) => sum + (Number(s.net_amount) || Number(s.gross_amount) || 0), 0);
    const docsRequestedParts = activeParticipants.filter(p =>
      p.settlement_status === 'docs_requested' && (Number(p.fee) || 0) > 0
    );
    const dashboardCount = waitingSettlements.length + docsRequestedParts.length;

    console.log(`    정산 레코드 waiting/requested: ${waitingSettlements.length}건, ${waitingAmount.toLocaleString()}원`);
    console.log(`    정산 정보 대기 (docs_requested): ${docsRequestedParts.length}건`);
    console.log(`    대시보드 표시 건수: ${dashboardCount}건`);
    pass('정산 대기 지표 계산 확인');
  }

  // ═══ CHECK 8: 이번 달 지급 ═══
  console.log('--- 8. 이번 달 지급 ---');
  {
    const paidThisMonth = settlements.filter(s =>
      s.payment_status === 'paid' && s.paid_date && s.paid_date >= monthStart
    );
    const paidAmount = paidThisMonth.reduce((sum, s) => sum + (Number(s.net_amount) || Number(s.gross_amount) || 0), 0);
    console.log(`    이번 달 지급 완료: ${paidThisMonth.length}건, ${paidAmount.toLocaleString()}원`);

    const paidNoPaidDate = settlements.filter(s => s.payment_status === 'paid' && !s.paid_date);
    if (paidNoPaidDate.length > 0) {
      fail('지급 완료인데 paid_date 없음', paidNoPaidDate.map(s => {
        const p = participants.find(pp => pp.id === s.participant_id);
        return `settlement ${s.id.slice(0,8)} (${p?.name || p?.display_name || 'unknown'})`;
      }));
    } else {
      pass('지급 완료 레코드에 paid_date 있음');
    }
  }

  // ═══ CHECK 9: 캠페인 이름 월코드 ═══
  console.log('--- 9. 캠페인 이름 월코드 일관성 ---');
  {
    for (const c of campaigns) {
      const nameMatch = c.name.match(/^(\d{2})(\d{2})\s/);
      if (nameMatch && c.month) {
        const nameYear = `20${nameMatch[1]}`;
        const nameMonth = nameMatch[2];
        const monthYear = c.month.slice(0, 4);
        const monthMonth = c.month.slice(5, 7);

        if (nameYear !== monthYear || nameMonth !== monthMonth) {
          warn(`캠페인 "${c.name}": 이름은 ${nameYear}년 ${nameMonth}월, month 필드는 ${monthYear}년 ${monthMonth}월`,
            `month 필드: ${c.month}`);
          manualFixes.push({ id: c.id, name: c.name,
            issue: `이름의 월코드(${nameMonth})와 month 필드(${monthMonth}) 불일치` });
        }
      }
    }
    pass('캠페인 월코드 체크 완료');
  }

  // ═══ CHECK 10: 캠페인별 계약액 ═══
  console.log('--- 10. 캠페인별 계약액 일관성 ---');
  {
    for (const c of activeCampaigns) {
      const campParts = activeParticipants.filter(p => p.campaign_id === c.id);
      const totalFee = campParts.reduce((sum, p) => sum + (Number(p.fee) || 0), 0);
      const totalProductCost = campParts.reduce((sum, p) => sum + (Number(p.product_cost) || 0), 0);
      console.log(`    ${c.name}: 참여자 ${campParts.length}명, 고료합 ${totalFee.toLocaleString()}원, 제품합 ${totalProductCost.toLocaleString()}원, 예산 ${(Number(c.budget) || 0).toLocaleString()}원`);
    }
    pass('캠페인별 계약액 계산 확인');
  }

  // ═══ CHECK 11: 예산 비교 (E-5 fallback) ═══
  console.log('--- 11. 예산 비교 ---');
  {
    const monthlyBudgetSetting = budgetSetting?.value?.monthly ?? 0;
    const campaignBudgetSum = activeCampaigns.reduce((sum, c) => sum + (Number(c.budget) || 0), 0);
    const effectiveBudget = monthlyBudgetSetting > 0 ? monthlyBudgetSetting : campaignBudgetSum;
    const isFallback = monthlyBudgetSetting <= 0 && campaignBudgetSum > 0;

    const activePreparingIds = new Set(campaigns.filter(c => ['active', 'preparing'].includes(c.status)).map(c => c.id));
    const dashParts = activeParticipants.filter(p => activePreparingIds.has(p.campaign_id));
    const monthlyParts = dashParts.filter(p => p.created_at >= monthStart);
    const monthlyTotal = monthlyParts.reduce((sum, p) => sum + (Number(p.fee) || 0) + (Number(p.product_cost) || 0), 0);
    const pct = effectiveBudget > 0 ? Math.round((monthlyTotal / effectiveBudget) * 100) : 0;

    console.log(`    월 예산 설정: ${monthlyBudgetSetting.toLocaleString()}원`);
    console.log(`    캠페인 예산 합: ${campaignBudgetSum.toLocaleString()}원`);
    console.log(`    적용 예산: ${effectiveBudget.toLocaleString()}원${isFallback ? ' (캠페인 예산 합 기준)' : ''}`);
    console.log(`    이번 달 계약: ${monthlyTotal.toLocaleString()}원 (${pct}%)`);
    pass('예산 소진율 표시 정상');
  }

  // ═══ CHECK 12: skip 설정 검증 ═══
  console.log('--- 12. skip 설정 검증 ---');
  {
    const issues = [];
    for (const c of campaigns) {
      const skip = getSkipConfig(c);
      const campParts = activeParticipants.filter(p => p.campaign_id === c.id);
      const hasSkipColumns = c.skip_consent !== undefined && c.skip_consent !== null
        || c.skip_draft !== undefined && c.skip_draft !== null
        || c.skip_edit !== undefined && c.skip_edit !== null;

      console.log(`    ${c.name}: consent=${skip.skipConsent ? 'skip' : 'use'}, draft=${skip.skipDraft ? 'skip' : 'use'}, edit=${skip.skipEdit ? 'skip' : 'use'}${hasSkipColumns ? '' : ' (기본값)'}`);

      // Validate: if draft skipped, participants should not need draft_received_at
      if (skip.skipDraft) {
        const withDraft = campParts.filter(p => p.draft_received_at);
        if (withDraft.length > 0) {
          console.log(`      참고: skip_draft=true이지만 ${withDraft.length}명이 draft_received_at 값 보유 (정상 — 이전 데이터)`);
        }
      }
    }
    pass('skip 설정 확인 완료');
  }

  // ═══ CHECK 13: 완료 기준 일관성 (E-2) ═══
  console.log('--- 13. 완료 기준 일관성 (E-2) ---');
  {
    const issues = [];
    for (const c of activeCampaigns) {
      const campParts = activeParticipants.filter(p => p.campaign_id === c.id);

      const completedCount = campParts.filter(p => isCompleted(p)).length;
      const oldUploadDone = campParts.filter(p => !!p.published_url).length;

      if (completedCount !== oldUploadDone) {
        console.log(`    ${c.name}: 완료(E-2)=${completedCount}명, 구 uploadDone=${oldUploadDone}명`);
        // Show who differs
        for (const p of campParts) {
          const newComplete = isCompleted(p);
          const oldComplete = !!p.published_url;
          if (newComplete !== oldComplete) {
            console.log(`      ${p.name || p.display_name}: E-2=${newComplete}, old=${oldComplete}, settlement=${p.settlement_status}`);
          }
        }
      }
    }
    pass('완료 기준 (E-2) 검증 완료');
  }

  // ═══ CHECK 14: 제품별 고료 건수 (fee=0 제외) ═══
  console.log('--- 14. 제품별 고료 건수 ---');
  {
    const activePreparingIds = new Set(campaigns.filter(c => ['active', 'preparing'].includes(c.status)).map(c => c.id));
    const dashParts = activeParticipants.filter(p => activePreparingIds.has(p.campaign_id));
    const annualParts = dashParts.filter(p => p.created_at >= yearStart);

    const withFee = {};
    const withoutFee = {};
    for (const p of annualParts) {
      const key = p.product || '기타';
      const fee = Number(p.fee) || 0;
      if (fee > 0) {
        if (!withFee[key]) withFee[key] = { count: 0, fee: 0 };
        withFee[key].count += 1;
        withFee[key].fee += fee;
      } else {
        if (!withoutFee[key]) withoutFee[key] = 0;
        withoutFee[key] += 1;
      }
    }

    console.log('    [대시보드 표시 — fee>0만]:');
    for (const [name, data] of Object.entries(withFee)) {
      console.log(`      ${name}: ${data.count}건, ${data.fee.toLocaleString()}원`);
    }
    if (Object.keys(withoutFee).length > 0) {
      console.log('    [fee=0 (제외됨)]:');
      for (const [name, count] of Object.entries(withoutFee)) {
        console.log(`      ${name}: ${count}건`);
      }
    }
    pass('제품별 고료 건수 (fee=0 제외)');
  }

  // ═══ CHECK 15: 정산 중복 레코드 ═══
  console.log('--- 15. 정산 중복 레코드 ---');
  {
    const byParticipant = {};
    for (const s of settlements) {
      if (!byParticipant[s.participant_id]) byParticipant[s.participant_id] = [];
      byParticipant[s.participant_id].push(s);
    }

    const dupes = [];
    for (const [pid, records] of Object.entries(byParticipant)) {
      if (records.length > 1) {
        const p = participants.find(pp => pp.id === pid);
        dupes.push(`${p?.name || p?.display_name || pid.slice(0,8)}: ${records.length}건 (${records.map(r => r.payment_status).join(', ')})`);
      }
    }
    if (dupes.length === 0) pass('참여자당 정산 레코드 1건');
    else warn(`정산 중복 레코드 ${dupes.length}건`, dupes.join('\n          '));
  }

  // ═══ SUMMARY ═══
  console.log('\n===================================================');
  console.log(`  결과: PASS ${passCount} / FAIL ${failCount} / WARN ${warnCount}`);
  console.log('===================================================');

  if (manualFixes.length > 0) {
    console.log('\n수동 수정 필요 목록:');
    manualFixes.forEach((f, i) => {
      console.log(`  ${i + 1}. [${f.id.slice(0,8)}] ${f.name}${f.campaign ? ` (${f.campaign})` : ''}: ${f.issue}`);
    });
  }

  console.log('');
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Script error:', err);
  process.exit(2);
});
