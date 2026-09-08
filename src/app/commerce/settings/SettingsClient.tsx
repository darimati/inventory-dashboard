'use client';

import { useState } from 'react';
import AppShell from '@/components/AppShell';
import { formatNumber } from '@/lib/helpers';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Promotion {
  id: string;
  name: string;
  product: string | null;
  start_date: string;
  end_date: string;
  discount_rate: number;
  memo: string | null;
  is_active: boolean;
  created_at: string;
}

interface SyncLog {
  id: string;
  trigger_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  fetched_count: number | null;
  inserted_count: number | null;
  error_message: string | null;
}

interface InventoryThresholds {
  transferSafetyDays: number;
  transferTargetDays: number;
  orderTargetDays: number;
  transferLeadTime: number;
  productionLeadTime: number;
}

interface ProductNotice {
  type: string;
  message: string;
  resumeDate?: string;
}

interface SkuEntry {
  productCode: string;
  productName: string;
  product: string;
  option: string;
  stockType: 'finished' | 'submaterial';
  variantType: 'domestic' | 'japan' | 'export';
  note: string;
}

interface Props {
  promotions: Promotion[];
  syncLogs: SyncLog[];
  leadTimes: { production: number; transfer: number };
  inventoryThresholds: InventoryThresholds | null;
  productNotices: Record<string, ProductNotice>;
  skuClassifications: Record<string, SkuEntry>;
  primarySkus: Record<string, string>;
}

const PRODUCTS = ['클렌징밤', '클렌징폼', '세럼'];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function todayKST(): string {
  const kst = new Date(Date.now() + 9 * 3_600_000);
  return kst.toISOString().slice(0, 10);
}

function isActive(p: Promotion): boolean {
  const today = todayKST();
  return p.is_active && p.start_date <= today && p.end_date >= today;
}

function isUpcoming(p: Promotion): boolean {
  const today = todayKST();
  return p.is_active && p.start_date > today;
}

function isPast(p: Promotion): boolean {
  const today = todayKST();
  return p.end_date < today;
}

function statusBadge(p: Promotion): { text: string; color: string; bg: string } {
  if (!p.is_active) return { text: '비활성', color: '#9AA2AA', bg: '#F2F4F7' };
  if (isActive(p)) return { text: '진행 중', color: '#1A7F37', bg: '#DAFBE1' };
  if (isUpcoming(p)) return { text: '예정', color: '#0969DA', bg: '#DDF4FF' };
  return { text: '종료', color: '#9AA2AA', bg: '#F2F4F7' };
}

