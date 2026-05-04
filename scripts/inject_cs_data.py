#!/usr/bin/env python3
"""
DARIMATI CS 데이터 인젝트 — cs-out.json → index.html 의 CS_DATA placeholder 치환.

placeholder 패턴:
  window.CS_DATA = /* CS_DATA_START */{...}/* CS_DATA_END */;

사용법:
  python3 inject_cs_data.py <CS_JSON> <INDEX_HTML>
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

PATTERN = re.compile(r"/\* CS_DATA_START \*/.*?/\* CS_DATA_END \*/", re.DOTALL)

if len(sys.argv) < 3:
    print("Usage: inject_cs_data.py <CS_JSON> <INDEX_HTML>", file=sys.stderr)
    sys.exit(1)

cs_json_path = Path(sys.argv[1])
html_path = Path(sys.argv[2])

if not cs_json_path.exists():
    print(f"CS json not found: {cs_json_path}", file=sys.stderr)
    sys.exit(1)

cs_data = json.loads(cs_json_path.read_text(encoding="utf-8"))
# JSON.stringify 호환 (단일 라인이 아닌 minify) — diff가 너무 크지 않게 indent=0
payload = json.dumps(cs_data, ensure_ascii=False, separators=(",", ":"))

html = html_path.read_text(encoding="utf-8")
if not PATTERN.search(html):
    print("CS_DATA placeholder not found in index.html", file=sys.stderr)
    sys.exit(1)

# re.sub의 replacement string은 \1, \n 같은 escape 시퀀스를 해석하므로 lambda로 우회
# (JSON payload의 \\n 같은 escape가 실제 개행으로 풀리는 사고 방지)
replacement = f"/* CS_DATA_START */{payload}/* CS_DATA_END */"
new_html = PATTERN.sub(lambda _: replacement, html, count=1)
html_path.write_text(new_html, encoding="utf-8")
print(f"injected CS_DATA: {cs_data.get('total', 0)} cases", file=sys.stderr)
