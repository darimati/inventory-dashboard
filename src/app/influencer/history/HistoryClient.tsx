'use client';

import { useState, useEffect, useCallback } from 'react';
import { colors, typo, spacing, radii, cardStyle, colAlign } from '@/lib/influencer/styles';
import { Chip, Btn, Card, Empty } from '@/lib/influencer/ui';
import type { StatusColor } from '@/lib/influencer/styles';

/* ── Log field / action labels ─────────────────────────── */

const FIELD_LABELS: Record<string, string> = {
  participant_delete: '참여자 삭제',
  campaign_cascade_delete: '캠페인 삭제',
  campaign_reset: '캠페인 초기화',
  participant_reset: '참여자 초기화',
  payment_status: '정산 상태',
  bank_account: '계좌 정보',
  consent_received_at: '동의서',
  draft_received_at: '기획안',
  edit_received_at: '가편집본',
  uploaded_at: '업로드',
  performance_checked_at: '성과 확인',
  published_url: '게시 URL',
};

const ACTION_LABELS: Record<string, string> = {
  check_step: '단계 확인',
  undo_step: '단계 취소',
  revision_requested: '수정 요청',
  reset_progress: '진행 초기화',
  decrypt: '개인정보 조회',
  export_excel: '엑셀 내보내기',
};

function getActionChip(action: string): { label: string; variant: StatusColor } {
  if (action === 'undo_step' || action === 'reset_progress') {
    return { label: ACTION_LABELS[action] ?? action, variant: 'coral' };
  }
  if (action === 'revision_requested') {
    return { label: '수정 요청', variant: 'coral' };
  }
  if (action === 'decrypt' || action === 'export_excel') {
    return { label: ACTION_LABELS[action] ?? action, variant: 'blue' };
  }
  if (action === 'check_step') {
    return { label: '단계 확인', variant: 'mint' };
  }
  if (action.startsWith('batch_update_') || action.startsWith('update_')) {
    const status = action.replace('batch_update_', '').replace('update_', '');
    return { label: `정산 → ${status}`, variant: 'blue' };
  }
  return { label: action, variant: 'gray' };
}

/* ── Types ───────────────────────────────────────────────── */

interface Participant {
  id: string;
  name: string | null;
  display_name: string | null;
  handle: string | null;
  channel: string | null;
}

interface AccessLog {
  id: string;
  actor_id: string | null;
  participant_id: string | null;
  field_name: string;
  action: string;
  ip_address: string | null;
  created_at: string;
  participant: Participant | null;
}

interface LogsResponse {
  data: AccessLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/* ── Component ───────────────────────────────────────────── */

export default function HistoryClient() {
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const limit = 50;

  const fetchLogs = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/influencer/access-logs?page=${p}&limit=${limit}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const json: LogsResponse = await res.json();
      setLogs(json.data);
      setTotal(json.total);
      setTotalPages(json.totalPages);
      setPage(json.page);
    } catch {
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLogs(1); }, [fetchLogs]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${m}/${day} ${h}:${min}`;
  };

  const participantLabel = (log: AccessLog) => {
    const p = log.participant;
    if (!p) return log.participant_id ? '(삭제됨)' : '-';
    return p.name || p.display_name || p.handle || '-';
  };

  /* ── Columns ─────────────────────────────────────────── */

  const COL = {
    date: 110,
    participant: 140,
    field: 130,
    action: 120,
    detail: 0, // flex
    ip: 110,
  };

  return (
    <div style={{ padding: spacing.cardPadding }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.gap }}>
        <h1 style={{ ...typo.pageTitle, color: colors.textPrimary, margin: 0 }}>기록</h1>
        <span style={{ ...typo.meta, color: colors.textMuted }}>
          전체 {total.toLocaleString()}건
        </span>
      </div>

      {/* Table */}
      <Card>
        {/* Header row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 40,
            padding: `0 ${spacing.tableCellPx}px`,
            borderBottom: `1px solid ${colors.borderLight}`,
            background: colors.bg,
            borderRadius: `${radii.card}px ${radii.card}px 0 0`,
          }}
        >
          <span style={{ ...typo.tableHeader, width: COL.date, flexShrink: 0 }}>일시</span>
          <span style={{ ...typo.tableHeader, width: COL.participant, flexShrink: 0 }}>참여자</span>
          <span style={{ ...typo.tableHeader, width: COL.field, flexShrink: 0 }}>항목</span>
          <span style={{ ...typo.tableHeader, width: COL.action, flexShrink: 0 }}>액션</span>
          <span style={{ ...typo.tableHeader, flex: 1, minWidth: 100 }}>상세</span>
          <span style={{ ...typo.tableHeader, width: COL.ip, flexShrink: 0, textAlign: 'right' }}>IP</span>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted, ...typo.body }}>
            불러오는 중...
          </div>
        )}

        {/* Empty */}
        {!loading && logs.length === 0 && (
          <Empty message="기록이 없습니다" />
        )}

        {/* Rows */}
        {!loading && logs.map((log) => {
          const chip = getActionChip(log.action);
          return (
            <div
              key={log.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                minHeight: spacing.tableRowH,
                padding: `8px ${spacing.tableCellPx}px`,
                borderBottom: `1px solid ${colors.borderLight}`,
              }}
            >
              <span style={{ ...typo.tableBody, width: COL.date, flexShrink: 0, ...colAlign('text'), fontVariantNumeric: 'tabular-nums' }}>
                {formatDate(log.created_at)}
              </span>
              <span style={{ ...typo.tableBody, width: COL.participant, flexShrink: 0, color: colors.textPrimary, fontWeight: 500 }}>
                {participantLabel(log)}
              </span>
              <span style={{ ...typo.tableBody, width: COL.field, flexShrink: 0 }}>
                {FIELD_LABELS[log.field_name] ?? log.field_name}
              </span>
              <span style={{ width: COL.action, flexShrink: 0 }}>
                <Chip variant={chip.variant}>{chip.label}</Chip>
              </span>
              <span style={{
                ...typo.meta,
                flex: 1,
                minWidth: 100,
                color: colors.textMuted,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {log.action.startsWith('batch_update_') || log.action.startsWith('update_')
                  ? log.action.replace('batch_update_', '').replace('update_', '')
                  : (log.action === 'check_step' || log.action === 'undo_step' || log.action === 'revision_requested'
                    ? (FIELD_LABELS[log.field_name] ?? log.field_name)
                    : (log.action !== 'decrypt' && log.action !== 'export_excel' && log.action !== 'reset_progress'
                      ? log.action
                      : '')
                  )
                }
              </span>
              <span style={{ ...typo.meta, width: COL.ip, flexShrink: 0, textAlign: 'right', color: colors.textDisabled, fontVariantNumeric: 'tabular-nums' }}>
                {log.ip_address ?? '-'}
              </span>
            </div>
          );
        })}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '12px 0',
            borderTop: `1px solid ${colors.borderLight}`,
          }}>
            <Btn
              size="sm"
              disabled={page <= 1}
              onClick={() => fetchLogs(page - 1)}
            >
              이전
            </Btn>
            <span style={{ ...typo.meta, color: colors.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
              {page} / {totalPages}
            </span>
            <Btn
              size="sm"
              disabled={page >= totalPages}
              onClick={() => fetchLogs(page + 1)}
            >
              다음
            </Btn>
          </div>
        )}
      </Card>
    </div>
  );
}
