'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { colors, radii } from '@/lib/influencer/styles';

// ── Types ──────────────────────────────────────────────────────────

interface CalendarViewProps {
  onParticipantClick?: (participantId: string, campaignId: string) => void;
}

interface CalendarEvent {
  id: string;
  type: 'draft' | 'edit' | 'upload' | 'payment' | 'custom';
  date: string; // YYYY-MM-DD
  title: string;
  campaign_name: string;
  participant_id: string | null;
  campaign_id: string | null;
  is_confirmed: boolean;
  is_completed: boolean;
  is_overdue: boolean;
  channel: string | null;
  memo?: string | null;
  schedule_id?: string;
}

type EventType = CalendarEvent['type'];
type ViewMode = 'month' | 'week';

interface FilterState {
  selectedType: EventType | null; // null = 전체
  overdueOnly: boolean;
  search: string;
}

interface AddEditForm {
  title: string;
  date: string;
  campaign_id: string;
  memo: string;
  schedule_id?: string;
}

// ── Constants ──────────────────────────────────────────────────────

const TYPE_COLORS: Record<EventType, { bar: string; bg: string; text: string }> = {
  draft:   { bar: '#7BAEDB', bg: '#E8F2FB', text: '#2E5A80' },
  edit:    { bar: '#6BC0AC', bg: '#E4F5F0', text: '#2A6B5C' },
  upload:  { bar: '#4A7DB5', bg: '#E6EEF9', text: '#244C77' },
  payment: { bar: '#9B8FC7', bg: '#F0EDF7', text: '#4A4270' },
  custom:  { bar: '#9AA2AA', bg: '#F1F3F6', text: '#4A4F55' },
};

const TYPE_LABELS: Record<EventType, string> = {
  draft: '기획안',
  edit: '가편집본',
  upload: '업로드',
  payment: '지급',
  custom: '일정',
};

const TYPE_ORDER: EventType[] = ['draft', 'edit', 'upload', 'payment', 'custom'];

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

const STORAGE_KEY = 'heeda_calendar_filters';

const OVERDUE_BAR = '#C85450';
const OVERDUE_BG = '#FBE9E8';
const OVERDUE_TEXT = '#8F3A37';

// ── Helpers ────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function getMonthDays(year: number, month: number): Date[] {
  const days: Date[] = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function getCalendarGrid(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1);
  const startDow = firstDay.getDay(); // 0=Sun
  const grid: Date[] = [];
  // Fill leading days from prev month
  for (let i = startDow - 1; i >= 0; i--) {
    grid.push(addDays(firstDay, -i - 1));
  }
  // Current month
  const monthDays = getMonthDays(year, month);
  grid.push(...monthDays);
  // Fill trailing days to complete last week
  while (grid.length % 7 !== 0) {
    grid.push(addDays(grid[grid.length - 1], 1));
  }
  return grid;
}

function getWeekDates(baseDate: Date): Date[] {
  const dow = baseDate.getDay();
  const sun = addDays(baseDate, -dow);
  return Array.from({ length: 7 }, (_, i) => addDays(sun, i));
}

function sortEvents(events: CalendarEvent[]): CalendarEvent[] {
  const typeIdx = (t: EventType) => TYPE_ORDER.indexOf(t);
  return [...events].sort((a, b) => {
    // overdue first
    if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1;
    // then by type order
    const ta = typeIdx(a.type);
    const tb = typeIdx(b.type);
    if (ta !== tb) return ta - tb;
    // then alphabetical
    return a.title.localeCompare(b.title, 'ko');
  });
}

function loadFilters(): { selectedType: EventType | null; overdueOnly: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate from old multi-select format
      if (Array.isArray(parsed.types)) {
        return { selectedType: null, overdueOnly: !!parsed.overdueOnly };
      }
      return {
        selectedType: parsed.selectedType ?? null,
        overdueOnly: !!parsed.overdueOnly,
      };
    }
  } catch { /* ignore */ }
  return { selectedType: null, overdueOnly: false };
}

function saveFilters(selectedType: EventType | null, overdueOnly: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ selectedType, overdueOnly }));
  } catch { /* ignore */ }
}

// ── SVG Icons ──────────────────────────────────────────────────────

