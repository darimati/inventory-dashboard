# DARIMATI Dashboard 자동 갱신 (Phase 2 — 자동 patch + push)

매 평일 17:00 KST · 공휴일 제외 · 변동분만 감지 · **자동 commit + push**

운영 지침: Obsidian Vault `04_운영/inventory/auto-update-rules.md`

---

## 구성 파일

| 파일 | 역할 |
|------|------|
| `daily-update.sh` | 메인 스크립트 (변동 감지 → patch 호출 → push) |
| `patch_dashboard.py` | Sheets gviz JSON → index.html 자동 patch |
| `holidays-kr-2026.txt` | 한국 공휴일 (매년 갱신) |
| `com.darimati.dashboard-update.plist` | macOS launchd 스케줄 |

---

## 설치 (1회)

### 1. repo 클론 (없으면)

```bash
mkdir -p ~/code/darimati
cd ~/code/darimati
git clone https://github.com/darimati/inventory-dashboard.git
cd inventory-dashboard
```

> ⚠️ launchd plist의 `ProgramArguments` 경로가 `$HOME/code/darimati/inventory-dashboard/scripts/daily-update.sh` 기준. 다른 경로 쓸 거면 plist 수정 필요.

### 2. 스크립트 실행 권한

```bash
chmod +x ~/code/darimati/inventory-dashboard/scripts/daily-update.sh
```

### 3. launchd plist 설치 + 등록

```bash
# 사용자 LaunchAgents 폴더로 복사
cp ~/code/darimati/inventory-dashboard/scripts/com.darimati.dashboard-update.plist \
   ~/Library/LaunchAgents/

# 등록 (다음 평일 17시부터 자동 실행)
launchctl load ~/Library/LaunchAgents/com.darimati.dashboard-update.plist

# 등록 확인
launchctl list | grep darimati.dashboard
```

### 4. 즉시 1회 테스트

```bash
~/code/darimati/inventory-dashboard/scripts/daily-update.sh
tail ~/.cache/darimati-dashboard/daily-update.log
```

---

## 운영 명령어

```bash
# 로그 실시간 확인
tail -f ~/.cache/darimati-dashboard/daily-update.log

# 캐시 hash 강제 무효화 (다음 실행 시 변동으로 인식)
rm ~/.cache/darimati-dashboard/last-hash.txt

# 수동 실행
~/code/darimati/inventory-dashboard/scripts/daily-update.sh

# launchd 일시 정지
launchctl unload ~/Library/LaunchAgents/com.darimati.dashboard-update.plist

# 다시 시작
launchctl load ~/Library/LaunchAgents/com.darimati.dashboard-update.plist

# 다음 실행 예정 시각 확인
launchctl print gui/$(id -u)/com.darimati.dashboard-update | grep -i next
```

---

## 운영 점검 (매월 1일)

- [ ] 한 달치 실행 로그 점검: `cat ~/.cache/darimati-dashboard/daily-update.log`
- [ ] 변동 감지 누락 없는지 확인 (매트가 옵시디언 갱신했는데 알림 못 받았으면 → hash 캐시 점검)
- [ ] 12월에는 다음 해 공휴일 파일 추가 (`holidays-kr-{YYYY+1}.txt`)
- [ ] **시차 맞추기 기준 위반 점검** (아래 섹션) — `grep -n '4월\|5월\|6월\|2026-0' index.html` 으로 하드코딩된 월 라벨이 신규로 들어갔는지 확인

---

## 시차 맞추기 기준 (Time-Sync Rules)

대시보드는 BR-001 런칭(2026-04-17) 시작이지만, 월이 바뀌어도 stale로 보이지 않도록 **누적 vs 월별을 명확히 분리**하고 월별 탭은 모두 같은 시점(시스템 today의 월)을 보도록 통일한다.

### 원칙 1 — 누적 vs 월별 분리 (가장 중요)

| 분류 | 어떤 데이터? | 어떤 탭? | 시점 기준 |
|---|---|---|---|
| **누적 (Cumulative)** | 잔여 재고, burn rate, 시작 고정점 (4/17) 이후 전체 | KR 재고 & 재발주, 악세서리 재고, HK 재고 | 시작 고정점부터 현재까지 |
| **월별 (Monthly)** | 매출, 출고량, ROAS, 정산, 채널 점유율 | 전체 출고, 커머스 허브, 정산 & ROAS | 시스템 today의 월 |

**시점 일치 (Time-Point Sync):** 월별 탭은 모두 **시스템 today의 월** 기준으로 표시. 5월에는 모두 5월 누계, 6월에는 모두 6월 누계. ROAS 비교/정산 비교가 같은 시점에서 가능하도록.

