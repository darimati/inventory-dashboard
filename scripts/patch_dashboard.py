#!/usr/bin/env python3
"""
DARIMATI Inventory Dashboard — index.html 자동 patch
시트 데이터를 집계하여 hardcoded JS 변수들을 갱신.

사용법:
  python3 patch_dashboard.py <SHEET_JSON> <INDEX_HTML>

표준입력:
  - SHEET_JSON: gviz API 응답 (출고 시트)
  - INDEX_HTML: dashboard index.html

출력:
  - INDEX_HTML 파일을 in-place 수정
  - 변동된 영역 stdout 출력 (commit 메시지에 사용)
"""
import json, re, sys
from collections import defaultdict

if len(sys.argv) < 3:
    print("Usage: patch_dashboard.py <SHEET_JSON> <INDEX_HTML>", file=sys.stderr)
    sys.exit(1)

sheet_path = sys.argv[1]
html_path  = sys.argv[2]

# ── 1. 시트 파싱 ───────────────────────────
raw = open(sheet_path).read()
m = re.search(r'setResponse\((.*)\)', raw, re.DOTALL)
data = json.loads(m.group(1))
rows = data['table']['rows']

REAL = {'킥스타터','카카오메이커스','네이버','카카오톡스토어'}

def parse_date(d):
    if not d: return None
    m = re.match(r'Date\((\d+),(\d+),(\d+)\)', d)
    if m:
        y, mo, dy = int(m.group(1)), int(m.group(2))+1, int(m.group(3))
        return f'{mo}/{dy}', y, mo, dy
    return None

sale_by_date = defaultdict(int)
b2b_by_date = defaultdict(int)
gift_by_date = defaultdict(int)
ch_by_date = defaultdict(lambda: defaultdict(int))
ch_total = defaultdict(int)
total_sale = total_b2b = total_gift = 0
size_color_sale = defaultdict(lambda: defaultdict(int))

for r in rows:
    c = r['c']
    def g(i):
        return c[i]['v'] if i < len(c) and c[i] else None
    od = g(1) or g(0)
    if not od: continue
    pd = parse_date(od)
    if not pd: continue
    label, y, mo, dy = pd
    if mo != 4 or dy < 17: continue  # 4월 17일 이후만 (배송 시작일)
    if dy > 30: continue              # 4월만

    ch = (g(2) or '').strip()
    recipient = (g(6) or '')
    memo = (g(7) or '')
    color = (g(8) or '')
    size_raw = (g(9) or '').strip()
    size = re.sub(r'mm$|\s+', '', size_raw)[:3] if size_raw else ''

    # K열 (신발 수량) — 비어있거나 0이면 신발 미출고 (악세서리만 추가 발송 등) → SKIP
    qty_raw = g(10)
    if qty_raw is None or qty_raw == '' or int(qty_raw or 0) == 0:
        continue
    qty = int(qty_raw)

    if ch == '샘플' or '지인' in memo:
        kind = 'gift'
    elif ch == '마야크루' or recipient == '마야크루':
        kind = 'b2b'
    elif ch in REAL:
        kind = 'sale'
    else:
        continue

    if kind == 'sale':
        sale_by_date[label] += qty
        ch_by_date[ch][label] += qty
        ch_total[ch] += qty
        total_sale += qty
        if '그레이' in color and size: size_color_sale['G'][size] += qty
        elif '베이지' in color and size: size_color_sale['B'][size] += qty
    elif kind == 'b2b':
        b2b_by_date[label] += qty
        ch_total['마야크루'] += qty
        total_b2b += qty
    elif kind == 'gift':
        gift_by_date[label] += qty
        ch_total['샘플'] += qty
        total_gift += qty

dates = sorted(set(list(sale_by_date.keys())+list(b2b_by_date.keys())+list(gift_by_date.keys())),
               key=lambda d: tuple(map(int, d.split('/'))))