function CheckIcon({ size = 10, color = '#838B93' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
      <path d="M2 5.5L4 7.5L8 3" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="6" cy="6" r="4.5" stroke="#9AA2AA" strokeWidth="1.3" />
      <path d="M9.5 9.5L12.5 12.5" stroke="#9AA2AA" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function ChevronLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M10 4L6 8L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M6.5 2V11M2 6.5H11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2.5 4H11.5M5 4V2.5H9V4M5.5 6V10.5M8.5 6V10.5M3.5 4L4 11.5H10L10.5 4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Component ──────────────────────────────────────────────────────

export default function CalendarView({ onParticipantClick }: CalendarViewProps) {
  const today = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => toDateStr(today), [today]);

  // ─ State ─
  const [currentMonth, setCurrentMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [weekBase, setWeekBase] = useState(() => new Date(today));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const [filters, setFilters] = useState<FilterState>(() => {
    const stored = loadFilters();
    return { ...stored, search: '' };
  });

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<AddEditForm>({ title: '', date: todayStr, campaign_id: '', memo: '' });
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);

  const [overflowPopover, setOverflowPopover] = useState<{ date: string; anchorRect: DOMRect } | null>(null);
  const [dragTooltip, setDragTooltip] = useState<{ x: number; y: number } | null>(null);
  const [dragState, setDragState] = useState<{ eventId: string; originalDate: string } | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerMonth, setDatePickerMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [datePickerTarget, setDatePickerTarget] = useState<'add' | 'edit'>('add');

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const lastFetchRange = useRef<string>('');

  // ─ Filter persistence ─
  useEffect(() => {
    saveFilters(filters.selectedType, filters.overdueOnly);
  }, [filters.selectedType, filters.overdueOnly]);

  // ─ Debounced search ─
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setFilters(f => ({ ...f, search: searchInput }));
    }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchInput]);

  // ─ Compute fetch range ─
  const fetchRange = useMemo(() => {
    const y = currentMonth.getFullYear();
    const m = currentMonth.getMonth();
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const start = toDateStr(addDays(first, -7));
    const end = toDateStr(addDays(last, 7));
    return { start, end };
  }, [currentMonth]);

  // ─ Fetch events ─
  const fetchEvents = useCallback(async () => {
    const rangeKey = `${fetchRange.start}_${fetchRange.end}`;
    if (lastFetchRange.current === rangeKey) return;
    lastFetchRange.current = rangeKey;
    setLoading(true);
    try {
      const res = await fetch(`/api/influencer/calendar?start=${fetchRange.start}&end=${fetchRange.end}`);
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [fetchRange]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // ─ Close popover on outside click / Esc ─
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (overflowPopover && popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOverflowPopover(null);
      }
      if (editingEvent && popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setEditingEvent(null);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOverflowPopover(null);
        setEditingEvent(null);
        setShowAddModal(false);
        setShowDatePicker(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [overflowPopover, editingEvent]);

  // ─ Error toast auto-dismiss ─
  useEffect(() => {
    if (errorToast) {
      const t = setTimeout(() => setErrorToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [errorToast]);

  // ─ Filtered events ─
  const filteredEvents = useMemo(() => {
    let result = events;
    if (filters.selectedType !== null) {
      result = result.filter(e => e.type === filters.selectedType);
    }
    if (filters.overdueOnly) {
      result = result.filter(e => e.is_overdue);
    }
    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      result = result.filter(e =>
        e.campaign_name.toLowerCase().includes(q)
        || (e.channel && e.channel.toLowerCase().includes(q))
        || e.title.toLowerCase().includes(q)
      );
    }
    return result;
  }, [events, filters]);

  // ─ Events grouped by date ─
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const e of filteredEvents) {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    }
    // Sort within each date
    for (const k of Object.keys(map)) {
      map[k] = sortEvents(map[k]);
    }
    return map;
  }, [filteredEvents]);

  // ─ Today's events for banner ─
  const todayEvents = useMemo(() => {
    return sortEvents(events.filter(e => e.date === todayStr));
  }, [events, todayStr]);

  const overdueCount = useMemo(() => {
    return events.filter(e => e.is_overdue).length;
  }, [events]);

  // ─ Calendar grid ─
  const calendarGrid = useMemo(() => {
    return getCalendarGrid(currentMonth.getFullYear(), currentMonth.getMonth());
  }, [currentMonth]);

  const weekDates = useMemo(() => getWeekDates(weekBase), [weekBase]);

  // ─ Navigation ─
  function prevMonth() {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }
  function nextMonth() {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  }
  function goToday() {
    setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setWeekBase(new Date(today));
  }
  function prevWeek() {
    setWeekBase(prev => addDays(prev, -7));
    // Also update currentMonth if week crosses month boundary
    const newBase = addDays(weekBase, -7);
    if (newBase.getMonth() !== currentMonth.getMonth() || newBase.getFullYear() !== currentMonth.getFullYear()) {
      setCurrentMonth(new Date(newBase.getFullYear(), newBase.getMonth(), 1));
    }
  }
  function nextWeek() {
    setWeekBase(prev => addDays(prev, 7));
    const newBase = addDays(weekBase, 7);
    if (newBase.getMonth() !== currentMonth.getMonth() || newBase.getFullYear() !== currentMonth.getFullYear()) {
      setCurrentMonth(new Date(newBase.getFullYear(), newBase.getMonth(), 1));
    }
  }

  // ─ Filter toggles ─
  function selectType(type: EventType | null) {
    setFilters(f => {
      // Click same type again → return to 전체
      if (f.selectedType === type) return { ...f, selectedType: null };
      return { ...f, selectedType: type };
    });
  }

  function toggleOverdueOnly() {
    setFilters(f => ({ ...f, overdueOnly: !f.overdueOnly }));
  }

  // ─ Drag & Drop ─
  function handleDragStart(e: React.DragEvent, ev: CalendarEvent) {
    if (ev.type !== 'custom') {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/plain', ev.id);
    e.dataTransfer.effectAllowed = 'move';
    setDragState({ eventId: ev.id, originalDate: ev.date });
  }

  function handleDragAttempt(e: React.MouseEvent, ev: CalendarEvent) {
    if (ev.type !== 'custom') {
      setDragTooltip({ x: e.clientX, y: e.clientY });
      setTimeout(() => setDragTooltip(null), 1500);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    if (dragState) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  }

  async function handleDrop(e: React.DragEvent, targetDate: string) {
    e.preventDefault();
    if (!dragState) return;

    const eventId = dragState.eventId;
    const originalDate = dragState.originalDate;
    setDragState(null);

    if (targetDate === originalDate) return;

    // Optimistic update
    setEvents(prev => prev.map(ev =>
      ev.id === eventId ? { ...ev, date: targetDate } : ev
    ));

    try {
      const res = await fetch(`/api/influencer/calendar/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: targetDate }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // Revert
      setEvents(prev => prev.map(ev =>
        ev.id === eventId ? { ...ev, date: originalDate } : ev
      ));
      setErrorToast('일정 이동에 실패했습니다.');
    }
  }

  // ─ Add / Edit handlers ─
  function openAddModal(presetDate?: string) {
    setAddForm({ title: '', date: presetDate || todayStr, campaign_id: '', memo: '' });
    setShowAddModal(true);
  }

  function openEditPopover(ev: CalendarEvent) {
    setEditingEvent(ev);
    setAddForm({
      title: ev.title,
      date: ev.date,
      campaign_id: ev.campaign_id || '',
      memo: ev.memo || '',
      schedule_id: ev.schedule_id,
    });
  }

  async function handleSave() {
    if (!addForm.title.trim()) return;

    if (editingEvent) {
      // Update existing
      try {
        const res = await fetch(`/api/influencer/calendar/${editingEvent.schedule_id || editingEvent.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: addForm.title,
            date: addForm.date,
            campaign_id: addForm.campaign_id || null,
            memo: addForm.memo || null,
          }),
        });
        if (res.ok) {
          setEvents(prev => prev.map(ev =>
            ev.id === editingEvent.id
              ? { ...ev, title: addForm.title, date: addForm.date, campaign_id: addForm.campaign_id || null, memo: addForm.memo || null }
              : ev
          ));
        }
      } catch { /* ignore */ }
      setEditingEvent(null);
    } else {
      // Create new
      try {
        const res = await fetch('/api/influencer/calendar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: addForm.title,
            date: addForm.date,
            campaign_id: addForm.campaign_id || null,
            memo: addForm.memo || null,
            type: 'custom',
          }),
        });
        if (res.ok) {
          lastFetchRange.current = '';
          fetchEvents();
        }
      } catch { /* ignore */ }
      setShowAddModal(false);
    }
  }

  async function handleDelete() {
    if (!editingEvent) return;
    try {
      await fetch(`/api/influencer/calendar/${editingEvent.schedule_id || editingEvent.id}`, { method: 'DELETE' });
      setEvents(prev => prev.filter(ev => ev.id !== editingEvent.id));
    } catch { /* ignore */ }
    setEditingEvent(null);
  }

  // ─ Click event ─
  function handleEventClick(ev: CalendarEvent, e: React.MouseEvent) {
    e.stopPropagation();
    if (ev.type === 'custom') {
      openEditPopover(ev);
    } else if (ev.participant_id && ev.campaign_id && onParticipantClick) {
      onParticipantClick(ev.participant_id, ev.campaign_id);
    }
  }

  // ─ Month label ─
  const monthLabel = `${currentMonth.getFullYear()}년 ${currentMonth.getMonth() + 1}월`;

  // ─ Campaign list for select ─
  const campaignList = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of events) {
      if (e.campaign_id && e.campaign_name) {
        seen.set(e.campaign_id, e.campaign_name);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [events]);

  // ── Render Helpers ──

  function renderChip(ev: CalendarEvent, _compact = false) {
    const isOverdue = ev.is_overdue;
    const isCompleted = ev.is_completed;
    const isUnconfirmed = !ev.is_confirmed;

    const typeColor = TYPE_COLORS[ev.type];
    const barColor = isOverdue ? OVERDUE_BAR : typeColor.bar;
    const baseTextColor = isOverdue ? OVERDUE_TEXT : typeColor.text;

    // Build chip style based on state
    const chipStyle: React.CSSProperties = {
      height: 24,
      borderRadius: 5,
      paddingLeft: 8,
      paddingRight: 8,
      display: 'flex',
      alignItems: 'center',
      gap: 3,
      cursor: ev.type === 'custom' ? 'pointer' : (ev.participant_id ? 'pointer' : 'default'),
      overflow: 'hidden',
      whiteSpace: 'nowrap' as const,
      position: 'relative' as const,
    };

    let textColor = baseTextColor;

    if (isOverdue) {
      chipStyle.borderLeft = `3px solid ${OVERDUE_BAR}`;
      chipStyle.background = OVERDUE_BG;
      textColor = OVERDUE_TEXT;
    } else if (isUnconfirmed) {
      // Unconfirmed: colored background with dashed left bar
      chipStyle.borderLeft = `3px dashed ${typeColor.bar}`;
      chipStyle.background = typeColor.bg;
      textColor = typeColor.text;
    } else {
      chipStyle.borderLeft = `3px solid ${barColor}`;
      chipStyle.background = typeColor.bg;
    }

    if (isCompleted) {
      chipStyle.opacity = 0.55;
    }

    const typeLabel = TYPE_LABELS[ev.type];
    const tooltipText = `${ev.title} · ${typeLabel} 마감 · ${ev.campaign_name}`;

    return (
      <div
        key={ev.id}
        style={chipStyle}
        draggable={ev.type === 'custom'}
        onDragStart={(e) => handleDragStart(e, ev)}
        onMouseDown={(e) => handleDragAttempt(e, ev)}
        onClick={(e) => handleEventClick(ev, e)}
        title={tooltipText}
      >
        {isCompleted && <CheckIcon size={10} color={textColor} />}
        <span style={{
          fontSize: 12,
          fontWeight: 500,
          color: textColor,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
          flex: 1,
        }}>
          {ev.title}
        </span>
        <span style={{
          fontSize: 11,
          fontWeight: 450,
          color: textColor,
          opacity: 0.75,
          flexShrink: 0,
        }}>
          · {typeLabel}
        </span>
      </div>
    );
  }

  function renderFilterPill(type: EventType | null, label?: string) {
    const isAll = type === null;
    const active = filters.selectedType === type;
    const tc = isAll ? null : TYPE_COLORS[type];
    return (
      <button
        key={type ?? 'all'}
        onClick={() => selectType(type)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          height: 30,
          padding: '0 12px',
          border: active ? (isAll ? '1px solid #1A1D21' : 'none') : '1px solid #E4E8EC',
          borderRadius: 8,
          background: active ? (isAll ? '#1A1D21' : tc!.bg) : '#FFFFFF',
          fontSize: 12.5,
          fontWeight: 500,
          color: active ? (isAll ? '#FFFFFF' : tc!.text) : '#6E767E',
          cursor: 'pointer',
          fontFamily: 'var(--font)',
          transition: 'all 0.12s',
          whiteSpace: 'nowrap',
        }}
      >
        {!isAll && (
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: active ? tc!.bar : colors.textDisabled,
            flexShrink: 0,
          }} />
        )}
        {label ?? (isAll ? '전체' : TYPE_LABELS[type])}
      </button>
    );
  }

  // ── Date Picker (mini calendar) ──

  function renderDatePicker(
    selectedDate: string,
    onSelect: (d: string) => void,
    onClose: () => void
  ) {
    const dpGrid = getCalendarGrid(datePickerMonth.getFullYear(), datePickerMonth.getMonth());
    const dpLabel = `${datePickerMonth.getFullYear()}년 ${datePickerMonth.getMonth() + 1}월`;

    return (
      <div style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        zIndex: 200,
        background: colors.surface,
        border: '1px solid #EDF0F3',
        borderRadius: 12,
        boxShadow: '0 8px 24px rgba(26,29,33,0.10)',
        padding: 12,
        width: 260,
        marginTop: 4,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}>
          <button
            onClick={() => setDatePickerMonth(new Date(datePickerMonth.getFullYear(), datePickerMonth.getMonth() - 1, 1))}
            style={navBtnStyle}
          >
            <ChevronLeft />
          </button>
          <span style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>{dpLabel}</span>
          <button
            onClick={() => setDatePickerMonth(new Date(datePickerMonth.getFullYear(), datePickerMonth.getMonth() + 1, 1))}
            style={navBtnStyle}
          >
            <ChevronRight />
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
          {DAY_NAMES.map((dn, i) => (
            <div key={dn} style={{
              textAlign: 'center',
              fontSize: 10,
              fontWeight: 450,
              color: i === 0 ? colors.coral : i === 6 ? colors.accent : colors.textInfo,
              padding: '4px 0',
            }}>{dn}</div>
          ))}
          {dpGrid.map((d, i) => {
            const ds = toDateStr(d);
            const isInMonth = d.getMonth() === datePickerMonth.getMonth();
            const isSelected = ds === selectedDate;
            const isToday = ds === todayStr;
            return (
              <div
                key={i}
                onClick={() => { onSelect(ds); onClose(); }}
                style={{
                  textAlign: 'center',
                  fontSize: 12,
                  padding: '6px 0',
                  cursor: 'pointer',
                  borderRadius: 4,
                  color: isSelected ? '#fff' : !isInMonth ? colors.textDisabled : isToday ? colors.accent : colors.textPrimary,
                  background: isSelected ? colors.accent : 'transparent',
                  fontWeight: isToday || isSelected ? 600 : 400,
                }}
              >{d.getDate()}</div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Today Banner ──

  function renderTodayBanner() {
    const hasTodayEvents = todayEvents.length > 0;
    const todayOverdue = events.filter(e => e.is_overdue);

    const summaryParts: string[] = [];
    for (const ev of todayEvents.slice(0, 3)) {
      const typeL = TYPE_LABELS[ev.type];
      summaryParts.push(`${ev.title} ${typeL} ${ev.is_completed ? '완료' : '예정'}`);
    }
    if (todayEvents.length > 3) {
      summaryParts.push(`외 ${todayEvents.length - 3}건`);
    }

    return (
      <div style={{
        background: '#EDF3FA',
        border: '1px solid #D9E4F2',
        borderRadius: 10,
        padding: 12,
        marginBottom: 14,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#244C77',
            marginBottom: hasTodayEvents || todayOverdue.length > 0 ? 4 : 0,
          }}>
            오늘 일정
          </div>
          {hasTodayEvents ? (
            <div style={{ fontSize: 13, fontWeight: 450, color: '#4A4F55' }}>
              {summaryParts.join(' · ')}
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: colors.textInfo }}>
              오늘 예정된 일정이 없습니다
            </div>
          )}
        </div>
        {todayOverdue.length > 0 && (
          <div
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: '#8F3A37',
              background: '#FBE9E8',
              padding: '3px 10px',
              borderRadius: 12,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              marginLeft: 12,
            }}
            onClick={() => {
              setFilters(f => ({ ...f, overdueOnly: true }));
            }}
          >
            기한 초과 {todayOverdue.length}건
          </div>
        )}
      </div>
    );
  }

  // ── Overflow Popover ──

  function renderOverflowPopover() {
    if (!overflowPopover) return null;
    const dayEvents = eventsByDate[overflowPopover.date] || [];
    const rect = overflowPopover.anchorRect;

    return (
      <div
        ref={popoverRef}
        style={{
          position: 'fixed',
          top: rect.bottom + 4,
          left: Math.min(rect.left, window.innerWidth - 340),
          width: 320,
          background: colors.surface,
          border: '1px solid #EDF0F3',
          borderRadius: 12,
          boxShadow: '0 8px 24px rgba(26,29,33,0.10)',
          padding: 14,
          zIndex: 150,
          maxHeight: 400,
          overflowY: 'auto',
        }}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>
            {(() => {
              const d = parseDate(overflowPopover.date);
              return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY_NAMES[d.getDay()]})`;
            })()}
          </span>
          <button
            onClick={() => setOverflowPopover(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textInfo, padding: 2 }}
          >
            <CloseIcon />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {dayEvents.map(ev => renderChip(ev))}
        </div>
      </div>
    );
  }

  // ── Edit Popover (custom events) ──

  function renderEditPopover() {
    if (!editingEvent) return null;

    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.15)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div
          ref={popoverRef}
          style={{
            width: 320,
            background: colors.surface,
            border: '1px solid #EDF0F3',
            borderRadius: 12,
            boxShadow: '0 8px 24px rgba(26,29,33,0.10)',
            padding: 20,
          }}
        >
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary }}>일정 수정</span>
            <button
              onClick={() => setEditingEvent(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textInfo, padding: 2 }}
            >
              <CloseIcon />
            </button>
          </div>

          {/* Title */}
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>제목</label>
            <input
              value={addForm.title}
              onChange={e => setAddForm(f => ({ ...f, title: e.target.value }))}
              style={inputStyle}
              placeholder="일정 제목"
            />
          </div>

          {/* Date */}
          <div style={{ marginBottom: 12, position: 'relative' }}>
            <label style={labelStyle}>날짜</label>
            <div
              onClick={() => {
                setDatePickerTarget('edit');
                setDatePickerMonth(new Date(parseDate(addForm.date).getFullYear(), parseDate(addForm.date).getMonth(), 1));
                setShowDatePicker(!showDatePicker);
              }}
              style={{
                ...inputStyle,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {(() => {
                const d = parseDate(addForm.date);
                return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
              })()}
            </div>
            {showDatePicker && datePickerTarget === 'edit' && renderDatePicker(
              addForm.date,
              (ds) => setAddForm(f => ({ ...f, date: ds })),
              () => setShowDatePicker(false),
            )}
          </div>

          {/* Campaign */}
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>캠페인 (선택)</label>
            <select
              value={addForm.campaign_id}
              onChange={e => setAddForm(f => ({ ...f, campaign_id: e.target.value }))}
              style={{ ...inputStyle, appearance: 'auto' }}
            >
              <option value="">선택 안 함</option>
              {campaignList.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Memo */}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>메모</label>
            <textarea
              value={addForm.memo}
              onChange={e => setAddForm(f => ({ ...f, memo: e.target.value }))}
              style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
              placeholder="메모 (선택)"
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button
              onClick={handleDelete}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '7px 12px',
                border: '1px solid #F3D5D5',
                borderRadius: 8,
                background: '#FCEFEF',
                fontSize: 13,
                fontWeight: 500,
                color: '#D9534F',
                cursor: 'pointer',
                fontFamily: 'var(--font)',
              }}
            >
              <TrashIcon /> 삭제
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={!addForm.title.trim()}>
              저장
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Add Modal ──

  function renderAddModal() {
    if (!showAddModal) return null;

    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.15)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div
          ref={modalRef}
          style={{
            width: 360,
            background: colors.surface,
            border: '1px solid #EDF0F3',
            borderRadius: 12,
            boxShadow: '0 8px 24px rgba(26,29,33,0.10)',
            padding: 24,
          }}
        >
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
          }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: colors.textPrimary }}>일정 추가</span>
            <button
              onClick={() => setShowAddModal(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textInfo, padding: 2 }}
            >
              <CloseIcon />
            </button>
          </div>

          {/* Title */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>제목 <span style={{ color: '#D9534F' }}>*</span></label>
            <input
              value={addForm.title}
              onChange={e => setAddForm(f => ({ ...f, title: e.target.value }))}
              style={inputStyle}
              placeholder="일정 제목을 입력하세요"
              autoFocus
            />
          </div>

          {/* Date */}
          <div style={{ marginBottom: 14, position: 'relative' }}>
            <label style={labelStyle}>날짜 <span style={{ color: '#D9534F' }}>*</span></label>
            <div
              onClick={() => {
                setDatePickerTarget('add');
                setDatePickerMonth(new Date(parseDate(addForm.date).getFullYear(), parseDate(addForm.date).getMonth(), 1));
                setShowDatePicker(!showDatePicker);
              }}
              style={{
                ...inputStyle,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {(() => {
                const d = parseDate(addForm.date);
                return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
              })()}
            </div>
            {showDatePicker && datePickerTarget === 'add' && renderDatePicker(
              addForm.date,
              (ds) => setAddForm(f => ({ ...f, date: ds })),
              () => setShowDatePicker(false),
            )}
          </div>

          {/* Campaign */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>캠페인 (선택)</label>
            <select
              value={addForm.campaign_id}
              onChange={e => setAddForm(f => ({ ...f, campaign_id: e.target.value }))}
              style={{ ...inputStyle, appearance: 'auto' }}
            >
              <option value="">선택 안 함</option>
              {campaignList.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Memo */}
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>메모</label>
            <textarea
              value={addForm.memo}
              onChange={e => setAddForm(f => ({ ...f, memo: e.target.value }))}
              style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }}
              placeholder="메모를 입력하세요 (선택)"
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => setShowAddModal(false)}>
              취소
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={!addForm.title.trim()}>
              저장
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Monthly View ──

  function renderMonthlyView() {
    return (
      <div>
        {/* Day names header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          background: '#F7F9FB',
          borderBottom: '1px solid #E4E8EC',
        }}>
          {DAY_NAMES.map((name, i) => (
            <div key={name} style={{
              textAlign: 'center',
              height: 38,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12.5,
              fontWeight: 600,
              color: i === 0 ? '#C86B67' : i === 6 ? '#5E8FBF' : '#4A4F55',
            }}>
              {name}
            </div>
          ))}
        </div>

        {/* Calendar cells */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
        }}>
          {calendarGrid.map((date, idx) => {
            const ds = toDateStr(date);
            const isCurrentMonth = date.getMonth() === currentMonth.getMonth();
            const isToday = ds === todayStr;
            const dayEvents = eventsByDate[ds] || [];
            const shouldOverflow = dayEvents.length > 4;
            const visibleEvents = shouldOverflow ? dayEvents.slice(0, 3) : dayEvents;
            const overflowCount = shouldOverflow ? dayEvents.length - 3 : 0;
            const dow = date.getDay();

            const isWeekend = dow === 0 || dow === 6;

            return (
              <div
                key={idx}
                style={{
                  minHeight: 88,
                  border: '1px solid #F2F4F7',
                  borderTop: 'none',
                  borderLeft: idx % 7 === 0 ? '1px solid #F2F4F7' : 'none',
                  padding: '4px 5px',
                  position: 'relative',
                  cursor: 'default',
                  background: isToday ? '#F5F9FE' : isWeekend ? '#FCFCFD' : '#FFFFFF',
                  ...(isToday ? { outline: '1px solid #4A7DB5', outlineOffset: -1 } : {}),
                }}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, ds)}
                onClick={() => {
                  if (dayEvents.length === 0) openAddModal(ds);
                }}
              >
                {/* Date number */}
                <div style={{
                  fontSize: 13,
                  fontWeight: isToday ? 700 : 450,
                  color: isToday
                    ? '#1A1D21'
                    : !isCurrentMonth
                      ? colors.textDisabled
                      : dow === 0
                        ? '#C86B67'
                        : dow === 6
                          ? '#5E8FBF'
                          : '#1A1D21',
                  marginBottom: 3,
                  padding: '1px 3px',
                }}>
                  {date.getDate()}
                </div>

                {/* Event chips */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {visibleEvents.map(ev => renderChip(ev, true))}
                </div>

                {/* Overflow indicator */}
                {overflowCount > 0 && (
                  <div
                    style={{
                      fontSize: 11,
                      color: colors.textInfo,
                      marginTop: 2,
                      cursor: 'pointer',
                      paddingLeft: 3,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setOverflowPopover({ date: ds, anchorRect: rect });
                    }}
                  >
                    외 {overflowCount}건
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Weekly View ──

  function renderWeeklyView() {
    return (
      <div>
        {/* Day headers */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          background: '#F7F9FB',
          borderBottom: '1px solid #E4E8EC',
        }}>
          {weekDates.map((date, i) => {
            const ds = toDateStr(date);
            const isToday = ds === todayStr;
            const dow = date.getDay();
            return (
              <div key={i} style={{
                textAlign: 'center',
                height: 38,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <div style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: dow === 0 ? '#C86B67' : dow === 6 ? '#5E8FBF' : '#4A4F55',
                  marginBottom: 1,
                }}>
                  {DAY_NAMES[dow]}
                </div>
                <div style={{
                  fontSize: 14,
                  fontWeight: isToday ? 700 : 450,
                  color: isToday ? '#1A1D21' : '#4A4F55',
                }}>
                  {date.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        {/* Event columns */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
        }}>
          {weekDates.map((date, i) => {
            const ds = toDateStr(date);
            const dayEvents = eventsByDate[ds] || [];
            const isToday = ds === todayStr;
            const dow = date.getDay();
            const isWeekend = dow === 0 || dow === 6;

            return (
              <div
                key={i}
                style={{
                  minHeight: 80,
                  border: '1px solid #F2F4F7',
                  borderTop: 'none',
                  borderLeft: i === 0 ? '1px solid #F2F4F7' : 'none',
                  padding: '6px 5px',
                  background: isToday ? '#F5F9FE' : isWeekend ? '#FCFCFD' : '#FFFFFF',
                  ...(isToday ? { outline: '1px solid #4A7DB5', outlineOffset: -1 } : {}),
                }}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, ds)}
                onClick={() => {
                  if (dayEvents.length === 0) openAddModal(ds);
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {dayEvents.map(ev => renderChip(ev))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Styles ──

  const navBtnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px 6px',
    color: colors.textSecondary,
    borderRadius: 6,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    fontWeight: 450,
    color: colors.textInfo,
    marginBottom: 5,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 36,
    border: '1px solid #EDF0F3',
    borderRadius: 8,
    padding: '0 10px',
    fontSize: 13,
    fontFamily: 'var(--font)',
    color: colors.textPrimary,
    outline: 'none',
    background: colors.surface,
  };

  // ── Main Render ──

  return (
    <div className="section" style={{ position: 'relative' }}>
      {/* Section header */}
      <div className="section-header" style={{
        flexWrap: 'wrap',
        gap: 10,
        padding: '14px 20px',
      }}>
        {/* Left: Title */}
        <span className="section-title">일정</span>

        {/* Type filter pills (single-select) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12 }}>
          {renderFilterPill(null)}
          {TYPE_ORDER.map(t => renderFilterPill(t))}
        </div>

        {/* Overdue toggle */}
        <button
          onClick={toggleOverdueOnly}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            height: 30,
            padding: '0 12px',
            border: filters.overdueOnly ? '1px solid #F0CFCD' : '1px solid #E4E8EC',
            borderRadius: 8,
            background: filters.overdueOnly ? '#FBE9E8' : '#FFFFFF',
            fontSize: 12.5,
            fontWeight: 500,
            color: filters.overdueOnly ? '#8F3A37' : '#6E767E',
            cursor: 'pointer',
            fontFamily: 'var(--font)',
            whiteSpace: 'nowrap',
            marginLeft: 4,
          }}
        >
          기한 초과만
        </button>

        {/* Right group */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          {/* Search */}
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
              <SearchIcon />
            </span>
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="캠페인/채널명 검색"
              style={{
                height: 36,
                border: '1px solid #EDF0F3',
                borderRadius: 10,
                paddingLeft: 30,
                paddingRight: 10,
                fontSize: 12.5,
                fontFamily: 'var(--font)',
                color: colors.textPrimary,
                outline: 'none',
                width: 170,
                background: colors.surface,
              }}
            />
          </div>

          {/* View mode segment */}
          <div className="filter-segment">
            <button
              className={`seg-btn${viewMode === 'month' ? ' active' : ''}`}
              onClick={() => setViewMode('month')}
            >
              월
            </button>
            <button
              className={`seg-btn${viewMode === 'week' ? ' active' : ''}`}
              onClick={() => setViewMode('week')}
            >
              주
            </button>
          </div>

          {/* Month/Week navigation */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <button
              onClick={viewMode === 'month' ? prevMonth : prevWeek}
              style={navBtnStyle}
              title="이전"
            >
              <ChevronLeft />
            </button>
            <button
              onClick={goToday}
              style={{
                ...navBtnStyle,
                fontSize: 13,
                fontWeight: 600,
                color: colors.textPrimary,
                padding: '4px 8px',
                whiteSpace: 'nowrap',
              }}
            >
              {monthLabel}
            </button>
            <button
              onClick={viewMode === 'month' ? nextMonth : nextWeek}
              style={navBtnStyle}
              title="다음"
            >
              <ChevronRight />
            </button>
          </div>

          {/* Add button */}
          <button
            onClick={() => openAddModal()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              height: 32,
              padding: '0 14px',
              background: colors.accentDark,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 12.5,
              fontWeight: 550,
              cursor: 'pointer',
              fontFamily: 'var(--font)',
            }}
          >
            <PlusIcon />
            <span>일정 추가</span>
          </button>
        </div>
      </div>

      {/* Section body */}
      <div style={{ padding: '14px 20px 20px' }}>
        {/* Today banner */}
        {renderTodayBanner()}

        {/* Loading state */}
        {loading ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
            일정을 불러오는 중...
          </div>
        ) : (
          <>
            {viewMode === 'month' ? renderMonthlyView() : renderWeeklyView()}
            {/* Empty state messages */}
            {filteredEvents.length === 0 && events.length > 0 && (
              <div style={{ padding: '24px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: colors.textSecondary, marginBottom: 8 }}>
                  선택한 유형에 해당하는 일정이 없습니다
                </div>
                <button
                  onClick={() => { setFilters({ selectedType: null, overdueOnly: false, search: '' }); setSearchInput(''); }}
                  style={{
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: colors.accent,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'var(--font)',
                    textDecoration: 'underline',
                    textUnderlineOffset: 2,
                  }}
                >
                  필터 초기화
                </button>
              </div>
            )}
            {events.length === 0 && (
              <div style={{ padding: '24px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: colors.textSecondary, marginBottom: 4 }}>
                  이 달에 예정된 일정이 없습니다
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 450, color: colors.textInfo }}>
                  참여자 일정을 입력하면 여기에 표시됩니다
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Overflow popover */}
      {renderOverflowPopover()}

      {/* Edit popover (for custom events) */}
      {editingEvent && editingEvent.type === 'custom' && renderEditPopover()}

      {/* Add modal */}
      {renderAddModal()}

      {/* Drag tooltip for non-custom events */}
      {dragTooltip && (
        <div style={{
          position: 'fixed',
          top: dragTooltip.y - 36,
          left: dragTooltip.x,
          background: colors.accentDark,
          color: '#fff',
          fontSize: 11,
          padding: '5px 10px',
          borderRadius: 6,
          zIndex: 300,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}>
          참여자 정보에서 일정을 수정해주세요
        </div>
      )}

      {/* Error toast */}
      {errorToast && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: colors.accentDark,
          color: '#fff',
          fontSize: 13,
          padding: '10px 20px',
          borderRadius: 10,
          zIndex: 300,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>
          {errorToast}
        </div>
      )}
    </div>
  );
}
