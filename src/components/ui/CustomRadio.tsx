'use client';

interface CustomRadioProps {
  checked: boolean;
  onChange: () => void;
  label?: string;
  disabled?: boolean;
  name?: string;
  style?: React.CSSProperties;
}

export default function CustomRadio({ checked, onChange, label, disabled, name, style }: CustomRadioProps) {
  return (
    <label
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1, minHeight: 44, /* touch target */
        ...style,
      }}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={() => { if (!disabled) onChange(); }}
        disabled={disabled}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
      />
      <span
        style={{
          width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
          border: checked ? 'none' : '1.5px solid #D5D8DC',
          background: checked ? '#1A1D21' : '#FFFFFF',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 120ms',
        }}
      >
        {checked && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FFFFFF' }} />}
      </span>
      {label && <span style={{ fontSize: 13, color: '#1A1D21', lineHeight: 1.4 }}>{label}</span>}
    </label>
  );
}
