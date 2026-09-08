'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  dotColor?: string;
}

interface CustomSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export default function CustomSelect({ options, value, onChange, placeholder = '선택', disabled, style }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  const close = useCallback(() => { setOpen(false); setFocusIdx(-1); }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  useEffect(() => {
    if (open && focusIdx >= 0 && listRef.current) {
      const items = listRef.current.children;
      if (items[focusIdx]) (items[focusIdx] as HTMLElement).scrollIntoView({ block: 'nearest' });
    }
  }, [focusIdx, open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!open) { setOpen(true); setFocusIdx(options.findIndex((o) => o.value === value)); }
      else if (focusIdx >= 0) { onChange(options[focusIdx].value); close(); }
    } else if (e.key === 'Escape') {
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); setFocusIdx(0); }
      else setFocusIdx((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIdx((i) => Math.max(i - 1, 0));
    }
  };

  return (
    <div ref={ref} style={{ position: 'relative', ...style }} onKeyDown={handleKeyDown}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen(!open); }}
        style={{
          width: '100%', height: 36, padding: '0 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          border: `1px solid ${open ? '#1A1D21' : '#EDF0F3'}`, borderRadius: 10, background: '#FFFFFF',
          fontSize: 13, color: selected ? '#1A1D21' : '#9AA2AA', cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', outline: 'none', transition: 'border-color 120ms',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {selected?.dotColor && <span style={{ width: 6, height: 6, borderRadius: '50%', background: selected.dotColor, flexShrink: 0 }} />}
          {selected?.label ?? placeholder}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms', flexShrink: 0 }}>
          <path d="M2.5 4.5L6 8L9.5 4.5" stroke="#9AA2AA" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          ref={listRef}
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50,
            background: '#FFFFFF', border: '1px solid #EDF0F3', borderRadius: 12,
            boxShadow: '0 8px 24px rgba(20,24,31,0.10)', padding: 6,
            maxHeight: 280, overflowY: 'auto',
            animation: 'selectSlideIn 120ms ease-out',
          }}
        >
          {options.map((opt, i) => (
            <div
              key={opt.value}
              onClick={() => { onChange(opt.value); close(); }}
              onMouseEnter={() => setFocusIdx(i)}
              style={{
                height: 36, padding: '0 12px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 13, cursor: 'pointer', transition: 'background 80ms',
                color: opt.value === value ? '#1A1D21' : '#61686F',
                fontWeight: opt.value === value ? 600 : 400,
                background: opt.value === value ? '#F1F3F6' : focusIdx === i ? '#F5F7F9' : 'transparent',
              }}
            >
              {opt.dotColor && <span style={{ width: 6, height: 6, borderRadius: '50%', background: opt.dotColor, flexShrink: 0 }} />}
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
