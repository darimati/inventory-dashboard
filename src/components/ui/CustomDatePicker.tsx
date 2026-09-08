'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface CustomDatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  style?: React.CSSProperties;
}

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n: number) => String(n).padStart(2, '0');

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function formatDisplay(v: string) {
  if (!v) return '';
  const [y, m, d] = v.split('-');
  return `${y}. ${pad(Number(m))}. ${pad(Number(d))}.`;
}

export default function CustomDatePicker({ value, onChange, placeholder = '날짜 선택', disabled, error, style }: CustomDatePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const today = new Date();
  const parsed = value ? new Date(value + 'T00:00:00') : null;
  const [viewYear, setViewYear] = useState(parsed?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.getMonth() ?? today.getMonth());

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  useEffect(() => {
    if (open && parsed) {
      setViewYear(parsed.getFullYear());
      setViewMonth(parsed.getMonth());
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  };

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const isToday = (d: number) => d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
  const isSelected = (d: number) => parsed && d === parsed.getDate() && viewMonth === parsed.getMonth() && viewYear === parsed.getFullYear();

  const select = (d: number) => {
    onChange(`${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`);
    close();
  };

  const arrowBtn: React.CSSProperties = {
    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: '#61686F',
  };

  return (
    <div ref={ref} style={{ position: 'relative', ...style }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen(!open); }}
        style={{
          width: '100%', height: 36, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 8,
          border: `1px solid ${error ? '#D9534F' : open ? '#1A1D21' : '#EDF0F3'}`, borderRadius: 10, background: '#FFFFFF',
          fontSize: 13, color: value ? '#1A1D21' : '#9AA2AA', cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', outline: 'none', transition: 'border-color 120ms',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
          <rect x="1.5" y="2.5" width="11" height="9.5" rx="1.5" stroke="#9AA2AA" strokeWidth="1.2" />
          <path d="M1.5 5.5H12.5" stroke="#9AA2AA" strokeWidth="1.2" />
          <path d="M4.5 1V3.5" stroke="#9AA2AA" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M9.5 1V3.5" stroke="#9AA2AA" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        {value ? formatDisplay(value) : placeholder}
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50,
            width: 280, background: '#FFFFFF', border: '1px solid #EDF0F3', borderRadius: 12,
            boxShadow: '0 8px 24px rgba(20,24,31,0.10)', padding: '12px',
            animation: 'selectSlideIn 120ms ease-out',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <button type="button" onClick={prevMonth} style={arrowBtn}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M8.5 3L4.5 7L8.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1D21' }}>{viewYear}년 {viewMonth + 1}월</span>
            <button type="button" onClick={nextMonth} style={arrowBtn}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5.5 3L9.5 7L5.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
          {/* Weekday headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0, marginBottom: 4 }}>
            {DAYS.map((d) => (
              <div key={d} style={{ textAlign: 'center', fontSize: 11, color: '#9AA2AA', padding: '4px 0' }}>{d}</div>
            ))}
          </div>
          {/* Days grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0 }}>
            {cells.map((d, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 32 }}>
                {d != null && (
                  <button
                    type="button"
                    onClick={() => select(d)}
                    style={{
                      width: 32, height: 32, borderRadius: 8, border: isToday(d) && !isSelected(d) ? '1px solid #EDF0F3' : 'none',
                      background: isSelected(d) ? '#1A1D21' : 'transparent',
                      color: isSelected(d) ? '#FFFFFF' : '#1A1D21',
                      fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'background 80ms',
                    }}
                    onMouseEnter={(e) => { if (!isSelected(d)) (e.target as HTMLElement).style.background = '#F5F7F9'; }}
                    onMouseLeave={(e) => { if (!isSelected(d)) (e.target as HTMLElement).style.background = 'transparent'; }}
                  >
                    {d}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