n = len(dates)
sale = [sale_by_date[d] for d in dates]
b2b  = [b2b_by_date[d] for d in dates]
gift = [gift_by_date[d] for d in dates]
plat = {ch: [ch_by_date[ch].get(d,0) for d in dates] for ch in ['킥스타터','카카오메이커스','네이버','카카오톡스토어']}
total_all = total_sale + total_b2b + total_gift
total_kr = total_sale + total_b2b
ks = ch_total['킥스타터']; km = ch_total['카카오메이커스']
nv = ch_total['네이버']; kt = ch_total['카카오톡스토어']; mc = ch_total['마야크루']
nv_kt = nv + kt
avg_sale = round(total_sale/n, 1) if n else 0
def pct(x): return round(x/total_kr*100) if total_kr else 0

# ── 2. HTML 패치 ──────────────────────────
html = open(html_path).read()

def js(arr): return '[' + ', '.join(str(x) for x in arr) + ']'

patches = []

patches.append((r"const DATES = \[[^\]]+\];",
                f"const DATES = [{','.join(repr(d) for d in dates)}];"))

plat_block = "const PLATFORM_DAILY = {\n"
for k in ['킥스타터','카카오메이커스','네이버','카카오톡스토어']:
    plat_block += f"  '{k}':{' '*(11-len(k.encode()))}{js(plat[k])},\n"
plat_block += "};"
patches.append((r"const PLATFORM_DAILY = \{[^}]+\};", plat_block))

patches.append((r"const SALE_DAILY = \[[^\]]+\];", f"const SALE_DAILY = {js(sale)};"))
patches.append((r"const B2B_DAILY  = \[[^\]]+\];", f"const B2B_DAILY  = {js(b2b)};"))
patches.append((r"const GIFT_DAILY = \[[^\]]+\];", f"const GIFT_DAILY = {js(gift)};"))
patches.append((r"const DAILY_KCK  = \[[^\]]+\];", f"const DAILY_KCK  = {js(plat['킥스타터'])};"))
patches.append((r"const DAILY_KKO  = \[[^\]]+\];", f"const DAILY_KKO  = {js(plat['카카오메이커스'])};"))
patches.append((r"const DAILY_NAV  = \[[^\]]+\];", f"const DAILY_NAV  = {js(plat['네이버'])};"))
patches.append((r"const DAILY_KTK  = \[[^\]]+\];", f"const DAILY_KTK  = {js(plat['카카오톡스토어'])};"))
patches.append((r"const BIZ_DAYS = \d+;", f"const BIZ_DAYS = {n};"))

# SALE_BY_SIZE
ssale = {c: dict(size_color_sale[c]) for c in ['G','B']}
sbs = ("const SALE_BY_SIZE = {\n"
    f"  GREY:  {{ 240:{ssale['G'].get('240',0)}, 250:{ssale['G'].get('250',0)}, 260:{ssale['G'].get('260',0)}, 270:{ssale['G'].get('270',0)}, 280:{ssale['G'].get('280',0)} }},\n"
    f"  BEIGE: {{ 240:{ssale['B'].get('240',0)}, 250:{ssale['B'].get('250',0)}, 260:{ssale['B'].get('260',0)}, 270:{ssale['B'].get('270',0)}, 280:{ssale['B'].get('280',0)} }},\n"
    "};")
patches.append((r"const SALE_BY_SIZE = \{[\s\S]*?\n\};", sbs))

# typeChart
patches.append((
    r"labels: \['실판매 \(\d+\)', 'B2B·행사 \(\d+\)', '증정·샘플 \(\d+\)'\],",
    f"labels: ['실판매 ({total_sale})', 'B2B·행사 ({total_b2b})', '증정·샘플 ({total_gift})'],"
))
patches.append((
    r"data: \[\d+, \d+, \d+\],\n      backgroundColor: \['#4ade80', '#a78bfa', '#374151'\]",
    f"data: [{total_sale}, {total_b2b}, {total_gift}],\n      backgroundColor: ['#4ade80', '#a78bfa', '#374151']"
))

