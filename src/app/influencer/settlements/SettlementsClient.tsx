'use client';

import { useState, useEffect, useRef } from 'react';
import AppShell from '@/components/AppShell';
import { formatKRW } from '@/lib/helpers';
import { CHANNEL_LABELS, TAX_TYPE_LABELS, type Channel, type TaxType, type ContentFormatEntry, formatContentFormats } from '@/lib/types/influencer';
import { colors, typo, spacing, radii } from '@/lib/influencer/styles';
import { Toast } from '@/lib/influencer/ui';
import { formatSlackSettlement, formatSlackSettlements, formatSlackMonthly, calcTaxBreakdown, sumSettlements, getMonthlyAmounts } from '@/lib/influencer/metrics';
import { daysBetween, formatDDay, getDDayStyle } from '@/lib/dday';

/* ── Types ──────────────────────────────────────────── */

interface SettlementRow {
  id: string;
  participant_id: string;
  participant_name: string;
  participant_handle: string | null;
  campaign_name: string;
  channel: string;
  gross_amount: number;
  tax_type: string | null;
  tax_rate: number | null;
  tax_amount: number | null;
  net_amount: number | null;
  income_tax_amount: number | null;
  local_tax_amount: number | null;
  payment_status: string;
  planned_date: string | null;
  planned_payment_date: string | null;
  paid_date: string | null;
  actual_paid_date: string | null;
  memo: string | null;
  revision_message: string | null;
  settlement_status: string | null;
  bank_name: string;
  bank_holder: string;
  business_name: string;
  real_name: string;
  published_url: string;
  content_formats: { format: string; count: number }[];
  ssn_masked: string | null;
  bank_account_masked: string | null;
  business_reg_masked: string | null;
  has_ssn: boolean;
  has_bank_account: boolean;
  has_business_reg: boolean;
  has_biz_reg_file: boolean;
  has_identity_doc: boolean;
  submitted_at: string | null;
  invoice_status: string | null;
}

type Tab = 'needs_review' | 'pending_payment' | 'completed' | 'all';

type ActionModal =
  | { type: 'revision_request'; settlementId: string; participantName: string }
  | { type: 'mark_paid'; settlementId: string; participantName: string; netAmount: number }
  | null;

/* ── Component ──────────────────────────────────────── */

