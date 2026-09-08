#!/usr/bin/env node
/**
 * 최종 정합성 체크
 * 1. DB 현재 상태 (line items, 고유 주문, 금액)
 * 2. 대시보드 API 응답 (홈/매출 페이지가 보여주는 수치)
 * 3. Wing 비즈니스 인사이트 대조용 월별/일별 테이블
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve(import.meta.dirname, '..', '.env.local');
const envText = fs.readFileSync(envPath, 'utf-8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  console.log('='.repeat(70));
  console.log('최종 정합성 체크 — DB vs 대시보드 vs Wing 비즈니스 인사이트');
  console.log('='.repeat(70));

  const months = [
    { ym: '2026-04', from: '2026-04-01', to: '2026-04-30' },
    { ym: '2026-05', from: '2026-05-01', to: '2026-05-31' },
    { ym: '2026-06', from: '2026-06-01', to: '2026-06-30' },
    { ym: '2026-07', from: '2026-07-01', to: '2026-07-31' },
    { ym: '2026-08', from: '2026-08-01', to: '2026-08-31' },
  ];

  // ---- 1. DB 원본 데이터 ----
  console.log('\n[1] DB 원본 데이터 (sales_coupang, brand=HEEDA)\n');

  const monthlyResults = [];

  for (const m of months) {
    const { data: rows, error } = await supabase
      .from('sales_coupang')
      .select('order_id, vendor_item_id, sale_type, sale_date, sale_amount, quantity, settlement_amount, product_name, raw_payload')
      .eq('brand', 'HEEDA')
      .gte('sale_date', m.from)
      .lte('sale_date', m.to)
      .order('sale_date', { ascending: true });

    if (error) {
      console.error(`${m.ym}: DB error: ${error.message}`);
      continue;
    }

    const allRows = rows || [];
    const saleRows = allRows.filter(r => r.sale_type === 'SALE');
    const cancelRows = allRows.filter(r => r.sale_type !== 'SALE');

    // 고유 주문 수
    const uniqueOrderIds = new Set(saleRows.map(r => r.order_id));
    // line items 수
    const lineItemCount = saleRows.length;
    // 금액 합계
    const totalSaleAmount = saleRows.reduce((s, r) => s + (Number(r.sale_amount) || 0), 0);
    const totalSettlement = saleRows.reduce((s, r) => s + (Number(r.settlement_amount) || 0), 0);
    // 총 수량
    const totalQty = saleRows.reduce((s, r) => s + (Number(r.quantity) || 1), 0);

    // 소스 구분
    const rgRows = saleRows.filter(r => r.raw_payload?.source === 'rg_order_api');
    const revRows = saleRows.filter(r => r.raw_payload?.source === 'revenue_history');
    const otherRows = saleRows.filter(r => !r.raw_payload?.source || (r.raw_payload.source !== 'rg_order_api' && r.raw_payload.source !== 'revenue_history'));

    // 일별 집계
    const byDate = {};
    for (const r of saleRows) {
      const d = r.sale_date;
      if (!byDate[d]) byDate[d] = { orders: new Set(), items: 0, amount: 0, qty: 0 };
      byDate[d].orders.add(r.order_id);
      byDate[d].items++;
      byDate[d].amount += Number(r.sale_amount) || 0;
      byDate[d].qty += Number(r.quantity) || 1;
    }

    monthlyResults.push({
      ym: m.ym,
      lineItems: lineItemCount,
      uniqueOrders: uniqueOrderIds.size,
      totalAmount: totalSaleAmount,
      totalSettlement,
      totalQty,
      rgCount: rgRows.length,
      revCount: revRows.length,
      otherCount: otherRows.length,
      cancelCount: cancelRows.length,
      byDate,
      daysWithData: Object.keys(byDate).length,
    });
  }

  // 월별 요약 테이블
  console.log('월     | 주문수 | 아이템수 | 수량합 | 매출(정가기준)  | 정산금액      | 소스(RG/RevH/기타) | 취소건 | 데이터일수');
  console.log('-'.repeat(120));
  for (const r of monthlyResults) {
    console.log(
      `${r.ym} | ${String(r.uniqueOrders).padStart(6)} | ${String(r.lineItems).padStart(8)} | ${String(r.totalQty).padStart(6)} | ${r.totalAmount.toLocaleString().padStart(14)}원 | ${r.totalSettlement.toLocaleString().padStart(13)}원 | ${r.rgCount}/${r.revCount}/${r.otherCount}`.padEnd(100) + ` | ${String(r.cancelCount).padStart(6)} | ${String(r.daysWithData).padStart(6)}`
    );
  }

  // 전체 합계
  const grandTotal = monthlyResults.reduce((s, r) => ({
    orders: s.orders + r.uniqueOrders,
    items: s.items + r.lineItems,
    qty: s.qty + r.totalQty,
    amount: s.amount + r.totalAmount,
    settlement: s.settlement + r.totalSettlement,
  }), { orders: 0, items: 0, qty: 0, amount: 0, settlement: 0 });

  console.log('-'.repeat(120));
  console.log(
    `합계   | ${String(grandTotal.orders).padStart(6)} | ${String(grandTotal.items).padStart(8)} | ${String(grandTotal.qty).padStart(6)} | ${grandTotal.amount.toLocaleString().padStart(14)}원 | ${grandTotal.settlement.toLocaleString().padStart(13)}원`
  );

  // ---- 2. 대시보드 KPI 시뮬레이션 ----
  console.log('\n\n[2] 대시보드 KPI (홈/매출 페이지가 보여주는 수치)\n');
  console.log('대시보드는 sale_amount 합계를 "총매출"로 표시합니다.');
  console.log('대시보드 "주문수" = sale_type=SALE인 행(line item) 수');
  console.log('→ 이것이 Wing 판매분석의 "주문수"와 다를 수 있음\n');

  // 매출 페이지 API 시뮬레이션
  for (const r of monthlyResults) {
    const avgOrder = r.uniqueOrders > 0 ? Math.round(r.totalAmount / r.uniqueOrders) : 0;
    console.log(`${r.ym}:`);
    console.log(`  대시보드 총매출: ${r.totalAmount.toLocaleString()}원`);
    console.log(`  대시보드 주문수: ${r.lineItems}건 (line items) — Wing 대조 시 주문수(${r.uniqueOrders})와 비교`);
    console.log(`  대시보드 평균객단가: ${avgOrder.toLocaleString()}원 (총매출 ÷ 주문수 기준에 따라 달라짐)`);
  }

  // ---- 3. Wing 비즈니스 인사이트 대조용 일별 테이블 ----
  console.log('\n\n[3] Wing 비즈니스 인사이트 대조용 — 월별 일별 상세\n');
  console.log('※ 금액은 정가(unitSalesPrice) 기준. Wing이 실결제가 사용 시 차이 발생.\n');

  for (const r of monthlyResults) {
    console.log(`\n--- ${r.ym} (주문 ${r.uniqueOrders}건, 아이템 ${r.lineItems}건, ${r.totalAmount.toLocaleString()}원) ---`);
    console.log('날짜       | 주문수 | 아이템 | 수량 | 매출(정가)');
    const dates = Object.keys(r.byDate).sort();
    for (const d of dates) {
      const dd = r.byDate[d];
      console.log(`${d} | ${String(dd.orders.size).padStart(6)} | ${String(dd.items).padStart(6)} | ${String(dd.qty).padStart(4)} | ${dd.amount.toLocaleString().padStart(12)}원`);
    }

    // 주간 소계
    console.log(`소계       | ${String(r.uniqueOrders).padStart(6)} | ${String(r.lineItems).padStart(6)} | ${String(r.totalQty).padStart(4)} | ${r.totalAmount.toLocaleString().padStart(12)}원`);
  }

  // ---- 4. 주의사항 ----
  console.log('\n\n[4] Wing 대조 시 주의사항\n');
  console.log('① 금액 차이: 대시보드는 unitSalesPrice(정가), Wing은 실결제가 사용 가능');
  console.log('② 건수 기준: 대시보드 line item 수 ≠ Wing 주문수 (복수 상품 주문 존재)');
  console.log('   8월: 주문 143, 아이템 145 (복수상품 주문 2건)');
  console.log('③ 데이터 소스: RG Order API + Revenue-history API 합산');
  console.log('   Revenue-history 건: 4월 1건, 5월 1건, 7월 1건 (판매자배송 HEEDA)');
  console.log('④ 정산금액: RG 주문은 0원 (API 미제공), Revenue-history 주문만 정산액 있음');
  console.log('⑤ 잔여 차이: API 미반환 주문 존재 가능 (7월 기준 1건 미만)');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
