'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface Option {
  value: string;
  label: string;
}

interface CustomSelectProps {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  size?: 'sm' | 'md';
}

export default function CustomSelect({ value, options, onChange, size = 'sm' }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const label = selected?.label ?? value;

  const close = useCallback(() => { setOpen(false); setFocusIdx(-1); }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
        setFocusIdx(options.findIndex((o) => o.value === value));
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusIdx((i) => Math.min(i + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusIdx((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (focusIdx >= 0 && focusIdx < options.length) {
          onChange(options[focusIdx].value);
          close();
        }
        break;
      case 'Escape':
        e.preventDefault();
        close();
        break;
    }
  };

  useEffect(() => {
    if (focusIdx >= 0 && listRef.current) {
      const el = listRef.current.children[focusIdx] as HTMLElement;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusIdx]);

  const isSm = size === 'sm';

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        onKeyDown={handleKey}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: isSm ? '2px 8px' : '6px 12px',
          background: '#F2F4F7',
          border: 'none',
          borderRadius: isSm ? 4 : 8,
          fontSize: isSm ? 12 : 13,
          fontWeight: 500,
          color: '#1A1D21',
          cursor: 'pointer',
          fontFamily: 'var(--font)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.5, flexShrink: 0 }}>
          <path d="M2.5 3.75L5 6.25L7.5 3.75" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          ref={listRef}
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            minWidth: 120,
            background: '#FFFFFF',
            border: '1px solid #EDF0F3',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
            zIndex: 100,
            padding: '4px 0',
            animation: 'selectSlideIn 0.12s ease-out',
            maxHeight: 200,
            overflowY: 'auto',
          }}
          role="listbox"
        >
          {options.map((opt, i) => (
            <div
              key={opt.value}
              role="option"
              aria-selected={opt.value === value}
              onClick={(e) => { e.stopPropagation(); onChange(opt.value); close(); }}
              onMouseEnter={() => setFocusIdx(i)}
              style={{
                padding: '6px 12px',
                fontSize: isSm ? 12 : 13,
                color: opt.value === value ? '#1A1D21' : '#61686F',
                fontWeight: opt.value === value ? 600 : 400,
                cursor: 'pointer',
                background: i === focusIdx ? '#F2F4F7' : 'transparent',
                fontFamily: 'var(--font)',
                whiteSpace: 'nowrap',
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
