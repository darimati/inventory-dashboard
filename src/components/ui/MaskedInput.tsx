'use client';

import { useState, useRef } from 'react';

interface MaskedInputProps {
  value: string;
  onChange: (value: string) => void;
  maskFn: (value: string) => string; // returns masked display
  placeholder?: string;
  maxLength?: number;
  inputMode?: 'text' | 'numeric' | 'tel';
  error?: boolean;
  errorMsg?: string;
  style?: React.CSSProperties;
  stripNonDigits?: boolean;
}

export default function MaskedInput({
  value, onChange, maskFn, placeholder, maxLength, inputMode = 'text',
  error, errorMsg, style, stripNonDigits,
}: MaskedInputProps) {
  const [focused, setFocused] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayValue = focused || showRaw ? value : (value ? maskFn(value) : '');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let v = e.target.value;
    if (stripNonDigits) v = v.replace(/\D/g, '');
    if (maxLength && v.length > maxLength) v = v.slice(0, maxLength);
    onChange(v);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', height: 40, padding: '0 36px 0 12px',
    border: `1px solid ${error ? '#D9534F' : focused ? '#1A1D21' : '#EDF0F3'}`,
    borderRadius: 10, fontSize: 13.5, fontFamily: 'inherit', color: '#1A1D21',
    background: '#FFFFFF', outline: 'none', transition: 'border-color 120ms',
    ...style,
  };

  return (
    <div>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); setShowRaw(false); }}
          placeholder={placeholder}
          inputMode={inputMode}
          style={inputStyle}
        />
        {value && !focused && (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); setShowRaw(!showRaw); }}
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              border: 'none', background: 'transparent', cursor: 'pointer', padding: 4,
              color: '#9AA2AA', display: 'flex', alignItems: 'center',
            }}
          >
            {showRaw ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M1 8C1 8 3.5 3 8 3C12.5 3 15 8 15 8C15 8 12.5 13 8 13C3.5 13 1 8 1 8Z" stroke="currentColor" strokeWidth="1.3" />
                <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M1 8C1 8 3.5 3 8 3C12.5 3 15 8 15 8C15 8 12.5 13 8 13C3.5 13 1 8 1 8Z" stroke="currentColor" strokeWidth="1.3" />
                <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
                <path d="M2 14L14 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            )}
          </button>
        )}
      </div>
      {error && errorMsg && <div style={{ fontSize: 11.5, color: '#D9534F', marginTop: 4 }}>{errorMsg}</div>}
    </div>
  );
}