export default function SettlementsClient() {
  const [tab, setTab] = useState<Tab>('needs_review');
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [errorMsg, setErrorMsg] = useState('');
  const [detailRow, setDetailRow] = useState<SettlementRow | null>(null);
  const [toast, setToast] = useState('');
  const [actionModal, setActionModal] = useState<ActionModal>(null);
  const [revisionMessage, setRevisionMessage] = useState('');
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));
  const [paidMemo, setPaidMemo] = useState('');
  const mouseDownRef = useRef<EventTarget | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/influencer/settlements?unmask=true');
      const data = await res.json();
      setSettlements(Array.isArray(data) ? data : []);
    } catch {
      setSettlements([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  /* ── Derived data ──────────────────────────────────── */

  const needsReviewRows = settlements.filter(r => r.payment_status === 'waiting');
  const pendingPaymentRows = settlements.filter(r => r.payment_status === 'confirmed' || r.payment_status === 'requested');
  const completedRows = settlements.filter(r => r.payment_status === 'paid');

  const toSumInput = (r: SettlementRow) => ({ gross_amount: r.gross_amount, net_amount: r.net_amount ?? undefined });
  const totalPendingPayment = sumSettlements(pendingPaymentRows.map(toSumInput), 'net');
  const totalCompleted = sumSettlements(completedRows.map(toSumInput), 'net');

  const tabCounts: Record<Tab, number> = {
    needs_review: needsReviewRows.length,
    pending_payment: pendingPaymentRows.length,
    completed: completedRows.length,
    all: settlements.length,
  };

  const currentRows = tab === 'needs_review' ? needsReviewRows
    : tab === 'pending_payment' ? pendingPaymentRows
    : tab === 'completed' ? completedRows
    : settlements;

  /* ── PII handlers ──────────────────────────────────── */


  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setToast(`${label} 복사됨`);
      setTimeout(() => setToast(''), 2000);
    });
  };

  /* ── Action handlers ───────────────────────────────── */

  const handleConfirm = async (settlementId: string) => {
    const res = await fetch('/api/influencer/settlements', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm', settlement_id: settlementId }),
    });
    if (!res.ok) {
      const data = await res.json();
      setErrorMsg(data.error || '확인 처리 실패');
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }
    setToast('확인 완료 처리됨');
    setTimeout(() => setToast(''), 2000);
    setDetailRow(null);
    fetchData();
  };

  const handleRevisionRequest = async () => {
    if (!actionModal || actionModal.type !== 'revision_request') return;
    if (!revisionMessage.trim()) {
      setErrorMsg('수정 요청 메시지를 입력해주세요.');
      setTimeout(() => setErrorMsg(''), 3000);
      return;
    }
    const res = await fetch('/api/influencer/settlements', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'revision_request',
        settlement_id: actionModal.settlementId,
        revision_message: revisionMessage.trim(),
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      setErrorMsg(data.error || '수정 요청 실패');
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }
    setToast('수정 요청 전송됨');
    setTimeout(() => setToast(''), 2000);
    setActionModal(null);
    setRevisionMessage('');
    setDetailRow(null);
    fetchData();
  };

  const handleMarkPaid = async () => {
    if (!actionModal || actionModal.type !== 'mark_paid') return;
    const res = await fetch('/api/influencer/settlements', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'mark_paid',
        settlement_id: actionModal.settlementId,
        actual_paid_date: paidDate,
        memo: paidMemo.trim() || undefined,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      setErrorMsg(data.error || '지급 완료 처리 실패');
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }
    setToast('지급 완료 처리됨');
    setTimeout(() => setToast(''), 2000);
    setActionModal(null);
    setPaidMemo('');
    setDetailRow(null);
    fetchData();
  };

  const handleBatchConfirm = async () => {
    const rows = needsReviewRows.filter(r => selected.has(r.id));
    if (rows.length === 0) return;
    if (!confirm(`${rows.length}건을 확인 완료로 처리하시겠습니까?`)) return;
    for (const r of rows) {
      await fetch('/api/influencer/settlements', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', settlement_id: r.id }),
      });
    }
    setSelected(new Set());
    setToast(`${rows.length}건 확인 완료 처리됨`);
    setTimeout(() => setToast(''), 2000);
    fetchData();
  };

  const handleBatchMarkPaid = async () => {
    const rows = pendingPaymentRows.filter(r => selected.has(r.id));
    if (rows.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    if (!confirm(`${rows.length}건을 지급 완료로 처리하시겠습니까?\n지급일: ${today}`)) return;
    for (const r of rows) {
      await fetch('/api/influencer/settlements', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_paid', settlement_id: r.id, actual_paid_date: today }),
      });
    }
    setSelected(new Set());
    setToast(`${rows.length}건 지급 완료 처리됨`);
    setTimeout(() => setToast(''), 2000);
    fetchData();
  };

  /* ── Export & Slack copy ────────────────────────────── */

  const handleSlackCopy = (rows: SettlementRow[]) => {
    if (rows.length === 0) return;
    const text = formatSlackSettlements(rows.map(r => ({
      participant_name: r.participant_name,
      tax_type: r.tax_type || 'business_income',
      gross_amount: r.gross_amount,
      net_amount: r.net_amount ?? r.gross_amount,
      bank_name: r.bank_name,
      bank_holder: r.bank_holder,
    })));
    navigator.clipboard.writeText(text).then(() => {
      setToast(`${rows.length}건 Slack 형식 복사됨`);
      setTimeout(() => setToast(''), 2000);
    });
  };

  const handleSlackCopySelected = () => {
    const rows = currentRows.filter(r => selected.has(r.id));
    handleSlackCopy(rows.length > 0 ? rows : currentRows);
  };

  const handleSlackCopyMonthly = () => {
    const now = new Date();
    const monthStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월`;
    const amounts = getMonthlyAmounts(settlements.map(r => ({
      gross_amount: r.gross_amount,
      net_amount: r.net_amount ?? undefined,
      income_tax_amount: r.income_tax_amount ?? undefined,
      local_tax_amount: r.local_tax_amount ?? undefined,
      payment_status: r.payment_status,
    })));
    const text = formatSlackMonthly(monthStr, amounts);
    navigator.clipboard.writeText(text).then(() => {
      setToast('월간 집계 Slack 형식 복사됨');
      setTimeout(() => setToast(''), 2000);
    });
  };

  /* ── File download ─────────────────────────────────── */

  const handleDownloadFile = async (participantId: string, docType: string = 'biz_reg') => {
    const res = await fetch(`/api/influencer/settlements?action=file_url&participant_id=${participantId}&doc_type=${docType}`);
    const data = await res.json();
    if (data.url) window.open(data.url, '_blank');
    else { setToast('파일이 없습니다'); setTimeout(() => setToast(''), 2000); }
  };

  /* ── Invoice status ────────────────────────────────── */

  const handleInvoiceStatusChange = async (id: string, status: string) => {
    await fetch('/api/influencer/settlements', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, invoice_status: status }),
    });
    fetchData();
    setDetailRow(prev => prev ? { ...prev, invoice_status: status } : null);
  };

  /* ── Selection ─────────────────────────────────────── */

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (ids: string[]) => {
    const allSelected = ids.every(id => selected.has(id));
    if (allSelected) {
      setSelected(prev => { const next = new Set(prev); ids.forEach(id => next.delete(id)); return next; });
    } else {
      setSelected(prev => { const next = new Set(prev); ids.forEach(id => next.add(id)); return next; });
    }
  };

  /* ── Helpers ──────────────────────────────────────── */

  const fmtDate = (d: string | null) => d ? d.slice(0, 10) : '-';
  const taxLabel = (t: string | null) => t ? (TAX_TYPE_LABELS[t as TaxType] ?? t) : '-';
  const channelLabel = (c: string | null) => c ? (CHANNEL_LABELS[c as Channel] ?? c) : '';
  const displayRealName = (r: SettlementRow) => r.tax_type === 'business_income' ? (r.real_name || '-') : (r.business_name || '-');
  const isInvoiceType = (t: string | null) => t === 'tax_invoice' || t === 'tax_exempt_invoice';

  const getTaxDisplay = (r: SettlementRow) => {
    if (r.income_tax_amount != null && r.local_tax_amount != null) {
      return { incomeTax: r.income_tax_amount, localTax: r.local_tax_amount };
    }
    const tax = calcTaxBreakdown(r.gross_amount, r.tax_type || 'business_income');
    return { incomeTax: tax.incomeTax, localTax: tax.localTax };
  };

  const INVOICE_STATUS_LABELS: Record<string, string> = {
    pending: '발행 대기',
    received: '수취 완료',
    verified: '검증 완료',
  };

  const invoiceStatusColor = (s: string | null): string => {
    if (s === 'verified') return '#22c55e';
    if (s === 'received') return '#4A7DB5';
    return '#E6A817';
  };

  /* ── Styles ──────────────────────────────────────── */

  const cardBg: React.CSSProperties = {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.card,
    padding: '16px 20px',
  };

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 16px',
    border: 'none',
    borderBottom: active ? `2px solid ${colors.accent}` : '2px solid transparent',
    background: 'none',
    fontSize: 14,
    fontWeight: active ? 600 : 400,
    color: active ? colors.accent : colors.textMuted,
    cursor: 'pointer',
    fontFamily: 'var(--font)',
  });

  const btnSmall: React.CSSProperties = {
    padding: '4px 12px',
    background: 'none',
    border: `1px solid ${colors.border}`,
    borderRadius: radii.chip,
    fontSize: 12,
    cursor: 'pointer',
    color: colors.textSecondary,
    whiteSpace: 'nowrap',
    fontFamily: 'var(--font)',
  };

  const btnPrimary: React.CSSProperties = {
    height: 36,
    padding: '0 16px',
    background: colors.accentDark,
    color: '#fff',
    border: 'none',
    borderRadius: radii.button,
    fontSize: 13.5,
    fontWeight: 550,
    cursor: 'pointer',
    fontFamily: 'var(--font)',
  };

  const btnDanger: React.CSSProperties = {
    ...btnSmall,
    color: '#DC2626',
    borderColor: '#FECACA',
  };

  const thStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 450, color: colors.textInfo,
    padding: '0 16px', textAlign: 'left', height: 40,
    borderBottom: `1px solid ${colors.border}`,
    background: '#F9FAFB',
    whiteSpace: 'nowrap',
  };

  const tdStyle: React.CSSProperties = {
    fontSize: 13, color: colors.textPrimary,
    padding: '0 16px', height: 56,
    borderBottom: `1px solid ${colors.border}`,
    verticalAlign: 'middle',
  };

  // Alignment helpers
  const thRight: React.CSSProperties = { ...thStyle, textAlign: 'right' };
  const thCenter: React.CSSProperties = { ...thStyle, textAlign: 'center' };
  const tdRight: React.CSSProperties = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  const tdCenter: React.CSSProperties = { ...tdStyle, textAlign: 'center' };

  // Column widths per spec: 48/180/240/110/120/120/150/90/120
  const COL = { name: 180, campaign: 240, tax: 110, fee: 120, net: 120, payDate: 150, evidence: 90, action: 120, check: 48 };

  const modalOverlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
  };

  const modalContent: React.CSSProperties = {
    background: colors.surface, borderRadius: radii.card, padding: spacing.cardPadding,
    width: 520, maxHeight: '85vh', overflowY: 'auto',
  };

  const detailRowStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    padding: '6px 0', fontSize: 13, borderBottom: `1px solid ${colors.borderLight}`,
  };

  const detailLbl: React.CSSProperties = { color: colors.textInfo, flexShrink: 0 };
  const detailVal: React.CSSProperties = { color: colors.textPrimary, fontWeight: 500, textAlign: 'right' };

  /* ── Evidence helper ─────────────────────────────────── */

  const EvidenceCell = ({ r }: { r: SettlementRow }) => {
    if (isInvoiceType(r.tax_type)) {
      return (
        <span style={{
          display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500,
          color: invoiceStatusColor(r.invoice_status),
          background: r.invoice_status === 'verified' ? '#F0FDF4' : r.invoice_status === 'received' ? '#F0F4FA' : '#FFFBEB',
        }}>
          {r.invoice_status ? INVOICE_STATUS_LABELS[r.invoice_status] ?? r.invoice_status : '대기'}
        </span>
      );
    }
    if (r.tax_type === 'business_income') {
      if (r.has_identity_doc) {
        return <span style={{ fontSize: 11.5, color: '#22C55E', fontWeight: 500 }}>제출됨</span>;
      }
      return <span style={{ fontSize: 11.5, color: '#D97706', fontWeight: 500 }}>⚠ 미제출</span>;
    }
    return <span style={{ fontSize: 11, color: colors.textMuted }}>-</span>;
  };

  /** Payment date + D-day cell (2 lines, centered) */
  const PayDateCell = ({ date }: { date: string | null }) => {
    if (!date) return <span style={{ color: colors.textMuted }}>-</span>;
    const dd = daysBetween(null, date);
    const s = getDDayStyle(dd);
    return (
      <div style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums', lineHeight: 1.4 }}>
        <div style={{ fontSize: 13 }}>{fmtDate(date)}</div>
        <div style={{ fontSize: 11.5, color: dd <= 0 ? '#B03F3B' : '#6E767E', fontWeight: s.weight }}>
          {formatDDay(dd)}
        </div>
      </div>
    );
  };

  /* ── Sub-components ────────────────────────────────── */

  const NameCell = ({ name, handle, channel }: { name: string; handle?: string | null; channel?: string | null }) => (
    <div>
      <div style={{ fontWeight: 500, color: name ? colors.textPrimary : colors.textMuted, lineHeight: 1.3 }}>
        {name || '(채널명 미입력)'}
      </div>
      <div style={{ fontSize: 11.5, color: colors.textMuted, marginTop: 1 }}>
        {[handle ? `@${handle}` : null, channel ? channelLabel(channel) : null].filter(Boolean).join(' · ') || ''}
      </div>
    </div>
  );

  const StatusBadge = ({ status }: { status: string }) => {
    const config: Record<string, { label: string; color: string; bg: string }> = {
      waiting: { label: '확인 필요', color: '#D97706', bg: '#FFFBEB' },
      confirmed: { label: '확인 완료', color: '#4A7DB5', bg: '#F0F4FA' },
      requested: { label: '지급 요청', color: '#7C3AED', bg: '#F5F3FF' },
      paid: { label: '지급 완료', color: '#22C55E', bg: '#F0FDF4' },
      on_hold: { label: '보류', color: '#DC2626', bg: '#FEF2F2' },
    };
    const c = config[status] || { label: status, color: colors.textMuted, bg: colors.grayBadgeBg };
    return (
      <span style={{
        display: 'inline-block', padding: '2px 8px', borderRadius: 4,
        fontSize: 11, fontWeight: 500, color: c.color, background: c.bg,
      }}>
        {c.label}
      </span>
    );
  };

  /* ── Detail Panel ──────────────────────────────────── */

  const renderDetailPanel = () => {
    if (!detailRow) return null;
    const r = detailRow;
    const taxInfo = getTaxDisplay(r);
    const isBusinessIncome = r.tax_type === 'business_income';
    const isTaxInvoice = r.tax_type === 'tax_invoice';
    const isTaxExempt = r.tax_type === 'tax_exempt_invoice';

    return (
      <div style={modalOverlay} onMouseDown={e => { mouseDownRef.current = e.target; }} onClick={e => { if (e.target === e.currentTarget && mouseDownRef.current === e.currentTarget) setDetailRow(null); }}>
        <div style={modalContent}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>정산 상세</h2>
              <StatusBadge status={r.payment_status} />
            </div>
            <button style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: colors.textMuted, padding: '4px 8px' }} onClick={() => setDetailRow(null)}>&#10005;</button>
          </div>

          {/* Revision message */}
          {r.revision_message && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 12.5, color: '#DC2626' }}>
              <strong>수정 요청:</strong> {r.revision_message}
            </div>
          )}

          {/* Basic info */}
          <div style={{ borderBottom: `1px solid ${colors.border}`, paddingBottom: 12, marginBottom: 12 }}>
            <div style={detailRowStyle}>
              <span style={detailLbl}>인플루언서</span>
              <span style={detailVal}>{r.participant_name}</span>
            </div>
            <div style={detailRowStyle}>
              <span style={detailLbl}>실명</span>
              <span style={detailVal}>{displayRealName(r)}</span>
            </div>
            <div style={detailRowStyle}>
              <span style={detailLbl}>캠페인</span>
              <span style={detailVal}>{r.campaign_name}</span>
            </div>
          </div>

          {/* Tax / amount section */}
          <div style={{ borderBottom: `1px solid ${colors.border}`, paddingBottom: 12, marginBottom: 12 }}>
            <div style={detailRowStyle}>
              <span style={detailLbl}>세금 방식</span>
              <span style={detailVal}>{taxLabel(r.tax_type)}</span>
            </div>
            <div style={detailRowStyle}>
              <span style={detailLbl}>고료(세전)</span>
              <span style={{ ...detailVal, fontVariantNumeric: 'tabular-nums' }}>{formatKRW(r.gross_amount)}</span>
            </div>
            {isBusinessIncome && (
              <>
                <div style={detailRowStyle}>
                  <span style={detailLbl}>소득세 (3%)</span>
                  <span style={{ ...detailVal, fontVariantNumeric: 'tabular-nums', color: '#DC2626' }}>-{formatKRW(taxInfo.incomeTax)}</span>
                </div>
                <div style={detailRowStyle}>
                  <span style={detailLbl}>지방소득세 (0.3%)</span>
                  <span style={{ ...detailVal, fontVariantNumeric: 'tabular-nums', color: '#DC2626' }}>-{formatKRW(taxInfo.localTax)}</span>
                </div>
              </>
            )}
            {isTaxInvoice && r.tax_amount != null && (
              <div style={detailRowStyle}>
                <span style={detailLbl}>부가세</span>
                <span style={{ ...detailVal, fontVariantNumeric: 'tabular-nums' }}>+{formatKRW(r.tax_amount)} ({r.tax_rate}%)</span>
              </div>
            )}
            {isTaxExempt && (
              <div style={detailRowStyle}>
                <span style={detailLbl}>부가세</span>
                <span style={detailVal}>면세 (0%)</span>
              </div>
            )}
            <div style={detailRowStyle}>
              <span style={detailLbl}>{isTaxInvoice ? '세금계산서 발행액' : isTaxExempt ? '계산서 발행액' : '실지급액'}</span>
              <span style={{ ...detailVal, fontVariantNumeric: 'tabular-nums', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                {formatKRW(r.net_amount ?? r.gross_amount)}
                <button style={{ ...btnSmall, fontSize: 11, padding: '2px 8px' }} onClick={() => handleCopy(String(r.net_amount ?? r.gross_amount), '실지급액')}>복사</button>
              </span>
            </div>
          </div>

          {/* Bank info */}
          <div style={{ borderBottom: `1px solid ${colors.border}`, paddingBottom: 12, marginBottom: 12 }}>
            <div style={detailRowStyle}>
              <span style={detailLbl}>은행</span>
              <span style={detailVal}>{r.bank_name || '-'}</span>
            </div>
            <div style={detailRowStyle}>
              <span style={detailLbl}>계좌번호</span>
              <span style={{ ...detailVal, display: 'flex', alignItems: 'center', gap: 6 }}>
                {r.bank_account_masked ? (
                  <>
                    <span>{r.bank_account_masked}</span>
                    <button style={{ ...btnSmall, fontSize: 12, padding: '4px 12px' }} onClick={() => handleCopy(r.bank_account_masked!, '계좌번호')}>복사</button>
                  </>
                ) : '-'}
              </span>
            </div>
            <div style={detailRowStyle}>
              <span style={detailLbl}>예금주</span>
              <span style={detailVal}>{r.bank_holder || '-'}</span>
            </div>
          </div>

          {/* Content / dates */}
          <div style={{ borderBottom: `1px solid ${colors.border}`, paddingBottom: 12, marginBottom: 12 }}>
            {r.content_formats && r.content_formats.length > 0 && (
              <div style={detailRowStyle}>
                <span style={detailLbl}>콘텐츠</span>
                <span style={{ ...detailVal, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {formatContentFormats(r.content_formats as ContentFormatEntry[])}
                  {r.published_url && (
                    <a href={r.published_url} target="_blank" rel="noopener noreferrer" style={{ color: colors.accent, fontSize: 12 }}>[보기]</a>
                  )}
                </span>
              </div>
            )}
            <div style={detailRowStyle}>
              <span style={detailLbl}>제출일</span>
              <span style={{ ...detailVal, fontVariantNumeric: 'tabular-nums' }}>{fmtDate(r.submitted_at)}</span>
            </div>
            {r.planned_payment_date && (() => {
              const dd = daysBetween(null, r.planned_payment_date);
              return (
                <div style={detailRowStyle}>
                  <span style={detailLbl}>지급예정일</span>
                  <span style={{ ...detailVal, fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {fmtDate(r.planned_payment_date)}
                    <span style={{ fontSize: 11.5, color: dd <= 0 ? '#B03F3B' : '#6E767E', fontWeight: dd <= 0 ? 550 : 450 }}>{formatDDay(dd)}</span>
                  </span>
                </div>
              );
            })()}
            {(r.actual_paid_date || r.paid_date) && (
              <div style={detailRowStyle}>
                <span style={detailLbl}>실지급일</span>
                <span style={{ ...detailVal, fontVariantNumeric: 'tabular-nums' }}>{fmtDate(r.actual_paid_date || r.paid_date)}</span>
              </div>
            )}
            {r.memo && (
              <div style={detailRowStyle}>
                <span style={detailLbl}>메모</span>
                <span style={detailVal}>{r.memo}</span>
              </div>
            )}
          </div>

          {/* Invoice status */}
          {isInvoiceType(r.tax_type) && (
            <div style={{ borderBottom: `1px solid ${colors.border}`, paddingBottom: 12, marginBottom: 12 }}>
              <div style={detailRowStyle}>
                <span style={detailLbl}>{r.tax_type === 'tax_invoice' ? '세금계산서' : '계산서'} 상태</span>
                <span style={{ ...detailVal, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11.5, fontWeight: 500,
                    color: invoiceStatusColor(r.invoice_status),
                    background: r.invoice_status === 'verified' ? '#F0FDF4' : r.invoice_status === 'received' ? '#F0F4FA' : '#FFFBEB',
                  }}>
                    {r.invoice_status ? INVOICE_STATUS_LABELS[r.invoice_status] ?? r.invoice_status : '발행 대기'}
                  </span>
                  <select
                    style={{ ...btnSmall, padding: '2px 8px', fontSize: 11 }}
                    value={r.invoice_status ?? 'pending'}
                    onChange={e => handleInvoiceStatusChange(r.id, e.target.value)}
                  >
                    <option value="pending">발행 대기</option>
                    <option value="received">수취 완료</option>
                    <option value="verified">검증 완료</option>
                  </select>
                </span>
              </div>
            </div>
          )}

          {/* Attachments */}
          {(r.has_biz_reg_file || r.has_identity_doc) && (
            <div style={{ borderBottom: `1px solid ${colors.border}`, paddingBottom: 12, marginBottom: 12 }}>
              {r.has_biz_reg_file && (
                <div style={detailRowStyle}>
                  <span style={detailLbl}>사업자등록증</span>
                  <button style={btnSmall} onClick={() => handleDownloadFile(r.participant_id, 'biz_reg')}>다운로드</button>
                </div>
              )}
              {r.has_identity_doc && (
                <div style={detailRowStyle}>
                  <span style={detailLbl}>신분증 사본</span>
                  <button style={btnSmall} onClick={() => handleDownloadFile(r.participant_id, 'identity_doc')}>다운로드</button>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
            <button
              style={btnSmall}
              onClick={() => handleSlackCopy([r])}
            >Slack 복사</button>
            <div style={{ display: 'flex', gap: 8 }}>
              {r.payment_status === 'waiting' && (
                <>
                  <button style={btnDanger} onClick={() => { setActionModal({ type: 'revision_request', settlementId: r.id, participantName: r.participant_name }); }}>
                    수정 요청
                  </button>
                  <button style={btnPrimary} onClick={() => handleConfirm(r.id)}>
                    확인 완료
                  </button>
                </>
              )}
              {(r.payment_status === 'confirmed' || r.payment_status === 'requested') && (
                <button style={btnPrimary} onClick={() => {
                  setPaidDate(new Date().toISOString().slice(0, 10));
                  setPaidMemo('');
                  setActionModal({ type: 'mark_paid', settlementId: r.id, participantName: r.participant_name, netAmount: r.net_amount ?? r.gross_amount });
                }}>
                  지급 완료 처리
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  /* ── Action Modals ─────────────────────────────────── */

  const renderActionModal = () => {
    if (!actionModal) return null;

    if (actionModal.type === 'revision_request') {
      return (
        <div style={modalOverlay} onClick={e => { if (e.target === e.currentTarget) { setActionModal(null); setRevisionMessage(''); } }}>
          <div style={{ ...modalContent, width: 440 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px' }}>수정 요청</h3>
            <p style={{ fontSize: 13, color: colors.textSecondary, margin: '0 0 12px' }}>
              {actionModal.participantName}님에게 정산 정보 수정을 요청합니다.
            </p>
            <textarea
              value={revisionMessage}
              onChange={e => setRevisionMessage(e.target.value)}
              placeholder="수정이 필요한 항목을 구체적으로 입력해주세요."
              style={{
                width: '100%', minHeight: 80, padding: 10, fontSize: 13,
                border: `1px solid ${colors.border}`, borderRadius: 6,
                fontFamily: 'var(--font)', resize: 'vertical',
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button style={btnSmall} onClick={() => { setActionModal(null); setRevisionMessage(''); }}>취소</button>
              <button style={{ ...btnPrimary, background: '#DC2626', height: 32, fontSize: 13 }} onClick={handleRevisionRequest}>
                수정 요청 전송
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (actionModal.type === 'mark_paid') {
      return (
        <div style={modalOverlay} onClick={e => { if (e.target === e.currentTarget) { setActionModal(null); setPaidMemo(''); } }}>
          <div style={{ ...modalContent, width: 440 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px' }}>지급 완료 처리</h3>
            <p style={{ fontSize: 13, color: colors.textSecondary, margin: '0 0 12px' }}>
              {actionModal.participantName} — {formatKRW(actionModal.netAmount)}
            </p>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, color: colors.textInfo, display: 'block', marginBottom: 4 }}>실지급일</label>
              <input
                type="date"
                value={paidDate}
                onChange={e => setPaidDate(e.target.value)}
                style={{
                  padding: '6px 10px', fontSize: 13, border: `1px solid ${colors.border}`,
                  borderRadius: 6, fontFamily: 'var(--font)',
                }}
              />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, color: colors.textInfo, display: 'block', marginBottom: 4 }}>메모 (선택)</label>
              <textarea
                value={paidMemo}
                onChange={e => setPaidMemo(e.target.value)}
                placeholder="지급 관련 메모"
                style={{
                  width: '100%', minHeight: 60, padding: 10, fontSize: 13,
                  border: `1px solid ${colors.border}`, borderRadius: 6,
                  fontFamily: 'var(--font)', resize: 'vertical',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button style={btnSmall} onClick={() => { setActionModal(null); setPaidMemo(''); }}>취소</button>
              <button style={btnPrimary} onClick={handleMarkPaid}>지급 완료</button>
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  /* ── Tab 1: 확인 필요 ──────────────────────────────── */

  const renderNeedsReview = () => {
    const rows = needsReviewRows;
    const ids = rows.map(r => r.id);
    const allSel = ids.length > 0 && ids.every(id => selected.has(id));

    return (
      <>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, justifyContent: 'flex-end' }}>
          <button style={btnSmall} onClick={handleSlackCopySelected}>Slack 복사</button>
          <button style={btnPrimary} onClick={handleBatchConfirm} disabled={selected.size === 0}>
            선택 확인완료 ({selected.size})
          </button>
        </div>
        {rows.length === 0 ? (
          <div style={{ ...cardBg, textAlign: 'center', padding: '48px 24px' }}>
            <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 4 }}>확인 대기 건이 없습니다</p>
            <p style={{ fontSize: 12, color: colors.textMuted }}>인플루언서가 정산 정보를 제출하면 여기에 표시됩니다</p>
          </div>
        ) : (
          <div style={{ ...cardBg, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: COL.check }} />
                <col style={{ width: COL.name }} />
                <col />
                <col style={{ width: COL.tax }} />
                <col style={{ width: COL.fee }} />
                <col style={{ width: COL.net }} />
                <col style={{ width: COL.evidence }} />
                <col style={{ width: COL.payDate }} />
                <col style={{ width: COL.action }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: COL.check }}>
                    <input type="checkbox" checked={allSel} onChange={() => toggleSelectAll(ids)} />
                  </th>
                  <th style={{ ...thStyle, width: COL.name }}>인플루언서</th>
                  <th style={thStyle}>캠페인</th>
                  <th style={{ ...thStyle, width: COL.tax }}>세금방식</th>
                  <th style={{ ...thRight, width: COL.fee }}>고료</th>
                  <th style={{ ...thRight, width: COL.net }}>실지급액</th>
                  <th style={{ ...thCenter, width: COL.evidence }}>증빙</th>
                  <th style={{ ...thRight, width: COL.payDate }}>제출일</th>
                  <th style={{ ...thRight, width: COL.action }}>처리</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetailRow(r)}>
                    <td style={tdStyle} onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
                    </td>
                    <td style={tdStyle}><NameCell name={r.participant_name} handle={r.participant_handle} channel={r.channel} /></td>
                    <td style={{ ...tdStyle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.campaign_name}</td>
                    <td style={tdStyle}>{taxLabel(r.tax_type)}</td>
                    <td style={tdRight}>{formatKRW(r.gross_amount)}</td>
                    <td style={{ ...tdRight, fontWeight: 500 }}>{formatKRW(r.net_amount ?? r.gross_amount)}</td>
                    <td style={tdCenter}><EvidenceCell r={r} /></td>
                    <td style={tdRight}>{fmtDate(r.submitted_at)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button style={{ ...btnPrimary, height: 28, fontSize: 12, padding: '0 10px' }} onClick={() => handleConfirm(r.id)}>확인</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  };

  /* ── Tab 2: 지급 대기 ──────────────────────────────── */

  const renderPendingPayment = () => {
    const rows = pendingPaymentRows;
    const ids = rows.map(r => r.id);
    const allSel = ids.length > 0 && ids.every(id => selected.has(id));

    return (
      <>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, justifyContent: 'flex-end' }}>
          <button style={btnSmall} onClick={handleSlackCopySelected}>Slack 복사</button>
          <button style={btnPrimary} onClick={handleBatchMarkPaid} disabled={selected.size === 0}>
            선택 지급완료 ({selected.size})
          </button>
        </div>
        {rows.length === 0 ? (
          <div style={{ ...cardBg, textAlign: 'center', padding: '48px 24px' }}>
            <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 4 }}>지급 대기 건이 없습니다</p>
            <p style={{ fontSize: 12, color: colors.textMuted }}>확인 완료 후 지급 대기 건이 여기에 표시됩니다</p>
          </div>
        ) : (
          <div style={{ ...cardBg, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: COL.check }} />
                <col style={{ width: COL.name }} />
                <col />
                <col style={{ width: COL.tax }} />
                <col style={{ width: COL.fee }} />
                <col style={{ width: COL.net }} />
                <col style={{ width: COL.payDate }} />
                <col style={{ width: COL.evidence }} />
                <col style={{ width: COL.action }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: COL.check }}>
                    <input type="checkbox" checked={allSel} onChange={() => toggleSelectAll(ids)} />
                  </th>
                  <th style={{ ...thStyle, width: COL.name }}>인플루언서</th>
                  <th style={thStyle}>캠페인</th>
                  <th style={{ ...thStyle, width: COL.tax }}>세금방식</th>
                  <th style={{ ...thRight, width: COL.fee }}>고료</th>
                  <th style={{ ...thRight, width: COL.net }}>실지급액</th>
                  <th style={{ ...thRight, width: COL.payDate }}>지급예정일</th>
                  <th style={{ ...thCenter, width: COL.evidence }}>증빙</th>
                  <th style={{ ...thRight, width: COL.action }}>처리</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const missingDoc = r.tax_type === 'business_income' && !r.has_identity_doc;
                  return (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetailRow(r)}>
                      <td style={tdStyle} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
                      </td>
                      <td style={tdStyle}><NameCell name={r.participant_name} handle={r.participant_handle} channel={r.channel} /></td>
                      <td style={{ ...tdStyle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.campaign_name}</td>
                      <td style={tdStyle}>{taxLabel(r.tax_type)}</td>
                      <td style={tdRight}>{formatKRW(r.gross_amount)}</td>
                      <td style={{ ...tdRight, fontWeight: 500 }}>{formatKRW(r.net_amount ?? r.gross_amount)}</td>
                      <td style={tdRight}><PayDateCell date={r.planned_payment_date} /></td>
                      <td style={tdCenter}><EvidenceCell r={r} /></td>
                      <td style={{ ...tdStyle, textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                        <button
                          style={{ ...btnPrimary, height: 28, fontSize: 12, padding: '0 10px', ...(missingDoc ? { opacity: 0.4, cursor: 'not-allowed' } : {}) }}
                          disabled={missingDoc}
                          title={missingDoc ? '신분증 미제출 — 지급 불가' : undefined}
                          onClick={() => {
                            setPaidDate(new Date().toISOString().slice(0, 10));
                            setPaidMemo('');
                            setActionModal({ type: 'mark_paid', settlementId: r.id, participantName: r.participant_name, netAmount: r.net_amount ?? r.gross_amount });
                          }}
                        >지급완료</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  };

  /* ── Tab 3: 지급 완료 ──────────────────────────────── */

  const renderCompleted = () => {
    const rows = completedRows;
    return (
      <>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, justifyContent: 'flex-end' }}>
          <button style={btnSmall} onClick={() => handleSlackCopy(rows)}>Slack 복사</button>
        </div>
        {rows.length === 0 ? (
          <div style={{ ...cardBg, textAlign: 'center', padding: '48px 24px' }}>
            <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 4 }}>완료된 정산이 없습니다</p>
            <p style={{ fontSize: 12, color: colors.textMuted }}>지급 완료 처리된 정산이 여기에 표시됩니다</p>
          </div>
        ) : (
          <div style={{ ...cardBg, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: COL.name }} />
                <col />
                <col style={{ width: COL.tax }} />
                <col style={{ width: COL.fee }} />
                <col style={{ width: COL.net }} />
                <col style={{ width: COL.evidence }} />
                <col style={{ width: COL.payDate }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: COL.name }}>인플루언서</th>
                  <th style={thStyle}>캠페인</th>
                  <th style={{ ...thStyle, width: COL.tax }}>세금방식</th>
                  <th style={{ ...thRight, width: COL.fee }}>고료</th>
                  <th style={{ ...thRight, width: COL.net }}>실지급액</th>
                  <th style={{ ...thCenter, width: COL.evidence }}>증빙</th>
                  <th style={{ ...thRight, width: COL.payDate }}>지급일</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetailRow(r)}>
                    <td style={tdStyle}><NameCell name={r.participant_name} handle={r.participant_handle} channel={r.channel} /></td>
                    <td style={{ ...tdStyle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.campaign_name}</td>
                    <td style={tdStyle}>{taxLabel(r.tax_type)}</td>
                    <td style={tdRight}>{formatKRW(r.gross_amount)}</td>
                    <td style={{ ...tdRight, fontWeight: 500 }}>{formatKRW(r.net_amount ?? r.gross_amount)}</td>
                    <td style={tdCenter}><EvidenceCell r={r} /></td>
                    <td style={tdRight}>{fmtDate(r.actual_paid_date || r.paid_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  };

  /* ── Tab 4: 전체 ───────────────────────────────────── */

  const renderAll = () => {
    const rows = settlements;
    return (
      <>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, justifyContent: 'flex-end' }}>
          <button style={btnSmall} onClick={() => handleSlackCopy(rows)}>Slack 복사</button>
          <button style={btnSmall} onClick={handleSlackCopyMonthly}>월간 집계 복사</button>
        </div>
        {rows.length === 0 ? (
          <div style={{ ...cardBg, textAlign: 'center', padding: '48px 24px' }}>
            <p style={{ fontSize: 14, color: colors.textSecondary }}>정산 데이터가 없습니다</p>
          </div>
        ) : (
          <div style={{ ...cardBg, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: COL.name }} />
                <col />
                <col style={{ width: COL.tax }} />
                <col style={{ width: COL.tax }} />
                <col style={{ width: COL.fee }} />
                <col style={{ width: COL.net }} />
                <col style={{ width: COL.payDate }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: COL.name }}>인플루언서</th>
                  <th style={thStyle}>캠페인</th>
                  <th style={{ ...thCenter, width: COL.tax }}>상태</th>
                  <th style={{ ...thStyle, width: COL.tax }}>세금방식</th>
                  <th style={{ ...thRight, width: COL.fee }}>고료</th>
                  <th style={{ ...thRight, width: COL.net }}>실지급액</th>
                  <th style={{ ...thRight, width: COL.payDate }}>날짜</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetailRow(r)}>
                    <td style={tdStyle}><NameCell name={r.participant_name} handle={r.participant_handle} channel={r.channel} /></td>
                    <td style={{ ...tdStyle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.campaign_name}</td>
                    <td style={tdCenter}><StatusBadge status={r.payment_status} /></td>
                    <td style={tdStyle}>{taxLabel(r.tax_type)}</td>
                    <td style={tdRight}>{formatKRW(r.gross_amount)}</td>
                    <td style={{ ...tdRight, fontWeight: 500 }}>{formatKRW(r.net_amount ?? r.gross_amount)}</td>
                    <td style={tdRight}>
                      {r.payment_status === 'paid' ? fmtDate(r.actual_paid_date || r.paid_date) : fmtDate(r.submitted_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  };

  /* ── Render ──────────────────────────────────────── */

  return (
    <AppShell showFilter={false}>
      <div>
        {errorMsg && (
          <div style={{ background: '#FEE2E2', color: '#DC2626', padding: '8px 16px', borderRadius: radii.button, marginBottom: 12, fontSize: 13 }}>{errorMsg}</div>
        )}

        {toast && <Toast message={toast} />}

        <h1 style={{ ...typo.pageTitle, color: colors.textPrimary, margin: 0, marginBottom: spacing.gap }}>정산 관리</h1>

        {/* KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
          <div style={{ ...cardBg, minHeight: 100 }}>
            <div style={{ fontSize: 12, fontWeight: 450, color: colors.textInfo, marginBottom: 6 }}>제출 확인</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: needsReviewRows.length > 0 ? '#D97706' : colors.textPrimary, lineHeight: 1.2 }}>
              {needsReviewRows.length}<span style={{ fontSize: 13, fontWeight: 400, color: colors.textInfo, marginLeft: 2 }}>건</span>
            </div>
            <div style={{ fontSize: 13, color: colors.textInfo, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
              {formatKRW(sumSettlements(needsReviewRows.map(toSumInput), 'net'))}
            </div>
          </div>
          <div style={{ ...cardBg, minHeight: 100 }}>
            <div style={{ fontSize: 12, fontWeight: 450, color: colors.textInfo, marginBottom: 6 }}>지급 대기</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: colors.textPrimary, lineHeight: 1.2 }}>
              {pendingPaymentRows.length}<span style={{ fontSize: 13, fontWeight: 400, color: colors.textInfo, marginLeft: 2 }}>건</span>
            </div>
            <div style={{ fontSize: 13, color: colors.textInfo, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
              {formatKRW(totalPendingPayment)}
            </div>
            {(() => {
              const nextDate = pendingPaymentRows.map(r => r.planned_payment_date).filter(Boolean).sort()[0];
              if (!nextDate) return null;
              return (
                <div style={{ fontSize: 11.5, color: colors.textMuted, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                  지급 예정 {nextDate.slice(5, 7)}/{nextDate.slice(8, 10)}
                </div>
              );
            })()}
          </div>
          <div style={{ ...cardBg, minHeight: 100 }}>
            <div style={{ fontSize: 12, fontWeight: 450, color: colors.textInfo, marginBottom: 6 }}>지급 완료</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: colors.textPrimary, lineHeight: 1.2 }}>
              {completedRows.length}<span style={{ fontSize: 13, fontWeight: 400, color: colors.textInfo, marginLeft: 2 }}>건</span>
            </div>
            <div style={{ fontSize: 13, color: colors.textInfo, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
              {formatKRW(totalCompleted)}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ borderBottom: `1px solid ${colors.border}`, marginBottom: 16, display: 'flex', gap: 4 }}>
          {([
            ['needs_review', '제출 확인'],
            ['pending_payment', '지급 대기'],
            ['completed', '지급 완료'],
            ['all', '전체'],
          ] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              style={tabBtnStyle(tab === key)}
              onClick={() => { setTab(key); setSelected(new Set()); }}
            >
              {label} ({tabCounts[key]})
            </button>
          ))}
        </div>

        {loading ? (
          <p style={{ color: colors.textMuted }}>로딩 중...</p>
        ) : (
          <>
            {tab === 'needs_review' && renderNeedsReview()}
            {tab === 'pending_payment' && renderPendingPayment()}
            {tab === 'completed' && renderCompleted()}
            {tab === 'all' && renderAll()}
          </>
        )}

        {renderDetailPanel()}
        {renderActionModal()}
      </div>
    </AppShell>
  );
}
