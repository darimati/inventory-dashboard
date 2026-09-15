'use client';

import React from 'react';
import {
  colors, typo, spacing, radii, btnHeight, chipHeight,
  type StatusColor,
} from './styles';

/* ═══════════════════════════════════════════════════════════
   Influencer Shared UI Components
   ─ /commerce 비주얼 톤 기반, 스펙 §4 디자인 시스템 준수
   ═══════════════════════════════════════════════════════════ */

/* ── Chip (상태 칩) ─────────────────────────────────────── */

const CHIP_MAP: Record<StatusColor, { bg: string; fg: string }> = {
  coral: { bg: colors.coralLight, fg: colors.coral },
  blue: { bg: colors.blueLight, fg: colors.accent },
  mint: { bg: colors.mintLight, fg: colors.mint },
  gray: { bg: colors.grayBadgeBg, fg: colors.grayBadgeText },
};

interface ChipProps {
  variant: StatusColor;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export function Chip({ variant, children, style }: ChipProps) {
  const { bg, fg } = CHIP_MAP[variant];
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '3px 10px',
      borderRadius: 12,
      fontSize: 11.5,
      fontWeight: 500,
      whiteSpace: 'nowrap',
      background: bg,
      color: fg,
      ...style,
    }}>
      {children}
    </span>
  );
}

/* ── Dot (단계 점) ────────────────────────────────────── */

interface DotProps {
  color: StatusColor;
  size?: number;
  style?: React.CSSProperties;
}

export function Dot({ color, size = 6, style }: DotProps) {
  const fg = CHIP_MAP[color].fg;
  return (
    <span style={{
      display: 'inline-block',
      width: size,
      height: size,
      borderRadius: '50%',
      background: fg,
      flexShrink: 0,
      ...style,
    }} />
  );
}

/* ── Button (sm 32 / md 36, outline only) ─────────────── */

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 'sm' | 'md';
  fixedWidth?: number;
}

