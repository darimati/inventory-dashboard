#!/usr/bin/env python3
"""
DARIMATI Inventory Dashboard — index.html 자동 patch
시트 데이터를 집계하여 hardcoded JS 변수들을 갱신.

사용법:
  python3 patch_dashboard.py <SHEET_JSON> <INDEX_HTML>

표준입력:
  - SHEET_JSON: gviz API 응답 (발주_취합양식 시트)
  - INDEX_HTML: dashboard index.html

출력:
  - INDEX_HTML 파일을 in-place 수정
  - 변동된 영역 stdout 출력 (commit 메시지에 사용)
"""
import json, re, sys
from collections import defaultdict
from datetime import date as _DateTop

if len(sys.argv) < 3:
    print("Usage: patch_dashboard.py <SHEET_JSON> <INDEX_HTML> [INVENTORY_JSON]", file=sys.stderr)
    sys.exit(1)

sheet_path = sys.argv[1]
html_path  = sys.argv[2]

# ── 1. 시트 파싱 ───────────────────────────
raw = open(sheet_path).read()
m = re.search(r'setResponse\((.*)\)', raw, re.DOTALL)
data = json.loads(m.group(1))
rows = data['table']['rows']

REAL = {'킥스타터','카카오메이커스','네이버','카카오톡스토어'}

# 부자재 컬럼 (시트 인덱스): M=12 슈레이스, O=14 스티커, P=15 모자, S=18 타월, T=19 벨트, U=20 플라스크, V=21 슈백
ACC_COLS = [12, 14, 15, 18, 19, 20, 21]
PKG_THRESHOLD = 5  # 부자재 5개 이상 → 풀세트로 자동 인식

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
ch_pkg = defaultdict(int)   # 채널별 풀세트 켤레 (시트 자동 감지)
ch_unit = defaultdict(int)  # 채널별 단품 켤레 (시트 자동 감지)
ch_pkg_by_month = defaultdict(lambda: defaultdict(int))
ch_unit_by_month = defaultdict(lambda: defaultdict(int))
total_sale = total_b2b = total_gift = 0
size_color_sale = defaultdict(lambda: defaultdict(int))

# ── 재고 자동차감: 기준점 실사 − 이후 출고 ──
INV_BASE = {
    'G': {'240': 188, '250': 27, '260': 89, '270': 19, '280': 6},
    'B': {'240': 11,  '250': 26, '260': 29, '270': 34, '280': 38}
}
INV_BASE_DATE = (2026, 6, 10)  # 6/10 Jiun 실사 기준
inv_deduct = {'G': defaultdict(int), 'B': defaultdict(int)}

# ── N배송 판매 차감: 6/9 이후 네이버 대표상품(13462747167) 판매분 ──
NSHIP_BASE_DATE = (2026, 6, 9)
nship_sold = defaultdict(int)  # 사이즈별 판매 차감

