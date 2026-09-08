'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { getPeriodRange, type PeriodPreset } from '@/lib/helpers';

const CHANNELS = [
  { key: 'all', label: '전체', enabled: true },
  { key: 'coupang', label: '쿠팡', enabled: true },
  { key: 'naver', label: '네이버 스마트스토어', enabled: false, soon: '예정' },
  { key: 'own', label: '자사몰', enabled: false, soon: '예정' },
];

const PRODUCTS = [
  { key: 'all', label: '전체' },
  { key: '클렌징밤', label: '클렌징밤' },
  { key: '클렌징폼', label: '클렌징폼' },
  { key: '세럼', label: '세럼' },
];

const PERIODS: { key: PeriodPreset; label: string }[] = [
  { key: 'today', label: '오늘' },
  { key: '7d', label: '7일' },
  { key: '30d', label: '30일' },
  { key: 'this_month', label: '이번 달' },
  { key: 'all', label: '전체' },
];

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

function formatRangeDisplay(from: string, to: string): string {
  const f = from.slice(5).replace('-', '/');
  const t = to.slice(5).replace('-', '/');
  return `${f} \u2013 ${t}`;
}

function getMonthDays(year: number, month: number): { day: number; dateStr: string }[] {
  const days: { day: number; dateStr: string }[] = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    days.push({
      day: d.getDate(),
      dateStr: `${year}-${String(month).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    });
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function MonthGrid({
  year, month, rangeStart, rangeEnd, onDayClick, showPrev, showNext, onPrev, onNext, today,
}: {
  year: number; month: number; rangeStart: string | null; rangeEnd: string | null;
  onDayClick: (dateStr: string) => void;
  showPrev: boolean; showNext: boolean;
  onPrev: () => void; onNext: () => void; today: string;
}) {
  const days = getMonthDays(year, month);
  const firstDow = new Date(year, month - 1, 1).getDay();
  const blanks = Array(firstDow).fill(null);

  return (
    <div className="calendar-month">
      <div className="calendar-header">
        {showPrev ? <button onClick={onPrev}>&larr;</button> : <span style={{ width: 28 }} />}
        <span>{year}년 {month}월</span>
        {showNext ? <button onClick={onNext}>&rarr;</button> : <span style={{ width: 28 }} />}
      </div>
      <div className="calendar-grid">
        {DAY_LABELS.map(d => <div key={d} className="day-label">{d}</div>)}
        {blanks.map((_, i) => <div key={`b${i}`} className="day-cell empty" />)}
        {days.map(({ day, dateStr }) => {
          let cls = 'day-cell';
          if (dateStr === today) cls += ' today';
          if (rangeStart && rangeEnd) {
            if (dateStr === rangeStart) cls += ' range-start';
            if (dateStr === rangeEnd) cls += ' range-end';
            if (dateStr > rangeStart && dateStr < rangeEnd) cls += ' in-range';
          } else if (rangeStart && dateStr === rangeStart) {
            cls += ' range-start range-end';
          }
          return (
            <div key={dateStr} className={cls} onClick={() => onDayClick(dateStr)}>
              {day}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg
      className="date-range-icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Relative time helper                                               */
/* ------------------------------------------------------------------ */

function relativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return '방금 전';
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}

/* ------------------------------------------------------------------ */
/*  Refresh icon SVG                                                   */
/* ------------------------------------------------------------------ */

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      className={spinning ? 'sync-spinner' : ''}
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  SyncButton component                                               */
/* ------------------------------------------------------------------ */

function SyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<{ finished_at: string; status: string; inserted_count: number } | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Fetch last sync on mount
  useEffect(() => {
    fetch('/api/sync/status')
      .then(r => r.json())
      .then(data => {
        if (data.lastSync?.finished_at) {
          setLastSync(data.lastSync);
        }
      })
      .catch(() => {});
  }, []);

  // Cooldown countdown
  useEffect(() => {
    if (cooldown > 0) {
      timerRef.current = setInterval(() => {
        setCooldown(prev => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timerRef.current);
    }
  }, [cooldown]);

  // Auto-hide toast
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const handleSync = async () => {
    if (syncing || cooldown > 0) return;
    setSyncing(true);

    try {
      // Sync both orders and inventory in parallel
      const [ordersRes, inventoryRes] = await Promise.all([
        fetch('/api/cron/sync-rg-orders', { method: 'POST' }),
        fetch('/api/cron/sync-inventory', { method: 'POST' }),
      ]);

      if (ordersRes.status === 429) {
        const data = await ordersRes.json();
        setCooldown(data.remainingSeconds || 60);
        setToast({ type: 'error', message: `${data.remainingSeconds || 60}초 후 다시 시도해주세요` });
        return;
      }

      if (!ordersRes.ok) {
        const data = await ordersRes.json();
        setToast({ type: 'error', message: data.error || '매출 동기화 실패' });
        return;
      }

      const ordersData = await ordersRes.json();
      const inventoryOk = inventoryRes.ok;

      setLastSync({
        finished_at: ordersData.syncedAt,
        status: 'success',
        inserted_count: ordersData.inserted,
      });
      setCooldown(60);
      setToast({
        type: 'success',
        message: `동기화 완료 · 매출 ${ordersData.inserted ?? 0}건${inventoryOk ? ' · 재고 갱신' : ''}`,
      });
    } catch {
      setToast({ type: 'error', message: '네트워크 오류' });
    } finally {
      setSyncing(false);
    }
  };

  // Check if last sync is over 26 hours ago
  const isDelayed = lastSync?.finished_at
    ? (Date.now() - new Date(lastSync.finished_at).getTime()) > 26 * 60 * 60 * 1000
    : false;

  return (
    <>
      {/* Relative time / delay warning */}
      {lastSync?.finished_at && !isDelayed && (
        <span className="sync-relative-time">
          {relativeTime(lastSync.finished_at)} 동기화
        </span>
      )}
      {isDelayed && (
        <span className="sync-delay-warn">
          <span className="sync-delay-dot" />
          26시간 이상 경과
        </span>
      )}

      {/* Sync button */}
      <button
        className="sync-btn"
        onClick={handleSync}
        disabled={syncing || cooldown > 0}
      >
        <RefreshIcon spinning={syncing} />
        {syncing ? '동기화 중...' : cooldown > 0 ? `${cooldown}초` : '지금 동기화'}
      </button>

      {/* Toast */}
      {toast && (
        <div className={`sync-toast ${toast.type}`}>{toast.message}</div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  GlobalFilter                                                       */
/* ------------------------------------------------------------------ */

export default function GlobalFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const channel = searchParams.get('channel') || 'all';
  const product = searchParams.get('product') || 'all';
  const period = (searchParams.get('period') || '30d') as PeriodPreset;
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';

  const [calOpen, setCalOpen] = useState(false);
  const kstNow = new Date(Date.now() + 9 * 3_600_000);
  const [calMonth, setCalMonth] = useState(() => {
    return { year: kstNow.getUTCFullYear(), month: kstNow.getUTCMonth() + 1 };
  });
  const [pickStart, setPickStart] = useState<string | null>(from || null);
  const [pickEnd, setPickEnd] = useState<string | null>(to || null);
  const calRef = useRef<HTMLDivElement>(null);
  const today = kstNow.toISOString().slice(0, 10);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (calRef.current && !calRef.current.contains(e.target as Node)) {
        setCalOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const updateParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') params.delete(k);
      else params.set(k, v);
    }
    router.push(`${pathname}?${params.toString()}`);
  }, [router, pathname, searchParams]);

  const handlePeriod = (p: PeriodPreset) => {
    setCalOpen(false);
    updateParams({ period: p, from: null, to: null });
  };

  const handleDayClick = (dateStr: string) => {
    if (!pickStart || (pickStart && pickEnd)) {
      setPickStart(dateStr);
      setPickEnd(null);
    } else {
      if (dateStr < pickStart) {
        setPickEnd(pickStart);
        setPickStart(dateStr);
      } else {
        setPickEnd(dateStr);
      }
    }
  };

  const handleApplyRange = () => {
    if (pickStart && pickEnd) {
      setCalOpen(false);
      updateParams({ period: 'custom', from: pickStart, to: pickEnd });
    }
  };

  const handleCancelRange = () => {
    setCalOpen(false);
    setPickStart(from || null);
    setPickEnd(to || null);
  };

  const nextMonth = (y: number, m: number) => m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
  const prevMonth = (y: number, m: number) => m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
  const m2 = nextMonth(calMonth.year, calMonth.month);

  const [resolvedFrom, resolvedTo] = getPeriodRange(period, from, to);

  return (
    <div className="global-filter">
      {/* Row 1: Channel (left) + Period (right) */}
      <div className="filter-row">
        <span className="filter-label">채널</span>
        <div className="filter-segment">
          {CHANNELS.map(ch => (
            <button
              key={ch.key}
              className={`seg-btn ${channel === ch.key ? 'active' : ''}`}
              disabled={!ch.enabled}
              onClick={() => ch.enabled && updateParams({ channel: ch.key === 'all' ? null : ch.key })}
            >
              {ch.label}
              {ch.soon && <span className="coming-soon"> {ch.soon}</span>}
            </button>
          ))}
        </div>

        <div className="right-group">
          <span className="filter-label">기간</span>
          <div className="filter-segment">
            {PERIODS.map(p => (
              <button
                key={p.key}
                className={`seg-btn ${period === p.key ? 'active' : ''}`}
                onClick={() => handlePeriod(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="date-range-wrap" ref={calRef}>
            <CalendarIcon />
            <button
              className="date-range-input"
              onClick={() => setCalOpen(!calOpen)}
            >
              {formatRangeDisplay(resolvedFrom, resolvedTo)}
            </button>

            {calOpen && (
              <div className="calendar-dropdown">
                <div className="calendar-months">
                  <MonthGrid
                    year={calMonth.year} month={calMonth.month}
                    rangeStart={pickStart} rangeEnd={pickEnd}
                    onDayClick={handleDayClick}
                    showPrev={true} showNext={false}
                    onPrev={() => setCalMonth(prevMonth(calMonth.year, calMonth.month))}
                    onNext={() => {}} today={today}
                  />
                  <MonthGrid
                    year={m2.year} month={m2.month}
                    rangeStart={pickStart} rangeEnd={pickEnd}
                    onDayClick={handleDayClick}
                    showPrev={false} showNext={true}
                    onPrev={() => {}}
                    onNext={() => setCalMonth(nextMonth(calMonth.year, calMonth.month))}
                    today={today}
                  />
                </div>
                <div className="calendar-footer">
                  <button className="btn" onClick={handleCancelRange}>취소</button>
                  <button
                    className="btn btn-primary"
                    disabled={!pickStart || !pickEnd}
                    onClick={handleApplyRange}
                  >
                    적용
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row 2: Product (left) + Sync button (right) */}
      <div className="filter-row">
        <span className="filter-label">제품</span>
        <div className="filter-segment">
          {PRODUCTS.map(p => (
            <button
              key={p.key}
              className={`seg-btn ${product === p.key ? 'active' : ''}`}
              onClick={() => updateParams({ product: p.key === 'all' ? null : p.key })}
            >
              {p.label}
            </button>
          ))}
        </div>

        <span className="data-sync-info">
          <SyncButton />
        </span>
      </div>
    </div>
  );
}