# PAGE 1 KPI
patches.append((
    r'<div class="kpi-label">누적 출고</div>\s*<div class="kpi-value">\d+</div>\s*<div class="kpi-sub">켤레 \(4/17 ~ 4/\d+\)</div>',
    f'<div class="kpi-label">누적 출고</div>\n      <div class="kpi-value">{total_all}</div>\n      <div class="kpi-sub">켤레 (4/17 ~ {dates[-1] if dates else "—"})</div>'
))
patches.append((
    r'<div class="kpi-label">실판매 <span class="badge sale">SALE</span></div>\s*<div class="kpi-value green">\d+</div>',
    f'<div class="kpi-label">실판매 <span class="badge sale">SALE</span></div>\n      <div class="kpi-value green">{total_sale}</div>'
))
patches.append((
    r'<div class="kpi-label">B2B·행사 <span class="badge b2b">B2B</span></div>\s*<div class="kpi-value purple">\d+</div>',
    f'<div class="kpi-label">B2B·행사 <span class="badge b2b">B2B</span></div>\n      <div class="kpi-value purple">{total_b2b}</div>'
))
patches.append((
    r'<div class="kpi-label">증정·샘플 <span class="badge gift">GIFT</span></div>\s*<div class="kpi-value red">\d+</div>',
    f'<div class="kpi-label">증정·샘플 <span class="badge gift">GIFT</span></div>\n      <div class="kpi-value red">{total_gift}</div>'
))
patches.append((
    r'<div class="kpi-label">일평균 실판매</div>\s*<div class="kpi-value yellow">[\d.]+</div>\s*<div class="kpi-sub">켤레 / 출고일 \(\d+일\)</div>',
    f'<div class="kpi-label">일평균 실판매</div>\n      <div class="kpi-value yellow">{avg_sale}</div>\n      <div class="kpi-sub">켤레 / 출고일 ({n}일)</div>'
))

# 4월 누계 큰 KPI
patches.append((
    r'<div class="kpi-value green" style="font-size:40px;">\d+</div>\s*<div class="kpi-sub" style="line-height:1\.9;">실판매 <strong style="color:#4ade80;">\d+</strong> \+ B2B <strong style="color:#a78bfa;">\d+</strong> · 4/17~4/\d+</div>',
    f'<div class="kpi-value green" style="font-size:40px;">{total_kr}</div>\n      <div class="kpi-sub" style="line-height:1.9;">실판매 <strong style="color:#4ade80;">{total_sale}</strong> + B2B <strong style="color:#a78bfa;">{total_b2b}</strong> · 4/17~{dates[-1] if dates else "—"}</div>'
))

# 채널 KPI
for label, val, cls in [('킥스타터', ks, ''), ('카카오메이커스', km, ' green'),
                        (r'네이버 \+ 카카오톡', nv_kt, ' yellow'), (r'B2B · 마야크루', mc, ' purple')]:
    pat = rf'<div class="kpi-label">{label}</div>\s*<div class="kpi-value{cls}">\d+</div>\s*<div class="kpi-sub">\d+% · ([^<]+)</div>'
    plain_label = label.replace(r'\+', '+').replace(r'\.', '.')
    repl = lambda m, v=val, cls=cls, lbl=plain_label: \
        f'<div class="kpi-label">{lbl}</div>\n      <div class="kpi-value{cls}">{v}</div>\n      <div class="kpi-sub">{pct(v)}% · {m.group(1)}</div>'
    patches.append((pat, repl))

# PLATFORM_SHARE
ps = ("const PLATFORM_SHARE = [\n"
    f"  {{ name: '카카오메이커스',   count: {km}, color: '#d4b896' }},\n"
    f"  {{ name: '킥스타터',          count: {ks}, color: '#b0c4d8' }},\n"
    f"  {{ name: 'B2B · 마야크루',    count: {mc}, color: '#a78bfa' }},\n"
    f"  {{ name: '네이버',            count: {nv},  color: '#7c9bb5' }},\n"
    f"  {{ name: '카카오톡스토어',    count: {kt},  color: '#a0a0a0' }},\n"
    "];")
