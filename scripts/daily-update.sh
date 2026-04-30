#!/usr/bin/env bash
# === DARIMATI Inventory Dashboard 자동 갱신 (Phase 2 — 자동 patch + push) ===
# 매 평일 17:00 KST · 공휴일 제외 · 변동분만 감지
# 운영 지침: Obsidian Vault/04_운영/inventory/auto-update-rules.md

set -euo pipefail

# ── 설정 ────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
VAULT_DIR="${VAULT_DIR:-$HOME/Documents/Obsidian Vault}"
CACHE_DIR="${CACHE_DIR:-$HOME/.cache/darimati-dashboard}"
LOG_FILE="$CACHE_DIR/daily-update.log"
HASH_FILE="$CACHE_DIR/last-hash.txt"
SHEET_CACHE="$CACHE_DIR/sheet-out.json"
HOLIDAYS_FILE="$REPO_DIR/scripts/holidays-kr-$(date +%Y).txt"
PATCHER="$REPO_DIR/scripts/patch_dashboard.py"

SHEET_ID="${SHEET_ID:-1ibroQV42xuuvWg4P1kvaCw9RT_JxO9L-6lXVAgNjOhA}"
SHEET_GID_OUT="${SHEET_GID_OUT:-890805647}"
SHEET_URL="https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${SHEET_GID_OUT}"

NOTIFY="${NOTIFY:-true}"
AUTO_PUSH="${AUTO_PUSH:-true}"  # Phase 2 — 자동 commit + push

mkdir -p "$CACHE_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

notify() {
  [[ "$NOTIFY" != "true" ]] && return 0
  local title="$1" msg="$2"
  osascript -e "display notification \"$msg\" with title \"$title\" sound name \"Submarine\"" 2>/dev/null || true
}

# ── 1. 평일/주말 ─────────────────────────────
TODAY=$(date +%Y-%m-%d)
DOW=$(date +%u)
if [[ "$DOW" -ge 6 ]]; then
  log "SKIP · 주말 ($TODAY · DOW=$DOW)"
  exit 0
fi

# ── 2. 공휴일 ────────────────────────────────
if [[ -f "$HOLIDAYS_FILE" ]]; then
  if grep -qE "^$TODAY[[:space:]]*#" "$HOLIDAYS_FILE"; then
    name=$(grep "^$TODAY" "$HOLIDAYS_FILE" | head -1 | sed -E 's/^[^#]*#[[:space:]]*//')
    log "SKIP · 공휴일 ($TODAY · $name)"
    exit 0
  fi
fi

# ── 3. Sheets fetch ────────────────────────
log "Fetching Sheets gviz: gid=$SHEET_GID_OUT"
if ! curl -sf --max-time 30 -o "$SHEET_CACHE" "$SHEET_URL"; then
  log "ERROR · Sheets fetch 실패"
  notify "DARIMATI Dashboard" "Sheets fetch 실패 — 로그 확인"
  exit 1
fi

# ── 4. 옵시디언 핵심 파일 hash 비교 ───────────
OBSIDIAN_FILES=(
  "$VAULT_DIR/04_운영/inventory/inventory-prd.md"
  "$VAULT_DIR/04_운영/inventory/inventory-guide.md"
  "$VAULT_DIR/04_운영/inventory/channel-economics.md"
  "$VAULT_DIR/04_운영/inventory/hk-inventory.md"
)
hash_in=$(mktemp); trap 'rm -f "$hash_in"' EXIT
cat "$SHEET_CACHE" > "$hash_in"
for f in "${OBSIDIAN_FILES[@]}"; do
  [[ -f "$f" ]] && cat "$f" >> "$hash_in"
done
NEW_HASH=$(shasum -a 256 "$hash_in" | cut -d' ' -f1)
OLD_HASH=$(cat "$HASH_FILE" 2>/dev/null || echo "")

if [[ "$NEW_HASH" == "$OLD_HASH" ]]; then
  log "SKIP · 변동 없음"
  exit 0
fi

log "변동 감지 → 자동 patch 진행 (Phase 2)"

# ── 5. Repo 최신화 (cron 안전: working tree 강제 동기화) ──
cd "$REPO_DIR"
git fetch origin --quiet 2>>"$LOG_FILE" || { log "ERROR · git fetch 실패"; exit 1; }
git checkout main --quiet 2>>"$LOG_FILE" || true
git reset --hard origin/main --quiet 2>>"$LOG_FILE" || {
  log "ERROR · git reset 실패"
  notify "DARIMATI Dashboard" "git reset 실패"
  exit 1
}

# ── 6. patch_dashboard.py 실행 ─────────────
PATCH_SUMMARY=$(python3 "$PATCHER" "$SHEET_CACHE" "$REPO_DIR/index.html" 2>&1) || {
  log "ERROR · patch_dashboard.py 실패: $PATCH_SUMMARY"
  notify "DARIMATI Dashboard" "Patch 실패 — 로그 확인"
  exit 1
}
log "Patch summary: $PATCH_SUMMARY"

# ── 7. 변경 사항 있는지 확인 ───────────────
if git diff --quiet index.html; then
  log "patch 결과 변경 없음 (시트는 변동 있지만 dashboard 매핑된 영역 변동 없음)"
  echo "$NEW_HASH" > "$HASH_FILE"
  exit 0
fi

# ── 8. JS 문법 검증 ─────────────────────────
if ! node -e "
  const fs = require('fs');
  const html = fs.readFileSync('$REPO_DIR/index.html', 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/g);
  const code = m.slice(-1)[0].replace(/^<script>|<\/script>\$/g, '');
  new Function(code);
" 2>/dev/null; then
  log "ERROR · JS 문법 오류 — patch 롤백"
  git checkout -- index.html
  notify "DARIMATI Dashboard" "JS 문법 오류로 patch 롤백"
  exit 1
fi

# ── 9. Auto commit + push ──────────────────
if [[ "$AUTO_PUSH" == "true" ]]; then
  COMMIT_MSG="auto: $TODAY 출고 데이터 자동 반영

$PATCH_SUMMARY

자동 패치 (scripts/daily-update.sh + patch_dashboard.py)"
  git add index.html
  git commit -m "$COMMIT_MSG" --quiet
  if git push --quiet 2>>"$LOG_FILE"; then
    log "PUSH 성공"
    notify "DARIMATI Dashboard" "자동 갱신 완료 · $PATCH_SUMMARY"
  else
    log "ERROR · git push 실패"
    notify "DARIMATI Dashboard" "git push 실패"
    exit 1
  fi
else
  log "AUTO_PUSH=false · diff 보존, 매트가 수동 push"
  notify "DARIMATI Dashboard" "자동 patch 완료 · 수동 push 대기"
fi

# ── 10. 캐시 갱신 ──────────────────────────
echo "$NEW_HASH" > "$HASH_FILE"
log "DONE"
