/**
 * Influencer Design Tokens
 *
 * /commerce 코드에서 추출한 실제 토큰 + 스펙 §4 디자인 시스템 기준.
 * inline style에서 직접 참조하거나, CSS 변수(globals.css)와 동기화.
 *
 * 3색 상태 시스템: coral / blue / mint
 *  - coral: 지연 · 오늘 마감 · 막힘 · 예산 초과
 *  - blue:  진행 중 · 확인 필요
 *  - mint:  완료
 */

/* ── Colors ────────────────────────────────────────────── */

export const colors = {
  // Backgrounds
  bg: '#FBFCFD',
  surface: '#FFFFFF',
  surfaceHover: '#FAFBFC',

  // Borders
  border: '#E4E8EC',
  borderLight: '#F2F4F7',

  // Text hierarchy (4-tier)
  textPrimary: '#1A1D21',
  textSecondary: '#61686F',
  textInfo: '#838B93',
  textMuted: '#9AA2AA',
  textDisabled: '#C4CAD1',

  // Accent (navy)
  accent: '#4A7DB5',
  accentDark: '#244C77',
  accentLight: '#EDF3FA',

  // 3-color status system (from /commerce product colors)
  coral: '#D9534F',
  coralLight: '#FCEFEF',
  coralBorder: '#F3D5D5',

  blue: '#4A7DB5',
  blueLight: '#EDF3FA',
  blueBorder: '#C8D9EC',

  mint: '#3D9970',
  mintLight: '#ECF6F1',
  mintBorder: '#C4E3D4',

  // Neutral badges
  grayBadgeBg: '#F2F4F7',
  grayBadgeText: '#8E959D',

  // Track/segment backgrounds
  track: '#F1F3F6',
} as const;

/* ── Typography ───────────────────────────────────────── */

export const typo = {
  pageTitle: { fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' } as const,
  sectionTitle: { fontSize: 16, fontWeight: 600 } as const,
  body: { fontSize: 14, fontWeight: 400 } as const,
  meta: { fontSize: 12, fontWeight: 400 } as const,
  kpiValue: { fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' as const } as const,
  // KPI unit = 60% of kpiValue fontSize = 17px
  kpiUnit: { fontSize: 17, fontWeight: 600, color: colors.textInfo } as const,
  tableHeader: { fontSize: 12, fontWeight: 450, color: colors.textInfo } as const,
  tableBody: { fontSize: 13.5, fontWeight: 400, color: colors.textSecondary } as const,
} as const;

/* ── Spacing ──────────────────────────────────────────── */

export const spacing = {
  gap: 16,          // 12-column grid gap, section gap
  cardPadding: 24,  // card inner padding
  tableCellPx: 20,  // table cell horizontal padding
  tableCellPy: 0,   // will be controlled by row height
  tableRowH: 64,    // fixed row height
} as const;

/* ── Radii ────────────────────────────────────────────── */

export const radii = {
  card: 12,
  button: 8,
  chip: 6,
  small: 4,
} as const;

/* ── Button Heights ───────────────────────────────────── */

export const btnHeight = {
  sm: 32,
  md: 36,
} as const;

/* ── Chip ─────────────────────────────────────────────── */

export const chipHeight = 22;

/* ── Status color helpers ─────────────────────────────── */

export type StatusColor = 'coral' | 'blue' | 'mint' | 'gray';

export function chipStyle(variant: StatusColor): React.CSSProperties {
  const map: Record<StatusColor, { bg: string; fg: string }> = {
    coral: { bg: colors.coralLight, fg: colors.coral },
    blue: { bg: colors.blueLight, fg: colors.accent },
    mint: { bg: colors.mintLight, fg: colors.mint },
    gray: { bg: colors.grayBadgeBg, fg: colors.grayBadgeText },
  };
  const { bg, fg } = map[variant];
  return {
    display: 'inline-flex',
    alignItems: 'center',
    height: chipHeight,
    padding: '0 8px',
    borderRadius: radii.chip,
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    background: bg,
    color: fg,
  };
}

/* ── Card base style ──────────────────────────────────── */

export const cardStyle: React.CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.card,
};

/* ── Button base styles ───────────────────────────────── */

export function btnStyle(size: 'sm' | 'md' = 'sm', active = false): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: btnHeight[size],
    padding: size === 'sm' ? '0 12px' : '0 16px',
    border: `1px solid ${active ? colors.accent : colors.border}`,
    borderRadius: radii.button,
    background: active ? colors.accentLight : colors.surface,
    color: active ? colors.accentDark : colors.textSecondary,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily: 'var(--font)',
    transition: 'border-color 0.1s, background 0.1s',
  };
}

/* ── Modal overlay ────────────────────────────────────── */

export const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  zIndex: 9000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/* ── Drawer ───────────────────────────────────────────── */

export const drawerWidth = 440;

export const drawerStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: drawerWidth,
  background: colors.surface,
  borderLeft: `1px solid ${colors.border}`,
  zIndex: 8000,
  overflowY: 'auto',
  boxShadow: '-4px 0 16px rgba(0,0,0,0.06)',
};

/* ── Progress bar ─────────────────────────────────────── */

export function progressBarStyle(pct: number, variant: 'mint' | 'coral' = 'mint'): {
  track: React.CSSProperties;
  fill: React.CSSProperties;
} {
  const isOver = pct > 100;
  return {
    track: {
      height: 4,
      borderRadius: 2,
      background: colors.borderLight,
      overflow: 'visible',
      position: 'relative',
    },
    fill: {
      height: '100%',
      borderRadius: 2,
      width: `${Math.min(pct, 100)}%`,
      background: isOver ? colors.coral : (variant === 'coral' ? colors.coral : colors.mint),
      position: 'relative',
      ...(isOver ? {
        // overflow bar for > 100%
        boxShadow: `${(pct - 100) * 0.5}px 0 0 0 ${colors.coral}`,
      } : {}),
    },
  };
}

/* ── Table column alignment helper ────────────────────── */

export function colAlign(type: 'text' | 'number'): React.CSSProperties {
  return {
    textAlign: type === 'number' ? 'right' : 'left',
    fontVariantNumeric: type === 'number' ? 'tabular-nums' : undefined,
  };
}

/* ── 단계(step) 표시용 ────────────────────────────────── */

export const STEP_LABELS: Record<string, string> = {
  consent: '섭외',
  draft: '기획안',
  edit: '가편집본',
  upload: '업로드',
  payment: '정산',
  completed: '완료',
};
