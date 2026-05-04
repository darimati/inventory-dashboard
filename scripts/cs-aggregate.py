#!/usr/bin/env python3
"""
DARIMATI CS 데이터 집계 — 옵시디언 CS/cases/*.md → 빈도 통계 JSON

사용법:
  python3 cs-aggregate.py [--cases-dir DIR] [--out FILE]

기본 입력:  ~/Documents/Obsidian Vault/CS/cases/
기본 출력:  stdout (JSON)

집계 차원:
  - 채널 / 유형 / 사이즈 / SKU / 태그 / 회복무기 / 결과
  - retention_rate = retained / (retained + refunded)
  - manual_candidates = 빈도 ≥ MIN_FREQ 인데 아직 매뉴얼에 없는 태그 (CS 지침서 §0)

인터페이스:
  - patch_dashboard.py 또는 CS 전용 패처가 본 출력을 index.html의 CS_DATA에 인젝트
"""
from __future__ import annotations
import argparse, json, os, re, sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

# 다리마티 옵시디언 구조: 인벤토리는 ~/Documents/Obsidian Vault, CS는 ~/Desktop/09_클로드_개발/obsidian/vault
# (2026-05-04 발견 — 두 vault 별도 운영. CS 통합은 별 작업)
DEFAULT_CASES = Path.home() / "Desktop/09_클로드_개발/obsidian/vault/CS/cases"
DEFAULT_GUIDE = Path.home() / "Desktop/09_클로드_개발/obsidian/vault/CS/DARIMATI_CS_지침서.md"
MIN_FREQ_FOR_CANDIDATE = 3

FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def parse_yaml_lite(text: str) -> dict:
    """YAML frontmatter 가벼운 파서 — pyyaml 의존 회피.
    지원: scalar, list (inline [a, b] / block - a), null/true/false, 숫자, 문자열, 따옴표.
    """
    out: dict = {}
    cur_key = None
    cur_list: list | None = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        if cur_list is not None and line.startswith("  - "):
            cur_list.append(_coerce(line[4:].strip()))
            continue
        if cur_list is not None:
            out[cur_key] = cur_list
            cur_list = None
        m = re.match(r"^([A-Za-z_][\w-]*)\s*:\s*(.*)$", line)
        if not m:
            continue
        k, v = m.group(1), m.group(2).strip()
        if v == "":
            cur_key, cur_list = k, []
            continue
        if v.startswith("[") and v.endswith("]"):
            inner = v[1:-1].strip()
            out[k] = [_coerce(x.strip()) for x in inner.split(",")] if inner else []
        else:
            out[k] = _coerce(v)
    if cur_list is not None and cur_key is not None:
        out[cur_key] = cur_list
    return out


def _coerce(v: str):
    if v.startswith('"') and v.endswith('"'):
        return v[1:-1]
    if v.startswith("'") and v.endswith("'"):
        return v[1:-1]
    if v.lower() in ("null", "~", ""):
        return None
    if v.lower() == "true":
        return True
    if v.lower() == "false":
        return False
    if re.match(r"^-?\d+$", v):
        return int(v)
    if re.match(r"^-?\d+\.\d+$", v):
        return float(v)
    return v


def parse_sections(body: str) -> dict:
    """## 헤더로 구분된 섹션을 dict로 추출. 빈 줄로 시작·끝 trim."""
    sections: dict = {}
    cur_h: str | None = None
    cur_lines: list[str] = []
    for line in body.splitlines():
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m:
            if cur_h is not None:
                sections[cur_h] = "\n".join(cur_lines).strip()
            cur_h = m.group(1).strip()
            cur_lines = []
        else:
            if cur_h is not None:
                cur_lines.append(line)
    if cur_h is not None:
        sections[cur_h] = "\n".join(cur_lines).strip()
    return sections


def load_cases(cases_dir: Path) -> list[dict]:
    cases = []
    if not cases_dir.exists():
        return cases
    for p in sorted(cases_dir.glob("CASE-*.md")):
        text = p.read_text(encoding="utf-8")
        m = FRONTMATTER_RE.match(text)
        if not m:
            continue
        meta = parse_yaml_lite(m.group(1))
        body = text[m.end():]
        sec = parse_sections(body)
        # 섹션 매핑 — 영문 키로 정규화
        meta["summary"] = sec.get("고객 호소", "")
        meta["response"] = sec.get("대응", "")
        meta["note"] = sec.get("메모", "")
        meta["_file"] = p.name
        cases.append(meta)
    return cases