function formatDateKR(d: string): string {
  const parts = d.split('-');
  return `${parts[1]}/${parts[2]}`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function SettingsClient({ promotions: initialPromos, syncLogs, leadTimes: initialLT, inventoryThresholds: initialIT, productNotices: initialNotices, skuClassifications: initialSkuClass, primarySkus: initialPrimarySkus }: Props) {
  const [promos, setPromos] = useState<Promotion[]>(initialPromos);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Lead time state
  const [ltProduction, setLtProduction] = useState(String(initialLT.production));
  const [ltTransfer, setLtTransfer] = useState(String(initialLT.transfer));
  const [ltSaving, setLtSaving] = useState(false);
  const [ltSaved, setLtSaved] = useState(false);

  // Inventory threshold state
  const [itTransferSafety, setItTransferSafety] = useState(String(initialIT?.transferSafetyDays ?? 10));
  const [itTransferTarget, setItTransferTarget] = useState(String(initialIT?.transferTargetDays ?? 30));
  const [itOrderTarget, setItOrderTarget] = useState(String(initialIT?.orderTargetDays ?? 90));
  const [itTransferLead, setItTransferLead] = useState(String(initialIT?.transferLeadTime ?? initialLT.transfer));
  const [itProductionLead, setItProductionLead] = useState(String(initialIT?.productionLeadTime ?? initialLT.production));
  const [itSaving, setItSaving] = useState(false);
  const [itSaved, setItSaved] = useState(false);

  // Product notices state
  const [pnEntries, setPnEntries] = useState<{ product: string; message: string; resumeDate: string }[]>(() => {
    return PRODUCTS.map(p => ({
      product: p,
      message: initialNotices[p]?.message ?? '',
      resumeDate: initialNotices[p]?.resumeDate ?? '',
    }));
  });
  const [pnSaving, setPnSaving] = useState(false);
  const [pnSaved, setPnSaved] = useState(false);

  // SKU classification state
  const DEFAULT_SKUS: SkuEntry[] = [
    { productCode: '17828', productName: '클렌징밤 100ml', product: '클렌징밤', option: '국내용', stockType: 'finished', variantType: 'domestic', note: '' },
    { productCode: '18396', productName: '클렌징밤 100ml (수출용)', product: '클렌징밤', option: '수출용', stockType: 'finished', variantType: 'export', note: '' },
    { productCode: '19295', productName: '클렌징밤 100ml (수출용) [스티커작업]', product: '클렌징밤', option: '수출용 [스티커작업]', stockType: 'submaterial', variantType: 'export', note: '작업 대기' },
    { productCode: '18279', productName: '클렌징폼 150ml', product: '클렌징폼', option: '국내용', stockType: 'finished', variantType: 'domestic', note: '라벨 미부착' },
    { productCode: '19309', productName: '클렌징폼 150ml (스티커)', product: '클렌징폼', option: '일본향', stockType: 'finished', variantType: 'japan', note: '일본어 덧방라벨 부착 완료' },
    { productCode: '18280', productName: '클렌징폼 150ml (수출용)', product: '클렌징폼', option: '수출용', stockType: 'finished', variantType: 'export', note: '' },
    { productCode: '18262', productName: '클렌징폼 150ml - 튜브용기/캡', product: '클렌징폼', option: '튜브용기/캡', stockType: 'submaterial', variantType: 'domestic', note: '' },
    { productCode: '18918', productName: '세럼 30ml', product: '세럼', option: '국내용', stockType: 'finished', variantType: 'domestic', note: '' },
    { productCode: '18919', productName: '세럼 30ml (수출용)', product: '세럼', option: '수출용', stockType: 'finished', variantType: 'export', note: '' },
    { productCode: '19294', productName: '세럼 30ml (수출용) [스티커작업]', product: '세럼', option: '수출용 [스티커작업]', stockType: 'submaterial', variantType: 'export', note: '작업 대기' },
  ];
  const [skuEntries, setSkuEntries] = useState<SkuEntry[]>(() => {
    return DEFAULT_SKUS.map(d => {
      const saved = initialSkuClass[d.productCode];
      return saved ? { ...d, ...saved } : d;
    });
  });
  const [skuSaving, setSkuSaving] = useState(false);
  const [skuSaved, setSkuSaved] = useState(false);

  // Primary SKU state
  const PRIMARY_SKU_OPTIONS: Record<string, { code: string; label: string }[]> = {
    '클렌징밤': [
      { code: '18396', label: '18396 · 수출용' },
      { code: '17828', label: '17828 · 국내용' },
    ],
    '클렌징폼': [
      { code: '18279', label: '18279 · 국내용' },
      { code: '18280', label: '18280 · 수출용' },
    ],
    '세럼': [
      { code: '18919', label: '18919 · 수출용' },
      { code: '18918', label: '18918 · 국내용' },
    ],
  };
  const [pSkuBalm, setPSkuBalm] = useState(initialPrimarySkus['클렌징밤'] ?? '18396');
  const [pSkuFoam, setPSkuFoam] = useState(initialPrimarySkus['클렌징폼'] ?? '18279');
  const [pSkuSerum, setPSkuSerum] = useState(initialPrimarySkus['세럼'] ?? '18919');
  const [pSkuSaving, setPSkuSaving] = useState(false);
  const [pSkuSaved, setPSkuSaved] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formProduct, setFormProduct] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formRate, setFormRate] = useState('');
  const [formMemo, setFormMemo] = useState('');

  const resetForm = () => {
    setFormName('');
    setFormProduct('');
    setFormStartDate('');
    setFormEndDate('');
    setFormRate('');
    setFormMemo('');
    setEditId(null);
    setShowForm(false);
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (p: Promotion) => {
    setFormName(p.name);
    setFormProduct(p.product || '');
    setFormStartDate(p.start_date);
    setFormEndDate(p.end_date);
    setFormRate(String(p.discount_rate));
    setFormMemo(p.memo || '');
    setEditId(p.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formName || !formStartDate || !formEndDate || !formRate) return;
    setSaving(true);

    const payload = {
      name: formName,
      product: formProduct || null,
      start_date: formStartDate,
      end_date: formEndDate,
      discount_rate: parseFloat(formRate),
      memo: formMemo || null,
    };

    try {
      if (editId) {
        const res = await fetch('/api/promotions', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editId, ...payload }),
        });
        const updated = await res.json();
        if (res.ok) {
          setPromos((prev) => prev.map((p) => (p.id === editId ? updated : p)));
        }
      } else {
        const res = await fetch('/api/promotions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const created = await res.json();
        if (res.ok) {
          setPromos((prev) => [created, ...prev]);
        }
      }
      resetForm();
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (p: Promotion) => {
    const res = await fetch('/api/promotions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, is_active: !p.is_active }),
    });
    const updated = await res.json();
    if (res.ok) {
      setPromos((prev) => prev.map((x) => (x.id === p.id ? updated : x)));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 프로모션을 삭제하시겠습니까?')) return;
    const res = await fetch(`/api/promotions?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      setPromos((prev) => prev.filter((p) => p.id !== id));
    }
  };

  // Separate active/upcoming from past
  const activeOrUpcoming = promos.filter((p) => !isPast(p) || isActive(p));
  const past = promos.filter((p) => isPast(p) && !isActive(p));

  return (
    <AppShell showFilter={false}>
      <div className="page-header">
        <h1 className="page-title">설정</h1>
      </div>

      {/* Promotions Section */}
      <div className="section">
        <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span className="section-title">쿠폰 · 프로모션 관리</span>
            <span className="text-sm text-muted" style={{ marginLeft: 8 }}>할인 기간과 예상 공제율을 등록합니다</span>
          </div>
          <button
            onClick={openCreate}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 500,
              background: '#1F2328',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            + 등록
          </button>
        </div>

        <div className="section-body">
          {/* Create / Edit Form */}
          {showForm && (
            <div style={{
              padding: 16,
              borderBottom: '1px solid var(--border-light)',
              background: '#FAFBFC',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>프로모션명 *</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="예: 가을 쿠폰 행사"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>대상 상품</label>
                  <select
                    value={formProduct}
                    onChange={(e) => setFormProduct(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">전체 상품</option>
                    {PRODUCTS.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>시작일 *</label>
                  <input
                    type="date"
                    value={formStartDate}
                    onChange={(e) => setFormStartDate(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>종료일 *</label>
                  <input
                    type="date"
                    value={formEndDate}
                    onChange={(e) => setFormEndDate(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>할인율 (%) *</label>
                  <input
                    type="number"
                    value={formRate}
                    onChange={(e) => setFormRate(e.target.value)}
                    placeholder="20"
                    min="0"
                    max="100"
                    step="0.1"
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>메모</label>
                <input
                  type="text"
                  value={formMemo}
                  onChange={(e) => setFormMemo(e.target.value)}
                  placeholder="프로모션 관련 참고사항"
                  style={inputStyle}
                />
              </div>

              {/* Estimated deduction preview */}
              {formRate && parseFloat(formRate) > 0 && (
                <div style={{
                  fontSize: 12,
                  color: '#61686F',
                  padding: '8px 12px',
                  background: '#F2F4F7',
                  borderRadius: 6,
                  marginBottom: 12,
                }}>
                  예상 공제: 정가 대비 약 <strong style={{ color: '#D9534F' }}>{formRate}%</strong> 할인
                  {formProduct ? ` (${formProduct})` : ' (전체 상품)'}
                  {formStartDate && formEndDate && (
                    <span> · {formatDateKR(formStartDate)} ~ {formatDateKR(formEndDate)}</span>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={resetForm} style={cancelBtnStyle}>취소</button>
                <button
                  onClick={handleSave}
                  disabled={saving || !formName || !formStartDate || !formEndDate || !formRate}
                  style={{
                    ...saveBtnStyle,
                    opacity: saving || !formName || !formStartDate || !formEndDate || !formRate ? 0.5 : 1,
                  }}
                >
                  {saving ? '저장 중...' : editId ? '수정' : '등록'}
                </button>
              </div>
            </div>
          )}

          {/* Active / Upcoming List */}
          {activeOrUpcoming.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>프로모션</th>
                  <th>대상</th>
                  <th className="right">할인율</th>
                  <th>기간</th>
                  <th className="right">상태</th>
                  <th className="right" style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {activeOrUpcoming.map((p) => {
                  const badge = statusBadge(p);
                  return (
                    <tr key={p.id}>
                      <td>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>{p.name}</div>
                        {p.memo && (
                          <div style={{ fontSize: 11, color: '#9AA2AA', marginTop: 1 }}>{p.memo}</div>
                        )}
                      </td>
                      <td style={{ fontSize: 13 }}>{p.product || '전체'}</td>
                      <td className="right font-mono" style={{ fontSize: 13, color: '#D9534F' }}>
                        {p.discount_rate}%
                      </td>
                      <td style={{ fontSize: 12, color: '#61686F', whiteSpace: 'nowrap' }}>
                        {formatDateKR(p.start_date)} ~ {formatDateKR(p.end_date)}
                      </td>
                      <td className="right">
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 10,
                          fontSize: 11,
                          fontWeight: 500,
                          color: badge.color,
                          background: badge.bg,
                        }}>
                          {badge.text}
                        </span>
                      </td>
                      <td className="right">
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          <button onClick={() => openEdit(p)} style={actionBtnStyle} title="수정">
                            수정
                          </button>
                          <button onClick={() => handleToggle(p)} style={actionBtnStyle} title={p.is_active ? '비활성화' : '활성화'}>
                            {p.is_active ? '끄기' : '켜기'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : !showForm ? (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
              등록된 프로모션이 없습니다.
            </div>
          ) : null}

          {/* Past Promotions (collapsed) */}
          {past.length > 0 && (
            <details style={{ borderTop: '1px solid var(--border-light)' }}>
              <summary style={{
                padding: '10px 16px',
                fontSize: 12,
                color: '#9AA2AA',
                cursor: 'pointer',
                userSelect: 'none',
              }}>
                지난 프로모션 ({past.length}건)
              </summary>
              <table className="data-table">
                <tbody>
                  {past.map((p) => (
                    <tr key={p.id} style={{ opacity: 0.6 }}>
                      <td style={{ fontSize: 13 }}>{p.name}</td>
                      <td style={{ fontSize: 13 }}>{p.product || '전체'}</td>
                      <td className="right font-mono" style={{ fontSize: 13 }}>{p.discount_rate}%</td>
                      <td style={{ fontSize: 12, color: '#9AA2AA' }}>
                        {formatDateKR(p.start_date)} ~ {formatDateKR(p.end_date)}
                      </td>
                      <td className="right">
                        <button onClick={() => handleDelete(p.id)} style={{ ...actionBtnStyle, color: '#D9534F' }}>
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      </div>

      {/* EZAdmin CSV Upload */}
      <EzadminUploadSection />

      {/* Lead Time Settings */}
      <div className="section" style={{ marginTop: 16 }}>
        <div className="section-header">
          <span className="section-title">리드타임 설정</span>
          <span className="text-sm text-muted" style={{ marginLeft: 8 }}>발주 시 예상 입고일 자동 계산에 사용됩니다</span>
        </div>
        <div className="section-body" style={{ padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 400 }}>
            <div>
              <label style={labelStyle}>공장 발주 리드타임 (일)</label>
              <input
                type="number"
                value={ltProduction}
                onChange={e => { setLtProduction(e.target.value); setLtSaved(false); }}
                min="1"
                max="120"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>3PL → 그로스 리드타임 (일)</label>
              <input
                type="number"
                value={ltTransfer}
                onChange={e => { setLtTransfer(e.target.value); setLtSaved(false); }}
                min="1"
                max="60"
                style={inputStyle}
              />
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={async () => {
                const prod = parseInt(ltProduction) || 14;
                const trans = parseInt(ltTransfer) || 7;
                setLtSaving(true);
                try {
                  await fetch('/api/commerce/settings', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      key: 'commerce:lead_times',
                      value: { production: prod, transfer: trans },
                    }),
                  });
                  setLtSaved(true);
                  setTimeout(() => setLtSaved(false), 3000);
                } catch {
                  // silent
                } finally {
                  setLtSaving(false);
                }
              }}
              disabled={ltSaving}
              style={{ ...saveBtnStyle, opacity: ltSaving ? 0.5 : 1 }}
            >
              {ltSaving ? '저장 중...' : '저장'}
            </button>
            {ltSaved && <span style={{ fontSize: 12, color: '#1A7F37' }}>저장됨</span>}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: '#9AA2AA' }}>
            안전재고 = 리드타임 + 버퍼(7일). 현재: 공장 {ltProduction || 14}일 + 7일 = {(parseInt(ltProduction) || 14) + 7}일
          </div>
        </div>
      </div>

      {/* Inventory Threshold Settings */}
      <div className="section" style={{ marginTop: 16 }}>
        <div className="section-header">
          <span className="section-title">재고 임계값 설정</span>
          <span className="text-sm text-muted" style={{ marginLeft: 8 }}>이관·발주 판단 기준과 권장 수량 계산에 사용됩니다</span>
        </div>
        <div className="section-body" style={{ padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, maxWidth: 600 }}>
            <div>
              <label style={labelStyle}>이관 안전선 (일)</label>
              <input type="number" value={itTransferSafety}
                onChange={e => { setItTransferSafety(e.target.value); setItSaved(false); }}
                min="1" max="60" style={inputStyle} />
              <div style={{ fontSize: 10, color: '#9AA2AA', marginTop: 2 }}>로켓그로스 재고가 이 일수 미만이면 이관 필요</div>
            </div>
            <div>
              <label style={labelStyle}>이관 목표 일수 (일)</label>
              <input type="number" value={itTransferTarget}
                onChange={e => { setItTransferTarget(e.target.value); setItSaved(false); }}
                min="7" max="120" style={inputStyle} />
              <div style={{ fontSize: 10, color: '#9AA2AA', marginTop: 2 }}>이관 권장 = 목표일치 − 로켓그로스</div>
            </div>
            <div>
              <label style={labelStyle}>발주 목표 일수 (일)</label>
              <input type="number" value={itOrderTarget}
                onChange={e => { setItOrderTarget(e.target.value); setItSaved(false); }}
                min="30" max="365" style={inputStyle} />
              <div style={{ fontSize: 10, color: '#9AA2AA', marginTop: 2 }}>발주 권장 = 목표일치 − 가용 재고</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, maxWidth: 400, marginTop: 12 }}>
            <div>
              <label style={labelStyle}>이관 리드타임 (일)</label>
              <input type="number" value={itTransferLead}
                onChange={e => { setItTransferLead(e.target.value); setItSaved(false); }}
                min="1" max="30" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>생산 리드타임 (일)</label>
              <input type="number" value={itProductionLead}
                onChange={e => { setItProductionLead(e.target.value); setItSaved(false); }}
                min="1" max="120" style={inputStyle} />
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={async () => {
                setItSaving(true);
                try {
                  await fetch('/api/commerce/settings', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      key: 'commerce:inventory_thresholds',
                      value: {
                        transferSafetyDays: parseInt(itTransferSafety) || 10,
                        transferTargetDays: parseInt(itTransferTarget) || 30,
                        orderTargetDays: parseInt(itOrderTarget) || 90,
                        transferLeadTime: parseInt(itTransferLead) || 7,
                        productionLeadTime: parseInt(itProductionLead) || 14,
                      },
                    }),
                  });
                  setItSaved(true);
                  setTimeout(() => setItSaved(false), 3000);
                } catch {
                  // silent
                } finally {
                  setItSaving(false);
                }
              }}
              disabled={itSaving}
              style={{ ...saveBtnStyle, opacity: itSaving ? 0.5 : 1 }}
            >
              {itSaving ? '저장 중...' : '저장'}
            </button>
            {itSaved && <span style={{ fontSize: 12, color: '#1A7F37' }}>저장됨</span>}
          </div>
        </div>
      </div>

      {/* Sync History Section */}
      <div className="section" style={{ marginTop: 16 }}>
        <div className="section-header">
          <span className="section-title">동기화 이력</span>
          <span className="text-sm text-muted" style={{ marginLeft: 8 }}>최근 20건</span>
        </div>
        <div className="section-body">
          {syncLogs.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>시각</th>
                  <th>트리거</th>
                  <th className="right">소요 시간</th>
                  <th className="right">반영 건수</th>
                  <th className="right">상태</th>
                </tr>
              </thead>
              <tbody>
                {syncLogs.map((log) => {
                  const startedAt = new Date(log.started_at);
                  const finishedAt = log.finished_at ? new Date(log.finished_at) : null;
                  const durationSec = finishedAt
                    ? Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000)
                    : null;
                  const statusStyle = log.status === 'success'
                    ? { color: '#1A7F37', bg: '#DAFBE1' }
                    : log.status === 'error'
                    ? { color: '#D9534F', bg: '#FCEFEF' }
                    : { color: '#9A6700', bg: '#FFF8C5' };

                  return (
                    <tr key={log.id}>
                      <td style={{ fontSize: 12, color: '#61686F', whiteSpace: 'nowrap' }}>
                        {startedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {log.trigger_type === 'cron' ? '자동' : '수동'}
                      </td>
                      <td className="right font-mono" style={{ fontSize: 12, color: '#61686F' }}>
                        {durationSec !== null ? `${durationSec}초` : '-'}
                      </td>
                      <td className="right font-mono" style={{ fontSize: 12 }}>
                        {log.inserted_count ?? '-'}
                      </td>
                      <td className="right">
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 10,
                          fontSize: 11,
                          fontWeight: 500,
                          color: statusStyle.color,
                          background: statusStyle.bg,
                        }}>
                          {log.status === 'success' ? '성공' : log.status === 'error' ? '실패' : '실행 중'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              동기화 이력이 없습니다.
            </div>
          )}
          <div style={{ padding: '8px 16px', fontSize: 11, color: '#9AA2AA', borderTop: '1px solid var(--border-light)' }}>
            쿠팡 API 반영에 수분~수십분이 소요될 수 있습니다. 자동 동기화: 매일 KST 00:30
          </div>
        </div>
      </div>

      {/* Product Notices */}
      <div className="section" style={{ marginTop: 16 }}>
        <div className="section-header">
          <span className="section-title">제품 알림</span>
          <span className="text-sm text-muted" style={{ marginLeft: 8 }}>재고 카드에 표시될 제품별 안내 문구</span>
        </div>
        <div className="section-body" style={{ padding: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {pnEntries.map((entry, idx) => (
              <div key={entry.product} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 140px', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#1A1D21' }}>{entry.product}</span>
                <input type="text" value={entry.message}
                  onChange={e => { const next = [...pnEntries]; next[idx].message = e.target.value; setPnEntries(next); setPnSaved(false); }}
                  placeholder="예: 단품 판매 중단 중"
                  style={{ padding: '6px 10px', fontSize: 13, border: '1px solid var(--border-light)', borderRadius: 6, outline: 'none' }} />
                <input type="date" value={entry.resumeDate}
                  onChange={e => { const next = [...pnEntries]; next[idx].resumeDate = e.target.value; setPnEntries(next); setPnSaved(false); }}
                  style={{ padding: '6px 10px', fontSize: 13, border: '1px solid var(--border-light)', borderRadius: 6, outline: 'none' }} />
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#9AA2AA', marginTop: 8 }}>
            안내 문구가 비어있으면 해당 제품에 알림이 표시되지 않습니다. 날짜는 재개 예정일입니다.
          </div>
          <div style={{ marginTop: 12 }}>
            <button onClick={async () => {
              setPnSaving(true);
              const notices: Record<string, ProductNotice> = {};
              for (const entry of pnEntries) {
                if (entry.message.trim()) {
                  notices[entry.product] = {
                    type: 'sale_suspended',
                    message: entry.message.trim(),
                    ...(entry.resumeDate ? { resumeDate: entry.resumeDate } : {}),
                  };
                }
              }
              try {
                await fetch('/api/commerce/settings', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ key: 'commerce:product_notices', value: notices }),
                });
                setPnSaved(true);
              } catch { /* */ }
              finally { setPnSaving(false); }
            }}
            disabled={pnSaving}
            style={{
              padding: '6px 14px', fontSize: 13, fontWeight: 500, borderRadius: 6, cursor: 'pointer',
              background: pnSaved ? '#DAFBE1' : '#1F2328', color: pnSaved ? '#1A7F37' : '#fff',
              border: 'none', opacity: pnSaving ? 0.5 : 1,
            }}>
              {pnSaving ? '저장 중...' : pnSaved ? '저장됨' : '저장'}
            </button>
          </div>
        </div>
      </div>

      {/* SKU Classification */}
      <div className="section" style={{ marginTop: 16 }}>
        <div className="section-header">
          <span className="section-title">품목 분류</span>
          <span className="text-sm text-muted" style={{ marginLeft: 8 }}>이지어드민 SKU별 유형·용도를 지정합니다 · 가용 재고 계산에 반영</span>
        </div>
        <div className="section-body">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>상품코드</th>
                <th>상품명</th>
                <th style={{ width: 90 }}>유형</th>
                <th style={{ width: 100 }}>용도</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {skuEntries.map((sku, idx) => (
                <tr key={sku.productCode}>
                  <td style={{ fontSize: 12, fontFamily: 'monospace', color: '#61686F' }}>{sku.productCode}</td>
                  <td style={{ fontSize: 13 }}>
                    <span style={{ fontWeight: 500 }}>{sku.product}</span>
                    <span style={{ color: '#61686F' }}> · {sku.option}</span>
                  </td>
                  <td>
                    <select
                      value={sku.stockType}
                      onChange={e => {
                        const next = [...skuEntries];
                        next[idx] = { ...next[idx], stockType: e.target.value as 'finished' | 'submaterial' };
                        setSkuEntries(next);
                        setSkuSaved(false);
                      }}
                      style={{ ...selectStyle, color: sku.stockType === 'submaterial' ? '#9A6700' : '#1A1D21' }}
                    >
                      <option value="finished">완제품</option>
                      <option value="submaterial">부자재</option>
                    </select>
                  </td>
                  <td>
                    <select
                      value={sku.variantType}
                      onChange={e => {
                        const next = [...skuEntries];
                        next[idx] = { ...next[idx], variantType: e.target.value as 'domestic' | 'japan' | 'export' };
                        setSkuEntries(next);
                        setSkuSaved(false);
                      }}
                      style={{ ...selectStyle, color: sku.variantType === 'japan' ? '#0969DA' : sku.variantType === 'export' ? '#8250DF' : '#1A1D21' }}
                    >
                      <option value="domestic">국내용</option>
                      <option value="japan">일본향</option>
                      <option value="export">수출용</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="text"
                      value={sku.note}
                      onChange={e => {
                        const next = [...skuEntries];
                        next[idx] = { ...next[idx], note: e.target.value };
                        setSkuEntries(next);
                        setSkuSaved(false);
                      }}
                      placeholder="—"
                      style={{ padding: '4px 8px', fontSize: 12, border: '1px solid var(--border-light)', borderRadius: 4, outline: 'none', width: '100%', boxSizing: 'border-box' }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--border-light)' }}>
            <button
              onClick={async () => {
                setSkuSaving(true);
                const classifications: Record<string, SkuEntry> = {};
                for (const sku of skuEntries) {
                  classifications[sku.productCode] = sku;
                }
                try {
                  await fetch('/api/commerce/settings', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: 'commerce:sku_classifications', value: classifications }),
                  });
                  setSkuSaved(true);
                  setTimeout(() => setSkuSaved(false), 3000);
                } catch { /* */ }
                finally { setSkuSaving(false); }
              }}
              disabled={skuSaving}
              style={{ ...saveBtnStyle, opacity: skuSaving ? 0.5 : 1 }}
            >
              {skuSaving ? '저장 중...' : '저장'}
            </button>
            {skuSaved && <span style={{ fontSize: 12, color: '#1A7F37' }}>저장됨</span>}
          </div>
          <div style={{ padding: '0 16px 12px', fontSize: 11, color: '#9AA2AA' }}>
            가용 재고 = 로켓그로스 + 3PL 국내용(완제품) + 이관 중 + 입고 예정 · 일본향·수출용·부자재는 제외
          </div>
        </div>
      </div>

      {/* Primary SKU */}
      <div className="section" style={{ marginTop: 16 }}>
        <div className="section-header">
          <span className="text-sm font-semibold">주 재고 SKU</span>
          <span className="text-sm text-muted" style={{ marginLeft: 8 }}>재고 카드에서 국내 3PL 메인 수량으로 표시할 SKU</span>
        </div>
        <div className="section-body" style={{ padding: '12px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {PRODUCTS.map(product => {
              const options = PRIMARY_SKU_OPTIONS[product] ?? [];
              const value = product === '클렌징밤' ? pSkuBalm : product === '클렌징폼' ? pSkuFoam : pSkuSerum;
              const setter = product === '클렌징밤' ? setPSkuBalm : product === '클렌징폼' ? setPSkuFoam : setPSkuSerum;
              return (
                <div key={product}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#61686F', marginBottom: 4 }}>{product}</label>
                  <select
                    value={value}
                    onChange={e => { setter(e.target.value); setPSkuSaved(false); }}
                    style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid var(--border-light)', borderRadius: 6, background: '#fff' }}
                  >
                    {options.map(opt => (
                      <option key={opt.code} value={opt.code}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={async () => {
                setPSkuSaving(true);
                const value = { '클렌징밤': pSkuBalm, '클렌징폼': pSkuFoam, '세럼': pSkuSerum };
                try {
                  await fetch('/api/commerce/settings', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: 'commerce:primary_skus', value }),
                  });
                  setPSkuSaved(true);
                  setTimeout(() => setPSkuSaved(false), 3000);
                } catch { /* */ }
                finally { setPSkuSaving(false); }
              }}
              disabled={pSkuSaving}
              style={{ ...saveBtnStyle, opacity: pSkuSaving ? 0.5 : 1 }}
            >
              {pSkuSaving ? '저장 중...' : '저장'}
            </button>
            {pSkuSaved && <span style={{ fontSize: 12, color: '#1A7F37' }}>저장됨</span>}
          </div>
          <div style={{ fontSize: 11, color: '#9AA2AA', marginTop: 8 }}>
            재고 카드 국내 3PL에 주 SKU 수량이 메인 표시, 나머지는 &ldquo;기타 N개&rdquo;로 표시
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */
/*  EZAdmin CSV Upload Section                                         */
/* ------------------------------------------------------------------ */

function EzadminUploadSection() {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/ezadmin/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        setResult({
          ok: true,
          message: `업로드 완료 · ${data.upserted}건 반영${data.parse_errors?.length ? ` · ${data.parse_errors.length}건 오류` : ''}`,
        });
      } else {
        setResult({ ok: false, message: data.error || '업로드 실패' });
      }
    } catch {
      setResult({ ok: false, message: '네트워크 오류' });
    } finally {
      setUploading(false);
      // Reset file input
      e.target.value = '';
    }
  };

  return (
    <div className="section" style={{ marginTop: 16 }}>
      <div className="section-header">
        <span className="section-title">이지어드민 재고 업로드</span>
        <span className="text-sm text-muted" style={{ marginLeft: 8 }}>CSV 파일로 국내 3PL 재고를 갱신합니다</span>
      </div>
      <div className="section-body" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', fontSize: 13, fontWeight: 500,
            background: '#1F2328', color: '#fff', border: 'none', borderRadius: 6,
            cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? 0.5 : 1,
          }}>
            <input
              type="file"
              accept=".csv,.tsv,.txt,.xls,.xlsx"
              onChange={handleUpload}
              disabled={uploading}
              style={{ display: 'none' }}
            />
            {uploading ? '업로드 중...' : '파일 선택'}
          </label>
          {result && (
            <span style={{ fontSize: 12, color: result.ok ? '#1A7F37' : '#D9534F' }}>
              {result.message}
            </span>
          )}
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: '#9AA2AA' }}>
          필수 컬럼: 상품코드, 상품명, 정상재고 · 선택: 판매가능재고, 불량재고, 배송, 입고예정
        </div>
        <div style={{ marginTop: 4, fontSize: 11, color: '#9AA2AA' }}>
          이지어드민 &gt; 재고관리 &gt; 재고현황에서 XLS 또는 CSV를 다운로드하세요
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 500,
  color: '#61686F',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  fontSize: 13,
  border: '1px solid var(--border-light)',
  borderRadius: 6,
  background: '#fff',
  outline: 'none',
  boxSizing: 'border-box',
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 13,
  background: '#F2F4F7',
  color: '#61686F',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
};

const saveBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 13,
  fontWeight: 500,
  background: '#1F2328',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
};

const actionBtnStyle: React.CSSProperties = {
  padding: '3px 8px',
  fontSize: 11,
  background: 'none',
  color: '#61686F',
  border: '1px solid var(--border-light)',
  borderRadius: 4,
  cursor: 'pointer',
};

const selectStyle: React.CSSProperties = {
  padding: '4px 6px',
  fontSize: 12,
  border: '1px solid var(--border-light)',
  borderRadius: 4,
  outline: 'none',
  background: '#fff',
  width: '100%',
  boxSizing: 'border-box',
};