for r in rows:
    c = r['c']
    def g(i):
        return c[i]['v'] if i < len(c) and c[i] else None
    od = g(1) or g(0)
    if not od: continue
    pd = parse_date(od)
    if not pd: continue
    label, y, mo, dy = pd
    # 시작 고정점: 2026-04-17 (BR-001 런칭일). 이후 모든 월 포함.
    if y < 2026: continue
    if y == 2026 and mo < 4: continue
    if y == 2026 and mo == 4 and dy < 17: continue

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

    # 재고 차감: 기준일 이후 모든 출고 (채널 무관)
    if (y, mo, dy) > INV_BASE_DATE:
        if '그레이' in color and size:
            inv_deduct['G'][size] += qty
        elif '베이지' in color and size:
            inv_deduct['B'][size] += qty

    # N배송 차감: 6/9 이후 네이버 채널 판매분 (대표상품 13462747167)
    if ch == '네이버' and (y, mo, dy) >= NSHIP_BASE_DATE and size:
        nship_sold[size] += qty

    if ch == '샘플' or ch == '증정' or '지인' in memo:
        kind = 'gift'
    elif ch == '마야크루' or recipient == '마야크루':
        kind = 'b2b'
    elif ch in REAL:
        kind = 'sale'
    else:
        continue

    # 풀세트/단품 자동 감지 (부자재 5개 이상이면 풀세트)
    acc_count = 0
    for ai in ACC_COLS:
        v = g(ai)
        if v is not None and v != '' and float(v or 0) >= 1:
            acc_count += 1
    is_pkg = acc_count >= PKG_THRESHOLD

    if kind == 'sale':
        sale_by_date[label] += qty
        ch_by_date[ch][label] += qty
        ch_total[ch] += qty
        if is_pkg: ch_pkg[ch] += qty
        else:      ch_unit[ch] += qty
        ym = f"{y}-{mo:02d}"
        if is_pkg: ch_pkg_by_month[ym][ch] += qty
        else:      ch_unit_by_month[ym][ch] += qty
        total_sale += qty
        if '그레이' in color and size: size_color_sale['G'][size] += qty
        elif '베이지' in color and size: size_color_sale['B'][size] += qty
    elif kind == 'b2b':
        b2b_by_date[label] += qty
        ch_total['마야크루'] += qty
        if is_pkg: ch_pkg['마야크루'] += qty
        else:      ch_unit['마야크루'] += qty
        ym = f"{y}-{mo:02d}"
        if is_pkg: ch_pkg_by_month[ym]['마야크루'] += qty
        else:      ch_unit_by_month[ym]['마야크루'] += qty
        total_b2b += qty
    elif kind == 'gift':
        gift_by_date[label] += qty
        ch_total['샘플'] += qty
        if is_pkg: ch_pkg['샘플'] += qty
        else:      ch_unit['샘플'] += qty
        ym = f"{y}-{mo:02d}"
        if is_pkg: ch_pkg_by_month[ym]['샘플'] += qty
        else:      ch_unit_by_month[ym]['샘플'] += qty
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

# ── 1.5 월별 집계 (시점 일치 — 월별 탭은 모두 시스템 today의 월 기준) ──
# 누적 vs 월별 분리: 부자재/KR재고/HK재고는 누적, 매출/출고량/ROAS는 월별.
from datetime import date as _Date
cur_m = _Date.today().month
mo_idx = [i for i, d in enumerate(dates) if int(d.split('/')[0]) == cur_m]
mo_dates_list = [dates[i] for i in mo_idx]
mo_n = len(mo_idx)
mo_sale = sum(sale[i] for i in mo_idx)
mo_b2b  = sum(b2b[i]  for i in mo_idx)
mo_gift = sum(gift[i] for i in mo_idx)
mo_total = mo_sale + mo_b2b + mo_gift
mo_total_kr = mo_sale + mo_b2b
mo_ks = sum(plat['킥스타터'][i]       for i in mo_idx)
mo_km = sum(plat['카카오메이커스'][i] for i in mo_idx)
mo_nv = sum(plat['네이버'][i]         for i in mo_idx)
mo_kt = sum(plat['카카오톡스토어'][i] for i in mo_idx)
mo_mc = sum(b2b[i] for i in mo_idx)  # B2B = 마야크루만
mo_avg_sale = round(mo_sale/mo_n, 1) if mo_n else 0
mo_range = f"{mo_dates_list[0]}~{mo_dates_list[-1]}" if mo_dates_list else f"{cur_m}/1~"
def mo_pct(x): return round(x/mo_total_kr*100) if mo_total_kr else 0

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

# 월별 (시점 일치 — 토글로 차트/KPI 전환)
mo_sale_arr = [sale[i] for i in mo_idx]
mo_b2b_arr  = [b2b[i]  for i in mo_idx]
mo_gift_arr = [gift[i] for i in mo_idx]
patches.append((r"const MO_DATES = \[[^\]]*\];", f"const MO_DATES = [{','.join(repr(d) for d in mo_dates_list)}];"))
patches.append((r"const MO_SALE_DAILY = \[[^\]]*\];", f"const MO_SALE_DAILY = {js(mo_sale_arr)};"))
patches.append((r"const MO_B2B_DAILY  = \[[^\]]*\];", f"const MO_B2B_DAILY  = {js(mo_b2b_arr)};"))
patches.append((r"const MO_GIFT_DAILY = \[[^\]]*\];", f"const MO_GIFT_DAILY = {js(mo_gift_arr)};"))
patches.append((r"const MO_RANGE = '[^']*';", f"const MO_RANGE = '{mo_range}';"))