예외: 정산 & ROAS 탭의 월 picker — 과거 월 마감 snapshot 비교용. 다른 탭에는 영향 안 줌.

### 원칙 2 — 시간 단일 진실값 (SoT) = `Date.now()`

- `const today = new Date('YYYY-MM-DD')` 같은 하드코딩 금지.
- 모든 시간 계산은 `new Date()` 기준 (KST 가정).
- 테스트·스냅샷 재현은 URL `?date=YYYY-MM-DD` 로만 오버라이드 (이미 `index.html`에 구현).
- 사유: 2026-04~05 전환 시점에 `const today = '2026-04-29'` 하드코딩으로 재고 burn rate KPI가 4/29에 멈춰있던 사고 발생.

### 원칙 3 — 월 라벨은 모두 dynamic

| 의미 | ❌ 금지 | ✅ 권장 |
|---|---|---|
| 월별 KPI 라벨 (M월 누계 ...) | "4월 누계", "5월 누계" 직접 박기 | `<span class="dyn-month">M</span>월 누계` (JS가 시스템 today의 월로 채움) |
| 월별 데이터 범위 (M/1~) | "4/17~4/30" 직접 박기 | `<span class="dyn-month-range">M/1~M/D</span>` (patch 스크립트가 채움) |
| 정산 탭 월 picker 라벨 | "4월" 직접 박기 | `<span data-month-label>4월</span>` (JS picker가 갱신) |
| 다음 주 forecast | "5월 1주 예상" | "다음 주 예상" (월 추상화) |

- HTML에 "4월", "5월" 같은 월 텍스트를 박지 말 것.
- `index.html` 의 dyn-month 라벨은 footer init JS가 페이지 로드 시 일괄 갱신.
- 데이터 값(켤레 수)은 `patch_dashboard.py` 가 cron 시 ID로 패치 (`#ovw-kpi-total`, `#month-kpi-total` 등).

### 원칙 4 — 시작 고정점 ≠ 월 범위

- **시작 고정점**: `2026-04-17` (BR-001 출고 시작일). 변경 불가. 누적 계산의 시작점.
- **월 범위 필터**: `patch_dashboard.py` 는 시작 고정점 이후 모든 데이터를 읽되, 월별 KPI는 `cur_m = date.today().month` 으로 필터해서 채운다. `if mo != 4` 같은 월 하드코딩 금지.
- **주차 라벨 (W1/W2/W3)**: W1=4/17, W2=4/20~24, W3=4/27~ 이후 (= 진행중). 5월·6월 데이터는 자동으로 W3에 누적됨. (모멘텀 카드는 launch tracking 의미 유지.)

### 데이터 흐름 (시점 일치 작동 방식)

```
시트 (Google Sheets, 4/17~ 모든 row)
       ↓ daily-update.sh (매 평일 17:00)
patch_dashboard.py
  ├─ 누적 집계: 시작 고정점(4/17) 이후 전체 → ks/km/mc/total_* 등
  └─ 월별 집계: cur_m = today.month → mo_ks/mo_km/mo_mc/mo_total 등
       ↓
index.html 패치
  ├─ 누적 KPI (재고 탭): total_* 사용
  ├─ 월별 KPI (전체 출고/커머스 허브): mo_* 사용 (#ovw-kpi-*, #month-kpi-*)
  └─ dyn-month-range span: "M/1~M/D" 자동 채움
       ↓
브라우저 페이지 로드
  └─ JS init: .dyn-month 텍스트를 시스템 today의 월로 일괄 갱신
```

### 운영 체크리스트 (월말·월초)

월말 (마지막 영업일):
- [ ] 정산 탭에서 해당 월 [💾 저장] 클릭 → snapshot lock

월초 (첫 영업일):
- [ ] 대시보드 stale 라벨 점검: `grep -n '4월\|5월\|6월\|7월\|8월\|9월\|10월\|11월\|12월' index.html` (`dyn-month`/`data-month-label` 안에 있는 것만 OK)
- [ ] `const today = new Date('` 같은 하드코딩 재발 점검 (검출 시 알림): `grep -n "new Date('20" index.html`
- [ ] 첫 영업일 cron 결과 확인 — `M월 누계` 가 0으로 리셋된 후 새로운 데이터가 누적되는지

### Drift 발견 시 대응

