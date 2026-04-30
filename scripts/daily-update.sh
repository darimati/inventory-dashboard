#!/usr/bin/env bash
# === DARIMATI Inventory Dashboard 자동 갱신 ===
# 매 평일 17:00 KST · 공휴일 제외 · 변동분만 감지
# 운영 지침: Obsidian Vault/04_운영/inventory/auto-update-rules.md

set -euo pipefail

# ── 설정 (환경변수로 override 가능) ──────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
VAULT_DIR="${VAULT_DIR:-$HOME/Documents/Obsidian Vault}"
CACHE_DIR="${CACHE_DIR:-$HOME/.cache/darimati-dashboard}"
LOG_FILE="$CACHE_DIR/daily-update.log"
HASH_FILE="$CACHE_DIR/last-hash.txt"
SHEET_CACHE="$CACHE_DIR/sheet-out.json"
HOLIDAYS_FILE="$REPO_DIR/scripts/holidays-kr-$(date +%Y).txt"

# Google Sheets
SHEET_ID="${SHEET_ID:-1ibroQV42xuuvWg4P1kvaCw9RT_JxO9L-6lXVAgNjOhA}"
SHEET_GID_OUT="${SHEET_GID_OUT:-890805647}"
SHEET_URL="https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${SHEET_GID_OUT}"

# 알림 (macOS notification)
NOTIFY="${NOTIFY:-true}"

mkdir -p "$CACHE_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

notify() {
  [[ "$NOTIFY" != "true" ]] && return 0
  local title="$1" msg="$2"
  osascript -e "display notification \"$msg\" with title \"$title\" sound name \"Submarine\"" 2>/dev/null || true
}

# ── 1. 평일 / 주말 체크 ─────────────────────────
TODAY=$(date +%Y-%m-%d)
DOW=$(date +%u)  # 1=Mon ... 7=Sun
TODAY_KR_LABEL=$(date +%-m/%-d)

if [[ "$DOW" -ge 6 ]]; then
  log "SKIP · 주말 ($TODAY · DOW=$DOW)"
  exit 0
fi

# ── 2. 공휴일 체크 ─────────────────────────────
if [[ -f "$HOLIDAYS_FILE" ]]; then
  if grep -qE "^$TODAY[[:space:]]*#" "$HOLIDAYS_FILE"; then
    holiday_name=$(grep "^$TODAY" "$HOLIDAYS_FILE" | head -1 | sed -E 's/^[^#]*#[[:space:]]*//')
    log "SKIP · 공휴일 ($TODAY · $holiday_name)"
    exit 0
  fi
else
  log "WARN · 공휴일 파일 없음: $HOLIDAYS_FILE"
fi

# ── 3. Google Sheets 출고 시트 fetch ────────────
log "Fetching Sheets gviz: gid=$SHEET_GID_OUT"
if ! curl -sf --max-time 30 -o "$SHEET_CACHE" "$SHEET_URL"; then
  log "ERROR · Sheets fetch 실패 (네트워크/권한)"
  notify "DARIMATI Dashboard" "Sheets fetch 실패 — 로그 확인"
  exit 1
fi

# ── 4. 옵시디언 핵심 파일 ─────────────────────
OBSIDIAN_FILES=(
  "$VAULT_DIR/04_운영/inventory/inventory-prd.md"
  "$VAULT_DIR/04_운영/inventory/inventory-guide.md"
  "$VAULT_DIR/04_운영/inventory/channel-economics.md"
  "$VAULT_DIR/04_운영/inventory/hk-inventory.md"
)

# ── 5. Hash 계산 (변동 감지) ──────────────────
hash_input_file=$(mktemp)
trap 'rm -f "$hash_input_file"' EXIT

cat "$SHEET_CACHE" > "$hash_input_file"
for f in "${OBSIDIAN_FILES[@]}"; do
  if [[ -f "$f" ]]; then
    cat "$f" >> "$hash_input_file"
  else
    log "WARN · 옵시디언 파일 없음: $f"
  fi
done

NEW_HASH=$(shasum -a 256 "$hash_input_file" | cut -d' ' -f1)
OLD_HASH=$(cat "$HASH_FILE" 2>/dev/null || echo "")

# ── 6. 변동 감지 결과 ────────────────────────
if [[ "$NEW_HASH" == "$OLD_HASH" ]]; then
  log "SKIP · 변동 없음 (hash $NEW_HASH)"
  exit 0
fi

# ── 7. 출고일 검증 (오늘자 출고 행 존재 여부) ──────
month_idx=$(($(date +%-m) - 1))  # gviz Date(year, monthIdx, day)
day=$(date +%-d)
year=$(date +%Y)
PATTERN="Date(${year},${month_idx},${day})"
TODAY_OUT_COUNT=$(grep -o "$PATTERN" "$SHEET_CACHE" | wc -l | tr -d ' ')

# ── 8. 변동 감지 보고 (Phase 1 — 자동 patch 안 함) ──
log "변동 감지"
log "  · OLD hash: ${OLD_HASH:-(none)}"
log "  · NEW hash: $NEW_HASH"
log "  · 오늘($TODAY_KR_LABEL) 출고 행: $TODAY_OUT_COUNT"
log "  · 데이터 소스: 옵시디언 4개 파일 + 시트(gid=$SHEET_GID_OUT)"
log "  · 다음 단계: 매트가 dashboard 검토 후 commit"

if [[ "${TODAY_OUT_COUNT}" -gt 0 ]]; then
  notify "DARIMATI Dashboard" "출고 변동 감지 (${TODAY_OUT_COUNT}건) — 대시보드 갱신 검토"
else
  notify "DARIMATI Dashboard" "데이터 변동 감지 — 대시보드 검토"
fi

# ── 9. 캐시 갱신 ────────────────────────────
echo "$NEW_HASH" > "$HASH_FILE"

log "DONE"
