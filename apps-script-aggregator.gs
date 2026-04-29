/**
 * DARIMATI Inventory Dashboard — 출고 시트 집계 Web App
 *
 * 배포 흐름:
 * 1. Google Sheet 열기 → Extensions → Apps Script
 * 2. 기본 코드 전체 삭제 → 이 파일 내용 통째로 붙여넣기
 * 3. 우측 상단 [Deploy] → [New deployment]
 * 4. Type: [Web app] 선택
 *      - Description: 'DARIMATI Dashboard API'
 *      - Execute as: 'Me (your-email@gmail.com)'
 *      - Who has access: 'Anyone' (익명 포함 — 집계만 노출하므로 안전)
 * 5. [Deploy] → 권한 승인 → 'Web app URL' 복사 → 매트가 Builder에게 전달
 * 6. 시트 자체는 'Anyone with link' 해제 → 본인만 접근으로 변경 (PII 보호)
 *
 * 이 스크립트의 보안 모델:
 * - 시트는 비공개 유지 (PII 보호)
 * - 스크립트가 시트 주인 권한으로 데이터 읽음
 * - 응답 JSON에는 PII 컬럼(이름·전화·주소)을 절대 포함하지 않음 — 집계 수치만
 */

const SHEET_ID = '1ibroQV42xuuvWg4P1kvaCw9RT_JxO9L-6lXVAgNjOhA';
const OUTGOING_GID = 890805647;     // 출고 시트
const INVENTORY_GID = 583958144;    // 잔여재고 시트 (선택, 향후)

const REAL_CHANNELS = ['킥스타터', '카카오메이커스', '네이버', '카카오톡스토어'];

