'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { CHANNEL_LABELS } from '@/lib/types/influencer';

interface ConsentData {
  status: 'valid' | 'already_submitted' | 'expired';
  collab_type: string;
  collab_label: string;
  is_paid: boolean;
  participant_name: string;
  channel_name: string;
  fee: number;
  channel: string | null;
  product_name: string | null;
  advertised_products: string[];
  content_display: string | null;
  secondary_use: boolean;
  secondary_use_period: string | null;
  consent_privacy: { title: string; body: string } | null;
  consent_advertising: { title: string; body: string } | null;
  consent_secondary_use: { title: string; body: string } | null;
  progress_conditions: { text: string; paid_only: boolean }[];
}

type PageState = 'loading' | 'valid' | 'already_submitted' | 'expired' | 'error' | 'submitted';

/* ── Hardcoded defaults (HEEDA in-house) ────────────────── */

const DEFAULT_PRIVACY = {
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

const DEFAULT_SECONDARY_USE = {
  title: '2차 활용 동의',
  body: '촬영될 영상 및 이미지를 희다 자사몰, SNS, 광고 소재 등 마케팅 목적으로 활용하는 것에 동의합니다.',
};

const DEFAULT_CONDITIONS: { text: string; paid_only: boolean }[] = [
  { text: '업로드한 콘텐츠는 6개월 이상 유지해주세요.', paid_only: false },
  { text: '촬영 전 기획안, 업로드 전 콘텐츠·썸네일·캡션을 희다에 컨펌 후 업로드해주세요.', paid_only: false },
  { text: '협의된 전달 일정이 지켜지지 않는 경우 진행이 취소될 수 있습니다.', paid_only: false },
  { text: '원고료는 콘텐츠 업로드 확인 후 가까운 15일에 입금됩니다.', paid_only: true },
  { text: '진행 확정 후 일방적인 취소 시 원고료의 15%에 해당하는 위약금이 발생할 수 있습니다.', paid_only: true },
];

/* ── Accordion Component ──────────────────────────────────── */

function AccordionItem({ title, required, checked, onChange, children, refEl, errorMsg, nested }: {
  title: string;
  required: boolean;
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  refEl?: React.RefObject<HTMLDivElement | null>;
  errorMsg?: string | null;
  nested?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const outerStyle: React.CSSProperties = nested
    ? { borderBottom: '1px solid #e5e5e5', overflow: 'hidden' }
    : { border: '1px solid #e5e5e5', borderRadius: 10, overflow: 'hidden', marginBottom: 10 };
  const headerBg = nested ? '#fff' : '#fafafa';
  const headerPad = nested ? '12px 16px' : '14px 16px';

  return (
    <div ref={refEl} style={outerStyle}>
      <div
        onClick={() => setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: headerPad, cursor: 'pointer', background: headerBg }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => { e.stopPropagation(); onChange(e.target.checked); }}
          style={{ width: 20, height: 20, flexShrink: 0, cursor: 'pointer' }}
        />
        <div style={{ flex: 1, fontSize: 14, fontWeight: 500, color: '#1A1D21' }}>
          {title} {!nested && <span style={{ color: required ? '#ef4444' : '#888', fontSize: 12 }}>({required ? '필수' : '선택'})</span>}
        </div>
        <span style={{ fontSize: 12, color: '#9AA2AA', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>&#9660;</span>
      </div>
      {open && (
        <div style={{ padding: '14px 16px', borderTop: '1px solid #e5e5e5', background: '#fff' }}>
          <div style={{ fontSize: 13, color: '#61686F', lineHeight: 1.7, wordBreak: 'keep-all' }}>{children}</div>
        </div>
      )}
      {errorMsg && <div style={{ fontSize: 12, color: '#D9534F', padding: '0 16px 8px', background: '#fafafa' }}>{errorMsg}</div>}
    </div>
  );
}

/* ── Structured Consent Body (label/value pairs) ─────────── */

function StructuredConsentBody({ body }: { body: string }) {
  const segments = body.split('|').map(s => s.trim()).filter(Boolean);
  const pairs = segments.map(seg => {
    const dashIndex = seg.indexOf('—');
    if (dashIndex >= 0) {
      return { label: seg.slice(0, dashIndex).trim(), value: seg.slice(dashIndex + 1).trim() };
    }
    return { label: '', value: seg };
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {pairs.map((p, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {p.label && <div style={{ fontSize: 12, color: '#9AA2AA', fontWeight: 500 }}>{p.label}</div>}
          <div style={{ fontSize: 13, color: '#61686F', wordBreak: 'keep-all', lineHeight: 1.6 }}>{p.value}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Component ────────────────────────────────────────────── */

export default function ConsentClient({ token }: { token: string }) {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [data, setData] = useState<ConsentData | null>(null);
  const [submittedSummary, setSubmittedSummary] = useState<{
    participant_name?: string; channel_name?: string; phone?: string;
    planned_draft_date?: string; planned_edit_date?: string; planned_upload_date?: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  // Form fields
  const [plannedDraftDate, setPlannedDraftDate] = useState('');
  const [plannedEditDate, setPlannedEditDate] = useState('');
  const [plannedUploadDate, setPlannedUploadDate] = useState('');
  const [phone, setPhone] = useState('');
  const [realName, setRealName] = useState('');
  const [channelName, setChannelName] = useState('');

  // Consent checkboxes
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [adChecked, setAdChecked] = useState(false);
  const [conditionsChecked, setConditionsChecked] = useState(false);
  const [secChecked, setSecChecked] = useState(false);

  // Refs for scroll-to
  const refDraft = useRef<HTMLDivElement>(null);
  const refEdit = useRef<HTMLDivElement>(null);
  const refUpload = useRef<HTMLDivElement>(null);
  const refRealName = useRef<HTMLDivElement>(null);
  const refPhone = useRef<HTMLDivElement>(null);
  const refPrivacy = useRef<HTMLDivElement>(null);
  const refAd = useRef<HTMLDivElement>(null);
  const refConditions = useRef<HTMLDivElement>(null);
  const refSec = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.style.overflowX = 'hidden';
    document.body.style.overflowX = 'hidden';
    return () => {
      document.documentElement.style.overflowX = '';
      document.body.style.overflowX = '';
    };
  }, []);

  useEffect(() => {
    fetch(`/api/public/consent/${token}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) { setErrorMsg(d.error || '오류가 발생했습니다.'); setPageState('error'); }
        else if (d.status === 'already_submitted') { setSubmittedSummary(d); setPageState('already_submitted'); }
        else if (d.status === 'expired') setPageState('expired');
        else { setData(d); setPageState('valid'); }
      })
      .catch(() => { setErrorMsg('오류가 발생했습니다.'); setPageState('error'); });
  }, [token]);

  // Pre-fill channel name from participant data
  useEffect(() => {
    if (data?.channel_name) setChannelName(data.channel_name);
  }, [data]);

  const stripHyphens = (v: string) => v.replace(/[-\s]/g, '');
  const isPaid = data?.is_paid ?? false;

  const privacy = data?.consent_privacy ?? (isPaid ? DEFAULT_PRIVACY : DEFAULT_PRIVACY_UNPAID);
  const adConsent = data?.consent_advertising ?? (isPaid ? DEFAULT_AD_PAID : DEFAULT_AD_UNPAID);
  const secUseText = data?.consent_secondary_use ?? DEFAULT_SECONDARY_USE;
  const conditions = (data?.progress_conditions?.length ? data.progress_conditions : DEFAULT_CONDITIONS)
    .filter((c) => isPaid || !c.paid_only);

  const showSecondary = isPaid && (data?.secondary_use ?? false);
  const allRequiredChecked = isPaid
    ? (privacyChecked && adChecked && conditionsChecked && (!showSecondary || secChecked))
    : (privacyChecked && adChecked);
  const handleBulkRequired = (checked: boolean) => {
    setPrivacyChecked(checked);
    setAdChecked(checked);
    if (isPaid) {
      setConditionsChecked(checked);
      if (showSecondary) setSecChecked(checked);
    }
  };

  type MissingField = { label: string; ref: React.RefObject<HTMLDivElement | null> };

  // Date order validation: 기획안 ≤ 가편집본 ≤ 업로드
  const dateOrderError = (() => {
    if (!isPaid) return null;
    if (!plannedDraftDate || !plannedEditDate || !plannedUploadDate) return null;
    if (plannedDraftDate > plannedEditDate) return '기획안 전달일은 가편집본 전달일보다 이전이어야 합니다.';
    if (plannedEditDate > plannedUploadDate) return '가편집본 전달일은 업로드일보다 이전이어야 합니다.';
    return null;
  })();

  const getMissing = useCallback((): MissingField[] => {
    if (!data) return [];
    const m: MissingField[] = [];
    if (isPaid) {
      if (!plannedDraftDate) m.push({ label: '예상 기획안 전달일', ref: refDraft });
      if (!plannedEditDate) m.push({ label: '예상 가편집본 전달일', ref: refEdit });
      if (!plannedUploadDate) m.push({ label: '예상 업로드일', ref: refUpload });
    }
    if (!realName.trim()) m.push({ label: '성함', ref: refRealName });
    if (!phone) m.push({ label: '휴대폰 번호', ref: refPhone });
    if (!privacyChecked) m.push({ label: '개인정보 수집 동의', ref: refPrivacy });
    if (!adChecked) m.push({ label: '광고 표시 동의', ref: refAd });
    if (isPaid && !conditionsChecked) m.push({ label: '진행 조건 동의', ref: refConditions });
    if (showSecondary && !secChecked) m.push({ label: '2차 활용 동의', ref: refSec });
    return m;
  }, [data, isPaid, showSecondary, plannedDraftDate, plannedEditDate, plannedUploadDate, realName, phone, privacyChecked, adChecked, conditionsChecked, secChecked]);

  const missing = getMissing();
  const formValid = missing.length === 0 && !dateOrderError;

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleSubmit = async () => {
    setTouched(true);
    if (!formValid || submitting) return;
    setSubmitting(true);
    try {
      const body: Record<string, string | null> = {
        planned_draft_date: plannedDraftDate || null,
        planned_edit_date: plannedEditDate || null,
        planned_upload_date: plannedUploadDate || null,
        phone: stripHyphens(phone),
        real_name: realName.trim() || null,
        channel_name: channelName.trim() || null,
      };
      const res = await fetch(`/api/public/consent/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) { setPageState('submitted'); }
      else { const d = await res.json(); setErrorMsg(d.error || '제출에 실패했습니다.'); setPageState('error'); }
    } catch { setErrorMsg('네트워크 오류가 발생했습니다.'); setPageState('error'); }
    finally { setSubmitting(false); }
  };

  /* ── Styles ──────────────────────────────────────────────── */
  const wrap: React.CSSProperties = { maxWidth: 480, width: '100%', margin: '0 auto', padding: '20px 16px', minHeight: '100vh', background: '#FBFCFD', fontFamily: "'Pretendard Variable', system-ui, -apple-system, sans-serif", boxSizing: 'border-box', overflowX: 'hidden' };
  const card: React.CSSProperties = { background: '#FFFFFF', borderRadius: 14, padding: '18px 20px', marginBottom: 14, overflow: 'hidden', border: '1px solid #EDF0F3' };
  const title: React.CSSProperties = { fontSize: 14.5, fontWeight: 650, marginTop: 0, marginBottom: 14, color: '#1A1D21' };
  const input: React.CSSProperties = { width: '100%', maxWidth: '100%', height: 44, padding: '0 12px', border: '1px solid #EDF0F3', borderRadius: 10, fontSize: 15, fontFamily: 'inherit', color: '#1A1D21', boxSizing: 'border-box', background: '#FFFFFF', outline: 'none', transition: 'border-color 120ms' };
  const label: React.CSSProperties = { fontSize: 13, fontWeight: 500, color: '#61686F', marginBottom: 6, display: 'block' };
  const gap: React.CSSProperties = { marginBottom: 12 };
  const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F2F4F7', fontSize: 14 };
  const inlineErr: React.CSSProperties = { fontSize: 12, color: '#D9534F', marginTop: 4 };
  const reqTag: React.CSSProperties = { fontSize: 11, color: '#D9534F', fontWeight: 400 };
  const optTag: React.CSSProperties = { fontSize: 11, color: '#9AA2AA', fontWeight: 400 };

  const isFieldMissing = (lbl: string) => touched && missing.some((m) => m.label === lbl);

  /* ── State screens ──────────────────────────────────────── */
  const screen = (msg: string, icon?: string) => (
    <div style={wrap}>
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1A1D21', marginBottom: 24 }}>HEEDA</div>
        <div style={card}>
          {icon && <div style={{ fontSize: 40, marginBottom: 12, color: '#22c55e' }}>{icon}</div>}
          <p style={{ fontSize: 16, color: '#61686F', margin: 0 }}>{msg}</p>
        </div>
      </div>
    </div>
  );

  if (pageState === 'loading') return screen('로딩 중...');
  if (pageState === 'already_submitted') {
    const s = submittedSummary;
    return (
      <div style={wrap}>
        <div style={{ textAlign: 'center', paddingTop: 60 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1A1D21', marginBottom: 24 }}>HEEDA</div>
          <div style={card}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 13L9 17L19 7" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <p style={{ fontSize: 16, fontWeight: 600, color: '#1A1D21', margin: '0 0 16px' }}>동의가 완료되었습니다.</p>
            {s && (
              <div style={{ textAlign: 'left', fontSize: 13, color: '#61686F', lineHeight: 1.8, borderTop: '1px solid #F2F4F7', paddingTop: 12 }}>
                {s.participant_name && <div><span style={{ color: '#9AA2AA' }}>성함:</span> {s.participant_name}</div>}
                {s.channel_name && <div><span style={{ color: '#9AA2AA' }}>채널명:</span> {s.channel_name}</div>}
                {s.planned_draft_date && <div><span style={{ color: '#9AA2AA' }}>예상 기획안 전달일:</span> {s.planned_draft_date}</div>}
                {s.planned_edit_date && <div><span style={{ color: '#9AA2AA' }}>예상 가편집본 전달일:</span> {s.planned_edit_date}</div>}
                {s.planned_upload_date && <div><span style={{ color: '#9AA2AA' }}>예상 업로드일:</span> {s.planned_upload_date}</div>}
                {s.phone && <div><span style={{ color: '#9AA2AA' }}>휴대폰 번호:</span> {s.phone}</div>}
              </div>
            )}
            <p style={{ fontSize: 13, color: '#9AA2AA', margin: '16px 0 0', lineHeight: 1.6 }}>
              수정이 필요하면 희다 담당자에게 연락해주세요.
            </p>
          </div>
        </div>
      </div>
    );
  }
  if (pageState === 'expired') return screen('만료된 링크입니다');
  if (pageState === 'error') return screen(errorMsg);
  if (pageState === 'submitted') {
    // Completion screen with submitted data summary
    const fmtPhone = phone ? phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3') : '-';
    return (
      <div style={wrap}>
        <div style={{ textAlign: 'center', paddingTop: 60 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1A1D21', marginBottom: 24 }}>HEEDA</div>
          <div style={card}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 13L9 17L19 7" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <p style={{ fontSize: 16, fontWeight: 600, color: '#1A1D21', margin: '0 0 16px' }}>동의서 제출이 완료되었습니다.</p>
            <div style={{ textAlign: 'left', fontSize: 13, color: '#61686F', lineHeight: 1.8, borderTop: '1px solid #F2F4F7', paddingTop: 12 }}>
              {realName && <div><span style={{ color: '#9AA2AA' }}>성함:</span> {realName}</div>}
              {channelName && <div><span style={{ color: '#9AA2AA' }}>채널명:</span> {channelName}</div>}
              {plannedDraftDate && <div><span style={{ color: '#9AA2AA' }}>예상 기획안 전달일:</span> {plannedDraftDate}</div>}
              {plannedEditDate && <div><span style={{ color: '#9AA2AA' }}>예상 가편집본 전달일:</span> {plannedEditDate}</div>}
              {plannedUploadDate && <div><span style={{ color: '#9AA2AA' }}>예상 업로드일:</span> {plannedUploadDate}</div>}
              <div><span style={{ color: '#9AA2AA' }}>휴대폰 번호:</span> {fmtPhone}</div>
            </div>
            <p style={{ fontSize: 13, color: '#9AA2AA', margin: '16px 0 0', lineHeight: 1.6 }}>
              수정이 필요하면 희다 담당자에게 연락해주세요.
            </p>
          </div>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const fmtFee = (f: number) => f >= 10000 && f % 10000 === 0 ? `${(f / 10000).toLocaleString()}만원` : `${f.toLocaleString()}원`;

  const productDisplay = data.product_name || null;
  const advertisedDisplay = data.advertised_products?.length ? data.advertised_products.join(', ') : null;
  const collabLabel = data.collab_label || '-';
  const channelLabel = data.channel ? CHANNEL_LABELS[data.channel as keyof typeof CHANNEL_LABELS] ?? data.channel : null;
  const contentDisplay = data.content_display || null;

  return (
    <div style={wrap}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1A1D21', marginBottom: 10 }}>HEEDA</div>
        <p style={{ fontSize: 14, color: '#61686F', lineHeight: 1.6, margin: 0 }}>
          희다 협업 진행에 필요한 정보를 입력해주세요.
        </p>
      </div>

      {/* 1. 협업 안내 */}
      <div style={card}>
        <h2 style={title}>협업 안내</h2>
        {productDisplay && (
          <div style={row}><span style={{ color: '#9AA2AA' }}>제공 제품</span><span style={{ fontWeight: 500, color: '#1A1D21' }}>{productDisplay}</span></div>
        )}
        {advertisedDisplay && (
          <div style={row}><span style={{ color: '#9AA2AA' }}>광고 진행 제품</span><span style={{ fontWeight: 500, color: '#1A1D21' }}>{advertisedDisplay}</span></div>
        )}
        {channelLabel && (
          <div style={row}><span style={{ color: '#9AA2AA' }}>채널</span><span style={{ fontWeight: 500, color: '#1A1D21' }}>{channelLabel}</span></div>
        )}
        {contentDisplay && (
          <div style={row}><span style={{ color: '#9AA2AA' }}>콘텐츠</span><span style={{ fontWeight: 500, color: '#1A1D21' }}>{contentDisplay}</span></div>
        )}
        <div style={row}><span style={{ color: '#9AA2AA' }}>협업 방식</span><span style={{ fontWeight: 500, color: '#1A1D21' }}>{collabLabel}</span></div>
        {isPaid && data.fee > 0 && (
          <div style={row}><span style={{ color: '#9AA2AA' }}>원고료</span><span style={{ fontWeight: 500, color: '#1A1D21' }}>{fmtFee(data.fee)}</span></div>
        )}
        {data.secondary_use && (
          <div style={{ ...row, borderBottom: 'none' }}><span style={{ color: '#9AA2AA' }}>2차 활용</span><span style={{ fontWeight: 500, color: '#1A1D21' }}>동의 시 {data.secondary_use_period ?? '-'}</span></div>
        )}
      </div>

      {/* 2. 예상 진행 일정 */}
      <div style={card}>
        <h2 style={title}>{isPaid ? '예상 진행 일정' : '예상 업로드일'}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {isPaid && (
            <>
              <div style={gap} ref={refDraft}>
                <label style={label}>예상 기획안 전달일 <span style={reqTag}>(필수)</span></label>
                <div style={{ position: 'relative', overflow: 'hidden' }}>
                  <input type="date" style={{ ...input, textAlign: 'left', borderColor: isFieldMissing('예상 기획안 전달일') ? '#D9534F' : '#EDF0F3', color: plannedDraftDate ? '#1A1D21' : 'transparent' }} value={plannedDraftDate} onChange={(e) => setPlannedDraftDate(e.target.value)} />
                  {!plannedDraftDate && <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#9AA2AA', pointerEvents: 'none', fontSize: 15 }}>날짜를 선택해주세요</span>}
                </div>
                {isFieldMissing('예상 기획안 전달일') && <div style={inlineErr}>기획안 전달일을 입력해주세요</div>}
              </div>
              <div style={gap} ref={refEdit}>
                <label style={label}>예상 가편집본 전달일 <span style={reqTag}>(필수)</span></label>
                <div style={{ position: 'relative', overflow: 'hidden' }}>
                  <input type="date" style={{ ...input, textAlign: 'left', borderColor: isFieldMissing('예상 가편집본 전달일') ? '#D9534F' : '#EDF0F3', color: plannedEditDate ? '#1A1D21' : 'transparent' }} value={plannedEditDate} onChange={(e) => setPlannedEditDate(e.target.value)} />
                  {!plannedEditDate && <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#9AA2AA', pointerEvents: 'none', fontSize: 15 }}>날짜를 선택해주세요</span>}
                </div>
                {isFieldMissing('예상 가편집본 전달일') && <div style={inlineErr}>가편집본 전달일을 입력해주세요</div>}
              </div>
            </>
          )}
          <div style={gap} ref={refUpload}>
            <label style={label}>예상 업로드일 {isPaid ? <span style={reqTag}>(필수)</span> : <span style={optTag}>(선택)</span>}</label>
            <div style={{ position: 'relative', overflow: 'hidden' }}>
              <input type="date" style={{ ...input, textAlign: 'left', borderColor: isFieldMissing('예상 업로드일') ? '#D9534F' : '#EDF0F3', color: plannedUploadDate ? '#1A1D21' : 'transparent' }} value={plannedUploadDate} onChange={(e) => setPlannedUploadDate(e.target.value)} />
              {!plannedUploadDate && <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#9AA2AA', pointerEvents: 'none', fontSize: 15 }}>날짜를 선택해주세요</span>}
            </div>
            {isFieldMissing('예상 업로드일') && <div style={inlineErr}>업로드일을 입력해주세요</div>}
          </div>
          {dateOrderError && <div style={inlineErr}>{dateOrderError}</div>}
        </div>
      </div>

      {/* 3. 인적 사항 */}
      <div style={card}>
        <h2 style={title}>인적 사항</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={gap} ref={refRealName}>
            <label style={label}>성함 <span style={reqTag}>(필수)</span></label>
            <input style={{ ...input, borderColor: isFieldMissing('성함') ? '#D9534F' : '#EDF0F3' }} value={realName} onChange={(e) => setRealName(e.target.value)} placeholder="실명을 입력해주세요" />
            {isFieldMissing('성함') && <div style={inlineErr}>성함을 입력해주세요</div>}
          </div>
          <div style={gap}>
            <label style={label}>채널명 <span style={optTag}>(자동)</span></label>
            <input style={{ ...input, borderColor: '#EDF0F3' }} value={channelName} onChange={(e) => setChannelName(e.target.value)} placeholder="채널명" />
            <div style={{ fontSize: 11, color: '#9AA2AA', marginTop: 2 }}>관리자 등록값이 표시됩니다. 다르면 수정해주세요.</div>
          </div>
          <div style={gap} ref={refPhone}>
            <label style={label}>휴대폰 번호 <span style={reqTag}>(필수)</span></label>
            <input type="tel" style={{ ...input, borderColor: isFieldMissing('휴대폰 번호') ? '#D9534F' : '#EDF0F3' }} value={phone} onChange={(e) => setPhone(stripHyphens(e.target.value))} placeholder="01012345678" />
            {isFieldMissing('휴대폰 번호') && <div style={inlineErr}>휴대폰 번호를 입력해주세요</div>}
          </div>
        </div>
      </div>

      {/* 4. 동의 사항 — Grouped required + separate optional */}
      {(() => {
        // Count visible consent items: privacy + ad always, conditions if paid, secondary if showSecondary
        const consentItemCount = 2 + (isPaid ? 1 : 0) + (showSecondary ? 1 : 0);
        const showBulkAgree = consentItemCount >= 3;

        return (
          <div style={card}>
            <h2 style={title}>동의사항</h2>

            <div ref={refPrivacy} style={{ border: '1px solid #e5e5e5', borderRadius: 10, overflow: 'hidden', marginBottom: 10 }}>
              {/* Bulk agree — only when 3+ items */}
              {showBulkAgree && (
                <>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: '#f5f5f7', cursor: 'pointer' }}
                    onClick={() => handleBulkRequired(!allRequiredChecked)}
                  >
                    <input
                      type="checkbox"
                      checked={allRequiredChecked}
                      onChange={(e) => { e.stopPropagation(); handleBulkRequired(e.target.checked); }}
                      style={{ width: 20, height: 20, flexShrink: 0, cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#1A1D21' }}>
                      아래 내용에 모두 동의합니다 <span style={{ color: '#D9534F', fontSize: 12 }}>(필수)</span>
                    </span>
                  </div>
                  {(touched && !allRequiredChecked) && (
                    <div style={{ fontSize: 12, color: '#D9534F', padding: '4px 16px', background: '#f5f5f7' }}>필수 항목에 모두 동의해주세요</div>
                  )}
                </>
              )}

              {/* Sub-items — individual checkboxes + expandable content */}
              <div style={showBulkAgree ? { borderTop: '1px solid #e5e5e5' } : undefined}>
                <AccordionItem
                  title={privacy.title}
                  required={true}
                  checked={privacyChecked}
                  onChange={setPrivacyChecked}
                  nested
                >
                  <StructuredConsentBody body={privacy.body} />
                </AccordionItem>

                <AccordionItem
                  title={adConsent.title}
                  required={true}
                  checked={adChecked}
                  onChange={setAdChecked}
                  refEl={refAd}
                  nested
                >
                  {adConsent.body}
                </AccordionItem>

                {isPaid && (
                  <AccordionItem
                    title="진행 조건 동의"
                    required={true}
                    checked={conditionsChecked}
                    onChange={setConditionsChecked}
                    refEl={refConditions}
                    nested
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {conditions.map((c, i) => (
                        <div key={i} style={{ paddingLeft: 2 }}>
                          {i + 1}. {c.text}
                        </div>
                      ))}
                    </div>
                  </AccordionItem>
                )}
                {showSecondary && (
                  <AccordionItem
                    title={secUseText.title}
                    required={true}
                    checked={secChecked}
                    onChange={setSecChecked}
                    refEl={refSec}
                    nested
                  >
                    {secUseText.body}
                  </AccordionItem>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 5. Validation summary */}
      {touched && !formValid && missing.length > 0 && (
        <div style={{ padding: '10px 16px', marginBottom: 10, fontSize: 13, color: '#D9534F', lineHeight: 1.8 }}>
          아직 입력하지 않은 항목:{' '}
          {missing.map((m, i) => (
            <span key={m.label}>
              {i > 0 && ', '}
              <span onClick={() => scrollTo(m.ref)} style={{ textDecoration: 'underline', cursor: 'pointer' }}>{m.label}</span>
            </span>
          ))}
        </div>
      )}

      {/* 6. Submit */}
      <div style={{ position: 'sticky', bottom: 0, padding: '12px 0 20px', background: '#FBFCFD' }}>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            width: '100%', height: 52,
            background: formValid ? '#22c55e' : '#F2F4F7',
            color: formValid ? '#FFFFFF' : '#C4CAD1',
            border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 600,
            cursor: submitting ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {submitting ? '제출 중...' : '진행 동의하기'}
        </button>
      </div>
    </div>
  );
}
