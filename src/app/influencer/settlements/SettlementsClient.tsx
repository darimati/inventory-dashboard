'use client';

import { useState, useEffect, useRef } from 'react';
import AppShell from '@/components/AppShell';
import { formatKRW } from '@/lib/helpers';
import { CHANNEL_LABELS, TAX_TYPE_LABELS, type Channel, type TaxType, type ContentFormatEntry, formatContentFormats } from '@/lib/types/influencer';

/* ── Types ──────────────────────────────────────────── */

interface PendingDocsRow {
  id: string;
  name: string;
  handle: string | null;
  channel: string | null;
  campaign_name: string;
  fee: number;
  published_url: string | null;
  planned_upload_date: string | null;
  settlement_status: string;
  settlement_token: string | null;
  consent_status: string;
}

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
  payment_status: string;
  planned_date: string | null;
  paid_date: string | null;
  memo: string | null;
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
  submitted_at: string | null;
  invoice_status: string | null;
}

type Tab = 'pending_docs' | 'pending_payment' | 'completed';

/* ── Component ──────────────────────────────────────── */

export default function SettlementsClient() {
  const [tab, setTab] = useState<Tab>('pending_docs');
  const [pendingDocs, setPendingDocs] = useState<PendingDocsRow[]>([]);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [errorMsg, setErrorMsg] = useState('');
  const [detailRow, setDetailRow] = useState<SettlementRow | null>(null);
  const [toast, setToast] = useState('');
  const mouseDownRef = useRef<EventTarget | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [docsRes, settlementsRes] = await Promise.all([
        fetch('/api/influencer/settlements?tab=pending_docs'),
        fetch('/api/influencer/settlements'),
      ]);
      const docsData = await docsRes.json();
      const settData = await settlementsRes.json();
      setPendingDocs(Array.isArray(docsData) ? docsData : []);
      setSettlements(Array.isArray(settData) ? settData : []);
    } catch {
      setPendingDocs([]);
      setSettlements([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // Derived data
  const waitingRows = settlements.filter((r) => r.payment_status === 'waiting' || r.payment_status === 'requested');
  const completedRows = settlements.filter((r) => r.payment_status === 'paid');
  const totalWaiting = waitingRows.reduce((s, r) => s + (r.net_amount ?? r.gross_amount), 0);
  const totalCompleted = completedRows.reduce((s, r) => s + (r.net_amount ?? r.gross_amount), 0);

  const tabCounts = {
    pending_docs: pendingDocs.length,
    pending_payment: waitingRows.length,
    completed: completedRows.length,
  };

  const handleReveal = async (participantId: string, field: string) => {
    const key = `${participantId}_${field}`;
    if (revealed[key]) {
      setRevealed((prev) => { const next = { ...prev }; delete next[key]; return next; });
      return;
    }
    const res = await fetch('/api/influencer/settlements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'decrypt', participant_id: participantId, field }),
    });
    const data = await res.json();
    if (data.value) {
      setRevealed((prev) => ({ ...prev, [key]: data.value }));
    }
  };

  const handleStatusChange = async (id: string, status: string) => {
    await fetch('/api/influencer/settlements', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, payment_status: status }),
    });
    fetchData();
  };

  const handleBatchComplete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`${selected.size}건을 지급 완료로 처리하시겠습니까?`)) return;
    await fetch('/api/influencer/settlements', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch: true, ids: Array.from(selected), payment_status: 'paid' }),
    });
    setSelected(new Set());
    fetchData();
  };

  const handleGenerateSettlementLink = async (participantId: string) => {
    const res = await fetch('/api/influencer/participants', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: participantId, generate_settlement_token: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErrorMsg(data.error || '링크 생성 실패');
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }
    fetchData();
  };

  const handleBatchGenerateLinks = async () => {
    if (selected.size === 0) return;
    const eligible = pendingDocs.filter((p) => selected.has(p.id) && p.settlement_status === 'none' && p.published_url);
    if (eligible.length === 0) {
      setErrorMsg('링크를 생성할 수 있는 건이 없습니다. (게시 URL 등록 필요)');
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }
    for (const p of eligible) {
      await handleGenerateSettlementLink(p.id);
    }
    setSelected(new Set());
  };

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/influencer/settlement/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setToast('링크가 복사되었습니다');
      setTimeout(() => setToast(''), 2000);
    });
  };

  const handleExportExcel = async () => {
    const ids = selected.size > 0 ? Array.from(selected) : waitingRows.map((r) => r.id);
    if (ids.length === 0) return;
    if (!confirm(`${ids.length}건의 정산 정보를 엑셀로 다운로드합니다. 계좌번호가 포함되며 접근 기록이 남습니다.`)) return;

    const res = await fetch('/api/influencer/settlements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'export_excel', ids }),
    });
    const data = await res.json();
    if (!Array.isArray(data)) return;

    const headers = ['이름', '캠페인', '은행', '예금주', '계좌번호', '총액', '세금', '실지급액'];
    const csvRows = [headers.join(',')];
    for (const row of data) {
      csvRows.push([
        row.name, row.campaign, row.bank_name, row.bank_holder, row.bank_account,
        row.gross_amount, row.tax_amount ?? 0, row.net_amount ?? row.gross_amount,
      ].join(','));
    }
    const csv = '\uFEFF' + csvRows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `정산_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (ids: string[]) => {
    const allSelected = ids.every((id) => selected.has(id));
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  /* ── Helpers ──────────────────────────────────────── */

  const fmtDate = (d: string | null) => {
    if (!d) return '-';
    return d.slice(0, 10);
  };

  const taxLabel = (t: string | null) => t ? (TAX_TYPE_LABELS[t as TaxType] ?? t) : '-';

  const channelLabel = (c: string | null) => c ? (CHANNEL_LABELS[c as Channel] ?? c) : '';

  const displayRealName = (r: SettlementRow) => {
    if (r.tax_type === 'business_income') return r.real_name || '-';
    return r.business_name || '-';
  };

  /* ── Styles ──────────────────────────────────────── */

  const cardBg: React.CSSProperties = {
    background: 'var(--surface)',
    border: 'var(--card-border)',
    borderRadius: 'var(--card-radius)',
    padding: '16px 20px',
  };

  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: '8px 16px',
    border: 'none',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
    background: 'none',
    fontSize: 14,
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    cursor: 'pointer',
    fontFamily: 'var(--font)',
  });

  const btnSmall: React.CSSProperties = {
    padding: '4px 12px',
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 6,
    fontSize: 12,
    cursor: 'pointer',
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
    fontFamily: 'var(--font)',
  };

  const btnPrimary: React.CSSProperties = {
    height: 36,
    padding: '0 16px',
    background: '#1A1D21',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 13.5,
    fontWeight: 550,
    cursor: 'pointer',
    fontFamily: 'var(--font)',
  };

  const thStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 450,
    color: 'var(--text-info)',
    padding: '8px 10px',
    textAlign: 'left',
    borderBottom: '1px solid var(--border)',
  };

  const tdStyle: React.CSSProperties = {
    fontSize: 13,
    color: 'var(--text-primary)',
    padding: '10px 10px',
    borderBottom: '1px solid var(--border)',
  };

  const modalOverlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
  };

  const modalContent: React.CSSProperties = {
    background: 'var(--surface)', borderRadius: 12, padding: '24px',
    width: 520, maxHeight: '85vh', overflowY: 'auto',
  };

  const detailRowStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    padding: '6px 0', fontSize: 13, borderBottom: '1px solid var(--track)',
  };

  const detailLabel: React.CSSProperties = { color: 'var(--text-info)', flexShrink: 0 };
  const detailValue: React.CSSProperties = { color: 'var(--text-primary)', fontWeight: 500, textAlign: 'right' };

  /* ── 2-line name cell ──────────────────────────────── */

  const NameCell = ({ name, handle, channel }: { name: string; handle?: string | null; channel?: string | null }) => (
    <div>
      <div style={{ fontWeight: 500, color: name ? 'var(--text-primary)' : '#9AA2AA', lineHeight: 1.3 }}>
        {name || '(채널명 미입력)'}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 1 }}>
        {[handle ? `@${handle}` : null, channel ? channelLabel(channel) : null].filter(Boolean).join(' · ') || ''}
      </div>
    </div>
  );

  /* ── Detail Panel (shared by pending + completed tabs) ── */

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

  const isInvoiceType = (t: string | null) => t === 'tax_invoice' || t === 'tax_exempt_invoice';

  const handleInvoiceStatusChange = async (id: string, status: string) => {
    await fetch('/api/influencer/settlements', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, invoice_status: status }),
    });
    fetchData();
    setDetailRow((prev) => prev ? { ...prev, invoice_status: status } : null);
  };

  const handleDownloadFile = async (participantId: string) => {
    const res = await fetch(`/api/influencer/settlements?action=file_url&participant_id=${participantId}`);
    const data = await res.json();
    if (data.url) window.open(data.url, '_blank');
    else { setToast('파일이 없습니다'); setTimeout(() => setToast(''), 2000); }
  };

  const renderDetailPanel = () => {
    if (!detailRow) return null;
    const r = detailRow;
    const acctKey = `${r.participant_id}_bank_account`;
    const taxWithholding = r.tax_type === 'business_income' && r.tax_amount
      ? `-${formatKRW(r.tax_amount)} (${r.tax_rate}%)`
      : null;
    const taxVat = r.tax_type === 'tax_invoice' && r.tax_amount
      ? `+${formatKRW(r.tax_amount)} (부가세 ${r.tax_rate}%)`
      : null;
    const taxExempt = r.tax_type === 'tax_exempt_invoice';

    return (
      <div style={modalOverlay} onMouseDown={(e) => { mouseDownRef.current = e.target; }} onClick={(e) => { if (e.target === e.currentTarget && mouseDownRef.current === e.currentTarget) setDetailRow(null); }}>
        <div style={modalContent}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>정산 상세</h2>
            <button style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-muted)', padding: '4px 8px' }} onClick={() => setDetailRow(null)}>&#10005;</button>
          </div>

          <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 12 }}>
            <div style={detailRowStyle}>
              <span style={detailLabel}>인플루언서</span>
              <span style={detailValue}>{r.participant_name}</span>
            </div>
            <div style={detailRowStyle}>
              <span style={detailLabel}>실명</span>
              <span style={detailValue}>{displayRealName(r)}</span>
            </div>
            <div style={detailRowStyle}>
              <span style={detailLabel}>캠페인</span>
              <span style={detailValue}>{r.campaign_name}</span>
            </div>
          </div>

          <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 12 }}>
            <div style={detailRowStyle}>
              <span style={detailLabel}>세금 방식</span>
              <span style={detailValue}>{taxLabel(r.tax_type)}</span>
            </div>
            <div style={detailRowStyle}>
              <span style={detailLabel}>고료(세전)</span>
              <span style={{ ...detailValue, fontVariantNumeric: 'tabular-nums' }}>{formatKRW(r.gross_amount)}</span>
            </div>
            {taxWithholding && (
              <div style={detailRowStyle}>
                <span style={detailLabel}>원천징수</span>
                <span style={{ ...detailValue, fontVariantNumeric: 'tabular-nums' }}>{taxWithholding}</span>
              </div>
            )}
            {taxVat && (
              <div style={detailRowStyle}>
                <span style={detailLabel}>부가세</span>
                <span style={{ ...detailValue, fontVariantNumeric: 'tabular-nums' }}>{taxVat}</span>
              </div>
            )}
            {taxExempt && (
              <div style={detailRowStyle}>
                <span style={detailLabel}>부가세</span>
                <span style={detailValue}>면세 (0%)</span>
              </div>
            )}
            <div style={detailRowStyle}>
              <span style={detailLabel}>{(r.tax_type === 'tax_invoice') ? '세금계산서 발행액' : taxExempt ? '계산서 발행액' : '실지급액'}</span>
              <span style={{ ...detailValue, fontVariantNumeric: 'tabular-nums', fontSize: 14 }}>{formatKRW(r.net_amount ?? r.gross_amount)}</span>
            </div>
          </div>

          <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 12 }}>
            <div style={detailRowStyle}>
              <span style={detailLabel}>은행</span>
              <span style={detailValue}>{r.bank_name || '-'}</span>
            </div>
            <div style={detailRowStyle}>
              <span style={detailLabel}>계좌번호</span>
              <span style={{ ...detailValue, display: 'flex', alignItems: 'center', gap: 6 }}>
                {r.has_bank_account ? (
                  <>
                    <span>{revealed[acctKey] ?? r.bank_account_masked}</span>
                    <button
                      style={{ ...btnSmall, fontSize: 11, padding: '2px 8px' }}
                      onClick={() => handleReveal(r.participant_id, 'bank_account')}
                    >{revealed[acctKey] ? '숨기기' : '원문 보기'}</button>
                  </>
                ) : '-'}
              </span>
            </div>
            <div style={detailRowStyle}>
              <span style={detailLabel}>예금주</span>
              <span style={detailValue}>{r.bank_holder || '-'}</span>
            </div>
          </div>

          <div>
            {r.content_formats && r.content_formats.length > 0 && (
              <div style={detailRowStyle}>
                <span style={detailLabel}>콘텐츠</span>
                <span style={{ ...detailValue, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {formatContentFormats(r.content_formats as ContentFormatEntry[])}
                  {r.published_url && (
                    <a href={r.published_url} target="_blank" rel="noopener noreferrer" style={{ color: '#4A90D9', fontSize: 12 }}>[보기]</a>
                  )}
                </span>
              </div>
            )}
            <div style={detailRowStyle}>
              <span style={detailLabel}>제출일</span>
              <span style={{ ...detailValue, fontVariantNumeric: 'tabular-nums' }}>{fmtDate(r.submitted_at)}</span>
            </div>
            {r.paid_date && (
              <div style={detailRowStyle}>
                <span style={detailLabel}>지급일</span>
                <span style={{ ...detailValue, fontVariantNumeric: 'tabular-nums' }}>{fmtDate(r.paid_date)}</span>
              </div>
            )}
          </div>

          {/* Invoice status — P2-2 */}
          {isInvoiceType(r.tax_type) && (
            <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 12 }}>
              <div style={detailRowStyle}>
                <span style={detailLabel}>{r.tax_type === 'tax_invoice' ? '세금계산서' : '계산서'} 상태</span>
                <span style={{ ...detailValue, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                    fontSize: 11.5, fontWeight: 500,
                    color: invoiceStatusColor(r.invoice_status),
                    background: r.invoice_status === 'verified' ? '#F0FDF4' : r.invoice_status === 'received' ? '#F0F4FA' : '#FFFBEB',
                  }}>
                    {r.invoice_status ? INVOICE_STATUS_LABELS[r.invoice_status] ?? r.invoice_status : '발행 대기'}
                  </span>
                  <select
                    style={{ ...btnSmall, padding: '2px 8px', fontSize: 11 }}
                    value={r.invoice_status ?? 'pending'}
                    onChange={(e) => handleInvoiceStatusChange(r.id, e.target.value)}
                  >
                    <option value="pending">발행 대기</option>
                    <option value="received">수취 완료</option>
                    <option value="verified">검증 완료</option>
                  </select>
                </span>
              </div>
            </div>
          )}

          {/* Attachments — P0-3 */}
          {r.has_biz_reg_file && (
            <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 12 }}>
              <div style={detailRowStyle}>
                <span style={detailLabel}>사업자등록증</span>
                <button style={btnSmall} onClick={() => handleDownloadFile(r.participant_id)}>다운로드</button>
              </div>
            </div>
          )}

          {/* Action buttons for pending payment */}
          {(r.payment_status === 'waiting' || r.payment_status === 'requested') && (
            <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btnPrimary} onClick={() => { handleStatusChange(r.id, 'paid'); setDetailRow(null); }}>완료 처리</button>
            </div>
          )}
        </div>
      </div>
    );
  };

  /* ── Tab 1: 정산 정보 대기 ──────────────────────── */

  const renderPendingDocs = () => {
    const ids = pendingDocs.map((p) => p.id);
    const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));

    return (
      <>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, justifyContent: 'flex-end' }}>
          <button style={btnSmall} onClick={handleBatchGenerateLinks} disabled={selected.size === 0}>
            선택 링크 일괄생성
          </button>
        </div>
        {pendingDocs.length === 0 ? (
          <div style={{ ...cardBg, textAlign: 'center', padding: '48px 24px' }}>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 4 }}>정산 정보 대기 건이 없습니다</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>업로드 완료 후 정산 링크를 생성하면 여기에 표시됩니다</p>
          </div>
        ) : (
          <div style={cardBg}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 36 }}>
                    <input type="checkbox" checked={allSelected} onChange={() => toggleSelectAll(ids)} />
                  </th>
                  <th style={thStyle}>인플루언서</th>
                  <th style={thStyle}>캠페인</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>고료(세전)</th>
                  <th style={thStyle}>업로드일</th>
                  <th style={thStyle}>콘텐츠</th>
                  <th style={thStyle}>정산링크</th>
                </tr>
              </thead>
              <tbody>
                {pendingDocs.map((p) => (
                  <tr key={p.id}>
                    <td style={tdStyle}>
                      <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} />
                    </td>
                    <td style={tdStyle}>
                      <NameCell name={p.name} handle={p.handle} channel={p.channel} />
                    </td>
                    <td style={tdStyle}>{p.campaign_name}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatKRW(p.fee)}</td>
                    <td style={tdStyle}>{p.planned_upload_date || '-'}</td>
                    <td style={tdStyle}>
                      {p.published_url ? (
                        <a href={p.published_url} target="_blank" rel="noopener noreferrer" style={{ color: '#4A90D9', fontSize: 12 }}>보기</a>
                      ) : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>-</span>}
                    </td>
                    <td style={tdStyle}>
                      {p.settlement_status === 'none' ? (
                        <button
                          style={p.published_url ? btnSmall : { ...btnSmall, opacity: 0.4, cursor: 'not-allowed' }}
                          disabled={!p.published_url}
                          onClick={() => handleGenerateSettlementLink(p.id)}
                          title={!p.published_url ? 'URL 등록 후 생성 가능' : undefined}
                        >생성</button>
                      ) : p.settlement_token ? (
                        <button style={btnSmall} onClick={() => copyLink(p.settlement_token!)}>복사</button>
                      ) : <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11.5, fontWeight: 500, color: '#8E959D', background: '#F2F4F7' }}>발송</span>}
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

  /* ── Tab 2: 지급 대기 ──────────────────────────── */

  const renderPendingPayment = () => {
    const ids = waitingRows.map((r) => r.id);
    const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));

    return (
      <>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, justifyContent: 'flex-end' }}>
          <button style={btnSmall} onClick={handleExportExcel}>
            엑셀 다운로드
          </button>
          <button style={btnPrimary} onClick={handleBatchComplete} disabled={selected.size === 0}>
            선택 완료 처리 ({selected.size})
          </button>
        </div>
        {waitingRows.length === 0 ? (
          <div style={{ ...cardBg, textAlign: 'center', padding: '48px 24px' }}>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 4 }}>지급 대기 건이 없습니다</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>인플루언서가 정산 정보를 제출하면 여기에 표시됩니다</p>
          </div>
        ) : (
          <div style={cardBg}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 36 }}>
                    <input type="checkbox" checked={allSelected} onChange={() => toggleSelectAll(ids)} />
                  </th>
                  <th style={thStyle}>인플루언서</th>
                  <th style={thStyle}>캠페인</th>
                  <th style={thStyle}>세금방식</th>
                  <th style={thStyle}>실명</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>고료(세전)</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>실지급액</th>
                  <th style={thStyle}>증빙</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>제출일</th>
                  <th style={thStyle}>처리</th>
                </tr>
              </thead>
              <tbody>
                {waitingRows.map((r) => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetailRow(r)}>
                    <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
                    </td>
                    <td style={tdStyle}>
                      <NameCell name={r.participant_name} handle={r.participant_handle} channel={r.channel} />
                    </td>
                    <td style={tdStyle}>{r.campaign_name}</td>
                    <td style={tdStyle}>{taxLabel(r.tax_type)}</td>
                    <td style={tdStyle}>{displayRealName(r)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatKRW(r.gross_amount)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                      {formatKRW(r.net_amount ?? r.gross_amount)}
                    </td>
                    <td style={tdStyle}>
                      {isInvoiceType(r.tax_type) ? (
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                          fontSize: 11, fontWeight: 500,
                          color: invoiceStatusColor(r.invoice_status),
                          background: r.invoice_status === 'verified' ? '#F0FDF4' : r.invoice_status === 'received' ? '#F0F4FA' : '#FFFBEB',
                        }}>
                          {r.invoice_status ? INVOICE_STATUS_LABELS[r.invoice_status] ?? r.invoice_status : '대기'}
                        </span>
                      ) : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>-</span>}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtDate(r.submitted_at)}</td>
                    <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                      <button
                        style={btnPrimary}
                        onClick={() => handleStatusChange(r.id, 'paid')}
                      >완료 처리</button>
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

  /* ── Tab 3: 정산 완료 ──────────────────────────── */

  const renderCompleted = () => (
    completedRows.length === 0 ? (
      <div style={{ ...cardBg, textAlign: 'center', padding: '48px 24px' }}>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 4 }}>완료된 정산이 없습니다</p>
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>지급 완료 처리된 정산이 여기에 표시됩니다</p>
      </div>
    ) : (
      <div style={cardBg}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>인플루언서</th>
              <th style={thStyle}>캠페인</th>
              <th style={thStyle}>세금방식</th>
              <th style={thStyle}>실명</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>고료(세전)</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>실지급액</th>
              <th style={thStyle}>증빙</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>제출일</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>지급일</th>
            </tr>
          </thead>
          <tbody>
            {completedRows.map((r) => (
              <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetailRow(r)}>
                <td style={tdStyle}>
                  <NameCell name={r.participant_name} handle={r.participant_handle} channel={r.channel} />
                </td>
                <td style={tdStyle}>{r.campaign_name}</td>
                <td style={tdStyle}>{taxLabel(r.tax_type)}</td>
                <td style={tdStyle}>{displayRealName(r)}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatKRW(r.gross_amount)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                  {formatKRW(r.net_amount ?? r.gross_amount)}
                </td>
                <td style={tdStyle}>
                  {isInvoiceType(r.tax_type) ? (
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                      fontSize: 11, fontWeight: 500,
                      color: invoiceStatusColor(r.invoice_status),
                      background: r.invoice_status === 'verified' ? '#F0FDF4' : r.invoice_status === 'received' ? '#F0F4FA' : '#FFFBEB',
                    }}>
                      {r.invoice_status ? INVOICE_STATUS_LABELS[r.invoice_status] ?? r.invoice_status : '대기'}
                    </span>
                  ) : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>-</span>}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtDate(r.submitted_at)}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtDate(r.paid_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  );

  /* ── Render ──────────────────────────────────────── */

  return (
    <AppShell showFilter={false}>
      <div>
        {errorMsg && (
          <div style={{ background: '#FEE2E2', color: '#DC2626', padding: '8px 16px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{errorMsg}</div>
        )}

        {toast && (
          <div style={{
            position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)',
            background: '#1A1D21', color: '#fff', padding: '10px 20px', borderRadius: 10,
            fontSize: 13, fontWeight: 500, zIndex: 999, fontFamily: 'var(--font)',
          }}>{toast}</div>
        )}

        <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>정산 관리</h1>

        {/* KPI Cards — 3-column grid, label → number → sub */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
          <div style={{ ...cardBg, minHeight: 100 }}>
            <div style={{ fontSize: 12, fontWeight: 450, color: 'var(--text-info)', marginBottom: 6 }}>정산 정보 대기</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{pendingDocs.length}<span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-info)', marginLeft: 2 }}>건</span></div>
            <div style={{ fontSize: 12, color: 'var(--text-info)', marginTop: 4 }}>링크 미발송 {pendingDocs.filter(p => p.settlement_status === 'none').length} · 발송 {pendingDocs.filter(p => p.settlement_status !== 'none').length}</div>
          </div>
          <div style={{ ...cardBg, minHeight: 100 }}>
            <div style={{ fontSize: 12, fontWeight: 450, color: 'var(--text-info)', marginBottom: 6 }}>지급 대기</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{formatKRW(totalWaiting)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-info)', marginTop: 4 }}>{waitingRows.length}건</div>
          </div>
          <div style={{ ...cardBg, minHeight: 100 }}>
            <div style={{ fontSize: 12, fontWeight: 450, color: 'var(--text-info)', marginBottom: 6 }}>이번 달 지급 완료</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{formatKRW(totalCompleted)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-info)', marginTop: 4 }}>{completedRows.length}건 · {new Date().getFullYear()}년 {new Date().getMonth() + 1}월</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ borderBottom: '1px solid var(--border)', marginBottom: 16, display: 'flex', gap: 4 }}>
          {([
            ['pending_docs', '정산 정보 대기'],
            ['pending_payment', '지급 대기'],
            ['completed', '지급 완료'],
          ] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              style={tabBtn(tab === key)}
              onClick={() => { setTab(key); setSelected(new Set()); }}
            >
              {label} ({tabCounts[key]})
            </button>
          ))}
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>로딩 중...</p>
        ) : (
          <>
            {tab === 'pending_docs' && renderPendingDocs()}
            {tab === 'pending_payment' && renderPendingPayment()}
            {tab === 'completed' && renderCompleted()}
          </>
        )}

        {renderDetailPanel()}
      </div>
    </AppShell>
  );
}