patches.append((r"const PLATFORM_SHARE = \[[\s\S]*?\n\];", ps))

# 점유율 타이틀 (실판매 103 + B2B 30 같은 sub-text 포함 변형)
patches.append((
    r"4월 누계 · 전체 \d+켤레 \(실판매 \d+ \+ B2B \d+\)",
    f"4월 누계 · 전체 {total_kr}켤레 (실판매 {total_sale} + B2B {total_b2b})"
))
patches.append((r"4월 누계 · 전체 \d+켤레(?! \()", f"4월 누계 · 전체 {total_kr}켤레"))

# 주별
def wk(label):
    m, d = map(int, label.split('/'))
    if m == 4 and d == 17: return 0
    if m == 4 and 20 <= d <= 24: return 1
    return 2
ws = [0,0,0]; wb = [0,0,0]; wd = [0,0,0]
for i, lab in enumerate(dates):
    w = wk(lab)
    ws[w] += sale[i]; wb[w] += b2b[i]
    if (sale[i]+b2b[i]+gift[i]) > 0: wd[w] += 1
wr = [round(ws[i]/wd[i],1) if wd[i]>0 else 0 for i in range(3)]

patches.append((r"const weekSale = \[[\d, ]+\];", f"const weekSale = {js(ws)};"))
patches.append((r"const weekB2B  = \[[\d, ]+\];", f"const weekB2B  = {js(wb)};"))
patches.append((r"const weekDays = \[[\d, ]+\];", f"const weekDays = {js(wd)};"))

# 모멘텀 W1/W2/W3 켤레
for label, val in [('W1 · 4/17', ws[0]), ('W2 · 4/20~24', ws[1]), (r'W3 · 4/27~ \(진행중\)', ws[2])]:
    pat = rf'({label}[\s\S]{{0,200}}?<div style="font-size:18px; font-weight:700;">)\d+(<span)'
    patches.append((pat, lambda m, v=val: m.group(1) + str(v) + m.group(2)))

# 모멘텀 일평균
patches.append((r'(W1 · 4/17[\s\S]*?<div style="color:#aaa;">)[\d.]+(</div>)',
                lambda m: m.group(1) + str(wr[0]) + m.group(2)))
patches.append((r'(W2 · 4/20~24[\s\S]*?<div style="color:#f87171;">)[\d.]+( ↓</div>)',
                lambda m: m.group(1) + str(wr[1]) + m.group(2)))
patches.append((r'(W3 · 4/27~ \(진행중\)[\s\S]*?<div style="color:#facc15;">)[\d.]+( ↑</div>)',
                lambda m: m.group(1) + str(wr[2]) + m.group(2)))

# 5월 1주 예상
forecast = round(wr[2] * 5)
patches.append((
    r'(5월 1주 예상 \(W3 페이스 기준\)</div>\s*<div style="font-size:22px; font-weight:700; color:#4ade80;">)~\d+',
    lambda m: m.group(1) + f'~{forecast}'
))
patches.append((
    r'<div style="color:#555; font-size:10px; margin-top:4px;">[\d.]+/일 × \d+ 영업일</div>',
    f'<div style="color:#555; font-size:10px; margin-top:4px;">{wr[2]}/일 × 5 영업일</div>'
))

# WEEK_TOTAL_ROWS
def aw(s, e):
    t = {'kck':0,'kko':0,'nav':0,'ktk':0,'sale':0,'b2b':0,'gift':0}
    for i in range(s, e+1):
        t['kck'] += plat['킥스타터'][i]
        t['kko'] += plat['카카오메이커스'][i]
        t['nav'] += plat['네이버'][i]
        t['ktk'] += plat['카카오톡스토어'][i]
        t['sale'] += sale[i]; t['b2b'] += b2b[i]; t['gift'] += gift[i]
    t['total'] = t['sale']+t['b2b']+t['gift']
    return t
w1e = w2e = -1
for i, lab in enumerate(dates):
    m, d = map(int, lab.split('/'))
    if m == 4 and d <= 17: w1e = i
    if m == 4 and d <= 24: w2e = i
