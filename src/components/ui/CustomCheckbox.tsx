'use client';

interface CustomCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
  style?: React.CSSProperties;
}

export default function CustomCheckbox({ checked, onChange, label, disabled, id, style }: CustomCheckboxProps) {
  const checkboxId = id || `cb-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <label
      htmlFor={checkboxId}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1, minHeight: 44, /* touch target */
        ...style,
      }}
    >
      <input
        type="checkbox"
        id={checkboxId}
        checked={checked}
        onChange={(e) => { if (!disabled) onChange(e.target.checked); }}
        disabled={disabled}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
      />
      <span
        style={{
          width: 18, height: 18, borderRadius: 5, flexShrink: 0,
          border: checked ? 'none' : '1.5px solid #D5D8DC',
          background: checked ? '#1A1D21' : '#FFFFFF',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 120ms',
        }}
      >
        {checked && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6L5 8.5L9.5 3.5" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {label && <span style={{ fontSize: 13, color: '#1A1D21', lineHeight: 1.4 }}>{label}</span>}
    </label>
  );
}
