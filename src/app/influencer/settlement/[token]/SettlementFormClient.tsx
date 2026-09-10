'use client';

import { useState, useEffect, useRef } from 'react';
import { KOREAN_BANKS, CHANNEL_LABELS, type TaxType, type Channel } from '@/lib/types/influencer';

interface CompanyInfo {
  name: string;
  biz_reg: string;
  representative: string;
  address: string;
  biz_type?: string;
  biz_item?: string;
  email?: string;
}

interface SettlementPageData {
  status: 'valid' | 'already_submitted' | 'expired';
  campaign_name: string;
  participant_name: string;
  fee: number;
  channel: string | null;
  content_display: string | null;
  published_url: string | null;
  planned_upload_date: string | null;
  tax_rates: Record<string, number>;
  guidance: {
    input_notice: string;
    settlement_notice: string;
  };
  company_info?: CompanyInfo | null;
  // already_submitted fields
  bank_name?: string;
  bank_holder?: string;
  settlement?: {
    tax_type: string;
    tax_rate: number;
    tax_amount: number;
    gross_amount: number;
    net_amount: number;
  } | null;
}

function formatFee(fee: number): string {
  return `${fee.toLocaleString()}원`;
}

/* ── SSN helpers ─────────────────────────────────────── */

function formatSsnWithHyphen(raw: string): string {
  if (raw.length <= 6) return raw;
  return raw.slice(0, 6) + '-' + raw.slice(6);
}

function formatBizRegWithHyphen(raw: string): string {
  if (raw.length <= 3) return raw;
  if (raw.length <= 5) return raw.slice(0, 3) + '-' + raw.slice(3);
  return raw.slice(0, 3) + '-' + raw.slice(3, 5) + '-' + raw.slice(5);
}

function maskSsnBlur(raw: string): string {
  // On blur: 950412-1******
  if (raw.length < 7) return raw;
  return raw.slice(0, 6) + '-' + raw[6] + '●'.repeat(6);
}

function validateSsn(raw: string): string | null {
  if (raw.length !== 13) return '주민등록번호 13자리를 입력해주세요.';
  const yy = parseInt(raw.slice(0, 2), 10);
  const mm = parseInt(raw.slice(2, 4), 10);
  const dd = parseInt(raw.slice(4, 6), 10);
  if (mm < 1 || mm > 12) return '생년월일이 올바르지 않습니다.';
  if (dd < 1 || dd > 31) return '생년월일이 올바르지 않습니다.';
  const genderDigit = parseInt(raw[6], 10);
  if (genderDigit < 1 || genderDigit > 4) return '주민등록번호 뒷자리가 올바르지 않습니다.';
  const century = genderDigit <= 2 ? 1900 : 2000;
  const fullYear = century + yy;
  const daysInMonth = new Date(fullYear, mm, 0).getDate();
  if (dd > daysInMonth) return '생년월일이 올바르지 않습니다.';
  // Checksum verification
  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(raw[i], 10) * weights[i];
  const check = (11 - (sum % 11)) % 10;
  if (check !== parseInt(raw[12], 10)) return '주민등록번호가 올바르지 않습니다.';
  return null;
}

/* ── Account masking ─────────────────────────────────── */

function maskAccountBlur(raw: string): string {
  if (raw.length <= 6) return raw;
  const first4 = raw.slice(0, 4);
  const last2 = raw.slice(-2);
  const mid = '●'.repeat(raw.length - 6);
  return first4 + '-' + mid + '-' + last2;
}

/* ── Biz reg validation ──────────────────────────────── */

function validateBizReg(raw: string): string | null {
  if (raw.length !== 10) return '사업자등록번호 10자리를 입력해주세요.';
  const d = raw.split('').map(Number);
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += d[i] * weights[i];
  sum += Math.floor((d[8] * 5) / 10);
  const check = (10 - (sum % 10)) % 10;
  if (check !== d[9]) return '사업자등록번호가 올바르지 않습니다.';
  return null;
}

/* ── Date format ─────────────────────────────────────── */

function formatDate(d: string | null): string {
  if (!d) return '-';
  const parts = d.split('-');
  if (parts.length === 3) return `${parts[0]}. ${parts[1]}. ${parts[2]}.`;
  return d;
}

/* ── Component ───────────────────────────────────────── */

