'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { CHANNEL_LABELS, COLLAB_TYPE_LABELS, type Channel, type CollabType } from '@/lib/types/influencer';
import { colors, typo, spacing, radii } from '@/lib/influencer/styles';
import { Btn, Card, Drawer, Empty } from '@/lib/influencer/ui';

/* ── Default consent texts (same as ConsentClient) ─────── */

const DEFAULT_PRIVACY_PAID = {
  title: '개인정보 수집 및 이용 동의',
  body: '제공받는 자 — (주)마야크루 (브랜드: 희다) | 이용 목적 — 콘텐츠 성과 확인, 광고 금액 지급 | 제공 항목 — 이름, 연락처 (지급 대상인 경우 추후 별도 절차로 정산 정보를 수집합니다) | 보유 및 이용기간 — 지급 완료일로부터 6개월까지. 협업 중단 또는 지급이 불필요한 경우 입력일로부터 6개월까지.',
};

const DEFAULT_PRIVACY_UNPAID = {
  title: '개인정보 수집 및 이용 동의',
  body: '제공받는 자 — (주)마야크루 (브랜드: 희다) | 이용 목적 — 제품 발송, 콘텐츠 성과 확인 | 제공 항목 — 이름, 연락처 | 보유 및 이용기간 — 협업 종료일로부터 6개월까지.',
};

const DEFAULT_AD_PAID = {
  title: '광고 표시 동의',
  body: '본 콘텐츠는 희다로부터 제품과 원고료를 제공받아 제작되며, 공정거래위원회 추천·보증 등에 관한 표시·광고 심사지침에 따라 콘텐츠 내에 유료 광고 표시를 포함합니다.',
};

const DEFAULT_AD_UNPAID = {
  title: '광고 표시 동의',
  body: '본 콘텐츠는 희다로부터 제품을 무상으로 제공받아 제작되며, 공정거래위원회 추천·보증 등에 관한 표시·광고 심사지침에 따라 콘텐츠 내에 유료 광고 표시를 포함합니다.',
};

const DEFAULT_CONDITIONS: { text: string; paid_only: boolean }[] = [
  { text: '업로드한 콘텐츠는 6개월 이상 유지해주세요.', paid_only: false },
  { text: '촬영 전 기획안, 업로드 전 콘텐츠·썸네일·캡션을 희다에 컨펌 후 업로드해주세요.', paid_only: false },
  { text: '협의된 전달 일정이 지켜지지 않는 경우 진행이 취소될 수 있습니다.', paid_only: false },
  { text: '원고료는 콘텐츠 업로드 확인 후 가까운 15일에 입금됩니다.', paid_only: true },
  { text: '진행 확정 후 일방적인 취소 시 원고료의 15%에 해당하는 위약금이 발생할 수 있습니다.', paid_only: true },
];

/* ── Types ───────────────────────────────────────────── */

interface ConsentSnapshot {
  privacy?: { title: string; body: string };
  advertising?: { title: string; body: string };
  conditions?: { text: string; paid_only: boolean }[];
  secondary_use?: { title: string; body: string };
}

interface ConsentRow {
  id: string;
  campaign_id: string;
  name: string;
  display_name: string | null;
  channel: Channel | null;
  handle: string | null;
  fee: number;
  post_type: string | null;
  post_count: number;
  product: string | null;
  secondary_use: boolean;
  secondary_use_period: string | null;
  consent_status: string;
  consent_agreed_at: string | null;
  consent_ip: string | null;
  consent_snapshot: ConsentSnapshot | null;
  phone: string | null;
  planned_draft_date: string | null;
  planned_edit_date: string | null;
  planned_upload_date: string | null;
  campaign_name: string;
  collab_type: string;
}

type DateFilter = 'month' | '3month' | 'all';

/* ── Helpers ─────────────────────────────────────────── */

const FORMAT_LABELS: Record<string, string> = { reels: '릴스', feed: '피드', story: '스토리', shorts: '숏츠', video: '영상' };