w1d = aw(0, w1e); w2d = aw(w1e+1, w2e); w3d = aw(w2e+1, n-1)
wt = ("const WEEK_TOTAL_ROWS = [\n"
    f"  {{ after: {w1e}, label: 'W1 소계', kck:{w1d['kck']}, kko:{w1d['kko']},  nav:{w1d['nav']}, ktk:{w1d['ktk']}, sale:{w1d['sale']}, b2b:{w1d['b2b']},  gift:{w1d['gift']}, total:{w1d['total']} }},\n"
    f"  {{ after: {w2e}, label: 'W2 소계', kck:{w2d['kck']},  kko:{w2d['kko']}, nav:{w2d['nav']}, ktk:{w2d['ktk']}, sale:{w2d['sale']}, b2b:{w2d['b2b']}, gift:{w2d['gift']}, total:{w2d['total']} }},\n"
    f"  {{ after: {n-1}, label: 'W3 소계', kck:{w3d['kck']}, kko:{w3d['kko']}, nav:{w3d['nav']}, ktk:{w3d['ktk']}, sale:{w3d['sale']}, b2b:{w3d['b2b']},  gift:{w3d['gift']}, total:{w3d['total']} }},\n"
    "];")
patches.append((r"const WEEK_TOTAL_ROWS = \[[\s\S]*?\n\];", wt))

# WEEK_LABEL
wl = []
for lab in dates:
    m, d = map(int, lab.split('/'))
    if m == 4 and d == 17: wl.append('W1')
    elif m == 4 and 20 <= d <= 24: wl.append('W2')
    else: wl.append('W3')
patches.append((r"const WEEK_LABEL = \[[^\]]+\];",
                f"const WEEK_LABEL = [{','.join(repr(x) for x in wl)}];"))

# 일별 시트 합계
total_kck = sum(plat['킥스타터']); total_kko = sum(plat['카카오메이커스'])
total_nav = sum(plat['네이버']);   total_ktk = sum(plat['카카오톡스토어'])
footer = (
    '<tr class="total">\n'
    '  <td colspan="2">전체</td>\n'
    f'  <td class="num" style="color:#b0c4d8;">{total_kck}</td>\n'
    f'  <td class="num" style="color:#d4b896;">{total_kko}</td>\n'
    f'  <td class="num" style="color:#7c9bb5;">{total_nav}</td>\n'
    f'  <td class="num" style="color:#a0a0a0;">{total_ktk}</td>\n'
    f'  <td class="num green">{total_sale}</td>\n'
    f'  <td class="num" style="color:#a78bfa;">{total_b2b}</td>\n'
    f'  <td class="num" style="color:#6b7280;">{total_gift}</td>\n'
    f'  <td class="num">{total_all}</td>\n'
    '</tr>'
)
patches.append((r'<tr class="total">\s*<td colspan="2">전체</td>[\s\S]*?</tr>', footer))

# SETTLEMENT units
for label, val in [('카카오메이커스', km), ('네이버 스마트스토어', nv),
                   ('카카오톡스토어', kt), ('킥스타터', ks)]:
    patches.append((rf"('{label}':\s*\{{\s*units:\s*)\d+", lambda m, v=val: m.group(1) + str(v)))

# Apply
applied = 0
for pattern, repl in patches:
    new_html, c = re.subn(pattern, repl, html, count=1)
    if c: applied += 1; html = new_html

open(html_path, 'w').write(html)

# Output summary (commit message용)
print(f"4월 누계: {total_sale}/{total_b2b}/{total_gift} = {total_all} ({n}일)")
print(f"메이커스 {km} · 킥 {ks} · B2B {mc} · 네 {nv} · 톡 {kt} · 증정 {total_gift}")
print(f"W1={ws[0]}/{wr[0]} W2={ws[1]}/{wr[1]} W3={ws[2]}/{wr[2]}")
print(f"패치 적용: {applied}/{len(patches)}")