export function Btn({ size = 'sm', fixedWidth, style, children, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        height: btnHeight[size],
        padding: size === 'sm' ? '0 10px' : '0 16px',
        border: `1px solid ${colors.border}`,
        borderRadius: 7,
        background: colors.surface,
        color: colors.textSecondary,
        fontSize: size === 'sm' ? 12.5 : 13,
        fontWeight: 500,
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
        whiteSpace: 'nowrap',
        fontFamily: 'var(--font)',
        transition: 'border-color 0.1s',
        opacity: rest.disabled ? 0.4 : 1,
        ...(fixedWidth ? { width: fixedWidth } : {}),
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/* ── Card (section wrapper) ───────────────────────────── */

interface CardProps {
  children: React.ReactNode;
  padding?: number | string;
  alert?: boolean;
  selected?: boolean;
  style?: React.CSSProperties;
  onClick?: () => void;
}

export function Card({ children, padding = spacing.cardPadding, alert, selected, style, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        background: alert
          ? `linear-gradient(180deg, ${colors.coralLight}, ${colors.surface} 65%)`
          : colors.surface,
        border: `${selected ? '1.5px' : '1px'} solid ${
          selected ? colors.accentDark : alert ? colors.coralBorder : colors.border
        }`,
        borderRadius: radii.card,
        padding,
        cursor: onClick ? 'pointer' : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ── Section (card with title bar) ────────────────────── */

interface SectionProps {
  title: string;
  hint?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export function Section({ title, hint, right, children, style }: SectionProps) {
  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: radii.card,
      ...style,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 20px',
        borderBottom: `1px solid ${colors.borderLight}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={typo.sectionTitle}>{title}</span>
          {hint && <span style={{ ...typo.meta, color: colors.textMuted }}>{hint}</span>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/* ── KPI Card ─────────────────────────────────────────── */

interface KPICardProps {
  label: string;
  value: React.ReactNode;
  unit?: string;
  sub?: React.ReactNode;
  alert?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export function KPICard({ label, value, unit, sub, alert, onClick, children, style }: KPICardProps) {
  return (
    <Card alert={alert} onClick={onClick} padding={20} style={{
      display: 'flex',
      flexDirection: 'column',
      height: 156,
      overflow: 'hidden',
      ...style,
    }}>
      <span style={{ ...typo.meta, color: colors.textInfo, fontWeight: 450, marginBottom: 6 }}>
        {label}
      </span>
      <span style={{
        ...typo.kpiValue,
        color: alert ? colors.coral : colors.textPrimary,
        lineHeight: 1.2,
      }}>
        {value}
        {unit && (
          <span style={{ fontSize: 17, fontWeight: 600, color: colors.textInfo, marginLeft: 1 }}>
            {unit}
          </span>
        )}
      </span>
      {sub && (
        <span style={{ ...typo.meta, color: colors.textInfo, marginTop: 'auto', paddingTop: 4 }}>
          {sub}
        </span>
      )}
      {children}
    </Card>
  );
}

/* ── Progress Bar ─────────────────────────────────────── */

interface ProgressBarProps {
  pct: number;
  height?: number;
  style?: React.CSSProperties;
}

export function ProgressBar({ pct, height = 4, style }: ProgressBarProps) {
  const isOver = pct > 100;
  const clampedPct = Math.min(pct, 100);

  return (
    <div style={{
      height,
      borderRadius: height / 2,
      background: colors.borderLight,
      overflow: 'hidden',
      position: 'relative',
      ...style,
    }}>
      <div style={{
        height: '100%',
        borderRadius: height / 2,
        width: `${clampedPct}%`,
        background: isOver ? colors.coral : colors.mint,
        transition: 'width 0.3s',
      }} />
      {isOver && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: '100%',
          transform: `translateX(-${Math.min(pct - 100, 30)}%)`,
          height: '100%',
          width: `${Math.min(pct - 100, 30)}%`,
          background: colors.coral,
          borderRadius: `0 ${height / 2}px ${height / 2}px 0`,
        }} />
      )}
    </div>
  );
}

/* ── Filter Tab Bar ───────────────────────────────────── */

interface TabItem {
  key: string;
  label: string;
  count?: number;
  disabled?: boolean;
}

interface TabBarProps {
  tabs: TabItem[];
  active: string;
  onChange: (key: string) => void;
  style?: React.CSSProperties;
}

export function TabBar({ tabs, active, onChange, style }: TabBarProps) {
  return (
    <div style={{
      display: 'inline-flex',
      gap: 2,
      padding: 3,
      background: colors.track,
      borderRadius: 9,
      ...style,
    }}>
      {tabs.map(t => (
        <button
          key={t.key}
          disabled={t.disabled}
          onClick={() => !t.disabled && onChange(t.key)}
          style={{
            padding: '7px 14px',
            border: 'none',
            borderRadius: 7,
            background: active === t.key ? colors.surface : 'transparent',
            color: t.disabled ? colors.textMuted : (active === t.key ? colors.textPrimary : '#6E767E'),
            fontSize: 13,
            fontWeight: active === t.key ? 600 : 500,
            cursor: t.disabled ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--font)',
            boxShadow: active === t.key ? '0 1px 2px rgba(26,29,33,0.06)' : 'none',
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          {t.label}
          {t.count != null && (
            <span style={{
              color: active === t.key ? colors.textMuted : '#8A9199',
              fontWeight: 500,
              marginLeft: 3,
            }}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ── Modal ────────────────────────────────────────────── */

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  width?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Modal({ open, onClose, title, width = 480, children, footer }: ModalProps) {
  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: colors.surface,
        borderRadius: radii.card,
        width,
        maxHeight: '85vh',
        overflow: 'auto',
        padding: spacing.cardPadding,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}>
          <span style={typo.sectionTitle}>{title}</span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 18,
              color: colors.textMuted,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>
        {children}
        {footer && (
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 20,
            paddingTop: 16,
            borderTop: `1px solid ${colors.borderLight}`,
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Drawer (우측 패널) ───────────────────────────────── */

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  sub?: string;
  children: React.ReactNode;
}

export function Drawer({ open, onClose, title, sub, children }: DrawerProps) {
  if (!open) return null;
  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.2)',
          zIndex: 7999,
        }}
        onClick={onClose}
      />
      {/* Panel */}
      <div style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 440,
        background: colors.surface,
        borderLeft: `1px solid ${colors.border}`,
        zIndex: 8000,
        overflowY: 'auto',
        boxShadow: '-4px 0 16px rgba(0,0,0,0.06)',
        animation: 'inf-drawer-in 0.2s ease',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `20px ${spacing.cardPadding}px`,
          borderBottom: `1px solid ${colors.borderLight}`,
          position: 'sticky',
          top: 0,
          background: colors.surface,
          zIndex: 1,
        }}>
          <div>
            <div style={typo.sectionTitle}>{title}</div>
            {sub && <div style={{ ...typo.meta, color: colors.textMuted, marginTop: 2 }}>{sub}</div>}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 18,
              color: colors.textMuted,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>
        {/* Body */}
        <div style={{ padding: spacing.cardPadding }}>
          {children}
        </div>
      </div>
    </>
  );
}

/* ── Toast ─────────────────────────────────────────────── */

interface ToastProps {
  message: string;
  action?: { label: string; onClick: () => void };
  variant?: 'success' | 'error' | 'info';
}

export function Toast({ message, action, variant = 'info' }: ToastProps) {
  const bgMap = {
    success: '#1A7F37',
    error: colors.coral,
    info: colors.textPrimary,
  };
  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '10px 16px',
      borderRadius: radii.button,
      background: bgMap[variant],
      color: '#fff',
      fontSize: 13,
      fontWeight: 500,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      zIndex: 9999,
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      animation: 'inf-toast-in 0.25s ease',
    }}>
      {message}
      {action && (
        <button
          onClick={action.onClick}
          style={{
            background: 'rgba(255,255,255,0.2)',
            border: 'none',
            borderRadius: 4,
            padding: '4px 10px',
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/* ── Form Input ───────────────────────────────────────── */

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, style, ...rest }: InputProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <label style={{ fontSize: 12, fontWeight: 500, color: colors.textInfo }}>
          {label}
        </label>
      )}
      <input
        {...rest}
        style={{
          height: btnHeight.md,
          padding: '0 12px',
          border: `1px solid ${colors.border}`,
          borderRadius: radii.button,
          fontSize: 14,
          fontFamily: 'var(--font)',
          color: colors.textPrimary,
          outline: 'none',
          ...style,
        }}
      />
    </div>
  );
}

/* ── Empty State ──────────────────────────────────────── */

interface EmptyProps {
  message: string;
  action?: { label: string; onClick: () => void };
}

export function Empty({ message, action }: EmptyProps) {
  return (
    <div style={{
      padding: '40px 24px',
      textAlign: 'center',
      color: colors.textMuted,
      fontSize: 13,
    }}>
      {message}
      {action && (
        <div style={{ marginTop: 12 }}>
          <Btn size="sm" onClick={action.onClick}>{action.label}</Btn>
        </div>
      )}
    </div>
  );
}

/* ── Menu (··· dropdown) ──────────────────────────────── */

interface MenuProps {
  items: Array<{ label: string; onClick: () => void; danger?: boolean }>;
  onClose: () => void;
}

export function Menu({ items, onClose }: MenuProps) {
  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 5000 }}
        onClick={onClose}
      />
      <div style={{
        position: 'absolute',
        right: 0,
        top: '100%',
        marginTop: 4,
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.button,
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        zIndex: 5001,
        minWidth: 140,
        padding: '4px 0',
      }}>
        {items.map((item, i) => (
          <button
            key={i}
            onClick={() => { item.onClick(); onClose(); }}
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 14px',
              border: 'none',
              background: 'none',
              textAlign: 'left',
              fontSize: 13,
              color: item.danger ? colors.coral : colors.textSecondary,
              cursor: 'pointer',
              fontFamily: 'var(--font)',
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}

/* ── MoreButton (··· trigger) ─────────────────────────── */

interface MoreButtonProps {
  onClick: () => void;
  style?: React.CSSProperties;
}

export function MoreButton({ onClick, style }: MoreButtonProps) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      style={{
        background: 'none',
        border: 'none',
        padding: '4px 8px',
        fontSize: 16,
        color: colors.textMuted,
        cursor: 'pointer',
        letterSpacing: 2,
        lineHeight: 1,
        ...style,
      }}
    >
      ···
    </button>
  );
}