function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

function fmtKRW(v: number): string {
  if (!v) return '0원';
  return `${v.toLocaleString('ko-KR')}원`;
}

function getConsentItemCount(row: ConsentRow): number {
  // privacy + advertising always = 2, + conditions if paid, + secondary_use if applicable
  const isPaid = row.fee > 0;
  let count = 2; // privacy + advertising
  if (isPaid) count += 1; // conditions
  if (isPaid && row.secondary_use) count += 1; // secondary use
  return count;
}

function getCollabLabel(ct: string): string {
  return COLLAB_TYPE_LABELS[ct as CollabType] ?? ct ?? '-';
}

/* ── Component ───────────────────────────────────────── */

export default function ConsentsClient() {
  const searchParams = useSearchParams();
  const openId = searchParams.get('open');

  const [rows, setRows] = useState<ConsentRow[]>([]);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [campaignFilter, setCampaignFilter] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [search, setSearch] = useState('');
  const [detailRow, setDetailRow] = useState<ConsentRow | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);

  // Fetch data
  useEffect(() => {
    Promise.all([
      fetch('/api/influencer/consents').then((r) => r.json()),
      fetch('/api/influencer/settings').then((r) => r.json()),
    ]).then(([consentsData, settingsData]) => {
      const list = Array.isArray(consentsData) ? consentsData : [];
      setRows(list);
      setSettings(settingsData?.error ? null : settingsData);

      // Extract unique campaigns
      const campMap = new Map<string, string>();
      for (const r of list) {
        if (r.campaign_id && r.campaign_name) {
          campMap.set(r.campaign_id, r.campaign_name);
        }
      }
      setCampaigns(Array.from(campMap, ([id, name]) => ({ id, name })));

      // Auto-open if ?open= param
      if (openId) {
        const target = list.find((r: ConsentRow) => r.id === openId);
        if (target) setDetailRow(target);
      }
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, [openId]);

  // Filter logic
  const filtered = useMemo(() => {
    let result = rows;

    if (campaignFilter) {
      result = result.filter((r) => r.campaign_id === campaignFilter);
    }

    if (dateFilter !== 'all') {
      const now = new Date();
      const cutoff = new Date();
      if (dateFilter === 'month') {
        cutoff.setMonth(now.getMonth() - 1);
      } else {
        cutoff.setMonth(now.getMonth() - 3);
      }
      result = result.filter((r) => r.consent_agreed_at && new Date(r.consent_agreed_at) >= cutoff);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((r) =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.display_name || '').toLowerCase().includes(q) ||
        (r.handle || '').toLowerCase().includes(q)
      );
    }

    return result;
  }, [rows, campaignFilter, dateFilter, search]);

  // Resolve consent texts for detail panel
  function resolveConsentTexts(row: ConsentRow) {
    const isPaid = row.fee > 0;

    // If snapshot exists, use it
    if (row.consent_snapshot) {
      const snap = row.consent_snapshot;
      return {
        privacy: snap.privacy ?? (isPaid ? DEFAULT_PRIVACY_PAID : DEFAULT_PRIVACY_UNPAID),
        advertising: snap.advertising ?? (isPaid ? DEFAULT_AD_PAID : DEFAULT_AD_UNPAID),
        conditions: snap.conditions ?? DEFAULT_CONDITIONS.filter((c) => isPaid || !c.paid_only),
        secondary_use: snap.secondary_use,
        hasSnapshot: true,
      };
    }

    // No snapshot — fall back to current settings (legacy data)
    const s = settings ?? {};
    const privacyDb = s.consent_privacy as { title: string; body: string } | undefined;
    const adPaidDb = s.consent_advertising_paid as { title: string; body: string } | undefined;
    const adUnpaidDb = s.consent_advertising_unpaid as { title: string; body: string } | undefined;
    const adDb = s.consent_advertising as { title: string; body: string } | undefined;
    const secDb = s.consent_secondary_use as { title: string; body: string } | undefined;
    const condDb = s.consent_progress_conditions as { conditions: { text: string; paid_only: boolean }[] } | undefined;

    const privacy = privacyDb?.body ? privacyDb : (isPaid ? DEFAULT_PRIVACY_PAID : DEFAULT_PRIVACY_UNPAID);
    let advertising = isPaid ? DEFAULT_AD_PAID : DEFAULT_AD_UNPAID;
    if (isPaid && adPaidDb?.body) advertising = adPaidDb;
    else if (!isPaid && adUnpaidDb?.body) advertising = adUnpaidDb;
    else if (adDb?.body && !adDb.body.includes('업체로부터') && !adDb.body.includes('작성되었으며')) advertising = adDb;

    const conditions = (condDb?.conditions?.length ? condDb.conditions : DEFAULT_CONDITIONS)
      .filter((c) => isPaid || !c.paid_only);

    let secondary_use: { title: string; body: string } | undefined;
    if (isPaid && row.secondary_use) {
      if (secDb?.body && !secDb.body.includes('콘텐츠(사진, 영상, 텍스트 등)')) {
        secondary_use = secDb;
      } else {
        secondary_use = { title: '2차 활용 동의', body: '촬영될 영상 및 이미지를 희다 자사몰, SNS, 광고 소재 등 마케팅 목적으로 활용하는 것에 동의합니다.' };
      }
    }

    return { privacy, advertising, conditions, secondary_use, hasSnapshot: false };
  }

  // Toggle expand
  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /* ── Styles ────────────────────────────────────────── */

  const colW = { name: '24%', campaign: '22%', collab: '14%', items: '14%', date: '14%', action: '6%' };

  const segBtn = (active: boolean): React.CSSProperties => ({
    padding: '5px 12px',
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    borderRadius: radii.chip,
    border: `1px solid ${active ? colors.accent : colors.border}`,
    background: active ? colors.accentLight : 'transparent',
    color: active ? colors.accent : colors.textSecondary,
    cursor: 'pointer',
  });

  const selectStyle: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: 13,
    borderRadius: radii.button,
    border: `1px solid ${colors.border}`,
    background: colors.surface,
    color: colors.textPrimary,
    cursor: 'pointer',
  };

  const searchStyle: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: 13,
    borderRadius: radii.button,
    border: `1px solid ${colors.border}`,
    background: colors.surface,
    color: colors.textPrimary,
    width: 200,
  };

  return (
    <AppShell showFilter={false}>
      <div style={{ padding: spacing.cardPadding }}>
        <h1 style={{ ...typo.pageTitle, color: colors.textPrimary, margin: 0, marginBottom: spacing.gap }}>동의서</h1>

        {/* Filter bar */}
        <Card style={{ marginBottom: spacing.gap }}>
          <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            {/* Left: campaign dropdown */}
            <select
              value={campaignFilter}
              onChange={(e) => setCampaignFilter(e.target.value)}
              style={selectStyle}
            >
              <option value="">전체 캠페인</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            {/* Right: date segment + search */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', gap: 4 }}>
                <button style={segBtn(dateFilter === 'month')} onClick={() => setDateFilter('month')}>이번 달</button>
                <button style={segBtn(dateFilter === '3month')} onClick={() => setDateFilter('3month')}>3개월</button>
                <button style={segBtn(dateFilter === 'all')} onClick={() => setDateFilter('all')}>전체</button>
              </div>
              <input
                style={searchStyle}
                placeholder="채널명·이름으로 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </Card>

        {/* Table or empty state */}
        {loading ? (
          <Card style={{ padding: '40px 20px', textAlign: 'center', color: colors.textMuted }}>불러오는 중...</Card>
        ) : filtered.length === 0 ? (
          <Card>
            <Empty message="제출된 동의서가 없습니다" />
          </Card>
        ) : (
          <Card>
            <div className="section-body">
              <table className="data-table" style={{ tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    <th style={{ width: colW.name }}>인플루언서</th>
                    <th style={{ width: colW.campaign }}>캠페인</th>
                    <th style={{ width: colW.collab }}>협업 방식</th>
                    <th style={{ width: colW.items }}>동의 항목</th>
                    <th style={{ width: colW.date }}>제출일</th>
                    <th style={{ width: colW.action, textAlign: 'right' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr
                      key={row.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => { setDetailRow(row); setExpanded(new Set()); }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = colors.bg; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                    >
                      <td>
                        <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.name || row.display_name || '(채널명 미입력)'}
                        </div>
                        <div style={{ fontSize: 12, color: colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {[row.handle ? `@${row.handle}` : null, row.channel ? CHANNEL_LABELS[row.channel] : null].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.campaign_name}</td>
                      <td>{getCollabLabel(row.collab_type)}</td>
                      <td>{getConsentItemCount(row)}개 항목</td>
                      <td style={{ fontSize: 13 }}>{fmtDate(row.consent_agreed_at)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <Btn
                          size="sm"
                          onClick={(e: React.MouseEvent) => { e.stopPropagation(); setDetailRow(row); setExpanded(new Set()); }}
                        >
                          보기
                        </Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {/* Detail panel */}
      <Drawer
        open={!!detailRow}
        onClose={() => setDetailRow(null)}
        title={detailRow?.display_name || detailRow?.name || '(이름 미입력)'}
        sub={detailRow ? [detailRow.handle ? `@${detailRow.handle}` : null, detailRow.channel ? CHANNEL_LABELS[detailRow.channel] : null, detailRow.campaign_name].filter(Boolean).join(' · ') : undefined}
      >
        {detailRow && (
          <DetailPanelBody
            row={detailRow}
            resolveTexts={resolveConsentTexts}
            expanded={expanded}
            toggleExpand={toggleExpand}
          />
        )}
      </Drawer>
    </AppShell>
  );
}

/* ── Detail Panel ────────────────────────────────────── */

function DetailPanelBody({
  row,
  resolveTexts,
  expanded,
  toggleExpand,
}: {
  row: ConsentRow;
  resolveTexts: (row: ConsentRow) => {
    privacy: { title: string; body: string };
    advertising: { title: string; body: string };
    conditions: { text: string; paid_only: boolean }[];
    secondary_use?: { title: string; body: string };
    hasSnapshot: boolean;
  };
  expanded: Set<string>;
  toggleExpand: (key: string) => void;
}) {
  const texts = resolveTexts(row);
  const isPaid = row.fee > 0;
  const contentDisplay = row.post_type
    ? `${FORMAT_LABELS[row.post_type] ?? row.post_type} ${row.post_count ?? 1}건`
    : null;

  const sectionTitle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: colors.textSecondary,
    marginBottom: 10,
    paddingBottom: 6,
    borderBottom: `1px solid ${colors.border}`,
  };

  const infoLabel: React.CSSProperties = { color: colors.textInfo, fontSize: 13 };
  const infoRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13 };

  // Build consent items list
  const consentItems: { key: string; title: string; body: string }[] = [
    { key: 'privacy', title: texts.privacy.title, body: texts.privacy.body },
    { key: 'advertising', title: texts.advertising.title, body: texts.advertising.body },
  ];
  if (isPaid && texts.conditions.length > 0) {
    consentItems.push({
      key: 'conditions',
      title: '진행 조건 동의',
      body: texts.conditions.map((c, i) => `${i + 1}. ${c.text}`).join('\n'),
    });
  }
  if (texts.secondary_use) {
    consentItems.push({
      key: 'secondary',
      title: texts.secondary_use.title,
      body: texts.secondary_use.body,
    });
  }

  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      {/* Collaboration terms */}
      <div style={{ marginBottom: 20 }}>
        <div style={sectionTitle}>협업 조건</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={infoRow}><span style={infoLabel}>협업 방식</span><span>{getCollabLabel(row.collab_type)}</span></div>
          <div style={infoRow}><span style={infoLabel}>제공 제품</span><span>{row.product || '-'}</span></div>
          {contentDisplay && <div style={infoRow}><span style={infoLabel}>콘텐츠 형식</span><span>{contentDisplay}</span></div>}
          <div style={infoRow}><span style={infoLabel}>고료</span><span>{fmtKRW(row.fee)}</span></div>
          <div style={infoRow}><span style={infoLabel}>2차 활용</span><span>{row.secondary_use ? `예 (${row.secondary_use_period || '-'})` : '아니오'}</span></div>
        </div>
      </div>

      {/* Submitted info */}
      <div style={{ marginBottom: 20 }}>
        <div style={sectionTitle}>제출 정보</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={infoRow}><span style={infoLabel}>성함</span><span>{row.display_name || '-'}</span></div>
          <div style={infoRow}><span style={infoLabel}>채널명</span><span>{row.name || '-'}</span></div>
          <div style={infoRow}><span style={infoLabel}>연락처</span><span>{row.phone ? row.phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3') : '-'}</span></div>
          {isPaid ? (
            <>
              <div style={infoRow}><span style={infoLabel}>기획안 전달일</span><span>{row.planned_draft_date || '-'}</span></div>
              <div style={infoRow}><span style={infoLabel}>가편집본 전달일</span><span>{row.planned_edit_date || '-'}</span></div>
              <div style={infoRow}><span style={infoLabel}>업로드일</span><span>{row.planned_upload_date || '-'}</span></div>
            </>
          ) : (
            <div style={infoRow}><span style={infoLabel}>예상 업로드일</span><span>{row.planned_upload_date || '-'}</span></div>
          )}
          <div style={infoRow}><span style={infoLabel}>제출 일시</span><span>{fmtDate(row.consent_agreed_at)}</span></div>
        </div>
      </div>

      {/* Consent items (expandable) */}
      <div style={{ marginBottom: 20 }}>
        <div style={sectionTitle}>동의 항목</div>
        {!texts.hasSnapshot && (
          <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 8, fontStyle: 'italic' }}>
            문구 스냅샷 없음 (기존 데이터)
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {consentItems.map((item) => {
            const isOpen = expanded.has(item.key);
            return (
              <div key={item.key} style={{ borderBottom: `1px solid ${colors.border}` }}>
                <div
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0',
                    cursor: 'pointer',
                  }}
                  onClick={() => toggleExpand(item.key)}
                >
                  <span style={{ color: colors.accent, fontSize: 14, flexShrink: 0 }}>&#10003;</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{item.title}</span>
                  <span style={{ fontSize: 12, color: colors.textInfo, marginRight: 4 }}>
                    {fmtDate(row.consent_agreed_at)}
                  </span>
                  <span style={{
                    fontSize: 11, color: colors.textInfo,
                    transform: isOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s',
                  }}>
                    &#9660;
                  </span>
                </div>
                {isOpen && (
                  <div style={{
                    padding: '8px 0 14px 22px',
                    fontSize: 13, color: colors.textSecondary, lineHeight: 1.7,
                    whiteSpace: 'pre-wrap', wordBreak: 'keep-all',
                  }}>
                    {item.body.includes('|')
                      ? item.body.split('|').map((seg, i) => {
                          const trimmed = seg.trim();
                          const dashIdx = trimmed.indexOf('—');
                          if (dashIdx >= 0) {
                            return (
                              <div key={i} style={{ marginBottom: 6 }}>
                                <div style={{ fontSize: 12, color: colors.textMuted, fontWeight: 500 }}>{trimmed.slice(0, dashIdx).trim()}</div>
                                <div>{trimmed.slice(dashIdx + 1).trim()}</div>
                              </div>
                            );
                          }
                          return <div key={i} style={{ marginBottom: 4 }}>{trimmed}</div>;
                        })
                      : item.body
                    }
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer: Print */}
      <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 16 }}>
        <Btn size="sm" onClick={handlePrint}>인쇄</Btn>
      </div>
    </>
  );
}
