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
- DATES, SALE/B2B/GIFT_DAILY, PLATFORM_DAILY
- DAILY_KCK/KKO/NAV/KTK
- SALE_BY_SIZE
- BIZ_DAYS
- PAGE 1 KPI (누적·실판매·B2B·증정·일평균)
- 4월 누계 KPI + 채널 KPI 4종 (퍼센트 자동 재계산)
- PLATFORM_SHARE 도넛
- weekSale/B2B/Days/Rate
- 모멘텀 사이드 카드 (W1/W2/W3 · 일평균 · 5월 예상)
- WEEK_TOTAL_ROWS · WEEK_LABEL
- 일별 시트 전체 합계 row
- SETTLEMENT_DEALS units (정산 & ROAS 탭)

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