def known_tags_in_guide(guide: Path) -> set[str]:
    """지침서 §2 회복 무기 표 등에 명시된 키워드를 추출 — manual_candidates 후보 판정에 사용.
    엄밀한 추출은 어려우니 한국어 주요 토큰만 본다 (insole/깔창/사이즈/235/240/285 등).
    """
    if not guide.exists():
        return set()
    text = guide.read_text(encoding="utf-8")
    tokens: set[str] = set()
    for m in re.finditer(r"insole|깔창|사이즈\s?다운|사이즈\s?업|235|240|242|285|too-big|too-small|size-exchange|refund|defect|배송|박음질|택", text):
        tokens.add(m.group(0).lower().replace(" ", ""))
    return tokens


def aggregate(cases: list[dict], known_tags: set[str]) -> dict:
    total = len(cases)
    by_channel: Counter = Counter()
    by_type: Counter = Counter()
    by_size: Counter = Counter()
    by_sku: Counter = Counter()
    by_tag: Counter = Counter()
    by_recovery: Counter = Counter()
    by_outcome: Counter = Counter()
    by_status: Counter = Counter()
    by_month: Counter = Counter()
    matrix_type_size: dict = defaultdict(lambda: Counter())

    for c in cases:
        ch = c.get("channel") or "미분류"
        ty = c.get("type") or "미분류"
        sz = c.get("size")
        sku = c.get("sku") or "미분류"
        tags = c.get("tags") or []
        rec = c.get("recovery_used") or []
        outcome = c.get("outcome") or "pending"
        status = c.get("status") or "접수"
        date = c.get("date")

        by_channel[ch] += 1
        by_type[ty] += 1
        by_sku[sku] += 1
        by_outcome[outcome] += 1
        by_status[status] += 1
        if sz is not None:
            by_size[str(sz)] += 1
        for t in tags:
            by_tag[str(t)] += 1
        for r in rec:
            by_recovery[str(r)] += 1
        if date:
            try:
                d = datetime.strptime(str(date), "%Y-%m-%d")
                by_month[d.strftime("%Y-%m")] += 1
            except ValueError:
                pass
        # 유형 × 사이즈 매트릭스 (대시보드 핵심 빈도 차트)
        size_key = str(sz) if sz is not None else "?"
        matrix_type_size[ty][size_key] += 1

    retained = by_outcome.get("retained", 0) + by_outcome.get("exchanged", 0)
    refunded = by_outcome.get("refunded", 0)
    decided = retained + refunded
    retention_rate = round(retained / decided, 3) if decided else None

    # 매뉴얼 갱신 후보 — 자주 등장하는 태그인데 지침서에 토큰이 안 보이는 것
    manual_candidates = []
    for tag, cnt in by_tag.most_common():
        if cnt < MIN_FREQ_FOR_CANDIDATE:
            break
        norm = tag.lower().replace(" ", "")
        if norm not in known_tags:
            manual_candidates.append({"tag": tag, "count": cnt})

    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "total": total,
        "by_channel": dict(by_channel),
        "by_type": dict(by_type),
        "by_size": dict(by_size),
        "by_sku": dict(by_sku),
        "by_tag": dict(by_tag.most_common()),
        "by_recovery": dict(by_recovery),
        "by_outcome": dict(by_outcome),
        "by_status": dict(by_status),
        "by_month": dict(sorted(by_month.items())),
        "matrix_type_size": {k: dict(v) for k, v in matrix_type_size.items()},
        "retention_rate": retention_rate,
        "manual_candidates": manual_candidates,
        "min_freq_threshold": MIN_FREQ_FOR_CANDIDATE,
        "cases": [
            {
                "case_id": c.get("case_id"),
                "date": str(c.get("date")) if c.get("date") else None,
                "channel": c.get("channel"),
                "order_no": c.get("order_no"),
                "type": c.get("type"),
                "sku": c.get("sku"),
                "size": c.get("size"),
                "tags": c.get("tags") or [],
                "recovery_used": c.get("recovery_used") or [],
                "status": c.get("status"),
                "outcome": c.get("outcome"),
                "summary": c.get("summary", ""),
                "response": c.get("response", ""),
                "note": c.get("note", ""),
                "file": c.get("_file"),
            }
            for c in cases
        ],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases-dir", default=str(DEFAULT_CASES))
    ap.add_argument("--guide", default=str(DEFAULT_GUIDE))
    ap.add_argument("--out", default="-", help="output file (- = stdout)")
    args = ap.parse_args()

    cases = load_cases(Path(args.cases_dir))
    known = known_tags_in_guide(Path(args.guide))
    result = aggregate(cases, known)
    payload = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out == "-":
        sys.stdout.write(payload + "\n")
    else:
        Path(args.out).write_text(payload + "\n", encoding="utf-8")
        print(f"wrote {args.out} ({result['total']} cases)", file=sys.stderr)


if __name__ == "__main__":
    main()