# ── 직전 7일 캘린더 (차트용 — 출고 0인 날 포함) ──
from datetime import timedelta as _Td
_today = _Date.today()
last7_calendar = [(_today - _Td(days=6-i)) for i in range(7)]  # 오래된 날 → 최신 날
last7_labels = [f"{d.month}/{d.day}" for d in last7_calendar]
last7_sale = [sale_by_date.get(lbl, 0) for lbl in last7_labels]
last7_b2b  = [b2b_by_date.get(lbl, 0)  for lbl in last7_labels]
last7_gift = [gift_by_date.get(lbl, 0) for lbl in last7_labels]
patches.append((r"const LAST7_DATES = \[[^\]]*\];", f"const LAST7_DATES = [{','.join(repr(d) for d in last7_labels)}];"))
patches.append((r"const LAST7_SALE_DAILY = \[[^\]]*\];", f"const LAST7_SALE_DAILY = {js(last7_sale)};"))
patches.append((r"const LAST7_B2B_DAILY  = \[[^\]]*\];", f"const LAST7_B2B_DAILY  = {js(last7_b2b)};"))
patches.append((r"const LAST7_GIFT_DAILY = \[[^\]]*\];", f"const LAST7_GIFT_DAILY = {js(last7_gift)};"))
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

# typeChart (전체 출고 탭 = 월별)
patches.append((
    r"labels: \['실판매 \(\d+\)', 'B2B·행사 \(\d+\)', '증정·샘플 \(\d+\)'\],",
    f"labels: ['실판매 ({mo_sale})', 'B2B·행사 ({mo_b2b})', '증정·샘플 ({mo_gift})'],"
))
patches.append((
    r"data: \[\d+, \d+, \d+\],\n      backgroundColor: \['#4ade80', '#a78bfa', '#374151'\]",
    f"data: [{mo_sale}, {mo_b2b}, {mo_gift}],\n      backgroundColor: ['#4ade80', '#a78bfa', '#374151']"
))

# 전체 출고 탭 KPI (월별 — 시점 일치)
patches.append((r'(id="ovw-kpi-total">)\d+',  lambda m, v=mo_total:    m.group(1) + str(v)))
patches.append((r'(id="ovw-kpi-sale">)\d+',   lambda m, v=mo_sale:     m.group(1) + str(v)))
patches.append((r'(id="ovw-kpi-b2b">)\d+',    lambda m, v=mo_b2b:      m.group(1) + str(v)))
patches.append((r'(id="ovw-kpi-gift">)\d+',   lambda m, v=mo_gift:     m.group(1) + str(v)))
patches.append((r'(id="ovw-kpi-avg">)[\d.]+', lambda m, v=mo_avg_sale: m.group(1) + str(v)))
patches.append((r'(id="ovw-kpi-days">)\d+',   lambda m, v=mo_n:        m.group(1) + str(v)))

# 커머스 허브 큰 KPI (월별)
patches.append((r'(id="month-kpi-total">)\d+', lambda m, v=mo_total_kr: m.group(1) + str(v)))
patches.append((r'(id="month-kpi-sale">)\d+',  lambda m, v=mo_sale:     m.group(1) + str(v)))
patches.append((r'(id="month-kpi-b2b">)\d+',   lambda m, v=mo_b2b:      m.group(1) + str(v)))

