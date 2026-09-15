'use client';

import { useState, useEffect } from 'react';
import AppShell from '@/components/AppShell';
import type { InfluencerProduct, ProductSet } from '@/lib/types/influencer';
import { colors, typo, spacing, radii } from '@/lib/influencer/styles';
import { Btn, Toast } from '@/lib/influencer/ui';

interface ProgressCondition {
  text: string;
  paid_only: boolean;
}

export default function SettingsClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // 제품 관리
  const [products, setProducts] = useState<InfluencerProduct[]>([]);
  // 제품 세트
  const [productSets, setProductSets] = useState<ProductSet[]>([]);

  // 동의서 문구
  const [adTitle, setAdTitle] = useState('광고 표시 동의서');
  const [adBody, setAdBody] = useState('');
  const [secTitle, setSecTitle] = useState('2차 활용 동의서');
  const [secBody, setSecBody] = useState('');

  // 개인정보 수집 동의
  const [privacyTitle, setPrivacyTitle] = useState('개인정보 수집 및 이용 동의');
  const [privacyBody, setPrivacyBody] = useState('');

  // 진행 조건
  const [progressConditions, setProgressConditions] = useState<ProgressCondition[]>([]);

  // 세율
  const [taxBusiness, setTaxBusiness] = useState(3.3);

  // 예산
  const [monthlyBudget, setMonthlyBudget] = useState(0);
  const [annualBudget, setAnnualBudget] = useState(0);

  // 정산 안내문
  const [inputNotice, setInputNotice] = useState('');
  const [settlementNotice, setSettlementNotice] = useState('');

  // 회사 정보 (세금계산서/계산서 발행용)
  const [companyName, setCompanyName] = useState('');
  const [companyBizReg, setCompanyBizReg] = useState('');
  const [companyRepresentative, setCompanyRepresentative] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [companyBizType, setCompanyBizType] = useState('');
  const [companyBizItem, setCompanyBizItem] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');

  // 부가세율
  const [vatRate, setVatRate] = useState(10);

  // 무결성 점검
  const [integrityLoading, setIntegrityLoading] = useState(false);
  const [integrityResult, setIntegrityResult] = useState<{
    checked_at: string;
    total_issues: number;
    checks: Array<{
      check: string;
      severity: 'error' | 'warning';
      description: string;
      items: Array<{ id: string; detail: string }>;
    }>;
  } | null>(null);

  // 접근 관리 (비밀번호 변경)
  type PwStep = 'idle' | 'code-sent' | 'done';
  const [pwStep, setPwStep] = useState<PwStep>('idle');
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwCode, setPwCode] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwMaskedEmail, setPwMaskedEmail] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');

  useEffect(() => {
    fetch('/api/influencer/settings')
      .then((r) => r.json())
      .then((data) => {
        if (data && !data.error) {
          setAdTitle(data.consent_advertising?.title ?? '광고 표시 동의서');
          setAdBody(data.consent_advertising?.body ?? '');
          setSecTitle(data.consent_secondary_use?.title ?? '2차 활용 동의서');
          setSecBody(data.consent_secondary_use?.body ?? '');
          setPrivacyTitle(data.consent_privacy?.title ?? '개인정보 수집 및 이용 동의');
          setPrivacyBody(data.consent_privacy?.body ?? '');
          setTaxBusiness(data.tax_rates?.business_income ?? 3.3);
          setMonthlyBudget(data.default_budget?.monthly ?? 0);
          setAnnualBudget(data.annual_budget?.amount ?? 0);
          setInputNotice(data.settlement_guidance?.input_notice ?? '');
          setSettlementNotice(data.settlement_guidance?.settlement_notice ?? '');
          setProducts(data.influencer_products?.products ?? []);
          setProductSets(data.influencer_product_sets?.sets ?? []);
          setProgressConditions(data.consent_progress_conditions?.conditions ?? []);
          setCompanyName(data.company_info?.name ?? '');
          setCompanyBizReg(data.company_info?.biz_reg ?? '');
          setCompanyRepresentative(data.company_info?.representative ?? '');
          setCompanyAddress(data.company_info?.address ?? '');
          setCompanyBizType(data.company_info?.biz_type ?? '');
          setCompanyBizItem(data.company_info?.biz_item ?? '');
          setCompanyEmail(data.company_info?.email ?? '');
          setVatRate(data.tax_rates?.vat ?? 10);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/influencer/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consent_advertising: { title: adTitle, body: adBody },
          consent_secondary_use: { title: secTitle, body: secBody },
          consent_privacy: { title: privacyTitle, body: privacyBody },
          consent_progress_conditions: { conditions: progressConditions },
          tax_rates: { business_income: taxBusiness, tax_invoice: 0, tax_exempt_invoice: 0, simplified_business: 0, vat: vatRate },
          default_budget: { monthly: monthlyBudget },
          annual_budget: { amount: annualBudget },
          settlement_guidance: { input_notice: inputNotice, settlement_notice: settlementNotice },
          influencer_products: { products },
          influencer_product_sets: { sets: productSets },
          company_info: { name: companyName, biz_reg: companyBizReg, representative: companyRepresentative, address: companyAddress, biz_type: companyBizType, biz_item: companyBizItem, email: companyEmail },
        }),
      });
      if (res.ok) {
        setMessage('저장되었습니다.');
      } else {
        setMessage('저장 실패');
      }
    } catch {
      setMessage('저장 실패');
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    border: `1px solid ${colors.border}`,
    borderRadius: radii.button,
    fontSize: 14,
    fontFamily: 'var(--font)',
    background: colors.surface,
    color: colors.textPrimary,
    boxSizing: 'border-box',
  };

  const textareaStyle: React.CSSProperties = {
    ...inputStyle,
    minHeight: 100,
    resize: 'vertical' as const,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 500,
    color: colors.textSecondary,
    marginBottom: 4,
    display: 'block',
  };

  const sectionStyle: React.CSSProperties = {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.card,
    padding: '20px 24px',
    marginBottom: spacing.gap,
  };

  const btnSmall: React.CSSProperties = {
    padding: '4px 12px',
    background: 'none',
    border: `1px solid ${colors.border}`,
    borderRadius: radii.chip,
    fontSize: 12,
    cursor: 'pointer',
    color: colors.textSecondary,
  };

  return (
    <AppShell showFilter={false}>
      <div style={{ maxWidth: 720 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>설정</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {message && (
              <span style={{ fontSize: 13, color: message === '저장되었습니다.' ? 'var(--green)' : 'var(--red)' }}>
                {message}
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={saving || loading}
              style={{
                padding: '8px 20px',
                background: colors.accentDark,
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>

        {loading ? (
          <p style={{ color: colors.textMuted }}>로딩 중...</p>
        ) : (
          <>
            {/* 제품 관리 */}
            <div style={sectionStyle}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>제품 관리</h2>
              <p style={{ fontSize: 12, color: colors.textMuted, marginBottom: 12 }}>
                인플루언서에게 제공하는 제품을 등록합니다
              </p>
              {products.map((p, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <input
                    style={{ ...inputStyle, flex: 1, padding: '6px 8px' }}
                    placeholder="제품명"
                    value={p.name}
                    onChange={(e) => {
                      const next = [...products];
                      next[i] = { ...next[i], name: e.target.value };
                      setProducts(next);
                    }}
                  />
                  <button
                    style={{ ...btnSmall, color: colors.coral }}
                    onClick={() => setProducts(products.filter((_, j) => j !== i))}
                  >
                    삭제
                  </button>
                </div>
              ))}
              <button
                style={{ ...btnSmall, marginTop: 8 }}
                onClick={() => setProducts([...products, { name: '', unit_cost: 0 }])}
              >
                + 제품 추가
              </button>
            </div>

            {/* 제품 세트 */}
            <div style={sectionStyle}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>제품 세트</h2>
              <p style={{ fontSize: 12, color: colors.textMuted, marginBottom: 12 }}>
                자주 사용하는 제품 조합을 세트로 등록합니다
              </p>
              {productSets.map((set, si) => (
                <div key={si} style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: 12, marginBottom: 12 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                    <input
                      style={{ ...inputStyle, flex: 1, padding: '6px 8px' }}
                      placeholder="세트 이름"
                      value={set.name}
                      onChange={(e) => {
                        const next = [...productSets];
                        next[si] = { ...next[si], name: e.target.value };
                        setProductSets(next);
                      }}
                    />
                    <button
                      style={{ ...btnSmall, color: colors.coral }}
                      onClick={() => setProductSets(productSets.filter((_, j) => j !== si))}
                    >
                      세트 삭제
                    </button>
                  </div>
                  {set.items.map((item, ii) => (
                    <div key={ii} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                      <select
                        style={{ ...inputStyle, flex: 1, padding: '6px 8px' }}
                        value={item.product}
                        onChange={(e) => {
                          const next = [...productSets];
                          const items = [...next[si].items];
                          items[ii] = { ...items[ii], product: e.target.value };
                          next[si] = { ...next[si], items };
                          setProductSets(next);
                        }}
                      >
                        <option value="">제품 선택</option>
                        {products.map((p) => (
                          <option key={p.name} value={p.name}>{p.name}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        style={{ ...inputStyle, width: 80, padding: '6px 8px', textAlign: 'center' }}
                        value={item.quantity}
                        min={1}
                        onChange={(e) => {
                          const next = [...productSets];
                          const items = [...next[si].items];
                          items[ii] = { ...items[ii], quantity: parseInt(e.target.value) || 1 };
                          next[si] = { ...next[si], items };
                          setProductSets(next);
                        }}
                      />
                      <button
                        style={{ ...btnSmall, color: colors.coral, padding: '4px 8px' }}
                        onClick={() => {
                          const next = [...productSets];
                          next[si] = { ...next[si], items: next[si].items.filter((_, j) => j !== ii) };
                          setProductSets(next);
                        }}
                      >
                        &#10005;
                      </button>
                    </div>
                  ))}
                  <button
                    style={{ ...btnSmall, marginTop: 4 }}
                    onClick={() => {
                      const next = [...productSets];
                      next[si] = { ...next[si], items: [...next[si].items, { product: '', quantity: 1 }] };
                      setProductSets(next);
                    }}
                  >
                    + 항목 추가
                  </button>
                </div>
              ))}
              <button
                style={btnSmall}
                onClick={() => setProductSets([...productSets, { name: '', items: [{ product: '', quantity: 1 }] }])}
              >
                + 세트 추가
              </button>
            </div>

            {/* 동의서 기본 문구 */}
            <div style={sectionStyle}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>동의서 기본 문구</h2>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>개인정보 수집 동의 제목</label>
                <input style={inputStyle} value={privacyTitle} onChange={(e) => setPrivacyTitle(e.target.value)} />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>개인정보 수집 동의 본문</label>
                <textarea style={textareaStyle} value={privacyBody} onChange={(e) => setPrivacyBody(e.target.value)} />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>광고 표시 동의서 제목</label>
                <input style={inputStyle} value={adTitle} onChange={(e) => setAdTitle(e.target.value)} />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>광고 표시 동의서 본문</label>
                <textarea style={textareaStyle} value={adBody} onChange={(e) => setAdBody(e.target.value)} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>2차 활용 동의서 제목</label>
                <input style={inputStyle} value={secTitle} onChange={(e) => setSecTitle(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>2차 활용 동의서 본문</label>
                <textarea style={textareaStyle} value={secBody} onChange={(e) => setSecBody(e.target.value)} />
              </div>
            </div>

            {/* 진행 조건 안내 */}
            <div style={sectionStyle}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>진행 조건 안내</h2>
              <p style={{ fontSize: 12, color: colors.textMuted, marginBottom: 12 }}>
                동의서 페이지에 표시되는 진행 조건 목록입니다
              </p>
              {progressConditions.map((cond, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <input
                    style={{ ...inputStyle, flex: 1, padding: '6px 8px' }}
                    value={cond.text}
                    onChange={(e) => {
                      const next = [...progressConditions];
                      next[i] = { ...next[i], text: e.target.value };
                      setProgressConditions(next);
                    }}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: colors.textMuted, whiteSpace: 'nowrap', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={cond.paid_only}
                      onChange={(e) => {
                        const next = [...progressConditions];
                        next[i] = { ...next[i], paid_only: e.target.checked };
                        setProgressConditions(next);
                      }}
                    />
                    유가만
                  </label>
                  <button
                    style={{ ...btnSmall, color: colors.coral, padding: '4px 8px' }}
                    onClick={() => setProgressConditions(progressConditions.filter((_, j) => j !== i))}
                  >
                    &#10005;
                  </button>
                </div>
              ))}
              <button
                style={btnSmall}
                onClick={() => setProgressConditions([...progressConditions, { text: '', paid_only: false }])}
              >
                + 조건 추가
              </button>
            </div>

            {/* 회사 정보 (세금계산서/계산서 발행용) */}
            <div style={sectionStyle}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>회사 정보</h2>
              <p style={{ fontSize: 12, color: colors.textMuted, marginBottom: 12 }}>
                세금계산서/계산서 발행 시 인플루언서에게 안내되는 정보입니다
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>상호</label>
                  <input style={inputStyle} value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="예: 주식회사 희다" />
                </div>
                <div>
                  <label style={labelStyle}>사업자등록번호</label>
                  <input style={inputStyle} value={companyBizReg} onChange={(e) => setCompanyBizReg(e.target.value)} placeholder="000-00-00000" />
                </div>
                <div>
                  <label style={labelStyle}>대표자</label>
                  <input style={inputStyle} value={companyRepresentative} onChange={(e) => setCompanyRepresentative(e.target.value)} />
                </div>
                <div>
                  <label style={labelStyle}>주소</label>
                  <input style={inputStyle} value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} />
                </div>
                <div>
                  <label style={labelStyle}>업태</label>
                  <input style={inputStyle} value={companyBizType} onChange={(e) => setCompanyBizType(e.target.value)} />
                </div>
                <div>
                  <label style={labelStyle}>종목</label>
                  <input style={inputStyle} value={companyBizItem} onChange={(e) => setCompanyBizItem(e.target.value)} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>이메일</label>
                  <input style={inputStyle} value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} placeholder="세금계산서 수신 이메일" />
                </div>
              </div>
            </div>

            {/* 세율 */}
            <div style={sectionStyle}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>세율 기본값</h2>
              <div>
                <label style={labelStyle}>사업소득 원천징수율 (%)</label>
                <input
                  type="number"
                  step="0.1"
                  style={{ ...inputStyle, maxWidth: 200 }}
                  value={taxBusiness}
                  onChange={(e) => setTaxBusiness(parseFloat(e.target.value) || 0)}
                />
                <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>
                  세금계산서 / 계산서 / 간이과세자는 원천징수 없음 (0%)
                </p>
              </div>
              <div style={{ marginTop: 16 }}>
                <label style={labelStyle}>부가세율 (%)</label>
                <input
                  type="number"
                  step="1"
                  style={{ ...inputStyle, maxWidth: 200 }}
                  value={vatRate}
                  onChange={(e) => setVatRate(parseFloat(e.target.value) || 0)}
                />
                <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>
                  세금계산서 발행 시 적용 (기본 10%)
                </p>
              </div>
            </div>

            {/* 예산 */}
            <div style={sectionStyle}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>예산</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={labelStyle}>월 예산 (원)</label>
                  <input
                    type="number"
                    style={inputStyle}
                    value={monthlyBudget}
                    onChange={(e) => setMonthlyBudget(parseInt(e.target.value) || 0)}
                  />
                </div>
                <div>
                  <label style={labelStyle}>연간 예산 (원)</label>
                  <input
                    type="number"
                    style={inputStyle}
                    value={annualBudget}
                    onChange={(e) => setAnnualBudget(parseInt(e.target.value) || 0)}
                  />
                </div>
              </div>
            </div>

            {/* 정산 안내문 */}
            <div style={sectionStyle}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>정산 안내문</h2>
              <p style={{ fontSize: 12, color: colors.textMuted, marginBottom: 16 }}>
                정산 정보 제출 페이지 하단에 표시됩니다
              </p>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>입력 안내</label>
                <textarea
                  style={{ ...textareaStyle, minHeight: 120 }}
                  value={inputNotice}
                  onChange={(e) => setInputNotice(e.target.value)}
                />
              </div>
              <div>
                <label style={labelStyle}>정산 안내</label>
                <textarea
                  style={textareaStyle}
                  value={settlementNotice}
                  onChange={(e) => setSettlementNotice(e.target.value)}
                />
              </div>
            </div>

            {/* 접근 관리 */}
            <div style={{ ...sectionStyle, borderTop: `2px solid ${colors.border}`, marginTop: 32 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>접근 관리</h2>
              <p style={{ fontSize: 12, color: colors.textMuted, marginBottom: 16 }}>
                대시보드 로그인 비밀번호를 변경합니다
              </p>

              {pwStep === 'idle' && (
                <div>
                  <label style={labelStyle}>현재 비밀번호</label>
                  <input
                    type="password"
                    style={{ ...inputStyle, maxWidth: 320, marginBottom: 12 }}
                    value={pwCurrent}
                    onChange={(e) => setPwCurrent(e.target.value)}
                    placeholder="현재 비밀번호 입력"
                  />
                  {pwError && <p style={{ color: colors.coral, fontSize: 13, marginBottom: 8 }}>{pwError}</p>}
                  <div>
                    <button
                      disabled={pwLoading || !pwCurrent}
                      onClick={async () => {
                        setPwError('');
                        setPwLoading(true);
                        try {
                          // Verify current password
                          const vRes = await fetch('/api/auth/verify-password', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ password: pwCurrent }),
                          });
                          if (!vRes.ok) {
                            const d = await vRes.json();
                            setPwError(d.error ?? '현재 비밀번호가 올바르지 않습니다.');
                            return;
                          }
                          // Send code
                          const cRes = await fetch('/api/auth/send-code', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ purpose: 'password_change' }),
                          });
                          const cData = await cRes.json();
                          if (!cRes.ok) {
                            setPwError(cData.error);
                            return;
                          }
                          setPwMaskedEmail(cData.email);
                          setPwStep('code-sent');
                        } catch {
                          setPwError('오류가 발생했습니다.');
                        } finally {
                          setPwLoading(false);
                        }
                      }}
                      style={{
                        padding: '8px 20px',
                        background: colors.accentDark,
                        color: '#fff',
                        border: 'none',
                        borderRadius: 8,
                        fontSize: 13,
                        cursor: pwLoading ? 'not-allowed' : 'pointer',
                        opacity: pwLoading || !pwCurrent ? 0.5 : 1,
                      }}
                    >
                      {pwLoading ? '확인 중...' : '인증 코드 받기'}
                    </button>
                  </div>
                </div>
              )}

              {pwStep === 'code-sent' && (
                <div>
                  <p style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 16 }}>
                    <strong>{pwMaskedEmail}</strong>으로 인증 코드가 발송되었습니다.
                  </p>
                  <label style={labelStyle}>인증 코드</label>
                  <input
                    type="text"
                    style={{ ...inputStyle, maxWidth: 200, marginBottom: 12, letterSpacing: 4, textAlign: 'center', fontSize: 16 }}
                    value={pwCode}
                    onChange={(e) => setPwCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6자리"
                    maxLength={6}
                  />
                  <label style={labelStyle}>새 비밀번호</label>
                  <input
                    type="password"
                    style={{ ...inputStyle, maxWidth: 320, marginBottom: 12 }}
                    value={pwNew}
                    onChange={(e) => setPwNew(e.target.value)}
                    placeholder="8자 이상"
                  />
                  <label style={labelStyle}>새 비밀번호 확인</label>
                  <input
                    type="password"
                    style={{ ...inputStyle, maxWidth: 320, marginBottom: 12 }}
                    value={pwConfirm}
                    onChange={(e) => setPwConfirm(e.target.value)}
                    placeholder="다시 입력"
                  />
                  {pwError && <p style={{ color: colors.coral, fontSize: 13, marginBottom: 8 }}>{pwError}</p>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      disabled={pwLoading || !pwCode || !pwNew || !pwConfirm}
                      onClick={async () => {
                        setPwError('');
                        if (pwNew !== pwConfirm) {
                          setPwError('새 비밀번호가 일치하지 않습니다.');
                          return;
                        }
                        if (pwNew.length < 8) {
                          setPwError('비밀번호는 8자 이상이어야 합니다.');
                          return;
                        }
                        setPwLoading(true);
                        try {
                          const res = await fetch('/api/auth/change-password', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ code: pwCode, newPassword: pwNew }),
                          });
                          const data = await res.json();
                          if (!res.ok) {
                            setPwError(data.error);
                            return;
                          }
                          setPwStep('done');
                          setPwSuccess('비밀번호가 변경되었습니다.');
                          setPwCurrent('');
                          setPwCode('');
                          setPwNew('');
                          setPwConfirm('');
                          setTimeout(() => { setPwStep('idle'); setPwSuccess(''); }, 3000);
                        } catch {
                          setPwError('오류가 발생했습니다.');
                        } finally {
                          setPwLoading(false);
                        }
                      }}
                      style={{
                        padding: '8px 20px',
                        background: colors.accentDark,
                        color: '#fff',
                        border: 'none',
                        borderRadius: 8,
                        fontSize: 13,
                        cursor: 'pointer',
                        opacity: pwLoading ? 0.5 : 1,
                      }}
                    >
                      {pwLoading ? '변경 중...' : '비밀번호 변경'}
                    </button>
                    <button
                      onClick={() => { setPwStep('idle'); setPwError(''); setPwCode(''); setPwNew(''); setPwConfirm(''); }}
                      style={{ ...btnSmall, fontSize: 13 }}
                    >
                      취소
                    </button>
                  </div>
                </div>
              )}

              {pwStep === 'done' && pwSuccess && (
                <p style={{ color: colors.mint, fontSize: 14, fontWeight: 500 }}>{pwSuccess}</p>
              )}
            </div>
          </>
        )}

        {/* 무결성 점검 */}
        <div style={{ ...sectionStyle, borderTop: `2px solid ${colors.border}`, marginTop: 32 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>데이터 무결성 점검</h2>
          <p style={{ fontSize: 12, color: colors.textMuted, marginBottom: 16 }}>
            정산·예산 데이터의 정합성을 검사합니다. 발견된 이슈는 표시만 하며 자동 수정하지 않습니다.
          </p>
          <button
            style={{
              padding: '8px 20px',
              background: colors.textPrimary,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              cursor: 'pointer',
              opacity: integrityLoading ? 0.5 : 1,
            }}
            disabled={integrityLoading}
            onClick={async () => {
              setIntegrityLoading(true);
              try {
                const res = await fetch('/api/influencer/integrity');
                const data = await res.json();
                setIntegrityResult(data);
              } catch {
                setMessage('점검 실행에 실패했습니다.');
              } finally {
                setIntegrityLoading(false);
              }
            }}
          >
            {integrityLoading ? '점검 중...' : '점검 실행'}
          </button>

          {integrityResult && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 8 }}>
                점검 시각: {new Date(integrityResult.checked_at).toLocaleString('ko-KR')}
                {' · '}
                {integrityResult.total_issues === 0
                  ? <span style={{ color: colors.mint, fontWeight: 600 }}>이상 없음</span>
                  : <span style={{ color: '#D9534F', fontWeight: 600 }}>{integrityResult.total_issues}건 발견</span>
                }
              </div>
              {integrityResult.checks.map((check, i) => (
                <div key={i} style={{
                  border: `1px solid ${check.severity === 'error' ? '#FECACA' : '#FEF3C7'}`,
                  background: check.severity === 'error' ? '#FEF2F2' : '#FFFBEB',
                  borderRadius: 8,
                  padding: '12px 16px',
                  marginBottom: 8,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: check.severity === 'error' ? '#DC2626' : '#D97706', marginBottom: 4 }}>
                    {check.severity === 'error' ? '[오류]' : '[경고]'} {check.description}
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: colors.textSecondary }}>
                    {check.items.slice(0, 5).map((item, j) => (
                      <li key={j} style={{ marginBottom: 2 }}>{item.detail}</li>
                    ))}
                    {check.items.length > 5 && (
                      <li style={{ color: colors.textMuted }}>외 {check.items.length - 5}건</li>
                    )}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