function doGet(e) {
  try {
    const data = aggregateOutgoing();
    return ContentService
      .createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({error: err.message, stack: err.stack}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function aggregateOutgoing() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheets = ss.getSheets();
  const outSheet = sheets.find(s => s.getSheetId() === OUTGOING_GID) || sheets[0];

  const values = outSheet.getDataRange().getValues();
  const rows = values.slice(1); // skip header

  // 컬럼 인덱스 (0-based, 시트 구조 기준)
  // A=0 포장, B=1 송장출고, C=2 판매처, D=3 배송방법, E=4 상태,
  // F=5 운송장, G=6 받는분(PII), H=7 메모, I=8 컬러, J=9 사이즈,
  // K=10 신발수량, ^(31)=품목명

  const dailySale = {}, dailyB2B = {}, dailyGift = {};
  const channelCount = {};
  const sizeColorSale = {}; // {color: {size: count}}
  const sizeColorOther = {}; // 증정+B2B
  const platformByDay = {}; // {channel: {date: count}}
  let totalSale = 0, totalB2B = 0, totalGift = 0;

  rows.forEach(r => {
    const outDate = r[1] || r[0]; // 송장출고 fallback 포장
    if (!outDate || !(outDate instanceof Date)) return;
    const month = outDate.getMonth() + 1;
    const day = outDate.getDate();
    if (month < 4 || (month === 4 && day < 17)) return; // 4/17 이후만
    const dateLabel = `${month}/${day}`;

    const channel = (r[2] || '').toString().trim();
    const status = (r[4] || '').toString();
    const recipient = (r[6] || '').toString();
    const memo = (r[7] || '').toString();
    const colorRaw = (r[8] || '').toString();
    const sizeRaw = (r[9] || '').toString();
    const qty = parseInt(r[10]) || 1;

    // 분류
    let kind;
    if (channel === '샘플' || memo.indexOf('지인') >= 0) kind = 'gift';
    else if (channel === '마야크루' || recipient === '마야크루') kind = 'b2b';
    else if (REAL_CHANNELS.indexOf(channel) >= 0) kind = 'sale';
    else return; // 기타 무시

    // 컬러/사이즈 정규화
    let color = '';
    if (colorRaw.indexOf('그레이') >= 0) color = 'GREY';
    else if (colorRaw.indexOf('베이지') >= 0) color = 'BEIGE';
    const size = sizeRaw.replace(/mm/g, '').trim().substring(0, 3);

    // 집계
    if (kind === 'sale') {
      dailySale[dateLabel] = (dailySale[dateLabel] || 0) + qty;
      channelCount[channel] = (channelCount[channel] || 0) + qty;
      totalSale += qty;
      if (color && size) {
        if (!sizeColorSale[color]) sizeColorSale[color] = {};
        sizeColorSale[color][size] = (sizeColorSale[color][size] || 0) + qty;
      }
      if (!platformByDay[channel]) platformByDay[channel] = {};
      platformByDay[channel][dateLabel] = (platformByDay[channel][dateLabel] || 0) + qty;
    } else if (kind === 'b2b') {
      dailyB2B[dateLabel] = (dailyB2B[dateLabel] || 0) + qty;
      const key = '마야크루';
      channelCount[key] = (channelCount[key] || 0) + qty;
      totalB2B += qty;
      if (color && size) {
        if (!sizeColorOther[color]) sizeColorOther[color] = {};
        sizeColorOther[color][size] = (sizeColorOther[color][size] || 0) + qty;
      }
    } else if (kind === 'gift') {
      dailyGift[dateLabel] = (dailyGift[dateLabel] || 0) + qty;
      channelCount['샘플'] = (channelCount['샘플'] || 0) + qty;
      totalGift += qty;
      if (color && size) {
        if (!sizeColorOther[color]) sizeColorOther[color] = {};
        sizeColorOther[color][size] = (sizeColorOther[color][size] || 0) + qty;
      }
    }
  });

  // 날짜 정렬 (출고일 기준)
  const allDates = new Set([...Object.keys(dailySale), ...Object.keys(dailyB2B), ...Object.keys(dailyGift)]);
  const dates = Array.from(allDates).sort((a, b) => {
    const [am, ad] = a.split('/').map(Number);
    const [bm, bd] = b.split('/').map(Number);
    return am !== bm ? am - bm : ad - bd;
  });

  // 주차별 집계 (W1: 4/17, W2: 4/20-24, W3: 4/27-, W4: 5/4-)
  function weekOf(label) {
    const [m, d] = label.split('/').map(Number);
    const k = m * 100 + d;
    if (k <= 417) return 'W1';
    if (k <= 424) return 'W2';
    if (k <= 503) return 'W3';
    return 'W4+';
  }
  const weekly = { W1: { sale: 0, b2b: 0, days: 0 }, W2: { sale: 0, b2b: 0, days: 0 }, W3: { sale: 0, b2b: 0, days: 0 }, 'W4+': { sale: 0, b2b: 0, days: 0 } };
  dates.forEach(d => {
    const w = weekOf(d);
    weekly[w].sale += (dailySale[d] || 0);
    weekly[w].b2b  += (dailyB2B[d]  || 0);
    if ((dailySale[d] || 0) + (dailyB2B[d] || 0) > 0) weekly[w].days++;
  });

  return {
    updated: new Date().toISOString(),
    period: { from: dates[0] || null, to: dates[dates.length - 1] || null, days: dates.length },
    totals: {
      sale: totalSale,
      b2b: totalB2B,
      gift: totalGift,
      all: totalSale + totalB2B + totalGift,
      saleAvgPerDay: dates.length > 0 ? +(totalSale / dates.length).toFixed(1) : 0
    },
    daily: {
      dates: dates,
      sale: dates.map(d => dailySale[d] || 0),
      b2b:  dates.map(d => dailyB2B[d]  || 0),
      gift: dates.map(d => dailyGift[d] || 0)
    },
    channels: Object.entries(channelCount)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    sizeColor: {
      saleGrey:  sizeColorSale['GREY']   || {},
      saleBeige: sizeColorSale['BEIGE']  || {},
      otherGrey: sizeColorOther['GREY']  || {},
      otherBeige: sizeColorOther['BEIGE'] || {}
    },
    weekly: ['W1', 'W2', 'W3', 'W4+']
      .filter(w => weekly[w].sale + weekly[w].b2b > 0)
      .map(w => ({
        label: w,
        sale: weekly[w].sale,
        b2b: weekly[w].b2b,
        days: weekly[w].days,
        avg: weekly[w].days > 0 ? +(weekly[w].sale / weekly[w].days).toFixed(1) : 0
      })),
    platformByDay: platformByDay
  };
}

/** 시트 변경 시 스크립트가 실시간 반영하도록 캐시 없음. 호출 시마다 시트를 다시 읽음. */