증상 1: "5월 5일인데 dashboard에 4/30이 마지막으로 보임"
1. 시트에 5월 row 있는지 확인 (없으면 정상 — 출고 안 함)
2. cron 로그 확인: `tail ~/.cache/darimati-dashboard/daily-update.log`
3. patch 스크립트의 시작 고정점 필터 점검 (`patch_dashboard.py` 라인 66~69)

증상 2: "월별 KPI에 4월 데이터가 누적되어 있음 (5월인데)"
1. patch 스크립트 `cur_m` 도출이 정상인지 (`date.today().month`)
2. `mo_idx` 가 올바르게 현재월만 필터하는지 점검 (라인 138~)
3. 수동 실행 후 `M월 누계` 출력 확인: `~/code/darimati/inventory-dashboard/scripts/daily-update.sh`

증상 3: "라벨이 4월인데 데이터는 5월"
- `.dyn-month` JS init이 동작하는지 확인 (footer 영역 console.log)
- 페이지 새로고침 (캐시 강제 갱신 `Cmd+Shift+R`)

---

## Phase 로드맵

### Phase 1 (완료) — 변동 감지 + 알림
- Sheets + 옵시디언 hash 비교, 알림만

### Phase 2 (현재) — 자동 patch + push ✅
- 변동 시 `patch_dashboard.py` 호출 → index.html 자동 patch
- git commit + push 자동
- JS 문법 검증 후 push (실패 시 롤백)
- 매트 검토 단계 제거
- `AUTO_PUSH=false` 환경변수로 수동 모드 가능

### Phase 3 (예정) — Slack 알림
- `#all-darimati` Webhook 푸시
- 주간/월간 자동 요약

### 패치 적용 영역 (patch_dashboard.py)

**누적 (시작 고정점 4/17 이후 전체)**
- DATES, SALE/B2B/GIFT_DAILY, PLATFORM_DAILY (차트용 일별 데이터)
- DAILY_KCK/KKO/NAV/KTK (채널별 일별)
- SALE_BY_SIZE (사이즈별 누적 — 재고 burn rate 산출용)
- BIZ_DAYS (총 출고 영업일)
- weekSale/B2B/Days/Rate (W1/W2/W3 누적)
- 모멘텀 사이드 카드 (W1/W2/W3 · 일평균 · 다음 주 forecast)
- WEEK_TOTAL_ROWS · WEEK_LABEL
- 일별 시트 전체 합계 row
- SETTLEMENT_DEALS units (legacy)

**월별 (시스템 today의 월만)**
- `#ovw-kpi-*` (전체 출고 탭 KPI 5종 — total/sale/b2b/gift/avg/days)
- `#month-kpi-*` (커머스 허브 큰 KPI — total/sale/b2b)
- 채널 KPI 4종 (커머스 허브 — 킥/메이커스/네이버+톡/B2B 마야크루)
- PLATFORM_SHARE 도넛
- `#month-share-*` (채널 점유율 sub)
- `#ch-makers-mo`, `#ch-b2b-mo` (채널 매트릭스 비고)
- typeChart 라벨/데이터 (전체 출고 탭 도넛)
- `<span class="dyn-month-range">` (M/1~M/D 범위 텍스트)

### Phase 2의 안전장치
- patch 후 JS 문법 검증 (Node) → 실패 시 git checkout으로 롤백
- 변동 hash가 있어도 dashboard 매핑된 영역 변경 없으면 commit 안 함
- 옵시디언 잔여재고/HK 등은 자동 patch 안 함 (매트가 옵시디언만 갱신하면 hash 변동 → 다음 실행 시 알림으로 감지)

---

## 토큰 사용량

이 자동화는 **LLM 호출 없음**. 순수 shell + curl + sha256.

- Google Sheets gviz: 무료, 무제한
- 옵시디언: 로컬 파일 read
- macOS launchd: 시스템 기능

월 토큰 비용 = **0원**.

---

## Troubleshooting

**Q. 평일인데 알림이 안 와요**
- `~/.cache/darimati-dashboard/daily-update.log`에서 SKIP 사유 확인 (변동 없음 / 공휴일 / 주말)
- launchd 등록 확인: `launchctl list | grep darimati`

**Q. Sheets fetch 실패**
- `curl -v "URL"` 직접 테스트
- 시트 공유 설정이 anyone with link로 되어 있는지 확인 (지금 그래야 함)

**Q. 노트북 닫혀있어서 17시에 못 돌았다면?**
- launchd는 wake 후 누락된 실행 한 번 catch up
- 그래도 안 되면 수동 실행

**Q. Phase 2 자동 patch는 언제?**
- dashboard `index.html`이 `data/state.json` fetch로 분리되면 진행
- 매트 결정 후 추가 작업