export default function SettlementFormClient({ token }: { token: string }) {
  const [data, setData] = useState<SettlementPageData | null>(null);
  const [pageStatus, setPageStatus] = useState<
    'loading' | 'valid' | 'already_submitted' | 'expired' | 'error' | 'submitted'
  >('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [taxType, setTaxType] = useState<TaxType | ''>('');
  const [realName, setRealName] = useState('');
  const [ssn, setSsn] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessReg, setBusinessReg] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [bankHolder, setBankHolder] = useState('');

  // File upload state — P0-3
  const [bizRegFile, setBizRegFile] = useState<File | null>(null);
  const [fileUploading, setFileUploading] = useState(false);
  const [fileUploaded, setFileUploaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Toast state for copy feedback
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyWithToast = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 1500);
  };

  // Masking state
  const [ssnFocused, setSsnFocused] = useState(false);
  const [ssnShowRaw, setSsnShowRaw] = useState(false);
  const [accountFocused, setAccountFocused] = useState(false);
  const [accountShowRaw, setAccountShowRaw] = useState(false);

  // Validation
  const [ssnError, setSsnError] = useState<string | null>(null);
  const [bizRegError, setBizRegError] = useState<string | null>(null);

  // Tab switch confirm
  const [pendingTab, setPendingTab] = useState<TaxType | null>(null);

  const ssnRef = useRef<HTMLInputElement>(null);
  const accountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.style.overflowX = 'hidden';
    document.body.style.overflowX = 'hidden';
    return () => {
      document.documentElement.style.overflowX = '';
      document.body.style.overflowX = '';
    };
  }, []);

  useEffect(() => {
    fetch(`/api/public/settlement/${token}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) {
          setErrorMsg(d.error || '오류가 발생했습니다.');
          setPageStatus('error');
        } else if (d.status === 'already_submitted') {
          setData(d);
          setPageStatus('already_submitted');
        } else if (d.status === 'expired') {
          setPageStatus('expired');
        } else {
          setData(d);
          setPageStatus('valid');
        }
      })
      .catch(() => {
        setErrorMsg('오류가 발생했습니다.');
        setPageStatus('error');
      });
  }, [token]);

  const stripDigits = (v: string) => v.replace(/\D/g, '');

  // Handle tab switch — clear PII, keep bank info
  const switchTab = (newTab: TaxType) => {
    const hasPiiInput = realName || ssn || businessName || businessReg;
    if (taxType && hasPiiInput && newTab !== taxType) {
      setPendingTab(newTab);
      return;
    }
    doSwitchTab(newTab);
  };

  const doSwitchTab = (newTab: TaxType) => {
    setRealName('');
    setSsn('');
    setBusinessName('');
    setBusinessReg('');
    setSsnError(null);
    setBizRegError(null);
    setSsnShowRaw(false);
    setBizRegFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setTaxType(newTab);
    setPendingTab(null);
  };

  const confirmTabSwitch = () => {
    if (pendingTab) doSwitchTab(pendingTab);
  };

  const cancelTabSwitch = () => {
    setPendingTab(null);
  };

  const isFormValid = (): boolean => {
    if (!taxType) return false;
    if (taxType === 'business_income') {
      if (!realName.trim() || !ssn.trim()) return false;
      if (ssn.length !== 13) return false;
    }
    if (taxType === 'tax_invoice' || taxType === 'tax_exempt_invoice' || taxType === 'simplified_business') {
      if (!businessName.trim() || !businessReg.trim()) return false;
      if (businessReg.length !== 10) return false;
    }
    if (!bankName || !bankAccount.trim() || !bankHolder.trim()) return false;
    if (bankAccount.length < 8 || bankAccount.length > 16) return false;
    return true;
  };

  const handleSubmit = async () => {
    if (!isFormValid() || submitting) return;

    // Validate before submit
    if (taxType === 'business_income') {
      const err = validateSsn(ssn);
      if (err) { setSsnError(err); return; }
    }
    if (taxType === 'tax_invoice' || taxType === 'tax_exempt_invoice' || taxType === 'simplified_business') {
      const err = validateBizReg(businessReg);
      if (err) { setBizRegError(err); return; }
    }

    setSubmitting(true);
    try {
      const payload: Record<string, string> = {
        tax_type: taxType,
        bank_name: bankName,
        bank_account: bankAccount,
        bank_holder: bankHolder,
      };

      if (taxType === 'business_income') {
        payload.real_name = realName;
        payload.ssn = ssn;
      } else if (taxType === 'tax_invoice' || taxType === 'tax_exempt_invoice' || taxType === 'simplified_business') {
        payload.business_name = businessName;
        payload.business_reg = businessReg;
      }

      const res = await fetch(`/api/public/settlement/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        // Upload biz reg file if attached (non-blocking — form submission already succeeded)
        if (bizRegFile) {
          try {
            const fd = new FormData();
            fd.append('file', bizRegFile);
            await fetch(`/api/public/settlement/${token}`, { method: 'PUT', body: fd });
          } catch { /* file upload failure is non-critical */ }
        }
        setPageStatus('submitted');
      } else {
        const d = await res.json();
        setErrorMsg(d.error || '제출에 실패했습니다.');
        setPageStatus('error');
      }
    } catch {
      setErrorMsg('네트워크 오류가 발생했습니다.');
      setPageStatus('error');
    } finally {
      setSubmitting(false);
    }
  };

  // Tax calculation preview
  const getTaxPreview = () => {
    if (!data || !taxType) return null;
    const rate = data.tax_rates[taxType] ?? 0;
    if (taxType === 'tax_invoice') {
      // VAT is added on top — rate from settings
      const vatPct = data.tax_rates.vat ?? 10;
      const vatAmount = Math.round(data.fee * vatPct / 100);
      const totalInvoice = data.fee + vatAmount;
      return { rate: vatPct, taxAmount: vatAmount, netAmount: totalInvoice, isVat: true, isExempt: false };
    }
    if (taxType === 'tax_exempt_invoice') {
      // No VAT, no withholding — full amount invoice
      return { rate: 0, taxAmount: 0, netAmount: data.fee, isVat: false, isExempt: true };
    }
    const taxAmount = Math.round(data.fee * rate / 100);
    const netAmount = data.fee - taxAmount;
    return { rate, taxAmount, netAmount, isVat: false, isExempt: false };
  };

  // Holder mismatch warning
  const holderMismatch = (() => {
    if (!bankHolder.trim()) return false;
    if (taxType === 'business_income' && realName.trim()) {
      return bankHolder.trim() !== realName.trim();
    }
    if ((taxType === 'tax_invoice' || taxType === 'tax_exempt_invoice' || taxType === 'simplified_business') && businessName.trim()) {
      return bankHolder.trim() !== businessName.trim();
    }
    return false;
  })();

  // SSN display value
  const ssnDisplay = (() => {
    if (!ssn) return '';
    if (ssnFocused || ssnShowRaw) return ssn;
    return maskSsnBlur(ssn);
  })();

  // Account display value
  const accountDisplay = (() => {
    if (!bankAccount) return '';
    if (accountFocused || accountShowRaw) return bankAccount;
    return maskAccountBlur(bankAccount);
  })();

  /* ── Styles ────────────────────────────────────────── */
  const wrapStyle: React.CSSProperties = {
    maxWidth: 480, width: '100%', margin: '0 auto', padding: '20px 16px',
    minHeight: '100vh', background: '#FBFCFD',
    fontFamily: "'Pretendard Variable', system-ui, -apple-system, sans-serif",
    boxSizing: 'border-box', overflowX: 'hidden',
  };

  const cardStyle: React.CSSProperties = {
    background: '#FFFFFF', borderRadius: 14, padding: '18px 20px', marginBottom: 14,
    border: '1px solid #EDF0F3',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', height: 44, padding: '0 12px',
    border: '1px solid #EDF0F3', borderRadius: 10, fontSize: 15,
    fontFamily: 'inherit', color: '#1A1D21', boxSizing: 'border-box',
    outline: 'none', background: '#FFFFFF', transition: 'border-color 120ms',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 500, color: '#61686F', marginBottom: 6, display: 'block',
  };

  const reqMark: React.CSSProperties = { color: '#D9534F', fontSize: 12 };

  const infoRow: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '8px 0', borderBottom: '1px solid #F2F4F7', fontSize: 14,
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, minHeight: 52, border: active ? '1.5px solid #4A7DB5' : '1px solid #D6DCE3',
    borderRadius: 10, background: active ? '#F7FAFD' : '#FFFFFF',
    color: active ? '#1A1D21' : '#61686F',
    fontSize: 13.5, fontWeight: active ? 600 : 400,
    cursor: 'pointer', fontFamily: 'inherit',
    display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-start',
    justifyContent: 'center', padding: '8px 12px', gap: 2,
    transition: 'all 120ms',
    borderLeft: active ? '3px solid #4A7DB5' : undefined,
  });

  const eyeBtn: React.CSSProperties = {
    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
    border: 'none', background: 'transparent', cursor: 'pointer', padding: 4,
    color: '#9AA2AA', display: 'flex', alignItems: 'center',
  };

  /* ── Status screens ──────────────────────────────── */
  const screen = (titleText: string, subtitle?: string) => (
    <div style={wrapStyle}>
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1A1D21', marginBottom: 16 }}>HEEDA</div>
        <div style={cardStyle}>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#1A1D21', margin: '0 0 8px' }}>{titleText}</p>
          {subtitle && <p style={{ fontSize: 14, color: '#9AA2AA', margin: 0 }}>{subtitle}</p>}
        </div>
      </div>
    </div>
  );

  if (pageStatus === 'loading') return screen('로딩 중...');
  if (pageStatus === 'error') return screen(errorMsg);
  if (pageStatus === 'already_submitted') {
    const s = data?.settlement;
    const TAX_TYPE_LABELS: Record<string, string> = {
      business_income: '사업소득', tax_invoice: '세금계산서',
      tax_exempt_invoice: '계산서', simplified_business: '간이과세자',
    };
    const maskAccount = ''; // account is encrypted, not available
    return (
      <div style={wrapStyle}>
        <div style={{ textAlign: 'center', paddingTop: 60 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1A1D21', marginBottom: 24 }}>HEEDA</div>
          <div style={cardStyle}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 13L9 17L19 7" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <p style={{ fontSize: 16, fontWeight: 600, color: '#1A1D21', margin: '0 0 16px' }}>정산 정보 제출이 완료되었습니다.</p>
            <div style={{ textAlign: 'left', fontSize: 13, color: '#61686F', lineHeight: 1.8, borderTop: '1px solid #F2F4F7', paddingTop: 12 }}>
              {s && <div><span style={{ color: '#9AA2AA' }}>세금 방식:</span> {TAX_TYPE_LABELS[s.tax_type] ?? s.tax_type}</div>}
              {data?.bank_holder && <div><span style={{ color: '#9AA2AA' }}>예금주:</span> {data.bank_holder}</div>}
              {data?.bank_name && <div><span style={{ color: '#9AA2AA' }}>계좌:</span> {data.bank_name}</div>}
              {s && (
                <div style={{ marginTop: 8, padding: '10px 12px', background: '#FBFCFD', borderRadius: 8, border: '1px solid #EDF0F3', fontVariantNumeric: 'tabular-nums' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#9AA2AA' }}>원고료</span><span>{formatFee(s.gross_amount)}</span></div>
                  {s.tax_type === 'tax_invoice' ? (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#9AA2AA' }}>부가세 ({s.tax_rate}%)</span><span>+{formatFee(s.tax_amount)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: '#1A1D21', borderTop: '1px solid #EDF0F3', paddingTop: 6, marginTop: 4 }}>
                        <span>세금계산서 발행액</span><span>{formatFee(s.net_amount)}</span>
                      </div>
                    </>
                  ) : s.tax_type === 'tax_exempt_invoice' ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: '#1A1D21', borderTop: '1px solid #EDF0F3', paddingTop: 6, marginTop: 4 }}>
                      <span>계산서 발행액</span><span>{formatFee(s.net_amount)}</span>
                    </div>
                  ) : s.tax_rate > 0 ? (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#9AA2AA' }}>원천징수 ({s.tax_rate}%)</span><span style={{ color: '#D9534F' }}>-{formatFee(s.tax_amount)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: '#1A1D21', borderTop: '1px solid #EDF0F3', paddingTop: 6, marginTop: 4 }}>
                        <span>실지급액</span><span>{formatFee(s.net_amount)}</span>
                      </div>
                    </>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: '#1A1D21', borderTop: '1px solid #EDF0F3', paddingTop: 6, marginTop: 4 }}>
                      <span>실지급액</span><span>{formatFee(s.net_amount)}</span>
                    </div>
                  )}
                </div>
              )}
              {s?.tax_type === 'business_income' && (
                <div style={{ marginTop: 12, padding: '10px 12px', background: '#F7FAFD', borderRadius: 8, border: '1px solid #D6E4F0', fontSize: 12.5, color: '#61686F', lineHeight: 1.6 }}>
                  원천징수 후 입금되며, 지급명세서는 (주) 마야크루에서 국세청에 제출합니다.
                </div>
              )}
            </div>
            <p style={{ fontSize: 13, color: '#9AA2AA', margin: '16px 0 0', lineHeight: 1.6 }}>
              제출 후 수정이 필요한 경우 담당자에게 연락해주세요.
            </p>
          </div>
        </div>
      </div>
    );
  }
  if (pageStatus === 'expired') return screen('링크가 만료되었습니다', '담당자에게 새 링크를 요청해주세요.');

  if (pageStatus === 'submitted') {
    const taxPreview = getTaxPreview();
    const maskAccount = bankAccount.length > 6
      ? bankAccount.slice(0, 4) + '●●●●' + bankAccount.slice(-2)
      : bankAccount;

    return (
      <div style={wrapStyle}>
        <div style={{ textAlign: 'center', paddingTop: 60 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1A1D21', marginBottom: 24 }}>HEEDA</div>
          <div style={cardStyle}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 13L9 17L19 7" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <p style={{ fontSize: 16, fontWeight: 600, color: '#1A1D21', margin: '0 0 16px' }}>정산 정보 제출이 완료되었습니다.</p>
            <div style={{ textAlign: 'left', fontSize: 13, color: '#61686F', lineHeight: 1.8, borderTop: '1px solid #F2F4F7', paddingTop: 12 }}>
              <div><span style={{ color: '#9AA2AA' }}>세금 방식:</span> {taxType === 'business_income' ? '사업소득' : taxType === 'tax_invoice' ? '세금계산서' : taxType === 'tax_exempt_invoice' ? '계산서' : '간이과세자'}</div>
              <div><span style={{ color: '#9AA2AA' }}>예금주:</span> {bankHolder}</div>
              <div><span style={{ color: '#9AA2AA' }}>계좌:</span> {bankName} {maskAccount}</div>
              {taxPreview && (
                <div style={{ marginTop: 8, padding: '10px 12px', background: '#FBFCFD', borderRadius: 8, border: '1px solid #EDF0F3', fontVariantNumeric: 'tabular-nums' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#9AA2AA' }}>원고료</span><span>{formatFee(data!.fee)}</span></div>
                  {taxPreview.isVat ? (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#9AA2AA' }}>부가세 ({taxPreview.rate}%)</span><span>+{formatFee(taxPreview.taxAmount)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: '#1A1D21', borderTop: '1px solid #EDF0F3', paddingTop: 6, marginTop: 4 }}>
                        <span>세금계산서 발행액</span><span>{formatFee(taxPreview.netAmount)}</span>
                      </div>
                    </>
                  ) : taxPreview.isExempt ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: '#1A1D21', borderTop: '1px solid #EDF0F3', paddingTop: 6, marginTop: 4 }}>
                      <span>계산서 발행액</span><span>{formatFee(taxPreview.netAmount)}</span>
                    </div>
                  ) : taxPreview.rate > 0 ? (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#9AA2AA' }}>원천징수 ({taxPreview.rate}%)</span><span style={{ color: '#D9534F' }}>-{formatFee(taxPreview.taxAmount)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: '#1A1D21', borderTop: '1px solid #EDF0F3', paddingTop: 6, marginTop: 4 }}>
                        <span>실지급액</span><span>{formatFee(taxPreview.netAmount)}</span>
                      </div>
                    </>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: '#1A1D21', borderTop: '1px solid #EDF0F3', paddingTop: 6, marginTop: 4 }}>
                      <span>실지급액</span><span>{formatFee(taxPreview.netAmount)}</span>
                    </div>
                  )}
                </div>
              )}
              {/* Post-submission type-specific guidance — P1-4 */}
              {(taxType === 'tax_invoice' || taxType === 'tax_exempt_invoice') && data?.company_info && (() => {
                const ci = data.company_info!;
                const invoiceLabel = taxType === 'tax_invoice' ? '세금계산서' : '계산서';
                const fields = [
                  { label: '상호', value: ci.name },
                  { label: '사업자등록번호', value: ci.biz_reg },
                  { label: '대표자', value: ci.representative },
                  { label: '주소', value: ci.address },
                  { label: '업태', value: ci.biz_type },
                  { label: '종목', value: ci.biz_item },
                  { label: '이메일', value: ci.email },
                ].filter(r => r.value);
                return (
                  <div style={{ marginTop: 12, padding: '10px 12px', background: '#F7FAFD', borderRadius: 8, border: '1px solid #D6E4F0', fontSize: 12.5, color: '#4A7DB5', lineHeight: 1.6 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{invoiceLabel} 발행 안내</div>
                    <div>아래 정보로 {invoiceLabel}를 발행해주세요.</div>
                    <div style={{ marginTop: 6, color: '#61686F' }}>
                      {fields.map(f => (<div key={f.label}>{f.label}: {f.value}</div>))}
                    </div>
                    <div style={{ marginTop: 8, color: '#61686F' }}>
                      <div>품목: 광고 콘텐츠 제작비</div>
                      <div>공급가액: {formatFee(data!.fee)}</div>
                      {taxType === 'tax_invoice' && taxPreview && <div>부가세: {formatFee(taxPreview.taxAmount)}</div>}
                      <div>합계: {formatFee(taxPreview?.netAmount ?? data!.fee)}</div>
                    </div>
                  </div>
                );
              })()}
              {taxType === 'business_income' && (
                <div style={{ marginTop: 12, padding: '10px 12px', background: '#F7FAFD', borderRadius: 8, border: '1px solid #D6E4F0', fontSize: 12.5, color: '#61686F', lineHeight: 1.6 }}>
                  원천징수 후 입금되며, 지급명세서는 (주) 마야크루에서 국세청에 제출합니다.
                </div>
              )}
              {taxType === 'simplified_business' && (
                <div style={{ marginTop: 12, padding: '10px 12px', background: '#F7FAFD', borderRadius: 8, border: '1px solid #D6E4F0', fontSize: 12.5, color: '#61686F', lineHeight: 1.6 }}>
                  별도 증빙 발행 없이 입금됩니다.
                </div>
              )}
            </div>
            <p style={{ fontSize: 13, color: '#9AA2AA', margin: '16px 0 0', lineHeight: 1.6 }}>
              제출 후 수정이 필요한 경우 담당자에게 연락해주세요.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const valid = isFormValid();
  const taxPreview = getTaxPreview();
  const channelLabel = data.channel ? (CHANNEL_LABELS[data.channel as Channel] ?? data.channel) : null;

  const TAX_TABS: { value: TaxType; label: string; sub: string }[] = [
    { value: 'business_income', label: '사업소득', sub: '프리랜서, 일반 개인' },
    { value: 'tax_invoice', label: '세금계산서', sub: '일반과세 사업자' },
    { value: 'tax_exempt_invoice', label: '계산서', sub: '면세 사업자' },
    { value: 'simplified_business', label: '간이과세자', sub: '간이과세 사업자' },
  ];

  const TAX_GUIDANCE: Record<TaxType, string> = {
    business_income: '원고료에서 3.3% 원천징수 후 입금됩니다.',
    tax_invoice: '세금계산서를 발행해주시면 VAT 포함 금액이 입금됩니다.',
    tax_exempt_invoice: '계산서를 발행해주시면 원고료 전액이 입금됩니다.',
    simplified_business: '원천징수 없이 원고료 전액 입금됩니다.',
  };

  const EyeOpen = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M1 8C1 8 3.5 3 8 3C12.5 3 15 8 15 8C15 8 12.5 13 8 13C3.5 13 1 8 1 8Z" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );

  const EyeClosed = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M1 8C1 8 3.5 3 8 3C12.5 3 15 8 15 8C15 8 12.5 13 8 13C3.5 13 1 8 1 8Z" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2 14L14 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );

  return (
    <div style={wrapStyle}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1A1D21', marginBottom: 10 }}>HEEDA</div>
        <p style={{ fontSize: 14, color: '#61686F', margin: 0, lineHeight: 1.6 }}>
          정산 정보를 입력해주세요.
        </p>
      </div>

      {/* 1. 협업 정보 — read-only */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 14.5, fontWeight: 650, marginTop: 0, marginBottom: 12, color: '#1A1D21' }}>협업 정보</h2>
        {channelLabel && (
          <div style={infoRow}>
            <span style={{ color: '#9AA2AA' }}>채널</span>
            <span style={{ fontWeight: 500, color: '#1A1D21' }}>{channelLabel}</span>
          </div>
        )}
        {data.content_display && (
          <div style={infoRow}>
            <span style={{ color: '#9AA2AA' }}>콘텐츠</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500, color: '#1A1D21' }}>
              {data.content_display}
              {data.published_url && (
                <a
                  href={data.published_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 12, color: '#4A7DB5', textDecoration: 'none', fontWeight: 400 }}
                >
                  [보기]
                </a>
              )}
            </span>
          </div>
        )}
        {data.planned_upload_date && (
          <div style={infoRow}>
            <span style={{ color: '#9AA2AA' }}>업로드일</span>
            <span style={{ fontWeight: 500, color: '#1A1D21' }}>{formatDate(data.planned_upload_date)}</span>
          </div>
        )}
        <div style={{ ...infoRow, borderBottom: 'none' }}>
          <span style={{ color: '#9AA2AA' }}>원고료</span>
          <span style={{ fontWeight: 600, color: '#1A1D21' }}>{formatFee(data.fee)}</span>
        </div>
      </div>

      {/* 2. 세금 신고 방식 — tabs */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 14.5, fontWeight: 650, marginTop: 0, marginBottom: 12, color: '#1A1D21' }}>
          세금 신고 방식 <span style={reqMark}>*</span>
        </h2>

        {/* Tab grid 2×2 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          {TAX_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => switchTab(tab.value)}
              style={tabStyle(taxType === tab.value)}
            >
              <span>{tab.label}</span>
              <span style={{ fontSize: 11, color: taxType === tab.value ? '#4A7DB5' : '#B8BFC6', fontWeight: 400 }}>{tab.sub}</span>
            </button>
          ))}
        </div>

        {/* No selection state */}
        {!taxType && (
          <div style={{ padding: '20px 0', textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: '#9AA2AA', lineHeight: 1.7 }}>
              해당하는 세금 신고 방식을 선택해주세요.
            </div>
          </div>
        )}

        {/* Selected tab content */}
        {taxType && (
          <>
            {/* Guidance text */}
            <div style={{ fontSize: 13, color: '#61686F', marginBottom: 16, padding: '10px 12px', background: '#FBFCFD', borderRadius: 8, border: '1px solid #EDF0F3', lineHeight: 1.6 }}>
              {TAX_GUIDANCE[taxType]}
            </div>

            {/* Invoice company info — P0-2 */}
            {(taxType === 'tax_invoice' || taxType === 'tax_exempt_invoice') && data.company_info && (() => {
              const ci = data.company_info!;
              const invoiceLabel = taxType === 'tax_invoice' ? '세금계산서' : '계산서';
              const vatPct = data.tax_rates.vat ?? 10;
              const vatAmount = taxType === 'tax_invoice' ? Math.round(data.fee * vatPct / 100) : 0;
              const totalInvoice = taxType === 'tax_invoice' ? data.fee + vatAmount : data.fee;
              const allFields = [
                { label: '상호', value: ci.name },
                { label: '사업자등록번호', value: ci.biz_reg },
                { label: '대표자', value: ci.representative },
                { label: '주소', value: ci.address },
                { label: '업태', value: ci.biz_type },
                { label: '종목', value: ci.biz_item },
                { label: '이메일', value: ci.email },
              ].filter(r => r.value);
              const allText = allFields.map(f => `${f.label}: ${f.value}`).join('\n');
              return (
                <div style={{ marginBottom: 16, padding: '14px 16px', background: '#FBFCFD', borderRadius: 10, border: '1px solid #EDF0F3' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1D21' }}>
                      {invoiceLabel} 발행 정보
                    </span>
                    <button
                      type="button"
                      onClick={() => copyWithToast(allText, '전체')}
                      style={{ background: 'none', border: '1px solid #D6E4F0', borderRadius: 6, cursor: 'pointer', padding: '3px 10px', fontSize: 11, color: '#4A7DB5', fontFamily: 'inherit' }}
                    >
                      전체 복사
                    </button>
                  </div>
                  <div style={{ fontSize: 12.5, color: '#61686F', lineHeight: 1.8 }}>
                    {allFields.map((row) => (
                      <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                        <span><span style={{ color: '#9AA2AA', marginRight: 8 }}>{row.label}</span>{row.value}</span>
                        <button
                          type="button"
                          onClick={() => copyWithToast(row.value!, row.label)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', fontSize: 11, color: '#4A7DB5', flexShrink: 0 }}
                        >
                          복사
                        </button>
                      </div>
                    ))}
                  </div>
                  {/* 작성 안내 */}
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #EDF0F3' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#4A7DB5', marginBottom: 6 }}>작성 안내</div>
                    <div style={{ fontSize: 12, color: '#61686F', lineHeight: 1.8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#9AA2AA' }}>품목</span><span>광고 콘텐츠 제작비</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#9AA2AA' }}>공급가액</span><span>{formatFee(data.fee)}</span></div>
                      {taxType === 'tax_invoice' && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#9AA2AA' }}>부가세 ({vatPct}%)</span><span>{formatFee(vatAmount)}</span></div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}><span style={{ color: '#9AA2AA' }}>합계</span><span>{formatFee(totalInvoice)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#9AA2AA' }}>발행일</span><span>업로드 완료 후 발행</span></div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Type-specific guidance — P0-2 */}
            {taxType === 'business_income' && (
              <div style={{ marginBottom: 16, padding: '10px 12px', background: '#FBFCFD', borderRadius: 8, border: '1px solid #EDF0F3', fontSize: 12.5, color: '#61686F', lineHeight: 1.6 }}>
                원천징수 후 입금되며, 지급명세서는 (주) 마야크루에서 국세청에 제출합니다.
              </div>
            )}
            {taxType === 'simplified_business' && (
              <div style={{ marginBottom: 16, padding: '10px 12px', background: '#FBFCFD', borderRadius: 8, border: '1px solid #EDF0F3', fontSize: 12.5, color: '#61686F', lineHeight: 1.6 }}>
                별도 증빙 발행 없이 입금됩니다.
              </div>
            )}

            {/* PII fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {taxType === 'business_income' ? (
                <>
                  <div>
                    <label style={labelStyle}>실명 <span style={reqMark}>*</span></label>
                    <input
                      style={inputStyle}
                      value={realName}
                      onChange={(e) => setRealName(e.target.value)}
                      placeholder="실명을 입력해주세요"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>주민등록번호 <span style={reqMark}>*</span></label>
                    <div style={{ position: 'relative' }}>
                      <input
                        ref={ssnRef}
                        style={{
                          ...inputStyle,
                          paddingRight: 36,
                          fontVariantNumeric: 'tabular-nums',
                          letterSpacing: ssnFocused || ssnShowRaw ? 'normal' : '0.5px',
                          borderColor: ssnError ? '#D9534F' : '#EDF0F3',
                        }}
                        value={ssnFocused ? formatSsnWithHyphen(ssn) : ssnDisplay}
                        onChange={(e) => {
                          const v = stripDigits(e.target.value).slice(0, 13);
                          setSsn(v);
                          setSsnError(null);
                        }}
                        onFocus={() => setSsnFocused(true)}
                        onBlur={() => {
                          setSsnFocused(false);
                          setSsnShowRaw(false);
                          if (ssn && ssn.length === 13) {
                            const err = validateSsn(ssn);
                            setSsnError(err);
                          }
                        }}
                        placeholder="숫자 13자리"
                        inputMode="numeric"
                      />
                      {ssn && !ssnFocused && (
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); setSsnShowRaw(!ssnShowRaw); }}
                          style={eyeBtn}
                        >
                          {ssnShowRaw ? <EyeOpen /> : <EyeClosed />}
                        </button>
                      )}
                    </div>
                    {ssnError && <div style={{ fontSize: 12, color: '#D9534F', marginTop: 4 }}>{ssnError}</div>}
                    {!ssnError && ssn && ssn.length < 13 && (
                      <div style={{ fontSize: 12, color: '#9AA2AA', marginTop: 4 }}>{ssn.length}/13자리</div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label style={labelStyle}>사업자명 <span style={reqMark}>*</span></label>
                    <input
                      style={inputStyle}
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="사업자명을 입력해주세요"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>사업자등록번호 <span style={reqMark}>*</span></label>
                    <input
                      style={{
                        ...inputStyle,
                        fontVariantNumeric: 'tabular-nums',
                        borderColor: bizRegError ? '#D9534F' : '#EDF0F3',
                      }}
                      value={formatBizRegWithHyphen(businessReg)}
                      onChange={(e) => {
                        const v = stripDigits(e.target.value).slice(0, 10);
                        setBusinessReg(v);
                        setBizRegError(null);
                      }}
                      onBlur={() => {
                        if (businessReg && businessReg.length === 10) {
                          setBizRegError(validateBizReg(businessReg));
                        }
                      }}
                      placeholder="숫자 10자리"
                      inputMode="numeric"
                    />
                    {bizRegError && <div style={{ fontSize: 12, color: '#D9534F', marginTop: 4 }}>{bizRegError}</div>}
                    {!bizRegError && businessReg && businessReg.length < 10 && (
                      <div style={{ fontSize: 12, color: '#9AA2AA', marginTop: 4 }}>{businessReg.length}/10자리</div>
                    )}
                  </div>
                  {/* File upload — P0-3 */}
                  <div>
                    <label style={labelStyle}>사업자등록증 첨부 <span style={{ fontSize: 11, color: '#9AA2AA', fontWeight: 400 }}>(선택)</span></label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        if (f && f.size > 5 * 1024 * 1024) {
                          setCopiedField('5MB 이하 파일만 가능');
                          setTimeout(() => setCopiedField(null), 2000);
                          return;
                        }
                        setBizRegFile(f);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        width: '100%', height: 44, border: '1px dashed #D6E4F0', borderRadius: 10,
                        background: bizRegFile ? '#F7FAFD' : '#FFFFFF', cursor: 'pointer',
                        fontSize: 13, color: bizRegFile ? '#4A7DB5' : '#9AA2AA',
                        fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}
                    >
                      {bizRegFile ? (
                        <>{bizRegFile.name} <span style={{ fontSize: 11, color: '#9AA2AA' }}>({(bizRegFile.size / 1024).toFixed(0)}KB)</span></>
                      ) : (
                        <>📎 파일 선택 (JPG, PNG, PDF · 5MB 이하)</>
                      )}
                    </button>
                    {bizRegFile && (
                      <button
                        type="button"
                        onClick={() => { setBizRegFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                        style={{ fontSize: 12, color: '#D9534F', background: 'none', border: 'none', cursor: 'pointer', marginTop: 4, padding: 0 }}
                      >
                        삭제
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Tax calculation preview */}
            {taxPreview && (
              <div style={{ marginTop: 16, padding: '12px 14px', background: '#FBFCFD', borderRadius: 8, border: '1px solid #EDF0F3', fontSize: 13, lineHeight: 1.8, color: '#61686F', fontVariantNumeric: 'tabular-nums' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>원고료</span><span>{formatFee(data.fee)}</span></div>
                {taxPreview.isVat ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>부가세 ({taxPreview.rate}%)</span><span>+{formatFee(taxPreview.taxAmount)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: '#1A1D21', borderTop: '1px solid #EDF0F3', paddingTop: 6, marginTop: 4 }}>
                      <span>세금계산서 발행액</span><span>{formatFee(taxPreview.netAmount)}</span>
                    </div>
                  </>
                ) : taxPreview.isExempt ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: '#1A1D21', borderTop: '1px solid #EDF0F3', paddingTop: 6, marginTop: 4 }}>
                    <span>계산서 발행액</span><span>{formatFee(taxPreview.netAmount)}</span>
                  </div>
                ) : taxPreview.rate > 0 ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>원천징수 ({taxPreview.rate}%)</span><span style={{ color: '#D9534F' }}>-{formatFee(taxPreview.taxAmount)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: '#1A1D21', borderTop: '1px solid #EDF0F3', paddingTop: 6, marginTop: 4 }}>
                      <span>실지급액</span><span>{formatFee(taxPreview.netAmount)}</span>
                    </div>
                  </>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: '#1A1D21', borderTop: '1px solid #EDF0F3', paddingTop: 6, marginTop: 4 }}>
                    <span>실지급액</span><span>{formatFee(taxPreview.netAmount)}</span>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* 3. 계좌 정보 */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 14.5, fontWeight: 650, marginTop: 0, marginBottom: 12, color: '#1A1D21' }}>
          계좌 정보 <span style={reqMark}>*</span>
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>은행명 <span style={reqMark}>*</span></label>
            <select
              style={{
                ...inputStyle,
                appearance: 'none',
                backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\' viewBox=\'0 0 12 8\'%3E%3Cpath d=\'M1 1l5 5 5-5\' stroke=\'%239AA2AA\' stroke-width=\'1.5\' fill=\'none\'/%3E%3C/svg%3E")',
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 12px center',
                paddingRight: 32,
                color: bankName ? '#1A1D21' : '#9AA2AA',
              }}
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
            >
              <option value="">은행을 선택해주세요</option>
              {KOREAN_BANKS.map((bank) => (<option key={bank} value={bank}>{bank}</option>))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>계좌번호 <span style={reqMark}>*</span></label>
            <div style={{ position: 'relative' }}>
              <input
                ref={accountRef}
                style={{
                  ...inputStyle,
                  paddingRight: 36,
                  fontVariantNumeric: 'tabular-nums',
                }}
                value={accountFocused ? bankAccount : accountDisplay}
                onChange={(e) => setBankAccount(stripDigits(e.target.value))}
                onFocus={() => setAccountFocused(true)}
                onBlur={() => { setAccountFocused(false); setAccountShowRaw(false); }}
                placeholder="숫자만 입력해주세요 (8~16자리)"
                inputMode="numeric"
              />
              {bankAccount && !accountFocused && (
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); setAccountShowRaw(!accountShowRaw); }}
                  style={eyeBtn}
                >
                  {accountShowRaw ? <EyeOpen /> : <EyeClosed />}
                </button>
              )}
            </div>
            {bankAccount && (bankAccount.length < 8 || bankAccount.length > 16) && (
              <div style={{ fontSize: 12, color: '#D9534F', marginTop: 4 }}>계좌번호는 8~16자리입니다.</div>
            )}
          </div>
          <div>
            <label style={labelStyle}>예금주 <span style={reqMark}>*</span></label>
            <input
              style={inputStyle}
              value={bankHolder}
              onChange={(e) => setBankHolder(e.target.value)}
              onFocus={() => {
                if (!bankHolder.trim()) {
                  const autoName = taxType === 'business_income' ? realName.trim() : businessName.trim();
                  if (autoName) setBankHolder(autoName);
                }
              }}
              placeholder="예금주명을 입력해주세요"
            />
            {holderMismatch && (
              <div style={{ fontSize: 12, color: '#E6A817', marginTop: 4, lineHeight: 1.5 }}>
                예금주명이 {taxType === 'business_income' ? '실명' : '사업자명'}과 다르면 입금이 지연될 수 있습니다.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Missing fields indicator — P0-6 */}
      {taxType && !valid && (
        <div style={{ padding: '10px 14px', marginBottom: 8, fontSize: 12, color: '#D9534F', background: '#FFF5F5', borderRadius: 8, lineHeight: 1.6 }}>
          {(() => {
            const missing: string[] = [];
            if (taxType === 'business_income') {
              if (!realName.trim()) missing.push('실명');
              if (!ssn.trim() || ssn.length !== 13) missing.push('주민등록번호');
            } else {
              if (!businessName.trim()) missing.push('사업자명');
              if (!businessReg.trim() || businessReg.length !== 10) missing.push('사업자등록번호');
            }
            if (!bankName) missing.push('은행명');
            if (!bankAccount.trim() || bankAccount.length < 8 || bankAccount.length > 16) missing.push('계좌번호');
            if (!bankHolder.trim()) missing.push('예금주');
            return missing.length > 0 ? `미입력: ${missing.join(', ')}` : null;
          })()}
        </div>
      )}

      {/* Submit */}
      <div style={{ position: 'sticky', bottom: 0, padding: '12px 0 20px', background: '#FBFCFD' }}>
        <button
          onClick={handleSubmit}
          disabled={!valid || submitting}
          style={{
            width: '100%', height: 52,
            background: valid ? '#1A1D21' : '#F2F4F7',
            color: valid ? '#FFFFFF' : '#C4CAD1',
            border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 600,
            cursor: valid && !submitting ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
          }}
        >
          {submitting ? '제출 중...' : '제출하기'}
        </button>
      </div>

      <p style={{ fontSize: 12, color: '#9AA2AA', textAlign: 'center', lineHeight: 1.5, marginBottom: 40 }}>
        입력하신 정보는 암호화되어 안전하게 보관되며,<br />
        지급 완료일로부터 6개월 후 파기됩니다.<br />
        수정이 필요하면 담당자에게 연락해주세요.
      </p>

      {/* Tab switch confirm dialog */}
      {pendingTab && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20,
        }}>
          <div style={{
            background: '#FFFFFF', borderRadius: 14, padding: '24px 20px', maxWidth: 320, width: '100%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: '#1A1D21', margin: '0 0 8px' }}>
              세금 방식을 변경하시겠습니까?
            </p>
            <p style={{ fontSize: 13, color: '#61686F', margin: '0 0 20px', lineHeight: 1.6 }}>
              입력한 인적 사항이 초기화됩니다.<br />계좌 정보는 유지됩니다.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={cancelTabSwitch}
                style={{
                  flex: 1, height: 40, border: '1px solid #EDF0F3', borderRadius: 8,
                  background: '#FFFFFF', color: '#61686F', fontSize: 14, fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmTabSwitch}
                style={{
                  flex: 1, height: 40, border: 'none', borderRadius: 8,
                  background: '#1A1D21', color: '#FFFFFF', fontSize: 14, fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                변경
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Copy toast — P0-2 */}
      {copiedField && (
        <div style={{
          position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          background: '#1A1D21', color: '#FFFFFF', padding: '8px 20px',
          borderRadius: 20, fontSize: 13, fontWeight: 500, zIndex: 200,
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          animation: 'fadeIn 150ms ease-out',
        }}>
          복사됨
        </div>
      )}
    </div>
  );
}
