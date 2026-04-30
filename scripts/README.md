# DARIMATI Dashboard 자동 갱신

매 평일 17:00 KST · 공휴일 제외 · 변동분만 감지

운영 지침: Obsidian Vault `04_운영/inventory/auto-update-rules.md`

---

## 구성 파일

| 파일 | 역할 |
|------|------|
| `daily-update.sh` | 메인 스크립트 (변동 감지 + 알림) |
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

### Phase 1 (현재) — 변동 감지 + 알림
- Sheets + 옵시디언 hash 비교
- 변동 시 macOS 알림 + 로그
- 매트 수동 갱신 commit

### Phase 2 (예정) — 자동 patch
- `data/state.json` 외부 fetch 구조 도입 후
- 변동 시 state.json 자동 갱신 → git push

### Phase 3 (예정) — Slack 알림
- `#all-darimati` Webhook 푸시
- 주간/월간 자동 요약

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
