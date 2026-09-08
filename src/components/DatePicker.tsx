'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  error?: boolean;
}

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

export default function DatePicker({ value, onChange, placeholder = '날짜 선택', style, error }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => {
    if (value) return parseInt(value.slice(0, 4));
    return new Date().getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    if (value) return parseInt(value.slice(5, 7)) - 1;
    return new Date().getMonth();
  });
  const [focusDay, setFocusDay] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Sync view to value when opened
  useEffect(() => {
    if (open && value) {
      setViewYear(parseInt(value.slice(0, 4)));
      setViewMonth(parseInt(value.slice(5, 7)) - 1);
    }
  }, [open, value]);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const todayStr = new Date().toISOString().slice(0, 10);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11); }
    else setViewMonth(viewMonth - 1);
    setFocusDay(null);
  };

  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0); }
    else setViewMonth(viewMonth + 1);
    setFocusDay(null);
  };

  const selectDay = (day: number) => {
    const m = String(viewMonth + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    onChange(`${viewYear}-${m}-${d}`);
    setOpen(false);
  };

  const dateStr = (day: number) => {
    const m = String(viewMonth + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${viewYear}-${m}-${d}`;
  };

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) return;
    const current = focusDay ?? (value ? parseInt(value.slice(8, 10)) : 1);
    let next = current;

    switch (e.key) {
      case 'ArrowLeft': next = current - 1; break;
      case 'ArrowRight': next = current + 1; break;
      case 'ArrowUp': next = current - 7; break;
      case 'ArrowDown': next = current + 7; break;
      case 'Enter':
        e.preventDefault();
        selectDay(current);
        return;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        return;
      default: return;
    }

    e.preventDefault();
    if (next < 1) { prevMonth(); setFocusDay(daysInMonth + next); return; }
    if (next > daysInMonth) { nextMonth(); setFocusDay(next - daysInMonth); return; }
    setFocusDay(next);
  }, [open, focusDay, value, daysInMonth, viewMonth, viewYear]);

  const displayValue = value
    ? `${value.slice(0, 4)}. ${parseInt(value.slice(5, 7))}. ${parseInt(value.slice(8, 10))}`
    : '';

  return (
    <div ref={ref} style={{ position: 'relative', ...style }} onKeyDown={handleKeyDown}>
      <div
        tabIndex={0}
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          padding: '9px 12px',
          border: `1px solid ${error ? '#D9534F' : open ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 8,
          fontSize: 13,
          color: value ? 'var(--text-primary)' : 'var(--text-muted)',
          background: 'var(--surface)',
          cursor: 'pointer',
          fontFamily: 'var(--font)',
          outline: 'none',
        }}
      >
        {displayValue || placeholder}
      </div>
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: 0,
          width: 296,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
          zIndex: 100,
          padding: '12px 16px',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <button onClick={prevMonth} style={navBtn}>&lt;</button>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
              {viewYear}년 {viewMonth + 1}월
            </span>
            <button onClick={nextMonth} style={navBtn}>&gt;</button>
          </div>
          {/* Day labels */}
          <div ref={gridRef} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
            {DAYS.map((d) => (
              <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', padding: '4px 0' }}>{d}</div>
            ))}
            {/* Empty cells before first day */}
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div key={`e${i}`} />
            ))}
            {/* Day cells */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const ds = dateStr(day);
              const isSelected = ds === value;
              const isToday = ds === todayStr;
              const isFocused = focusDay === day;
              return (
                <div
                  key={day}
                  onClick={() => selectDay(day)}
                  style={{
                    width: 34,
                    height: 34,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                    borderRadius: '50%',
                    cursor: 'pointer',
                    fontWeight: isToday ? 700 : 400,
                    color: isSelected ? '#fff' : isToday ? 'var(--accent)' : 'var(--text-secondary)',
                    background: isSelected ? 'var(--accent)' : isFocused ? 'var(--accent-light)' : 'transparent',
                    outline: isFocused && !isSelected ? '2px solid var(--accent)' : 'none',
                    outlineOffset: -2,
                    transition: 'background 0.1s',
                  }}
                >
                  {day}
                </div>
              );
            })}
          </div>
          {/* Today button */}
          <div style={{ marginTop: 8, textAlign: 'center' }}>
            <button
              onClick={() => { onChange(todayStr); setOpen(false); }}
              style={{ border: 'none', background: 'none', color: 'var(--accent)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font)' }}
            >오늘</button>
          </div>
        </div>
      )}
    </div>
  );
}

const navBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '4px 8px',
  fontSize: 14,
  color: 'var(--text-secondary)',
  borderRadius: 4,
  fontFamily: 'var(--font)',
};
