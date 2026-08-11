/**
 * DARIMATI S1 Landing — Email Waitlist Collector
 *
 * 셋업 (1회):
 * 1. 다리마티 Google 계정으로 새 Google Sheet 생성 (이름: "S1 Waitlist")
 * 2. Extensions → Apps Script
 * 3. 기본 코드 삭제 → 이 파일 전체 붙여넣기
 * 4. [Deploy] → [New deployment] → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. 권한 승인 → Web app URL 복사
 * 6. URL을 Zero에게 전달 → HTML에 세팅 + 배포
 */

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents || '{}');
    var email = (data.email || '').toString().trim().toLowerCase();

    if (!email || email.indexOf('@') < 0) {
      return respond_({ error: 'invalid email' });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Waitlist');

    // 첫 호출 시 시트 + 헤더 자동 생성
    if (!sheet) {
      sheet = ss.insertSheet('Waitlist');
      sheet.appendRow(['Timestamp', 'Email', 'Source', 'Page']);
      sheet.setFrozenRows(1);
      sheet.setColumnWidth(1, 180);
      sheet.setColumnWidth(2, 260);
    }

    // 중복 체크
    var existing = sheet.getRange('B2:B' + Math.max(2, sheet.getLastRow()))
                        .getValues().flat()
                        .map(function(v) { return v.toString().toLowerCase(); });
    if (existing.indexOf(email) >= 0) {
      return respond_({ ok: true, duplicate: true });
    }

    sheet.appendRow([
      new Date(),
      email,
      data.source || '',
      data.page || ''
    ]);

    return respond_({ ok: true, count: sheet.getLastRow() - 1 });
  } catch (err) {
    return respond_({ error: err.message });
  }
}

function doGet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Waitlist');
  var count = sheet ? Math.max(0, sheet.getLastRow() - 1) : 0;
  return respond_({ count: count });
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