# 채널 KPI 4종 (커머스 허브 = 월별)
for label, val, cls in [('킥스타터', mo_ks, ''), ('카카오메이커스', mo_km, ' green'),
                        (r'네이버 \+ 카카오톡', mo_nv+mo_kt, ' yellow'), (r'B2B · 마야크루', mo_mc, ' purple')]:
    pat = rf'<div class="kpi-label">{label}</div>\s*<div class="kpi-value{cls}">\d+</div>\s*<div class="kpi-sub">\d+% · ([^<]+)</div>'
    plain_label = label.replace(r'\+', '+').replace(r'\.', '.')
    repl = lambda m, v=val, cls=cls, lbl=plain_label: \
        f'<div class="kpi-label">{lbl}</div>\n      <div class="kpi-value{cls}">{v}</div>\n      <div class="kpi-sub">{mo_pct(v)}% · {m.group(1)}</div>'
    patches.append((pat, repl))

# PLATFORM_SHARE (커머스 허브 도넛 = 월별)
ps = ("const PLATFORM_SHARE = [\n"
    f"  {{ name: '카카오메이커스',   count: {mo_km}, color: '#d4b896' }},\n"
    f"  {{ name: '킥스타터',          count: {mo_ks}, color: '#b0c4d8' }},\n"
    f"  {{ name: 'B2B · 마야크루',    count: {mo_mc}, color: '#a78bfa' }},\n"
    f"  {{ name: '네이버',            count: {mo_nv},  color: '#7c9bb5' }},\n"
    f"  {{ name: '카카오톡스토어',    count: {mo_kt},  color: '#a0a0a0' }},\n"
    "];")
patches.append((r"const PLATFORM_SHARE = \[[\s\S]*?\n\];", ps))

# 채널 점유율 sub (월별)
patches.append((r'(id="month-share-total">)\d+', lambda m, v=mo_total_kr: m.group(1) + str(v)))
patches.append((r'(id="month-share-sale">)\d+',  lambda m, v=mo_sale:     m.group(1) + str(v)))
patches.append((r'(id="month-share-b2b">)\d+',   lambda m, v=mo_b2b:      m.group(1) + str(v)))

# dyn-month-range (월별 탭 KPI sub의 날짜 범위 — 여러 곳에 있어 count=0)
patches.append((
    r'<span class="dyn-month-range">[^<]*</span>',
    f'<span class="dyn-month-range">{mo_range}</span>',
    0
))

# ── 주별 동적 계산 (W1=런칭일, W2=첫 정규주, W3+=캘린더 주 단위) ──
from datetime import timedelta as _Td2
_W3_START = _Date(2026, 4, 27)  # W3 시작 월요일

def assign_week(label):
    m, d = map(int, label.split('/'))
    dt = _Date(2026, m, d)
    if dt == _Date(2026, 4, 17): return 0   # W1
    if _Date(2026, 4, 20) <= dt <= _Date(2026, 4, 24): return 1  # W2
    return max(2, (dt - _W3_START).days // 7 + 2)

_max_wk = max(assign_week(d) for d in dates) if dates else 2
_nw = _max_wk + 1

ws = [0]*_nw; wb = [0]*_nw; wd = [0]*_nw
for i, lab in enumerate(dates):
    w = assign_week(lab)
    ws[w] += sale[i]; wb[w] += b2b[i]
    if (sale[i]+b2b[i]+gift[i]) > 0: wd[w] += 1
wr = [round(ws[i]/wd[i],1) if wd[i]>0 else 0 for i in range(_nw)]

# 주별 라벨 생성
_week_labels = ['W1  (4/17)', 'W2  (4/20~24)']
_today_wk = _Date.today()
for wi in range(2, _nw):
    mon = _W3_START + _Td2(days=(wi-2)*7)
    fri = mon + _Td2(days=4)
    rng = f"{mon.month}/{mon.day}~{fri.month}/{fri.day}"
    is_current = mon <= _today_wk <= fri + _Td2(days=2)
    _week_labels.append(f"W{wi+1}  ({rng}{', 진행중' if is_current else ''})")

patches.append((r"const weekLabels = \[[^\]]+\];",
                f"const weekLabels = [{','.join(repr(l) for l in _week_labels)}];"))
patches.append((r"const weekSale = \[[\d, ]+\];", f"const weekSale = {js(ws)};"))
patches.append((r"const weekB2B  = \[[\d, ]+\];", f"const weekB2B  = {js(wb)};"))
patches.append((r"const weekDays = \[[\d, ]+\];", f"const weekDays = {js(wd)};"))

# (모멘텀 사이드바는 JS 동적 렌더링으로 전환 — HTML 패치 불필요)

# WEEK_TOTAL_ROWS (동적)
def aw(s, e):
    t = {'kck':0,'kko':0,'nav':0,'ktk':0,'sale':0,'b2b':0,'gift':0}
    for i in range(s, min(e+1, n)):
        t['kck'] += plat['킥스타터'][i]
        t['kko'] += plat['카카오메이커스'][i]
        t['nav'] += plat['네이버'][i]
        t['ktk'] += plat['카카오톡스토어'][i]
        t['sale'] += sale[i]; t['b2b'] += b2b[i]; t['gift'] += gift[i]
    t['total'] = t['sale']+t['b2b']+t['gift']
    return t

# 주별 인덱스 범위 계산
_wk_ranges = [[] for _ in range(_nw)]
for i, lab in enumerate(dates):
    _wk_ranges[assign_week(lab)].append(i)

wt = "const WEEK_TOTAL_ROWS = [\n"
for wi in range(_nw):
    if not _wk_ranges[wi]: continue
    s, e = _wk_ranges[wi][0], _wk_ranges[wi][-1]
    wd_data = aw(s, e)
    wt += f"  {{ after: {e}, label: 'W{wi+1} 소계', kck:{wd_data['kck']}, kko:{wd_data['kko']}, nav:{wd_data['nav']}, ktk:{wd_data['ktk']}, sale:{wd_data['sale']}, b2b:{wd_data['b2b']}, gift:{wd_data['gift']}, total:{wd_data['total']} }},\n"
wt += "];"
patches.append((r"const WEEK_TOTAL_ROWS = \[[\s\S]*?\n\];", wt))

# WEEK_LABEL (동적)
wl = [f'W{assign_week(lab)+1}' for lab in dates]
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

# SETTLEMENT units (legacy SETTLEMENT_DEALS 호환 — 향후 deprecated)
for label, val in [('카카오메이커스', km), ('네이버 스마트스토어', nv),
                   ('카카오톡스토어', kt), ('킥스타터', ks)]:
    patches.append((rf"('{label}':\s*\{{\s*units:\s*)\d+", lambda m, v=val: m.group(1) + str(v)))

# CHANNEL_BREAKDOWN_AUTO (시트 자동 감지 — 풀세트/단품 분리)
ch_keys = [
    ('카카오메이커스', '카카오메이커스'),
    ('네이버 스마트스토어', '네이버'),
    ('카카오톡스토어', '카카오톡스토어'),
    ('킥스타터', '킥스타터'),
    ('B2B (마야크루)', '마야크루'),
    ('샘플', '샘플'),
]
breakdown_block = "const CHANNEL_BREAKDOWN_AUTO = {\n"
for js_key, sheet_key in ch_keys:
    pkg = ch_total.get(sheet_key, 0)  # placeholder
breakdown_lines = []
for js_key, sheet_key in ch_keys:
    p = 0; u = 0
    # ch_pkg/ch_unit는 globals로 patch script 내부 변수
    pass
# Note: ch_pkg/ch_unit를 직접 활용
def _pkg(k): return globals().get('ch_pkg', {}).get(k, 0) if False else 0
# 위 hack 대신 직접 표시
breakdown_block = "const CHANNEL_BREAKDOWN_AUTO = {\n"
breakdown_block += f"  '카카오메이커스':       {{ pkg: {ch_pkg.get('카카오메이커스',0)}, unit: {ch_unit.get('카카오메이커스',0)} }},\n"
breakdown_block += f"  '네이버 스마트스토어':   {{ pkg: {ch_pkg.get('네이버',0)}, unit: {ch_unit.get('네이버',0)} }},\n"
breakdown_block += f"  '카카오톡스토어':       {{ pkg: {ch_pkg.get('카카오톡스토어',0)}, unit: {ch_unit.get('카카오톡스토어',0)} }},\n"
breakdown_block += f"  '킥스타터':            {{ pkg: {ch_pkg.get('킥스타터',0)}, unit: {ch_unit.get('킥스타터',0)} }},\n"
breakdown_block += f"  'B2B (마야크루)':      {{ pkg: {ch_pkg.get('마야크루',0)}, unit: {ch_unit.get('마야크루',0)} }},\n"
breakdown_block += f"  '샘플':                {{ pkg: {ch_pkg.get('샘플',0)}, unit: {ch_unit.get('샘플',0)} }},\n"
breakdown_block += "};"
patches.append((r"const CHANNEL_BREAKDOWN_AUTO = \{[\s\S]*?\n\};", breakdown_block))


# CHANNEL_BREAKDOWN_AUTO_BY_MONTH (월별 누계 — 정산 토글용)
_months_sorted = sorted(set(list(ch_pkg_by_month.keys()) + list(ch_unit_by_month.keys())))
by_month_block = "const CHANNEL_BREAKDOWN_AUTO_BY_MONTH = {\n"
for _ym in _months_sorted:
    by_month_block += f"  \"{_ym}\": {{\n"
    for js_key, sheet_key in ch_keys:
        _p = ch_pkg_by_month.get(_ym, {}).get(sheet_key, 0)
        _u = ch_unit_by_month.get(_ym, {}).get(sheet_key, 0)
        by_month_block += f"    \"{js_key}\": {{ pkg: {_p}, unit: {_u} }},\n"
    by_month_block += "  },\n"
by_month_block += "};"
# regex matches multi-line placeholder for BY_MONTH
patches.append((r"const CHANNEL_BREAKDOWN_AUTO_BY_MONTH = \{[\s\S]*?\n\};", by_month_block))

# ── 전체 출고 탭 — 채널 바 array (이전엔 누락되어 stale drift 발생) ──
channels_arr = (
    "const channels = [\n"
    f"  {{ name: '카카오메이커스', count: {km}, color: '#d4b896' }},\n"
    f"  {{ name: '킥스타터', count: {ks}, color: '#b0c4d8' }},\n"
    f"  {{ name: 'B2B · 마야크루', count: {mc}, color: '#a78bfa' }},\n"
    f"  {{ name: '증정·샘플', count: {total_gift}, color: '#374151' }},\n"
    f"  {{ name: '네이버', count: {nv}, color: '#7c9bb5' }},\n"
    f"  {{ name: '카카오톡스토어', count: {kt}, color: '#8b7355' }},\n"
    "];"
)
patches.append((r"const channels = \[[\s\S]*?\n\];", channels_arr))
patches.append((r"const maxCh = \d+;", f"const maxCh = {km};"))

# ── 채널 매트릭스 비고 (커머스 허브 = 월별) ──
patches.append((r'(id="ch-makers-mo">)\d+', lambda m, v=mo_km: m.group(1) + str(v)))
patches.append((r'(id="ch-b2b-mo">)\d+',    lambda m, v=mo_mc: m.group(1) + str(v)))

# ── 재고 자동차감 (기준점 실사 − 이후 출고 = 잔여) ──
_sizes = ['240', '250', '260', '270', '280']
gr = [max(0, INV_BASE['G'].get(s, 0) - inv_deduct['G'].get(s, 0)) for s in _sizes]
br = [max(0, INV_BASE['B'].get(s, 0) - inv_deduct['B'].get(s, 0)) for s in _sizes]
grey_rem_js = '{ ' + ', '.join(f'{s}: {v}' for s, v in zip(_sizes, gr)) + ' }'
beige_rem_js = '{ ' + ', '.join(f'{s}: {v}' for s, v in zip(_sizes, br)) + ' }'
audit_date = _DateTop.today().strftime('%Y-%m-%d')

patches.append((r"const GREY_REM\s*=\s*\{[^}]+\};",
                f"const GREY_REM  = {grey_rem_js};"))
patches.append((r"const BEIGE_REM\s*=\s*\{[^}]+\};",
                f"const BEIGE_REM = {beige_rem_js};"))
patches.append((r"const STOCK_AUDIT_DATE = '[^']+';",
                f"const STOCK_AUDIT_DATE = '{audit_date}';"))

# SOLD = 기준점까지 누적 출고 + 이후 출고
gs_base = [INV_BASE['G'].get(s, 0) for s in _sizes]  # 기준점 잔여 (실사)
bs_base = [INV_BASE['B'].get(s, 0) for s in _sizes]
# 전체 출고 = 초기입고 - 현재잔여. SOLD는 SALE_BY_SIZE와 별도 (전체 출고)
gs_sold = [ssale['G'].get(s, 0) + inv_deduct['G'].get(s, 0) for s in _sizes]
bs_sold = [ssale['B'].get(s, 0) + inv_deduct['B'].get(s, 0) for s in _sizes]
patches.append((
    r"const GREY_SOLD\s*=\s*\[[^\]]+\]\.reduce\(\(a,b\)=>a\+b,0\);\s*//.*",
    f"const GREY_SOLD  = [{','.join(str(v) for v in gs_sold)}].reduce((a,b)=>a+b,0);   // {sum(gs_sold)}"
))
patches.append((
    r"const BEIGE_SOLD\s*=\s*\[[^\]]+\]\.reduce\(\(a,b\)=>a\+b,0\);\s*//.*",
    f"const BEIGE_SOLD = [{','.join(str(v) for v in bs_sold)}].reduce((a,b)=>a+b,0);       // {sum(bs_sold)}"
))

_ded_g = sum(inv_deduct['G'].values())
_ded_b = sum(inv_deduct['B'].values())
print(f"재고: GREY {dict(zip(_sizes,gr))}({sum(gr)}) / BEIGE {dict(zip(_sizes,br))}({sum(br)}) | 기준일 이후 차감 G:{_ded_g} B:{_ded_b}")

# ── N배송 판매 차감 패치 ──
nship_sold_js = '{ ' + ', '.join(f'{s}:{nship_sold.get(s,0)}' for s in _sizes) + ' }'
patches.append((r"const NSHIP_SOLD\s*=\s*\{[^}]+\};",
                f"const NSHIP_SOLD         = {nship_sold_js};"))
_nship_total_sold = sum(nship_sold.values())
print(f"N배송: 판매 차감 {dict((s, nship_sold.get(s,0)) for s in _sizes)} ({_nship_total_sold})")

# Apply (3-tuple = (pattern, repl, count); 2-tuple defaults count=1)
applied = 0
for tup in patches:
    if len(tup) == 3:
        pattern, repl, count = tup
    else:
        pattern, repl = tup
        count = 1
    new_html, c = re.subn(pattern, repl, html, count=count)
    if c: applied += 1; html = new_html

open(html_path, 'w').write(html)

# Output summary (commit message용)
print(f"런칭 누적 (4/17~{dates[-1] if dates else '—'}): 실판매 {total_sale} / B2B {total_b2b} / 증정 {total_gift} = {total_all} ({n}일)")
print(f"{cur_m}월 누계 ({mo_range}): 실판매 {mo_sale} / B2B {mo_b2b} / 증정 {mo_gift} = {mo_total} ({mo_n}일)")
print(f"누적 채널: 메이커스 {km} · 킥 {ks} · B2B {mc} · 네 {nv} · 톡 {kt} · 증정 {total_gift}")
print(f"{cur_m}월 채널: 메이커스 {mo_km} · 킥 {mo_ks} · B2B {mo_mc} · 네 {mo_nv} · 톡 {mo_kt} · 증정 {mo_gift}")
print(' '.join(f"W{i+1}={ws[i]}/{wr[i]}" for i in range(_nw)))
print(f"패치 적용: {applied}/{len(patches)}")
